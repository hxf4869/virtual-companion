package com.virtualcompanion.modelruntime.registry;

import java.util.Optional;

/**
 * Durable admission authority for provider deployments.
 *
 * <p>The runtime {@link ProviderRegistry} overlays this status onto locally
 * wired adapters: a deployment is eligible for outbound only when the
 * authority currently reports {@link AdmissionStatus#ADMITTED}. A missing
 * row is not admitted. An unreadable authority must throw; callers fail
 * closed rather than consulting a process-local admitted copy.
 *
 * <p>Config-enabled is never sufficient on its own once an authority is
 * wired. Adapter identity and credentials stay in the local registry;
 * admission transitions belong to this durable source.
 */
public interface ProviderAdmissionAuthority {

    /**
     * Durable admission for {@code providerId}. Empty means the provider is
     * unknown to the authority and therefore not admitted.
     *
     * @throws NullPointerException if {@code providerId} is null
     * @throws RuntimeException     if the authority cannot be read
     */
    Optional<AdmissionStatus> statusOf(ProviderId providerId);
}
