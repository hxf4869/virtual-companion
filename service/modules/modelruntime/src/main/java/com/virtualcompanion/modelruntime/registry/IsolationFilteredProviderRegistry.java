package com.virtualcompanion.modelruntime.registry;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * DOGFOOD-STABILIZATION audit (ADR-0006 §3.4): registry decorator hiding the
 * deployments held in a {@link LocalDeploymentIsolation} set.
 *
 * <p>Sits on top of the durable admission overlay
 * ({@code AuthorityGatedProviderRegistry}); a deployment must pass BOTH the
 * durable DB admission and the local isolation set to be routable. When the
 * durable rollback write fails, the local set is the in-process backstop so
 * the next routing attempt has zero egress to that exact deployment.</p>
 */
public final class IsolationFilteredProviderRegistry implements ProviderRegistry {

    private final ProviderRegistry inner;
    private final LocalDeploymentIsolation isolation;

    public IsolationFilteredProviderRegistry(
            ProviderRegistry inner, LocalDeploymentIsolation isolation) {
        this.inner = Objects.requireNonNull(inner, "inner must not be null");
        this.isolation = Objects.requireNonNull(isolation, "isolation must not be null");
    }

    @Override
    public ProviderDeployment register(ProviderRegistration registration) {
        return inner.register(registration);
    }

    @Override
    public ProviderDeployment disable(ProviderId providerId) {
        return inner.disable(providerId);
    }

    @Override
    public Optional<ProviderDeployment> findAdmitted(
            ModelProtocol protocol, ModelProtocolCapabilities required) {
        return inner.findAdmitted(protocol, required)
                .filter(deployment -> !isolation.isIsolated(deployment.providerId().value()));
    }

    @Override
    public List<ProviderDeployment> deployments() {
        return inner.deployments().stream()
                .filter(deployment -> !isolation.isIsolated(deployment.providerId().value()))
                .toList();
    }
}
