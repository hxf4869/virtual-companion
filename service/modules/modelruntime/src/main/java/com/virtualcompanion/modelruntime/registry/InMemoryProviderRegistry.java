package com.virtualcompanion.modelruntime.registry;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities.Capability;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Thread-safe in-memory {@link ProviderRegistry} implementation.
 * <p>
 * Every mutating operation fails-closed on invalid state: duplicate
 * registrations, disabling unknown providers, and lookups that find no
 * matching admitted deployment all surface explicit errors or empty
 * results rather than silent defaults.
 */
public final class InMemoryProviderRegistry implements ProviderRegistry {

    private final Map<ProviderId, ProviderDeployment> deployments = new ConcurrentHashMap<>();

    @Override
    public ProviderDeployment register(ProviderRegistration registration) {
        Objects.requireNonNull(registration, "registration must not be null");
        ProviderDeployment admitted = new ProviderDeployment(
                registration.providerId(),
                registration.protocol(),
                registration.capabilities(),
                AdmissionStatus.ADMITTED);
        ProviderDeployment existing = deployments.putIfAbsent(registration.providerId(), admitted);
        if (existing != null) {
            throw new IllegalStateException(
                    "provider " + registration.providerId() + " is already registered");
        }
        return admitted;
    }

    @Override
    public ProviderDeployment disable(ProviderId providerId) {
        Objects.requireNonNull(providerId, "providerId must not be null");
        ProviderDeployment current = deployments.get(providerId);
        if (current == null) {
            throw new IllegalStateException("provider " + providerId + " is not registered");
        }
        ProviderDeployment disabled = new ProviderDeployment(
                current.providerId(),
                current.protocol(),
                current.capabilities(),
                AdmissionStatus.DISABLED);
        deployments.put(providerId, disabled);
        return disabled;
    }

    @Override
    public Optional<ProviderDeployment> findAdmitted(
            ModelProtocol protocol,
            ModelProtocolCapabilities required) {
        Objects.requireNonNull(protocol, "protocol must not be null");
        Objects.requireNonNull(required, "required must not be null");
        return deployments.values().stream()
                .filter(ProviderDeployment::isAdmitted)
                .filter(deployment -> deployment.protocol() == protocol)
                .filter(deployment -> supportsAll(deployment.capabilities(), required))
                .findFirst();
    }

    @Override
    public List<ProviderDeployment> deployments() {
        return List.copyOf(deployments.values());
    }

    private static boolean supportsAll(
            ModelProtocolCapabilities available,
            ModelProtocolCapabilities required) {
        for (Capability capability : required.values()) {
            if (!available.supports(capability)) {
                return false;
            }
        }
        return true;
    }
}
