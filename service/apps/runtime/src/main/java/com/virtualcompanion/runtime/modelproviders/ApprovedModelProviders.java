package com.virtualcompanion.runtime.modelproviders;

import com.virtualcompanion.modelruntime.execution.AdapterLocator;
import com.virtualcompanion.modelruntime.execution.ProviderDeploymentMetadata;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistry;
import java.util.Map;
import java.util.Objects;

/**
 * The wired set of approved live model providers for one runtime.
 *
 * <p>Groups the {@link ProviderRegistry} (approved deployments whose durable
 * admission, when an authority is wired, comes from
 * {@code vc.provider_deployment}), the {@link AdapterLocator} (provider id to
 * concrete adapter) and the runtime-configured supplier display names used by
 * the audit chain. A provider that is not part of this set, or that is not
 * currently {@code ADMITTED} in the durable registry, is never reachable:
 * routing and the pre-outbound guard both fail closed.</p>
 */
public final class ApprovedModelProviders {

    private final ProviderRegistry registry;
    private final AdapterLocator locator;
    private final Map<ProviderId, String> supplierNames;
    private final Map<ProviderId, ProviderDeploymentMetadata> deploymentMetadata;

    public ApprovedModelProviders(
            ProviderRegistry registry,
            AdapterLocator locator,
            Map<ProviderId, String> supplierNames) {
        this(registry, locator, supplierNames, Map.of());
    }

    public ApprovedModelProviders(
            ProviderRegistry registry,
            AdapterLocator locator,
            Map<ProviderId, String> supplierNames,
            Map<ProviderId, ProviderDeploymentMetadata> deploymentMetadata) {
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        this.locator = Objects.requireNonNull(locator, "locator must not be null");
        this.supplierNames = Map.copyOf(supplierNames);
        this.deploymentMetadata = Map.copyOf(deploymentMetadata);
    }

    public ProviderRegistry registry() {
        return registry;
    }

    public AdapterLocator locator() {
        return locator;
    }

    public Map<ProviderId, String> supplierNames() {
        return supplierNames;
    }

    public Map<ProviderId, ProviderDeploymentMetadata> deploymentMetadata() {
        return deploymentMetadata;
    }
}
