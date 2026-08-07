package com.virtualcompanion.modelruntime.routing;

import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * In-memory synthetic quota ledger, keyed by owner.
 *
 * <p>Owners must be provisioned before reservation. Reservation fails closed
 * (returns an empty {@link Optional}) when the owner is unknown or the remaining
 * budget is insufficient. The router treats an empty result as a routing
 * failure and degrades to ZERO_LLM or returns {@code NO_ELIGIBLE_DEPLOYMENT}
 * rather than over-reserving or carrying a negative balance.
 *
 * <p>This is a Technical Alpha simulation: there is no persistent ledger row and
 * no real cost. Each external attempt reserves one unit of synthetic capacity.
 * Reservation is atomic per owner (via {@link ConcurrentHashMap#compute}) so
 * concurrent reservations cannot double-reserve the same budget, matching the
 * fail-closed integrity of the sibling in-memory stores.
 */
public final class QuotaLedger {

    private final ConcurrentHashMap<String, Long> remainingByOwner = new ConcurrentHashMap<>();

    /**
     * Seed or refresh an owner's reservable budget.
     *
     * @throws NullPointerException     if {@code ownerUserId} is null
     * @throws IllegalArgumentException if {@code ownerUserId} is blank or {@code budget} is negative
     */
    public void provision(String ownerUserId, long budget) {
        Objects.requireNonNull(ownerUserId, "ownerUserId must not be null");
        if (ownerUserId.isBlank()) {
            throw new IllegalArgumentException("ownerUserId must not be blank");
        }
        if (budget < 0) {
            throw new IllegalArgumentException("budget must not be negative");
        }
        remainingByOwner.put(ownerUserId, budget);
    }

    /**
     * @return the remaining reservable budget for the owner, or {@code 0} when unknown
     */
    public long remaining(String ownerUserId) {
        Objects.requireNonNull(ownerUserId, "ownerUserId must not be null");
        return remainingByOwner.getOrDefault(ownerUserId, 0L);
    }

    /**
     * Reserve {@code units} against the owner's budget.
     *
     * <p>Returns empty when the owner is unknown or the remaining budget is
     * insufficient; the ledger is left untouched in that case. The check and the
     * decrement run atomically per owner, so concurrent reservations cannot
     * observe the same stale balance and over-reserve.
     *
     * @throws IllegalArgumentException if {@code units} is negative
     */
    public Optional<QuotaReservation> reserve(String ownerUserId, long units) {
        Objects.requireNonNull(ownerUserId, "ownerUserId must not be null");
        if (units < 0) {
            throw new IllegalArgumentException("units must not be negative");
        }
        AtomicReference<QuotaReservation> outcome = new AtomicReference<>();
        remainingByOwner.compute(ownerUserId, (key, current) -> {
            if (current == null || current < units) {
                return current;
            }
            long after = current - units;
            String reservationId = "qr-" + DecisionHash.hex(ownerUserId + "|" + current + "|" + units);
            outcome.set(new QuotaReservation(reservationId, ownerUserId, units, after));
            return after;
        });
        return Optional.ofNullable(outcome.get());
    }

    /**
     * Release (restore) {@code units} back to an owner's budget.
     *
     * <p>The restore is atomic per owner (via {@link ConcurrentHashMap#compute}). Unknown
     * owners are left absent and the method returns {@code 0} — release is a no-op for an
     * owner with no budget, mirroring the fail-closed symmetry of {@link #reserve}.
     *
     * @return the owner's remaining budget after the release, or {@code 0} when unknown
     * @throws IllegalArgumentException if {@code units} is negative
     */
    public long release(String ownerUserId, long units) {
        Objects.requireNonNull(ownerUserId, "ownerUserId must not be null");
        if (units < 0) {
            throw new IllegalArgumentException("units must not be negative");
        }
        if (units == 0) {
            return remainingByOwner.getOrDefault(ownerUserId, 0L);
        }
        java.util.concurrent.atomic.AtomicLong newRemaining = new java.util.concurrent.atomic.AtomicLong();
        remainingByOwner.compute(ownerUserId, (key, current) -> {
            if (current == null) {
                newRemaining.set(0L);
                return null;
            }
            long after = current + units;
            newRemaining.set(after);
            return after;
        });
        return newRemaining.get();
    }
}
