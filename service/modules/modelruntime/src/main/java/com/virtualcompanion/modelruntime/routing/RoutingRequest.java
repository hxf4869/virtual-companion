package com.virtualcompanion.modelruntime.routing;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import java.util.Objects;

/**
 * Immutable input to {@link DeterministicRouter}.
 *
 * <p>The requested and execution authorization snapshot ids are required
 * whenever the entitlement's {@link ServiceClass} permits an external attempt;
 * the router fails closed (no external deployment eligible) when either is
 * absent. {@code zeroLlmSourceId} is required when ZERO_LLM fallback is allowed.
 * Both conditions are enforced by the router, not by construction, because they
 * depend on the runtime service-class policy.
 */
public record RoutingRequest(
        OwnershipTuple ownership,
        Entitlement entitlement,
        ModelProtocol requiredProtocol,
        ModelProtocolCapabilities requiredCapabilities,
        String requestedAuthorizationSnapshotId,
        String executionAuthorizationSnapshotId,
        String zeroLlmSourceId,
        long fence
) {

    public RoutingRequest {
        Objects.requireNonNull(ownership, "ownership must not be null");
        Objects.requireNonNull(entitlement, "entitlement must not be null");
        Objects.requireNonNull(requiredProtocol, "requiredProtocol must not be null");
        Objects.requireNonNull(requiredCapabilities, "requiredCapabilities must not be null");
        if (fence < 0) {
            throw new IllegalArgumentException("fence must not be negative");
        }
    }
}
