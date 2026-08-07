package com.virtualcompanion.modelruntime.execution;

import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistration;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

/**
 * In-memory {@link AdapterLocator} keyed by provider id.
 *
 * <p>Adapters are supplied as {@link ProviderRegistration}s, whose compact
 * constructor already fails closed when the declared protocol or capabilities
 * disagree with the adapter itself. A duplicated provider id is rejected at
 * construction; an unknown provider id is rejected at lookup, so the invocation
 * path can never silently target a different vendor.</p>
 */
public final class InMemoryAdapterLocator implements AdapterLocator {

    private final Map<ProviderId, ModelProtocolAdapter> adapters;

    public InMemoryAdapterLocator(Collection<ProviderRegistration> registrations) {
        Objects.requireNonNull(registrations, "registrations must not be null");
        Map<ProviderId, ModelProtocolAdapter> byId = new HashMap<>();
        for (ProviderRegistration registration : registrations) {
            Objects.requireNonNull(registration, "registrations must not contain null");
            ModelProtocolAdapter previous = byId.put(registration.providerId(), registration.adapter());
            if (previous != null) {
                throw new IllegalStateException(
                        "provider " + registration.providerId() + " is registered more than once");
            }
        }
        this.adapters = Map.copyOf(byId);
    }

    @Override
    public ModelProtocolAdapter adapterFor(ProviderId providerId) {
        Objects.requireNonNull(providerId, "providerId must not be null");
        ModelProtocolAdapter adapter = adapters.get(providerId);
        if (adapter == null) {
            throw new IllegalStateException("no adapter registered for provider " + providerId);
        }
        return adapter;
    }
}
