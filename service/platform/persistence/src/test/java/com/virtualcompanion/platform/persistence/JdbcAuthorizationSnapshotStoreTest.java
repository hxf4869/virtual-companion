package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshot;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotId;
import com.virtualcompanion.modelruntime.authorization.AuthorizationStatus;
import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.authorization.ProcessingPurpose;
import com.virtualcompanion.modelruntime.authorization.ProviderContractRef;
import com.virtualcompanion.modelruntime.authorization.ProviderRegion;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.RowMapper;

/**
 * Pure unit tests pinning the one-way lifecycle SQL of
 * {@link JdbcAuthorizationSnapshotStore}: insert-only {@code put}, and
 * status-conditioned single-statement {@code withdraw}/{@code narrow} whose
 * row lock makes concurrent transitions mutually exclusive. The real database
 * behavior is proven by the SQL test suite under {@code infra/db/tests}
 * (51_authorization_snapshot_one_way_lifecycle.sql); this only pins the
 * in-process SQL text and fail-closed exception semantics.
 */
class JdbcAuthorizationSnapshotStoreTest {

    private final JdbcTemplate jdbc = Mockito.mock(JdbcTemplate.class);
    private final JdbcAuthorizationSnapshotStore store = new JdbcAuthorizationSnapshotStore(jdbc);

    private static AuthorizationSnapshot snapshot(String id, AuthorizationStatus status) {
        return new AuthorizationSnapshot(
                new AuthorizationSnapshotId(id),
                status,
                new ProviderId("prov-1"),
                new ProviderRegion("eu"),
                new ProviderContractRef("contract-1"),
                ProcessingPurpose.COMPANION_CHAT,
                Set.of(DataCategory.MESSAGE_TEXT),
                false,
                false);
    }

    @Test
    void putIsInsertOnlyAndNeverUpdatesExistingRow() {
        when(jdbc.update(anyString(), any(PreparedStatementSetter.class))).thenReturn(1);
        AuthorizationSnapshot snapshot = snapshot("snap-1", AuthorizationStatus.ACTIVE);

        assertEquals(snapshot, store.put(snapshot));

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).update(sql.capture(), any(PreparedStatementSetter.class));
        assertTrue(sql.getValue().contains(
                "ON CONFLICT (owner_user_id, snapshot_id) DO NOTHING"));
        assertFalse(sql.getValue().contains("DO UPDATE"));
    }

    @Test
    void putRejectsDuplicateIdFailClosed() {
        // affected=0 means the (owner_user_id, snapshot_id) row already exists
        // (including a WITHDRAWN/NARROWED terminal snapshot): insert-only means
        // the existing snapshot can never be resurrected.
        when(jdbc.update(anyString(), any(PreparedStatementSetter.class))).thenReturn(0);

        AuthorizationSnapshot snapshot = snapshot("snap-1", AuthorizationStatus.ACTIVE);
        IllegalStateException exc = assertThrows(
                IllegalStateException.class, () -> store.put(snapshot));
        assertTrue(exc.getMessage().contains("already stored"));
    }

    @Test
    void withdrawOnlyTransitionsActiveSnapshot() {
        when(jdbc.update(anyString(), (Object[]) any())).thenReturn(1);
        when(jdbc.query(anyString(), any(RowMapper.class), (Object[]) any()))
                .thenReturn(List.of(snapshot("snap-1", AuthorizationStatus.WITHDRAWN)));

        AuthorizationSnapshot withdrawn = store.withdraw(new AuthorizationSnapshotId("snap-1"));

        assertEquals(AuthorizationStatus.WITHDRAWN, withdrawn.status());
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).update(sql.capture(), (Object[]) any());
        assertTrue(sql.getValue().contains("SET status = 'WITHDRAWN'"));
        assertTrue(sql.getValue().contains("AND status = 'ACTIVE'"));
    }

    @Test
    void withdrawMissingSnapshotFailsClosed() {
        when(jdbc.update(anyString(), (Object[]) any())).thenReturn(0);
        when(jdbc.query(anyString(), any(RowMapper.class), (Object[]) any()))
                .thenReturn(List.of());

        IllegalStateException exc = assertThrows(IllegalStateException.class,
                () -> store.withdraw(new AuthorizationSnapshotId("snap-missing")));
        assertTrue(exc.getMessage().contains("not stored"));
    }

    @Test
    void withdrawTerminalSnapshotFailsClosed() {
        // The row exists but is already WITHDRAWN: the status-conditioned
        // UPDATE changes zero rows and the store must reject the transition.
        when(jdbc.update(anyString(), (Object[]) any())).thenReturn(0);
        when(jdbc.query(anyString(), any(RowMapper.class), (Object[]) any()))
                .thenReturn(List.of(snapshot("snap-1", AuthorizationStatus.WITHDRAWN)));

        IllegalStateException exc = assertThrows(IllegalStateException.class,
                () -> store.withdraw(new AuthorizationSnapshotId("snap-1")));
        assertTrue(exc.getMessage().contains("cannot be withdrawn"));
        assertTrue(exc.getMessage().contains("only ACTIVE may transition"));
    }

    @Test
    void narrowRequiresMatchingId() {
        AuthorizationSnapshot other = snapshot("snap-other", AuthorizationStatus.ACTIVE);

        IllegalArgumentException exc = assertThrows(IllegalArgumentException.class,
                () -> store.narrow(new AuthorizationSnapshotId("snap-1"), other));
        assertTrue(exc.getMessage().contains("must equal the target id"));
    }

    @Test
    void narrowOnlyTransitionsActiveSnapshot() {
        when(jdbc.update(anyString(), any(PreparedStatementSetter.class))).thenReturn(1);
        when(jdbc.query(anyString(), any(RowMapper.class), (Object[]) any()))
                .thenReturn(List.of(snapshot("snap-1", AuthorizationStatus.NARROWED)));

        AuthorizationSnapshot narrowed =
                store.narrow(new AuthorizationSnapshotId("snap-1"),
                        snapshot("snap-1", AuthorizationStatus.ACTIVE));

        assertEquals(AuthorizationStatus.NARROWED, narrowed.status());
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).update(sql.capture(), any(PreparedStatementSetter.class));
        assertTrue(sql.getValue().contains("status = 'NARROWED'"));
        assertTrue(sql.getValue().contains("AND status = 'ACTIVE'"));
    }

    @Test
    void narrowTerminalSnapshotFailsClosed() {
        when(jdbc.update(anyString(), any(PreparedStatementSetter.class))).thenReturn(0);
        when(jdbc.query(anyString(), any(RowMapper.class), (Object[]) any()))
                .thenReturn(List.of(snapshot("snap-1", AuthorizationStatus.NARROWED)));

        IllegalStateException exc = assertThrows(IllegalStateException.class,
                () -> store.narrow(new AuthorizationSnapshotId("snap-1"),
                        snapshot("snap-1", AuthorizationStatus.ACTIVE)));
        assertTrue(exc.getMessage().contains("cannot be narrowed"));
        assertTrue(exc.getMessage().contains("only ACTIVE may transition"));
    }
}
