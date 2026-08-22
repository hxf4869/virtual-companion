package com.virtualcompanion.runtime.replica;

import java.io.Closeable;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Membership-exclusive singleton lease for the Technical Alpha / Beta runtime
 * (S0-33, blueprint §12.7). One process must be the single active runtime at
 * any time while shared state is process-local; this lease enforces that at
 * the PostgreSQL level with a session-scoped advisory lock, so it works across
 * any number of hosts or containers sharing the deployment database, with no
 * new infrastructure (no Redis, no message bus, no leader-election platform).
 *
 * <p>Mechanics: the holder opens a DEDICATED connection (outside the
 * connection pool) and calls
 * {@code SELECT pg_try_advisory_lock(hashtext('vc.runtime.singleton'))}.
 * PostgreSQL advisory locks are session-scoped and re-entrant: a second
 * instance's attempt returns false while the first holds the lock, and the
 * lock is released automatically when the holder's session ends — so a crashed
 * or restarted instance never leaves a stale lease, and a replacement can
 * re-acquire. That is what makes failure recovery safe: the old instance dies
 * (session ends, lock released), the restarted container re-acquires, and
 * there is never a moment with two leases held.
 *
 * <p>State semantics:
 * <ul>
 *   <li>HELD — this process owns the lease; every data path may proceed.</li>
 *   <li>REFUSED — another live instance holds the lease. This is a definitive
 *       membership violation: the process must stop serving (fail-stop via
 *       the halt hook) and every connection request fails closed meanwhile. A
 *       refused instance never serves once it has observed the violation.</li>
 *   <li>UNAVAILABLE — the database could not be reached while acquiring. This
 *       is NOT a membership violation (a single instance with a DB blip stays
 *       the single instance); acquisition is retried on later connection
 *       requests with a minimum interval. The caller still fails closed for
 *       the current request, matching the lazy-datasource philosophy (no live
 *       database at startup is required).</li>
 * </ul>
 *
 * <p>Fail-closed supervision: once HELD, a watchdog periodically re-verifies
 * on the dedicated session that the lease is still owned (re-entrant try-lock
 * doubles as a live round-trip). If the session dies or the lock is lost, the
 * watchdog invokes the halt hook: the process may no longer claim to be the
 * single active runtime.
 *
 * <p>The halt hook defaults to {@code System.exit(87)} with a log marker
 * ({@code RUNTIME_SINGLETON_REFUSED}) so deployment tooling (docker restart
 * policies, smoke drills) observes a hard, greppable failure. Tests inject a
 * recording hook instead.
 */
public final class RuntimeSingletonLease implements Closeable {

    /** Advisory-lock key: hashtext of this literal, evaluated server-side. */
    public static final String LOCK_KEY = "vc.runtime.singleton";
    public static final String TRY_LOCK_SQL =
            "SELECT pg_try_advisory_lock(hashtext('" + LOCK_KEY + "'))";
    /** Exit code for a refused/lost lease; distinct from other exit codes. */
    public static final int HALT_EXIT_CODE = 87;

    /** Default watchdog interval between ownership re-checks. */
    public static final long DEFAULT_WATCHDOG_INTERVAL_MILLIS = 10_000L;
    /** Minimum interval between automatic re-acquisition attempts when the DB
     * was unreachable — prevents a getConnection hot loop on a down database. */
    public static final long DEFAULT_RETRY_INTERVAL_MILLIS = 2_000L;

    private static final Logger log = LoggerFactory.getLogger(RuntimeSingletonLease.class);

    public enum State { UNKNOWN, HELD, REFUSED, UNAVAILABLE }

    /** Opens the dedicated lease session; injected seam for tests. */
    public interface LeaseConnector {
        Connection open() throws SQLException;
    }

    private final LeaseConnector connector;
    private final Runnable haltHook;
    private final long watchdogIntervalMillis;
    private final long retryIntervalMillis;
    private final ReentrantLock acquireLock = new ReentrantLock();
    private final AtomicBoolean halted = new AtomicBoolean(false);
    private final ScheduledExecutorService watchdog;

    private volatile Connection leaseConnection;
    private volatile State state = State.UNKNOWN;
    private volatile long lastAttemptMillis = 0L;

    public RuntimeSingletonLease(
            LeaseConnector connector, Runnable haltHook, long watchdogIntervalMillis) {
        this(connector, haltHook, watchdogIntervalMillis, DEFAULT_RETRY_INTERVAL_MILLIS);
    }

    public RuntimeSingletonLease(
            LeaseConnector connector,
            Runnable haltHook,
            long watchdogIntervalMillis,
            long retryIntervalMillis) {
        this.connector = connector;
        this.haltHook = haltHook;
        this.watchdogIntervalMillis = watchdogIntervalMillis;
        this.retryIntervalMillis = retryIntervalMillis;
        this.watchdog = watchdogIntervalMillis > 0
                ? Executors.newSingleThreadScheduledExecutor(r -> {
                      Thread t = new Thread(r, "runtime-singleton-lease-watchdog");
                      t.setDaemon(true);
                      return t;
                  })
                : null;
    }

    /**
     * Best-effort early attempt so a deployment with a reachable database
     * settles HELD/REFUSED during startup, before the first request. Never
     * throws: a missing database is UNAVAILABLE and deferred, matching the
     * lazy-datasource contract (contexts without a live DB must still boot).
     * A REFUSED outcome, however, halts immediately — an instance that has
     * observed another live holder must stop before it can serve anything.
     */
    public void attemptEarly() {
        try {
            acquire();
        } catch (SQLException e) {
            state = State.UNAVAILABLE;
            log.warn("runtime-singleton: database unreachable during early lease attempt "
                    + "({}), deferring acquisition to first database use", e.getMessage());
            return;
        }
        if (state == State.REFUSED) {
            // The data-path exception serves callers; during the early attempt
            // the halt already happened, that is the point.
            halt();
        }
    }

    /**
     * Ensures this process holds the lease before any data-path connection is
     * handed out. Fast path: HELD. Refused or unavailable: throws
     * {@link SQLException} so the caller fails closed; REFUSED additionally
     * triggers fail-stop through the halt hook.
     */
    public void ensureHeld() throws SQLException {
        State current = state;
        if (current == State.HELD) {
            return;
        }
        if (current == State.REFUSED) {
            throw refused();
        }
        if (current == State.UNAVAILABLE
                && System.currentTimeMillis() - lastAttemptMillis < retryIntervalMillis) {
            throw new SQLException(
                    "single-replica lease unavailable: database unreachable, retrying "
                            + "shortly (" + LOCK_KEY + ")");
        }
        try {
            acquire();
        } catch (SQLException e) {
            state = State.UNAVAILABLE;
            throw new SQLException(
                    "single-replica lease unavailable: could not reach the database to "
                            + "verify membership — failing closed (" + e.getMessage() + ")",
                    e);
        }
        if (state == State.REFUSED) {
            throw refused();
        }
    }

    private void acquire() throws SQLException {
        acquireLock.lock();
        try {
            if (state == State.HELD || state == State.REFUSED) {
                return;
            }
            lastAttemptMillis = System.currentTimeMillis();
            Connection connection = connector.open();
            if (!tryLockOn(connection)) {
                closeQuietly(connection);
                state = State.REFUSED;
                log.error("runtime-singleton: RUNTIME_SINGLETON_REFUSED — another live "
                        + "runtime instance holds the single-replica lease (" + LOCK_KEY + ")");
                return;
            }
            leaseConnection = connection;
            state = State.HELD;
            startWatchdogIfNeeded();
            log.info("runtime-singleton: acquired the single-replica lease (" + LOCK_KEY + ")");
        } finally {
            acquireLock.unlock();
        }
    }

    private static boolean tryLockOn(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(TRY_LOCK_SQL)) {
            return result.next() && result.getBoolean(1);
        }
    }

    private void startWatchdogIfNeeded() {
        if (watchdog == null || state != State.HELD) {
            return;
        }
        watchdog.scheduleAtFixedRate(
                this::reverifyOwnership, watchdogIntervalMillis, watchdogIntervalMillis,
                TimeUnit.MILLISECONDS);
    }

    /**
     * Re-verifies on the dedicated session that we still own the lease. The
     * try-lock is re-entrant: true means THIS session still holds it (and the
     * query itself proved the session is alive). Any failure means the lease
     * is lost or the session died — fail-stop, because this process must never
     * serve without exclusive membership.
     */
    void reverifyOwnership() {
        Connection connection = leaseConnection;
        if (connection == null) {
            return;
        }
        try {
            if (tryLockOn(connection)) {
                return;
            }
            log.error("runtime-singleton: lease ownership LOST — halting");
        } catch (SQLException e) {
            log.error("runtime-singleton: lease session died, halting ({})", e.getMessage());
        }
        halt();
    }

    private SQLException refused() {
        halt();
        return new SQLException(
                "RUNTIME_SINGLETON_REFUSED: another live runtime instance holds the "
                        + "single-replica lease (" + LOCK_KEY + "); this instance will not serve");
    }

    private void halt() {
        state = State.REFUSED;
        if (halted.compareAndSet(false, true)) {
            try {
                haltHook.run();
            } catch (RuntimeException e) {
                log.error("runtime-singleton: halt hook failed", e);
            }
        }
    }

    /** Releases the lease voluntarily (graceful shutdown). */
    @Override
    public void close() {
        acquireLock.lock();
        try {
            if (watchdog != null) {
                watchdog.shutdownNow();
            }
            Connection connection = leaseConnection;
            leaseConnection = null;
            if (connection != null) {
                closeQuietly(connection);
            }
            state = State.UNKNOWN;
        } finally {
            acquireLock.unlock();
        }
    }

    private static void closeQuietly(Connection connection) {
        try {
            connection.close();
        } catch (SQLException ignored) {
            // Closing a dead session is best-effort.
        }
    }

    State state() {
        return state;
    }

    /** Default halt: deterministic non-zero exit with a greppable marker. */
    public static Runnable defaultHalt(Logger logger) {
        return () -> {
            logger.error("runtime-singleton: HALTING (exit {}) — deployment must run exactly "
                    + "one runtime instance until shared state is externalized (S2-37)",
                    HALT_EXIT_CODE);
            System.exit(HALT_EXIT_CODE);
        };
    }

    /** DriverManager-backed connector for the deployment datasource. */
    public static RuntimeSingletonLease.LeaseConnector driverManagerConnector(
            String url, String username, String password) {
        return () -> java.sql.DriverManager.getConnection(url, username, password);
    }
}