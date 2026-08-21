package com.virtualcompanion.modelruntime.execution;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * ROUTE-HARDEN (§12.12): per-supplier circuit breaker for live model
 * deployments. Consecutive failures trip the breaker OPEN for a cooldown;
 * after the cooldown exactly one probe (half-open semantics) is allowed —
 * its success closes the circuit, its failure re-opens with a fresh
 * cooldown. Thread-safe; keyed by supplier name.
 *
 * <p>Integration contract: the caller asks {@code allow(supplier)} before
 * resolving/outbound and reports {@code success(supplier)} /
 * {@code failure(supplier)} at the terminal.
 */
public final class SupplierCircuitBreaker {

    private enum State {
        CLOSED,
        OPEN
    }

    private static final class Slot {
        final AtomicInteger consecutiveFailures = new AtomicInteger();
        final AtomicLong openedAtMillis = new AtomicLong(0);
        volatile State state = State.CLOSED;
    }

    private final Map<String, Slot> slots = new ConcurrentHashMap<>();
    private final int failureThreshold;
    private final long cooldownMillis;

    public SupplierCircuitBreaker(int failureThreshold, long cooldownMillis) {
        if (failureThreshold < 1) {
            throw new IllegalArgumentException("failureThreshold must be >= 1");
        }
        this.failureThreshold = failureThreshold;
        this.cooldownMillis = cooldownMillis;
    }

    /** Whether an outbound to this supplier may proceed right now. */
    public boolean allow(String supplier) {
        Slot slot = slots.get(supplier);
        if (slot == null || slot.state == State.CLOSED) {
            return true;
        }
        // OPEN: allow exactly one probe once the cooldown has elapsed
        // (half-open). A second concurrent probe loses the CAS and waits.
        long openedAt = slot.openedAtMillis.get();
        boolean cooledDown = System.currentTimeMillis() - openedAt >= cooldownMillis;
        if (!cooledDown) {
            return false;
        }
        return slot.openedAtMillis.compareAndSet(openedAt, Long.MIN_VALUE); // probe token
    }

    public void success(String supplier) {
        Slot slot = slot(supplier);
        slot.consecutiveFailures.set(0);
        slot.state = State.CLOSED;
        slot.openedAtMillis.set(0);
    }

    public void failure(String supplier) {
        Slot slot = slot(supplier);
        int n = slot.consecutiveFailures.incrementAndGet();
        if (n >= failureThreshold && slot.state != State.OPEN) {
            slot.state = State.OPEN;
            slot.openedAtMillis.set(System.currentTimeMillis());
        }
    }

    private Slot slot(String supplier) {
        return slots.computeIfAbsent(supplier, k -> new Slot());
    }
}
