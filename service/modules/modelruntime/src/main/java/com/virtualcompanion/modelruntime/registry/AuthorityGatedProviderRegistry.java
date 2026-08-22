package com.virtualcompanion.modelruntime.registry;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities.Capability;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * {@link ProviderRegistry} that takes admission from a durable
 * {@link ProviderAdmissionAuthority} on every read.
 *
 * <p>The inner registry still owns adapter identity (protocol, capabilities)
 * for locally wired deployments. {@link #findAdmitted} and
 * {@link #deployments()} re-read the authority each call — never a cached
 * admission — so a coordinator disable/reject is observed before the next
 * outbound. A missing row, a non-{@code ADMITTED} status, or an unreadable
 * authority all fail closed (not admitted). Config-enabled inner
 * registrations are never sufficient on their own.
 */
public final class AuthorityGatedProviderRegistry implements ProviderRegistry {

    private final ProviderRegistry inner;
    private final ProviderAdmissionAuthority authority;

    public AuthorityGatedProviderRegistry(
            ProviderRegistry inner,
            ProviderAdmissionAuthority authority) {
        this.inner = Objects.requireNonNull(inner, "inner must not be null");
        this.authority = Objects.requireNonNull(authority, "authority must not be null");
    }

    @Override
    public ProviderDeployment register(ProviderRegistration registration) {
        return overlay(inner.register(registration));
    }

    @Override
    public ProviderDeployment disable(ProviderId providerId) {
        return overlay(inner.disable(providerId));
    }

    @Override
    public Optional<ProviderDeployment> findAdmitted(
            ModelProtocol protocol,
            ModelProtocolCapabilities required) {
        Objects.requireNonNull(protocol, "protocol must not be null");
        Objects.requireNonNull(required, "required must not be null");
        return deployments().stream()
                .filter(ProviderDeployment::isAdmitted)
                .filter(deployment -> deployment.protocol() == protocol)
                .filter(deployment -> supportsAll(deployment.capabilities(), required))
                .findFirst();
    }

    @Override
    public List<ProviderDeployment> deployments() {
        return inner.deployments().stream().map(this::overlay).toList();
    }

    /**
     * Intersection of local wiring and durable admission. A process-local
     * disable still excludes the deployment even when the authority admits
     * it; a durable non-admit always wins over a locally admitted copy.
     */
    private ProviderDeployment overlay(ProviderDeployment local) {
        if (!local.isAdmitted()) {
            return local;
        }
        AdmissionStatus durable = durableStatus(local.providerId());
        if (durable == local.admissionStatus()) {
            return local;
        }
        return new ProviderDeployment(
                local.providerId(),
                local.protocol(),
                local.capabilities(),
                durable);
    }

    private AdmissionStatus durableStatus(ProviderId providerId) {
        try {
            return authority.statusOf(providerId).orElse(AdmissionStatus.REJECTED);
        } catch (RuntimeException authorityFailure) {
            return AdmissionStatus.REJECTED;
        }
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
