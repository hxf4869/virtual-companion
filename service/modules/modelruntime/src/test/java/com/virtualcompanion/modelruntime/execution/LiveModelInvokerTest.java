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
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import com.virtualcompanion.modelruntime.routing.RoutingRequest;
import com.virtualcompanion.modelruntime.routing.ServiceClass;
import com.virtualcompanion.safety.ClassifierReport;
import com.virtualcompanion.safety.DeterministicSafetyResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
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
    void sinkReceivesEveryFencedEventInSessionOrder() {
        Harness harness = harness(false, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"));
        java.util.ArrayList<String> seen = new java.util.ArrayList<>();

        LiveAttemptOutcome outcome = harness.invokeWithSink(adequateRequest(), event -> {
            if (event instanceof ModelProtocolEvent.OutputDelta delta) {
                seen.add(((ModelPayload.TextChunk) delta.payload()).text());
            }
        });

        assertEquals(LiveAttemptTerminal.SUCCEEDED, outcome.terminal());
        assertEquals(List.of("Hello ", "world"), seen);
        // The aggregation is untouched: the sink observes without consuming.
        assertEquals("Hello world", outcome.response());
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
        assertEquals(1, harness.adapter.cancelCount());
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
        assertEquals(1, harness.adapter.cancelCount());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void textSplitSurrogatePairAtExactLimitSucceeds() {
        String first = "a".repeat(SizeLimits.MAX_TOTAL_OUTPUT_BYTES - 4) + "\uD83D";
        String second = "\uDE42";
        Harness harness = harness(
                false,
                binding -> List.of(
                        new ModelProtocolEvent.OutputDelta(
                                binding, 0, new ModelPayload.TextChunk(first)),
                        new ModelProtocolEvent.OutputDelta(
                                binding, 1, new ModelPayload.TextChunk(second)),
                        new ModelProtocolEvent.UsageReported(
                                binding, 2, new TokenUsage(1, 1, 2)),
                        new ModelProtocolEvent.AttemptEos(binding, 3, StopReason.STOP)),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.SUCCEEDED, outcome.terminal());
        assertEquals(first + second, outcome.response());
        assertEquals(2L, outcome.usageOptional().orElseThrow().totalTokens());
        assertEquals(ProviderAttemptStatus.SUCCEEDED,
                outcome.audits().getFirst().status());
        assertEquals(4L, quota.remaining("owner-1"));
    }

    @Test
    void textSplitSurrogatePairOneOverCancelsWithoutPartialOutput() {
        String first = "a".repeat(SizeLimits.MAX_TOTAL_OUTPUT_BYTES - 4) + "\uD83D";
        String offending = "\uDE42b";
        Harness harness = harness(
                false,
                binding -> List.of(
                        new ModelProtocolEvent.OutputDelta(
                                binding, 0, new ModelPayload.TextChunk(first)),
                        new ModelProtocolEvent.OutputDelta(
                                binding, 1, new ModelPayload.TextChunk(offending)),
                        new ModelProtocolEvent.UsageReported(
                                binding, 2, new TokenUsage(1, 1, 2)),
                        new ModelProtocolEvent.AttemptEos(binding, 3, StopReason.STOP)),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.FAILED, outcome.terminal());
        assertTrue(outcome.failureOptional().orElseThrow()
                instanceof AdapterFailure.MalformedResponse);
        assertEquals(DeterministicSafetyResponse.ZERO_LLM_FALLBACK, outcome.response());
        assertTrue(outcome.usageOptional().isEmpty());
        assertEquals(ProviderAttemptStatus.NON_RETRYABLE_FAILED,
                outcome.audits().getFirst().status());
        assertEquals(1, harness.adapter.cancelCount());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void structuredSplitSurrogatePairAtExactLimitSucceeds() {
        String prefix = "{\"value\":\"";
        String suffix = "\"}";
        int asciiBytes = (int) (SizeLimits.MAX_TOTAL_OUTPUT_BYTES
                - SizeLimits.utf8Bytes(prefix)
                - SizeLimits.utf8Bytes(suffix)
                - 4);
        String first = prefix + "a".repeat(asciiBytes) + "\uD83D";
        String second = "\uDE42" + suffix;
        Harness harness = harness(
                false,
                binding -> List.of(
                        new ModelProtocolEvent.OutputDelta(
                                binding, 0, new ModelPayload.StructuredJson(first)),
                        new ModelProtocolEvent.OutputDelta(
                                binding, 1, new ModelPayload.StructuredJson(second)),
                        new ModelProtocolEvent.UsageReported(
                                binding, 2, new TokenUsage(1, 1, 2)),
                        new ModelProtocolEvent.AttemptEos(binding, 3, StopReason.STOP)),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(structuredAdequateRequest());

        assertEquals(LiveAttemptTerminal.SUCCEEDED, outcome.terminal());
        assertEquals(first + second, outcome.response());
        assertEquals(2L, outcome.usageOptional().orElseThrow().totalTokens());
        assertEquals(ProviderAttemptStatus.SUCCEEDED,
                outcome.audits().getFirst().status());
        assertEquals(4L, quota.remaining("owner-1"));
    }

    @Test
    void structuredSplitSurrogatePairOneOverCancelsWithoutPartialOutput() {
        String prefix = "{\"value\":\"";
        String suffix = "\"}";
        int asciiBytes = (int) (SizeLimits.MAX_TOTAL_OUTPUT_BYTES
                - SizeLimits.utf8Bytes(prefix)
                - SizeLimits.utf8Bytes(suffix)
                - 4);
        String first = prefix + "a".repeat(asciiBytes) + "\uD83D";
        String offending = "\uDE42" + suffix + "x";
        Harness harness = harness(
                false,
                binding -> List.of(
                        new ModelProtocolEvent.OutputDelta(
                                binding, 0, new ModelPayload.StructuredJson(first)),
                        new ModelProtocolEvent.OutputDelta(
                                binding, 1, new ModelPayload.StructuredJson(offending)),
                        new ModelProtocolEvent.UsageReported(
                                binding, 2, new TokenUsage(1, 1, 2)),
                        new ModelProtocolEvent.AttemptEos(binding, 3, StopReason.STOP)),
                Map.of(PROVIDER, "OpenAI"));

        LiveAttemptOutcome outcome = harness.invoke(structuredAdequateRequest());

        assertEquals(LiveAttemptTerminal.FAILED, outcome.terminal());
        assertTrue(outcome.failureOptional().orElseThrow()
                instanceof AdapterFailure.MalformedResponse);
        assertEquals(DeterministicSafetyResponse.ZERO_LLM_FALLBACK, outcome.response());
        assertTrue(outcome.usageOptional().isEmpty());
        assertEquals(ProviderAttemptStatus.NON_RETRYABLE_FAILED,
                outcome.audits().getFirst().status());
        assertEquals(1, harness.adapter.cancelCount());
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
        assertTrue(outcome.failureOptional().orElseThrow()
                instanceof AdapterFailure.MalformedResponse);
        assertEquals(ProviderAttemptStatus.NON_RETRYABLE_FAILED,
                outcome.audits().getFirst().status());
        assertEquals(DeterministicSafetyResponse.ZERO_LLM_FALLBACK, outcome.response());
        assertTrue(outcome.usageOptional().isEmpty());
        assertEquals(1, harness.adapter.cancelCount());
        assertEquals(5L, quota.remaining("owner-1"));
    }

    @Test
    void sessionNextFailureCancelsWithoutPartialOutputAndReleasesQuota() {
        Harness harness = harness(
                false,
                binding -> List.of(new ModelProtocolEvent.OutputDelta(
                        binding, 0, new ModelPayload.TextChunk("partial"))),
                Map.of(PROVIDER, "OpenAI"),
                false,
                PROVIDER,
                1,
                new IllegalStateException("scripted session read failure"));

        LiveAttemptOutcome outcome = harness.invoke(adequateRequest());

        assertEquals(LiveAttemptTerminal.FAILED, outcome.terminal());
        assertTrue(outcome.failureOptional().orElseThrow()
                instanceof AdapterFailure.MalformedResponse);
        assertEquals(ProviderAttemptStatus.NON_RETRYABLE_FAILED,
                outcome.audits().getFirst().status());
        assertEquals(DeterministicSafetyResponse.ZERO_LLM_FALLBACK, outcome.response());
        assertTrue(outcome.usageOptional().isEmpty());
        assertEquals(1, harness.adapter.cancelCount());
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

    // ---- TASK-0194: prepare / execute split (transaction boundary) ----

    @Test
    void prepareMaterializesExternalAttemptThenExecuteRunsOnlyTheAdapter() {
        Harness harness = harness(false, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"));

        PreparedInvocation prepared = harness.invoker.prepare(adequateRequest());

        // Prepare materialized the immutable attempt identity + protocol request
        // (all DB reads confined to prepare); nothing was sent yet.
        assertTrue(prepared.isExternal());
        assertEquals("openai-approved", prepared.attempt().providerId());
        assertEquals("OpenAI", prepared.attempt().supplierName());
        assertEquals("snap-req", prepared.attempt().requestedAuthorizationSnapshotId());
        assertEquals("snap-exec", prepared.attempt().executionAuthorizationSnapshotId());
        assertTrue(prepared.attempt().providerAttemptId().startsWith("pa-"));
        org.junit.jupiter.api.Assertions.assertNotNull(prepared.protocolRequest());
        assertEquals(0, harness.adapter.openCount());

        // Execute consumes only the immutable object (adapter/session).
        LiveAttemptOutcome outcome = harness.invoker.execute(prepared);

        assertEquals(LiveAttemptTerminal.SUCCEEDED, outcome.terminal());
        assertEquals("Hello world", outcome.response());
        assertEquals(1, harness.adapter.openCount());
        assertEquals(1, outcome.audits().size());
        assertEquals("OpenAI", outcome.audits().getFirst().supplierName());
    }

    // ---- CANCEL-A: active-invocation registry lifecycle ----

    @Test
    void externalSessionRegistersAndUnregistersInActiveInvocationRegistry() {
        // The registry key is the numeric generation id from the ownership
        // tuple; the session must be registered for the whole external phase
        // and unregistered before execute returns (best-effort signal channel).
        RecordingRegistry registry = new RecordingRegistry();
        Harness harness = harness(
                false, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"), registry);

        LiveAttemptOutcome outcome = harness.invoke(adequateRequestNumericGeneration());

        assertEquals(LiveAttemptTerminal.SUCCEEDED, outcome.terminal());
        assertEquals(List.of(42L), registry.registered);
        assertEquals(List.of(42L), registry.unregistered);
    }

    /** Registry recording register/unregister calls while keeping the real semantics. */
    private static final class RecordingRegistry extends ActiveInvocationRegistry {

        private final java.util.ArrayList<Long> registered = new java.util.ArrayList<>();
        private final java.util.ArrayList<Long> unregistered = new java.util.ArrayList<>();

        @Override
        public void register(long generationId, ModelProtocolSession session) {
            registered.add(generationId);
            super.register(generationId, session);
        }

        @Override
        public void unregister(long generationId, ModelProtocolSession session) {
            unregistered.add(generationId);
            super.unregister(generationId, session);
        }
    }

    @Test
    void executeNeverPerformsAuthorizationStoreReads() {
        // The only database read of the invocation path (execution-snapshot
        // lookup) must happen inside prepare; execute must add none.
        AtomicInteger finds = new AtomicInteger();
        InMemoryAuthorizationSnapshotStore inner = new InMemoryAuthorizationSnapshotStore();
        inner.put(snapshot("snap-req", AuthorizationStatus.ACTIVE, PROVIDER));
        inner.put(snapshot("snap-exec", AuthorizationStatus.ACTIVE, PROVIDER));
        com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotStore countingStore =
                new com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotStore() {
                    @Override
                    public Optional<AuthorizationSnapshot> find(AuthorizationSnapshotId id) {
                        finds.incrementAndGet();
                        return inner.find(id);
                    }

                    @Override
                    public AuthorizationSnapshot put(AuthorizationSnapshot snapshot) {
                        return inner.put(snapshot);
                    }

                    @Override
                    public AuthorizationSnapshot withdraw(AuthorizationSnapshotId id) {
                        return inner.withdraw(id);
                    }

                    @Override
                    public AuthorizationSnapshot narrow(
                            AuthorizationSnapshotId id, AuthorizationSnapshot narrowed) {
                        return inner.narrow(id, narrowed);
                    }
                };

        quota.provision("owner-1", 5);
        ScriptedAdapter adapter = new ScriptedAdapter(
                ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                CAPABILITIES,
                Scripts.success("world"));
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        ProviderRegistration registration = new ProviderRegistration(
                PROVIDER, adapter.protocol(), CAPABILITIES, adapter);
        registry.register(registration);
        ExecutionAuthorizationGuard guard = new ExecutionAuthorizationGuard(countingStore, registry);
        DeterministicRouter router = new DeterministicRouter(registry, quota);
        GenerationRecovery recovery = new GenerationRecovery(quota);
        LiveModelInvoker invoker = new LiveModelInvoker(
                router,
                guard,
                countingStore,
                new InMemoryAdapterLocator(List.of(registration)),
                recovery,
                Map.of(PROVIDER, "OpenAI"));

        PreparedInvocation prepared = invoker.prepare(adequateRequest());
        int findsAfterPrepare = finds.get();
        assertTrue(findsAfterPrepare >= 1);

        LiveAttemptOutcome outcome = invoker.execute(prepared);

        assertEquals(LiveAttemptTerminal.SUCCEEDED, outcome.terminal());
        assertEquals(findsAfterPrepare, finds.get()); // execute added no store reads
    }

    @Test
    void prepareBlocksBeforeOutboundWhenExecutionSnapshotMissing() {
        Harness harness = harness(false, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"));

        // The execution snapshot id is absent from the store: the guard must
        // deny inside prepare, before the adapter is ever opened.
        PreparedInvocation prepared = harness.invoker.prepare(request(
                routingWithSnapshots("snap-req", "snap-exec-missing"),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.95)));

        assertFalse(prepared.isExternal());
        assertEquals(LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION, prepared.terminal());
        assertEquals(0, harness.adapter.openCount());

        LiveAttemptOutcome outcome = harness.invoker.execute(prepared);
        assertEquals(LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION, outcome.terminal());
        assertTrue(outcome.audits().isEmpty());
        assertEquals(0, harness.adapter.openCount());
    }

    @Test
    void prepareBlocksBeforeOutboundOnProviderDrift() {
        Harness harness = harness(
                false,
                Scripts.success("world"),
                Map.of(PROVIDER, "OpenAI"),
                false,
                OTHER_PROVIDER);

        PreparedInvocation prepared = harness.invoker.prepare(adequateRequest());

        // The execution snapshot names a different provider: prepare fails
        // closed with no outbound transfer.
        assertFalse(prepared.isExternal());
        assertEquals(LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION, prepared.terminal());
        assertEquals(0, harness.adapter.openCount());
    }

    @Test
    void prepareDeniesAdapterMisconfigurationWithoutOutbound() {
        Harness harness = harness(false, Scripts.success("world"), Map.of(PROVIDER, "OpenAI"), true);

        PreparedInvocation prepared = harness.invoker.prepare(adequateRequest());

        // Adapter resolution failure happens in prepare: terminal-only FAILED,
        // no outbound, no audit (no provider_attempt was created).
        assertFalse(prepared.isExternal());
        assertEquals(LiveAttemptTerminal.FAILED, prepared.terminal());
        assertEquals(0, harness.adapter.openCount());

        LiveAttemptOutcome outcome = harness.invoker.execute(prepared);
        assertEquals(LiveAttemptTerminal.FAILED, outcome.terminal());
        assertTrue(outcome.audits().isEmpty());
        assertEquals(0, harness.adapter.openCount());
    }

    private static RoutingRequest routingWithSnapshots(String requestedId, String executionId) {
        return new RoutingRequest(
                OWNERSHIP,
                new Entitlement("owner-1", ServiceClass.simulated()),
                ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                CAPABILITIES,
                requestedId,
                executionId,
                "zero-llm-src",
                42L);
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
        return harness(
                denyExecution,
                script,
                supplierNames,
                emptyLocator,
                snapshotProvider,
                -1,
                null,
                new ActiveInvocationRegistry());
    }

    private Harness harness(
            boolean denyExecution,
            Function<InvocationBinding, List<ModelProtocolEvent>> script,
            Map<ProviderId, String> supplierNames,
            boolean emptyLocator,
            ProviderId snapshotProvider,
            int nextFailureAfterEvents,
            RuntimeException nextFailure) {
        return harness(
                denyExecution,
                script,
                supplierNames,
                emptyLocator,
                snapshotProvider,
                nextFailureAfterEvents,
                nextFailure,
                new ActiveInvocationRegistry());
    }

    private Harness harness(
            boolean denyExecution,
            Function<InvocationBinding, List<ModelProtocolEvent>> script,
            Map<ProviderId, String> supplierNames,
            ActiveInvocationRegistry registry) {
        return harness(
                denyExecution,
                script,
                supplierNames,
                false,
                PROVIDER,
                -1,
                null,
                registry);
    }

    private Harness harness(
            boolean denyExecution,
            Function<InvocationBinding, List<ModelProtocolEvent>> script,
            Map<ProviderId, String> supplierNames,
            boolean emptyLocator,
            ProviderId snapshotProvider,
            int nextFailureAfterEvents,
            RuntimeException nextFailure,
            ActiveInvocationRegistry activeInvocationRegistry) {
        quota.provision("owner-1", 5);
        ScriptedAdapter adapter = new ScriptedAdapter(
                ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                CAPABILITIES,
                script,
                nextFailureAfterEvents,
                nextFailure);

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
                router, guard, store, locator, recovery, supplierNames, activeInvocationRegistry);
        return new Harness(adapter, invoker, activeInvocationRegistry);
    }

    private static LiveInvocationRequest adequateRequest() {
        return request(routing(ServiceClass.simulated()),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.95));
    }

    /** Adequate request whose generation id is numeric (registry-key parseable). */
    private static LiveInvocationRequest adequateRequestNumericGeneration() {
        RoutingRequest routing = new RoutingRequest(
                new OwnershipTuple("owner-1", "rel-1", "conv-1", "42"),
                new Entitlement("owner-1", ServiceClass.simulated()),
                ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                CAPABILITIES,
                "snap-req",
                "snap-exec",
                "zero-llm-src",
                42L);
        return request(routing,
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.95));
    }

    private static LiveInvocationRequest structuredAdequateRequest() {
        return request(
                routing(ServiceClass.simulated()),
                List.of(new ProtocolMessage(ProtocolMessage.Role.USER, "hello")),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.95),
                new ResponseMode.StructuredJson("schema", "{\"type\":\"object\"}")
        );
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
        return request(
                routingRequest,
                messages,
                classifierReport,
                new ResponseMode.Text());
    }

    private static LiveInvocationRequest request(
            RoutingRequest routingRequest,
            List<ProtocolMessage> messages,
            ClassifierReport classifierReport,
            ResponseMode responseMode) {
        return new LiveInvocationRequest(
                routingRequest,
                messages,
                responseMode,
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
        private final ActiveInvocationRegistry activeInvocations;

        Harness(
                ScriptedAdapter adapter,
                LiveModelInvoker invoker,
                ActiveInvocationRegistry activeInvocations) {
            this.adapter = adapter;
            this.invoker = invoker;
            this.activeInvocations = activeInvocations;
        }

        LiveAttemptOutcome invoke(LiveInvocationRequest request) {
            return invoker.invoke(request);
        }

        LiveAttemptOutcome invokeWithSink(
                LiveInvocationRequest request, Consumer<ModelProtocolEvent> sink) {
            return invoker.execute(invoker.prepare(request), sink);
        }
    }
}
