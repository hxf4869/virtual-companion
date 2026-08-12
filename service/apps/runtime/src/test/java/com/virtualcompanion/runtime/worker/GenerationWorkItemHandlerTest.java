package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.execution.LiveAttemptOutcome;
import com.virtualcompanion.modelruntime.execution.LiveInvocationRequest;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.modelruntime.routing.Entitlement;
import com.virtualcompanion.modelruntime.routing.QuotaDisposition;
import com.virtualcompanion.modelruntime.routing.RecoveryOutcome;
import com.virtualcompanion.modelruntime.routing.RecoveryTerminal;
import com.virtualcompanion.modelruntime.routing.RouteDecision;
import com.virtualcompanion.modelruntime.routing.RoutingRequest;
import com.virtualcompanion.modelruntime.routing.ServiceClass;
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

    private GenerationWorkItemHandler handler;

    @BeforeEach
    void setUp() {
        handler = new GenerationWorkItemHandler(
                stateService, finalizeService, assembler, invokerProvider);
        when(invokerProvider.getIfAvailable()).thenReturn(null);
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
}
