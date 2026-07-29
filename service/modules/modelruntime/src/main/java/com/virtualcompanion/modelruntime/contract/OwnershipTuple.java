package com.virtualcompanion.modelruntime.contract;

/**
 * Immutable ownership established by an upstream trusted boundary.
 *
 * <p>This value carries ownership; it does not authenticate a client claim.</p>
 */
public record OwnershipTuple(
        String ownerUserId,
        String relationshipId,
        String conversationId,
        String generationId
) {

    public OwnershipTuple {
        ownerUserId = ContractChecks.requireNonBlank(ownerUserId, "ownerUserId");
        relationshipId = ContractChecks.requireNonBlank(relationshipId, "relationshipId");
        conversationId = ContractChecks.requireNonBlank(conversationId, "conversationId");
        generationId = ContractChecks.requireNonBlank(generationId, "generationId");
    }
}
