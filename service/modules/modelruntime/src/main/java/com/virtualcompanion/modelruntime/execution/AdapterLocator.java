package com.virtualcompanion.modelruntime.execution;

import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.registry.ProviderId;

/**
 * Supplier-neutral locator that maps a registered provider id to the concrete
 * adapter behind that deployment.
 *
 * <p>The locator stays behind the {@link ModelProtocolAdapter} port so the
 * invocation path never depends on a vendor SDK or concrete adapter class.
 * Lookup is fail-closed: an unknown provider id is an explicit error, never a
 * silent fallback to a guessed adapter.</p>
 */
public interface AdapterLocator {

    /**
     * Return the adapter registered for the given provider id.
     *
     * @throws NullPointerException if {@code providerId} is null
     * @throws IllegalStateException if no adapter is registered for the provider id
     */
    ModelProtocolAdapter adapterFor(ProviderId providerId);
}
