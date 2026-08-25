package com.virtualcompanion.modelruntime.registry;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * DOGFOOD-STABILIZATION audit (ADR-0006 §3.4): after a failed durable
 * safety-leak rollback the locally isolated deployment must vanish from
 * every routing read — the next route sees no eligible deployment.
 */
class IsolationFilteredProviderRegistryTest {

    private static final ModelProtocolCapabilities CAPS =
            new ModelProtocolCapabilities(Set.of());

    /** Minimal no-op adapter: the registry only reads protocol/capabilities. */
    private static final class StubAdapter implements ModelProtocolAdapter {
        @Override
        public ModelProtocol protocol() {
            return ModelProtocol.OPENAI_CHAT_COMPLETIONS;
        }

        @Override
        public ModelProtocolCapabilities capabilities() {
            return CAPS;
        }

        @Override
        public ModelProtocolSession open(ModelProtocolRequest request) {
            throw new UnsupportedOperationException("not used by registry tests");
        }
    }

    private final InMemoryProviderRegistry inner = new InMemoryProviderRegistry();
    private final LocalDeploymentIsolation isolation = new LocalDeploymentIsolation();
    private final IsolationFilteredProviderRegistry registry =
            new IsolationFilteredProviderRegistry(inner, isolation);

    private void register(String providerId) {
        inner.register(new ProviderRegistration(
                new ProviderId(providerId),
                ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                CAPS,
                new StubAdapter()));
    }

    @Test
    void isolatedDeploymentDisappearsFromEveryRoutingRead() {
        register("provider-a");
        register("provider-b");
        isolation.isolate("provider-a");

        assertEquals("provider-b", registry
                .findAdmitted(ModelProtocol.OPENAI_CHAT_COMPLETIONS, CAPS)
                .map(deployment -> deployment.providerId().value())
                .orElseThrow());
        List<String> visible = registry.deployments().stream()
                .map(deployment -> deployment.providerId().value())
                .toList();
        assertEquals(List.of("provider-b"), visible);
    }

    @Test
    void isolatingTheLastDeploymentLeavesRoutingEmptyFailClosed() {
        register("provider-a");
        isolation.isolate("provider-a");

        assertTrue(registry.findAdmitted(ModelProtocol.OPENAI_CHAT_COMPLETIONS, CAPS)
                .isEmpty());
        assertTrue(registry.deployments().isEmpty());
    }

    @Test
    void withoutIsolationEverythingStaysVisibleAndIsolationIsOneWay() {
        register("provider-a");
        assertEquals(1, registry.deployments().size());

        // One-way within the process: nothing here can clear the set.
        isolation.isolate("provider-a");
        assertTrue(registry.deployments().isEmpty());
        assertFalse(isolation.isIsolated("other-provider"));
    }
}
