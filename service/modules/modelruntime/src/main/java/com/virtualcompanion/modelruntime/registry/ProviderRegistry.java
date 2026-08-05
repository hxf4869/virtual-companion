package com.virtualcompanion.modelruntime.registry;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import java.util.List;
import java.util.Optional;

/**
 * Supplier-neutral registry port for provider deployments.
 * <p>
 * The registry owns admission state transitions and fail-closed capability
 * matching. Business layers depend only on this port and the value types in
 * this package — never on adapter implementations, vendor SDKs, model names
 * or credentials.
 */
public interface ProviderRegistry {

    /**
     * Admit a registration. The deployment starts in
     * {@link AdmissionStatus#ADMITTED}.
     *
     * @throws NullPointerException     if {@code registration} is null
     * @throws IllegalStateException    if the provider id is already registered
     */
    ProviderDeployment register(ProviderRegistration registration);

    /**
     * Move a registered deployment to {@link AdmissionStatus#DISABLED}.
     *
     * @throws NullPointerException  if {@code providerId} is null
     * @throws IllegalStateException if the provider is not registered
     */
    ProviderDeployment disable(ProviderId providerId);

    /**
     * Find the first admitted deployment that matches the protocol and
     * supports every requested capability. Returns empty when no admitted
     * deployment satisfies the request — callers must treat empty as
     * fail-closed and never fall back to a guessed default.
     */
    Optional<ProviderDeployment> findAdmitted(
            ModelProtocol protocol,
            ModelProtocolCapabilities required);

    /**
     * Return an immutable snapshot of all known deployments.
     */
    List<ProviderDeployment> deployments();
}
