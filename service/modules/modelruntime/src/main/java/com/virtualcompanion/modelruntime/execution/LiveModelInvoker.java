package com.virtualcompanion.modelruntime.execution;

import com.virtualcompanion.catalog.ProviderAttemptStatus;
import com.virtualcompanion.catalog.RouteDecisionStatus;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshot;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotId;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationDecision;
import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationGuard;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.ExternalAttemptBinding;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.SizeLimits;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import com.virtualcompanion.modelruntime.contract.Utf8ByteAccumulator;
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
import java.util.function.Consumer;
import java.util.logging.Logger;

/**
 * Controlled real-model invocation path (TASK-0194 prepare/external split).
 *
 * <p>The invocation is split into two phases with a hard transaction boundary:
 * <ul>
 *   <li>{@link #prepare}: runs the full guarded chain — {@link DeterministicRouter}
 *       route + quota reservation, dual-snapshot {@link ExecutionAuthorizationGuard},
 *       execution-snapshot provider identity check (the ONLY database read of the
 *       whole invocation path, through {@link AuthorizationSnapshotStore#find}),
 *       {@link SafetyGate} ALLOW and adapter resolution — and materializes an
 *       immutable {@link PreparedInvocation} (attempt identity +
 *       {@link ModelProtocolRequest}). The worker persists the {@code CREATED}
 *       attempt intent inside this same prepare transaction; an intent write
 *       failure aborts the transaction and forbids the outbound (adapter zero
 *       calls).</li>
 *   <li>{@link #execute}: consumes ONLY the immutable {@link PreparedInvocation}
 *       and runs the adapter session to exactly one terminal. It has no database
 *       access path at all (no JDBC, no snapshot store, no transaction template),
 *       so the network phase never holds a database transaction or a claim row
 *       lock.</li>
 * </ul>
 * {@link #invoke} composes both phases for callers that do not need the split
 * (loopback integration tests, ZERO_LLM-only runtime).</p>
 *
 * <p>Every degraded path (denied authorization, non-adequate safety, adapter
 * missing, provider failure, timeout, cancellation, ZERO_LLM, no-eligible) is
 * fail-closed, releases the reserved quota through {@link GenerationRecovery}
 * (in-memory ledger, no database), never fabricates a success, and records a
 * {@link ProviderAttemptAudit} only for real outbound attempts.</p>
 *
 * <p>Credentials, request bodies and response text never leave the adapter
 * boundary into a business type; {@link ProviderAttemptAudit} deliberately
 * carries identity and outcome only. The {@code supplierName} comes from
 * runtime configuration via the injected map, never a hard-coded vendor name.</p>
 */
public final class LiveModelInvoker {

    private static final Logger logger =
            Logger.getLogger(LiveModelInvoker.class.getName());

    private final DeterministicRouter router;
    private final ExecutionAuthorizationGuard authorizationGuard;
    private final AuthorizationSnapshotStore authorizationSnapshotStore;
    private final AdapterLocator adapterLocator;
    private final GenerationRecovery recovery;
    private final Map<ProviderId, String> supplierNames;
    private final ActiveInvocationRegistry activeInvocations;
    private final BudgetGuard budgetGuard; // nullable: disabled when no cap configured

    public LiveModelInvoker(
            DeterministicRouter router,
            ExecutionAuthorizationGuard authorizationGuard,
            AuthorizationSnapshotStore authorizationSnapshotStore,
            AdapterLocator adapterLocator,
            GenerationRecovery recovery,
            Map<ProviderId, String> supplierNames) {
        this(router, authorizationGuard, authorizationSnapshotStore, adapterLocator,
                recovery, supplierNames, new ActiveInvocationRegistry(), null);
    }

    public LiveModelInvoker(
            DeterministicRouter router,
            ExecutionAuthorizationGuard authorizationGuard,
            AuthorizationSnapshotStore authorizationSnapshotStore,
            AdapterLocator adapterLocator,
            GenerationRecovery recovery,
            Map<ProviderId, String> supplierNames,
            ActiveInvocationRegistry activeInvocations) {
        this(router, authorizationGuard, authorizationSnapshotStore, adapterLocator,
                recovery, supplierNames, activeInvocations, null);
    }

    public LiveModelInvoker(
            DeterministicRouter router,
            ExecutionAuthorizationGuard authorizationGuard,
            AuthorizationSnapshotStore authorizationSnapshotStore,
            AdapterLocator adapterLocator,
            GenerationRecovery recovery,
            Map<ProviderId, String> supplierNames,
            ActiveInvocationRegistry activeInvocations,
            BudgetGuard budgetGuard) {
        this.router = Objects.requireNonNull(router, "router must not be null");
        this.authorizationGuard = Objects.requireNonNull(
                authorizationGuard, "authorizationGuard must not be null");
        this.authorizationSnapshotStore = Objects.requireNonNull(
                authorizationSnapshotStore, "authorizationSnapshotStore must not be null");
        this.adapterLocator = Objects.requireNonNull(adapterLocator, "adapterLocator must not be null");
        this.recovery = Objects.requireNonNull(recovery, "recovery must not be null");
        this.supplierNames = Map.copyOf(supplierNames);
        this.activeInvocations = Objects.requireNonNull(
                activeInvocations, "activeInvocations must not be null");
        this.budgetGuard = budgetGuard;
    }

    /**
     * Prepare one controlled model attempt: the guarded chain up to (and
     * including) adapter resolution and attempt-identity materialization. All
     * database reads happen here; the caller must run this inside the prepare
     * transaction and persist the attempt intent before calling
     * {@link #execute}.
     */
    public PreparedInvocation prepare(LiveInvocationRequest request) {
        Objects.requireNonNull(request, "request must not be null");
        RouteDecision decision = router.decide(request.routingRequest());
        if (decision.status() != RouteDecisionStatus.SELECTED) {
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.NO_CAPACITY,
                    decision.quotaReservation());
            return PreparedInvocation.terminalOnly(
                    decision, null, LiveAttemptTerminal.NO_ELIGIBLE_DEPLOYMENT, outcome, null);
        }
        InvocationBinding binding = decision.binding();
        Objects.requireNonNull(binding, "SELECTED decision must carry a binding");
        if (binding instanceof InvocationBinding.DeterministicSourceBinding) {
            RecoveryOutcome outcome = recovery.completeZeroLlm(
                    decision.ownership(), decision.quotaReservation());
            return PreparedInvocation.terminalOnly(
                    decision, binding, LiveAttemptTerminal.ZERO_LLM_COMPLETED, outcome, null);
        }
        if (binding instanceof InvocationBinding.ExternalAttemptBinding external) {
            return prepareExternal(request, decision, external);
        }
        throw new IllegalStateException("unexpected SELECTED binding type: " + binding);
    }

    /**
     * Execute a prepared invocation. For an external prepared invocation this
     * runs ONLY the adapter session (no database access); for a terminal-only
     * prepared invocation it reproduces the exact terminal outcome captured by
     * the prepare phase. Accepted session events are forwarded to
     * {@code eventSink} as they pass the fence (STREAM-LIVE); the sink must be
     * side-effect-light — it runs on the adapter-session loop with no database
     * transaction.
     */
    public LiveAttemptOutcome execute(PreparedInvocation prepared, Consumer<ModelProtocolEvent> eventSink) {
        Objects.requireNonNull(prepared, "prepared must not be null");
        Objects.requireNonNull(eventSink, "eventSink must not be null");
        if (!prepared.isExternal()) {
            return terminalOutcome(prepared);
        }
        return executeExternal(prepared, eventSink);
    }

    /**
     * Execute a prepared invocation without a live event sink (aggregated
     * completion only). Delegates to {@link #execute(PreparedInvocation,
     * Consumer)} with a no-op sink.
     */
    public LiveAttemptOutcome execute(PreparedInvocation prepared) {
        return execute(prepared, event -> { });
    }

    /**
     * Composed convenience entry point (prepare + execute) kept for callers
     * that do not need the explicit transaction boundary.
     */
    public LiveAttemptOutcome invoke(LiveInvocationRequest request) {
        return execute(prepare(request));
    }

    private PreparedInvocation prepareExternal(
            LiveInvocationRequest request,
            RouteDecision decision,
            InvocationBinding.ExternalAttemptBinding binding) {
        // 1. Dual-snapshot authorization; denial closes before any outbound transfer.
        ExecutionAuthorizationDecision authorization = authorizationGuard.authorize(binding);
        if (!authorization.allowed()) {
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.CANCELLED,
                    decision.quotaReservation());
            return PreparedInvocation.terminalOnly(
                    decision, null, LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION, outcome, null);
        }

        // 2. The selected deployment must be exactly the one the execution
        //    snapshot authorized; otherwise a request authorized for provider Y
        //    could be routed to provider X (INV-AUTH-001). Fail closed.
        //    This store lookup is the only database read of the invocation path
        //    and is therefore confined to the prepare phase (TASK-0194).
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
            return PreparedInvocation.terminalOnly(
                    decision, null, LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION, outcome, null);
        }

        // 3. Safety gate: only an adequate ALLOW releases an external attempt.
        SafetyVerdict verdict = SafetyGate.evaluate(
                request.hardRuleViolations(), request.classifierReport());
        if (verdict != SafetyVerdict.ALLOW) {
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.ALL_FAILURE,
                    decision.quotaReservation());
            return PreparedInvocation.terminalOnly(
                    decision, null, LiveAttemptTerminal.BLOCKED_BY_SAFETY, outcome, null);
        }

        // BUDGET-HALT (§22.18): month-to-date spend at/over the configured cap
        // refuses the outbound BEFORE any adapter resolution — fail-closed, no
        // outbound, no attempt intent.
        if (budgetGuard != null && budgetGuard.exceeded()) {
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.ALL_FAILURE,
                    decision.quotaReservation());
            return PreparedInvocation.terminalOnly(
                    decision, null, LiveAttemptTerminal.BLOCKED_BY_BUDGET, outcome, null);
        }

        // 4. Resolve the approved adapter (fail-closed; never a guessed default).
        //    Failure happens before any outbound and before any intent row, so
        //    the outcome carries no audit (no provider_attempt was created).
        final ModelProtocolAdapter adapter;
        final String supplierName;
        try {
            adapter = adapterLocator.adapterFor(providerId);
            supplierName = supplierName(providerId);
        } catch (IllegalStateException misconfigured) {
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.ALL_FAILURE,
                    decision.quotaReservation());
            return PreparedInvocation.terminalOnly(
                    decision, binding, LiveAttemptTerminal.FAILED, outcome,
                    new AdapterFailure.UpstreamUnavailable());
        }

        ModelProtocolRequest protocolRequest = new ModelProtocolRequest(
                binding,
                request.messages(),
                request.responseMode(),
                request.streaming(),
                request.timeoutBudget());

        ExternalAttemptBinding attempt = new ExternalAttemptBinding(
                binding.ownership(),
                binding.providerAttemptId(),
                binding.fence(),
                providerId.value(),
                supplierName,
                binding.requestedAuthorizationSnapshotId(),
                binding.executionAuthorizationSnapshotId());

        return PreparedInvocation.external(
                decision, binding, attempt, protocolRequest, adapter);
    }

    private LiveAttemptOutcome terminalOutcome(PreparedInvocation prepared) {
        RouteDecision decision = prepared.decision();
        RecoveryOutcome outcome = prepared.recovery();
        return switch (prepared.terminal()) {
            case NO_ELIGIBLE_DEPLOYMENT ->
                    LiveAttemptOutcome.noEligibleDeployment(decision, outcome);
            case ZERO_LLM_COMPLETED ->
                    LiveAttemptOutcome.zeroLlmCompleted(decision, prepared.binding(), outcome);
            case BLOCKED_BY_AUTHORIZATION ->
                    LiveAttemptOutcome.blockedByAuthorization(decision, outcome);
            case BLOCKED_BY_SAFETY ->
                    LiveAttemptOutcome.blockedBySafety(decision, outcome);
            case BLOCKED_BY_BUDGET ->
                    LiveAttemptOutcome.blockedByBudget(decision, outcome);
            case FAILED ->
                    LiveAttemptOutcome.failed(decision, prepared.binding(), null,
                            prepared.failure(), outcome, LiveAttemptTerminal.FAILED);
            default -> throw new IllegalStateException(
                    "unexpected terminal-only terminal: " + prepared.terminal());
        };
    }

    private LiveAttemptOutcome executeExternal(
            PreparedInvocation prepared, Consumer<ModelProtocolEvent> eventSink) {
        ExternalAttemptBinding attempt = prepared.attempt();
        ModelProtocolRequest protocolRequest = prepared.protocolRequest();
        ModelProtocolAdapter adapter = prepared.adapter();
        RouteDecision decision = prepared.decision();
        InvocationBinding binding = prepared.binding();
        ProviderId providerId = new ProviderId(attempt.providerId());

        // CANCEL-A: the session is visible to the process-local registry for the
        // whole external phase, so the HTTP cancel path can interrupt it. The
        // registry is best-effort — the database terminal state stays the truth.
        Long generationId = parseGenerationId(attempt);
        try (ModelProtocolSession session = adapter.open(protocolRequest)) {
            if (generationId != null) {
                activeInvocations.register(generationId, session);
            }
            try {
                return runSession(decision, binding, attempt, providerId, session, eventSink);
            } finally {
                if (generationId != null) {
                    activeInvocations.unregister(generationId, session);
                }
            }
        }
    }

    /** Adapter session loop to exactly one terminal event (no database access). */
    private LiveAttemptOutcome runSession(
            RouteDecision decision,
            InvocationBinding binding,
            ExternalAttemptBinding attempt,
            ProviderId providerId,
            ModelProtocolSession session,
            Consumer<ModelProtocolEvent> eventSink) {
        TokenUsage usage = new TokenUsage(0, 0, 0);
        ModelProtocolEvent terminalEvent = null;
        ModelProtocolEventFence fence = new ModelProtocolEventFence(binding);
        StringBuilder builder = new StringBuilder();
        Utf8ByteAccumulator outputBytes = new Utf8ByteAccumulator(
                SizeLimits.MAX_TOTAL_OUTPUT_BYTES
        );
        while (true) {
            final Optional<ModelProtocolEvent> next;
            try {
                next = session.next();
            } catch (RuntimeException failure) {
                // A read failure can happen after partial provider output;
                // cancel before returning the normalized fail-closed result.
                // Log the class only — never provider content or secrets.
                logger.warning("model session read failed ("
                        + failure.getClass().getSimpleName() + "), normalizing to fail-closed");
                session.cancel();
                return fenceViolationOutcome(decision, binding, attempt, providerId);
            }
            if (next.isEmpty()) {
                // close() is not a substitute for cancelling an incomplete
                // provider session; release the stream explicitly first.
                session.cancel();
                break;
            }
            final ModelProtocolEvent event;
            try {
                event = fence.accept(next.get());
            } catch (ModelProtocolEventFence.FenceViolation violation) {
                // Corrupt stream (wrong binding, out-of-order, duplicate
                // usage, EOS without output): fail the whole attempt closed
                // so a late or wrong event can never pollute output/usage.
                session.cancel();
                return fenceViolationOutcome(decision, binding, attempt, providerId);
            }
            // STREAM-LIVE: forward the fenced event to the live sink before the
            // aggregation dispatch. The sink is side-effect-light and runs with
            // no database transaction (worker segmented model).
            eventSink.accept(event);
            if (event instanceof ModelProtocolEvent.OutputDelta delta) {
                final String content;
                if (delta.payload() instanceof ModelPayload.TextChunk chunk) {
                    content = chunk.text();
                } else if (delta.payload() instanceof ModelPayload.StructuredJson json) {
                    content = json.json();
                } else {
                    throw new IllegalStateException("unexpected output payload type");
                }
                if (!outputBytes.tryAppend(content)) {
                    session.cancel();
                    return fenceViolationOutcome(decision, binding, attempt, providerId);
                }
                builder.append(content);
            } else if (event instanceof ModelProtocolEvent.UsageReported reported) {
                usage = reported.usage();
            } else if (event.terminal()) {
                terminalEvent = event;
                break;
            }
        }
        String output = builder.toString();

        if (terminalEvent == null) {
            // Session closed without a terminal event: malformed stream, fail closed.
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.ALL_FAILURE,
                    decision.quotaReservation());
            ProviderAttemptAudit audit = audit(attempt, ProviderAttemptStatus.NON_RETRYABLE_FAILED);
            return LiveAttemptOutcome.failed(decision, binding, audit,
                    new AdapterFailure.MalformedResponse(), outcome, LiveAttemptTerminal.FAILED);
        }
        if (terminalEvent instanceof ModelProtocolEvent.AttemptEos) {
            ProviderAttemptAudit audit = audit(attempt, ProviderAttemptStatus.SUCCEEDED);
            return LiveAttemptOutcome.succeeded(decision, binding, audit, output, usage,
                    decision.quotaReservation());
        }
        if (terminalEvent instanceof ModelProtocolEvent.AttemptCancelled) {
            RecoveryOutcome outcome = recovery.recover(
                    decision.ownership(), RecoveryScenario.CANCELLED,
                    decision.quotaReservation());
            ProviderAttemptAudit audit = audit(attempt, ProviderAttemptStatus.CANCELLED);
            return LiveAttemptOutcome.cancelled(decision, binding, audit, outcome);
        }
        if (terminalEvent instanceof ModelProtocolEvent.AttemptFailed failed) {
            return handleFailure(decision, binding, attempt, providerId, failed.failure());
        }
        throw new IllegalStateException("unexpected terminal event: " + terminalEvent);
    }

    /** Numeric generation id from the ownership tuple, or null when unparseable (no registration). */
    private static Long parseGenerationId(ExternalAttemptBinding attempt) {
        try {
            return Long.valueOf(attempt.ownership().generationId());
        } catch (NumberFormatException notNumeric) {
            return null;
        }
    }

    private LiveAttemptOutcome fenceViolationOutcome(
            RouteDecision decision,
            InvocationBinding binding,
            ExternalAttemptBinding attempt,
            ProviderId providerId) {
        RecoveryOutcome outcome = recovery.recover(
                decision.ownership(), RecoveryScenario.ALL_FAILURE,
                decision.quotaReservation());
        ProviderAttemptAudit audit = audit(attempt, ProviderAttemptStatus.NON_RETRYABLE_FAILED);
        return LiveAttemptOutcome.failed(decision, binding, audit,
                new AdapterFailure.MalformedResponse(), outcome, LiveAttemptTerminal.FAILED);
    }

    private LiveAttemptOutcome handleFailure(
            RouteDecision decision,
            InvocationBinding binding,
            ExternalAttemptBinding attempt,
            ProviderId providerId,
            AdapterFailure failure) {
        boolean timeout = failure instanceof AdapterFailure.Timeout;
        RecoveryScenario scenario = timeout ? RecoveryScenario.TIMEOUT : RecoveryScenario.ALL_FAILURE;
        RecoveryOutcome outcome = recovery.recover(
                decision.ownership(), scenario, decision.quotaReservation());
        ProviderAttemptStatus status = failure instanceof AdapterFailure.RateLimited
                ? ProviderAttemptStatus.RETRYABLE_FAILED
                : timeout ? ProviderAttemptStatus.TIMED_OUT
                : ProviderAttemptStatus.NON_RETRYABLE_FAILED;
        ProviderAttemptAudit audit = audit(attempt, status);
        LiveAttemptTerminal terminal = timeout ? LiveAttemptTerminal.TIMED_OUT : LiveAttemptTerminal.FAILED;
        return LiveAttemptOutcome.failed(decision, binding, audit, failure, outcome, terminal);
    }

    private ProviderAttemptAudit audit(
            ExternalAttemptBinding attempt,
            ProviderAttemptStatus status) {
        return new ProviderAttemptAudit(
                attempt.providerAttemptId(),
                attempt.ownership(),
                attempt.providerId(),
                attempt.supplierName(),
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
