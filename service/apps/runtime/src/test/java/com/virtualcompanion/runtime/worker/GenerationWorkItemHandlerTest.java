package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
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
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
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
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.WorkItemClaim;
import com.virtualcompanion.safety.ClassifierReport;
import com.virtualcompanion.safety.DeterministicSafetyResponse;
import java.time.Duration;
import java.util.List;
import java.util.Set;
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

    private final GenerationStateService stateService = mock(GenerationStateService.class);
    private final GenerationFinalizeService finalizeService = mock(GenerationFinalizeService.class);
    private final LiveInvocationAssembler assembler = mock(LiveInvocationAssembler.class);

    @SuppressWarnings("unchecked")
    private final ObjectProvider<LiveModelInvoker> invokerProvider = mock(ObjectProvider.class);

    @SuppressWarnings("unchecked")
    private final ObjectProvider<AuthorizationSnapshotProvider> snapshotProvider = mock(ObjectProvider.class);

    private GenerationWorkItemHandler handler;

    /** Synchronous segment executor: runs each segment immediately (mock has no transactions). */
    private final WorkItemWorker.OwnerExecutor executor = (ownerUserId, work) -> work.run();

    @BeforeEach
    void setUp() {
        handler = new GenerationWorkItemHandler(
                stateService, finalizeService, assembler, invokerProvider, snapshotProvider);
        when(invokerProvider.getIfAvailable()).thenReturn(null);
        when(snapshotProvider.getIfAvailable()).thenReturn(null);
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
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.80));
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
    }

    @Test
    void completesViaZeroLlmWhenInvokerPresent() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(assembler.assemble(1L, 10L, "FENCE-A")).thenReturn(request());
        when(invoker.prepare(any())).thenReturn(zeroLlmPrepared());
        when(invoker.execute(any())).thenReturn(zeroLlmOutcome());
        when(finalizeService.insertCandidate(1L, 10L, FALLBACK)).thenReturn(777L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(1L, 10L));

        verify(stateService).promote(1L, 10L, GenerationStateService.IN_PROGRESS);
        verify(assembler).assemble(1L, 10L, "FENCE-A");
        verify(invoker).prepare(any());
        verify(invoker).execute(any());
        verify(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");
        verify(finalizeService).insertCandidate(1L, 10L, FALLBACK);
        verify(stateService).promote(1L, 10L, GenerationStateService.FINAL_REVIEW);
        verify(finalizeService).finalizeCompleted(1L, 10L, 777L, FALLBACK, "", false);
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
        verify(finalizeService, never()).terminalizeAsFailed(anyLong(), anyLong(), anyString());
    }

    @Test
    void terminalizesFailedOnUnexpectedOutcome() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(assembler.assemble(2L, 20L, "FENCE-A")).thenReturn(request());
        when(invoker.prepare(any())).thenReturn(noEligiblePrepared());
        when(invoker.execute(any())).thenReturn(
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
        when(assembler.assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(request());
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any())).thenReturn(succeededOutcome());
        when(finalizeService.recordAttemptOutcome(1L, "pa-test-1", "SUCCEEDED")).thenReturn(1);
        when(finalizeService.insertCandidate(1L, 10L, "real output")).thenReturn(888L);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(1L, 10L));

        // prepare-tx: promote + snapshots + assemble + prepare + intent BEFORE execute.
        verify(stateService).promote(1L, 10L, GenerationStateService.IN_PROGRESS);
        verify(snapshots).createFor(1L, 10L);
        verify(assembler).assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A");
        verify(invoker).prepare(any());
        verify(finalizeService).createAttemptIntent(
                eq(1L), eq(1L), eq(10L), eq("token-1"), eq("FENCE-A"),
                eq("pa-test-1"), eq("alpha-loopback"), eq("alpha-supplier"),
                eq("snap-10-req"), eq("snap-10-exec"));
        // external-no-db + audit-outcome-tx.
        verify(invoker).execute(any());
        verify(finalizeService).recordAttemptOutcome(1L, "pa-test-1", "SUCCEEDED");
        // guarded-finalize-tx: guard first, then candidate/promote/finalize/complete.
        verify(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");
        verify(finalizeService).insertCandidate(1L, 10L, "real output");
        verify(stateService).promote(1L, 10L, GenerationStateService.FINAL_REVIEW);
        verify(finalizeService).finalizeCompletedWithUsage(
                1L, 10L, 888L, "real output", "pa-test-1", 42L, 58L, 0d, "USD", 1, false);
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
        verify(finalizeService, never()).terminalizeAsFailed(anyLong(), anyLong(), anyString());
    }

    @Test
    void intentCreationFailureForbidsOutbound() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(request());
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(finalizeService.createAttemptIntent(
                anyLong(), anyLong(), anyLong(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), anyString()))
                .thenThrow(new IllegalStateException("intent insert failed (unique violation)"));

        // The intent write failure aborts the prepare transaction: the adapter
        // phase (invoker.execute) must never run (adapter zero calls).
        assertThrows(IllegalStateException.class,
                () -> handle(generationClaim(1L, 10L)));

        verify(invoker, never()).execute(any());
        verify(finalizeService, never()).recordAttemptOutcome(anyLong(), anyString(), anyString());
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
        when(assembler.assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(request());
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        doAnswer(invocation -> {
            org.junit.jupiter.api.Assertions.assertFalse(
                    org.springframework.transaction.support.TransactionSynchronizationManager
                            .isActualTransactionActive(),
                    "external phase must run with no active database transaction");
            return succeededOutcome();
        }).when(invoker).execute(any());
        when(finalizeService.recordAttemptOutcome(1L, "pa-test-1", "SUCCEEDED")).thenReturn(1);
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

        verify(invoker).execute(any());
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
    }

    @Test
    void recordsOutcomeAndFailsGuardedOnExternalProviderFailure() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(request());
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any())).thenReturn(failedOutcome());
        when(finalizeService.recordAttemptOutcome(1L, "pa-test-1", "NON_RETRYABLE_FAILED"))
                .thenReturn(1);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        when(finalizeService.failWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(generationClaim(1L, 10L));

        // A real outbound attempt happened: intent outcome recorded (same row),
        // then guarded fail (assert + terminalize + per-item fail).
        verify(finalizeService).recordAttemptOutcome(1L, "pa-test-1", "NON_RETRYABLE_FAILED");
        verify(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");
        verify(finalizeService).terminalizeAsFailed(1L, 10L, "external-failed");
        verify(finalizeService).failWorkItem(1L, "token-1", "FENCE-A");
        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
        verify(finalizeService, never()).finalizeCompletedWithUsage(
                anyLong(), anyLong(), anyLong(), any(), any(),
                anyLong(), anyLong(), anyDouble(), any(), anyInt(), anyBoolean());
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
        when(assembler.assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(request());
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any())).thenReturn(retryableFailedOutcome());
        when(finalizeService.recordAttemptOutcome(1L, "pa-test-1", "RETRYABLE_FAILED"))
                .thenReturn(1);
        when(finalizeService.requeueRetryableFailure(1L, 1L, "token-1", "FENCE-A", 3))
                .thenReturn(GenerationFinalizeService.RETRY_SCHEDULED);

        handle(generationClaim(1L, 10L));

        verify(finalizeService).recordAttemptOutcome(1L, "pa-test-1", "RETRYABLE_FAILED");
        verify(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");
        verify(finalizeService).requeueRetryableFailure(1L, 1L, "token-1", "FENCE-A", 3);
        verify(finalizeService, never()).terminalizeAsFailed(anyLong(), anyLong(), anyString());
        verify(finalizeService, never()).failWorkItem(anyLong(), anyString(), anyString());
        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
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
        when(assembler.assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(request());
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any())).thenReturn(retryableFailedOutcome());
        when(finalizeService.recordAttemptOutcome(1L, "pa-test-1", "RETRYABLE_FAILED"))
                .thenReturn(1);
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
        when(assembler.assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec", "FENCE-A"))
                .thenReturn(request());
        when(invoker.prepare(any())).thenReturn(externalPrepared());
        when(invoker.execute(any())).thenReturn(succeededOutcome());
        when(finalizeService.recordAttemptOutcome(1L, "pa-test-1", "SUCCEEDED")).thenReturn(1);
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
}
