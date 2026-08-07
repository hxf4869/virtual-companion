package com.virtualcompanion.modelruntime.execution;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistration;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class InMemoryAdapterLocatorTest {

    private static final ProviderId PROVIDER = new ProviderId("openai-approved");
    private static final ModelProtocolCapabilities CAPABILITIES =
            new ModelProtocolCapabilities(Set.of(
                    ModelProtocolCapabilities.Capability.STREAMING));

    @Test
    void resolvesRegisteredAdapterByProviderId() {
        ModelProtocolAdapter adapter = adapter();
        InMemoryAdapterLocator locator = locator(registration(adapter));

        assertSame(adapter, locator.adapterFor(PROVIDER));
    }

    @Test
    void rejectsDuplicateProviderIdAtConstruction() {
        ModelProtocolAdapter first = adapter();
        ModelProtocolAdapter second = adapter();

        assertThrows(IllegalStateException.class, () -> new InMemoryAdapterLocator(List.of(
                registration(first),
                registration(second))));
    }

    @Test
    void rejectsUnknownProviderIdFailClosed() {
        InMemoryAdapterLocator locator = locator(registration(adapter()));

        assertThrows(IllegalStateException.class,
                () -> locator.adapterFor(new ProviderId("unregistered")));
    }

    @Test
    void rejectsNullProviderId() {
        InMemoryAdapterLocator locator = locator(registration(adapter()));

        assertThrows(NullPointerException.class, () -> locator.adapterFor(null));
    }

    @Test
    void rejectsRegistrationProtocolDisagreement() {
        assertThrows(IllegalArgumentException.class, () -> new ProviderRegistration(
                PROVIDER,
                ModelProtocol.ANTHROPIC_MESSAGES,
                CAPABILITIES,
                adapter()));
    }

    private static ProviderRegistration registration(ModelProtocolAdapter adapter) {
        return new ProviderRegistration(PROVIDER, adapter.protocol(), CAPABILITIES, adapter);
    }

    private static InMemoryAdapterLocator locator(ProviderRegistration registration) {
        return new InMemoryAdapterLocator(List.of(registration));
    }

    private static ModelProtocolAdapter adapter() {
        return new ScriptedAdapter(
                ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                CAPABILITIES,
                binding -> List.of(new ModelProtocolEvent.AttemptEos(
                        binding, 0, com.virtualcompanion.modelruntime.contract.StopReason.STOP)));
    }
}
