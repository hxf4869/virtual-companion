package com.virtualcompanion.modelruntime.routing;

import java.util.Optional;

/**
 * Shared product-quota book (S0-11-C).
 *
 * <p>Tracks non-monetary synthetic units (call count / trial-like allowance),
 * never currency. {@link #reserve} is atomic per owner so concurrent callers
 * cannot oversell. {@link #release} restores a still-open reservation
 * idempotently; {@link #settle} consumes it so a later release is a no-op.
 * A durable implementation must survive process restart.
 */
public interface QuotaBook {

    Optional<QuotaReservation> reserve(String ownerUserId, long units);

    /**
     * Reserve against a specific generation so a durable ledger can bind the
     * row. The in-memory book ignores {@code generationId}.
     */
    default Optional<QuotaReservation> reserve(
            String ownerUserId, String generationId, long units) {
        return reserve(ownerUserId, units);
    }

    long release(QuotaReservation reservation);

    /**
     * Mark a reserved amount consumed. Default is a no-op: an in-memory book
     * already decremented remaining at reserve time.
     */
    default void settle(QuotaReservation reservation) {
        // in-memory remaining is already consumed
    }

    long remaining(String ownerUserId);
}
