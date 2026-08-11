package com.virtualcompanion.runtime.auth.application;

import com.virtualcompanion.runtime.auth.web.AuthInputLimits;
import com.virtualcompanion.runtime.auth.web.AuthRateLimitException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Process-local, bounded admission control for the Technical Alpha auth surface.
 * All attacker-controlled map keys are ephemeral, domain-separated HMAC digests.
 */
public final class AuthAbuseGuard {

    static final int LOGIN_SOURCE_LIMIT = 10;
    static final int REFRESH_SOURCE_LIMIT = 10;
    static final int INPUT_KEY_LIMIT = 5;
    static final long SOURCE_WINDOW_MILLIS = 60_000L;
    static final long LOGIN_KEY_WINDOW_MILLIS = 900_000L;
    static final long REFRESH_KEY_WINDOW_MILLIS = 60_000L;
    static final long STREAK_IDLE_MILLIS = 1_800_000L;
    static final int DEFAULT_SOURCE_CAPACITY = 4096;
    static final int DEFAULT_INPUT_CAPACITY = 8192;
    static final int DEFAULT_MAX_IN_FLIGHT = 4;
    public static final int CAPACITY_RETRY_SECONDS = 60;
    static final int CONTENTION_RETRY_SECONDS = 1;

    private static final int HMAC_KEY_BYTES = 32;
    private static final int[] BACKOFF_SECONDS = {1, 2, 4, 8, 16, 60};

    private final Clock clock;
    private final byte[] hmacKey;
    private final AtomicLong lastObservedMillis = new AtomicLong(Long.MIN_VALUE);
    private final Semaphore inFlight;
    private final WindowScope loginSources;
    private final WindowScope refreshSources;
    private final WindowScope loginKeys;
    private final WindowScope refreshKeys;

    public AuthAbuseGuard() {
        this(Clock.systemUTC());
    }

    public AuthAbuseGuard(Clock clock) {
        this(
                clock,
                newEphemeralKey(),
                DEFAULT_SOURCE_CAPACITY,
                DEFAULT_INPUT_CAPACITY,
                DEFAULT_INPUT_CAPACITY,
                DEFAULT_MAX_IN_FLIGHT);
    }

    AuthAbuseGuard(
            Clock clock,
            byte[] hmacKey,
            int sourceCapacity,
            int loginKeyCapacity,
            int refreshKeyCapacity,
            int maxInFlight) {
        this.clock = Objects.requireNonNull(clock, "clock");
        if (hmacKey == null || hmacKey.length != HMAC_KEY_BYTES) {
            throw new IllegalArgumentException("HMAC key must contain exactly 256 bits");
        }
        if (sourceCapacity <= 0 || loginKeyCapacity <= 0 || refreshKeyCapacity <= 0
                || maxInFlight <= 0) {
            throw new IllegalArgumentException("admission capacities must be positive");
        }
        this.hmacKey = hmacKey.clone();
        this.inFlight = new Semaphore(maxInFlight, false);
        this.loginSources = new WindowScope(
                sourceCapacity, LOGIN_SOURCE_LIMIT, SOURCE_WINDOW_MILLIS, false);
        this.refreshSources = new WindowScope(
                sourceCapacity, REFRESH_SOURCE_LIMIT, SOURCE_WINDOW_MILLIS, false);
        this.loginKeys = new WindowScope(
                loginKeyCapacity, INPUT_KEY_LIMIT, LOGIN_KEY_WINDOW_MILLIS, true);
        this.refreshKeys = new WindowScope(
                refreshKeyCapacity, INPUT_KEY_LIMIT, REFRESH_KEY_WINDOW_MILLIS, true);
    }

    public enum Route {
        LOGIN,
        REFRESH
    }

    /** A non-blocking bulkhead lease held through the complete downstream call. */
    public interface AdmissionLease extends AutoCloseable {
        @Override
        void close();
    }

    /**
     * Acquires the global bulkhead and consumes the route-specific source window.
     * A rejected bucket never consumes its own rolling-window entry.
     */
    public AdmissionLease admitSource(Route route, String remoteAddress) {
        Objects.requireNonNull(route, "route");
        if (!inFlight.tryAcquire()) {
            throw rejected(CONTENTION_RETRY_SECONDS);
        }
        boolean admitted = false;
        try {
            String sourceKey = digest(
                    route == Route.LOGIN ? "login-source" : "refresh-source",
                    requireSource(remoteAddress));
            WindowScope scope = route == Route.LOGIN ? loginSources : refreshSources;
            scope.admit(sourceKey, nowMillis());
            admitted = true;
            return new SemaphoreLease(inFlight);
        } finally {
            if (!admitted) {
                inFlight.release();
            }
        }
    }

    /** Consumes the source-plus-canonical-username admission budget. */
    public void admitLogin(String remoteAddress, String username) {
        try {
            String canonicalUsername = AuthService.normalizeUsername(username);
            if (canonicalUsername == null || canonicalUsername.isBlank()) {
                throw rejected(CONTENTION_RETRY_SECONDS);
            }
            String key = digest("login-key", requireSource(remoteAddress), canonicalUsername);
            loginKeys.admit(key, nowMillis());
        } catch (AuthRateLimitException e) {
            throw e;
        } catch (RuntimeException e) {
            throw rejected(CAPACITY_RETRY_SECONDS);
        }
    }

    /**
     * Consumes the token admission budget only after the frozen cookie byte fence.
     * Invalid tokens remain owned by AuthService's existing 401 behavior.
     */
    public void admitRefresh(String refreshToken) {
        try {
            if (refreshToken == null
                    || refreshToken.length() > AuthInputLimits.MAX_REFRESH_TOKEN_UTF8_BYTES
                    || refreshToken.isBlank()) {
                return;
            }
            if (AuthInputLimits.utf8ByteLength(refreshToken)
                    > AuthInputLimits.MAX_REFRESH_TOKEN_UTF8_BYTES) {
                return;
            }
            refreshKeys.admit(digest("refresh-key", refreshToken), nowMillis());
        } catch (AuthRateLimitException e) {
            throw e;
        } catch (RuntimeException e) {
            throw rejected(CAPACITY_RETRY_SECONDS);
        }
    }

    int availablePermits() {
        return inFlight.availablePermits();
    }

    int stateSize(Route route) {
        return (route == Route.LOGIN ? loginSources : refreshSources).size();
    }

    int loginKeyStateSize() {
        return loginKeys.size();
    }

    int refreshKeyStateSize() {
        return refreshKeys.size();
    }

    private long nowMillis() {
        final long observed;
        try {
            observed = clock.millis();
        } catch (RuntimeException e) {
            throw rejected(CAPACITY_RETRY_SECONDS);
        }
        return lastObservedMillis.accumulateAndGet(observed, Math::max);
    }

    private String digest(String domain, String... values) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(hmacKey, "HmacSHA256"));
            updateFramed(mac, domain);
            for (String value : values) {
                updateFramed(mac, value);
            }
            return HexFormat.of().formatHex(mac.doFinal());
        } catch (GeneralSecurityException | CharacterCodingException | RuntimeException e) {
            throw rejected(CAPACITY_RETRY_SECONDS);
        }
    }

    private static void updateFramed(Mac mac, String value) throws CharacterCodingException {
        ByteBuffer bytes = StandardCharsets.UTF_8.newEncoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .encode(CharBuffer.wrap(value));
        mac.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes.remaining()).array());
        mac.update(bytes);
    }

    private static String requireSource(String source) {
        if (source == null || source.isBlank()) {
            throw rejected(CONTENTION_RETRY_SECONDS);
        }
        return source;
    }

    private static byte[] newEphemeralKey() {
        byte[] key = new byte[HMAC_KEY_BYTES];
        new SecureRandom().nextBytes(key);
        return key;
    }

    private static AuthRateLimitException rejected(int retryAfterSeconds) {
        return new AuthRateLimitException(retryAfterSeconds);
    }

    private static final class SemaphoreLease implements AdmissionLease {
        private final Semaphore semaphore;
        private final AtomicBoolean closed = new AtomicBoolean();

        private SemaphoreLease(Semaphore semaphore) {
            this.semaphore = semaphore;
        }

        @Override
        public void close() {
            if (closed.compareAndSet(false, true)) {
                semaphore.release();
            }
        }
    }

    private static final class WindowScope {
        private final int capacity;
        private final int limit;
        private final long windowMillis;
        private final boolean progressiveBackoff;
        private final ReentrantLock lock = new ReentrantLock();
        private final Map<String, WindowState> states = new HashMap<>();

        private WindowScope(int capacity, int limit, long windowMillis, boolean progressiveBackoff) {
            this.capacity = capacity;
            this.limit = limit;
            this.windowMillis = windowMillis;
            this.progressiveBackoff = progressiveBackoff;
        }

        private void admit(String key, long now) {
            if (!lock.tryLock()) {
                throw rejected(CONTENTION_RETRY_SECONDS);
            }
            try {
                WindowState state = states.get(key);
                if (state == null) {
                    if (states.size() >= capacity) {
                        reclaimExpired(now);
                        if (states.size() >= capacity) {
                            throw rejected(CAPACITY_RETRY_SECONDS);
                        }
                    }
                    state = new WindowState();
                    states.put(key, state);
                }
                state.purge(now, windowMillis);
                if (progressiveBackoff) {
                    state.expireStreakIfIdle(now);
                }

                long rollingRelease = state.timestamps.size() >= limit
                        ? saturatedAdd(state.timestamps.peekFirst(), windowMillis)
                        : now;
                long rejectionUntil = Math.max(rollingRelease, state.nextBackoffAt);
                if (rejectionUntil > now) {
                    throw rejected(retryAfterSeconds(now, rejectionUntil));
                }

                state.timestamps.addLast(now);
                if (progressiveBackoff) {
                    state.streak++;
                    int index = Math.min(state.streak - 1, BACKOFF_SECONDS.length - 1);
                    state.lastAdmissionAt = now;
                    state.nextBackoffAt = saturatedAdd(now, BACKOFF_SECONDS[index] * 1000L);
                }
            } finally {
                lock.unlock();
            }
        }

        private int size() {
            if (!lock.tryLock()) {
                return -1;
            }
            try {
                return states.size();
            } finally {
                lock.unlock();
            }
        }

        private void reclaimExpired(long now) {
            Iterator<Map.Entry<String, WindowState>> iterator = states.entrySet().iterator();
            while (iterator.hasNext()) {
                WindowState state = iterator.next().getValue();
                state.purge(now, windowMillis);
                if (progressiveBackoff) {
                    state.expireStreakIfIdle(now);
                }
                if (state.timestamps.isEmpty()
                        && state.streak == 0
                        && state.nextBackoffAt <= now) {
                    iterator.remove();
                }
            }
        }
    }

    private static final class WindowState {
        private final ArrayDeque<Long> timestamps = new ArrayDeque<>();
        private int streak;
        private long lastAdmissionAt = Long.MIN_VALUE;
        private long nextBackoffAt = Long.MIN_VALUE;

        private void purge(long now, long windowMillis) {
            while (!timestamps.isEmpty()
                    && saturatedAdd(timestamps.peekFirst(), windowMillis) <= now) {
                timestamps.removeFirst();
            }
        }

        private void expireStreakIfIdle(long now) {
            if (lastAdmissionAt != Long.MIN_VALUE
                    && elapsedAtLeast(now, lastAdmissionAt, STREAK_IDLE_MILLIS)) {
                streak = 0;
                lastAdmissionAt = Long.MIN_VALUE;
                nextBackoffAt = Long.MIN_VALUE;
            }
        }
    }

    private static int retryAfterSeconds(long now, long deadline) {
        long remaining = Math.max(1L, deadline - now);
        long seconds = Math.max(1L, (remaining + 999L) / 1000L);
        return (int) Math.min(Integer.MAX_VALUE, seconds);
    }

    private static long saturatedAdd(long left, long right) {
        if (right > 0 && left > Long.MAX_VALUE - right) {
            return Long.MAX_VALUE;
        }
        return left + right;
    }

    private static boolean elapsedAtLeast(long now, long then, long duration) {
        return now >= then && now - then >= duration;
    }
}
