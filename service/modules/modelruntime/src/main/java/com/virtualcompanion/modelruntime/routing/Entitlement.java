package com.virtualcompanion.modelruntime.routing;

import java.util.Objects;

/**
 * Synthetic active entitlement snapshot for an owner.
 *
 * <p>Binds an owner to their active {@link ServiceClass}. This is a simulated
 * Technical Alpha entitlement; it is never derived from a real payment or
 * subscription, and payment status is never a prerequisite for routing
 * (INV-COST-001). Live quota capacity is tracked separately by the
 * {@link QuotaLedger}, which keeps the entitlement (what an owner is granted)
 * decoupled from quota consumption (what capacity remains).
 */
public record Entitlement(
        String ownerUserId,
        ServiceClass serviceClass
) {

    public Entitlement {
        Objects.requireNonNull(ownerUserId, "ownerUserId must not be null");
        if (ownerUserId.isBlank()) {
            throw new IllegalArgumentException("ownerUserId must not be blank");
        }
        Objects.requireNonNull(serviceClass, "serviceClass must not be null");
    }
}
