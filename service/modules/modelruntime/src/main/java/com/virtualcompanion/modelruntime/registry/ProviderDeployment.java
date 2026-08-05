package com.virtualcompanion.modelruntime.registry;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import java.util.Objects;

/**
 * Immutable snapshot of a provider deployment's identity, protocol,
 * capabilities and admission state at a point in time.
 * <p>
 * The record is a value object: copies returned by the registry are
 * independent of internal mutable state. Callers must never receive a
 * live reference that could change beneath them.
 */
public record ProviderDeployment(
        ProviderId providerId,
        ModelProtocol protocol,
        ModelProtocolCapabilities capabilities,
        AdmissionStatus admissionStatus) {

    public ProviderDeployment {
        Objects.requireNonNull(providerId, "providerId must not be null");
        Objects.requireNonNull(protocol, "protocol must not be null");
        Objects.requireNonNull(capabilities, "capabilities must not be null");
        Objects.requireNonNull(admissionStatus, "admissionStatus must not be null");
    }

    public boolean isAdmitted() {
        return admissionStatus == AdmissionStatus.ADMITTED;
    }
}
