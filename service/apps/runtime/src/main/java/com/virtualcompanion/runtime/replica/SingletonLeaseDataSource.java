package com.virtualcompanion.runtime.replica;

import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.logging.Logger;
import javax.sql.DataSource;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;

/**
 * DataSource wrapper enforcing the single-replica membership lease (S0-33,
 * blueprint §12.7). Every connection request passes through
 * {@link RuntimeSingletonLease#ensureHeld()} first, so every data path — HTTP
 * handlers, worker schedulers, health probes, background jobs — fails closed
 * the moment this process is not the single active runtime:
 *
 * <ul>
 *   <li>lease HELD → the request proceeds on the underlying pool.</li>
 *   <li>lease REFUSED (another instance holds it) → {@link SQLException} with
 *       the {@code RUNTIME_SINGLETON_REFUSED} marker and the process halts
 *       (System.exit 87 via the lease halt hook).</li>
 *   <li>lease UNAVAILABLE (database unreachable) → {@link SQLException};
 *       acquisition is retried automatically afterwards. A lone instance with
 *       a database blip must not be treated as two instances.</li>
 * </ul>
 *
 * <p>The early attempt ({@link #afterPropertiesSet()}) settles the lease
 * during context refresh — before the web server starts accepting requests —
 * whenever the database is reachable, so a scaled deployment is refused before
 * serving anything, not merely on the first traffic.
 */
public final class SingletonLeaseDataSource implements DataSource, InitializingBean, DisposableBean {

    private final DataSource delegate;
    private final RuntimeSingletonLease lease;

    public SingletonLeaseDataSource(DataSource delegate, RuntimeSingletonLease lease) {
        this.delegate = delegate;
        this.lease = lease;
    }

    @Override
    public void afterPropertiesSet() {
        lease.attemptEarly();
    }

    @Override
    public Connection getConnection() throws SQLException {
        lease.ensureHeld();
        return delegate.getConnection();
    }

    @Override
    public Connection getConnection(String username, String password) throws SQLException {
        lease.ensureHeld();
        return delegate.getConnection(username, password);
    }

    @Override
    public void destroy() {
        lease.close();
        if (delegate instanceof AutoCloseable closeable) {
            try {
                closeable.close();
            } catch (Exception e) {
                // Best-effort pool close on shutdown.
            }
        }
    }

    // -- pure delegation ------------------------------------------------

    @Override
    public PrintWriter getLogWriter() throws SQLException {
        return delegate.getLogWriter();
    }

    @Override
    public void setLogWriter(PrintWriter out) throws SQLException {
        delegate.setLogWriter(out);
    }

    @Override
    public void setLoginTimeout(int seconds) throws SQLException {
        delegate.setLoginTimeout(seconds);
    }

    @Override
    public int getLoginTimeout() throws SQLException {
        return delegate.getLoginTimeout();
    }

    @Override
    public Logger getParentLogger() throws SQLFeatureNotSupportedException {
        return delegate.getParentLogger();
    }

    @Override
    public <T> T unwrap(Class<T> iface) throws SQLException {
        return delegate.unwrap(iface);
    }

    @Override
    public boolean isWrapperFor(Class<?> iface) throws SQLException {
        return delegate.isWrapperFor(iface);
    }
}