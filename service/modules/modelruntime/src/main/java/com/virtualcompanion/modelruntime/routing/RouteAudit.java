package com.virtualcompanion.modelruntime.routing;

import java.util.Objects;

/**
 * Immutable audit payload for a {@link RouteDecision} (S0-11-B).
 *
 * <p>Explains why a deployment was selected, why the router degraded to
 * ZERO_LLM, or why no eligible deployment remained. These fields are not
 * part of {@code decisionNo}; they exist so an operator can reconstruct the
 * decision without replaying live registry or quota state.
 */
public record RouteAudit(
        String policyVersion,
        String entitledServiceClass,
        String actualServiceClass,
        String outcomeReason
) {

    /** Frozen deterministic-router policy identity recorded on every decision. */
    public static final String POLICY_VERSION = "deterministic-router-v1";

    public static final String ACTUAL_ZERO_LLM = "ZERO_LLM_ONLY";
    public static final String ACTUAL_NONE = "NONE";

    public static final String SELECTED_EXTERNAL = "SELECTED_EXTERNAL";
    public static final String SELECTED_ZERO_LLM_FALLBACK = "SELECTED_ZERO_LLM_FALLBACK";
    public static final String SERVICE_CLASS_FORBIDS_EXTERNAL = "SERVICE_CLASS_FORBIDS_EXTERNAL";
    public static final String NO_ADMITTED_CANDIDATE = "NO_ADMITTED_CANDIDATE";
    public static final String MISSING_AUTHORIZATION_SNAPSHOTS = "MISSING_AUTHORIZATION_SNAPSHOTS";
    public static final String ALL_CANDIDATES_CIRCUIT_BLOCKED = "ALL_CANDIDATES_CIRCUIT_BLOCKED";
    public static final String QUOTA_EXHAUSTED = "QUOTA_EXHAUSTED";
    public static final String NO_ELIGIBLE_DEPLOYMENT = "NO_ELIGIBLE_DEPLOYMENT";

    public RouteAudit {
        Objects.requireNonNull(policyVersion, "policyVersion must not be null");
        if (policyVersion.isBlank()) {
            throw new IllegalArgumentException("policyVersion must not be blank");
        }
        Objects.requireNonNull(entitledServiceClass, "entitledServiceClass must not be null");
        if (entitledServiceClass.isBlank()) {
            throw new IllegalArgumentException("entitledServiceClass must not be blank");
        }
        Objects.requireNonNull(actualServiceClass, "actualServiceClass must not be null");
        if (actualServiceClass.isBlank()) {
            throw new IllegalArgumentException("actualServiceClass must not be blank");
        }
        Objects.requireNonNull(outcomeReason, "outcomeReason must not be null");
        if (outcomeReason.isBlank()) {
            throw new IllegalArgumentException("outcomeReason must not be blank");
        }
    }

    public static RouteAudit selectedExternal(String entitledServiceClass) {
        return new RouteAudit(
                POLICY_VERSION, entitledServiceClass, entitledServiceClass, SELECTED_EXTERNAL);
    }

    public static RouteAudit zeroLlmFallback(String entitledServiceClass, String declineReason) {
        return new RouteAudit(
                POLICY_VERSION, entitledServiceClass, ACTUAL_ZERO_LLM, declineReason);
    }

    public static RouteAudit none(String entitledServiceClass, String declineReason) {
        return new RouteAudit(
                POLICY_VERSION, entitledServiceClass, ACTUAL_NONE, declineReason);
    }
}
