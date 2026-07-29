package com.virtualcompanion.modelruntime.contract;

import java.util.Set;

/**
 * Capabilities explicitly claimed by an adapter.
 */
public record ModelProtocolCapabilities(Set<Capability> values) {

    public ModelProtocolCapabilities {
        ContractChecks.requireNonNull(values, "values");
        values = Set.copyOf(values);
    }

    public boolean supports(Capability capability) {
        return values.contains(ContractChecks.requireNonNull(capability, "capability"));
    }

    public enum Capability {
        STREAMING,
        STRUCTURED_OUTPUT
    }
}
