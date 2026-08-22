package com.virtualcompanion.modelruntime.routing;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.registry.ProviderDeployment;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistry;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * Provider-neutral deterministic router.
 *
 * <p>Given a {@link RoutingRequest}, the router selects an admitted registry
 * deployment that matches the requested protocol and capabilities, reserving
 * one unit of synthetic quota; or it deterministically degrades to the ZERO_LLM
 * deterministic source; or it returns {@code NO_ELIGIBLE_DEPLOYMENT}. The same
 * request against the same registry, quota and {@link RouteHealthPolicy} state
 * always yields the same selection, binding and {@code decisionNo}.
 *
 * <p>ROUTE-HARDEN (§12.12 / §12.8): when a {@link RouteHealthPolicy} is wired,
 * selection is health-aware — the conversation's sticky deployment is preferred
 * while healthy, circuit-OPEN suppliers are skipped in favor of healthy ones,
 * and a cooled-down OPEN supplier is only selected as the half-open probe when
 * no healthy candidate exists. Without a policy (or with
 * {@link RouteHealthPolicy#none()}) selection stays the legacy first-sorted
 * candidate.</p>
 *
 * <p>Routing never bypasses the {@link ProviderRegistry}: a selected deployment
 * is always a member of {@link ProviderRegistry#deployments()}. Routing never
 * bypasses the {@code ExecutionAuthorizationGuard}: an external attempt always
 * produces an {@link InvocationBinding.ExternalAttemptBinding} carrying both the
 * requested and execution authorization snapshot ids, which the guard authorizes
 * at execution time (INV-AUTH-001). The ZERO_LLM deterministic source produces a
 * {@link InvocationBinding.DeterministicSourceBinding} and creates no provider
 * attempt.
 */
public final class DeterministicRouter {

    /** Synthetic cost reserved for each external attempt. */
    static final long EXTERNAL_ATTEMPT_QUOTA_UNITS = 1L;

    private final ProviderRegistry registry;
    private final QuotaLedger quotaLedger;
    /** ROUTE-HARDEN: supplier-health + session-stickiness view; never null. */
    private final RouteHealthPolicy healthPolicy;

    public DeterministicRouter(ProviderRegistry registry, QuotaLedger quotaLedger) {
        this(registry, quotaLedger, RouteHealthPolicy.none());
    }

    public DeterministicRouter(
            ProviderRegistry registry,
            QuotaLedger quotaLedger,
            RouteHealthPolicy healthPolicy) {
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        this.quotaLedger = Objects.requireNonNull(quotaLedger, "quotaLedger must not be null");
        this.healthPolicy = Objects.requireNonNull(healthPolicy, "healthPolicy must not be null");
    }

    /**
     * Produce a deterministic {@link RouteDecision} for the request.
     */
    public RouteDecision decide(RoutingRequest request) {
        Objects.requireNonNull(request, "request must not be null");
        OwnershipTuple ownership = request.ownership();
        ServiceClass serviceClass = request.entitlement().serviceClass();

        List<ProviderId> considered = serviceClass.externalAttemptAllowed()
                ? matchedExternalCandidates(request)
                : List.of();

        RouteDecision external = tryExternal(request, ownership, serviceClass, considered);
        if (external != null) {
            return external;
        }

        if (serviceClass.zeroLlmFallbackAllowed() && hasZeroLlmSource(request)) {
            InvocationBinding binding = new InvocationBinding.DeterministicSourceBinding(
                    ownership, request.zeroLlmSourceId(), request.fence());
            return RouteDecision.selected(
                    ownership, serviceClass.code(), null, binding, null, considered);
        }

        return RouteDecision.noEligible(ownership, serviceClass.code(), considered);
    }

    private RouteDecision tryExternal(
            RoutingRequest request,
            OwnershipTuple ownership,
            ServiceClass serviceClass,
            List<ProviderId> considered
    ) {
        if (!serviceClass.externalAttemptAllowed()
                || considered.isEmpty()
                || !hasAuthorizationSnapshots(request)) {
            return null;
        }
        ProviderId selected = select(considered, request.ownership().conversationId());
        if (selected == null) {
            // ROUTE-HARDEN: every candidate is circuit-blocked — no external
            // attempt this turn; fall through to ZERO_LLM / no-eligible.
            return null;
        }
        Optional<QuotaReservation> reservation = quotaLedger.reserve(
                request.entitlement().ownerUserId(), EXTERNAL_ATTEMPT_QUOTA_UNITS);
        if (reservation.isEmpty()) {
            return null;
        }
        InvocationBinding binding = externalAttemptBinding(request, ownership, selected);
        return RouteDecision.selected(
                ownership,
                serviceClass.code(),
                selected,
                binding,
                reservation.orElseThrow(),
                considered);
    }

    /**
     * ROUTE-HARDEN (§12.12 / §12.8) health-aware selection over the
     * deterministic sorted candidates:
     * <ol>
     *   <li>the conversation's sticky deployment while it is HEALTHY (同部署
     *       偏好 — persona/voice stability across turns);</li>
     *   <li>the first HEALTHY candidate in sorted order (OPEN circuits are
     *       skipped; failover happens at this turn boundary);</li>
     *   <li>the first PROBE_ONLY candidate (cooldown elapsed — the turn acts
     *       as the half-open probe; exactly-one-probe stays enforced by the
     *       worker's outbound gate);</li>
     *   <li>{@code null} when every candidate is BLOCKED.</li>
     * </ol>
     */
    private ProviderId select(List<ProviderId> candidates, String conversationId) {
        Optional<ProviderId> sticky = healthPolicy.stickyDeployment(conversationId)
                .filter(candidates::contains);
        if (sticky.isPresent() && healthPolicy.health(sticky.get()) == RouteHealthPolicy.Health.HEALTHY) {
            return sticky.get();
        }
        for (RouteHealthPolicy.Health tier :
                List.of(RouteHealthPolicy.Health.HEALTHY, RouteHealthPolicy.Health.PROBE_ONLY)) {
            for (ProviderId candidate : candidates) {
                if (healthPolicy.health(candidate) == tier) {
                    return candidate;
                }
            }
        }
        return null;
    }

    private List<ProviderId> matchedExternalCandidates(RoutingRequest request) {
        ModelProtocol protocol = request.requiredProtocol();
        ModelProtocolCapabilities required = request.requiredCapabilities();
        return registry.deployments().stream()
                .filter(ProviderDeployment::isAdmitted)
                .filter(deployment -> deployment.protocol() == protocol)
                .filter(deployment -> supportsAll(deployment, required))
                .map(ProviderDeployment::providerId)
                .sorted(Comparator.comparing(ProviderId::value))
                .toList();
    }

    private static boolean supportsAll(ProviderDeployment deployment, ModelProtocolCapabilities required) {
        for (ModelProtocolCapabilities.Capability capability : required.values()) {
            if (!deployment.capabilities().supports(capability)) {
                return false;
            }
        }
        return true;
    }

    private static boolean hasAuthorizationSnapshots(RoutingRequest request) {
        return isNonBlank(request.requestedAuthorizationSnapshotId())
                && isNonBlank(request.executionAuthorizationSnapshotId());
    }

    private static boolean hasZeroLlmSource(RoutingRequest request) {
        return isNonBlank(request.zeroLlmSourceId());
    }

    private static boolean isNonBlank(String value) {
        return value != null && !value.isBlank();
    }

    private static InvocationBinding.ExternalAttemptBinding externalAttemptBinding(
            RoutingRequest request,
            OwnershipTuple ownership,
            ProviderId selected
    ) {
        String providerAttemptId = "pa-" + DecisionHash.hex(
                ownership.ownerUserId()
                        + "|" + ownership.relationshipId()
                        + "|" + ownership.conversationId()
                        + "|" + ownership.generationId()
                        + "|" + selected.value()
                        + "|" + request.fence());
        return new InvocationBinding.ExternalAttemptBinding(
                ownership,
                providerAttemptId,
                request.fence(),
                request.requestedAuthorizationSnapshotId(),
                request.executionAuthorizationSnapshotId());
    }
}
