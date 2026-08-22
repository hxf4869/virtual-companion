package com.virtualcompanion.runtime.modelproviders;

import com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.routing.RouteHealthPolicy;
import com.virtualcompanion.modelruntime.routing.SessionDeploymentAffinity;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * ROUTE-HARDEN adapter translating the supplier breaker's read views into the
 * routing-level {@link RouteHealthPolicy}, plus the §12.8 session-stickiness
 * lookup. Deployments without a configured supplier name (e.g. registry
 * entries of a disabled runtime) report HEALTHY — absence of a health signal
 * must never make routing more pessimistic than the legacy behavior.
 */
final class CircuitBreakerRouteHealthPolicy implements RouteHealthPolicy {

    private final SupplierCircuitBreaker circuitBreaker;
    private final Supplier<Map<ProviderId, String>> supplierNames;
    private final SessionDeploymentAffinity deploymentAffinity;

    CircuitBreakerRouteHealthPolicy(
            SupplierCircuitBreaker circuitBreaker,
            Supplier<Map<ProviderId, String>> supplierNames,
            SessionDeploymentAffinity deploymentAffinity) {
        this.circuitBreaker = Objects.requireNonNull(circuitBreaker, "circuitBreaker must not be null");
        this.supplierNames = Objects.requireNonNull(supplierNames, "supplierNames must not be null");
        this.deploymentAffinity = Objects.requireNonNull(
                deploymentAffinity, "deploymentAffinity must not be null");
    }

    @Override
    public Health health(ProviderId providerId) {
        String supplier = supplierNames.get().get(providerId);
        if (supplier == null || supplier.isBlank()) {
            return Health.HEALTHY; // no live mapping → no health signal
        }
        if (circuitBreaker.blocked(supplier)) {
            return Health.BLOCKED; // OPEN, inside cooldown — routing must skip
        }
        if (circuitBreaker.circuitOpen(supplier)) {
            return Health.PROBE_ONLY; // OPEN, cooldown elapsed — half-open window
        }
        return Health.HEALTHY;
    }

    @Override
    public Optional<ProviderId> stickyDeployment(String conversationId) {
        return deploymentAffinity.sticky(conversationId);
    }
}
