package com.virtualcompanion.modelruntime.execution;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * ROUTE-HARDEN: consecutive failures trip OPEN; the cooldown admits exactly
 * one half-open probe; success closes, failure re-opens.
 */
class SupplierCircuitBreakerTest {

    @Test
    void tripsAfterConsecutiveFailuresAndRecoversAfterCooldown() throws Exception {
        // 1ms cooldown so the probe window opens almost immediately.
        SupplierCircuitBreaker breaker = new SupplierCircuitBreaker(3, 1);

        assertTrue(breaker.allow("sup-a"));
        breaker.failure("sup-a");
        breaker.failure("sup-a");
        assertTrue(breaker.allow("sup-a"));
        breaker.failure("sup-a"); // third consecutive failure trips

        assertFalse(breaker.allow("sup-a"));

        Thread.sleep(5); // cooldown elapses -> one half-open probe admitted
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
    void failedHalfOpenProbeReOpens() throws Exception {
        SupplierCircuitBreaker breaker = new SupplierCircuitBreaker(1, 1);
        breaker.failure("x");
        assertFalse(breaker.allow("x"));
        Thread.sleep(5);
        assertTrue(breaker.allow("x"));   // half-open probe
        breaker.failure("x");             // probe failed -> re-open
        assertFalse(breaker.allow("x"));  // still open until next cooldown
    }
}
