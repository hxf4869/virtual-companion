package com.virtualcompanion.runtime.replica;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;

/**
 * S0-33 / §12.7: the DataSource wrapper must put the single-replica lease in
 * front of EVERY connection request — HELD delegates to the pool, REFUSED
 * fails closed with the marker plus fail-stop, UNAVAILABLE fails closed for
 * the current request without a halt, and destroy tears the lease down with
 * the pool.
 */
class SingletonLeaseDataSourceTest {

    /** DataSource that is also Closeable, to exercise the destroy path. */
    private interface CloseableDataSource extends DataSource, AutoCloseable {}

    private static final String REFUSAL_MARKER = "RUNTIME_SINGLETON_REFUSED";

    private Statement statement;
    private ResultSet resultSet;
    private Connection pooledConnection;
    private Connection leaseConnection;
    private AtomicInteger halts;

    private CloseableDataSource delegate;

    private void stubLock(boolean available) throws Exception {
        statement = mock(Statement.class);
        resultSet = mock(ResultSet.class);
        when(resultSet.next()).thenReturn(true);
        when(resultSet.getBoolean(1)).thenReturn(available);
        leaseConnection = mock(Connection.class);
        when(leaseConnection.createStatement()).thenReturn(statement);
        when(statement.executeQuery(RuntimeSingletonLease.TRY_LOCK_SQL))
                .thenReturn(resultSet);

        pooledConnection = mock(Connection.class);
        delegate = mock(CloseableDataSource.class);
        when(delegate.getConnection()).thenReturn(pooledConnection);
        halts = new AtomicInteger();
    }

    private SingletonLeaseDataSource newGuarded() {
        RuntimeSingletonLease lease = new RuntimeSingletonLease(
                () -> leaseConnection, halts::incrementAndGet, 0);
        return new SingletonLeaseDataSource(delegate, lease);
    }

    @Test
    void heldLeaseDelegatesToThePool() throws Exception {
        stubLock(true);
        SingletonLeaseDataSource guarded = newGuarded();
        guarded.afterPropertiesSet();

        Connection connection = guarded.getConnection();

        assertThat(connection).isSameAs(pooledConnection);
        verify(delegate).getConnection();
        assertThat(halts.get()).isZero();
    }

    @Test
    void refusedLeaseBlocksEveryConnectionAndHalts() throws Exception {
        stubLock(false);
        SingletonLeaseDataSource guarded = newGuarded();
        guarded.afterPropertiesSet(); // early attempt observes another holder

        assertThat(halts.get()).isEqualTo(1);
        assertThatThrownBy(guarded::getConnection)
                .isInstanceOf(SQLException.class)
                .hasMessageContaining(REFUSAL_MARKER);
        assertThatThrownBy(() -> guarded.getConnection("u", "p"))
                .isInstanceOf(SQLException.class)
                .hasMessageContaining(REFUSAL_MARKER);
        verify(delegate, org.mockito.Mockito.never()).getConnection();
    }

    @Test
    void unavailableDatabaseFailsClosedWithoutHalting() throws Exception {
        halts = new AtomicInteger();
        delegate = mock(CloseableDataSource.class);
        RuntimeSingletonLease lease = new RuntimeSingletonLease(
                () -> {
                    throw new SQLException("connection refused");
                },
                halts::incrementAndGet,
                0);
        SingletonLeaseDataSource guarded = new SingletonLeaseDataSource(delegate, lease);
        guarded.afterPropertiesSet();

        assertThat(halts.get()).isZero();
        assertThatThrownBy(guarded::getConnection)
                .isInstanceOf(SQLException.class)
                .hasMessageContaining("single-replica lease unavailable");
    }

    @Test
    void destroyReleasesLeaseAndClosesPool() throws Exception {
        stubLock(true);
        SingletonLeaseDataSource guarded = newGuarded();
        guarded.afterPropertiesSet();

        guarded.destroy();

        verify(leaseConnection).close();
        verify(delegate).close();
    }
}