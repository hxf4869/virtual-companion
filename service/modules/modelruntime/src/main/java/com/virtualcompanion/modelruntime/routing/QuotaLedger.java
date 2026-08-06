package com.virtualcompanion.modelruntime.routing;

import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

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
 */
public final class QuotaLedger {

    private final Map<String, Long> remainingByOwner = new HashMap<>();

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
     * insufficient; the ledger is left untouched in that case.
     *
     * @throws IllegalArgumentException if {@code units} is negative
     */
    public Optional<QuotaReservation> reserve(String ownerUserId, long units) {
        Objects.requireNonNull(ownerUserId, "ownerUserId must not be null");
        if (units < 0) {
            throw new IllegalArgumentException("units must not be negative");
        }
        Long current = remainingByOwner.get(ownerUserId);
        if (current == null || current < units) {
            return Optional.empty();
        }
        long after = current - units;
        remainingByOwner.put(ownerUserId, after);
        String reservationId = "qr-" + DecisionHash.hex(ownerUserId + "|" + current + "|" + units);
        return Optional.of(new QuotaReservation(reservationId, ownerUserId, units, after));
    }
}
