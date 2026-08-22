package com.virtualcompanion.runtime.modelproviders;

import com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.routing.RouteHealthPolicy;
import com.virtualcompanion.modelruntime.routing.SessionDeploymentAffinity;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * ROUTE-HARDEN (§12.12 / §12.8) wiring: the shared supplier circuit breaker,
 * the session-deployment affinity store and the routing health policy that
 * feeds both into {@code DeterministicRouter}.
 *
 * <p>Deliberately unconditional: the generation worker consumes the breaker
 * regardless of whether live providers are enabled (with providers off, no
 * external attempt ever reaches it — the beans simply stay idle). The breaker
 * and the affinity store must be singletons so routing sees exactly what the
 * worker records.
 *
 * <p>This configuration must stay observability-free (Modulith slice rule:
 * {@code servicemode → modelproviders} and {@code observability → servicemode}
 * already exist, so a {@code modelproviders → observability} edge would close
 * a cycle). The CLOSED→OPEN alert hook is therefore registered from the
 * observability slice ({@code CircuitOpenAlerter}) against this bean.
 */
@Configuration
public class RouteHealthConfig {

    /** Per-supplier breaker keyed by configured supplier name. */
    @Bean
    SupplierCircuitBreaker supplierCircuitBreaker(
            @Value("${virtual-companion.model-providers.circuit-failure-threshold:5}")
            int circuitFailureThreshold,
            @Value("${virtual-companion.model-providers.circuit-cooldown-millis:60000}")
            long circuitCooldownMillis) {
        return new SupplierCircuitBreaker(circuitFailureThreshold, circuitCooldownMillis);
    }

    /** §12.8 会话模型粘滞: process-local conversation → deployment memory. */
    @Bean
    SessionDeploymentAffinity sessionDeploymentAffinity() {
        return new SessionDeploymentAffinity();
    }

    /**
     * Routing view over the breaker + affinity store. Supplier names come from
     * the approved-provider wiring when live providers are enabled; with them
     * absent every deployment reports HEALTHY (no signal is never treated as
     * unhealthiness) and only stickiness remains active.
     */
    @Bean
    RouteHealthPolicy routeHealthPolicy(
            SupplierCircuitBreaker circuitBreaker,
            SessionDeploymentAffinity deploymentAffinity,
            ObjectProvider<ApprovedModelProviders> approvedModelProviders) {
        Supplier<Map<ProviderId, String>> supplierNames = () -> {
            ApprovedModelProviders providers = approvedModelProviders.getIfAvailable();
            return providers == null ? Map.of() : providers.supplierNames();
        };
        return new CircuitBreakerRouteHealthPolicy(
                circuitBreaker, supplierNames, deploymentAffinity);
    }
}
