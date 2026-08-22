package com.virtualcompanion.runtime.replica;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

/**
 * S0-33 / §12.7: the single-replica membership lease. Covers the four state
 * semantics that make the gate hard rather than advisory:
 * <ul>
 *   <li>HELD — one instance acquires and re-verifies (re-entrant try-lock);
 *   <li>REFUSED — a second instance observing another holder must fail closed
 *       on every connection AND fail-stop via the halt hook (exactly once);
 *   <li>UNAVAILABLE — a lone instance with an unreachable database must NOT be
 *       treated as a membership violation (no halt), the acquisition retries;
 *   <li>watchdog — a lost or dead lease session halts the process (fail-stop),
 *       because serving without exclusive membership is forbidden.
 * </ul>
 */
class RuntimeSingletonLeaseTest {

    private static final String REFUSAL_MARKER = "RUNTIME_SINGLETON_REFUSED";

    private Connection connection;
    private Statement statement;
    private ResultSet resultSet;
    private AtomicInteger halts;

    private void stubLock(boolean available) throws Exception {
        connection = Mockito.mock(Connection.class);
        statement = Mockito.mock(Statement.class);
        resultSet = Mockito.mock(ResultSet.class);
        Mockito.when(connection.createStatement()).thenReturn(statement);
        Mockito.when(statement.executeQuery(RuntimeSingletonLease.TRY_LOCK_SQL))
                .thenReturn(resultSet);
        Mockito.when(resultSet.next()).thenReturn(true);
        Mockito.when(resultSet.getBoolean(1)).thenReturn(available);
        halts = new AtomicInteger();
    }

    private RuntimeSingletonLease newLease(long watchdogMillis) {
        return new RuntimeSingletonLease(
                () -> connection,
                halts::incrementAndGet,
                watchdogMillis);
    }

    @Test
    void singleInstanceAcquiresAndHoldsLease() throws Exception {
        stubLock(true);
        RuntimeSingletonLease lease = newLease(0);
        lease.attemptEarly();

        assertThat(lease.state()).isEqualTo(RuntimeSingletonLease.State.HELD);
        lease.ensureHeld(); // fast path: no re-open of the connector
        assertThat(halts.get()).isZero();

        lease.reverifyOwnership(); // re-entrant try-lock: still ours
        assertThat(halts.get()).isZero();

        lease.close();
        assertThat(lease.state()).isEqualTo(RuntimeSingletonLease.State.UNKNOWN);
        Mockito.verify(connection).close();
    }

    @Test
    void secondInstanceIsRefusedDuringEarlyAttemptAndHaltsBeforeServing() throws Exception {
        stubLock(false);
        RuntimeSingletonLease lease = newLease(0);
        lease.attemptEarly();

        assertThat(lease.state()).isEqualTo(RuntimeSingletonLease.State.REFUSED);
        assertThat(halts.get()).isEqualTo(1);
        // The failed acquisition must not leak the dedicated session.
        Mockito.verify(connection).close();
    }

    @Test
    void refusedInstanceFailsClosedOnEveryConnectionAndHaltsExactlyOnce() throws Exception {
        stubLock(false);
        RuntimeSingletonLease lease = newLease(0);
        // No early attempt: refusal observed on the data path instead.
        assertThatThrownBy(lease::ensureHeld)
                .isInstanceOf(SQLException.class)
                .hasMessageContaining(REFUSAL_MARKER)
                .hasMessageContaining(RuntimeSingletonLease.LOCK_KEY);
        assertThat(halts.get()).isEqualTo(1);

        assertThatThrownBy(lease::ensureHeld)
                .isInstanceOf(SQLException.class)
                .hasMessageContaining(REFUSAL_MARKER);
        assertThat(halts.get()).isEqualTo(1); // halt fired exactly once
        assertThat(lease.state()).isEqualTo(RuntimeSingletonLease.State.REFUSED);
    }

    @Test
    void unreachableDatabaseIsNotAMembershipViolationAndNeverHalts() throws Exception {
        AtomicInteger unusedHalts = new AtomicInteger();
        RuntimeSingletonLease unavailableLease = new RuntimeSingletonLease(
                () -> {
                    throw new SQLException("connection refused");
                },
                unusedHalts::incrementAndGet,
                0);
        unavailableLease.attemptEarly();

        assertThat(unavailableLease.state())
                .isEqualTo(RuntimeSingletonLease.State.UNAVAILABLE);
        assertThat(unusedHalts.get()).isZero();

        // Same instance, check again immediately: throttled retry, still no halt.
        assertThatThrownBy(unavailableLease::ensureHeld)
                .isInstanceOf(SQLException.class)
                .hasMessageContaining("retrying shortly");
        assertThat(unusedHalts.get()).isZero();
    }

    @Test
    void lostLeaseOwnershipHaltsTheProcess() throws Exception {
        stubLock(true);
        RuntimeSingletonLease lease = newLease(0);
        lease.attemptEarly();
        assertThat(lease.state()).isEqualTo(RuntimeSingletonLease.State.HELD);

        // The session is alive but the lock is no longer ours (should be
        // impossible while the session lives, but fail closed anyway).
        Mockito.when(resultSet.getBoolean(1)).thenReturn(false);
        lease.reverifyOwnership();

        assertThat(halts.get()).isEqualTo(1);
        assertThat(lease.state()).isEqualTo(RuntimeSingletonLease.State.REFUSED);
    }

    @Test
    void deadLeaseSessionHaltsTheProcess() throws Exception {
        stubLock(true);
        RuntimeSingletonLease lease = newLease(0);
        lease.attemptEarly();
        assertThat(lease.state()).isEqualTo(RuntimeSingletonLease.State.HELD);

        Mockito.when(statement.executeQuery(RuntimeSingletonLease.TRY_LOCK_SQL))
                .thenThrow(new SQLException("connection closed"));
        lease.reverifyOwnership();

        assertThat(halts.get()).isEqualTo(1);
        assertThat(lease.state()).isEqualTo(RuntimeSingletonLease.State.REFUSED);
    }
}