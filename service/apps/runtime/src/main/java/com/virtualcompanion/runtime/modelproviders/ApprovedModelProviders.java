package com.virtualcompanion.runtime.modelproviders;

import com.virtualcompanion.modelruntime.execution.AdapterLocator;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistry;
import java.util.Map;
import java.util.Objects;

/**
 * The wired set of approved live model providers for one runtime.
 *
 * <p>Groups the in-memory {@link ProviderRegistry} (admitted approved
 * deployments), the {@link AdapterLocator} (provider id to concrete adapter)
 * and the runtime-configured supplier display names used by the audit chain.
 * A provider that is not part of this set is never reachable: the registry has
 * no deployment for it and the locator has no adapter for it, so routing and
 * invocation both fail closed.</p>
 */
public final class ApprovedModelProviders {

    private final ProviderRegistry registry;
    private final AdapterLocator locator;
    private final Map<ProviderId, String> supplierNames;

    public ApprovedModelProviders(
            ProviderRegistry registry,
            AdapterLocator locator,
            Map<ProviderId, String> supplierNames) {
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        this.locator = Objects.requireNonNull(locator, "locator must not be null");
        this.supplierNames = Map.copyOf(supplierNames);
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
}
