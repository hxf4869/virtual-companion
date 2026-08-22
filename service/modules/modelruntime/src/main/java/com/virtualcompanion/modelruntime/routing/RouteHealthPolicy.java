package com.virtualcompanion.modelruntime.routing;

import com.virtualcompanion.modelruntime.registry.ProviderId;
import java.util.Optional;

/**
 * ROUTE-HARDEN (§12.12 / §12.8): the routing-level view of supplier health
 * and session-model stickiness, consumed by {@link DeterministicRouter}.
 *
 * <p>The router stays provider-neutral: it asks this policy whether a
 * candidate deployment is serviceable right now and which deployment a
 * conversation should stick to. Implementations live at the wiring layer
 * (e.g. backed by the {@code SupplierCircuitBreaker} and a process-local
 * affinity store) so the routing module never depends on breaker internals.
 *
 * <p>Selection contract implemented by the router:
 * <ol>
 *   <li>the conversation's sticky deployment when it is a matched candidate
 *       and {@link Health#HEALTHY} (§12.8 同部署偏好);</li>
 *   <li>otherwise the first {@link Health#HEALTHY} candidate in the
 *       deterministic sorted order (熔断状态接入路由决策 — OPEN circuits are
 *       skipped and traffic fails over at the turn boundary);</li>
 *   <li>otherwise the first {@link Health#PROBE_ONLY} candidate — cooldown
 *       elapsed, one half-open probe; exactly-one-probe is still enforced
 *       downstream by the worker's outbound gate;</li>
 *   <li>otherwise no external selection (ZERO_LLM fallback or
 *       NO_ELIGIBLE_DEPLOYMENT as before).</li>
 * </ol>
 */
public interface RouteHealthPolicy {

    /** Routing-relevant circuit state of one deployment. */
    enum Health {
        /** Circuit closed — fully serviceable. */
        HEALTHY,
        /** Circuit open but its cooldown has elapsed — only a half-open probe may pass. */
        PROBE_ONLY,
        /** Circuit open and inside its cooldown — routing must not select it. */
        BLOCKED
    }

    /**
     * Circuit state of the deployment's supplier. A deployment with no health
     * signal must report {@link Health#HEALTHY} (absence of evidence is never
     * treated as unhealthiness).
     */
    Health health(ProviderId providerId);

    /**
     * §12.8 会话模型粘滞: the deployment this conversation should keep using
     * (its last successful turn), or empty when unknown to this process.
     */
    Optional<ProviderId> stickyDeployment(String conversationId);

    /** Legacy policy: everything healthy, no stickiness — preserves the pre-ROUTE-HARD selection order. */
    static RouteHealthPolicy none() {
        return new RouteHealthPolicy() {
            @Override
            public Health health(ProviderId providerId) {
                return Health.HEALTHY;
            }

            @Override
            public Optional<ProviderId> stickyDeployment(String conversationId) {
                return Optional.empty();
            }
        };
    }
}
