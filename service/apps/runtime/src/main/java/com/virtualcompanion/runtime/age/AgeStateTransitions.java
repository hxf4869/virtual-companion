package com.virtualcompanion.runtime.age;

import com.virtualcompanion.catalog.AgeState;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * AGE-MIN (FR-AUTH-002): the age-states catalog transition table, mirrored
 * from {@code specs/catalog/age-states.yaml} (the YAML is the authority; this
 * class mirrors it for runtime enforcement and is pinned by tests that read
 * the same table). A transition that is not listed is rejected — the age
 * state machine can never jump to an unapproved state (e.g. a MINOR or
 * suspended state cannot be overwritten by a direct ADULT_VERIFIED write).
 */
public final class AgeStateTransitions {

    private static final Map<AgeState, Set<AgeState>> TRANSITIONS = new EnumMap<>(AgeState.class);

    static {
        TRANSITIONS.put(AgeState.AGE_UNKNOWN, EnumSet.of(AgeState.ADULT_SELF_DECLARED));
        TRANSITIONS.put(
                AgeState.ADULT_SELF_DECLARED,
                EnumSet.of(AgeState.ADULT_VERIFICATION_REQUIRED));
        TRANSITIONS.put(
                AgeState.ADULT_VERIFICATION_REQUIRED,
                EnumSet.of(
                        AgeState.ADULT_VERIFIED,
                        AgeState.MINOR_VERIFIED,
                        AgeState.AGE_APPEAL_PENDING));
        TRANSITIONS.put(
                AgeState.ADULT_VERIFIED,
                EnumSet.of(AgeState.AGE_REVERIFY_REQUIRED, AgeState.MINOR_SUSPECTED));
        TRANSITIONS.put(
                AgeState.MINOR_SUSPECTED,
                EnumSet.of(
                        AgeState.ADULT_VERIFICATION_REQUIRED,
                        AgeState.MINOR_VERIFIED,
                        AgeState.AGE_APPEAL_PENDING));
        TRANSITIONS.put(
                AgeState.AGE_APPEAL_PENDING,
                EnumSet.of(
                        AgeState.ADULT_VERIFIED,
                        AgeState.MINOR_VERIFIED,
                        AgeState.AGE_ACCESS_SUSPENDED));
        TRANSITIONS.put(
                AgeState.AGE_REVERIFY_REQUIRED,
                EnumSet.of(
                        AgeState.ADULT_VERIFIED,
                        AgeState.MINOR_VERIFIED,
                        AgeState.AGE_ACCESS_SUSPENDED));
        // AGE_UNKNOWN..AGE_ACCESS_SUSPENDED covers all nine catalog codes; the
        // two remaining states (MINOR_VERIFIED, AGE_ACCESS_SUSPENDED) have no
        // outgoing transitions in the catalog.
    }

    private AgeStateTransitions() {
    }

    /** Whether {@code from -> to} is a catalog-approved transition. */
    public static boolean allows(AgeState from, AgeState to) {
        Set<AgeState> targets = TRANSITIONS.get(from);
        return targets != null && targets.contains(to);
    }
}
