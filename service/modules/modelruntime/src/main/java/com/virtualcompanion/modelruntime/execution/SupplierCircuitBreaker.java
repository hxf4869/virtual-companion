package com.virtualcompanion.modelruntime.execution;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/**
 * ROUTE-HARDEN (§12.12): per-supplier circuit breaker for live model
 * deployments. Consecutive failures trip the breaker OPEN for a cooldown;
 * after the cooldown exactly one probe (half-open semantics) is allowed —
 * its success closes the circuit, its failure re-opens with a fresh
 * cooldown. Thread-safe; keyed by supplier name.
 *
 * <p>Integration contract: routing consults the read-only {@link #circuitOpen}
 * / {@link #blocked} views to skip or deprioritize an unhealthy supplier, and
 * the worker asks {@code allow(supplier)} immediately before the outbound and
 * reports {@code success(supplier)} / {@code failure(supplier)} at the
 * terminal. The gate (not routing) consumes the half-open probe token, so a
 * router read can never swallow a probe.
 */
public final class SupplierCircuitBreaker {

    private enum State {
        CLOSED,
        OPEN
    }

    private static final class Slot {
        final AtomicInteger consecutiveFailures = new AtomicInteger();
        final AtomicLong openedAtMillis = new AtomicLong(0);
        // Probe token for half-open: claimed by exactly one allow() call per
        // cooldown. Kept separate from openedAtMillis so the cooldown clock
        // never depends on the token state.
        final AtomicBoolean probing = new AtomicBoolean(false);
        volatile State state = State.CLOSED;
    }

    private final Map<String, Slot> slots = new ConcurrentHashMap<>();
    private final int failureThreshold;
    private final long cooldownMillis;
    /**
     * Observability hooks registered post-construction ({@link #onOpened}):
     * invoked at most once per CLOSED→OPEN trip with the supplier name. A
     * failed half-open probe re-opens without re-firing (the outage is already
     * known). Listeners must never throw — each call is guarded.
     */
    private final List<Consumer<String>> openedListeners = new CopyOnWriteArrayList<>();

    public SupplierCircuitBreaker(int failureThreshold, long cooldownMillis) {
        if (failureThreshold < 1) {
            throw new IllegalArgumentException("failureThreshold must be >= 1");
        }
        this.failureThreshold = failureThreshold;
        this.cooldownMillis = cooldownMillis;
    }

    /**
     * Register a CLOSED→OPEN trip listener (e.g. the alerting channel).
     * Registration is idempotent per listener instance; exceptions thrown by
     * the listener are swallowed so observability never breaks execution.
     */
    public void onOpened(Consumer<String> listener) {
        openedListeners.add(java.util.Objects.requireNonNull(listener, "listener must not be null"));
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
        return slot.probing.compareAndSet(false, true); // probe token
    }

    public void success(String supplier) {
        Slot slot = slot(supplier);
        slot.consecutiveFailures.set(0);
        slot.state = State.CLOSED;
        slot.openedAtMillis.set(0);
        slot.probing.set(false);
    }

    public void failure(String supplier) {
        Slot slot = slot(supplier);
        int n = slot.consecutiveFailures.incrementAndGet();
        if (n >= failureThreshold && slot.state != State.OPEN) {
            slot.state = State.OPEN;
            slot.openedAtMillis.set(System.currentTimeMillis());
            notifyOpened(supplier);
            return;
        }
        if (slot.state == State.OPEN) {
            // A failed half-open probe re-opens with a fresh cooldown and
            // releases the probe token so the next cooldown admits a new
            // probe instead of locking the breaker open forever.
            slot.openedAtMillis.set(System.currentTimeMillis());
            slot.probing.set(false);
        }
    }

    /**
     * Routing read view (§12.12): the circuit is OPEN — in cooldown or
     * waiting for a probe. Never mutates state and never consumes the probe
     * token, so routing may poll freely.
     */
    public boolean circuitOpen(String supplier) {
        Slot slot = slots.get(supplier);
        return slot != null && slot.state == State.OPEN;
    }

    /**
     * Routing read view (§12.12): the circuit is OPEN <em>and</em> still
     * inside its cooldown — no outbound may proceed for this supplier at all
     * ({@code allow} would refuse even a probe). {@code circuitOpen && !blocked}
     * marks the half-open probe window.
     */
    public boolean blocked(String supplier) {
        Slot slot = slots.get(supplier);
        if (slot == null || slot.state != State.OPEN) {
            return false;
        }
        return System.currentTimeMillis() - slot.openedAtMillis.get() < cooldownMillis;
    }

    /** S0-10C: at least one tracked supplier is OPEN inside cooldown. */
    public boolean anySupplierBlocked() {
        return slots.keySet().stream().anyMatch(this::blocked);
    }

    /** S0-10C: every tracked supplier is OPEN inside cooldown. Empty is false. */
    public boolean allTrackedSuppliersBlocked() {
        if (slots.isEmpty()) {
            return false;
        }
        return slots.keySet().stream().allMatch(this::blocked);
    }

    private void notifyOpened(String supplier) {
        for (Consumer<String> listener : openedListeners) {
            try {
                listener.accept(supplier);
            } catch (RuntimeException ignored) {
                // Observability must never break the execution path.
            }
        }
    }

    private Slot slot(String supplier) {
        return slots.computeIfAbsent(supplier, k -> new Slot());
    }
}
