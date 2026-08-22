package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.authorization.ProcessingPurpose;
import com.virtualcompanion.modelruntime.authorization.ProviderContractRef;
import com.virtualcompanion.modelruntime.authorization.ProviderRegion;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.registry.InMemoryProviderRegistry;
import com.virtualcompanion.modelruntime.registry.ProviderDeployment;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistration;
import com.virtualcompanion.platform.persistence.JdbcAuthorizationSnapshotProvider.CreatedSnapshotIds;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.RowMapper;

/**
 * Pure unit tests for {@link JdbcAuthorizationSnapshotProvider} (TASK-0181,
 * S0-25): the V26 {@code create_authorization_snapshots} call (SQL text,
 * parameter order, text[] array) is pinned, the minted dual ids are returned
 * without any process-local mirroring (the DB rows are the authority the guard
 * re-reads pre-outbound), the provider id is derived with the
 * {@code DeterministicRouter} candidate rule, and every degraded path fails
 * closed. The real database behavior is proven by infra/db test 68.
 */
class JdbcAuthorizationSnapshotProviderTest {

    private static final ProviderId PROVIDER = new ProviderId("alpha-loopback");
    private static final ProviderRegion REGION = new ProviderRegion("us");
    private static final ProviderContractRef CONTRACT = new ProviderContractRef("alpha-standard");

    private final JdbcTemplate jdbc = Mockito.mock(JdbcTemplate.class);

    private InMemoryProviderRegistry registry;
    private JdbcAuthorizationSnapshotProvider provider;

    @BeforeEach
    void setUp() {
        registry = new InMemoryProviderRegistry();
        provider = new JdbcAuthorizationSnapshotProvider(
                jdbc,
                registry,
                ModelProtocol.FAKE,
                REGION,
                CONTRACT,
                ProcessingPurpose.COMPANION_CHAT,
                Set.of(DataCategory.MESSAGE_TEXT));
    }

    private static ProviderRegistration registration(ProviderId id, ModelProtocol protocol) {
        ModelProtocolAdapter adapter = mock(ModelProtocolAdapter.class);
        when(adapter.protocol()).thenReturn(protocol);
        when(adapter.capabilities()).thenReturn(new ModelProtocolCapabilities(Set.of()));
        return new ProviderRegistration(id, protocol, new ModelProtocolCapabilities(Set.of()), adapter);
    }

    private static void stubCreatedIds(JdbcTemplate jdbc, String requestedId, String executionId) {
        when(jdbc.query(anyString(), any(PreparedStatementSetter.class),
                ArgumentMatchers.<RowMapper<CreatedSnapshotIds>>any()))
                .thenReturn(List.of(new CreatedSnapshotIds(requestedId, executionId)));
    }

    /**
     * A PreparedStatement mock whose {@code getConnection().createArrayOf}
     * yields a mock {@code Array}, so the provider's text[] binding is
     * exercised without a real JDBC connection.
     */
    private static java.sql.PreparedStatement sqlMock() throws java.sql.SQLException {
        var ps = mock(java.sql.PreparedStatement.class);
        var connection = mock(java.sql.Connection.class);
        when(ps.getConnection()).thenReturn(connection);
        when(connection.createArrayOf(anyString(), any(Object[].class)))
                .thenReturn(mock(java.sql.Array.class));
        return ps;
    }

    @Test
    void createForReturnsMintedIdsWithoutProcessLocalMirroring() {
        registry.register(registration(PROVIDER, ModelProtocol.FAKE));
        stubCreatedIds(jdbc, "snap-req-1", "snap-exec-1");

        AuthorizationSnapshotProvider.SnapshotIds ids = provider.createFor(1L, 10L);

        assertEquals("snap-req-1", ids.requestedId());
        assertEquals("snap-exec-1", ids.executionId());
        // S0-25: the only writes are the V26 SD call — no snapshot is copied
        // into any process-local store (jdbc.update is never touched).
        verify(jdbc, Mockito.never()).update(anyString(), ArgumentMatchers.any(Object[].class));
    }

    @Test
    void createForCallsV26FunctionWithOwnerGenerationProviderRegionContractPurposeAndArray()
            throws Exception {
        registry.register(registration(PROVIDER, ModelProtocol.FAKE));
        stubCreatedIds(jdbc, "snap-req-1", "snap-exec-1");

        provider.createFor(1L, 10L);

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<PreparedStatementSetter> setter = ArgumentCaptor.forClass(PreparedStatementSetter.class);
        verify(jdbc).query(sql.capture(), setter.capture(), any(RowMapper.class));
        assertTrue(sql.getValue().contains(
                "FROM vc.create_authorization_snapshots(?, ?, ?, ?, ?, ?, ?)"));
        var sqlMock = sqlMock();
        setter.getValue().setValues(sqlMock);
        verify(sqlMock).setLong(1, 1L);
        verify(sqlMock).setLong(2, 10L);
        verify(sqlMock).setString(3, "alpha-loopback");
        verify(sqlMock).setString(4, "us");
        verify(sqlMock).setString(5, "alpha-standard");
        verify(sqlMock).setString(6, "COMPANION_CHAT");
        verify(sqlMock).setArray(org.mockito.ArgumentMatchers.eq(7), any(java.sql.Array.class));
    }

    @Test
    void createForSelectsFirstAdmittedProviderByRouterRule() throws Exception {
        // Two admitted FAKE deployments: the DeterministicRouter candidate rule
        // (admitted + protocol match, ordered by provider id, first wins) must
        // select the lexicographically smallest provider id.
        registry.register(registration(new ProviderId("alpha-loopback"), ModelProtocol.FAKE));
        registry.register(registration(new ProviderId("alpha-openai"), ModelProtocol.OPENAI_CHAT_COMPLETIONS));
        registry.register(registration(new ProviderId("alpha-zero"), ModelProtocol.FAKE));
        stubCreatedIds(jdbc, "snap-req-1", "snap-exec-1");

        provider.createFor(1L, 10L);

        ArgumentCaptor<PreparedStatementSetter> setter = ArgumentCaptor.forClass(PreparedStatementSetter.class);
        verify(jdbc).query(anyString(), setter.capture(), any(RowMapper.class));
        var sqlMock = sqlMock();
        setter.getValue().setValues(sqlMock);
        // "alpha-loopback" < "alpha-zero" lexicographically; the OPENAI
        // deployment does not match the configured FAKE protocol.
        verify(sqlMock).setString(3, "alpha-loopback");
    }

    @Test
    void createForFailsClosedWithoutAdmittedDeployment() {
        registry.register(registration(new ProviderId("alpha-openai"), ModelProtocol.OPENAI_CHAT_COMPLETIONS));

        IllegalStateException exc = assertThrows(IllegalStateException.class,
                () -> provider.createFor(1L, 10L));
        assertTrue(exc.getMessage().contains("no admitted provider deployment"));
    }

    @Test
    void createForFailsClosedWhenSdReturnsNoRow() {
        registry.register(registration(PROVIDER, ModelProtocol.FAKE));
        when(jdbc.query(anyString(), any(PreparedStatementSetter.class),
                ArgumentMatchers.<RowMapper<CreatedSnapshotIds>>any()))
                .thenReturn(List.of());

        IllegalStateException exc = assertThrows(IllegalStateException.class,
                () -> provider.createFor(1L, 10L));
        assertTrue(exc.getMessage().contains("returned 0 rows"));
    }

    @Test
    void createForRejectsInvalidIds() {
        assertThrows(IllegalArgumentException.class, () -> provider.createFor(0L, 10L));
        assertThrows(IllegalArgumentException.class, () -> provider.createFor(1L, 0L));
    }

    @Test
    void createForPropagatesBadSqlGrammar() {
        registry.register(registration(PROVIDER, ModelProtocol.FAKE));
        when(jdbc.query(anyString(), any(PreparedStatementSetter.class),
                ArgumentMatchers.<RowMapper<CreatedSnapshotIds>>any()))
                .thenThrow(new BadSqlGrammarException("query", "sql", new java.sql.SQLSyntaxErrorException()));

        assertThrows(BadSqlGrammarException.class, () -> provider.createFor(1L, 10L));
    }

    @Test
    void constructorRejectsEmptyCategories() {
        assertThrows(IllegalArgumentException.class, () -> new JdbcAuthorizationSnapshotProvider(
                jdbc, registry, ModelProtocol.FAKE, REGION, CONTRACT,
                ProcessingPurpose.COMPANION_CHAT, Set.of()));
    }
}
