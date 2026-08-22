package com.virtualcompanion.modelruntime.routing;

import com.virtualcompanion.catalog.RouteDecisionStatus;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * Immutable deterministic routing decision.
 *
 * <p>The {@code decisionNo} is a tamper-evident SHA-256 audit number derived
 * from the decision's own structural fields: status, ownership, service-class
 * code, the selected target (provider id, or {@code ZERO_LLM}, or {@code NONE}),
 * and the binding's execution id and fence. Two decisions with identical
 * content therefore share the same decisionNo, and constructing a
 * {@code RouteDecision} with a non-matching decisionNo fails closed.
 *
 * <p>{@code consideredCandidates} and {@link RouteAudit} exist for audit only
 * and do not feed the {@code decisionNo}. Together they reconstruct why a
 * deployment was selected, why the router degraded, and which service class
 * the owner was entitled to versus what was actually used.
 */
public record RouteDecision(
        String decisionNo,
        RouteDecisionStatus status,
        OwnershipTuple ownership,
        String serviceClassCode,
        ProviderId selectedProviderId,
        InvocationBinding binding,
        QuotaReservation quotaReservation,
        List<ProviderId> consideredCandidates,
        RouteAudit audit
) {

    public RouteDecision {
        Objects.requireNonNull(decisionNo, "decisionNo must not be null");
        Objects.requireNonNull(status, "status must not be null");
        Objects.requireNonNull(ownership, "ownership must not be null");
        Objects.requireNonNull(serviceClassCode, "serviceClassCode must not be null");
        Objects.requireNonNull(consideredCandidates, "consideredCandidates must not be null");
        consideredCandidates = List.copyOf(consideredCandidates);
        Objects.requireNonNull(audit, "audit must not be null");
        if (status == RouteDecisionStatus.SELECTED) {
            Objects.requireNonNull(binding, "binding must not be null for SELECTED");
        }
        String derived = computeDecisionNo(status, ownership, serviceClassCode, selectedProviderId, binding);
        if (!decisionNo.equals(derived)) {
            throw new IllegalArgumentException(
                    "decisionNo must equal its canonical derivation; got "
                            + decisionNo + ", expected " + derived);
        }
    }

    /**
     * Selected-decision factory. Exactly one of {@code selectedProviderId}
     * (external attempt) and the ZERO_LLM marker (deterministic source) applies,
     * distinguished by the binding type.
     */
    public static RouteDecision selected(
            OwnershipTuple ownership,
            String serviceClassCode,
            ProviderId selectedProviderId,
            InvocationBinding binding,
            QuotaReservation quotaReservation,
            List<ProviderId> consideredCandidates
    ) {
        return selected(
                ownership,
                serviceClassCode,
                selectedProviderId,
                binding,
                quotaReservation,
                consideredCandidates,
                selectedProviderId != null
                        ? RouteAudit.selectedExternal(serviceClassCode)
                        : RouteAudit.zeroLlmFallback(
                                serviceClassCode, RouteAudit.SELECTED_ZERO_LLM_FALLBACK));
    }

    public static RouteDecision selected(
            OwnershipTuple ownership,
            String serviceClassCode,
            ProviderId selectedProviderId,
            InvocationBinding binding,
            QuotaReservation quotaReservation,
            List<ProviderId> consideredCandidates,
            RouteAudit audit
    ) {
        String decisionNo = computeDecisionNo(
                RouteDecisionStatus.SELECTED, ownership, serviceClassCode, selectedProviderId, binding);
        return new RouteDecision(
                decisionNo,
                RouteDecisionStatus.SELECTED,
                ownership,
                serviceClassCode,
                selectedProviderId,
                binding,
                quotaReservation,
                consideredCandidates,
                audit);
    }

    /**
     * No-eligible-deployment factory. No binding, no provider, no reservation.
     */
    public static RouteDecision noEligible(
            OwnershipTuple ownership,
            String serviceClassCode,
            List<ProviderId> consideredCandidates
    ) {
        return noEligible(
                ownership,
                serviceClassCode,
                consideredCandidates,
                RouteAudit.none(serviceClassCode, RouteAudit.NO_ELIGIBLE_DEPLOYMENT));
    }

    public static RouteDecision noEligible(
            OwnershipTuple ownership,
            String serviceClassCode,
            List<ProviderId> consideredCandidates,
            RouteAudit audit
    ) {
        String decisionNo = computeDecisionNo(
                RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT,
                ownership,
                serviceClassCode,
                null,
                null);
        return new RouteDecision(
                decisionNo,
                RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT,
                ownership,
                serviceClassCode,
                null,
                null,
                null,
                consideredCandidates,
                audit);
    }

    public Optional<ProviderId> selectedProviderIdOptional() {
        return Optional.ofNullable(selectedProviderId);
    }

    public Optional<InvocationBinding> bindingOptional() {
        return Optional.ofNullable(binding);
    }

    public Optional<QuotaReservation> quotaReservationOptional() {
        return Optional.ofNullable(quotaReservation);
    }

    static String computeDecisionNo(
            RouteDecisionStatus status,
            OwnershipTuple ownership,
            String serviceClassCode,
            ProviderId selectedProviderId,
            InvocationBinding binding
    ) {
        String target;
        if (selectedProviderId != null) {
            target = selectedProviderId.value();
        } else if (binding != null) {
            target = "ZERO_LLM";
        } else {
            target = "NONE";
        }
        String executionId = binding != null ? binding.executionId() : "";
        long fence = binding != null ? binding.fence() : 0L;
        String canonical = status.code()
                + "|" + ownership.ownerUserId()
                + "|" + ownership.relationshipId()
                + "|" + ownership.conversationId()
                + "|" + ownership.generationId()
                + "|" + serviceClassCode
                + "|" + target
                + "|" + executionId
                + "|" + fence;
        return "rd-" + DecisionHash.hex(canonical);
    }
}
