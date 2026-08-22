package com.virtualcompanion.runtime.admission;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.AgeState;
import com.virtualcompanion.runtime.admission.GenerationAdmissionPolicy.Facts;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * S0-04: the shipped admission policy is the security source for new
 * generations. Reads fail closed; adult/consent apply only when enforced;
 * required consents come from configuration and are never invented.
 */
class GenerationAdmissionPolicyTest {

    private final GenerationAdmissionPolicy policy = new GenerationAdmissionPolicy();

    private static Facts alphaOk() {
        return new Facts(
                true, true, false, false, AgeState.AGE_UNKNOWN,
                Set.of(), Set.of(), Optional.empty());
    }

    @Test
    void alphaAllowsWhenAccountActiveAndWindowOpen() {
        assertTrue(policy.rejectReason(alphaOk()).isEmpty());
    }

    @Test
    void readFailureFailsClosedBeforeAnyOtherReason() {
        Facts facts = new Facts(
                false, true, true, true, AgeState.ADULT_VERIFIED,
                Set.of("SERVICE_TERMS"), Set.of("SERVICE_TERMS"), Optional.empty());
        assertEquals(
                Optional.of(GenerationAdmissionPolicy.ADMISSION_READ_FAILED),
                policy.rejectReason(facts));
    }

    @Test
    void disabledAccountIsRefused() {
        Facts facts = new Facts(
                true, false, false, false, AgeState.AGE_UNKNOWN,
                Set.of(), Set.of(), Optional.empty());
        assertEquals(
                Optional.of(GenerationAdmissionPolicy.ACCOUNT_DISABLED),
                policy.rejectReason(facts));
    }

    @Test
    void windowRejectIsHonored() {
        Facts facts = new Facts(
                true, true, false, false, AgeState.AGE_UNKNOWN,
                Set.of(), Set.of(), Optional.of("outside-generation-window"));
        assertEquals(Optional.of("outside-generation-window"), policy.rejectReason(facts));
    }

    @Test
    void enforceRequiresAdultVerifiedAndDoesNotTreatUnknownAsAdult() {
        Facts facts = new Facts(
                true, true, true, true, AgeState.AGE_UNKNOWN,
                Set.of(), Set.of(), Optional.empty());
        assertEquals(
                Optional.of(GenerationAdmissionPolicy.ADULT_VERIFICATION_REQUIRED),
                policy.rejectReason(facts));
        Facts appeal = new Facts(
                true, true, true, true, AgeState.AGE_APPEAL_PENDING,
                Set.of(), Set.of(), Optional.empty());
        assertEquals(
                Optional.of(GenerationAdmissionPolicy.ADULT_VERIFICATION_REQUIRED),
                policy.rejectReason(appeal));
    }

    @Test
    void enforceRequiresConfiguredConsentsAndEmptyConfigMeansNone() {
        Facts missing = new Facts(
                true, true, true, true, AgeState.ADULT_VERIFIED,
                Set.of("SERVICE_TERMS"), Set.of("SERVICE_TERMS", "PRIVACY_POLICY"),
                Optional.empty());
        assertEquals(
                Optional.of(GenerationAdmissionPolicy.REQUIRED_CONSENT_MISSING),
                policy.rejectReason(missing));
        Facts noneRequired = new Facts(
                true, true, true, true, AgeState.ADULT_VERIFIED,
                Set.of(), Set.of(), Optional.empty());
        assertTrue(policy.rejectReason(noneRequired).isEmpty());
    }

    @Test
    void enforceRequiresBetaGenerationSwitch() {
        Facts facts = new Facts(
                true, true, false, true, AgeState.ADULT_VERIFIED,
                Set.of(), Set.of(), Optional.empty());
        assertEquals(
                Optional.of(GenerationAdmissionPolicy.BETA_GENERATION_DISABLED),
                policy.rejectReason(facts));
    }
}
