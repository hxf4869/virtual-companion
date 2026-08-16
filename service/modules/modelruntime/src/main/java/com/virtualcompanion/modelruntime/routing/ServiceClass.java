package com.virtualcompanion.modelruntime.routing;

import java.util.Objects;

/**
 * Provider-neutral service tier governing routing and degradation policy.
 *
 * <p>A {@code ServiceClass} expresses only <em>policy</em>: whether an external
 * registry deployment may be selected and whether the ZERO_LLM deterministic
 * source may serve as a degradation fallback. It never names a model, vendor,
 * provider id, protocol or capability set; concrete deployments are discovered
 * from the {@link com.virtualcompanion.modelruntime.registry.ProviderRegistry}
 * and matched against the per-request protocol and capabilities.
 *
 * <p>This keeps entitlement decoupled from any specific model so that service
 * tier changes never require a deployment or contract change.
 */
public record ServiceClass(
        String code,
        boolean externalAttemptAllowed,
        boolean zeroLlmFallbackAllowed
) {

    public ServiceClass {
        Objects.requireNonNull(code, "code must not be null");
        if (code.isBlank()) {
            throw new IllegalArgumentException("code must not be blank");
        }
    }

    /**
     * Technical Alpha default tier. Simulated external attempts are allowed and
     * the ZERO_LLM fallback is allowed.
     */
    public static ServiceClass simulated() {
        return new ServiceClass("SIMULATED", true, true);
    }

    /**
     * ENT-SNAP (A3-001): the ECONOMY tier assigned by an admin to test
     * accounts. External attempts allowed with the ZERO_LLM fallback; the
     * class drives routing policy and audit, never a concrete model.
     */
    public static ServiceClass economy() {
        return new ServiceClass("ECONOMY", true, true);
    }

    /**
     * ENT-SNAP (A3-001): the PREMIUM tier assigned by an admin to test
     * accounts. Same routing policy as ECONOMY in Technical Alpha (one real
     * deployment); the class exists for audit and future policy divergence.
     */
    public static ServiceClass premium() {
        return new ServiceClass("PREMIUM", true, true);
    }

    /** ENT-SNAP: resolve a stored class code to its policy (unknown -> disabled). */
    public static ServiceClass fromCode(String code) {
        return switch (code == null ? "" : code) {
            case "ECONOMY" -> economy();
            case "PREMIUM" -> premium();
            case "SIMULATED" -> simulated();
            default -> disabled();
        };
    }

    /**
     * Degraded tier. Only the ZERO_LLM deterministic source is reachable; an
     * external attempt is never selected even when eligible deployments exist.
     */
    public static ServiceClass zeroLlmOnly() {
        return new ServiceClass("ZERO_LLM_ONLY", false, true);
    }

    /**
     * Fully restricted tier. No external attempt and no ZERO_LLM fallback; the
     * router always returns {@code NO_ELIGIBLE_DEPLOYMENT}.
     */
    public static ServiceClass disabled() {
        return new ServiceClass("DISABLED", false, false);
    }
}
