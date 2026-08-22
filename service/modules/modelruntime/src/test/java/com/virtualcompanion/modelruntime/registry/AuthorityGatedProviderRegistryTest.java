package com.virtualcompanion.modelruntime.registry;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.catalog.RouteDecisionStatus;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import com.virtualcompanion.modelruntime.routing.DeterministicRouter;
import com.virtualcompanion.modelruntime.routing.Entitlement;
import com.virtualcompanion.modelruntime.routing.QuotaLedger;
import com.virtualcompanion.modelruntime.routing.RouteDecision;
import com.virtualcompanion.modelruntime.routing.RoutingRequest;
import com.virtualcompanion.modelruntime.routing.ServiceClass;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.Test;

/**
 * S0-11-A: durable admission is the runtime source. A config-wired adapter is
 * never eligible for outbound unless the authority currently reports ADMITTED;
 * missing, DISABLED, REJECTED and unreadable authority all fail closed.
 */
class AuthorityGatedProviderRegistryTest {

    private static final ModelProtocol FAKE = ModelProtocol.FAKE;
    private static final ModelProtocolCapabilities NO_CAPS =
            new ModelProtocolCapabilities(Set.of());
    private static final ProviderId PROVIDER = new ProviderId("loopback-1");

    @Test
    void admittedAuthorityMakesRegisteredDeploymentEligible() {
        MapAuthority authority = new MapAuthority();
        authority.put(PROVIDER, AdmissionStatus.ADMITTED);
        AuthorityGatedProviderRegistry registry = gated(authority);
        registry.register(registration(PROVIDER));

        Optional<ProviderDeployment> found = registry.findAdmitted(FAKE, NO_CAPS);

        assertTrue(found.isPresent());
        assertEquals(AdmissionStatus.ADMITTED, found.orElseThrow().admissionStatus());
        assertTrue(registry.deployments().getFirst().isAdmitted());
    }

    @Test
    void missingAuthorityRowIsNotAdmitted() {
        AuthorityGatedProviderRegistry registry = gated(new MapAuthority());
        registry.register(registration(PROVIDER));

        assertTrue(registry.findAdmitted(FAKE, NO_CAPS).isEmpty());
        assertFalse(registry.deployments().getFirst().isAdmitted());
        assertEquals(AdmissionStatus.REJECTED, registry.deployments().getFirst().admissionStatus());
    }

    @Test
    void disabledAuthorityRowIsNotAdmitted() {
        assertNotAdmitted(AdmissionStatus.DISABLED);
    }

    @Test
    void rejectedAuthorityRowIsNotAdmitted() {
        assertNotAdmitted(AdmissionStatus.REJECTED);
    }

    @Test
    void unreadableAuthorityFailsClosed() {
        MapAuthority authority = new MapAuthority();
        authority.failure = new IllegalStateException("admission authority unavailable");
        AuthorityGatedProviderRegistry registry = gated(authority);
        registry.register(registration(PROVIDER));

        assertTrue(registry.findAdmitted(FAKE, NO_CAPS).isEmpty());
        assertFalse(registry.deployments().getFirst().isAdmitted());
    }

    @Test
    void routerDoesNotSelectUnadmittedDeployment() {
        MapAuthority authority = new MapAuthority();
        authority.put(PROVIDER, AdmissionStatus.DISABLED);
        AuthorityGatedProviderRegistry registry = gated(authority);
        registry.register(registration(PROVIDER));

        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 10);
        DeterministicRouter router = new DeterministicRouter(registry, ledger);
        ServiceClass externalOnly = new ServiceClass("EXTERNAL_ONLY", true, false);
        RouteDecision decision = router.decide(request(externalOnly));

        assertEquals(RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT, decision.status());
        assertTrue(decision.bindingOptional().isEmpty());
        assertTrue(decision.consideredCandidates().isEmpty());
    }

    @Test
    void routerSelectsDeploymentWhenAuthorityAdmitsIt() {
        MapAuthority authority = new MapAuthority();
        authority.put(PROVIDER, AdmissionStatus.ADMITTED);
        AuthorityGatedProviderRegistry registry = gated(authority);
        registry.register(registration(PROVIDER));

        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 10);
        DeterministicRouter router = new DeterministicRouter(registry, ledger);
        RouteDecision decision = router.decide(request(ServiceClass.simulated()));

        assertEquals(RouteDecisionStatus.SELECTED, decision.status());
        assertEquals(PROVIDER, decision.selectedProviderId());
        assertTrue(decision.bindingOptional().orElseThrow()
                instanceof InvocationBinding.ExternalAttemptBinding);
    }

    @Test
    void processLocalDisableStillExcludesEvenWhenAuthorityAdmits() {
        MapAuthority authority = new MapAuthority();
        authority.put(PROVIDER, AdmissionStatus.ADMITTED);
        AuthorityGatedProviderRegistry registry = gated(authority);
        registry.register(registration(PROVIDER));
        registry.disable(PROVIDER);

        assertTrue(registry.findAdmitted(FAKE, NO_CAPS).isEmpty());
        assertEquals(AdmissionStatus.DISABLED, registry.deployments().getFirst().admissionStatus());
    }

    @Test
    void deploymentsSnapshotDoesNotTrackLaterAuthorityMutation() {
        MapAuthority authority = new MapAuthority();
        authority.put(PROVIDER, AdmissionStatus.ADMITTED);
        AuthorityGatedProviderRegistry registry = gated(authority);
        registry.register(registration(PROVIDER));

        var snapshot = registry.deployments();
        authority.put(PROVIDER, AdmissionStatus.DISABLED);

        assertTrue(snapshot.getFirst().isAdmitted());
        assertFalse(registry.deployments().getFirst().isAdmitted());
    }

    private static void assertNotAdmitted(AdmissionStatus status) {
        MapAuthority authority = new MapAuthority();
        authority.put(PROVIDER, status);
        AuthorityGatedProviderRegistry registry = gated(authority);
        registry.register(registration(PROVIDER));

        assertTrue(registry.findAdmitted(FAKE, NO_CAPS).isEmpty());
        assertEquals(status, registry.deployments().getFirst().admissionStatus());
        assertFalse(registry.deployments().getFirst().isAdmitted());
    }

    private static AuthorityGatedProviderRegistry gated(ProviderAdmissionAuthority authority) {
        return new AuthorityGatedProviderRegistry(new InMemoryProviderRegistry(), authority);
    }

    private static ProviderRegistration registration(ProviderId id) {
        return new ProviderRegistration(id, FAKE, NO_CAPS, new StubAdapter());
    }

    private static RoutingRequest request(ServiceClass serviceClass) {
        OwnershipTuple ownership = new OwnershipTuple("owner-1", "rel-1", "conv-1", "gen-1");
        return new RoutingRequest(
                ownership,
                new Entitlement("owner-1", serviceClass),
                FAKE,
                NO_CAPS,
                "snap-req-1",
                "snap-exec-1",
                "zero-llm-1",
                1L);
    }

    private static final class MapAuthority implements ProviderAdmissionAuthority {
        private final Map<ProviderId, AdmissionStatus> statuses = new ConcurrentHashMap<>();
        private RuntimeException failure;

        void put(ProviderId id, AdmissionStatus status) {
            statuses.put(id, status);
        }

        @Override
        public Optional<AdmissionStatus> statusOf(ProviderId providerId) {
            if (failure != null) {
                throw failure;
            }
            return Optional.ofNullable(statuses.get(providerId));
        }
    }

    private static final class StubAdapter implements ModelProtocolAdapter {
        @Override
        public ModelProtocol protocol() {
            return FAKE;
        }

        @Override
        public ModelProtocolCapabilities capabilities() {
            return NO_CAPS;
        }

        @Override
        public ModelProtocolSession open(ModelProtocolRequest request) {
            throw new UnsupportedOperationException("registry tests never open sessions");
        }
    }
}
