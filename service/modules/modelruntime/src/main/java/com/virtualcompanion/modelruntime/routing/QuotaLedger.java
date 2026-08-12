package com.virtualcompanion.modelruntime.routing;

import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
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
 *
 * <p>Release is reservation-scoped and idempotent: each successful reservation
 * carries a unique {@code reservationId}, and a repeated release of the same
 * reservation is a no-op (it never restores units a second time). This keeps
 * the quota boundary fail-closed when a recovery path retries or re-enters
 * release for an already-released reservation — the per-owner ceiling cap
 * alone cannot distinguish which reservation a restore belongs to, so without
 * reservation-level idempotency a repeated release could incorrectly refund
 * units still held by another active reservation and re-open over-reservation.
 */
public final class QuotaLedger {

    private final ConcurrentHashMap<String, Long> remainingByOwner = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Long> ceilingByOwner = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Boolean> releasedReservations = new ConcurrentHashMap<>();
    private final AtomicLong reservationSequence = new AtomicLong();

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
        ceilingByOwner.put(ownerUserId, budget);
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
     * <p>Each successful reservation is assigned a ledger-unique
     * {@code reservationId} (a per-ledger sequence prefix plus the deterministic
     * hash of the reservation event). The sequence makes successive reservations
     * distinct within one ledger — so release can idempotently deduplicate a
     * repeated release by {@code reservationId} — while two fresh ledgers that
     * observe the same first reservation event still produce the same id.
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
            String reservationId = "qr-" + reservationSequence.incrementAndGet()
                    + "-" + DecisionHash.hex(ownerUserId + "|" + current + "|" + units);
            outcome.set(new QuotaReservation(reservationId, ownerUserId, units, after));
            return after;
        });
        return Optional.ofNullable(outcome.get());
    }

    /**
     * Release (restore) the units carried by a reservation back to its owner's
     * budget.
     *
     * <p>The release is reservation-scoped and idempotent: the check that decides
     * whether this reservation has already been released, the restore, and the
     * marking of the reservation as released all run atomically per owner (via
     * {@link ConcurrentHashMap#compute}), so a concurrent or repeated release of
     * the same reservation restores the units exactly once. A repeated release is
     * a no-op and returns the current remaining balance unchanged.
     *
     * <p>The restore is still capped at the provisioned ceiling, so an over-release
     * can never inflate the balance beyond what was ever provisioned. An owner
     * with no provisioned budget is left absent and the method returns {@code 0} —
     * release is a no-op for an owner with no budget, mirroring the fail-closed
     * symmetry of {@link #reserve}.
     *
     * @return the owner's remaining budget after the release, or {@code 0} when
     *         the owner has no provisioned budget
     * @throws NullPointerException if {@code reservation} is null
     */
    public long release(QuotaReservation reservation) {
        Objects.requireNonNull(reservation, "reservation must not be null");
        String ownerUserId = reservation.ownerUserId();
        long units = reservation.reservedUnits();
        String reservationId = reservation.reservationId();
        AtomicLong newRemaining = new AtomicLong();
        remainingByOwner.compute(ownerUserId, (key, current) -> {
            if (current == null) {
                newRemaining.set(0L);
                return null;
            }
            if (releasedReservations.containsKey(reservationId)) {
                newRemaining.set(current);
                return current;
            }
            Long ceiling = ceilingByOwner.get(key);
            if (ceiling == null) {
                newRemaining.set(0L);
                return null;
            }
            long after = Math.min(ceiling, current + units);
            releasedReservations.put(reservationId, Boolean.TRUE);
            newRemaining.set(after);
            return after;
        });
        return newRemaining.get();
    }
}
