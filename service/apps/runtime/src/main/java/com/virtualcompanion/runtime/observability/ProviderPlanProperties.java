package com.virtualcompanion.runtime.observability;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * DOGFOOD-05 (ADR-0006 §3.2/§3.3): the private, applicability-windowed
 * provider plan quota configuration.
 *
 * <p>The plan (name, caps, validity window) lives only in machine-local
 * private runtime configuration — never in the repository, Catalog or UI
 * hard-coded values. Fields are deliberately {@code String}s: the yaml bridge
 * maps every {@code VC_PROVIDER_PLAN_*} variable through an empty-default
 * placeholder (empty strings fail to bind as LocalDate/Long), and a malformed
 * private date must surface as an UNKNOWN status at evaluation time instead
 * of failing startup. {@link ProviderPlanMonitor} parses and derives the
 * typed {@link ProviderPlanStatus}; a missing cap stays absent — it is NEVER
 * read as a zero budget and never rendered as a zero cost or a fabricated
 * remaining allowance.</p>
 *
 * <p>Environment binding follows the {@code VC_PROVIDER_PLAN_*} names
 * (resolved through the application.yaml placeholders). Values are
 * operator-supplied plan facts, not credentials.</p>
 *
 * @param enabled    plan monitoring switch (default false; the derived status
 *                   is then DISABLED — distinct from UNKNOWN)
 * @param planName   operator-facing plan label (may be blank)
 * @param validFrom  first day the plan applies (ISO-8601, inclusive)
 * @param validUntil last day the plan applies (ISO-8601, inclusive)
 * @param tokenCap   stated plan token cap (numeric), or null when unstated
 * @param requestCap stated plan request cap (numeric), or null when unstated
 */
@ConfigurationProperties("virtual-companion.provider-plan")
public record ProviderPlanProperties(
        @DefaultValue("false") boolean enabled,
        @DefaultValue("") String planName,
        @DefaultValue("") String validFrom,
        @DefaultValue("") String validUntil,
        @DefaultValue("") String tokenCap,
        @DefaultValue("") String requestCap) {

    public ProviderPlanProperties {
        planName = blankToNull(planName);
        validFrom = blankToNull(validFrom);
        validUntil = blankToNull(validUntil);
        tokenCap = blankToNull(tokenCap);
        requestCap = blankToNull(requestCap);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
