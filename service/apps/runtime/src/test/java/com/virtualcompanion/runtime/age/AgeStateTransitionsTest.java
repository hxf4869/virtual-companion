package com.virtualcompanion.runtime.age;

import static org.assertj.core.api.Assertions.assertThat;

import com.virtualcompanion.catalog.AgeState;
import org.junit.jupiter.api.Test;

/**
 * Pins {@link AgeStateTransitions} to the age-states catalog transition
 * table ({@code specs/catalog/age-states.yaml} is the authority; any drift in
 * either direction fails here). Every catalog transition must be allowed and
 * every non-listed pair must be rejected.
 */
class AgeStateTransitionsTest {

    @Test
    void mirrorsEveryCatalogTransition() {
        assertThat(AgeStateTransitions.allows(AgeState.AGE_UNKNOWN, AgeState.ADULT_SELF_DECLARED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(
                        AgeState.ADULT_SELF_DECLARED, AgeState.ADULT_VERIFICATION_REQUIRED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(
                        AgeState.ADULT_VERIFICATION_REQUIRED, AgeState.ADULT_VERIFIED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(
                        AgeState.ADULT_VERIFICATION_REQUIRED, AgeState.MINOR_VERIFIED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(
                        AgeState.ADULT_VERIFICATION_REQUIRED, AgeState.AGE_APPEAL_PENDING))
                .isTrue();
        assertThat(AgeStateTransitions.allows(
                        AgeState.ADULT_VERIFIED, AgeState.AGE_REVERIFY_REQUIRED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(AgeState.ADULT_VERIFIED, AgeState.MINOR_SUSPECTED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(
                        AgeState.MINOR_SUSPECTED, AgeState.ADULT_VERIFICATION_REQUIRED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(AgeState.MINOR_SUSPECTED, AgeState.MINOR_VERIFIED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(
                        AgeState.MINOR_SUSPECTED, AgeState.AGE_APPEAL_PENDING))
                .isTrue();
        assertThat(AgeStateTransitions.allows(AgeState.AGE_APPEAL_PENDING, AgeState.ADULT_VERIFIED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(AgeState.AGE_APPEAL_PENDING, AgeState.MINOR_VERIFIED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(
                        AgeState.AGE_APPEAL_PENDING, AgeState.AGE_REVERIFY_REQUIRED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(
                        AgeState.AGE_APPEAL_PENDING, AgeState.AGE_ACCESS_SUSPENDED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(
                        AgeState.AGE_REVERIFY_REQUIRED, AgeState.ADULT_VERIFIED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(
                        AgeState.AGE_REVERIFY_REQUIRED, AgeState.MINOR_VERIFIED))
                .isTrue();
        assertThat(AgeStateTransitions.allows(
                        AgeState.AGE_REVERIFY_REQUIRED, AgeState.AGE_ACCESS_SUSPENDED))
                .isTrue();
    }

    @Test
    void rejectsEveryUnlistedJump() {
        // The state machine can never jump to ADULT_VERIFIED from states the
        // catalog does not allow (minor / appeal / suspended), nor skip the
        // declaration step from AGE_UNKNOWN, nor self-loop.
        assertThat(AgeStateTransitions.allows(AgeState.AGE_UNKNOWN, AgeState.ADULT_VERIFIED))
                .isFalse();
        assertThat(AgeStateTransitions.allows(
                        AgeState.AGE_UNKNOWN, AgeState.ADULT_VERIFICATION_REQUIRED))
                .isFalse();
        assertThat(AgeStateTransitions.allows(
                        AgeState.MINOR_SUSPECTED, AgeState.ADULT_VERIFIED))
                .isFalse();
        assertThat(AgeStateTransitions.allows(AgeState.MINOR_VERIFIED, AgeState.ADULT_VERIFIED))
                .isFalse();
        assertThat(AgeStateTransitions.allows(
                        AgeState.AGE_APPEAL_PENDING, AgeState.ADULT_SELF_DECLARED))
                .isFalse();
        assertThat(AgeStateTransitions.allows(
                        AgeState.AGE_ACCESS_SUSPENDED, AgeState.ADULT_VERIFIED))
                .isFalse();
        assertThat(AgeStateTransitions.allows(AgeState.ADULT_VERIFIED, AgeState.ADULT_VERIFIED))
                .isFalse();
        assertThat(AgeStateTransitions.allows(AgeState.AGE_UNKNOWN, AgeState.AGE_UNKNOWN))
                .isFalse();
    }
}
