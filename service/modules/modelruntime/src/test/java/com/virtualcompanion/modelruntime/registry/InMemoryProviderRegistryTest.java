package com.virtualcompanion.modelruntime.registry;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities.Capability;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

class InMemoryProviderRegistryTest {

    private static ModelProtocolCapabilities caps(Capability... values) {
        return new ModelProtocolCapabilities(Set.of(values));
    }

    private static ProviderRegistration registration(
            String id,
            ModelProtocol protocol,
            ModelProtocolCapabilities capabilities) {
        return new ProviderRegistration(
                new ProviderId(id), protocol, capabilities,
                new StubAdapter(protocol, capabilities));
    }

    @Test
    void registerAdmitsProviderWithDeclaredIdentityAndCapabilities() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        ModelProtocolCapabilities capabilities = caps(Capability.STREAMING);

        ProviderDeployment deployment = registry.register(
                registration("fake-1", ModelProtocol.FAKE, capabilities));

        assertEquals(new ProviderId("fake-1"), deployment.providerId());
        assertEquals(ModelProtocol.FAKE, deployment.protocol());
        assertEquals(capabilities, deployment.capabilities());
        assertEquals(AdmissionStatus.ADMITTED, deployment.admissionStatus());
        assertTrue(deployment.isAdmitted());
    }

    @Test
    void registerRejectsDuplicateProviderId() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        registry.register(registration("fake-1", ModelProtocol.FAKE, caps()));

        assertThrows(IllegalStateException.class, () ->
                registry.register(registration("fake-1", ModelProtocol.FAKE, caps())));
    }

    @Test
    void registerRejectsNullRegistration() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        assertThrows(NullPointerException.class, () -> registry.register(null));
    }

    @Test
    void registrationRejectsProtocolMismatchBetweenDeclarationAndAdapter() {
        assertThrows(IllegalArgumentException.class, () ->
                new ProviderRegistration(
                        new ProviderId("fake-1"),
                        ModelProtocol.FAILURE,
                        caps(),
                        new StubAdapter(ModelProtocol.FAKE, caps())));
    }

    @Test
    void registrationRejectsCapabilityMismatchBetweenDeclarationAndAdapter() {
        ModelProtocolCapabilities declared = caps(Capability.STREAMING);
        ModelProtocolCapabilities actual = caps();
        assertThrows(IllegalArgumentException.class, () ->
                new ProviderRegistration(
                        new ProviderId("fake-1"),
                        ModelProtocol.FAKE,
                        declared,
                        new StubAdapter(ModelProtocol.FAKE, actual)));
    }

    @Test
    void disableMovesAdmittedProviderToDisabled() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        ProviderId providerId = new ProviderId("failure-1");
        registry.register(registration("failure-1", ModelProtocol.FAILURE, caps(Capability.STREAMING)));

        ProviderDeployment disabled = registry.disable(providerId);

        assertEquals(AdmissionStatus.DISABLED, disabled.admissionStatus());
        assertTrue(registry.deployments().stream()
                .noneMatch(ProviderDeployment::isAdmitted));
    }

    @Test
    void disableRejectsUnknownProvider() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        assertThrows(IllegalStateException.class, () ->
                registry.disable(new ProviderId("unknown")));
    }

    @Test
    void disableRejectsNullProviderId() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        assertThrows(NullPointerException.class, () -> registry.disable(null));
    }

    @Test
    void findAdmittedReturnsMatchingAdmittedProvider() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        registry.register(registration(
                "fake-1", ModelProtocol.FAKE, caps(Capability.STREAMING, Capability.STRUCTURED_OUTPUT)));

        Optional<ProviderDeployment> found = registry.findAdmitted(
                ModelProtocol.FAKE, caps(Capability.STREAMING));

        assertTrue(found.isPresent());
        assertEquals(new ProviderId("fake-1"), found.orElseThrow().providerId());
    }

    @Test
    void findAdmittedReturnsEmptyWhenCapabilitiesDoNotMatch() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        registry.register(registration("fake-1", ModelProtocol.FAKE, caps()));

        Optional<ProviderDeployment> found = registry.findAdmitted(
                ModelProtocol.FAKE, caps(Capability.STREAMING));

        assertTrue(found.isEmpty());
    }

    @Test
    void findAdmittedReturnsEmptyWhenProtocolHasNoAdmittedProvider() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        registry.register(registration("fake-1", ModelProtocol.FAKE, caps()));

        Optional<ProviderDeployment> found = registry.findAdmitted(
                ModelProtocol.FAILURE, caps());

        assertTrue(found.isEmpty());
    }

    @Test
    void findAdmittedExcludesDisabledProviders() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        registry.register(registration("fake-1", ModelProtocol.FAKE, caps(Capability.STREAMING)));
        registry.disable(new ProviderId("fake-1"));

        Optional<ProviderDeployment> found = registry.findAdmitted(
                ModelProtocol.FAKE, caps(Capability.STREAMING));

        assertTrue(found.isEmpty());
    }

    @Test
    void findAdmittedRejectsNullArguments() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        assertThrows(NullPointerException.class, () ->
                registry.findAdmitted(null, caps()));
        assertThrows(NullPointerException.class, () ->
                registry.findAdmitted(ModelProtocol.FAKE, null));
    }

    @Test
    void deploymentsReturnsImmutableSnapshot() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        registry.register(registration("fake-1", ModelProtocol.FAKE, caps()));

        var snapshot = registry.deployments();
        assertEquals(1, snapshot.size());

        registry.register(registration("failure-1", ModelProtocol.FAILURE, caps()));
        assertEquals(1, snapshot.size(), "snapshot must not reflect later mutations");
        assertEquals(2, registry.deployments().size());
    }

    @Test
    void providerIdRejectsBlankValue() {
        assertThrows(IllegalArgumentException.class, () -> new ProviderId(""));
        assertThrows(IllegalArgumentException.class, () -> new ProviderId("   "));
    }

    @Test
    void providerIdRejectsNullValue() {
        assertThrows(NullPointerException.class, () -> new ProviderId(null));
    }

    @Test
    void multipleAdmittedProvidersOfDifferentProtocolsCoexist() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        registry.register(registration("fake-1", ModelProtocol.FAKE, caps(Capability.STREAMING)));
        registry.register(registration("failure-1", ModelProtocol.FAILURE, caps(Capability.STREAMING)));

        assertDoesNotThrow(() ->
                registry.findAdmitted(ModelProtocol.FAKE, caps(Capability.STREAMING)).orElseThrow());
        assertDoesNotThrow(() ->
                registry.findAdmitted(ModelProtocol.FAILURE, caps(Capability.STREAMING)).orElseThrow());
    }

    private static final class StubAdapter implements ModelProtocolAdapter {
        private final ModelProtocol protocol;
        private final ModelProtocolCapabilities capabilities;

        StubAdapter(ModelProtocol protocol, ModelProtocolCapabilities capabilities) {
            this.protocol = protocol;
            this.capabilities = capabilities;
        }

        @Override
        public ModelProtocol protocol() {
            return protocol;
        }

        @Override
        public ModelProtocolCapabilities capabilities() {
            return capabilities;
        }

        @Override
        public ModelProtocolSession open(ModelProtocolRequest request) {
            throw new UnsupportedOperationException("registry tests never open sessions");
        }
    }
}
