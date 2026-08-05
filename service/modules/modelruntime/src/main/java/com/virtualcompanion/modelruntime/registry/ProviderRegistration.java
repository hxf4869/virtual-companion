package com.virtualcompanion.modelruntime.registry;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import java.util.Objects;

/**
 * Immutable request to admit a {@link ModelProtocolAdapter} into the
 * registry under a stable {@link ProviderId}.
 * <p>
 * The declared {@code protocol} and {@code capabilities} must agree with
 * the adapter's own {@link ModelProtocolAdapter#protocol()} and
 * {@link ModelProtocolAdapter#capabilities()}; a mismatch fails-closed at
 * construction time so a misconfigured registration can never reach the
 * registry.
 */
public record ProviderRegistration(
        ProviderId providerId,
        ModelProtocol protocol,
        ModelProtocolCapabilities capabilities,
        ModelProtocolAdapter adapter) {

    public ProviderRegistration {
        Objects.requireNonNull(providerId, "providerId must not be null");
        Objects.requireNonNull(protocol, "protocol must not be null");
        Objects.requireNonNull(capabilities, "capabilities must not be null");
        Objects.requireNonNull(adapter, "adapter must not be null");
        if (adapter.protocol() != protocol) {
            throw new IllegalArgumentException(
                    "registration protocol " + protocol
                            + " disagrees with adapter protocol " + adapter.protocol());
        }
        if (!adapter.capabilities().equals(capabilities)) {
            throw new IllegalArgumentException(
                    "registration capabilities " + capabilities
                            + " disagree with adapter capabilities " + adapter.capabilities());
        }
    }
}
