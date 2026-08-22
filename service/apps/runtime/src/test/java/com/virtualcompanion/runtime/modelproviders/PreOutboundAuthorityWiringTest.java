package com.virtualcompanion.runtime.modelproviders;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshot;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotId;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.authorization.AuthorizationStatus;
import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationDecision;
import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationGuard;
import com.virtualcompanion.modelruntime.authorization.InMemoryAuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.authorization.ProcessingPurpose;
import com.virtualcompanion.modelruntime.authorization.ProviderContractRef;
import com.virtualcompanion.modelruntime.authorization.ProviderRegion;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import com.virtualcompanion.modelruntime.registry.InMemoryProviderRegistry;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistration;
import com.virtualcompanion.platform.persistence.JdbcAuthorizationSnapshotStore;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * S0-25 装配验证：{@link ApprovedModelProviderConfig} 的外发授权复核在 auth
 * 数据源已接线时必须落在 DB 权威 {@link JdbcAuthorizationSnapshotStore} 上；
 * 仅在没有数据源的退化装配（无法铸造快照、外发本就 fail-closed）才回退进程内
 * store，且回退路径上 DB 的撤回状态优先于任何陈旧的进程内 ACTIVE 副本。
 */
class PreOutboundAuthorityWiringTest {

    private static final OwnershipTuple OWNERSHIP =
            new OwnershipTuple("1", "9", "5", "10");
    private static final ProviderId PROVIDER = new ProviderId("alpha-loopback");

    @Test
    void dbAuthorityIsSelectedWhenTheAuthDatasourceIsWired() {
        FakeAuthorityTable table = new FakeAuthorityTable();
        InMemoryAuthorizationSnapshotStore memory = new InMemoryAuthorizationSnapshotStore();

        AuthorizationSnapshotStore selected =
                ApprovedModelProviderConfig.preOutboundAuthority(table.store(), memory);

        assertSame(table.store(), selected,
                "with the auth datasource wired, the DB authority must be selected");

        // 快照只存在于 DB 权威——guard 放行即证明它读的是 DB 而非进程内 store。
        table.seed(active("snap-req-w"), active("snap-exec-w"));
        ExecutionAuthorizationGuard guard = new ExecutionAuthorizationGuard(selected, registry());
        assertTrue(guard.authorize(binding("snap-req-w", "snap-exec-w")).allowed());
    }

    @Test
    void dbWithdrawalBeatsActiveProcessLocalCopy() {
        FakeAuthorityTable table = new FakeAuthorityTable();
        InMemoryAuthorizationSnapshotStore staleMemory = new InMemoryAuthorizationSnapshotStore();
        staleMemory.put(active("snap-req-x"));
        staleMemory.put(active("snap-exec-x"));

        // DB 权威里同一对快照已被撤回（另一实例提交的 V46 结果）。
        table.seedWithdrawn("snap-req-x");
        table.seedWithdrawn("snap-exec-x");

        ExecutionAuthorizationGuard guard = new ExecutionAuthorizationGuard(
                ApprovedModelProviderConfig.preOutboundAuthority(table.store(), staleMemory),
                registry());

        ExecutionAuthorizationDecision decision =
                guard.authorize(binding("snap-req-x", "snap-exec-x"));
        assertFalse(decision.allowed(),
                "the DB authority must win over a stale process-local ACTIVE copy");
        assertTrue(decision.denialReason().contains("WITHDRAWN"));
    }

    @Test
    void degenerateNoDatasourceWiringFallsBackToProcessLocalStore() {
        InMemoryAuthorizationSnapshotStore memory = new InMemoryAuthorizationSnapshotStore();
        memory.put(active("snap-req-y"));
        memory.put(active("snap-exec-y"));

        assertSame(memory,
                ApprovedModelProviderConfig.preOutboundAuthority(null, memory));

        ExecutionAuthorizationGuard guard = new ExecutionAuthorizationGuard(
                ApprovedModelProviderConfig.preOutboundAuthority(null, memory), registry());
        assertTrue(guard.authorize(binding("snap-req-y", "snap-exec-y")).allowed());
    }

    /** 只读 DB 权威的最小替身：行存于内存，SQL 文本由真实 store 执行。 */
    private static final class FakeAuthorityTable {
        private final Map<String, AuthorizationSnapshot> rows = new ConcurrentHashMap<>();
        private final JdbcAuthorizationSnapshotStore store =
                new JdbcAuthorizationSnapshotStore(mockedJdbc());

        private JdbcTemplate mockedJdbc() {
            JdbcTemplate jdbc = mock(JdbcTemplate.class);
            when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
                    .thenAnswer(inv -> {
                        String snapshotId = inv.getArgument(2, String.class);
                        AuthorizationSnapshot row = rows.get(snapshotId);
                        return row == null ? List.<AuthorizationSnapshot>of()
                                           : List.of(row);
                    });
            return jdbc;
        }

        JdbcAuthorizationSnapshotStore store() {
            return store;
        }

        void seed(AuthorizationSnapshot requested, AuthorizationSnapshot execution) {
            rows.put(requested.id().value(), requested);
            rows.put(execution.id().value(), execution);
        }

        void seedWithdrawn(String id) {
            AuthorizationSnapshot active = active(id);
            rows.put(id, new AuthorizationSnapshot(
                    active.id(), AuthorizationStatus.WITHDRAWN, active.providerId(),
                    active.region(), active.contractRef(), active.purpose(),
                    active.dataCategories(), false, false));
        }
    }

    private static AuthorizationSnapshot active(String id) {
        return new AuthorizationSnapshot(
                new AuthorizationSnapshotId(id),
                AuthorizationStatus.ACTIVE,
                PROVIDER,
                new ProviderRegion("us"),
                new ProviderContractRef("alpha-standard"),
                ProcessingPurpose.COMPANION_CHAT,
                Set.of(DataCategory.MESSAGE_TEXT),
                false,
                false);
    }

    private static InvocationBinding.ExternalAttemptBinding binding(
            String requestedId, String executionId) {
        return new InvocationBinding.ExternalAttemptBinding(
                OWNERSHIP, "provider-attempt-1", 1L, requestedId, executionId);
    }

    private static InMemoryProviderRegistry registry() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        registry.register(new ProviderRegistration(
                PROVIDER,
                ModelProtocol.FAKE,
                new ModelProtocolCapabilities(Set.of()),
                new StubAdapter()));
        return registry;
    }

    private static final class StubAdapter implements ModelProtocolAdapter {
        @Override
        public ModelProtocol protocol() {
            return ModelProtocol.FAKE;
        }

        @Override
        public ModelProtocolCapabilities capabilities() {
            return new ModelProtocolCapabilities(Set.of());
        }

        @Override
        public ModelProtocolSession open(ModelProtocolRequest request) {
            throw new UnsupportedOperationException("wiring test never opens a session");
        }
    }
}
