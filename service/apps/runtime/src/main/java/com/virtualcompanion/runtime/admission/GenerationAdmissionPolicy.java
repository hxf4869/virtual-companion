package com.virtualcompanion.runtime.admission;

import com.virtualcompanion.catalog.AgeState;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * S0-04: server-side atomic admission for a new generation. Frontend
 * next-step copy is not the security source. Any failed read of account,
 * age, consent or the service window is deny (fail-closed).
 *
 * <p>When {@code enforceAdultAndConsent} is false (Technical Alpha default,
 * Beta window off) the gate still refuses a disabled account, a closed
 * window, and read failures. Adult/consent/Beta-switch checks apply only
 * when enforcement is on; the required-consent set is configuration, never
 * guessed.
 */
public final class GenerationAdmissionPolicy {

    public static final String ACCOUNT_DISABLED = "account-disabled";
    public static final String ADMISSION_READ_FAILED = "admission-read-failed";
    public static final String BETA_GENERATION_DISABLED = "beta-generation-disabled";
    public static final String ADULT_VERIFICATION_REQUIRED = "adult-verification-required";
    public static final String REQUIRED_CONSENT_MISSING = "required-consent-missing";
    public static final String RELEASE_EVAL_BLOCKED = "release-eval-blocked";

    public record Facts(
            boolean readsSucceeded,
            boolean accountActive,
            boolean betaGenerationEnabled,
            boolean enforceAdultAndConsent,
            AgeState ageState,
            Set<String> grantedConsentTypes,
            Set<String> requiredConsentTypes,
            Optional<String> windowReject,
            boolean liveExpansionAllowed) {
        public Facts {
            grantedConsentTypes = grantedConsentTypes == null
                    ? Set.of() : Set.copyOf(grantedConsentTypes);
            requiredConsentTypes = requiredConsentTypes == null
                    ? Set.of() : Set.copyOf(requiredConsentTypes);
            windowReject = windowReject == null ? Optional.empty() : windowReject;
        }

        public Facts(
                boolean readsSucceeded,
                boolean accountActive,
                boolean betaGenerationEnabled,
                boolean enforceAdultAndConsent,
                AgeState ageState,
                Set<String> grantedConsentTypes,
                Set<String> requiredConsentTypes,
                Optional<String> windowReject) {
            this(
                    readsSucceeded,
                    accountActive,
                    betaGenerationEnabled,
                    enforceAdultAndConsent,
                    ageState,
                    grantedConsentTypes,
                    requiredConsentTypes,
                    windowReject,
                    true);
        }
    }

    public Optional<String> rejectReason(Facts facts) {
        Objects.requireNonNull(facts, "facts");
        if (!facts.readsSucceeded()) {
            return Optional.of(ADMISSION_READ_FAILED);
        }
        if (!facts.accountActive()) {
            return Optional.of(ACCOUNT_DISABLED);
        }
        if (facts.windowReject().isPresent()) {
            return facts.windowReject();
        }
        if (!facts.enforceAdultAndConsent()) {
            return Optional.empty();
        }
        if (!facts.betaGenerationEnabled()) {
            return Optional.of(BETA_GENERATION_DISABLED);
        }
        if (!facts.liveExpansionAllowed()) {
            return Optional.of(RELEASE_EVAL_BLOCKED);
        }
        if (facts.ageState() != AgeState.ADULT_VERIFIED) {
            return Optional.of(ADULT_VERIFICATION_REQUIRED);
        }
        if (!facts.grantedConsentTypes().containsAll(facts.requiredConsentTypes())) {
            return Optional.of(REQUIRED_CONSENT_MISSING);
        }
        return Optional.empty();
    }
}
