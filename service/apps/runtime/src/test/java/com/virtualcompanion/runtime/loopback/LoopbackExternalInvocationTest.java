package com.virtualcompanion.runtime.loopback;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.catalog.ProviderAttemptStatus;
import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshot;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotId;
import com.virtualcompanion.modelruntime.authorization.AuthorizationStatus;
import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationGuard;
import com.virtualcompanion.modelruntime.authorization.InMemoryAuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.authorization.ProcessingPurpose;
import com.virtualcompanion.modelruntime.authorization.ProviderContractRef;
import com.virtualcompanion.modelruntime.authorization.ProviderRegion;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.execution.AdapterLocator;
import com.virtualcompanion.modelruntime.execution.InMemoryAdapterLocator;
import com.virtualcompanion.modelruntime.execution.LiveAttemptOutcome;
import com.virtualcompanion.modelruntime.execution.LiveAttemptTerminal;
import com.virtualcompanion.modelruntime.execution.LiveInvocationRequest;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.modelruntime.registry.InMemoryProviderRegistry;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistration;
import com.virtualcompanion.modelruntime.routing.DeterministicRouter;
import com.virtualcompanion.modelruntime.routing.Entitlement;
import com.virtualcompanion.modelruntime.routing.GenerationRecovery;
import com.virtualcompanion.modelruntime.routing.QuotaLedger;
import com.virtualcompanion.modelruntime.routing.RoutingRequest;
import com.virtualcompanion.modelruntime.routing.ServiceClass;
import com.virtualcompanion.safety.ClassifierReport;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * In-process end-to-end test of the external completion path (TASK-0181):
 * the runtime wiring used by the generation worker — provider registry with a
 * loopback (FAKE) deployment, an authorization snapshot store holding the dual
 * snapshots (S0-25: the store the guard reads is the DB-backed authority; this
 * test exercises the same guard→invoker chain over an equivalent store),
 * {@code ExecutionAuthorizationGuard},
 * {@code DeterministicRouter} and {@code LiveModelInvoker} — is assembled and
 * one external invocation runs through guard -> loopback adapter -> terminal.
 *
 * <p>The database write path (V26 SD function + provider) is proven separately
 * by infra/db test 68 and {@code JdbcAuthorizationSnapshotProviderTest}; this
 * test proves the in-process chain the runtime executes between snapshot
 * creation and terminalization, with the same fixtures (provider
 * {@code alpha-loopback}, region {@code us}, contract {@code alpha-standard},
 * purpose COMPANION_CHAT, category MESSAGE_TEXT, usage 42/58).
 */
class LoopbackExternalInvocationTest {

    private static final OwnershipTuple OWNERSHIP = new OwnershipTuple("1", "9", "5", "10");
    private static final ProviderId PROVIDER = new ProviderId("alpha-loopback");
    private static final ProviderRegion REGION = new ProviderRegion("us");
    private static final ProviderContractRef CONTRACT = new ProviderContractRef("alpha-standard");
    private static final Set<DataCategory> CATEGORIES = Set.of(DataCategory.MESSAGE_TEXT);

    private static AuthorizationSnapshot snapshot(String id) {
        return new AuthorizationSnapshot(
                new AuthorizationSnapshotId(id),
                AuthorizationStatus.ACTIVE,
                PROVIDER,
                REGION,
                CONTRACT,
                ProcessingPurpose.COMPANION_CHAT,
                CATEGORIES,
                false,
                false);
    }

    @Test
    void externalInvocationSucceedsThroughLoopbackAdapter() {
        LiveModelInvoker invoker = invokerWithSnapshots("snap-req-1", "snap-exec-1");

        LiveAttemptOutcome outcome = invoker.invoke(request("snap-req-1", "snap-exec-1"));

        assertEquals(LiveAttemptTerminal.SUCCEEDED, outcome.terminal());
        assertEquals(LoopbackModelProtocolAdapter.LOOPBACK_RESPONSE, outcome.response());
        assertEquals(42L, outcome.usage().inputTokens());
        assertEquals(58L, outcome.usage().outputTokens());
        assertEquals(1, outcome.audits().size());
        assertEquals(PROVIDER.value(), outcome.audits().getFirst().providerId());
        assertEquals("alpha-supplier", outcome.audits().getFirst().supplierName());
        assertEquals(ProviderAttemptStatus.SUCCEEDED, outcome.audits().getFirst().status());
    }

    @Test
    void missingExecutionSnapshotBlocksBeforeOutboundTransfer() {
        // The execution snapshot is absent from the store: the guard must deny
        // before the adapter is ever opened (INV-AUTH-001), so no audit row and
        // no output exist.
        LiveModelInvoker invoker = invokerWithSnapshots("snap-req-1", null);

        LiveAttemptOutcome outcome = invoker.invoke(request("snap-req-1", "snap-exec-missing"));

        assertEquals(LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION, outcome.terminal());
        assertTrue(outcome.audits().isEmpty());
        assertEquals("", outcome.response());
    }

    @Test
    void providerDriftBlocksAtExecutionSnapshotCheck() {
        // The execution snapshot names a different provider than the registry
        // deployment the router selects: the invoker's execution-snapshot check
        // (step 2) must fail closed with no outbound transfer.
        InMemoryAuthorizationSnapshotStore store = new InMemoryAuthorizationSnapshotStore();
        store.put(new AuthorizationSnapshot(
                new AuthorizationSnapshotId("snap-exec-drift"),
                AuthorizationStatus.ACTIVE,
                new ProviderId("alpha-other"),
                REGION,
                CONTRACT,
                ProcessingPurpose.COMPANION_CHAT,
                CATEGORIES,
                false,
                false));
        LiveModelInvoker invoker = invoker(store, List.of());

        LiveAttemptOutcome outcome = invoker.invoke(request("snap-req-1", "snap-exec-drift"));

        assertEquals(LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION, outcome.terminal());
        assertTrue(outcome.audits().isEmpty());
    }

    private static LiveModelInvoker invokerWithSnapshots(String requestedId, String executionId) {
        InMemoryAuthorizationSnapshotStore store = new InMemoryAuthorizationSnapshotStore();
        store.put(snapshot(requestedId));
        if (executionId != null) {
            store.put(snapshot(executionId));
        }
        return invoker(store, List.of());
    }

    private static LiveModelInvoker invoker(
            InMemoryAuthorizationSnapshotStore store, List<ProviderRegistration> extra) {
        LoopbackModelProtocolAdapter adapter = new LoopbackModelProtocolAdapter();
        ProviderRegistration registration = new ProviderRegistration(
                PROVIDER, adapter.protocol(), adapter.capabilities(), adapter);

        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        registry.register(registration);
        extra.forEach(registry::register);

        AdapterLocator locator = new InMemoryAdapterLocator(List.of(registration));
        ExecutionAuthorizationGuard guard = new ExecutionAuthorizationGuard(store, registry);
        QuotaLedger ledger = new QuotaLedger();
        // External attempts reserve one synthetic quota unit per owner; owners
        // must be provisioned before the router may select a deployment.
        ledger.provision(OWNERSHIP.ownerUserId(), 100L);
        DeterministicRouter router = new DeterministicRouter(registry, ledger);
        GenerationRecovery recovery = new GenerationRecovery(ledger);
        return new LiveModelInvoker(
                router,
                guard,
                store,
                locator,
                recovery,
                Map.of(PROVIDER, "alpha-supplier"));
    }

    private static LiveInvocationRequest request(String requestedId, String executionId) {
        RoutingRequest routing = new RoutingRequest(
                OWNERSHIP,
                new Entitlement(OWNERSHIP.ownerUserId(), ServiceClass.simulated()),
                ModelProtocol.FAKE,
                new ModelProtocolCapabilities(Set.of()),
                requestedId,
                executionId,
                "ZERO_LLM_FALLBACK",
                42L);
        return new LiveInvocationRequest(
                routing,
                List.of(new ProtocolMessage(ProtocolMessage.Role.USER, "I had a rough day")),
                new ResponseMode.Text(),
                false,
                new TimeoutBudget(
                        Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1)),
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.80));
    }
}
