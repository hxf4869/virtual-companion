package com.virtualcompanion.runtime.auth.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard.AdmissionLease;
import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard.Route;
import com.virtualcompanion.runtime.auth.web.AuthRateLimitException;
import java.lang.reflect.Field;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class AuthAbuseGuardTest {

    private static final byte[] TEST_KEY = new byte[32];

    @Test
    void sourceWindowsAreExactAndRouteIsolated() {
        MutableClock clock = new MutableClock();
        AuthAbuseGuard guard = guard(clock);

        for (int i = 0; i < AuthAbuseGuard.LOGIN_SOURCE_LIMIT; i++) {
            try (AdmissionLease ignored = guard.admitSource(Route.LOGIN, "192.0.2.1")) {
                // Release immediately; the rolling admission remains consumed.
            }
        }
        assertRejected(guard, Route.LOGIN, "192.0.2.1", 60);

        for (int i = 0; i < AuthAbuseGuard.REFRESH_SOURCE_LIMIT; i++) {
            try (AdmissionLease ignored = guard.admitSource(Route.REFRESH, "192.0.2.1")) {
                // The refresh scope is independent from login.
            }
        }
        assertRejected(guard, Route.REFRESH, "192.0.2.1", 60);

        clock.advanceSeconds(60);
        try (AdmissionLease ignored = guard.admitSource(Route.LOGIN, "192.0.2.1")) {
            assertThat(guard.availablePermits()).isEqualTo(7);
        }
    }

    @Test
    void progressiveBackoffUsesEveryFrozenStepAndExpiresAfterIdle() {
        MutableClock clock = new MutableClock();
        AuthAbuseGuard guard = guard(clock);
        int[] expected = {1, 2, 4, 8, 16, 60};

        for (int retryAfter : expected) {
            guard.admitLogin("192.0.2.2", " Alice ");
            assertThatThrownBy(() -> guard.admitLogin("192.0.2.2", "alice"))
                    .isInstanceOfSatisfying(AuthRateLimitException.class,
                            e -> assertThat(e.retryAfterSeconds()).isEqualTo(retryAfter));
            // Keep the streak alive while allowing the 15-minute rolling entry to expire.
            clock.advanceSeconds(900);
        }

        clock.advanceSeconds(1800);
        guard.admitLogin("192.0.2.2", "alice");
        assertThatThrownBy(() -> guard.admitLogin("192.0.2.2", "alice"))
                .isInstanceOfSatisfying(AuthRateLimitException.class,
                        e -> assertThat(e.retryAfterSeconds()).isEqualTo(1));
    }

    @Test
    void loginCanonicalizationAndSourceRemainPartOfTheSamePrivateKey() {
        MutableClock clock = new MutableClock();
        AuthAbuseGuard guard = guard(clock);

        guard.admitLogin("192.0.2.3", " Alice ");
        assertThatThrownBy(() -> guard.admitLogin("192.0.2.3", "alice"))
                .isInstanceOf(AuthRateLimitException.class);

        guard.admitLogin("192.0.2.4", "ALICE");
        assertThat(guard.loginKeyStateSize()).isEqualTo(2);
    }

    @Test
    void inputWindowsEnforceExactFiveAndRetryAfterUsesTheLaterRelease() {
        MutableClock loginClock = new MutableClock();
        AuthAbuseGuard loginGuard = guard(loginClock);
        admitLoginFiveTimes(loginGuard, loginClock);
        loginClock.advanceSeconds(16);
        assertThatThrownBy(() -> loginGuard.admitLogin("192.0.2.40", "alice"))
                .isInstanceOfSatisfying(AuthRateLimitException.class,
                        e -> assertThat(e.retryAfterSeconds()).isEqualTo(869));
        loginClock.advanceSeconds(869);
        loginGuard.admitLogin("192.0.2.40", "alice");

        MutableClock refreshClock = new MutableClock();
        AuthAbuseGuard refreshGuard = guard(refreshClock);
        admitRefreshFiveTimes(refreshGuard, refreshClock);
        refreshClock.advanceSeconds(16);
        assertThatThrownBy(() -> refreshGuard.admitRefresh("token"))
                .isInstanceOfSatisfying(AuthRateLimitException.class,
                        e -> assertThat(e.retryAfterSeconds()).isEqualTo(29));
        refreshClock.advanceSeconds(29);
        refreshGuard.admitRefresh("token");
    }

    @Test
    void refreshFenceSkipsInvalidTokensAndTokenScopesAreIndependent() {
        MutableClock clock = new MutableClock();
        AuthAbuseGuard guard = guard(clock);
        String exactUtf8 = "\uD83D\uDE00".repeat(128);

        guard.admitRefresh(null);
        guard.admitRefresh(" ");
        guard.admitRefresh("x".repeat(513));
        guard.admitRefresh(exactUtf8 + "a");
        assertThat(guard.refreshKeyStateSize()).isZero();

        guard.admitRefresh(exactUtf8);
        guard.admitRefresh("token-a");
        assertThatThrownBy(() -> guard.admitRefresh("token-a"))
                .isInstanceOfSatisfying(AuthRateLimitException.class,
                        e -> assertThat(e.retryAfterSeconds()).isEqualTo(1));
        guard.admitRefresh("token-b");
        assertThat(guard.refreshKeyStateSize()).isEqualTo(3);
    }

    @Test
    void activeStateIsNeverEvictedAndScopesReclaimOnlyExpiredEntries() {
        MutableClock clock = new MutableClock();
        AuthAbuseGuard guard = new AuthAbuseGuard(clock, TEST_KEY, 1, 1, 1, 8);

        guard.admitLogin("192.0.2.5", "alice");
        assertThatThrownBy(() -> guard.admitLogin("192.0.2.5", "bob"))
                .isInstanceOfSatisfying(AuthRateLimitException.class,
                        e -> assertThat(e.retryAfterSeconds()).isEqualTo(60));
        assertThatThrownBy(() -> guard.admitLogin("192.0.2.5", "alice"))
                .isInstanceOf(AuthRateLimitException.class);

        guard.admitRefresh("token-a");
        assertThat(guard.loginKeyStateSize()).isEqualTo(1);
        assertThat(guard.refreshKeyStateSize()).isEqualTo(1);

        clock.advanceSeconds(1800);
        guard.admitLogin("192.0.2.5", "bob");
        guard.admitRefresh("token-b");
        assertThat(guard.loginKeyStateSize()).isEqualTo(1);
        assertThat(guard.refreshKeyStateSize()).isEqualTo(1);
    }

    @Test
    void sourceCapacityFailsClosedWithoutCrossRouteEviction() {
        MutableClock clock = new MutableClock();
        AuthAbuseGuard guard = new AuthAbuseGuard(clock, TEST_KEY, 1, 1, 1, 8);
        try (AdmissionLease ignored = guard.admitSource(Route.LOGIN, "192.0.2.50")) {
            // Keep only the rolling state after the lease is released.
        }
        assertRejected(guard, Route.LOGIN, "192.0.2.51", 60);
        try (AdmissionLease ignored = guard.admitSource(Route.REFRESH, "192.0.2.51")) {
            assertThat(guard.stateSize(Route.REFRESH)).isEqualTo(1);
        }

        clock.advanceSeconds(60);
        try (AdmissionLease ignored = guard.admitSource(Route.LOGIN, "192.0.2.51")) {
            assertThat(guard.stateSize(Route.LOGIN)).isEqualTo(1);
        }
    }

    @Test
    void everyHeapVisibleMapKeyIsOnlyAFixedLengthHmacDigest() throws Exception {
        MutableClock clock = new MutableClock();
        AuthAbuseGuard guard = guard(clock);
        try (AdmissionLease ignored = guard.admitSource(Route.LOGIN, "192.0.2.60")) {
            // Source state remains after release.
        }
        guard.admitLogin("192.0.2.60", "Alice");
        guard.admitRefresh("raw-refresh-token");

        Collection<String> keys = stateKeys(guard);
        assertThat(keys).hasSize(3).allMatch(key -> key.matches("[0-9a-f]{64}"));
        assertThat(keys).allSatisfy(key -> assertThat(key)
                .doesNotContain("192.0.2.60", "alice", "Alice", "raw-refresh-token"));
    }

    @Test
    void malformedUtf16CannotAliasAValidDigestKeyAcrossAnyHmacInput() {
        MutableClock clock = new MutableClock();
        AuthAbuseGuard guard = guard(clock);
        for (String malformed : List.of(
                String.valueOf((char) 0xd800),
                String.valueOf((char) 0xdc00))) {
            assertThatThrownBy(() -> guard.admitSource(Route.LOGIN, malformed))
                    .isInstanceOfSatisfying(AuthRateLimitException.class,
                            e -> assertThat(e.retryAfterSeconds()).isEqualTo(60));
            assertThatThrownBy(() -> guard.admitLogin("192.0.2.61", malformed))
                    .isInstanceOfSatisfying(AuthRateLimitException.class,
                            e -> assertThat(e.retryAfterSeconds()).isEqualTo(60));
            assertThatThrownBy(() -> guard.admitRefresh(malformed))
                    .isInstanceOfSatisfying(AuthRateLimitException.class,
                            e -> assertThat(e.retryAfterSeconds()).isEqualTo(60));
        }
        assertThat(guard.availablePermits()).isEqualTo(8);
        assertThat(guard.stateSize(Route.LOGIN)).isZero();
        assertThat(guard.loginKeyStateSize()).isZero();
        assertThat(guard.refreshKeyStateSize()).isZero();

        String replacement = String.valueOf((char) 0xfffd);
        try (AdmissionLease ignored = guard.admitSource(Route.LOGIN, replacement)) {
            // A valid replacement character remains a distinct, admissible input.
        }
        guard.admitLogin("192.0.2.61", replacement);
        guard.admitRefresh(replacement);
        assertThat(guard.stateSize(Route.LOGIN)).isEqualTo(1);
        assertThat(guard.loginKeyStateSize()).isEqualTo(1);
        assertThat(guard.refreshKeyStateSize()).isEqualTo(1);
    }

    @Test
    void clockRollbackCannotBypassBackoff() {
        MutableClock clock = new MutableClock();
        clock.setMillis(10_000);
        AuthAbuseGuard guard = guard(clock);

        guard.admitLogin("192.0.2.6", "alice");
        clock.setMillis(1_000);

        assertThatThrownBy(() -> guard.admitLogin("192.0.2.6", "alice"))
                .isInstanceOfSatisfying(AuthRateLimitException.class,
                        e -> assertThat(e.retryAfterSeconds()).isEqualTo(1));
    }

    @Test
    void retryAfterRoundsFractionalSecondsUpToAPositiveInteger() {
        MutableClock clock = new MutableClock();
        AuthAbuseGuard guard = guard(clock);
        guard.admitLogin("192.0.2.7", "alice");
        clock.setMillis(1000);
        guard.admitLogin("192.0.2.7", "alice");
        clock.setMillis(1001);

        assertThatThrownBy(() -> guard.admitLogin("192.0.2.7", "alice"))
                .isInstanceOfSatisfying(AuthRateLimitException.class,
                        e -> assertThat(e.retryAfterSeconds()).isEqualTo(2));
    }

    @Test
    void bulkheadNeverWaitsAndReleasesExactlyOnce() {
        MutableClock clock = new MutableClock();
        AuthAbuseGuard guard = new AuthAbuseGuard(clock, TEST_KEY, 16, 16, 16, 4);
        List<AdmissionLease> leases = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            leases.add(guard.admitSource(Route.LOGIN, "192.0.2." + (10 + i)));
        }

        assertRejected(guard, Route.LOGIN, "192.0.2.99", 1);
        leases.get(0).close();
        leases.get(0).close();
        try (AdmissionLease ignored = guard.admitSource(Route.LOGIN, "192.0.2.99")) {
            assertThat(guard.availablePermits()).isZero();
        }
        leases.stream().skip(1).forEach(AdmissionLease::close);
        assertThat(guard.availablePermits()).isEqualTo(4);
    }

    @Test
    void concurrentAdmissionsNeverExceedTheFrozenSourceBudget() throws Exception {
        MutableClock clock = new MutableClock();
        AuthAbuseGuard guard = new AuthAbuseGuard(clock, TEST_KEY, 32, 32, 32, 32);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<AdmissionOutcome>> futures = new ArrayList<>();
        List<AdmissionOutcome> outcomes = new ArrayList<>();

        try (var executor = Executors.newFixedThreadPool(25)) {
            for (int i = 0; i < 25; i++) {
                futures.add(executor.submit(() -> {
                    start.await();
                    return attemptSourceAdmission(guard);
                }));
            }
            start.countDown();
            for (Future<AdmissionOutcome> future : futures) {
                outcomes.add(future.get());
            }
        }

        long contentionCount = outcomes.stream()
                .filter(outcome -> outcome == AdmissionOutcome.CONTENTION_REJECTED)
                .count();
        for (int i = 0; i < contentionCount; i++) {
            AdmissionOutcome outcome = attemptSourceAdmission(guard);
            if (outcome == AdmissionOutcome.CONTENTION_REJECTED) {
                throw new AssertionError("sequential admission unexpectedly observed contention");
            }
            outcomes.add(outcome);
        }

        assertThat(outcomes.stream()
                        .filter(outcome -> outcome == AdmissionOutcome.ADMITTED)
                        .count())
                .isEqualTo(AuthAbuseGuard.LOGIN_SOURCE_LIMIT);
        assertThat(outcomes.stream()
                        .filter(outcome -> outcome == AdmissionOutcome.BUDGET_REJECTED)
                        .count())
                .isEqualTo(25 - AuthAbuseGuard.LOGIN_SOURCE_LIMIT);
    }

    private static AdmissionOutcome attemptSourceAdmission(AuthAbuseGuard guard) {
        try (AdmissionLease ignored = guard.admitSource(Route.LOGIN, "192.0.2.200")) {
            return AdmissionOutcome.ADMITTED;
        } catch (AuthRateLimitException e) {
            if (e.retryAfterSeconds() == 1) {
                return AdmissionOutcome.CONTENTION_REJECTED;
            }
            if (e.retryAfterSeconds() == 60) {
                return AdmissionOutcome.BUDGET_REJECTED;
            }
            throw new AssertionError("unexpected retry-after", e);
        }
    }

    private enum AdmissionOutcome {
        ADMITTED,
        CONTENTION_REJECTED,
        BUDGET_REJECTED
    }

    private static AuthAbuseGuard guard(MutableClock clock) {
        return new AuthAbuseGuard(clock, TEST_KEY, 32, 32, 32, 8);
    }

    private static void admitLoginFiveTimes(AuthAbuseGuard guard, MutableClock clock) {
        int[] advances = {0, 1, 2, 4, 8};
        for (int advance : advances) {
            clock.advanceSeconds(advance);
            guard.admitLogin("192.0.2.40", "alice");
        }
    }

    private static void admitRefreshFiveTimes(AuthAbuseGuard guard, MutableClock clock) {
        int[] advances = {0, 1, 2, 4, 8};
        for (int advance : advances) {
            clock.advanceSeconds(advance);
            guard.admitRefresh("token");
        }
    }

    @SuppressWarnings("unchecked")
    private static Collection<String> stateKeys(AuthAbuseGuard guard) throws Exception {
        Map<String, String> keys = new HashMap<>();
        for (String fieldName : List.of("loginSources", "refreshSources", "loginKeys", "refreshKeys")) {
            Field scopeField = AuthAbuseGuard.class.getDeclaredField(fieldName);
            scopeField.setAccessible(true);
            Object scope = scopeField.get(guard);
            Field statesField = scope.getClass().getDeclaredField("states");
            statesField.setAccessible(true);
            ((Map<String, ?>) statesField.get(scope)).keySet().forEach(key -> keys.put(key, key));
        }
        return keys.keySet();
    }

    private static void assertRejected(
            AuthAbuseGuard guard, Route route, String source, int retryAfterSeconds) {
        assertThatThrownBy(() -> guard.admitSource(route, source))
                .isInstanceOfSatisfying(AuthRateLimitException.class,
                        e -> assertThat(e.retryAfterSeconds()).isEqualTo(retryAfterSeconds));
    }

    private static final class MutableClock extends Clock {
        private final AtomicLong millis = new AtomicLong();

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return Instant.ofEpochMilli(millis.get());
        }

        @Override
        public long millis() {
            return millis.get();
        }

        private void advanceSeconds(long seconds) {
            millis.addAndGet(seconds * 1000L);
        }

        private void setMillis(long value) {
            millis.set(value);
        }
    }
}
