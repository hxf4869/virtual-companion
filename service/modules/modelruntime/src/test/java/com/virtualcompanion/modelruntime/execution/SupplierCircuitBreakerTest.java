package com.virtualcompanion.modelruntime.execution;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/**
 * ROUTE-HARDEN: consecutive failures trip OPEN; the cooldown admits exactly
 * one half-open probe; success closes, failure re-opens.
 */
class SupplierCircuitBreakerTest {

    @Test
    void tripsAfterConsecutiveFailuresAndRecoversAfterCooldown() {
        MutableClock clock = new MutableClock();
        SupplierCircuitBreaker breaker = new SupplierCircuitBreaker(3, 1, clock);

        assertTrue(breaker.allow("sup-a"));
        breaker.failure("sup-a");
        breaker.failure("sup-a");
        assertTrue(breaker.allow("sup-a"));
        breaker.failure("sup-a"); // third consecutive failure trips

        assertFalse(breaker.allow("sup-a"));

        clock.advanceMillis(1); // cooldown elapses -> one half-open probe admitted
        assertTrue(breaker.allow("sup-a"));
        assertFalse(breaker.allow("sup-a")); // only one probe

        breaker.success("sup-a"); // probe succeeded -> closed again
        assertTrue(breaker.allow("sup-a"));
    }

    @Test
    void successResetsTheFailureCount() {
        SupplierCircuitBreaker breaker = new SupplierCircuitBreaker(3, 60_000);
        breaker.failure("s");
        breaker.failure("s");
        breaker.success("s");
        breaker.failure("s");
        breaker.failure("s");
        assertTrue(breaker.allow("s")); // only 2 consecutive since reset
    }

    @Test
    void suppliersAreIsolated() {
        SupplierCircuitBreaker breaker = new SupplierCircuitBreaker(1, 60_000);
        breaker.failure("a");
        assertFalse(breaker.allow("a"));
        assertTrue(breaker.allow("b"));
    }

    @Test
    void failedHalfOpenProbeReOpens() {
        MutableClock clock = new MutableClock();
        SupplierCircuitBreaker breaker = new SupplierCircuitBreaker(1, 1, clock);
        breaker.failure("x");
        assertFalse(breaker.allow("x"));
        clock.advanceMillis(1);
        assertTrue(breaker.allow("x"));   // half-open probe
        breaker.failure("x");             // probe failed -> re-open
        assertFalse(breaker.allow("x"));  // still open until next cooldown
        clock.advanceMillis(1);
        // The failed probe must re-open with a FRESH cooldown: after it
        // elapses, a new probe is admitted (regression: the old probe-token
        // overflow locked the breaker open until process restart).
        assertTrue(breaker.allow("x"));
        assertFalse(breaker.allow("x"));  // still exactly one probe
    }

    // ---- ROUTE-HARDEN: routing read views + open listener ----

    @Test
    void routingViewsDistinguishBlockedFromProbeWindow() {
        MutableClock clock = new MutableClock();
        SupplierCircuitBreaker breaker = new SupplierCircuitBreaker(2, 150, clock);

        // Closed: healthy on both views.
        assertFalse(breaker.circuitOpen("s"));
        assertFalse(breaker.blocked("s"));

        // Tripped OPEN inside the cooldown: blocked for routing entirely.
        breaker.failure("s");
        breaker.failure("s");
        assertTrue(breaker.circuitOpen("s"));
        assertTrue(breaker.blocked("s"));

        // Cooldown elapsed: still OPEN, but the half-open probe window —
        // routing may select it as a last resort; the gate admits one probe.
        clock.advanceMillis(150);
        assertTrue(breaker.circuitOpen("s"));
        assertFalse(breaker.blocked("s"));
        assertTrue(breaker.allow("s"));

        // Probe succeeded: fully closed again.
        breaker.success("s");
        assertFalse(breaker.circuitOpen("s"));
        assertFalse(breaker.blocked("s"));
    }

    @Test
    void unknownSupplierIsHealthyOnBothViews() {
        SupplierCircuitBreaker breaker = new SupplierCircuitBreaker(3, 60_000);
        assertFalse(breaker.circuitOpen("never-seen"));
        assertFalse(breaker.blocked("never-seen"));
    }

    @Test
    void openListenerFiresOncePerTripAndNeverOnProbeReOpen() {
        java.util.List<String> opened = new java.util.ArrayList<>();
        MutableClock clock = new MutableClock();
        SupplierCircuitBreaker breaker = new SupplierCircuitBreaker(2, 1, clock);
        breaker.onOpened(opened::add);

        breaker.failure("a");
        breaker.failure("a");                 // first trip CLOSED -> OPEN
        assertEquals(java.util.List.of("a"), opened);
        breaker.failure("a");                 // already OPEN: no new event
        breaker.failure("a");
        assertEquals(java.util.List.of("a"), opened);

        clock.advanceMillis(1);
        assertTrue(breaker.allow("a"));       // take the half-open probe
        breaker.failure("a");                 // probe failed -> re-open silently
        assertEquals(java.util.List.of("a"), opened);

        clock.advanceMillis(1);
        assertTrue(breaker.allow("a"));
        breaker.success("a");                 // closed again

        breaker.failure("a");
        breaker.failure("a");                 // second trip fires again
        assertEquals(java.util.List.of("a", "a"), opened);
    }

    @Test
    void throwingListenerDoesNotBreakFailureRecording() {
        SupplierCircuitBreaker breaker = new SupplierCircuitBreaker(1, 60_000);
        breaker.onOpened(s -> { throw new IllegalStateException("webhook down"); });
        breaker.failure("boom");              // listener throws; must be swallowed
        assertFalse(breaker.allow("boom"));   // breaker still tripped OPEN
        assertTrue(breaker.blocked("boom"));
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

        private void advanceMillis(long value) {
            millis.addAndGet(value);
        }
    }
}
