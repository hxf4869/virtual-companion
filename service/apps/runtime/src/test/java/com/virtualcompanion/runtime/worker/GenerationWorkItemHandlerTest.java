package com.virtualcompanion.runtime.worker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.catalog.ProviderAttemptStatus;
import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.ExternalAttemptBinding;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import com.virtualcompanion.modelruntime.execution.LiveAttemptOutcome;
import com.virtualcompanion.modelruntime.execution.LiveAttemptTerminal;
import com.virtualcompanion.modelruntime.execution.LiveInvocationRequest;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.modelruntime.execution.PreparedInvocation;
import com.virtualcompanion.modelruntime.execution.ProviderAttemptAudit;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.routing.Entitlement;
import com.virtualcompanion.modelruntime.routing.QuotaDisposition;
import com.virtualcompanion.modelruntime.routing.QuotaReservation;
import com.virtualcompanion.modelruntime.routing.RecoveryOutcome;
import com.virtualcompanion.modelruntime.routing.RecoveryTerminal;
import com.virtualcompanion.modelruntime.routing.RouteDecision;
import com.virtualcompanion.modelruntime.routing.RoutingRequest;
import com.virtualcompanion.modelruntime.routing.ServiceClass;
import com.virtualcompanion.platform.persistence.AuthorizationSnapshotProvider;
import com.virtualcompanion.platform.persistence.ConversationRepository;
import com.virtualcompanion.platform.persistence.ConversationSummaryService;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.JdbcProductQuotaBook;
import com.virtualcompanion.platform.persistence.MessageRepository;
import com.virtualcompanion.platform.persistence.ModelCostReservationService;
import com.virtualcompanion.platform.persistence.RealtimeEventRepository;
import com.virtualcompanion.platform.persistence.SafetyEventService;
import com.virtualcompanion.platform.persistence.WorkItemClaim;
import com.virtualcompanion.platform.persistence.WorkItemClaimService;
import com.virtualcompanion.platform.persistence.WorkItemEnqueueService;
import com.virtualcompanion.runtime.realtime.LiveDeltaBroker;
import com.virtualcompanion.safety.ClassifierReport;
import com.virtualcompanion.safety.CompositeSafetyClassifier;
import com.virtualcompanion.safety.DeterministicSafetyClassifier;
import com.virtualcompanion.safety.DeterministicSafetyResponse;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

/**
 * Unit tests for {@link GenerationWorkItemHandler} (TASK-0174 wiring, TASK-0176
 * ZERO_LLM completion, TASK-0194 segmented transaction boundary). The handler
 * runs inside the worker's segment-executor channel; each segment is a separate
 * owner-bound transaction: prepare-tx (promote + intent before outbound),
 * external-no-db (invoker execute only), audit-outcome-tx, guarded-finalize-tx
 * / guarded-fail-tx (explicit claim guard first). Verifies: non-GENERATION
 * items are skipped; providers-disabled degrades through the guarded fail tx;
 * ZERO_LLM and external success paths finalize atomically with the guard and
 * the per-item complete; degraded outcomes fail guarded with the outcome
 * intent recorded; an intent creation failure forbids the outbound (execute
 * never called); a guard failure throws (worker applies the independent fail).
 */
class GenerationWorkItemHandlerTest {

    private static final String FALLBACK = DeterministicSafetyResponse.ZERO_LLM_FALLBACK;

    /** EXTERNAL-LEASE: the lease the handler applies to external attempts. */
    private static final int EXTERNAL_LEASE_SECONDS = 300;

    private final GenerationStateService stateService = mock(GenerationStateService.class);
    private final GenerationFinalizeService finalizeService = mock(GenerationFinalizeService.class);
    private final LiveInvocationAssembler assembler = mock(LiveInvocationAssembler.class);
    private final WorkItemEnqueueService enqueueService = mock(WorkItemEnqueueService.class);
    private final WorkItemClaimService claimService = mock(WorkItemClaimService.class);
    private final RealtimeEventRepository realtimeEventRepository = mock(RealtimeEventRepository.class);
    private final LiveDeltaBroker deltaBroker = mock(LiveDeltaBroker.class);
    private final ConversationRepository conversationRepository = mock(ConversationRepository.class);
    private final GenerationRepository generationRepository = mock(GenerationRepository.class);
    /** DOGFOOD-STABILIZATION-03 (defect A): deps of the REAL assembler. */
    private final org.springframework.jdbc.core.JdbcTemplate jdbcTemplate =
            mock(org.springframework.jdbc.core.JdbcTemplate.class);
    private final MessageRepository messageRepository = mock(MessageRepository.class);
    private final java.util.concurrent.atomic.AtomicReference<LiveInvocationRequest>
            requestCapture = new java.util.concurrent.atomic.AtomicReference<>();
    // SAFETY-WIRE: the real deterministic classifier (pure, no I/O) so the
    // existing fixtures flow through the same gate as production.
    private com.virtualcompanion.safety.SafetyClassifierPort safetyClassifier =
            new DeterministicSafetyClassifier();
    // DOGFOOD-04 (ADR-0006 §5.1): the streaming incremental review uses a
    // dedicated local-only classifier, mirroring the production wiring.
    private com.virtualcompanion.safety.SafetyClassifierPort incrementalSafetyClassifier =
            new DeterministicSafetyClassifier();
    private final SafetyEventService safetyEventService = mock(SafetyEventService.class);
    private final ConversationSummaryService summaryService =
            mock(ConversationSummaryService.class);

    @SuppressWarnings("unchecked")
    private final ObjectProvider<LiveModelInvoker> invokerProvider = mock(ObjectProvider.class);

    @SuppressWarnings("unchecked")
    private final ObjectProvider<AuthorizationSnapshotProvider> snapshotProvider = mock(ObjectProvider.class);

    private final JdbcProductQuotaBook productQuotaBook = mock(JdbcProductQuotaBook.class);

    /** METRICS-ALERT: in-memory registry so terminal counters are assertable. */
    private final io.micrometer.core.instrument.simple.SimpleMeterRegistry metricsRegistry =
            new io.micrometer.core.instrument.simple.SimpleMeterRegistry();

    private GenerationWorkItemHandler handler;
    /** ROUTE-HARDEN §12.8: real in-memory affinity store, asserted after success. */
    private final com.virtualcompanion.modelruntime.routing.SessionDeploymentAffinity
            deploymentAffinity = new com.virtualcompanion.modelruntime.routing.SessionDeploymentAffinity();
    /** Breaker instance under test for supplier-scoped gate assertions. */
    private com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker breakerRef;

    /** Synchronous segment executor: runs each segment immediately (mock has no transactions). */
    private final AtomicInteger ownerSegments = new AtomicInteger();
    private final WorkItemWorker.OwnerExecutor executor = (ownerUserId, work) -> {
        ownerSegments.incrementAndGet();
        work.run();
    };

    @BeforeEach
    void setUp() {
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(3, 60_000));
        when(invokerProvider.getIfAvailable()).thenReturn(null);
        when(snapshotProvider.getIfAvailable()).thenReturn(null);
        when(claimService.renewPerItem(anyLong(), anyString(), anyString(), anyInt()))
                .thenReturn(1);
        when(finalizeService.recordAttemptOutcome(
                anyLong(), anyString(), anyString(), nullable(Long.class), nullable(String.class)))
                .thenReturn(1);
        // INC-MODE: non-incognito by default so the legacy MEM-LOOP tests
        // keep expecting the extract enqueue.
        when(conversationRepository.isIncognitoForGeneration(anyLong(), anyLong()))
                .thenReturn(false);
        when(generationRepository.hasCompletedSiblingVersion(anyLong(), anyLong()))
                .thenReturn(false);
    }

    /** Rebuilds the handler around a specific breaker (gate tests need a custom threshold). */
    private void buildHandler(com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker breaker) {
        handler = new GenerationWorkItemHandler(
                stateService, finalizeService, assembler, invokerProvider, snapshotProvider,
                enqueueService, claimService, EXTERNAL_LEASE_SECONDS,
                realtimeEventRepository, deltaBroker, conversationRepository,
                generationRepository, safetyClassifier, incrementalSafetyClassifier,
                safetyEventService,
                summaryService,
                new com.virtualcompanion.runtime.observability.VcMetrics(metricsRegistry),
                com.virtualcompanion.runtime.observability.TestAlerts.noop(),
                breaker,
                deploymentAffinity,
                productQuotaBook);
    }

    private void handle(WorkItemClaim claim) {
        // The worker installs the segment executor around handler.handle.
        WorkItemWorker.withSegmentExecutor(executor, () -> {
            handler.handle(claim);
            return null;
        });
    }

    private static WorkItemClaim generationClaim(long ownerId, long genId) {
        return new WorkItemClaim(ownerId, 1L, "GENERATION", genId, null, "token-1", "FENCE-A");
    }

    /** METRICS-ALERT: current vc_generation_total{result=<tag>} count. */
    private double generationCount(String result) {
        return metricsRegistry.counter("vc_generation_total", "result", result).count();
    }

    // ---- prepared invocation helpers ----

    private static final OwnershipTuple OWN = new OwnershipTuple("1", "9", "5", "10");
    private static final QuotaReservation RES = new QuotaReservation("qr-1", "1", 1L, 99L);

    private static PreparedInvocation zeroLlmPrepared() {
        InvocationBinding binding =
                new InvocationBinding.DeterministicSourceBinding(OWN, "ZERO_LLM_FALLBACK", 0L);
        RouteDecision decision = RouteDecision.selected(
                OWN, "ZERO_LLM_ONLY", null, binding, null, List.of());
        RecoveryOutcome recovery = RecoveryOutcome.of(
                OWN, RecoveryTerminal.ZERO_LLM_COMPLETED, QuotaDisposition.NONE, FALLBACK);
        return PreparedInvocation.terminalOnly(
                decision, binding, LiveAttemptTerminal.ZERO_LLM_COMPLETED, recovery, null);
    }

    private static PreparedInvocation noEligiblePrepared() {
        RouteDecision decision = RouteDecision.noEligible(OWN, "DISABLED", List.of());
        RecoveryOutcome recovery = RecoveryOutcome.of(
                OWN, RecoveryTerminal.NO_CAPACITY_TERMINAL, QuotaDisposition.NONE, "");
        return PreparedInvocation.terminalOnly(
                decision, null, LiveAttemptTerminal.NO_ELIGIBLE_DEPLOYMENT, recovery, null);
    }

    private static PreparedInvocation externalPrepared() {
        InvocationBinding.ExternalAttemptBinding binding =
                new InvocationBinding.ExternalAttemptBinding(
                        OWN, "pa-test-1", 42L, "snap-10-req", "snap-10-exec");
        RouteDecision decision = RouteDecision.selected(
                OWN, "SIMULATED", new ProviderId("alpha-loopback"), binding, RES, List.of());
        ExternalAttemptBinding attempt = new ExternalAttemptBinding(
                OWN, "pa-test-1", 42L, "alpha-loopback", "alpha-supplier",
                "test-model", "test-model-rev", "test-config-v1",
                "companion-chat-v1", "gentle-listener-v1",
                "snap-10-req", "snap-10-exec");
        ModelProtocolRequest protocolRequest = new ModelProtocolRequest(
                binding, List.of(new ProtocolMessage(ProtocolMessage.Role.USER, "hi")),
                new ResponseMode.Text(), false,
                new TimeoutBudget(Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1)));
        return PreparedInvocation.external(
                decision, binding, attempt, protocolRequest, mock(ModelProtocolAdapter.class));
    }

    private static LiveAttemptOutcome zeroLlmOutcome() {
        InvocationBinding binding =
                new InvocationBinding.DeterministicSourceBinding(OWN, "ZERO_LLM_FALLBACK", 0L);
        RouteDecision decision = RouteDecision.selected(
                OWN, "ZERO_LLM_ONLY", null, binding, null, List.of());
        RecoveryOutcome recovery = RecoveryOutcome.of(
                OWN, RecoveryTerminal.ZERO_LLM_COMPLETED, QuotaDisposition.NONE, FALLBACK);
        return LiveAttemptOutcome.zeroLlmCompleted(decision, binding, recovery);
    }

    private static LiveAttemptOutcome succeededOutcome() {
        InvocationBinding.ExternalAttemptBinding binding =
                new InvocationBinding.ExternalAttemptBinding(
                        OWN, "pa-test-1", 42L, "snap-10-req", "snap-10-exec");
        ProviderAttemptAudit audit = new ProviderAttemptAudit(
                "pa-test-1", OWN, "alpha-loopback", "alpha-supplier",
                ProviderAttemptStatus.SUCCEEDED);
        return LiveAttemptOutcome.succeeded(RouteDecision.selected(
                OWN, "SIMULATED", new ProviderId("alpha-loopback"), binding, RES, List.of()),
                binding, audit, "real output", new TokenUsage(42L, 58L, 100L), RES);
    }

    private static LiveAttemptOutcome failedOutcome() {
        InvocationBinding.ExternalAttemptBinding binding =
                new InvocationBinding.ExternalAttemptBinding(
                        OWN, "pa-test-1", 42L, "snap-10-req", "snap-10-exec");
        ProviderAttemptAudit audit = new ProviderAttemptAudit(
                "pa-test-1", OWN, "alpha-loopback", "alpha-supplier",
                ProviderAttemptStatus.NON_RETRYABLE_FAILED);
        RecoveryOutcome recovery = RecoveryOutcome.of(OWN, RecoveryTerminal.ALL_FAILURE_BLOCKED,
                QuotaDisposition.RELEASED, "");
        return LiveAttemptOutcome.failed(RouteDecision.selected(
                OWN, "SIMULATED", new ProviderId("alpha-loopback"), binding, RES, List.of()),
                binding, audit, new AdapterFailure.UpstreamUnavailable(), recovery,
                LiveAttemptTerminal.FAILED);
    }

    private static LiveAttemptOutcome retryableFailedOutcome() {
        InvocationBinding.ExternalAttemptBinding binding =
                new InvocationBinding.ExternalAttemptBinding(
                        OWN, "pa-test-1", 42L, "snap-10-req", "snap-10-exec");
        ProviderAttemptAudit audit = new ProviderAttemptAudit(
                "pa-test-1", OWN, "alpha-loopback", "alpha-supplier",
                ProviderAttemptStatus.RETRYABLE_FAILED);
        RecoveryOutcome recovery = RecoveryOutcome.of(OWN, RecoveryTerminal.ALL_FAILURE_BLOCKED,
                QuotaDisposition.RELEASED, "");
        return LiveAttemptOutcome.failed(RouteDecision.selected(
                OWN, "SIMULATED", new ProviderId("alpha-loopback"), binding, RES, List.of()),
                binding, audit, new AdapterFailure.RateLimited(), recovery,
                LiveAttemptTerminal.FAILED);
    }

    private static LiveInvocationRequest request() {
        RoutingRequest routing = new RoutingRequest(
                OWN,
                new Entitlement("1", ServiceClass.simulated()),
                ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                new ModelProtocolCapabilities(Set.of()),
                "snap-10-req", "snap-10-exec", "ZERO_LLM_FALLBACK", 42L);
        return new LiveInvocationRequest(
                routing,
                List.of(new ProtocolMessage(ProtocolMessage.Role.USER, "hi")),
                new ResponseMode.Text(),
                false,
                new TimeoutBudget(Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1)),
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.80),
                // S0-26: 外发形状的请求按逐条类别声明（单条 USER 文本）。
                com.virtualcompanion.modelruntime.execution.PayloadComposition
                        .allMessageText(1));
    }

    @Test
    void skipsNonGenerationItem() {
        WorkItemClaim claim = new WorkItemClaim(1L, 1L, "OTHER", 10L, null, "token-1", "FENCE-A");
        handle(claim);
        verify(stateService, never()).promote(anyLong(), anyLong(), anyString());
        verify(finalizeService, never()).terminalizeAsFailed(anyLong(), anyLong(), anyString());
    }

    @Test
    void degradesToFailedWhenProvidersDisabled() {
        WorkItemClaim claim = generationClaim(1L, 10L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        when(finalizeService.failWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        handle(claim);

        // prepare-tx promotes; guarded-fail-tx asserts the claim, terminalizes
        // and per-item fails.
        verify(stateService).promote(1L, 10L, GenerationStateService.IN_PROGRESS);
        verify(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");
        verify(finalizeService).terminalizeAsFailed(1L, 10L, "model-providers-disabled");
        verify(finalizeService).failWorkItem(1L, "token-1", "FENCE-A");
        verify(assembler, never()).assemble(anyLong(), anyLong());
        verify(enqueueService, never()).enqueue(anyLong(), anyString(), anyLong());
        assertThat(generationCount("failed")).isEqualTo(1.0);
    }

    @Test
    void completesViaZeroLlmWhenInvokerPresent() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(assembler.assemble(1L, 10L, "FENCE-A")).thenReturn(request());
        when(invoker.prepare(any())).thenReturn(zeroLlmPrepared());
        when(invoker.execute(any(), any())).thenReturn(zeroLlmOutcome());
        when(finalizeService.insertCandidate(1L, 10L, FALLBACK)).thenReturn(777L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(1L, 10L));

        verify(stateService).promote(1L, 10L, GenerationStateService.IN_PROGRESS);
        verify(assembler).assemble(1L, 10L, "FENCE-A");
        verify(invoker).prepare(any());
        verify(invoker).execute(any(), any());
        verify(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");
        verify(finalizeService).insertCandidate(1L, 10L, FALLBACK);
        verify(stateService).promote(1L, 10L, GenerationStateService.FINAL_REVIEW);
        verify(finalizeService).finalizeCompleted(1L, 10L, 777L, FALLBACK, "", false);
        verify(enqueueService).enqueue(1L, MemoryExtractWorkItemHandler.KIND_MEMORY_EXTRACT, 10L);
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
        verify(finalizeService, never()).terminalizeAsFailed(anyLong(), anyLong(), anyString());
        // STREAM-LIVE: the accepted event is durable; no delta block on the
        // deterministic path; the live tail always ends.
        verify(realtimeEventRepository).appendDurableEvent(
                1L, 10L, 0L, "chat.accepted", "{\"generation_id\":10}");
        verify(realtimeEventRepository, never()).advanceSeq(anyLong(), anyLong(), anyInt());
        verify(deltaBroker).publishEnd(10L);
        assertThat(generationCount("completed_zero_llm")).isEqualTo(1.0);
    }

    @Test
    void incognitoConversationSkipsTheMemoryExtractEnqueue() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(assembler.assemble(1L, 10L, "FENCE-A")).thenReturn(request());
        when(invoker.prepare(any())).thenReturn(zeroLlmPrepared());
        when(invoker.execute(any(), any())).thenReturn(zeroLlmOutcome());
        when(finalizeService.insertCandidate(1L, 10L, FALLBACK)).thenReturn(777L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        // INC-MODE: the generation's conversation is incognito.
        when(conversationRepository.isIncognitoForGeneration(1L, 10L)).thenReturn(true);

        handle(generationClaim(1L, 10L));

        // The turn still finalizes; only the MEMORY_EXTRACT enqueue is skipped.
        verify(finalizeService).finalizeCompleted(1L, 10L, 777L, FALLBACK, "", false);
        verify(enqueueService, never()).enqueue(
                1L, MemoryExtractWorkItemHandler.KIND_MEMORY_EXTRACT, 10L);
    }

    @Test
    void regenerateWithCompletedSiblingSkipsTheMemoryExtractEnqueue() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(assembler.assemble(1L, 10L, "FENCE-A")).thenReturn(request());
        when(invoker.prepare(any())).thenReturn(zeroLlmPrepared());
        when(invoker.execute(any(), any())).thenReturn(zeroLlmOutcome());
        when(finalizeService.insertCandidate(1L, 10L, FALLBACK)).thenReturn(777L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        when(generationRepository.hasCompletedSiblingVersion(1L, 10L)).thenReturn(true);

        handle(generationClaim(1L, 10L));

        verify(finalizeService).finalizeCompleted(1L, 10L, 777L, FALLBACK, "", false);
        verify(enqueueService, never()).enqueue(
                1L, MemoryExtractWorkItemHandler.KIND_MEMORY_EXTRACT, 10L);
    }

    @Test
    void terminalizesFailedOnUnexpectedOutcome() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(assembler.assemble(2L, 20L, "FENCE-A")).thenReturn(request());
        when(invoker.prepare(any())).thenReturn(noEligiblePrepared());
        when(invoker.execute(any(), any())).thenReturn(
                LiveAttemptOutcome.noEligibleDeployment(
                        RouteDecision.noEligible(OWN, "DISABLED", List.of()),
                        RecoveryOutcome.of(OWN, RecoveryTerminal.NO_CAPACITY_TERMINAL,
                                QuotaDisposition.NONE, "")));
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        when(finalizeService.failWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(2L, 20L));

        verify(stateService).promote(2L, 20L, GenerationStateService.IN_PROGRESS);
        verify(finalizeService).assertActiveClaim(2L, 1L, "token-1", "FENCE-A");
        verify(finalizeService).terminalizeAsFailed(
                2L, 20L, "zero-llm-unexpected-outcome:NO_ELIGIBLE_DEPLOYMENT");
        verify(finalizeService).failWorkItem(1L, "token-1", "FENCE-A");
        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
        verify(finalizeService, never()).finalizeCompleted(
                anyLong(), anyLong(), anyLong(), anyString(), anyString(), any(Boolean.class));
    }

    // ---- External provider path (TASK-0177 + TASK-0194) ----

    @Test
    void completesViaExternalProviderWithIntentBeforeOutboundAndGuardedFinalize() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any(), any())).thenReturn(succeededOutcome());
        when(finalizeService.insertCandidate(1L, 10L, "real output")).thenReturn(888L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        ModelCostReservationService costs = mock(ModelCostReservationService.class);
        when(costs.enabled()).thenReturn(true);
        when(costs.reserve(
                1L, 1L, "pa-test-1", "alpha-loopback", "test-model", 1L, 8192L))
                .thenReturn(new ModelCostReservationService.Reservation(
                        1L, new BigDecimal("0.300000"), "NONE", true));
        when(costs.settle("pa-test-1", 42L, 58L))
                .thenReturn(new ModelCostReservationService.Settlement(
                        new BigDecimal("0.012345"), true));
        handler.withModelCostReservations(costs, 8192);
        handle(generationClaim(1L, 10L));

        // prepare-tx: promote + snapshots + assemble + prepare + intent BEFORE execute.
        verify(stateService).promote(1L, 10L, GenerationStateService.IN_PROGRESS);
        verify(snapshots).createFor(1L, 10L);
        verify(assembler).assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A");
        verify(invoker).prepare(any());
        verify(finalizeService).createAttemptIntent(
                eq(1L), eq(1L), eq(10L), eq("token-1"), eq("FENCE-A"),
                eq("pa-test-1"), eq("alpha-loopback"), eq("alpha-supplier"),
                eq("snap-10-req"), eq("snap-10-exec"),
                eq("test-model"), eq("test-model-rev"),
                eq("companion-chat-v1"), eq("gentle-listener-v1"), eq("test-config-v1"));
        // external-no-db + audit-outcome-tx.
        verify(invoker).execute(any(), any());
        verify(finalizeService).recordAttemptOutcome(
                1L, "pa-test-1", "SUCCEEDED", null, null);
        // guarded-finalize-tx: guard first, then candidate/promote/finalize/complete.
        verify(costs).reserve(
                1L, 1L, "pa-test-1", "alpha-loopback", "test-model", 1L, 8192L);
        verify(costs).settle("pa-test-1", 42L, 58L);
        verify(productQuotaBook).settle(RES);
        verify(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");
        verify(finalizeService).insertCandidate(1L, 10L, "real output");
        verify(stateService).promote(1L, 10L, GenerationStateService.FINAL_REVIEW);
        verify(finalizeService).finalizeCompletedWithUsage(
                1L, 10L, 888L, "real output", "pa-test-1", 42L, 58L,
                0.012345d, "USD", 1, false);
        verify(enqueueService).enqueue(1L, MemoryExtractWorkItemHandler.KIND_MEMORY_EXTRACT, 10L);
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
        verify(finalizeService, never()).terminalizeAsFailed(anyLong(), anyLong(), anyString());
        // STREAM-LIVE: accepted + the delta seq block are prepared before the outbound.
        verify(realtimeEventRepository).appendDurableEvent(
                1L, 10L, 0L, "chat.accepted", "{\"generation_id\":10}");
        verify(realtimeEventRepository).advanceSeq(1L, 10L, 64);
        verify(deltaBroker).publishEnd(10L);
        assertThat(generationCount("completed")).isEqualTo(1.0);
        assertThat(generationCount("error")).isEqualTo(0.0);
    }

    @Test
    void providerOnlyFinalBlockTerminalizesAsBlockedInsteadOfCrashing() {
        // S0-07: the composite classifier can BLOCK without any hard-rule
        // violation (provider-flagged escalation or fail-closed UNAVAILABLE).
        // The final review must terminalize OUTPUT_BLOCKED with the stable
        // INTERNAL_BLOCK rule id instead of crashing on an empty violations
        // list — a crash would skip terminalization, requeue the item and
        // repeat the provider outbound.
        safetyClassifier = new CompositeSafetyClassifier(
                new DeterministicSafetyClassifier(),
                (stage, text) -> {
                    throw new IllegalStateException("moderation provider down");
                });
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(3, 60_000));
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        // "real output" trips no deterministic hard rule; only the (failing)
        // provider leg blocks — the exact production fail-closed shape.
        when(invoker.execute(any(), any())).thenReturn(succeededOutcome());
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(1L, 10L));

        verify(finalizeService).terminalizeAsBlocked(1L, 10L, "INTERNAL_BLOCK");
        verify(finalizeService, never())
                .insertCandidate(anyLong(), anyLong(), anyString());
        verify(finalizeService, never()).finalizeCompletedWithUsage(
                anyLong(), anyLong(), anyLong(), anyString(),
                anyString(), anyLong(), anyLong(), anyDouble(), anyString(), anyInt(), anyBoolean());
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
        verify(safetyEventService).record(
                eq(1L), eq(10L), anyString(), anyString(), eq("INTERNAL_BLOCK"));
    }

    @Test
    void externalSuccessRecordsSessionDeploymentAffinity() {
        // ROUTE-HARDEN §12.8: a successful turn pins the conversation to the
        // deployment that served it; the next routing decision prefers it.
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any(), any())).thenReturn(succeededOutcome());
        when(finalizeService.insertCandidate(1L, 10L, "real output")).thenReturn(888L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(1L, 10L));

        // OWN carries conversationId "5"; the attempt ran on alpha-loopback.
        org.assertj.core.api.Assertions.assertThat(
                        deploymentAffinity.sticky("5"))
                .contains(new com.virtualcompanion.modelruntime.registry.ProviderId("alpha-loopback"));
    }

    @Test
    void failedExternalAttemptCountsOnTheAttemptSupplierOnly() {
        // ROUTE-HARDEN §12.12: failures are recorded per supplier (the audit's
        // supplierName), never on a global key — other suppliers stay allowed.
        breakerRef = new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 60_000);
        buildHandler(breakerRef);
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any(), any())).thenReturn(failedOutcome());
        when(finalizeService.failWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(1L, 10L));

        // The attempt's supplier tripped (threshold 1)…
        org.assertj.core.api.Assertions.assertThat(breakerRef.circuitOpen("alpha-supplier")).isTrue();
        // …while an unrelated supplier is untouched.
        org.assertj.core.api.Assertions.assertThat(breakerRef.circuitOpen("other-supplier")).isFalse();
    }

    @Test
    void openCircuitGateRefusesOutboundBeforeIntentAndRequeues() {
        // ROUTE-HARDEN §12.12: with the attempt supplier's circuit OPEN, the
        // outbound gate refuses BEFORE the attempt intent is written and the
        // item re-enters the bounded RETRY-A budget instead of dead-looping.
        breakerRef = new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 60_000);
        buildHandler(breakerRef);
        breakerRef.failure("alpha-supplier"); // trip OPEN (threshold 1)
        org.assertj.core.api.Assertions.assertThat(breakerRef.blocked("alpha-supplier")).isTrue();

        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(finalizeService.requeueRetryableFailure(
                anyLong(), anyLong(), anyString(), anyString(), anyInt()))
                .thenReturn("REQUEUED");

        handle(generationClaim(1L, 10L));

        verify(finalizeService).requeueRetryableFailure(
                eq(1L), eq(1L), eq("token-1"), eq("FENCE-A"),
                eq(GenerationWorkItemHandler.MAX_PROVIDER_ATTEMPTS));
        // No intent row, no outbound, no outcome audit.
        verify(finalizeService, never()).createAttemptIntent(
                anyLong(), anyLong(), anyLong(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), anyString());
        verify(invoker, never()).execute(any(), any());
        verify(finalizeService, never()).recordAttemptOutcome(
                anyLong(), anyString(), anyString(), nullable(Long.class), nullable(String.class));
        verify(finalizeService, never()).terminalizeAsFailed(anyLong(), anyLong(), anyString());
        assertThat(generationCount("retried")).isEqualTo(1.0);
    }

    @Test
    void intentCreationFailureForbidsOutbound() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(finalizeService.createAttemptIntent(
                anyLong(), anyLong(), anyLong(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), anyString()))
                .thenThrow(new IllegalStateException("intent insert failed (unique violation)"));

        // The intent write failure aborts the prepare transaction: the adapter
        // phase (invoker.execute) must never run (adapter zero calls).
        assertThrows(IllegalStateException.class,
                () -> handle(generationClaim(1L, 10L)));

        verify(invoker, never()).execute(any(), any());
        verify(productQuotaBook).release(RES);
        verify(finalizeService, never()).recordAttemptOutcome(
                anyLong(), anyString(), anyString(), nullable(Long.class), nullable(String.class));
        verify(finalizeService, never()).assertActiveClaim(anyLong(), anyLong(), anyString(), anyString());
    }

    @Test
    void externalPhaseRunsOutsideAnyTransaction() {
        // Even with an active synchronization context, the handler's external
        // phase (invoker.execute) observes no active database transaction —
        // the worker batch no longer wraps handler calls in a long transaction.
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        doAnswer(invocation -> {
            org.junit.jupiter.api.Assertions.assertFalse(
                    org.springframework.transaction.support.TransactionSynchronizationManager
                            .isActualTransactionActive(),
                    "external phase must run with no active database transaction");
            return succeededOutcome();
        }).when(invoker).execute(any(), any());
        when(finalizeService.insertCandidate(1L, 10L, "real output")).thenReturn(888L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        org.springframework.transaction.support.TransactionSynchronizationManager
                .initSynchronization();
        try {
            handle(generationClaim(1L, 10L));
        } finally {
            org.springframework.transaction.support.TransactionSynchronizationManager
                    .clearSynchronization();
        }

        verify(invoker).execute(any(), any());
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
    }

    @Test
    void auditFailureAfterOutboundReleasesQuotaInFreshSegmentAndPreservesFailure() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any(), any())).thenReturn(succeededOutcome());
        IllegalStateException auditFailure = new IllegalStateException("audit outcome failed");
        when(finalizeService.recordAttemptOutcome(
                1L, "pa-test-1", "SUCCEEDED", null, null))
                .thenThrow(auditFailure);

        RuntimeException thrown = assertThrows(RuntimeException.class,
                () -> handle(generationClaim(1L, 10L)));

        assertThat(thrown).isSameAs(auditFailure);
        // prepare, failing audit, then compensation after the audit segment
        // has unwound: release is never attempted inside the failed segment.
        assertThat(ownerSegments.get()).isEqualTo(3);
        verify(productQuotaBook).release(RES);
        verify(productQuotaBook, never()).settle(RES);
        verify(invoker).execute(any(), any());
        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
    }

    @Test
    void quotaReleaseFailureIsSuppressedWithoutMaskingPostOutboundFailure() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any(), any())).thenReturn(succeededOutcome());
        IllegalStateException auditFailure = new IllegalStateException("audit outcome failed");
        IllegalStateException releaseFailure = new IllegalStateException("quota release failed");
        when(finalizeService.recordAttemptOutcome(
                1L, "pa-test-1", "SUCCEEDED", null, null))
                .thenThrow(auditFailure);
        when(productQuotaBook.release(RES)).thenThrow(releaseFailure);

        RuntimeException thrown = assertThrows(RuntimeException.class,
                () -> handle(generationClaim(1L, 10L)));

        assertThat(thrown).isSameAs(auditFailure);
        assertThat(thrown.getSuppressed()).containsExactly(releaseFailure);
        verify(invoker).execute(any(), any());
        verify(productQuotaBook, never()).settle(RES);
    }

    @Test
    void externalPrepareRenewsClaimLeaseForTheNetworkPhase() {
        // EXTERNAL-LEASE: a real provider turn may outlive the default 30s
        // claim lease; the handler must renew the per-item lease inside the
        // prepare transaction, before the outbound.
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any(), any())).thenReturn(succeededOutcome());
        when(finalizeService.insertCandidate(1L, 10L, "real output")).thenReturn(888L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(1L, 10L));

        // Prepared before the outbound, once, with the configured lease seconds.
        verify(claimService).renewPerItem(1L, "token-1", "FENCE-A", EXTERNAL_LEASE_SECONDS);
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
    }

    @Test
    void leaseRenewalFailureForbidsTheOutbound() {
        // EXTERNAL-LEASE fail closed: a renewal that writes 0 rows means the
        // claim was already lost (expired / overtaken) — the outbound must
        // never start and the handler surfaces the abort to the worker's
        // independent per-item fail.
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(claimService.renewPerItem(1L, "token-1", "FENCE-A", EXTERNAL_LEASE_SECONDS))
                .thenReturn(0);

        assertThrows(IllegalStateException.class,
                () -> handle(generationClaim(1L, 10L)));

        verify(invoker, never()).execute(any(), any());
        verify(finalizeService, never()).createAttemptIntent(
                anyLong(), anyLong(), anyLong(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void recordsOutcomeAndFailsGuardedOnExternalProviderFailure() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any(), any())).thenReturn(failedOutcome());
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        when(finalizeService.failWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(1L, 10L));

        // A real outbound attempt happened: intent outcome recorded (same row),
        // then guarded fail (assert + terminalize + per-item fail).
        verify(finalizeService).recordAttemptOutcome(
                1L, "pa-test-1", "NON_RETRYABLE_FAILED", null, "HTTP_5XX");
        verify(productQuotaBook).release(RES);
        verify(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");
        verify(finalizeService).terminalizeAsFailed(1L, 10L, "external-failed");
        verify(finalizeService).failWorkItem(1L, "token-1", "FENCE-A");
        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
        verify(finalizeService, never()).finalizeCompletedWithUsage(
                anyLong(), anyLong(), anyLong(), any(), any(),
                anyLong(), anyLong(), anyDouble(), any(), anyInt(), anyBoolean());
        assertThat(generationCount("failed")).isEqualTo(1.0);
    }

    @Test
    void requeuesRetryableFailureWithinAttemptBudget() {
        // V29 RETRY-A: a RETRYABLE_FAILED outcome records its audit, then the
        // guarded-retry tx asserts the claim and requeues — the generation
        // stays IN_PROGRESS and the item is never terminalized here.
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        InvocationBinding.ExternalAttemptBinding binding =
                new InvocationBinding.ExternalAttemptBinding(
                        OWN, "pa-test-1", 42L, "snap-10-req", "snap-10-exec");
        doAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Consumer<ModelProtocolEvent> sink = invocation.getArgument(1);
            sink.accept(new ModelProtocolEvent.OutputDelta(
                    binding, 0, new ModelPayload.TextChunk("partial")));
            return retryableFailedOutcome();
        }).when(invoker).execute(any(), any());
        when(finalizeService.requeueRetryableFailure(1L, 1L, "token-1", "FENCE-A", 3))
                .thenReturn(GenerationFinalizeService.RETRY_SCHEDULED);

        handle(generationClaim(1L, 10L));

        verify(finalizeService).recordAttemptOutcome(
                eq(1L), eq("pa-test-1"), eq("RETRYABLE_FAILED"),
                argThat(value -> value != null && value >= 0L), eq("HTTP_429"));
        verify(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");
        verify(finalizeService).requeueRetryableFailure(1L, 1L, "token-1", "FENCE-A", 3);
        verify(finalizeService, never()).terminalizeAsFailed(anyLong(), anyLong(), anyString());
        verify(finalizeService, never()).failWorkItem(anyLong(), anyString(), anyString());
        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
        assertThat(generationCount("retried")).isEqualTo(1.0);
    }

    @Test
    void deadLettersWhenAttemptBudgetExhausted() {
        // V29 RETRY-A exhaustion: the requeue function reports DEAD_LETTERED,
        // so the same guarded transaction terminalizes the generation as
        // FAILED_FINAL with the dead-letter fault (no separate per-item fail).
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any(), any())).thenReturn(retryableFailedOutcome());
        when(finalizeService.requeueRetryableFailure(1L, 1L, "token-1", "FENCE-A", 3))
                .thenReturn(GenerationFinalizeService.DEAD_LETTERED);

        handle(generationClaim(1L, 10L));

        verify(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");
        verify(finalizeService).requeueRetryableFailure(1L, 1L, "token-1", "FENCE-A", 3);
        verify(finalizeService).terminalizeAsFailed(1L, 10L, "external-dead-lettered");
        verify(finalizeService, never()).failWorkItem(anyLong(), anyString(), anyString());
        verify(finalizeService, never()).completeWorkItem(anyLong(), anyString(), anyString());
        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
    }

    @Test
    void guardFailurePropagatesWithoutAnyBusinessWrite() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any(), any())).thenReturn(succeededOutcome());
        doAnswer(invocation -> {
            throw new IllegalStateException("claim not active");
        }).when(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");

        // A stale/overtaken claim aborts the guarded finalize; the worker then
        // applies the independent per-item fail. Nothing else is written.
        assertThrows(IllegalStateException.class,
                () -> handle(generationClaim(1L, 10L)));

        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
        verify(finalizeService, never()).finalizeCompletedWithUsage(
                anyLong(), anyLong(), anyLong(), any(), any(),
                anyLong(), anyLong(), anyDouble(), any(), anyInt(), anyBoolean());
        verify(finalizeService, never()).completeWorkItem(anyLong(), anyString(), anyString());
    }

    // ---- STREAM-LIVE: live delta publication ----

    @Test
    void publishesLiveDeltasThroughTheSinkUsingTheReservedSeqBlockAndEndsTheTail() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(realtimeEventRepository.streamEpoch(1L, 10L)).thenReturn(3L);
        // The block [2, 66) is reserved: deltas get seqs 2, 3, ...
        when(realtimeEventRepository.advanceSeq(1L, 10L, 64)).thenReturn(66L);
        when(finalizeService.insertCandidate(1L, 10L, "real output")).thenReturn(888L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        InvocationBinding.ExternalAttemptBinding binding =
                new InvocationBinding.ExternalAttemptBinding(
                        OWN, "pa-test-1", 42L, "snap-10-req", "snap-10-exec");
        doAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Consumer<ModelProtocolEvent> sink = invocation.getArgument(1);
            // First output is structured rather than text: it is still the
            // attempt's first fenced output for latency telemetry, but it is
            // not published as chat.delta.
            sink.accept(new ModelProtocolEvent.OutputDelta(
                    binding, 0, new ModelPayload.StructuredJson("{\"phase\":\"thinking\"}")));
            sink.accept(new ModelProtocolEvent.OutputDelta(
                    binding, 1, new ModelPayload.TextChunk("Hel")));
            sink.accept(new ModelProtocolEvent.OutputDelta(
                    binding, 2, new ModelPayload.TextChunk("lo")));
            return succeededOutcome();
        }).when(invoker).execute(any(), any());

        handle(generationClaim(1L, 10L));

        verify(realtimeEventRepository).appendDurableEvent(
                1L, 10L, 3L, "chat.accepted", "{\"generation_id\":10}");
        verify(deltaBroker).publish(
                eq(10L), eq(new LiveDeltaBroker.LiveEvent(3L, 2L, "chat.delta", "Hel")));
        verify(deltaBroker).publish(
                eq(10L), eq(new LiveDeltaBroker.LiveEvent(3L, 3L, "chat.delta", "lo")));
        verify(finalizeService).recordAttemptOutcome(
                eq(1L), eq("pa-test-1"), eq("SUCCEEDED"),
                argThat(value -> value != null && value >= 0L), isNull());
        verify(deltaBroker).publishEnd(10L);
    }

    @Test
    void normalizesProviderFailuresWithoutPersistingErrorDetails() {
        assertThat(GenerationWorkItemHandler.normalizedFailureCode(
                new AdapterFailure.RateLimited())).isEqualTo("HTTP_429");
        assertThat(GenerationWorkItemHandler.normalizedFailureCode(
                new AdapterFailure.UpstreamUnavailable())).isEqualTo("HTTP_5XX");
        assertThat(GenerationWorkItemHandler.normalizedFailureCode(
                new AdapterFailure.Disconnected())).isEqualTo("DISCONNECTED");
        assertThat(GenerationWorkItemHandler.normalizedFailureCode(
                new AdapterFailure.Timeout(AdapterFailure.TimeoutPhase.CONNECT)))
                .isEqualTo("TIMEOUT_CONNECT");
        assertThat(GenerationWorkItemHandler.normalizedFailureCode(
                new AdapterFailure.Timeout(AdapterFailure.TimeoutPhase.FIRST_TOKEN)))
                .isEqualTo("TIMEOUT_FIRST_TOKEN");
        assertThat(GenerationWorkItemHandler.normalizedFailureCode(
                new AdapterFailure.Timeout(AdapterFailure.TimeoutPhase.TOTAL)))
                .isEqualTo("TIMEOUT_TOTAL");
        assertThat(GenerationWorkItemHandler.normalizedFailureCode(
                new AdapterFailure.MalformedResponse())).isEqualTo("OTHER");
    }

    @Test
    void stopsPublishingWhenTheReservedSeqBlockIsExhausted() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(realtimeEventRepository.advanceSeq(1L, 10L, 64)).thenReturn(2L);
        when(finalizeService.insertCandidate(1L, 10L, "real output")).thenReturn(888L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        InvocationBinding.ExternalAttemptBinding binding =
                new InvocationBinding.ExternalAttemptBinding(
                        OWN, "pa-test-1", 42L, "snap-10-req", "snap-10-exec");
        doAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Consumer<ModelProtocolEvent> sink = invocation.getArgument(1);
            // More chunks than the reserved block: everything beyond the block
            // is dropped (the client recovers via snapshot — never fabricated).
            for (int i = 0; i < 128; i++) {
                sink.accept(new ModelProtocolEvent.OutputDelta(
                        binding, i, new ModelPayload.TextChunk("x")));
            }
            return succeededOutcome();
        }).when(invoker).execute(any(), any());

        handle(generationClaim(1L, 10L));

        // Exactly DELTA_SEQ_BLOCK publishes (all the reserved seqs consumed).
        verify(deltaBroker, org.mockito.Mockito.times(
                GenerationWorkItemHandler.DELTA_SEQ_BLOCK))
                .publish(eq(10L), any(LiveDeltaBroker.LiveEvent.class));
    }

    // ---- SAFETY-WIRE (V58): final review + incremental gate ----

    private static LiveAttemptOutcome succeededOutcomeWithContent(String content) {
        InvocationBinding.ExternalAttemptBinding binding =
                new InvocationBinding.ExternalAttemptBinding(
                        OWN, "pa-test-1", 42L, "snap-10-req", "snap-10-exec");
        ProviderAttemptAudit audit = new ProviderAttemptAudit(
                "pa-test-1", OWN, "alpha-loopback", "alpha-supplier",
                ProviderAttemptStatus.SUCCEEDED);
        return LiveAttemptOutcome.succeeded(RouteDecision.selected(
                OWN, "SIMULATED", new ProviderId("alpha-loopback"), binding, RES, List.of()),
                binding, audit, content, new TokenUsage(42L, 58L, 100L), RES);
    }

    @Test
    void finalReviewBlocksDisallowedOutputWithoutAnyCompletionWrite() {
        // §20.11 最终复核: the model output trips the human-claim rule — the
        // turn walks FINAL_REVIEW -> OUTPUT_BLOCKED; no candidate, no finalize,
        // no memory extraction; the work item still completes.
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any(), any()))
                .thenReturn(succeededOutcomeWithContent("说实话，我是真人，不像其他 AI。"));
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(1L, 10L));

        verify(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");
        verify(stateService).promote(1L, 10L, GenerationStateService.FINAL_REVIEW);
        verify(finalizeService).terminalizeAsBlocked(
                1L, 10L, "output-ai-identity-human-claim");
        verify(safetyEventService).record(
                1L, 10L, SafetyEventService.STAGE_FINAL, "R3_HIGH",
                "output-ai-identity-human-claim");
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
        verify(finalizeService, never()).finalizeCompletedWithUsage(
                anyLong(), anyLong(), anyLong(), any(), any(),
                anyLong(), anyLong(), anyDouble(), any(), anyInt(), anyBoolean());
        verify(enqueueService, never()).enqueue(anyLong(), anyString(), anyLong());
        assertThat(generationCount("blocked_output")).isEqualTo(1.0);
        assertThat(generationCount("completed")).isEqualTo(0.0);
    }

    @Test
    void incrementalReviewPausesDisallowedFragmentsAndTheFinalBackstopBlocks() {
        // FR-CHAT-001: only reviewed fragments become chat.delta. The paused
        // fragment consumes its seq but is never published; the final review
        // of the full output blocks and records an INCREMENTAL + FINAL event.
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(realtimeEventRepository.streamEpoch(1L, 10L)).thenReturn(3L);
        when(realtimeEventRepository.advanceSeq(1L, 10L, 64)).thenReturn(66L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        InvocationBinding.ExternalAttemptBinding binding =
                new InvocationBinding.ExternalAttemptBinding(
                        OWN, "pa-test-1", 42L, "snap-10-req", "snap-10-exec");
        doAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Consumer<ModelProtocolEvent> sink = invocation.getArgument(1);
            sink.accept(new ModelProtocolEvent.OutputDelta(
                    binding, 0, new ModelPayload.TextChunk("今天聊点开心的吧，")));
            sink.accept(new ModelProtocolEvent.OutputDelta(
                    binding, 1, new ModelPayload.TextChunk("因为我是真人呀。")));
            return succeededOutcomeWithContent("今天聊点开心的吧，因为我是真人呀。");
        }).when(invoker).execute(any(), any());

        handle(generationClaim(1L, 10L));

        // The clean fragment was published; the disallowed one was paused
        // (seq consumed, never on the wire).
        verify(deltaBroker).publish(
                eq(10L), eq(new LiveDeltaBroker.LiveEvent(3L, 2L, "chat.delta", "今天聊点开心的吧，")));
        org.mockito.Mockito.verify(deltaBroker, org.mockito.Mockito.never()).publish(
                eq(10L), eq(new LiveDeltaBroker.LiveEvent(3L, 3L, "chat.delta", "因为我是真人呀。")));
        verify(finalizeService).terminalizeAsBlocked(
                1L, 10L, "output-ai-identity-human-claim");
        verify(safetyEventService).record(
                1L, 10L, SafetyEventService.STAGE_INCREMENTAL, "R3_HIGH",
                "output-ai-identity-human-claim");
        verify(safetyEventService).record(
                1L, 10L, SafetyEventService.STAGE_FINAL, "R3_HIGH",
                "output-ai-identity-human-claim");
    }

    @Test
    void moderationEnabledStreamsLocalOnlyAndHardBlockedOutputMakesZeroRemoteCalls() {
        // DOGFOOD-STABILIZATION audit (ADR-0006 §5.4): with remote moderation
        // on, the streamed fragments are reviewed by the local deterministic
        // rules only (zero incremental remote traffic), and a final output
        // that trips a local hard rule is terminal — the remote leg is never
        // consulted, so locally flagged text cannot leave the host.
        java.util.concurrent.atomic.AtomicInteger providerCalls =
                new java.util.concurrent.atomic.AtomicInteger();
        com.virtualcompanion.safety.SafetyClassifierPort providerStub = (stage, text) -> {
            providerCalls.incrementAndGet();
            return new com.virtualcompanion.safety.SafetyClassification(
                    com.virtualcompanion.catalog.RiskLevel.R0_NORMAL,
                    List.of(),
                    new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.99),
                    com.virtualcompanion.safety.SafetyVerdict.ALLOW);
        };
        safetyClassifier = new CompositeSafetyClassifier(
                new DeterministicSafetyClassifier(), providerStub);
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(3, 60_000));
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(realtimeEventRepository.streamEpoch(1L, 10L)).thenReturn(3L);
        when(realtimeEventRepository.advanceSeq(1L, 10L, 64)).thenReturn(66L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        InvocationBinding.ExternalAttemptBinding binding =
                new InvocationBinding.ExternalAttemptBinding(
                        OWN, "pa-test-1", 42L, "snap-10-req", "snap-10-exec");
        doAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Consumer<ModelProtocolEvent> sink = invocation.getArgument(1);
            sink.accept(new ModelProtocolEvent.OutputDelta(
                    binding, 0, new ModelPayload.TextChunk("今天聊点开心的吧，")));
            sink.accept(new ModelProtocolEvent.OutputDelta(
                    binding, 1, new ModelPayload.TextChunk("因为我是真人呀。")));
            return succeededOutcomeWithContent("今天聊点开心的吧，因为我是真人呀。");
        }).when(invoker).execute(any(), any());

        handle(generationClaim(1L, 10L));

        // The clean fragment was published and the violating one paused by the
        // LOCAL rules only; the hard-rule BLOCK is terminal — zero remote
        // classification calls for the whole turn.
        verify(deltaBroker).publish(
                eq(10L), eq(new LiveDeltaBroker.LiveEvent(3L, 2L, "chat.delta", "今天聊点开心的吧，")));
        org.mockito.Mockito.verify(deltaBroker, org.mockito.Mockito.never()).publish(
                eq(10L), eq(new LiveDeltaBroker.LiveEvent(3L, 3L, "chat.delta", "因为我是真人呀。")));
        verify(finalizeService).terminalizeAsBlocked(
                1L, 10L, "output-ai-identity-human-claim");
        assertThat(providerCalls.get()).isZero();
    }

    @Test
    void moderationEnabledCleanOutputCallsTheRemoteLegExactlyOnce() {
        // DOGFOOD-STABILIZATION audit: clean input (local R0 + ALLOW) is the
        // only text that reaches the remote leg, and the final review of a
        // clean turn is classified remotely exactly once.
        java.util.concurrent.atomic.AtomicInteger providerCalls =
                new java.util.concurrent.atomic.AtomicInteger();
        com.virtualcompanion.safety.SafetyClassifierPort providerStub = (stage, text) -> {
            providerCalls.incrementAndGet();
            assertThat(text).isEqualTo("今天天气不错，我们随便聊聊。");
            return new com.virtualcompanion.safety.SafetyClassification(
                    com.virtualcompanion.catalog.RiskLevel.R0_NORMAL,
                    List.of(),
                    new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.99),
                    com.virtualcompanion.safety.SafetyVerdict.ALLOW);
        };
        safetyClassifier = new CompositeSafetyClassifier(
                new DeterministicSafetyClassifier(), providerStub);
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(3, 60_000));
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(realtimeEventRepository.streamEpoch(1L, 10L)).thenReturn(3L);
        when(realtimeEventRepository.advanceSeq(1L, 10L, 64)).thenReturn(66L);
        when(finalizeService.insertCandidate(1L, 10L, "今天天气不错，我们随便聊聊。"))
                .thenReturn(889L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        InvocationBinding.ExternalAttemptBinding binding =
                new InvocationBinding.ExternalAttemptBinding(
                        OWN, "pa-test-2", 43L, "snap-10-req", "snap-10-exec");
        doAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Consumer<ModelProtocolEvent> sink = invocation.getArgument(1);
            sink.accept(new ModelProtocolEvent.OutputDelta(
                    binding, 0, new ModelPayload.TextChunk("今天天气不错，")));
            sink.accept(new ModelProtocolEvent.OutputDelta(
                    binding, 1, new ModelPayload.TextChunk("我们随便聊聊。")));
            return succeededOutcomeWithContent("今天天气不错，我们随便聊聊。");
        }).when(invoker).execute(any(), any());

        handle(generationClaim(1L, 10L));

        verify(finalizeService).insertCandidate(1L, 10L, "今天天气不错，我们随便聊聊。");
        assertThat(providerCalls.get()).isEqualTo(1);
    }

    // ---- DOGFOOD-STABILIZATION-02: owner context for the FINAL remote leg ----

    /**
     * Mirrors the GUC-enforced SD probes: reading consents/deletion/admission
     * outside an owner-bound transaction throws (V17/V27), exactly like
     * vc.list_consents does in production.
     */
    private static final ThreadLocal<Boolean> GATE_OWNER_CONTEXT =
            ThreadLocal.withInitial(() -> Boolean.FALSE);

    private com.virtualcompanion.safety.SafetyClassifierPort ownerGatedComposite(
            boolean consentGranted,
            boolean consentReadFails,
            java.util.concurrent.atomic.AtomicInteger providerCalls) {
        com.virtualcompanion.runtime.safety.OwnerGatedSafetyClassifier gate =
                new com.virtualcompanion.runtime.safety.OwnerGatedSafetyClassifier(
                        (stage, text) -> {
                            providerCalls.incrementAndGet();
                            org.junit.jupiter.api.Assertions.assertFalse(
                                    GATE_OWNER_CONTEXT.get(),
                                    "the HTTP phase must run outside the owner-bound transaction");
                            return new com.virtualcompanion.safety.SafetyClassification(
                                    com.virtualcompanion.catalog.RiskLevel.R0_NORMAL,
                                    List.of(),
                                    new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.99),
                                    com.virtualcompanion.safety.SafetyVerdict.ALLOW);
                        },
                        (ownerUserId, consentType) -> {
                            org.junit.jupiter.api.Assertions.assertTrue(GATE_OWNER_CONTEXT.get(),
                                    "consent must be read inside the owner-bound transaction");
                            if (consentReadFails) {
                                throw new IllegalStateException("consent store unreadable");
                            }
                            return consentGranted;
                        },
                        ownerUserId -> {
                            org.junit.jupiter.api.Assertions.assertTrue(GATE_OWNER_CONTEXT.get());
                            return false;
                        },
                        providerRef -> {
                            org.junit.jupiter.api.Assertions.assertTrue(GATE_OWNER_CONTEXT.get());
                            return true;
                        },
                        "weixin-channel",
                        false,
                        (ownerUserId, work) -> {
                            GATE_OWNER_CONTEXT.set(Boolean.TRUE);
                            try {
                                work.run();
                            } finally {
                                GATE_OWNER_CONTEXT.set(Boolean.FALSE);
                            }
                        });
        return new CompositeSafetyClassifier(new DeterministicSafetyClassifier(), gate);
    }

    /** Wires one clean external turn producing {@code content} (zero deltas). */
    private void stubExternalTurnWithContent(String content) {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(realtimeEventRepository.streamEpoch(1L, 10L)).thenReturn(3L);
        when(realtimeEventRepository.advanceSeq(1L, 10L, 64)).thenReturn(66L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        when(invoker.execute(any(), any()))
                .thenReturn(succeededOutcomeWithContent(content));
    }

    @Test
    void ownerGatedFinalReviewCompletesCleanTurnOutsideTheWorkerOwnerTransaction() {
        // DOGFOOD-STABILIZATION-02 defect 1: the worker's FINAL classification
        // runs OUTSIDE any owner transaction; the gate must open its own short
        // owner-bound read (the strict probes throw otherwise) and then run
        // the DB-free HTTP phase — a clean turn still completes.
        java.util.concurrent.atomic.AtomicInteger providerCalls =
                new java.util.concurrent.atomic.AtomicInteger();
        safetyClassifier = ownerGatedComposite(true, false, providerCalls);
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0));
        when(finalizeService.insertCandidate(1L, 10L, "今天天气不错，我们随便聊聊。"))
                .thenReturn(889L);
        stubExternalTurnWithContent("今天天气不错，我们随便聊聊。");

        handle(generationClaim(1L, 10L));

        verify(finalizeService).insertCandidate(1L, 10L, "今天天气不错，我们随便聊聊。");
        verify(finalizeService, never()).terminalizeAsBlocked(anyLong(), anyLong(), anyString());
        assertThat(providerCalls.get()).isEqualTo(1);
    }

    @Test
    void ownerGatedFinalReviewMissingConsentBlocksOutputWithZeroRemoteCalls() {
        java.util.concurrent.atomic.AtomicInteger providerCalls =
                new java.util.concurrent.atomic.AtomicInteger();
        safetyClassifier = ownerGatedComposite(false, false, providerCalls);
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0));
        stubExternalTurnWithContent("今天天气不错，我们随便聊聊。");

        handle(generationClaim(1L, 10L));

        verify(finalizeService).terminalizeAsBlocked(1L, 10L, "INTERNAL_BLOCK");
        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
        assertThat(providerCalls.get()).isZero();
    }

    @Test
    void ownerGatedFinalReviewProbeReadFailureFailsClosedWithZeroRemoteCalls() {
        java.util.concurrent.atomic.AtomicInteger providerCalls =
                new java.util.concurrent.atomic.AtomicInteger();
        safetyClassifier = ownerGatedComposite(true, true, providerCalls);
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0));
        stubExternalTurnWithContent("今天天气不错，我们随便聊聊。");

        handle(generationClaim(1L, 10L));

        verify(finalizeService).terminalizeAsBlocked(1L, 10L, "INTERNAL_BLOCK");
        assertThat(providerCalls.get()).isZero();
    }

    @Test
    void sensitiveFinalOutputIsBlockedWithZeroRemoteCallsAndNeverLogged() {
        // DOGFOOD-STABILIZATION-02 defect 2: a model output carrying ordinary
        // personal data (a mobile number — no deterministic hard rule) must
        // not leave the host while the provider terms are unverified, and no
        // log line may carry the output text.
        java.util.concurrent.atomic.AtomicInteger providerCalls =
                new java.util.concurrent.atomic.AtomicInteger();
        safetyClassifier = ownerGatedComposite(true, false, providerCalls);
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0));
        String sensitiveOutput = "好的，你的新号码是 13800138000，记一下。";
        stubExternalTurnWithContent(sensitiveOutput);

        ch.qos.logback.classic.Logger handlerLog = (ch.qos.logback.classic.Logger)
                org.slf4j.LoggerFactory.getLogger(GenerationWorkItemHandler.class);
        ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender =
                new ch.qos.logback.core.read.ListAppender<>();
        appender.start();
        handlerLog.addAppender(appender);
        try {
            handle(generationClaim(1L, 10L));
        } finally {
            handlerLog.detachAppender(appender);
        }

        verify(finalizeService).terminalizeAsBlocked(1L, 10L, "INTERNAL_BLOCK");
        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
        assertThat(providerCalls.get()).isZero();
        assertThat(appender.list).isNotEmpty();
        assertThat(appender.list)
                .allSatisfy(event ->
                        org.assertj.core.api.Assertions
                                .assertThat(event.getFormattedMessage())
                                .doesNotContain("13800138000"));
    }

    // ---- GEN-RECONC (V33) ----

    @Test
    void rerunOfPrepareSkipsDuplicateAcceptedEvent() {
        // RETRY-A / crash-recovery re-run: the durable chat.accepted already
        // exists, so the prepare segment must not append a second one.
        when(realtimeEventRepository.hasDurableEvent(1L, 10L, "chat.accepted"))
                .thenReturn(true);
        when(realtimeEventRepository.streamEpoch(1L, 10L)).thenReturn(3L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        when(finalizeService.failWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(1L, 10L));

        verify(realtimeEventRepository, never()).appendDurableEvent(
                anyLong(), anyLong(), anyLong(), eq("chat.accepted"), anyString());
    }

    @Test
    void firstRunAppendsAcceptedAndClosesStaleIntentsBeforeTheNewIntent() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any(), any())).thenReturn(succeededOutcome());
        when(finalizeService.insertCandidate(1L, 10L, "real output")).thenReturn(888L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(1L, 10L));

        verify(realtimeEventRepository).hasDurableEvent(1L, 10L, "chat.accepted");
        verify(realtimeEventRepository).appendDurableEvent(
                1L, 10L, 0L, "chat.accepted", "{\"generation_id\":10}");
        org.mockito.InOrder inOrder = org.mockito.Mockito.inOrder(finalizeService);
        // Stale CREATED intents of a re-run are closed before the new intent
        // is persisted (the audit trail never ends on an open intent).
        inOrder.verify(finalizeService).closeStaleAttemptIntents(1L, 1L);
        inOrder.verify(finalizeService).createAttemptIntent(
                eq(1L), eq(1L), eq(10L), eq("token-1"), eq("FENCE-A"),
                eq("pa-test-1"), eq("alpha-loopback"), eq("alpha-supplier"),
                eq("snap-10-req"), eq("snap-10-exec"),
                eq("test-model"), eq("test-model-rev"),
                eq("companion-chat-v1"), eq("gentle-listener-v1"), eq("test-config-v1"));
    }

    // ---- DOGFOOD-05 (ADR-0006 §3.4): canary metrics + safety-leak disable ----

    /** Stub classifier returning one fixed verdict for the FINAL review. */
    private static com.virtualcompanion.safety.SafetyClassifierPort classifierReturning(
            com.virtualcompanion.catalog.RiskLevel risk,
            com.virtualcompanion.safety.SafetyVerdict verdict,
            String ruleId) {
        return (stage, text) -> new com.virtualcompanion.safety.SafetyClassification(
                risk,
                ruleId == null ? List.of() : List.of(ruleId),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.99),
                verdict);
    }

    private void wireExternalSuccessPath(LiveAttemptOutcome outcome) {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any(), any())).thenReturn(outcome);
        when(finalizeService.insertCandidate(1L, 10L, "real output")).thenReturn(888L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
    }

    @Test
    void r4FinalReviewDurablyDisablesTheServingDeploymentExactlyOnce() {
        // DOGFOOD-05 (ADR-0006 §3.4): a FINAL output verdict of R4_IMMINENT is
        // the operationalized safety leak; the deployment that actually served
        // the attempt is durably disabled AFTER the blocked finalize.
        safetyClassifier = classifierReturning(
                com.virtualcompanion.catalog.RiskLevel.R4_IMMINENT,
                com.virtualcompanion.safety.SafetyVerdict.BLOCK,
                "output-crisis-escalation");
        com.virtualcompanion.runtime.observability.SafetyLeakProviderDisabler disabler =
                mock(com.virtualcompanion.runtime.observability.SafetyLeakProviderDisabler.class);
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(
                3, 60_000));
        handler.withSafetyLeakDisabler(disabler);
        wireExternalSuccessPath(succeededOutcome());

        handle(generationClaim(1L, 10L));

        verify(disabler).disableDeployment("alpha-loopback");
        assertThat(generationCount("blocked_output")).isEqualTo(1.0);
    }

    @Test
    void r3FinalReviewBlockDoesNotTriggerTheSafetyLeakDisabler() {
        // Only R4 is a safety leak; a plain R3 block stays a normal
        // OUTPUT_BLOCKED turn without any durable provider disable.
        safetyClassifier = classifierReturning(
                com.virtualcompanion.catalog.RiskLevel.R3_HIGH,
                com.virtualcompanion.safety.SafetyVerdict.BLOCK,
                "output-ai-identity-human-claim");
        com.virtualcompanion.runtime.observability.SafetyLeakProviderDisabler disabler =
                mock(com.virtualcompanion.runtime.observability.SafetyLeakProviderDisabler.class);
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(
                3, 60_000));
        handler.withSafetyLeakDisabler(disabler);
        wireExternalSuccessPath(succeededOutcome());

        handle(generationClaim(1L, 10L));

        verify(disabler, never()).disableDeployment(anyString());
    }

    @Test
    void allowedFinalReviewNeverTouchesTheSafetyLeakDisabler() {
        com.virtualcompanion.runtime.observability.SafetyLeakProviderDisabler disabler =
                mock(com.virtualcompanion.runtime.observability.SafetyLeakProviderDisabler.class);
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(
                3, 60_000));
        handler.withSafetyLeakDisabler(disabler);
        wireExternalSuccessPath(succeededOutcome());

        handle(generationClaim(1L, 10L));

        verify(disabler, never()).disableDeployment(anyString());
    }

    @Test
    void completedExternalAttemptRecordsCanarySuccess() {
        com.virtualcompanion.runtime.observability.RollingOutcomeWindow window =
                new com.virtualcompanion.runtime.observability.RollingOutcomeWindow(
                        metricsRegistry);
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(
                3, 60_000));
        handler.withCanaryOutcomeWindow(window);
        wireExternalSuccessPath(succeededOutcome());

        handle(generationClaim(1L, 10L));

        assertThat(window.total()).isEqualTo(1);
        assertThat(window.successRate()).isEqualTo(1.0);
        assertThat(generationCount("completed")).isEqualTo(1.0);
    }

    @Test
    void blockedExternalAttemptRecordsCanaryFailure() {
        safetyClassifier = classifierReturning(
                com.virtualcompanion.catalog.RiskLevel.R3_HIGH,
                com.virtualcompanion.safety.SafetyVerdict.BLOCK,
                "output-ai-identity-human-claim");
        com.virtualcompanion.runtime.observability.RollingOutcomeWindow window =
                new com.virtualcompanion.runtime.observability.RollingOutcomeWindow(
                        metricsRegistry);
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(
                3, 60_000));
        handler.withCanaryOutcomeWindow(window);
        wireExternalSuccessPath(succeededOutcome());

        handle(generationClaim(1L, 10L));

        assertThat(window.total()).isEqualTo(1);
        assertThat(window.successRate()).isEqualTo(0.0);
    }

    @Test
    void blockedOutputNeverRecordsTheSupplierCircuitSuccess() {
        // DOGFOOD-STABILIZATION audit (ADR-0006 §3.4): the circuit success is
        // recorded only AFTER the final safety review passes. Pre-trip the
        // breaker with zero cooldown (so the half-open probe lets THIS turn
        // through), then run a turn whose output the final review BLOCKS —
        // a recorded success would close the circuit, so OPEN proves none
        // was recorded.
        safetyClassifier = classifierReturning(
                com.virtualcompanion.catalog.RiskLevel.R3_HIGH,
                com.virtualcompanion.safety.SafetyVerdict.BLOCK,
                "output-ai-identity-human-claim");
        breakerRef = new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(
                1, 0);
        buildHandler(breakerRef);
        breakerRef.failure("alpha-supplier"); // trip OPEN (threshold 1)
        org.assertj.core.api.Assertions.assertThat(breakerRef.circuitOpen("alpha-supplier"))
                .isTrue();
        wireExternalSuccessPath(succeededOutcome());

        handle(generationClaim(1L, 10L));

        org.assertj.core.api.Assertions.assertThat(breakerRef.circuitOpen("alpha-supplier"))
                .as("a blocked final output must not record the supplier circuit success")
                .isTrue();
        verify(finalizeService).terminalizeAsBlocked(
                1L, 10L, "output-ai-identity-human-claim");
    }

    @Test
    void allowedOutputRecordsTheSupplierCircuitSuccessAfterFinalReview() {
        breakerRef = new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(
                1, 0);
        buildHandler(breakerRef);
        breakerRef.failure("alpha-supplier"); // trip OPEN; zero cooldown → probeable
        wireExternalSuccessPath(succeededOutcome());

        handle(generationClaim(1L, 10L));

        org.assertj.core.api.Assertions.assertThat(breakerRef.circuitOpen("alpha-supplier"))
                .as("a clean turn closes the supplier circuit after the final review")
                .isFalse();
    }

    @Test
    void zeroLlmCompletionNeverEntersTheCanaryWindow() {
        // The canary bar reviews REAL provider attempts only; the ZERO_LLM
        // deterministic path records no sample and no first-token latency.
        com.virtualcompanion.runtime.observability.RollingOutcomeWindow window =
                new com.virtualcompanion.runtime.observability.RollingOutcomeWindow(
                        metricsRegistry);
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(
                3, 60_000));
        handler.withCanaryOutcomeWindow(window);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(null);
        when(assembler.assemble(1L, 10L, "FENCE-A")).thenReturn(request());
        when(invoker.prepare(any())).thenReturn(zeroLlmPrepared());
        when(invoker.execute(any(), any())).thenReturn(zeroLlmOutcome());
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(1L, 10L));

        assertThat(window.total()).isZero();
        assertThat(generationCount("completed_zero_llm")).isEqualTo(1.0);
        assertThat(metricsRegistry.timer("vc_generation_first_token").count()).isZero();
    }

    @Test
    void streamedFirstDeltaRecordsFirstTokenLatency() {
        // DOGFOOD-05: the first accepted OutputDelta feeds the first-token
        // timer exactly once per work item.
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(
                3, 60_000));
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternalInvocation(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request(), java.util.List.of()));
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(realtimeEventRepository.streamEpoch(1L, 10L)).thenReturn(3L);
        when(realtimeEventRepository.advanceSeq(1L, 10L, 64)).thenReturn(66L);
        when(finalizeService.insertCandidate(1L, 10L, "real output")).thenReturn(888L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        InvocationBinding.ExternalAttemptBinding binding =
                new InvocationBinding.ExternalAttemptBinding(
                        OWN, "pa-test-1", 42L, "snap-10-req", "snap-10-exec");
        doAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Consumer<ModelProtocolEvent> sink = invocation.getArgument(1);
            sink.accept(new ModelProtocolEvent.OutputDelta(
                    binding, 0, new ModelPayload.TextChunk("你")));
            sink.accept(new ModelProtocolEvent.OutputDelta(
                    binding, 1, new ModelPayload.TextChunk("好")));
            return succeededOutcomeWithContent("你好");
        }).when(invoker).execute(any(), any());

        handle(generationClaim(1L, 10L));

        assertThat(metricsRegistry.timer("vc_generation_first_token").count()).isEqualTo(1L);
    }

    // ---- DOGFOOD-STABILIZATION-03 (audit defect B): generation egress gate ----

    /** request() with custom history + matching MESSAGE_TEXT composition. */
    private static LiveInvocationRequest requestWithHistory(List<String> history) {
        RoutingRequest routing = new RoutingRequest(
                OWN,
                new Entitlement("1", ServiceClass.simulated()),
                ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                new ModelProtocolCapabilities(Set.of()),
                "snap-10-req", "snap-10-exec", "ZERO_LLM_FALLBACK", 42L);
        List<ProtocolMessage> messages = history.stream()
                .map(text -> new ProtocolMessage(ProtocolMessage.Role.USER, text))
                .collect(java.util.stream.Collectors.toList());
        return new LiveInvocationRequest(
                routing,
                messages,
                new ResponseMode.Text(),
                false,
                new TimeoutBudget(Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1)),
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.80),
                com.virtualcompanion.modelruntime.execution.PayloadComposition
                        .allMessageText(messages.size()));
    }

    private LiveModelInvoker stubExternalWithRequest(LiveInvocationRequest request) {
        return stubExternalWithRequest(request, null);
    }

    /**
     * DOGFOOD-STABILIZATION-04: the handler consumes the id-carrying
     * assembly; {@code messageTextIds} is the parallel MESSAGE_TEXT id list
     * (null keeps the ids absent, exercising the id-less gate path).
     */
    private LiveModelInvoker stubExternalWithRequest(
            LiveInvocationRequest request, java.util.List<Long> messageTextIds) {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        org.mockito.Mockito.lenient().when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        org.mockito.Mockito.lenient().when(snapshotProvider.getIfAvailable())
                .thenReturn(snapshots);
        org.mockito.Mockito.lenient().when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        org.mockito.Mockito.lenient().when(
                        assembler.assembleExternalInvocation(
                                1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(new LiveInvocationAssembler.AssembledExternalInvocation(
                        request,
                        messageTextIds == null ? java.util.List.of() : messageTextIds));
        org.mockito.Mockito.lenient().when(invoker.prepare(any()))
                .thenReturn(externalPrepared());
        org.mockito.Mockito.lenient().when(realtimeEventRepository.streamEpoch(1L, 10L))
                .thenReturn(3L);
        org.mockito.Mockito.lenient().when(realtimeEventRepository.advanceSeq(1L, 10L, 64))
                .thenReturn(66L);
        org.mockito.Mockito.lenient().when(finalizeService.completeWorkItem(
                        1L, "token-1", "FENCE-A"))
                .thenReturn(1);
        org.mockito.Mockito.lenient().when(invoker.execute(any(), any()))
                .thenReturn(succeededOutcomeWithContent("好的。"));
        return invoker;
    }

    /** owner-scoped persisted message fixture for the gate's id mapping. */
    private static MessageRepository.Message persistedMessage(
            long id, String content, boolean modelEligible) {
        return new MessageRepository.Message(1L, id, 5L, "user", content, false, modelEligible);
    }

    @Test
    void sensitiveHistoryBlocksTheGenerationOutboundWithZeroHttpEvenWithModerationOff() {
        // Defect B: with VC_MODERATION_ENABLED=false the composite carries
        // the LOCAL hard-rule classifier only — no moderation leg exists, so
        // the only sensitive-data gate left is the one at the generation
        // egress boundary. Unverified terms + a sensitive history message
        // (current turn OR an old turn riding along) must fail closed with
        // zero provider HTTP, and the exception/log surface must carry
        // categories only.
        // DOGFOOD-STABILIZATION-04 (defect C): the refusal is no longer a
        // generic crash — the offending persisted rows are marked
        // model-ineligible and the turn terminalizes INPUT_BLOCKED in one
        // segment (see the dedicated tests below); this test pins the
        // zero-HTTP / no-intent / category-only invariants.
        safetyClassifier = new com.virtualcompanion.safety.CompositeSafetyClassifier(
                new com.virtualcompanion.safety.DeterministicSafetyClassifier());
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0));
        LiveModelInvoker invoker = stubExternalWithRequest(requestWithHistory(
                java.util.List.of(
                        "我上一轮说过我的手机号是13800138000，你还记得吗",
                        "今天天气不错，我们随便聊聊。")),
                java.util.List.of(100L, 101L));
        java.util.concurrent.atomic.AtomicInteger executeCalls =
                new java.util.concurrent.atomic.AtomicInteger();
        org.mockito.Mockito.doAnswer(invocation -> {
                    executeCalls.incrementAndGet();
                    return succeededOutcomeWithContent("好的。");
                }).when(invoker).execute(any(), any());
        when(generationRepository.find(1L, 10L)).thenReturn(java.util.Optional.of(
                new com.virtualcompanion.platform.persistence.GenerationRecord(
                        1L, 10L, 5L, "gen-logical", "CREATED", "idem-1")));

        // No exception escapes: the item is adjudicated, not crashed.
        handle(generationClaim(1L, 10L));

        assertThat(executeCalls.get()).isZero();
        verify(invoker, never()).execute(any(), any());
        // fail closed: no attempt intent was ever persisted for the refused
        // outbound (the prepare transaction rolled back before it).
        verify(finalizeService, never()).createAttemptIntent(
                anyLong(), anyLong(), anyLong(), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), any());
        // Defect C: the offending row (the OLD turn, not the clean current
        // one) is marked model-ineligible, the turn reaches INPUT_BLOCKED,
        // and the work item completes — with category-only reason codes.
        verify(finalizeService).markMessagesModelIneligible(1L, java.util.List.of(100L));
        verify(finalizeService)
                .terminalizeAsInputBlocked(1L, 10L, "EGRESS_SENSITIVE_DATA");
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
        assertThat(generationCount("blocked_input")).isEqualTo(1.0d);
    }

    @Test
    void zeroEightEnglishPassphraseBlocksTheGenerationOutboundWithZeroProviderHttp() {
        // DOGFOOD-STABILIZATION-08 (defect D): an explicit English passphrase
        // disclosure carries NO digit in the value, yet must fail closed at
        // the generation egress boundary — provider execute=never proven at
        // the WORKER level, with the category-only refusal surface.
        safetyClassifier = new com.virtualcompanion.safety.CompositeSafetyClassifier(
                new com.virtualcompanion.safety.DeterministicSafetyClassifier());
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0));
        LiveModelInvoker invoker = stubExternalWithRequest(requestWithHistory(
                java.util.List.of("password is correct horse battery staple")),
                java.util.List.of(100L));
        java.util.concurrent.atomic.AtomicInteger executeCalls =
                new java.util.concurrent.atomic.AtomicInteger();
        org.mockito.Mockito.doAnswer(invocation -> {
                    executeCalls.incrementAndGet();
                    return succeededOutcomeWithContent("好的。");
                }).when(invoker).execute(any(), any());
        when(generationRepository.find(1L, 10L)).thenReturn(java.util.Optional.of(
                new com.virtualcompanion.platform.persistence.GenerationRecord(
                        1L, 10L, 5L, "gen-logical", "CREATED", "idem-1")));

        handle(generationClaim(1L, 10L));

        assertThat(executeCalls.get()).isZero();
        verify(invoker, never()).execute(any(), any());
        verify(finalizeService).markMessagesModelIneligible(1L, java.util.List.of(100L));
        verify(finalizeService)
                .terminalizeAsInputBlocked(1L, 10L, "EGRESS_SENSITIVE_DATA");
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
    }

    @Test
    void zeroNineRoundBlockedSamplesNeverLeaveTheHost() {
        // DOGFOOD-STABILIZATION-09: the 09 acceptance leaks — an aspect
        // adverb/status verb ahead of a real English value, a CJK help
        // prefix glued to a real value, and the location/whitespace address
        // relations — keep the provider HTTP at exactly zero through the
        // real work-item gate, land in INPUT_BLOCKED with the offending row
        // model-ineligible, and no log line carries the sample text (the
        // refusal surface stays category-only).
        String[] blockedSamples = {
                "password is currently abcdefgh",
                "password is reset to abcdefgh",
                "密码是请记住abcdefgh",
                "密钥是请使用abcdefgh1234",
                "我家地址在北京市海淀区中关村大街",
                "家庭住址    北京市海淀区中关村大街"};
        for (String sample : blockedSamples) {
            double blockedBefore = generationCount("blocked_input");
            org.mockito.Mockito.clearInvocations(finalizeService);
            safetyClassifier = new com.virtualcompanion.safety.CompositeSafetyClassifier(
                    new com.virtualcompanion.safety.DeterministicSafetyClassifier());
            buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0));
            LiveModelInvoker invoker = stubExternalWithRequest(requestWithHistory(
                    java.util.List.of(sample, "普通的一句闲聊")),
                    java.util.List.of(100L, 101L));
            java.util.concurrent.atomic.AtomicInteger executeCalls =
                    new java.util.concurrent.atomic.AtomicInteger();
            org.mockito.Mockito.doAnswer(invocation -> {
                executeCalls.incrementAndGet();
                return succeededOutcomeWithContent("好的。");
            }).when(invoker).execute(any(), any());
            when(generationRepository.find(1L, 10L)).thenReturn(java.util.Optional.of(
                    new com.virtualcompanion.platform.persistence.GenerationRecord(
                            1L, 10L, 5L, "gen-logical", "CREATED", "idem-1")));
            ch.qos.logback.classic.Logger handlerLog = (ch.qos.logback.classic.Logger)
                    org.slf4j.LoggerFactory.getLogger(GenerationWorkItemHandler.class);
            ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender =
                    new ch.qos.logback.core.read.ListAppender<>();
            appender.start();
            handlerLog.addAppender(appender);
            try {
                handle(generationClaim(1L, 10L));
            } finally {
                handlerLog.detachAppender(appender);
            }

            assertThat(executeCalls.get())
                    .as("sample must be blocked with zero provider HTTP: %s", sample)
                    .isZero();
            verify(invoker, never()).execute(any(), any());
            verify(finalizeService).markMessagesModelIneligible(1L, java.util.List.of(100L));
            verify(finalizeService)
                    .terminalizeAsInputBlocked(1L, 10L, "EGRESS_SENSITIVE_DATA");
            verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
            assertThat(generationCount("blocked_input"))
                    .as("sample must reach INPUT_BLOCKED: %s", sample)
                    .isEqualTo(blockedBefore + 1.0d);
            assertThat(appender.list)
                    .as("the block log must fire for: %s", sample)
                    .anySatisfy(event ->
                            org.assertj.core.api.Assertions
                                    .assertThat(event.getFormattedMessage())
                                    .contains("INPUT_BLOCKED"));
            assertThat(appender.list)
                    .as("no log line may carry the sample text: %s", sample)
                    .allSatisfy(event ->
                            org.assertj.core.api.Assertions
                                    .assertThat(event.getFormattedMessage())
                                    .doesNotContain(sample));
        }
    }

    @Test
    void zeroNineRoundCleanSamplesReachTheStubbedProviderBoundary() {
        // The 09 clean matrix must not be blocked locally either: with a
        // STUBBED invoker (never a real provider call) each clean round
        // reaches the provider boundary and the stubbed execute runs once —
        // no row is marked model-ineligible and no INPUT_BLOCKED happens.
        String[] cleanSamples = {
                "password is currently being reset",
                "密码是太短了需要重新设置",
                "我的地址选择北京市后设置海淀区偏好"};
        for (String sample : cleanSamples) {
            org.mockito.Mockito.clearInvocations(finalizeService);
            safetyClassifier = new com.virtualcompanion.safety.CompositeSafetyClassifier(
                    new com.virtualcompanion.safety.DeterministicSafetyClassifier());
            buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0));
            LiveModelInvoker invoker = stubExternalWithRequest(requestWithHistory(
                    java.util.List.of(sample, "普通的一句闲聊")));
            when(finalizeService.insertCandidate(1L, 10L, "好的。")).thenReturn(890L);

            handle(generationClaim(1L, 10L));

            verify(invoker).execute(any(), any());
            verify(finalizeService, never())
                    .markMessagesModelIneligible(anyLong(), any());
            verify(finalizeService, never())
                    .terminalizeAsInputBlocked(anyLong(), anyLong(), anyString());
        }
    }

    @Test
    void egressBlockOnARetryAlreadyInProgressFallsBackToFailedFinal() {
        // A retried work item whose earlier attempt already committed
        // IN_PROGRESS cannot reach the INPUT_REVIEW → INPUT_BLOCKED edge;
        // the egress block still marks the offending rows and terminalizes
        // FAILED_FINAL with the fixed fault code.
        safetyClassifier = new com.virtualcompanion.safety.CompositeSafetyClassifier(
                new com.virtualcompanion.safety.DeterministicSafetyClassifier());
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0));
        stubExternalWithRequest(requestWithHistory(
                java.util.List.of("我的密码 hunter2secret")),
                java.util.List.of(100L));
        when(generationRepository.find(1L, 10L)).thenReturn(java.util.Optional.of(
                new com.virtualcompanion.platform.persistence.GenerationRecord(
                        1L, 10L, 5L, "gen-logical", "IN_PROGRESS", "idem-1")));

        handle(generationClaim(1L, 10L));

        verify(finalizeService).markMessagesModelIneligible(1L, java.util.List.of(100L));
        verify(finalizeService).terminalizeAsFailed(1L, 10L, "egress-sensitive-data");
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
    }

    @Test
    void obfuscatedSensitiveSpellingsStillBlockTheOutboundWithZeroHttp() {
        // Defect B (04 round): normalized obfuscations — +86 spellings and
        // full-width digits — are the SAME sensitive data to the gate: zero
        // generation HTTP, offending row marked, category-only reason.
        safetyClassifier = new com.virtualcompanion.safety.CompositeSafetyClassifier(
                new com.virtualcompanion.safety.DeterministicSafetyClassifier());
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0));
        LiveModelInvoker invoker = stubExternalWithRequest(requestWithHistory(
                java.util.List.of(
                        "手机 +86 13800138000，随时联系",
                        "１３８００１３８０００ 这是我的号")),
                java.util.List.of(100L, 101L));
        when(generationRepository.find(1L, 10L)).thenReturn(java.util.Optional.of(
                new com.virtualcompanion.platform.persistence.GenerationRecord(
                        1L, 10L, 5L, "gen-logical", "CREATED", "idem-1")));

        handle(generationClaim(1L, 10L));

        verify(invoker, never()).execute(any(), any());
        verify(finalizeService).markMessagesModelIneligible(
                1L, java.util.List.of(100L, 101L));
        assertThat(generationCount("blocked_input")).isEqualTo(1.0d);
    }

    @Test
    void zeroFiveRoundBlockedSamplesNeverLeaveTheHost() {
        // Defect III (05 round): every acceptance sample — 0086/comma/middle-
        // dot/Arabic-Indic mobile spellings, the soft-hyphen keyword split,
        // and the explicit home-address disclosure — keeps the provider HTTP
        // at exactly zero when it reaches the gate through history text.
        String[] blockedSamples = {
                "手机 0086 13800138000，随时联系",
                "138,0013,8000 打这个",
                "138·0013·8000 也行",
                "١٣٨٠٠١٣٨٠٠٠ 这是我的号",
                "密\u00AD码是 hunter2secret",
                "我家地址是北京市海淀区中关村大街"};
        for (String sample : blockedSamples) {
            double blockedBefore = generationCount("blocked_input");
            org.mockito.Mockito.clearInvocations(finalizeService);
            safetyClassifier = new com.virtualcompanion.safety.CompositeSafetyClassifier(
                    new com.virtualcompanion.safety.DeterministicSafetyClassifier());
            buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0));
            LiveModelInvoker invoker = stubExternalWithRequest(requestWithHistory(
                    java.util.List.of(sample, "普通的一句闲聊")),
                    java.util.List.of(100L, 101L));
            when(generationRepository.find(1L, 10L)).thenReturn(java.util.Optional.of(
                    new com.virtualcompanion.platform.persistence.GenerationRecord(
                            1L, 10L, 5L, "gen-logical", "CREATED", "idem-1")));

            handle(generationClaim(1L, 10L));

            verify(invoker, never()).execute(any(), any());
            verify(finalizeService).markMessagesModelIneligible(1L, java.util.List.of(100L));
            assertThat(generationCount("blocked_input"))
                    .as("sample must be blocked with zero HTTP: %s", sample)
                    .isEqualTo(blockedBefore + 1.0d);
        }
    }

    @Test
    void zeroSixRoundBlockedSamplesNeverLeaveTheHost() {
        // Defect IV (06 round): every acceptance sample — the Cf-hidden mobile
        // (LRM) and secret keyword (RLI), the supplementary-plane Nd spelling
        // of the mobile number, and the assignment-context passphrases —
        // keeps the provider HTTP at exactly zero when it reaches the gate
        // through history text.
        String[] blockedSamples = {
                "138\u200E00138000",
                "密\u2067码是 hunter2secret",
                "\uD835\uDFE3\uD835\uDFE5\uD835\uDFEA\uD835\uDFE2\uD835\uDFE2"
                        + "\uD835\uDFE3\uD835\uDFE5\uD835\uDFEA\uD835\uDFE2\uD835\uDFE2\uD835\uDFE2",
                "密码是 correct horse battery staple",
                "密码是 abcdefgh"};
        for (String sample : blockedSamples) {
            double blockedBefore = generationCount("blocked_input");
            org.mockito.Mockito.clearInvocations(finalizeService);
            safetyClassifier = new com.virtualcompanion.safety.CompositeSafetyClassifier(
                    new com.virtualcompanion.safety.DeterministicSafetyClassifier());
            buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0));
            LiveModelInvoker invoker = stubExternalWithRequest(requestWithHistory(
                    java.util.List.of(sample, "普通的一句闲聊")),
                    java.util.List.of(100L, 101L));
            when(generationRepository.find(1L, 10L)).thenReturn(java.util.Optional.of(
                    new com.virtualcompanion.platform.persistence.GenerationRecord(
                            1L, 10L, 5L, "gen-logical", "CREATED", "idem-1")));

            handle(generationClaim(1L, 10L));

            verify(invoker, never()).execute(any(), any());
            verify(finalizeService).markMessagesModelIneligible(1L, java.util.List.of(100L));
            assertThat(generationCount("blocked_input"))
                    .as("sample must be blocked with zero HTTP: %s", sample)
                    .isEqualTo(blockedBefore + 1.0d);
        }
    }

    @Test
    void verifiedGenerationTermsSkipTheSensitiveEgressGate() {
        // The same sensitive history flows once the Owner verified the
        // generation provider's terms (VC_GENERATION_PROVIDER_TERMS_VERIFIED)
        // — the gate is terms-scoped, not a blanket block.
        safetyClassifier = new com.virtualcompanion.safety.CompositeSafetyClassifier(
                new com.virtualcompanion.safety.DeterministicSafetyClassifier());
        buildHandler(new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0));
        handler.withGenerationEgressSensitiveGate(
                new com.virtualcompanion.runtime.safety.GenerationEgressSensitiveGate(true));
        LiveModelInvoker invoker = stubExternalWithRequest(requestWithHistory(
                java.util.List.of(
                        "我上一轮说过我的手机号是13800138000，你还记得吗",
                        "今天天气不错，我们随便聊聊。")));
        when(finalizeService.insertCandidate(1L, 10L, "好的。")).thenReturn(890L);

        handle(generationClaim(1L, 10L));

        verify(invoker).execute(any(), any());
        verify(finalizeService).insertCandidate(1L, 10L, "好的。");
    }

    // ---- DOGFOOD-STABILIZATION-03 (audit defect A): cross-turn payload ----

    @Test
    void blockedTurnTextNeverEntersAnyLaterProviderPayload() {
        // Turn 1 (INPUT_BLOCKED, persisted for data rights) + turn 2 (clean)
        // on the SAME conversation: the real assembler must load the
        // model-facing (eligibility-filtered) history, so the outbound
        // request captured at invoker.prepare carries the second turn's text
        // only — the first turn's body appears nowhere in the payload and
        // exactly ONE generation HTTP call happens.
        com.virtualcompanion.platform.persistence.EntitlementSnapshotService entitlementSnapshots =
                org.mockito.Mockito.mock(
                        com.virtualcompanion.platform.persistence.EntitlementSnapshotService.class);
        when(entitlementSnapshots.mint(eq(1L), eq(10L), anyBoolean())).thenReturn(
                new com.virtualcompanion.platform.persistence.EntitlementSnapshotService
                        .MintedEntitlementSnapshot(9001L, "ECONOMY", "ECONOMY", "ECONOMY"));
        com.virtualcompanion.platform.persistence.MemoryService realAssemblerMemories =
                org.mockito.Mockito.mock(com.virtualcompanion.platform.persistence.MemoryService.class);
        when(realAssemblerMemories.recall(eq(1L), eq(9L), eq(5L), anyInt()))
                .thenReturn(java.util.List.of());
        com.virtualcompanion.platform.persistence.RelationshipService realAssemblerRelationships =
                org.mockito.Mockito.mock(
                        com.virtualcompanion.platform.persistence.RelationshipService.class);
        when(realAssemblerRelationships.get(1L, 9L)).thenReturn(java.util.Optional.empty());
        LiveInvocationAssembler realAssembler = new LiveInvocationAssembler(
                generationRepository, conversationRepository, messageRepository,
                realAssemblerMemories,
                realAssemblerRelationships,
                jdbcTemplate,
                "ZERO_LLM_FALLBACK", ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                new com.virtualcompanion.conversation.contextplan.ContextBudget(8_000, 2_048, 64),
                entitlementSnapshots,
                new com.virtualcompanion.runtime.memory.DeterministicEmbedder(),
                false);
        when(generationRepository.find(1L, 10L)).thenReturn(java.util.Optional.of(
                new com.virtualcompanion.platform.persistence.GenerationRecord(
                        1L, 10L, 5L, "gen-logical", "IN_PROGRESS", "idem-1")));
        when(conversationRepository.find(1L, 5L)).thenReturn(java.util.Optional.of(
                new com.virtualcompanion.platform.persistence.ConversationRepository.Conversation(
                        1L, 5L, 9L, null)));
        // Data-rights read: BOTH turns persist (turn 1 blocked, turn 2 clean).
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(java.util.List.of(
                new MessageRepository.Message(
                        1L, 100L, 5L, "user", "我的手机号是13800138000，记一下", false, false),
                new MessageRepository.Message(
                        1L, 101L, 5L, "user", "今天天气不错，我们随便聊聊。", false, true)));
        // Model-facing read: only the eligible rows return.
        when(messageRepository.listModelEligibleByConversation(1L, 5L)).thenReturn(
                java.util.List.of(new MessageRepository.Message(
                        1L, 101L, 5L, "user", "今天天气不错，我们随便聊聊。", false, true)));
        when(jdbcTemplate.queryForObject(
                eq("SELECT current_setting('vc.job_fence', true)"), eq(String.class)))
                .thenReturn(null);
        when(jdbcTemplate.queryForList(
                org.mockito.ArgumentMatchers.startsWith("SELECT content FROM vc.message"),
                eq(String.class), eq(1L), eq(5L)))
                .thenReturn(java.util.List.of());

        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(invoker.prepare(any())).thenAnswer(invocation -> {
            requestCapture.set(invocation.getArgument(0, LiveInvocationRequest.class));
            return externalPrepared();
        });
        when(realtimeEventRepository.streamEpoch(1L, 10L)).thenReturn(3L);
        when(realtimeEventRepository.advanceSeq(1L, 10L, 64)).thenReturn(66L);
        when(finalizeService.insertCandidate(1L, 10L, "好的。")).thenReturn(891L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        java.util.concurrent.atomic.AtomicInteger executeCalls =
                new java.util.concurrent.atomic.AtomicInteger();
        when(invoker.execute(any(), any())).thenAnswer(invocation -> {
            executeCalls.incrementAndGet();
            return succeededOutcomeWithContent("好的。");
        });

        // The handler under test with the REAL assembler (mocked deps).
        handler = new GenerationWorkItemHandler(
                stateService, finalizeService, realAssembler, invokerProvider, snapshotProvider,
                enqueueService, claimService, EXTERNAL_LEASE_SECONDS,
                realtimeEventRepository, deltaBroker, conversationRepository,
                generationRepository, safetyClassifier, incrementalSafetyClassifier,
                safetyEventService, summaryService,
                new com.virtualcompanion.runtime.observability.VcMetrics(metricsRegistry),
                com.virtualcompanion.runtime.observability.TestAlerts.noop(),
                new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0),
                deploymentAffinity,
                productQuotaBook);
        handle(generationClaim(1L, 10L));

        org.assertj.core.api.Assertions.assertThat(executeCalls.get()).isEqualTo(1);
        org.assertj.core.api.Assertions.assertThat(requestCapture.get()).isNotNull();
        String payload = requestCapture.get().messages().stream()
                .map(ProtocolMessage::content)
                .reduce("", (a, b) -> a + "\n" + b);
        org.assertj.core.api.Assertions.assertThat(payload)
                .doesNotContain("13800138000")
                .contains("今天天气不错，我们随便聊聊。");
        verify(messageRepository, never()).listByConversation(1L, 5L);
    }

    // ---- DOGFOOD-STABILIZATION-04 (audit defect C): session state after a
    // gate rejection. The real assembler runs against a STATEFUL eligibility
    // read: marking ids ineligible flips what the model-facing query returns
    // (exactly what the V112 column persists), so the cross-turn behavior is
    // driven by the persistence fact, never by hand-filtered fixtures. ----

    /** Wires the real-assembler handler with a stateful model-facing read. */
    private LiveModelInvoker wireStatefulRealAssembler(
            java.util.concurrent.atomic.AtomicBoolean sensitiveMarked) {
        com.virtualcompanion.platform.persistence.EntitlementSnapshotService entitlementSnapshots =
                org.mockito.Mockito.mock(
                        com.virtualcompanion.platform.persistence.EntitlementSnapshotService.class);
        when(entitlementSnapshots.mint(eq(1L), anyLong(), anyBoolean())).thenReturn(
                new com.virtualcompanion.platform.persistence.EntitlementSnapshotService
                        .MintedEntitlementSnapshot(9001L, "ECONOMY", "ECONOMY", "ECONOMY"));
        com.virtualcompanion.platform.persistence.MemoryService memories =
                org.mockito.Mockito.mock(com.virtualcompanion.platform.persistence.MemoryService.class);
        when(memories.recall(eq(1L), eq(9L), eq(5L), anyInt()))
                .thenReturn(java.util.List.of());
        com.virtualcompanion.platform.persistence.RelationshipService relationships =
                org.mockito.Mockito.mock(
                        com.virtualcompanion.platform.persistence.RelationshipService.class);
        when(relationships.get(1L, 9L)).thenReturn(java.util.Optional.empty());
        LiveInvocationAssembler realAssembler = new LiveInvocationAssembler(
                generationRepository, conversationRepository, messageRepository,
                memories, relationships, jdbcTemplate,
                "ZERO_LLM_FALLBACK", ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                new com.virtualcompanion.conversation.contextplan.ContextBudget(8_000, 2_048, 64),
                entitlementSnapshots,
                new com.virtualcompanion.runtime.memory.DeterministicEmbedder(),
                false);
        // Turn 1 (generation 10): the sensitive OLD row is still eligible and
        // rides along; the gate rejects it. Turn 2 (generation 11): the mark
        // from turn 1's rejection flipped the persistence fact, so the
        // model-facing read carries only the clean rows.
        when(messageRepository.listModelEligibleByConversation(1L, 5L)).thenAnswer(
                invocation -> sensitiveMarked.get()
                        ? java.util.List.of(
                                persistedMessage(101L, "今天天气不错，我们随便聊聊。", true),
                                persistedMessage(102L, "谢谢你，我们换个话题聊聊吧。", true))
                        : java.util.List.of(
                                persistedMessage(
                                        100L, "我上一轮说过我的手机号是13800138000，你还记得吗", true),
                                persistedMessage(101L, "今天天气不错，我们随便聊聊。", true)));
        org.mockito.Mockito.doAnswer(invocation -> {
                    sensitiveMarked.set(true);
                    return 1;
                }).when(finalizeService)
                .markMessagesModelIneligible(eq(1L), org.mockito.ArgumentMatchers.anyList());
        for (long generationId : new long[] {10L, 11L}) {
            when(generationRepository.find(1L, generationId)).thenReturn(java.util.Optional.of(
                    new com.virtualcompanion.platform.persistence.GenerationRecord(
                            1L, generationId, 5L, "gen-logical", "CREATED", "idem-" + generationId)));
        }
        when(conversationRepository.find(1L, 5L)).thenReturn(java.util.Optional.of(
                new com.virtualcompanion.platform.persistence.ConversationRepository.Conversation(
                        1L, 5L, 9L, null)));
        when(jdbcTemplate.queryForObject(
                eq("SELECT current_setting('vc.job_fence', true)"), eq(String.class)))
                .thenReturn(null);
        when(jdbcTemplate.queryForList(
                org.mockito.ArgumentMatchers.startsWith("SELECT content FROM vc.message"),
                eq(String.class), eq(1L), eq(5L)))
                .thenReturn(java.util.List.of());

        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(eq(1L), anyLong())).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-req", "snap-exec"));
        when(invoker.prepare(any())).thenAnswer(invocation -> {
            requestCapture.set(invocation.getArgument(0, LiveInvocationRequest.class));
            return externalPrepared();
        });
        when(realtimeEventRepository.streamEpoch(eq(1L), anyLong())).thenReturn(3L);
        when(realtimeEventRepository.advanceSeq(eq(1L), anyLong(), eq(64))).thenReturn(66L);
        when(finalizeService.insertCandidate(eq(1L), anyLong(), anyString())).thenReturn(892L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        when(invoker.execute(any(), any())).thenAnswer(
                invocation -> succeededOutcomeWithContent("好的。"));

        handler = new GenerationWorkItemHandler(
                stateService, finalizeService, realAssembler, invokerProvider, snapshotProvider,
                enqueueService, claimService, EXTERNAL_LEASE_SECONDS,
                realtimeEventRepository, deltaBroker, conversationRepository,
                generationRepository, safetyClassifier, incrementalSafetyClassifier,
                safetyEventService, summaryService,
                new com.virtualcompanion.runtime.observability.VcMetrics(metricsRegistry),
                com.virtualcompanion.runtime.observability.TestAlerts.noop(),
                new com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker(1, 0),
                deploymentAffinity,
                productQuotaBook);
        return invoker;
    }

    @Test
    void sensitiveTurnRejectedThenNextCleanTurnSucceedsWithoutTheOldSensitiveText() {
        // Defect C end-to-end shape: sensitive turn rejected (terminal state
        // + atomic eligibility mark) → the NEXT clean turn runs normally →
        // the final provider payload never contains the old sensitive text.
        java.util.concurrent.atomic.AtomicBoolean sensitiveMarked =
                new java.util.concurrent.atomic.AtomicBoolean();
        LiveModelInvoker invoker = wireStatefulRealAssembler(sensitiveMarked);

        // Turn 1: the gate rejects the OLD sensitive row riding in history.
        handle(generationClaim(1L, 10L));
        verify(finalizeService).markMessagesModelIneligible(1L, java.util.List.of(100L));
        verify(finalizeService).terminalizeAsInputBlocked(1L, 10L, "EGRESS_SENSITIVE_DATA");
        verify(invoker, never()).execute(any(), any());

        // Turn 2: a clean message on the SAME conversation succeeds — the
        // poisoned history is excluded by the persisted eligibility fact,
        // not by skipping the turn.
        requestCapture.set(null);
        handle(generationClaim(1L, 11L));
        org.assertj.core.api.Assertions.assertThat(requestCapture.get()).isNotNull();
        String payload = requestCapture.get().messages().stream()
                .map(ProtocolMessage::content)
                .reduce("", (a, b) -> a + "\n" + b);
        org.assertj.core.api.Assertions.assertThat(payload)
                .doesNotContain("13800138000")
                .contains("我们换个话题聊聊吧。");
        verify(invoker, org.mockito.Mockito.times(1)).execute(any(), any());
        // The eligibility mark happened exactly once — turn 2 was clean and
        // was never re-poisoned by the old row.
        verify(finalizeService, org.mockito.Mockito.times(1))
                .markMessagesModelIneligible(eq(1L), org.mockito.ArgumentMatchers.anyList());
    }

    @Test
    void flippingTheTermsFlagTrueLaterDoesNotReReleaseRejectedMessages() {
        // The rejection's eligibility mark is a persisted fact: verifying the
        // provider terms later (VC_GENERATION_PROVIDER_TERMS_VERIFIED=true)
        // re-opens the GATE but cannot re-release the rows it already
        // rejected — the assembler's model-facing read still excludes them.
        java.util.concurrent.atomic.AtomicBoolean sensitiveMarked =
                new java.util.concurrent.atomic.AtomicBoolean();
        LiveModelInvoker invoker = wireStatefulRealAssembler(sensitiveMarked);

        handle(generationClaim(1L, 10L));
        verify(finalizeService).markMessagesModelIneligible(1L, java.util.List.of(100L));

        handler.withGenerationEgressSensitiveGate(
                new com.virtualcompanion.runtime.safety.GenerationEgressSensitiveGate(true));
        requestCapture.set(null);
        handle(generationClaim(1L, 11L));

        org.assertj.core.api.Assertions.assertThat(requestCapture.get()).isNotNull();
        String payload = requestCapture.get().messages().stream()
                .map(ProtocolMessage::content)
                .reduce("", (a, b) -> a + "\n" + b);
        org.assertj.core.api.Assertions.assertThat(payload).doesNotContain("13800138000");
        verify(invoker, org.mockito.Mockito.times(1)).execute(any(), any());
    }
}
