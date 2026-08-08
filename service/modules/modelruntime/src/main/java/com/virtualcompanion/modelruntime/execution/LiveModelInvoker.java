package com.virtualcompanion.modelruntime.execution;

import com.virtualcompanion.catalog.ProviderAttemptStatus;
import com.virtualcompanion.catalog.RouteDecisionStatus;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshot;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotId;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationDecision;
import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationGuard;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import com.virtualcompanion.modelruntime.guard.ModelProtocolEventFence;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.routing.DeterministicRouter;
import com.virtualcompanion.modelruntime.routing.GenerationRecovery;
import com.virtualcompanion.modelruntime.routing.RecoveryOutcome;
import com.virtualcompanion.modelruntime.routing.RecoveryScenario;
import com.virtualcompanion.modelruntime.routing.RouteDecision;
import com.virtualcompanion.safety.SafetyGate;
import com.virtualcompanion.safety.SafetyVerdict;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/**
 * Controlled real-model invocation path.
 *
 * <p>Runs one {@link RouteDecision} through the full guarded chain: the
 * {@link DeterministicRouter} selects an admitted registry deployment and
 * reserves quota; the {@link ExecutionAuthorizationGuard} authorizes the
 * dual-snapshot binding; the {@link SafetyGate} releases only an adequate
 * ALLOW; the {@link AdapterLocator} resolves the approved adapter; the
 * session is consumed to exactly one terminal. Every degraded path (denied
 * authorization, non-adequate safety, adapter missing, provider failure,
 * timeout, cancellation, ZERO_LLM, no-eligible) is fail-closed, releases the
 * reserved quota through {@link GenerationRecovery}, never fabricates a
 * success, and records a {@link ProviderAttemptAudit} only for real outbound
 * attempts.</p>
 *
 * <p>Credentials, request bodies and response text never leave the adapter
 * boundary into a business type; {@link ProviderAttemptAudit} deliberately
 * carries identity and outcome only. The {@code supplierName} comes from
 * runtime configuration via the injected map, never a hard-coded vendor name.</p>
 */
public final class LiveModelInvoker {

    private final DeterministicRouter router;
    private final ExecutionAuthorizationGuard authorizationGuard;
    private final AuthorizationSnapshotStore authorizationSnapshotStore;
    private final AdapterLocator adapterLocator;
    private final GenerationRecovery recovery;
    private final Map<ProviderId, String> supplierNames;

    public LiveModelInvoker(
            DeterministicRouter router,
            ExecutionAuthorizationGuard authorizationGuard,
            AuthorizationSnapshotStore authorizationSnapshotStore,
            AdapterLocator adapterLocator,
            GenerationRecovery recovery,
            Map<ProviderId, String> supplierNames) {
        this.router = Objects.requireNonNull(router, "router must not be null");
        this.authorizationGuard = Objects.requireNonNull(
                authorizationGuard, "authorizationGuard must not be null");
        this.authorizationSnapshotStore = Objects.requireNonNull(
                authorizationSnapshotStore, "authorizationSnapshotStore must not be null");
        this.adapterLocator = Objects.requireNonNull(adapterLocator, "adapterLocator must not be null");
        this.recovery = Objects.requireNonNull(recovery, "recovery must not be null");
        this.supplierNames = Map.copyOf(supplierNames);
    }

    /**
     * Invoke one controlled model attempt.
     */
    public LiveAttemptOutcome invoke(LiveInvocationRequest request) {
        Objects.requireNonNull(request, "request must not be null");
        RouteDecision decision = router.decide(request.routingRequest());
        if (decision.status() != RouteDecisionStatus.SELECTED) {
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.NO_CAPACITY,
                    decision.quotaReservation());
            return LiveAttemptOutcome.noEligibleDeployment(decision, outcome);
        }
        InvocationBinding binding = decision.binding();
        Objects.requireNonNull(binding, "SELECTED decision must carry a binding");
        if (binding instanceof InvocationBinding.DeterministicSourceBinding) {
            RecoveryOutcome outcome = recovery.completeZeroLlm(
                    decision.ownership(), decision.quotaReservation());
            return LiveAttemptOutcome.zeroLlmCompleted(decision, binding, outcome);
        }
        if (binding instanceof InvocationBinding.ExternalAttemptBinding external) {
            return invokeExternal(request, decision, external);
        }
        throw new IllegalStateException("unexpected SELECTED binding type: " + binding);
    }

    private LiveAttemptOutcome invokeExternal(
            LiveInvocationRequest request,
            RouteDecision decision,
            InvocationBinding.ExternalAttemptBinding binding) {
        // 1. Dual-snapshot authorization; denial closes before any outbound transfer.
        ExecutionAuthorizationDecision authorization = authorizationGuard.authorize(binding);
        if (!authorization.allowed()) {
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.CANCELLED,
                    decision.quotaReservation());
            return LiveAttemptOutcome.blockedByAuthorization(decision, outcome);
        }

        // 2. The selected deployment must be exactly the one the execution
        //    snapshot authorized; otherwise a request authorized for provider Y
        //    could be routed to provider X (INV-AUTH-001). Fail closed.
        ProviderId providerId = Objects.requireNonNull(
                decision.selectedProviderId(),
                "external SELECTED decision must carry a provider id");
        AuthorizationSnapshotId executionSnapshotId =
                new AuthorizationSnapshotId(binding.executionAuthorizationSnapshotId());
        Optional<AuthorizationSnapshot> executionSnapshot =
                authorizationSnapshotStore.find(executionSnapshotId);
        if (executionSnapshot.isEmpty()
                || !executionSnapshot.get().providerId().equals(providerId)) {
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.CANCELLED,
                    decision.quotaReservation());
            return LiveAttemptOutcome.blockedByAuthorization(decision, outcome);
        }

        // 3. Safety gate: only an adequate ALLOW releases an external attempt.
        SafetyVerdict verdict = SafetyGate.evaluate(
                request.hardRuleViolations(), request.classifierReport());
        if (verdict != SafetyVerdict.ALLOW) {
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.ALL_FAILURE,
                    decision.quotaReservation());
            return LiveAttemptOutcome.blockedBySafety(decision, outcome);
        }

        // 4. Resolve the approved adapter (fail-closed; never a guessed default).
        final ModelProtocolAdapter adapter;
        final String supplierName;
        try {
            adapter = adapterLocator.adapterFor(providerId);
            supplierName = supplierName(providerId);
        } catch (IllegalStateException misconfigured) {
            // No outbound transfer happened; no provider_attempt row exists.
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.ALL_FAILURE,
                    decision.quotaReservation());
            return LiveAttemptOutcome.failed(decision, binding, null,
                    new AdapterFailure.UpstreamUnavailable(), outcome, LiveAttemptTerminal.FAILED);
        }

        ModelProtocolRequest protocolRequest = new ModelProtocolRequest(
                binding,
                request.messages(),
                request.responseMode(),
                request.streaming(),
                request.timeoutBudget());

        String output = "";
        TokenUsage usage = new TokenUsage(0, 0, 0);
        ModelProtocolEvent terminalEvent = null;
        ModelProtocolEventFence fence = new ModelProtocolEventFence(binding);
        try (ModelProtocolSession session = adapter.open(protocolRequest)) {
            StringBuilder builder = new StringBuilder();
            while (true) {
                Optional<ModelProtocolEvent> next = session.next();
                if (next.isEmpty()) {
                    break;
                }
                final ModelProtocolEvent event;
                try {
                    event = fence.accept(next.get());
                } catch (ModelProtocolEventFence.FenceViolation violation) {
                    // Corrupt stream (wrong binding, out-of-order, duplicate
                    // usage, EOS without output): fail the whole attempt closed
                    // so a late or wrong event can never pollute output/usage.
                    return fenceViolationOutcome(decision, binding, providerId, supplierName);
                }
                if (event instanceof ModelProtocolEvent.OutputDelta delta) {
                    if (delta.payload() instanceof ModelPayload.TextChunk chunk) {
                        builder.append(chunk.text());
                    } else if (delta.payload() instanceof ModelPayload.StructuredJson json) {
                        builder.append(json.json());
                    }
                } else if (event instanceof ModelProtocolEvent.UsageReported reported) {
                    usage = reported.usage();
                } else if (event.terminal()) {
                    terminalEvent = event;
                    break;
                }
            }
            output = builder.toString();
        }

        if (terminalEvent == null) {
            // Session closed without a terminal event: malformed stream, fail closed.
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.ALL_FAILURE,
                    decision.quotaReservation());
            ProviderAttemptAudit audit = audit(binding, providerId, supplierName,
                    ProviderAttemptStatus.NON_RETRYABLE_FAILED);
            return LiveAttemptOutcome.failed(decision, binding, audit,
                    new AdapterFailure.MalformedResponse(), outcome, LiveAttemptTerminal.FAILED);
        }
        if (terminalEvent instanceof ModelProtocolEvent.AttemptEos) {
            ProviderAttemptAudit audit = audit(binding, providerId, supplierName,
                    ProviderAttemptStatus.SUCCEEDED);
            return LiveAttemptOutcome.succeeded(decision, binding, audit, output, usage,
                    decision.quotaReservation());
        }
        if (terminalEvent instanceof ModelProtocolEvent.AttemptCancelled) {
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.CANCELLED,
                    decision.quotaReservation());
            ProviderAttemptAudit audit = audit(binding, providerId, supplierName,
                    ProviderAttemptStatus.CANCELLED);
            return LiveAttemptOutcome.cancelled(decision, binding, audit, outcome);
        }
        if (terminalEvent instanceof ModelProtocolEvent.AttemptFailed failed) {
            return handleFailure(decision, binding, providerId, supplierName, failed.failure());
        }
        throw new IllegalStateException("unexpected terminal event: " + terminalEvent);
    }

    private LiveAttemptOutcome fenceViolationOutcome(
            RouteDecision decision,
            InvocationBinding.ExternalAttemptBinding binding,
            ProviderId providerId,
            String supplierName) {
        RecoveryOutcome outcome = recovery.recover(
                decision.ownership(), RecoveryScenario.ALL_FAILURE,
                decision.quotaReservation());
        ProviderAttemptAudit audit = audit(binding, providerId, supplierName,
                ProviderAttemptStatus.NON_RETRYABLE_FAILED);
        return LiveAttemptOutcome.failed(decision, binding, audit,
                new AdapterFailure.MalformedResponse(), outcome, LiveAttemptTerminal.FAILED);
    }

    private LiveAttemptOutcome handleFailure(
            RouteDecision decision,
            InvocationBinding.ExternalAttemptBinding binding,
            ProviderId providerId,
            String supplierName,
            AdapterFailure failure) {
        boolean timeout = failure instanceof AdapterFailure.Timeout;
        RecoveryScenario scenario = timeout ? RecoveryScenario.TIMEOUT : RecoveryScenario.ALL_FAILURE;
        RecoveryOutcome outcome = recovery.recover(
                decision.ownership(), scenario, decision.quotaReservation());
        ProviderAttemptStatus status = failure instanceof AdapterFailure.RateLimited
                ? ProviderAttemptStatus.RETRYABLE_FAILED
                : timeout ? ProviderAttemptStatus.TIMED_OUT
                : ProviderAttemptStatus.NON_RETRYABLE_FAILED;
        ProviderAttemptAudit audit = audit(binding, providerId, supplierName, status);
        LiveAttemptTerminal terminal = timeout ? LiveAttemptTerminal.TIMED_OUT : LiveAttemptTerminal.FAILED;
        return LiveAttemptOutcome.failed(decision, binding, audit, failure, outcome, terminal);
    }

    private ProviderAttemptAudit audit(
            InvocationBinding.ExternalAttemptBinding binding,
            ProviderId providerId,
            String supplierName,
            ProviderAttemptStatus status) {
        return new ProviderAttemptAudit(
                binding.providerAttemptId(),
                binding.ownership(),
                providerId.value(),
                supplierName,
                status);
    }

    private String supplierName(ProviderId providerId) {
        String name = supplierNames.get(providerId);
        if (name == null || name.isBlank()) {
            throw new IllegalStateException("no configured supplier name for provider " + providerId);
        }
        return name;
    }
}
