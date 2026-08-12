package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.catalog.ProviderAttemptStatus;
import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import com.virtualcompanion.modelruntime.execution.LiveAttemptOutcome;
import com.virtualcompanion.modelruntime.execution.LiveAttemptTerminal;
import com.virtualcompanion.modelruntime.execution.LiveInvocationRequest;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.modelruntime.execution.ProviderAttemptAudit;
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
 * ZERO_LLM completion). Verifies: non-GENERATION items are skipped; when no
 * {@code LiveModelInvoker} bean exists the generation degrades to FAILED_FINAL;
 * when the invoker returns {@code ZERO_LLM_COMPLETED} the handler drives the
 * full COMPLETED finalize chain; any other outcome fails closed; a promotion
 * failure propagates after a best-effort terminalize.
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

    @BeforeEach
    void setUp() {
        handler = new GenerationWorkItemHandler(
                stateService, finalizeService, assembler, invokerProvider, snapshotProvider);
        when(invokerProvider.getIfAvailable()).thenReturn(null);
        when(snapshotProvider.getIfAvailable()).thenReturn(null);
    }

    private static WorkItemClaim generationClaim(long ownerId, long genId) {
        return new WorkItemClaim(ownerId, 1L, "GENERATION", genId, null, "token-1");
    }

    private static LiveAttemptOutcome zeroLlmOutcome() {
        OwnershipTuple ownership = new OwnershipTuple("1", "9", "5", "10");
        InvocationBinding binding =
                new InvocationBinding.DeterministicSourceBinding(ownership, "ZERO_LLM_FALLBACK", 0L);
        RouteDecision decision = RouteDecision.selected(
                ownership, "ZERO_LLM_ONLY", null, binding, null, List.of());
        RecoveryOutcome recovery = RecoveryOutcome.of(
                ownership, RecoveryTerminal.ZERO_LLM_COMPLETED,
                QuotaDisposition.NONE, FALLBACK);
        return LiveAttemptOutcome.zeroLlmCompleted(decision, binding, recovery);
    }

    private static LiveAttemptOutcome noEligibleOutcome() {
        OwnershipTuple ownership = new OwnershipTuple("1", "9", "5", "10");
        RouteDecision decision = RouteDecision.noEligible(ownership, "DISABLED", List.of());
        RecoveryOutcome recovery = RecoveryOutcome.of(
                ownership, RecoveryTerminal.NO_CAPACITY_TERMINAL,
                QuotaDisposition.NONE, "");
        return LiveAttemptOutcome.noEligibleDeployment(decision, recovery);
    }

    private static LiveInvocationRequest request() {
        OwnershipTuple ownership = new OwnershipTuple("1", "9", "5", "10");
        RoutingRequest routing = new RoutingRequest(
                ownership,
                new Entitlement("1", ServiceClass.zeroLlmOnly()),
                ModelProtocol.ZERO_LLM,
                new ModelProtocolCapabilities(Set.of()),
                null,
                null,
                "ZERO_LLM_FALLBACK",
                0L);
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
        WorkItemClaim claim = new WorkItemClaim(1L, 1L, "OTHER", 10L, null, "token-1");
        handler.handle(claim);
        verify(stateService, never()).promote(anyLong(), anyLong(), anyString());
        verify(finalizeService, never()).terminalizeAsFailed(anyLong(), anyLong(), anyString());
    }

    @Test
    void degradesToFailedWhenProvidersDisabled() {
        WorkItemClaim claim = generationClaim(1L, 10L);
        handler.handle(claim);

        verify(stateService).promote(1L, 10L, GenerationStateService.IN_PROGRESS);
        verify(finalizeService).terminalizeAsFailed(1L, 10L, "model-providers-disabled");
        verify(assembler, never()).assemble(anyLong(), anyLong());
    }

    @Test
    void completesViaZeroLlmWhenInvokerPresent() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(assembler.assemble(1L, 10L)).thenReturn(request());
        when(invoker.invoke(any())).thenReturn(zeroLlmOutcome());
        when(finalizeService.insertCandidate(1L, 10L, FALLBACK)).thenReturn(777L);

        handler.handle(generationClaim(1L, 10L));

        verify(stateService).promote(1L, 10L, GenerationStateService.IN_PROGRESS);
        verify(assembler).assemble(1L, 10L);
        verify(invoker).invoke(any());
        verify(finalizeService).insertCandidate(1L, 10L, FALLBACK);
        verify(stateService).promote(1L, 10L, GenerationStateService.FINAL_REVIEW);
        verify(finalizeService).finalizeCompleted(1L, 10L, 777L, FALLBACK, "", false);
        verify(finalizeService, never()).terminalizeAsFailed(anyLong(), anyLong(), anyString());
    }

    @Test
    void terminalizesFailedOnUnexpectedOutcome() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(assembler.assemble(2L, 20L)).thenReturn(request());
        when(invoker.invoke(any())).thenReturn(noEligibleOutcome());

        handler.handle(generationClaim(2L, 20L));

        verify(stateService).promote(2L, 20L, GenerationStateService.IN_PROGRESS);
        verify(finalizeService).terminalizeAsFailed(
                2L, 20L, "zero-llm-unexpected-outcome:NO_ELIGIBLE_DEPLOYMENT");
        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
        verify(finalizeService, never()).finalizeCompleted(
                anyLong(), anyLong(), anyLong(), anyString(), anyString(), any(Boolean.class));
    }

    @Test
    void promotionFailurePropagatesAndAttemptsTerminalize() {
        when(stateService.promote(anyLong(), anyLong(), anyString()))
                .thenThrow(new IllegalStateException("db down"));

        assertThrows(IllegalStateException.class,
                () -> handler.handle(generationClaim(3L, 30L)));

        // Best-effort terminalize is attempted even after the promotion failure.
        verify(finalizeService).terminalizeAsFailed(3L, 30L, "handler-exception");
        verify(assembler, never()).assemble(anyLong(), anyLong());
    }

    // ---- External provider path (TASK-0177) ----

    private static final OwnershipTuple OWN = new OwnershipTuple("1", "9", "5", "10");
    private static final QuotaReservation RES = new QuotaReservation("qr-1", "1", 1L, 99L);

    private static InvocationBinding.ExternalAttemptBinding externalBinding(String req, String exec) {
        return new InvocationBinding.ExternalAttemptBinding(OWN, "pa-test-1", 0L, req, exec);
    }

    private static RouteDecision externalDecision(InvocationBinding.ExternalAttemptBinding binding) {
        return RouteDecision.selected(OWN, "SIMULATED", new ProviderId("alpha-loopback"),
                binding, RES, List.of());
    }

    private static LiveInvocationRequest externalRequest(String req, String exec) {
        RoutingRequest routing = new RoutingRequest(
                OWN,
                new Entitlement("1", ServiceClass.simulated()),
                ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                new ModelProtocolCapabilities(Set.of()),
                req, exec, "ZERO_LLM_FALLBACK", 0L);
        return new LiveInvocationRequest(
                routing,
                List.of(new ProtocolMessage(ProtocolMessage.Role.USER, "hi")),
                new ResponseMode.Text(),
                false,
                new TimeoutBudget(Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1)),
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.80));
    }

    private static LiveAttemptOutcome succeededOutcome(String req, String exec) {
        InvocationBinding.ExternalAttemptBinding binding = externalBinding(req, exec);
        ProviderAttemptAudit audit = new ProviderAttemptAudit(
                "pa-test-1", OWN, "alpha-loopback", "alpha-supplier",
                ProviderAttemptStatus.SUCCEEDED);
        return LiveAttemptOutcome.succeeded(externalDecision(binding), binding, audit,
                "real output", new TokenUsage(42L, 58L, 100L), RES);
    }

    private static LiveAttemptOutcome failedOutcome(String req, String exec) {
        InvocationBinding.ExternalAttemptBinding binding = externalBinding(req, exec);
        ProviderAttemptAudit audit = new ProviderAttemptAudit(
                "pa-test-1", OWN, "alpha-loopback", "alpha-supplier",
                ProviderAttemptStatus.NON_RETRYABLE_FAILED);
        RecoveryOutcome recovery = RecoveryOutcome.of(OWN, RecoveryTerminal.ALL_FAILURE_BLOCKED,
                QuotaDisposition.RELEASED, "");
        return LiveAttemptOutcome.failed(externalDecision(binding), binding, audit,
                new AdapterFailure.UpstreamUnavailable(), recovery, LiveAttemptTerminal.FAILED);
    }

    private static LiveAttemptOutcome blockedBySafetyOutcome() {
        RecoveryOutcome recovery = RecoveryOutcome.of(OWN, RecoveryTerminal.ALL_FAILURE_BLOCKED,
                QuotaDisposition.RELEASED, "safety fallback");
        // blockedBySafety carries the decision but no binding/audit (no outbound).
        return LiveAttemptOutcome.blockedBySafety(
                externalDecision(externalBinding("snap-10-req", "snap-10-exec")), recovery);
    }

    @Test
    void completesViaExternalProviderWhenConfigured() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec"))
                .thenReturn(externalRequest("snap-10-req", "snap-10-exec"));
        when(invoker.invoke(any())).thenReturn(succeededOutcome("snap-10-req", "snap-10-exec"));
        when(finalizeService.insertCandidate(1L, 10L, "real output")).thenReturn(888L);

        handler.handle(generationClaim(1L, 10L));

        verify(stateService).promote(1L, 10L, GenerationStateService.IN_PROGRESS);
        verify(snapshots).createFor(1L, 10L);
        verify(assembler).assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec");
        verify(invoker).invoke(any());
        verify(finalizeService).recordProviderAttempt(
                1L, 10L, "alpha-loopback", "alpha-supplier", "SUCCEEDED",
                "snap-10-req", "snap-10-exec");
        verify(finalizeService).insertCandidate(1L, 10L, "real output");
        verify(stateService).promote(1L, 10L, GenerationStateService.FINAL_REVIEW);
        verify(finalizeService).finalizeCompletedWithUsage(
                1L, 10L, 888L, "real output", "pa-test-1", 42L, 58L, 0d, "USD", 1, false);
        verify(finalizeService, never()).terminalizeAsFailed(anyLong(), anyLong(), anyString());
    }

    @Test
    void recordsAttemptAndTerminalizesOnExternalProviderFailure() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec"))
                .thenReturn(externalRequest("snap-10-req", "snap-10-exec"));
        when(invoker.invoke(any())).thenReturn(failedOutcome("snap-10-req", "snap-10-exec"));

        handler.handle(generationClaim(1L, 10L));

        verify(stateService).promote(1L, 10L, GenerationStateService.IN_PROGRESS);
        // A real outbound attempt happened (FAILED carries an audit): record it
        // bound to both snapshots before terminalizing (INV-AUTH-001 audit chain).
        verify(finalizeService).recordProviderAttempt(
                1L, 10L, "alpha-loopback", "alpha-supplier", "NON_RETRYABLE_FAILED",
                "snap-10-req", "snap-10-exec");
        verify(finalizeService).terminalizeAsFailed(1L, 10L, "external-failed");
        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
        verify(finalizeService, never()).finalizeCompletedWithUsage(
                anyLong(), anyLong(), anyLong(), any(), any(),
                anyLong(), anyLong(), anyDouble(), any(), anyInt(), anyBoolean());
    }

    @Test
    void terminalizesWithoutRecordOnSafetyBlock() {
        LiveModelInvoker invoker = mock(LiveModelInvoker.class);
        AuthorizationSnapshotProvider snapshots = mock(AuthorizationSnapshotProvider.class);
        when(invokerProvider.getIfAvailable()).thenReturn(invoker);
        when(snapshotProvider.getIfAvailable()).thenReturn(snapshots);
        when(snapshots.createFor(1L, 10L)).thenReturn(
                new AuthorizationSnapshotProvider.SnapshotIds("snap-10-req", "snap-10-exec"));
        when(assembler.assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec"))
                .thenReturn(externalRequest("snap-10-req", "snap-10-exec"));
        when(invoker.invoke(any())).thenReturn(blockedBySafetyOutcome());

        handler.handle(generationClaim(1L, 10L));

        verify(stateService).promote(1L, 10L, GenerationStateService.IN_PROGRESS);
        // Safety denial happens before any outbound transfer: no provider_attempt.
        verify(finalizeService, never()).recordProviderAttempt(
                anyLong(), anyLong(), any(), any(), any(), any(), any());
        verify(finalizeService).terminalizeAsFailed(1L, 10L, "external-blocked_by_safety");
        verify(finalizeService, never()).insertCandidate(anyLong(), anyLong(), anyString());
    }
}
