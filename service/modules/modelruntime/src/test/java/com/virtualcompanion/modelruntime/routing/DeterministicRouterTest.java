package com.virtualcompanion.modelruntime.routing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.catalog.RouteDecisionStatus;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities.Capability;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.registry.AdmissionStatus;
import com.virtualcompanion.modelruntime.registry.ProviderDeployment;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistration;
import com.virtualcompanion.modelruntime.registry.ProviderRegistry;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Deterministic-router contract tests covering the TASK-0031 acceptance matrix:
 * determinism, deterministic selection order, NO_ELIGIBLE_DEPLOYMENT, filtering,
 * ZERO_LLM degradation, service-class policy, quota fail-closed, INV-AUTH-001
 * binding shape and the no-bypass / no-provider-attempt-for-ZERO_LLM rules.
 */
class DeterministicRouterTest {

    private static final ModelProtocol FAKE = ModelProtocol.FAKE;
    private static final ModelProtocolCapabilities NO_CAPS = new ModelProtocolCapabilities(Set.of());
    private static final ModelProtocolCapabilities STREAMING =
            new ModelProtocolCapabilities(Set.of(Capability.STREAMING));

    @Test
    void sameInputProducesSameDecisionNoAndSelection() {
        RoutingRequest request = standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS);
        RouteDecision first = routerWithCandidates("alpha", "bravo").decide(request);
        RouteDecision second = routerWithCandidates("alpha", "bravo").decide(request);

        assertEquals(first.decisionNo(), second.decisionNo());
        assertEquals(first.selectedProviderId(), second.selectedProviderId());
        assertEquals(first.bindingOptional(), second.bindingOptional());
        assertEquals(RouteDecisionStatus.SELECTED, first.status());
    }

    @Test
    void selectsDeterministicFirstRegardlessOfInsertionOrder() {
        // Registered in non-sorted order; selection must be by ProviderId.value(), not insertion.
        DeterministicRouter router = routerWithCandidates("charlie", "alpha", "bravo");
        RouteDecision decision = router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        assertEquals(new ProviderId("alpha"), decision.selectedProviderId());
        assertEquals(
                List.of(new ProviderId("alpha"), new ProviderId("bravo"), new ProviderId("charlie")),
                decision.consideredCandidates());
    }

    @Test
    void disabledDeploymentIsNotEligible() {
        DeterministicRouter router = routerWithSingle("p1", FAKE, NO_CAPS, AdmissionStatus.DISABLED);
        RouteDecision decision = router.decide(
                standardRequest(ServiceClass.disabled(), FAKE, NO_CAPS));

        assertEquals(RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT, decision.status());
        assertTrue(decision.bindingOptional().isEmpty());
    }

    @Test
    void protocolMismatchYieldsNoEligibleWhenZeroLlmForbidden() {
        DeterministicRouter router = routerWithSingle("p1", ModelProtocol.FAILURE, NO_CAPS, AdmissionStatus.ADMITTED);
        ServiceClass noZeroLlm = new ServiceClass("EXTERNAL_ONLY", true, false);
        RouteDecision decision = router.decide(standardRequest(noZeroLlm, FAKE, NO_CAPS));

        assertEquals(RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT, decision.status());
        assertTrue(decision.consideredCandidates().isEmpty());
    }

    @Test
    void capabilityMismatchYieldsNoEligibleWhenZeroLlmForbidden() {
        DeterministicRouter router = routerWithSingle("p1", FAKE, NO_CAPS, AdmissionStatus.ADMITTED);
        ServiceClass noZeroLlm = new ServiceClass("EXTERNAL_ONLY", true, false);
        RouteDecision decision = router.decide(standardRequest(noZeroLlm, FAKE, STREAMING));

        assertEquals(RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT, decision.status());
    }

    @Test
    void externalAttemptBindsBothAuthorizationSnapshots() {
        DeterministicRouter router = routerWithCandidates("p1");
        RouteDecision decision = router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        InvocationBinding binding = decision.bindingOptional().orElseThrow();
        assertTrue(binding instanceof InvocationBinding.ExternalAttemptBinding);
        InvocationBinding.ExternalAttemptBinding external = (InvocationBinding.ExternalAttemptBinding) binding;
        assertEquals("snap-req-1", external.requestedAuthorizationSnapshotId());
        assertEquals("snap-exec-1", external.executionAuthorizationSnapshotId());
    }

    @Test
    void zeroLlmOnlyRoutesToDeterministicSourceAndIgnoresRegistry() {
        DeterministicRouter router = routerWithCandidates("p1", "p2");
        RouteDecision decision = router.decide(standardRequest(ServiceClass.zeroLlmOnly(), FAKE, NO_CAPS));

        assertEquals(RouteDecisionStatus.SELECTED, decision.status());
        assertTrue(decision.selectedProviderIdOptional().isEmpty());
        InvocationBinding binding = decision.bindingOptional().orElseThrow();
        assertTrue(binding instanceof InvocationBinding.DeterministicSourceBinding);
        assertTrue(decision.consideredCandidates().isEmpty());
    }

    @Test
    void zeroLlmDegradesWhenNoExternalCandidate() {
        DeterministicRouter router = routerWithCandidates(); // empty registry
        RouteDecision decision = router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        assertEquals(RouteDecisionStatus.SELECTED, decision.status());
        assertTrue(decision.bindingOptional().orElseThrow() instanceof InvocationBinding.DeterministicSourceBinding);
    }

    @Test
    void zeroLlmDegradesWhenQuotaExhausted() {
        DeterministicRouter router = routerWithCandidates("p1");
        QuotaLedger ledger = ledgerProvisioned(0);
        DeterministicRouter routerNoQuota = new DeterministicRouter(routerRegistry("p1"), ledger);
        RouteDecision decision = routerNoQuota.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        assertEquals(RouteDecisionStatus.SELECTED, decision.status());
        assertTrue(decision.selectedProviderIdOptional().isEmpty());
        assertTrue(decision.quotaReservationOptional().isEmpty());
    }

    @Test
    void noEligibleWhenQuotaExhaustedAndZeroLlmForbidden() {
        ServiceClass noZeroLlm = new ServiceClass("EXTERNAL_ONLY", true, false);
        DeterministicRouter router = new DeterministicRouter(routerRegistry("p1"), ledgerProvisioned(0));
        RouteDecision decision = router.decide(standardRequest(noZeroLlm, FAKE, NO_CAPS));

        assertEquals(RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT, decision.status());
    }

    @Test
    void disabledServiceClassYieldsNoEligible() {
        DeterministicRouter router = routerWithCandidates("p1");
        RouteDecision decision = router.decide(standardRequest(ServiceClass.disabled(), FAKE, NO_CAPS));

        assertEquals(RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT, decision.status());
        assertTrue(decision.bindingOptional().isEmpty());
        assertTrue(decision.consideredCandidates().isEmpty());
    }

    @Test
    void missingAuthorizationSnapshotsDegradeToZeroLlm() {
        DeterministicRouter router = routerWithCandidates("p1");
        RoutingRequest request = new RoutingRequest(
                own(), new Entitlement("owner-1", ServiceClass.simulated()),
                FAKE, NO_CAPS, null, null, "zero-llm-1", 1L);
        RouteDecision decision = router.decide(request);

        assertEquals(RouteDecisionStatus.SELECTED, decision.status());
        assertTrue(decision.bindingOptional().orElseThrow() instanceof InvocationBinding.DeterministicSourceBinding);
    }

    @Test
    void missingSnapshotsAndZeroLlmForbiddenYieldsNoEligible() {
        ServiceClass noZeroLlm = new ServiceClass("EXTERNAL_ONLY", true, false);
        DeterministicRouter router = routerWithCandidates("p1");
        RoutingRequest request = new RoutingRequest(
                own(), new Entitlement("owner-1", noZeroLlm),
                FAKE, NO_CAPS, "", "", "zero-llm-1", 1L);
        RouteDecision decision = router.decide(request);

        assertEquals(RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT, decision.status());
    }

    @Test
    void zeroLlmMissingSourceIdYieldsNoEligibleWhenNoExternal() {
        DeterministicRouter router = routerWithCandidates();
        RoutingRequest request = new RoutingRequest(
                own(), new Entitlement("owner-1", ServiceClass.simulated()),
                FAKE, NO_CAPS, "snap-req-1", "snap-exec-1", null, 1L);
        RouteDecision decision = router.decide(request);

        assertEquals(RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT, decision.status());
    }

    @Test
    void selectedProviderIsAlwaysARegistryMember() {
        ProviderRegistry registry = routerRegistry("alpha", "bravo");
        DeterministicRouter router = new DeterministicRouter(registry, ledgerProvisioned(5));
        RouteDecision decision = router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        Set<ProviderId> registered = new java.util.HashSet<>();
        for (ProviderDeployment deployment : registry.deployments()) {
            registered.add(deployment.providerId());
        }
        assertTrue(registered.contains(decision.selectedProviderId()));
    }

    @Test
    void decisionNoDiffersAcrossOutcomes() {
        DeterministicRouter router = routerWithCandidates("p1");

        RouteDecision external = router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));
        RouteDecision zeroLlm = router.decide(standardRequest(ServiceClass.zeroLlmOnly(), FAKE, NO_CAPS));
        RouteDecision none = router.decide(standardRequest(ServiceClass.disabled(), FAKE, NO_CAPS));

        assertEquals(RouteDecisionStatus.SELECTED, external.status());
        assertTrue(external.bindingOptional().orElseThrow() instanceof InvocationBinding.ExternalAttemptBinding);
        assertTrue(zeroLlm.bindingOptional().orElseThrow() instanceof InvocationBinding.DeterministicSourceBinding);
        assertEquals(RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT, none.status());

        assertNotEquals(external.decisionNo(), zeroLlm.decisionNo());
        assertNotEquals(external.decisionNo(), none.decisionNo());
        assertNotEquals(zeroLlm.decisionNo(), none.decisionNo());
    }

    @Test
    void quotaReservedOnExternalSelection() {
        QuotaLedger ledger = ledgerProvisioned(5);
        DeterministicRouter router = new DeterministicRouter(routerRegistry("p1"), ledger);
        router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        assertEquals(4L, ledger.remaining("owner-1"));
    }

    @Test
    void quotaNotReservedOnZeroLlm() {
        QuotaLedger ledger = ledgerProvisioned(5);
        DeterministicRouter router = new DeterministicRouter(routerRegistry("p1"), ledger);
        router.decide(standardRequest(ServiceClass.zeroLlmOnly(), FAKE, NO_CAPS));

        assertEquals(5L, ledger.remaining("owner-1"));
    }

    @Test
    void routingRequestRejectsMismatchedOwner() {
        OwnershipTuple ownership = own();
        Entitlement otherOwner = new Entitlement("owner-2", ServiceClass.simulated());
        assertThrows(IllegalArgumentException.class, () -> new RoutingRequest(
                ownership, otherOwner, FAKE, NO_CAPS, "snap-req-1", "snap-exec-1", "zero-llm-1", 1L));
    }

    @Test
    void routeDecisionRejectsTamperedDecisionNo() {
        OwnershipTuple ownership = own();
        assertThrows(IllegalArgumentException.class, () -> new RouteDecision(
                "rd-tampered", RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT, ownership, "SIMULATED",
                null, null, null, List.of(),
                RouteAudit.none("SIMULATED", RouteAudit.NO_ELIGIBLE_DEPLOYMENT)));
    }

    @Test
    void noEligibleDecisionNoIsRecomputable() {
        RouteDecision decision = routerWithCandidates()
                .decide(standardRequest(ServiceClass.disabled(), FAKE, NO_CAPS));
        String recomputed = RouteDecision.computeDecisionNo(
                RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT,
                decision.ownership(),
                decision.serviceClassCode(),
                null,
                null);
        assertEquals(decision.decisionNo(), recomputed);
    }

    // ---------- ROUTE-HARDEN: health-aware selection (§12.12 / §12.8) ----------

    @Test
    void blockedCandidateIsSkippedForTheNextHealthySortedCandidate() {
        // alpha tripped OPEN; bravo healthy -> traffic fails over to bravo at
        // this turn boundary instead of burning the attempt on alpha.
        DeterministicRouter router = new DeterministicRouter(
                routerRegistry("alpha", "bravo"), ledgerProvisioned(10),
                new StubHealthPolicy(Map.of(new ProviderId("alpha"), RouteHealthPolicy.Health.BLOCKED)));
        RouteDecision decision = router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        assertEquals(RouteDecisionStatus.SELECTED, decision.status());
        assertEquals(new ProviderId("bravo"), decision.selectedProviderId());
        // The audit list stays the full deterministic candidate set.
        assertEquals(List.of(new ProviderId("alpha"), new ProviderId("bravo")),
                decision.consideredCandidates());
    }

    @Test
    void allBlockedCandidatesDegradeToZeroLlm() {
        DeterministicRouter router = new DeterministicRouter(
                routerRegistry("p1"), ledgerProvisioned(10),
                new StubHealthPolicy(Map.of(new ProviderId("p1"), RouteHealthPolicy.Health.BLOCKED)));
        RouteDecision decision = router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        assertEquals(RouteDecisionStatus.SELECTED, decision.status());
        assertTrue(decision.selectedProviderIdOptional().isEmpty());
        assertTrue(decision.bindingOptional().orElseThrow()
                instanceof InvocationBinding.DeterministicSourceBinding);
        assertEquals(List.of(new ProviderId("p1")), decision.consideredCandidates());
    }

    @Test
    void allBlockedCandidatesYieldNoEligibleWhenZeroLlmForbidden() {
        ServiceClass noZeroLlm = new ServiceClass("EXTERNAL_ONLY", true, false);
        DeterministicRouter router = new DeterministicRouter(
                routerRegistry("p1"), ledgerProvisioned(10),
                new StubHealthPolicy(Map.of(new ProviderId("p1"), RouteHealthPolicy.Health.BLOCKED)));
        RouteDecision decision = router.decide(standardRequest(noZeroLlm, FAKE, NO_CAPS));

        assertEquals(RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT, decision.status());
    }

    @Test
    void stickyHealthyDeploymentWinsOverSortOrder() {
        // §12.8 会话模型粘滞: conv-1's last successful deployment was bravo;
        // while healthy it must be preferred over lexicographically-smaller alpha.
        StubHealthPolicy policy = new StubHealthPolicy(Map.of());
        policy.sticky.put("conv-1", new ProviderId("bravo"));
        DeterministicRouter router = new DeterministicRouter(
                routerRegistry("alpha", "bravo"), ledgerProvisioned(10), policy);
        RouteDecision decision = router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        assertEquals(new ProviderId("bravo"), decision.selectedProviderId());
    }

    @Test
    void stickyDeploymentIsAbandonedWhenItsCircuitOpens() {
        // §12.8 切换条件: health change only — an OPEN sticky circuit switches
        // the conversation to the first healthy candidate at the turn boundary.
        StubHealthPolicy policy = new StubHealthPolicy(
                Map.of(new ProviderId("bravo"), RouteHealthPolicy.Health.BLOCKED));
        policy.sticky.put("conv-1", new ProviderId("bravo"));
        DeterministicRouter router = new DeterministicRouter(
                routerRegistry("alpha", "bravo"), ledgerProvisioned(10), policy);
        RouteDecision decision = router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        assertEquals(new ProviderId("alpha"), decision.selectedProviderId());
    }

    @Test
    void stickyDeploymentOutsideTheCandidateSetIsIgnored() {
        // Sticky deployment no longer matches protocol/capabilities: legacy
        // sorted order applies.
        StubHealthPolicy policy = new StubHealthPolicy(Map.of());
        policy.sticky.put("conv-1", new ProviderId("zulu"));
        DeterministicRouter router = new DeterministicRouter(
                routerRegistry("alpha", "bravo"), ledgerProvisioned(10), policy);
        RouteDecision decision = router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        assertEquals(new ProviderId("alpha"), decision.selectedProviderId());
    }

    @Test
    void probeOnlyCandidateIsSelectedOnlyWhenNothingIsHealthy() {
        // Half-open window: alpha is BLOCKED (in cooldown), bravo PROBE_ONLY
        // (cooldown elapsed). No healthy candidate exists, so the turn acts as
        // bravo's half-open probe.
        DeterministicRouter router = new DeterministicRouter(
                routerRegistry("alpha", "bravo"), ledgerProvisioned(10),
                new StubHealthPolicy(Map.of(
                        new ProviderId("alpha"), RouteHealthPolicy.Health.BLOCKED,
                        new ProviderId("bravo"), RouteHealthPolicy.Health.PROBE_ONLY)));
        RouteDecision probe = router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));
        assertEquals(new ProviderId("bravo"), probe.selectedProviderId());

        // A healthy candidate always wins over a probe-only one.
        DeterministicRouter withHealthy = new DeterministicRouter(
                routerRegistry("alpha", "bravo"), ledgerProvisioned(10),
                new StubHealthPolicy(Map.of(
                        new ProviderId("alpha"), RouteHealthPolicy.Health.PROBE_ONLY,
                        new ProviderId("bravo"), RouteHealthPolicy.Health.HEALTHY)));
        assertEquals(new ProviderId("bravo"),
                withHealthy.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS))
                        .selectedProviderId());

        // Sorted order breaks ties between two probe-only candidates.
        DeterministicRouter bothProbe = new DeterministicRouter(
                routerRegistry("alpha", "bravo"), ledgerProvisioned(10),
                new StubHealthPolicy(Map.of(
                        new ProviderId("alpha"), RouteHealthPolicy.Health.PROBE_ONLY,
                        new ProviderId("bravo"), RouteHealthPolicy.Health.PROBE_ONLY)));
        assertEquals(new ProviderId("alpha"),
                bothProbe.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS))
                        .selectedProviderId());
    }

    @Test
    void unknownStickyConversationKeepsLegacySelectionOrder() {
        StubHealthPolicy policy = new StubHealthPolicy(Map.of());
        DeterministicRouter router = new DeterministicRouter(
                routerRegistry("charlie", "alpha", "bravo"), ledgerProvisioned(10), policy);
        RouteDecision decision = router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        assertEquals(new ProviderId("alpha"), decision.selectedProviderId());
    }

    @Test
    void auditRecordsSelectedExternalWithMatchingEntitledAndActualClass() {
        RouteDecision decision = routerWithCandidates("p1")
                .decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        assertEquals(RouteAudit.POLICY_VERSION, decision.audit().policyVersion());
        assertEquals("SIMULATED", decision.audit().entitledServiceClass());
        assertEquals("SIMULATED", decision.audit().actualServiceClass());
        assertEquals(RouteAudit.SELECTED_EXTERNAL, decision.audit().outcomeReason());
    }

    @Test
    void auditRecordsZeroLlmFallbackWhenNoAdmittedCandidate() {
        RouteDecision decision = routerWithCandidates()
                .decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        assertEquals(RouteAudit.ACTUAL_ZERO_LLM, decision.audit().actualServiceClass());
        assertEquals(RouteAudit.NO_ADMITTED_CANDIDATE, decision.audit().outcomeReason());
        assertEquals("SIMULATED", decision.audit().entitledServiceClass());
    }

    @Test
    void auditRecordsServiceClassForbidsExternalOnZeroLlmOnly() {
        RouteDecision decision = routerWithCandidates("p1")
                .decide(standardRequest(ServiceClass.zeroLlmOnly(), FAKE, NO_CAPS));

        assertEquals(RouteAudit.SERVICE_CLASS_FORBIDS_EXTERNAL, decision.audit().outcomeReason());
        assertEquals(RouteAudit.ACTUAL_ZERO_LLM, decision.audit().actualServiceClass());
        assertTrue(decision.consideredCandidates().isEmpty());
    }

    @Test
    void auditRecordsQuotaExhaustedWhenReserveFails() {
        DeterministicRouter router = new DeterministicRouter(routerRegistry("p1"), new QuotaLedger());
        ServiceClass noZeroLlm = new ServiceClass("EXTERNAL_ONLY", true, false);
        RouteDecision decision = router.decide(standardRequest(noZeroLlm, FAKE, NO_CAPS));

        assertEquals(RouteDecisionStatus.NO_ELIGIBLE_DEPLOYMENT, decision.status());
        assertEquals(RouteAudit.QUOTA_EXHAUSTED, decision.audit().outcomeReason());
        assertEquals(RouteAudit.ACTUAL_NONE, decision.audit().actualServiceClass());
    }

    @Test
    void auditRecordsCircuitBlockedWhenEveryCandidateIsOpen() {
        DeterministicRouter router = new DeterministicRouter(
                routerRegistry("p1"), ledgerProvisioned(10),
                new StubHealthPolicy(Map.of(new ProviderId("p1"), RouteHealthPolicy.Health.BLOCKED)));
        RouteDecision decision = router.decide(standardRequest(ServiceClass.simulated(), FAKE, NO_CAPS));

        assertEquals(RouteAudit.ALL_CANDIDATES_CIRCUIT_BLOCKED, decision.audit().outcomeReason());
        assertEquals(RouteAudit.ACTUAL_ZERO_LLM, decision.audit().actualServiceClass());
    }

    // ---------- helpers ----------

    private static OwnershipTuple own() {
        return new OwnershipTuple("owner-1", "rel-1", "conv-1", "gen-1");
    }

    private static RoutingRequest standardRequest(ServiceClass serviceClass, ModelProtocol protocol,
                                                  ModelProtocolCapabilities caps) {
        return new RoutingRequest(
                own(),
                new Entitlement("owner-1", serviceClass),
                protocol,
                caps,
                "snap-req-1",
                "snap-exec-1",
                "zero-llm-1",
                1L);
    }

    private static QuotaLedger ledgerProvisioned(long budget) {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", budget);
        return ledger;
    }

    private static ProviderRegistry routerRegistry(String... ids) {
        StubRegistry registry = new StubRegistry();
        for (String id : ids) {
            registry.add(id, FAKE, NO_CAPS, AdmissionStatus.ADMITTED);
        }
        return registry;
    }

    private static DeterministicRouter routerWithCandidates(String... ids) {
        return new DeterministicRouter(routerRegistry(ids), ledgerProvisioned(10));
    }

    private static DeterministicRouter routerWithSingle(String id, ModelProtocol protocol,
                                                        ModelProtocolCapabilities caps, AdmissionStatus status) {
        return new DeterministicRouter(new StubRegistry().add(id, protocol, caps, status), ledgerProvisioned(10));
    }

    /** ROUTE-HARDEN stub: explicit health per provider + conversation stickiness. */
    private static final class StubHealthPolicy implements RouteHealthPolicy {
        final Map<String, ProviderId> sticky = new java.util.HashMap<>();
        private final Map<ProviderId, Health> health;

        StubHealthPolicy(Map<ProviderId, Health> health) {
            this.health = health;
        }

        @Override
        public Health health(ProviderId providerId) {
            return health.getOrDefault(providerId, RouteHealthPolicy.Health.HEALTHY);
        }

        @Override
        public Optional<ProviderId> stickyDeployment(String conversationId) {
            return Optional.ofNullable(sticky.get(conversationId));
        }
    }

    private static final class StubRegistry implements ProviderRegistry {
        private final List<ProviderDeployment> deployments = new java.util.ArrayList<>();

        StubRegistry add(String id, ModelProtocol protocol, ModelProtocolCapabilities caps, AdmissionStatus status) {
            deployments.add(new ProviderDeployment(new ProviderId(id), protocol, caps, status));
            return this;
        }

        @Override
        public ProviderDeployment register(ProviderRegistration registration) {
            throw new UnsupportedOperationException();
        }

        @Override
        public ProviderDeployment disable(ProviderId providerId) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Optional<ProviderDeployment> findAdmitted(
                ModelProtocol protocol, ModelProtocolCapabilities required) {
            throw new UnsupportedOperationException();
        }

        @Override
        public List<ProviderDeployment> deployments() {
            return List.copyOf(deployments);
        }
    }
}
