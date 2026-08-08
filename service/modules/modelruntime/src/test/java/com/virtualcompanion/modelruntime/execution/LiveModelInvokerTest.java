package com.virtualcompanion.modelruntime.execution;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.catalog.ProviderAttemptStatus;
import com.virtualcompanion.catalog.RealtimeEventType;
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
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.SizeLimits;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
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
import com.virtualcompanion.safety.DeterministicSafetyResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

/**
 * LiveModelInvoker contract tests for the TASK-0035 acceptance matrix: the
 * live outbound path runs only behind the authorization guard (dual snapshots),
 * an adequate SafetyGate ALLOW, and a quota reservation; every failure, cancel,
 * timeout, safety block, authorization denial and quota no-capacity path is
 * fail-closed and never fabricates a success; ZERO_LLM creates no provider
 * attempt; and each real outbound attempt records a ProviderAttemptAudit
 * without credentials or content.
 */
class LiveModelInvokerTest {

    private static final OwnershipTuple OWNERSHIP =
            new OwnershipTuple("owner-1", "rel-1", "conv-1", "gen-1");
    private static final ProviderId PROVIDER = new ProviderId("openai-approved");
    private static final ProviderId OTHER_PROVIDER = new ProviderId("openai-other");
    private static final ModelProtocolCapabilities CAPABILITIES =
            new ModelProtocolCapabilities(Set.of(
                    ModelProtocolCapabilities.Capability.STREAMING,
                    ModelProtocolCapabilities.Capability.STRUCTURED_OUTPUT));
    private static final ProviderRegion REGION = new ProviderRegion("region-a");
    private static final ProviderContractRef CONTRACT = new ProviderContractRef("contract-a");
    private static final ProcessingPurpose PURPOSE = ProcessingPurpose.COMPANION_CHAT;
    private static final Set<DataCategory> CATEGORIES = Set.of(DataCategory.MESSAGE_TEXT);

    private final QuotaLedger quota = new QuotaLedger();

    @Test
    void liveRequestAllowsExactMessageLimitAndRejectsOneOver() {
        var exact = java.util.Collections.nCopies(
                SizeLimits.MAX_MESSAGES,
                new ProtocolMessage(ProtocolMessage.Role.USER, "hello")
        );

        assertEquals(
                SizeLimits.MAX_MESSAGES,
                request(routing(ServiceClass.simulated()), exact).messages().size()
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> request(
                        routing(ServiceClass.simulated()),
                        java.util.Collections.nCopies(
                                SizeLimits.MAX_MESSAGES + 1,
                                new ProtocolMessage(ProtocolMessage.Role.USER, "hello")
                        )
                )
        );
    }

    @Test
    void successRecordsAuditAndUsageAndRetainsReservation() {
        Harness harness = harness(false, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.SUCCEEDED, outcome.terminal());
        assertEquals("Hello world", outcome.response());
        assertEquals(15L, outcome.usageOptional().orElseThrow().totalTokens());
        assertTrue(outcome.externalAttemptCreated());
        assertEquals(1, outcome.audits().size());
        ProviderAttemptAudit audit = outcome.audits().getFirst();
        assertEquals(ProviderAttemptStatus.SUCCEEDED, audit.status());
        assertEquals("OpenAI", audit.supplierName());
        assertEquals(PROVIDER.value(), audit.providerId());
        assertEquals("owner-1", audit.ownership().ownerUserId());
        // Success keeps the reservation for upstream finalization to settle.
        assertEquals(4L, quota.remaining("owner-1"));
    }

    @Test
    void wrongBindingEventFailsClosedAndReleasesQuota() {
        Harness harness = harness(
                false,
                binding -> List.of(new ModelProtocolEvent.OutputDelta(
                        wrongBinding(binding), 0, new ModelPayload.TextChunk("leak"))),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.FAILED, outcome.terminal());
        assertTrue(outcome.failureOptional().orElseThrow()
                instanceof AdapterFailure.MalformedResponse);
        assertEquals(ProviderAttemptStatus.NON_RETRYABLE_FAILED,
                outcome.audits().getFirst().status());
        // The wrong-binding output must never pollute the deterministic response.
        assertFalse(outcome.response().contains("leak"));
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void outOfOrderSequenceFailsClosedAndReleasesQuota() {
        Harness harness = harness(
                false,
                binding -> List.of(
                        new ModelProtocolEvent.OutputDelta(
                                binding, 0, new ModelPayload.TextChunk("a")),
                        new ModelProtocolEvent.OutputDelta(
                                binding, 2, new ModelPayload.TextChunk("skip"))),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.FAILED, outcome.terminal());
        assertTrue(outcome.failureOptional().orElseThrow()
                instanceof AdapterFailure.MalformedResponse);
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void duplicateUsageFailsClosedAndReleasesQuota() {
        Harness harness = harness(
                false,
                binding -> List.of(
                        new ModelProtocolEvent.OutputDelta(
                                binding, 0, new ModelPayload.TextChunk("a")),
                        new ModelProtocolEvent.UsageReported(
                                binding, 1, new TokenUsage(1, 1, 2)),
                        new ModelProtocolEvent.UsageReported(
                                binding, 2, new TokenUsage(2, 2, 4))),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.FAILED, outcome.terminal());
        assertTrue(outcome.failureOptional().orElseThrow()
                instanceof AdapterFailure.MalformedResponse);
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void eosWithoutAnyOutputFailsClosedAndReleasesQuota() {
        Harness harness = harness(
                false,
                binding -> List.of(new ModelProtocolEvent.AttemptEos(
                        binding, 0, StopReason.STOP)),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.FAILED, outcome.terminal());
        assertTrue(outcome.failureOptional().orElseThrow()
                instanceof AdapterFailure.MalformedResponse);
        // The empty EOS never produces a successful response; the degraded
        // path yields only the deterministic ZERO_LLM fallback.
        assertEquals(DeterministicSafetyResponse.ZERO_LLM_FALLBACK, outcome.response());
        // INV-GEN-003: an attempt-level EOS without output is a failure and
        // never carries the completion event semantics.
        assertEquals(RealtimeEventType.CHAT_FAILED, outcome.realtimeEventType());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void deniedAuthorizationClosesBeforeOutboundAndReleasesQuota() {
        Harness harness = harness(true, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION, outcome.terminal());
        assertEquals(0, harness.adapter.openCount());
        assertFalse(outcome.externalAttemptCreated());
        assertTrue(outcome.audits().isEmpty());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void nonAdequateSafetyBlocksBeforeOutboundAndReleasesQuota() {
        Harness harness = harness(false, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(inadequateSafetyRequest());

        assertEquals(LiveAttemptTerminal.BLOCKED_BY_SAFETY, outcome.terminal());
        assertEquals(0, harness.adapter.openCount());
        assertTrue(outcome.audits().isEmpty());
        assertEquals(DeterministicSafetyResponse.ZERO_LLM_FALLBACK, outcome.response());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void providerFailureFailsClosedAndReleasesQuota() {
        Harness harness = harness(
                false,
                binding -> List.of(new ModelProtocolEvent.AttemptFailed(
                        binding, 0, new AdapterFailure.UpstreamUnavailable())),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.FAILED, outcome.terminal());
        assertTrue(outcome.failureOptional().orElseThrow()
                instanceof AdapterFailure.UpstreamUnavailable);
        assertEquals(ProviderAttemptStatus.NON_RETRYABLE_FAILED,
                outcome.audits().getFirst().status());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void rateLimitedIsRetryableFailed() {
        Harness harness = harness(
                false,
                binding -> List.of(new ModelProtocolEvent.AttemptFailed(
                        binding, 0, new AdapterFailure.RateLimited())),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.FAILED, outcome.terminal());
        assertEquals(ProviderAttemptStatus.RETRYABLE_FAILED,
                outcome.audits().getFirst().status());
    }

    @Test
    void timeoutFailsClosedWithTimeoutTerminal() {
        Harness harness = harness(
                false,
                binding -> List.of(new ModelProtocolEvent.AttemptFailed(
                        binding, 0, new AdapterFailure.Timeout(
                                AdapterFailure.TimeoutPhase.CONNECT))),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.TIMED_OUT, outcome.terminal());
        assertEquals(ProviderAttemptStatus.TIMED_OUT, outcome.audits().getFirst().status());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void cancellationNeverFabricatesSuccess() {
        Harness harness = harness(
                false,
                binding -> List.of(
                        new ModelProtocolEvent.OutputDelta(
                                binding, 0, new ModelPayload.TextChunk("partial")),
                        new ModelProtocolEvent.AttemptCancelled(binding, 1)),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.CANCELLED, outcome.terminal());
        assertEquals(ProviderAttemptStatus.CANCELLED, outcome.audits().getFirst().status());
        assertTrue(outcome.response().isEmpty());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void zeroLlmDegradationNeverCreatesProviderAttempt() {
        Harness harness = harness(false, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(requestWithServiceClass(ServiceClass.zeroLlmOnly()));

        assertEquals(LiveAttemptTerminal.ZERO_LLM_COMPLETED, outcome.terminal());
        assertFalse(outcome.externalAttemptCreated());
        assertTrue(outcome.audits().isEmpty());
        assertEquals(0, harness.adapter.openCount());
        assertEquals(DeterministicSafetyResponse.ZERO_LLM_FALLBACK, outcome.response());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void noCapacityFailsClosedWithoutEligibleDeployment() {
        Harness harness = harness(false, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(requestWithServiceClass(ServiceClass.disabled()));

        assertEquals(LiveAttemptTerminal.NO_ELIGIBLE_DEPLOYMENT, outcome.terminal());
        assertFalse(outcome.externalAttemptCreated());
        assertTrue(outcome.audits().isEmpty());
        assertEquals(0, harness.adapter.openCount());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void missingAdapterFailsClosedWithoutOutboundOrAudit() {
        // Registry admits PROVIDER but the locator is empty (misconfiguration).
        Harness harness = harness(false, Scripts.success("world"), Map.of(), true);

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.FAILED, outcome.terminal());
        assertEquals(0, harness.adapter.openCount());
        assertTrue(outcome.audits().isEmpty());
        assertFalse(outcome.externalAttemptCreated(),
                "a path that never transferred must not create a provider attempt");
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void structuredOutputResponseIsAggregated() {
        Harness harness = harness(
                false,
                binding -> List.of(
                        new ModelProtocolEvent.OutputDelta(
                                binding, 0, new ModelPayload.StructuredJson("{\"k\":1}")),
                        new ModelProtocolEvent.AttemptEos(binding, 1, StopReason.STOP)),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.SUCCEEDED, outcome.terminal());
        assertEquals("{\"k\":1}", outcome.response());
    }

    @Test
    void cumulativeOutputOverLimitFailsClosedWithoutPartialOutput() {
        var exactLimit = "a".repeat(SizeLimits.MAX_TOTAL_OUTPUT_BYTES);
        Harness harness = harness(
                false,
                binding -> List.of(
                        new ModelProtocolEvent.OutputDelta(
                                binding, 0, new ModelPayload.TextChunk(exactLimit)),
                        new ModelProtocolEvent.OutputDelta(
                                binding, 1, new ModelPayload.TextChunk("b")),
                        new ModelProtocolEvent.AttemptEos(binding, 2, StopReason.STOP)),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.FAILED, outcome.terminal());
        assertTrue(outcome.failureOptional().orElseThrow()
                instanceof AdapterFailure.MalformedResponse);
        assertEquals(ProviderAttemptStatus.NON_RETRYABLE_FAILED,
                outcome.audits().getFirst().status());
        assertEquals(DeterministicSafetyResponse.ZERO_LLM_FALLBACK, outcome.response());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void sessionClosingWithoutTerminalEventFailsClosed() {
        Harness harness = harness(
                false,
                binding -> List.of(new ModelProtocolEvent.OutputDelta(
                        binding, 0, new ModelPayload.TextChunk("no terminal"))),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.FAILED, outcome.terminal());
        assertEquals(ProviderAttemptStatus.NON_RETRYABLE_FAILED,
                outcome.audits().getFirst().status());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void realtimeEventTypeNeverFabricatesCompletionOnDegradedPaths() {
        assertEquals(RealtimeEventType.CHAT_COMPLETED,
                harness(false, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"))
                        .invoke(adequateRequest()).realtimeEventType());
        assertEquals(RealtimeEventType.CHAT_FAILED,
                harness(false, binding -> List.of(new ModelProtocolEvent.AttemptFailed(
                                binding, 0, new AdapterFailure.UpstreamUnavailable())),
                        Map.of(PROVIDER, "OpenAI")).invoke(adequateRequest()).realtimeEventType());
        assertEquals(RealtimeEventType.CHAT_BLOCKED,
                harness(false, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"))
                        .invoke(inadequateSafetyRequest()).realtimeEventType());
        assertEquals(RealtimeEventType.CHAT_CANCELLED,
                harness(false, binding -> List.of(
                                new ModelProtocolEvent.AttemptCancelled(binding, 0)),
                        Map.of(PROVIDER, "OpenAI")).invoke(adequateRequest()).realtimeEventType());
        assertEquals(RealtimeEventType.CHAT_FAILED,
                harness(false, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"))
                        .invoke(requestWithServiceClass(ServiceClass.disabled()))
                        .realtimeEventType());
    }

    @Test
    void selectedProviderMustMatchAuthorizedSnapshotProvider() {
        // The authorization snapshots authorize OTHER_PROVIDER (also admitted),
        // but deterministic routing selects PROVIDER (openai-approved sorts
        // before openai-other). The live path must fail closed instead of
        // transferring through a provider the request was never authorized for.
        Harness harness = harness(
                false,
                Scripts.success("world"),
                Map.of(PROVIDER, "OpenAI", OTHER_PROVIDER, "OpenAI"),
                false,
                OTHER_PROVIDER);

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION, outcome.terminal());
        assertEquals(0, harness.adapter.openCount());
        assertTrue(outcome.audits().isEmpty());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void quotaExhaustionDegradesToZeroLlmWithoutProviderAttempt() {
        Harness harness = harness(false, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"));
        quota.provision("owner-1", 0);

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.ZERO_LLM_COMPLETED, outcome.terminal());
        assertEquals(0, harness.adapter.openCount());
        assertTrue(outcome.audits().isEmpty());
        assertFalse(outcome.externalAttemptCreated());
        assertEquals(DeterministicSafetyResponse.ZERO_LLM_FALLBACK, outcome.response());
        assertEquals(0L, quota.remaining("owner-1"));
    }

    private Harness harness(
            boolean denyExecution,
            Function<InvocationBinding, List<ModelProtocolEvent>> script,
            Map<ProviderId, String> supplierNames) {
        return harness(denyExecution, script, supplierNames, false, PROVIDER);
    }

    private Harness harness(
            boolean denyExecution,
            Function<InvocationBinding, List<ModelProtocolEvent>> script,
            Map<ProviderId, String> supplierNames,
            boolean emptyLocator) {
        return harness(denyExecution, script, supplierNames, emptyLocator, PROVIDER);
    }

    private Harness harness(
            boolean denyExecution,
            Function<InvocationBinding, List<ModelProtocolEvent>> script,
            Map<ProviderId, String> supplierNames,
            boolean emptyLocator,
            ProviderId snapshotProvider) {
        quota.provision("owner-1", 5);
        ScriptedAdapter adapter = new ScriptedAdapter(
                ModelProtocol.OPENAI_CHAT_COMPLETIONS, CAPABILITIES, script);

        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        ProviderRegistration registration = new ProviderRegistration(
                PROVIDER, adapter.protocol(), CAPABILITIES, adapter);
        registry.register(registration);
        if (!snapshotProvider.equals(PROVIDER)) {
            // Also admit the snapshot's provider so the authorization guard
            // passes and only the new provider-binding check must fail.
            registry.register(new ProviderRegistration(
                    snapshotProvider,
                    adapter.protocol(),
                    CAPABILITIES,
                    new ScriptedAdapter(
                            ModelProtocol.OPENAI_CHAT_COMPLETIONS, CAPABILITIES, script)));
        }

        InMemoryAuthorizationSnapshotStore store = new InMemoryAuthorizationSnapshotStore();
        store.put(snapshot("snap-req", AuthorizationStatus.ACTIVE, snapshotProvider));
        store.put(denyExecution
                ? snapshot("snap-exec", AuthorizationStatus.WITHDRAWN, snapshotProvider)
                : snapshot("snap-exec", AuthorizationStatus.ACTIVE, snapshotProvider));

        ExecutionAuthorizationGuard guard = new ExecutionAuthorizationGuard(store, registry);
        DeterministicRouter router = new DeterministicRouter(registry, quota);
        GenerationRecovery recovery = new GenerationRecovery(quota);
        AdapterLocator locator = emptyLocator
                ? new InMemoryAdapterLocator(List.of())
                : new InMemoryAdapterLocator(List.of(registration));
        LiveModelInvoker invoker = new LiveModelInvoker(
                router, guard, store, locator, recovery, supplierNames);
        return new Harness(adapter, invoker);
    }

    private static LiveInvocationRequest adequateRequest() {
        return request(routing(ServiceClass.simulated()),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.95));
    }

    private static LiveInvocationRequest inadequateSafetyRequest() {
        return request(routing(ServiceClass.simulated()),
                new ClassifierReport(SafetyClassifierOutcome.LOW_CONFIDENCE, 0.5));
    }

    private static LiveInvocationRequest requestWithServiceClass(ServiceClass serviceClass) {
        return request(routing(serviceClass),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.95));
    }

    private static LiveInvocationRequest request(
            RoutingRequest routingRequest,
            ClassifierReport classifierReport) {
        return request(
                routingRequest,
                List.of(new ProtocolMessage(ProtocolMessage.Role.USER, "hello")),
                classifierReport
        );
    }

    private static LiveInvocationRequest request(
            RoutingRequest routingRequest,
            List<ProtocolMessage> messages) {
        return request(
                routingRequest,
                messages,
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.95)
        );
    }

    private static LiveInvocationRequest request(
            RoutingRequest routingRequest,
            List<ProtocolMessage> messages,
            ClassifierReport classifierReport) {
        return new LiveInvocationRequest(
                routingRequest,
                messages,
                new ResponseMode.Text(),
                true,
                new TimeoutBudget(
                        Duration.ofSeconds(1), Duration.ofSeconds(2), Duration.ofSeconds(3)),
                List.of(),
                classifierReport);
    }

    private static RoutingRequest routing(ServiceClass serviceClass) {
        return new RoutingRequest(
                OWNERSHIP,
                new Entitlement("owner-1", serviceClass),
                ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                CAPABILITIES,
                "snap-req",
                "snap-exec",
                "zero-llm-src",
                42L);
    }

    private static AuthorizationSnapshot snapshot(
            String id, AuthorizationStatus status, ProviderId provider) {
        return new AuthorizationSnapshot(
                new AuthorizationSnapshotId(id),
                status,
                provider,
                REGION,
                CONTRACT,
                PURPOSE,
                CATEGORIES,
                false,
                false);
    }

    /** Script helpers producing deterministic event sequences for one binding. */
    private static final class Scripts {

        static Function<InvocationBinding, List<ModelProtocolEvent>> success(String tail) {
            return binding -> List.of(
                    new ModelProtocolEvent.OutputDelta(
                            binding, 0, new ModelPayload.TextChunk("Hello ")),
                    new ModelProtocolEvent.OutputDelta(
                            binding, 1, new ModelPayload.TextChunk(tail)),
                    new ModelProtocolEvent.UsageReported(
                            binding, 2, new TokenUsage(10, 5, 15)),
                    new ModelProtocolEvent.AttemptEos(binding, 3, StopReason.STOP));
        }
    }

    private static InvocationBinding wrongBinding(InvocationBinding binding) {
        var external = (InvocationBinding.ExternalAttemptBinding) binding;
        return new InvocationBinding.ExternalAttemptBinding(
                external.ownership(),
                external.providerAttemptId() + "-wrong",
                external.fence(),
                external.requestedAuthorizationSnapshotId(),
                external.executionAuthorizationSnapshotId());
    }

    private static final class Harness {

        private final ScriptedAdapter adapter;
        private final LiveModelInvoker invoker;

        Harness(ScriptedAdapter adapter, LiveModelInvoker invoker) {
            this.adapter = adapter;
            this.invoker = invoker;
        }

        LiveAttemptOutcome invoke(LiveInvocationRequest request) {
            return invoker.invoke(request);
        }
    }
}
