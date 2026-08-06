package com.virtualcompanion.modelruntime.routing;

import java.util.Objects;

/**
 * Immutable result of reserving quota against an owner's entitlement.
 *
 * <p>The {@code reservationId} is a deterministic function of the reservation
 * event (owner, pre-reservation remaining, reserved units) so the same event
 * always yields the same auditable id. It is recomputable from this record's
 * own fields: {@code pre-reservation remaining == remainingUnits + reservedUnits}.
 */
public record QuotaReservation(
        String reservationId,
        String ownerUserId,
        long reservedUnits,
        long remainingUnits
) {

    public QuotaReservation {
        Objects.requireNonNull(reservationId, "reservationId must not be null");
        if (reservationId.isBlank()) {
            throw new IllegalArgumentException("reservationId must not be blank");
        }
        Objects.requireNonNull(ownerUserId, "ownerUserId must not be null");
        if (ownerUserId.isBlank()) {
            throw new IllegalArgumentException("ownerUserId must not be blank");
        }
        if (reservedUnits < 0) {
            throw new IllegalArgumentException("reservedUnits must not be negative");
        }
        if (remainingUnits < 0) {
            throw new IllegalArgumentException("remainingUnits must not be negative");
        }
    }
}
