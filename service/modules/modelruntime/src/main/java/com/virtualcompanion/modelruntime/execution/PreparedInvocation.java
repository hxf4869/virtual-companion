package com.virtualcompanion.modelruntime.execution;

import com.virtualcompanion.modelruntime.contract.ExternalAttemptBinding;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.routing.RecoveryOutcome;
import com.virtualcompanion.modelruntime.routing.RouteDecision;
import java.util.Objects;

/**
 * Immutable materialized invocation produced by the prepare phase (TASK-0194).
 *
 * <p>All database reads (authorization snapshot lookup), route/auth/safety
 * pre-checks and attempt-identity binding complete inside
 * {@link LiveModelInvoker#prepare}; the external phase
 * ({@link LiveModelInvoker#execute}) consumes ONLY this object and runs the
 * adapter/session — it has no database access path at all. A prepared
 * invocation is one of two disjoint shapes:
 * <ul>
 *   <li><b>external</b> ({@link #isExternal()}): carries the resolved adapter,
 *       the immutable {@link ModelProtocolRequest} and the materialized
 *       {@link ExternalAttemptBinding} (attempt identity for the intent row and
 *       the audit record);</li>
 *   <li><b>terminal-only</b>: the guarded chain ended before any outbound
 *       (authorization denial, safety block, ZERO_LLM, no-eligible deployment
 *       or adapter misconfiguration); {@link #execute} reproduces the exact
 *       terminal outcome without touching an adapter.</li>
 * </ul>
 * </p>
 */
public final class PreparedInvocation {

    private final LiveAttemptTerminal terminal;
    private final RouteDecision decision;
    private final InvocationBinding binding;
    private final ExternalAttemptBinding attempt;
    private final ModelProtocolRequest protocolRequest;
    private final ModelProtocolAdapter adapter;
    private final RecoveryOutcome recovery;
    private final com.virtualcompanion.modelruntime.contract.AdapterFailure failure;

    private PreparedInvocation(
            LiveAttemptTerminal terminal,
            RouteDecision decision,
            InvocationBinding binding,
            ExternalAttemptBinding attempt,
            ModelProtocolRequest protocolRequest,
            ModelProtocolAdapter adapter,
            RecoveryOutcome recovery,
            com.virtualcompanion.modelruntime.contract.AdapterFailure failure) {
        this.terminal = terminal;
        this.decision = Objects.requireNonNull(decision, "decision must not be null");
        this.binding = binding;
        this.attempt = attempt;
        this.protocolRequest = protocolRequest;
        this.adapter = adapter;
        this.recovery = recovery;
        this.failure = failure;
    }

    /** An external invocation ready for the adapter-only phase. */
    public static PreparedInvocation external(
            RouteDecision decision,
            InvocationBinding binding,
            ExternalAttemptBinding attempt,
            ModelProtocolRequest protocolRequest,
            ModelProtocolAdapter adapter) {
        Objects.requireNonNull(binding, "binding must not be null for an external invocation");
        Objects.requireNonNull(attempt, "attempt must not be null for an external invocation");
        Objects.requireNonNull(protocolRequest, "protocolRequest must not be null");
        Objects.requireNonNull(adapter, "adapter must not be null");
        return new PreparedInvocation(
                null, decision, binding, attempt, protocolRequest, adapter, null, null);
    }

    /**
     * A terminal-only prepared invocation: the guarded chain stopped before any
     * outbound. {@code binding} may be null (authorization/safety/no-eligible
     * denials carry no binding); {@code failure} is non-null only for the
     * adapter-misconfiguration terminal.
     */
    public static PreparedInvocation terminalOnly(
            RouteDecision decision,
            InvocationBinding binding,
            LiveAttemptTerminal terminal,
            RecoveryOutcome recovery,
            com.virtualcompanion.modelruntime.contract.AdapterFailure failure) {
        Objects.requireNonNull(terminal, "terminal must not be null");
        Objects.requireNonNull(recovery, "recovery must not be null");
        return new PreparedInvocation(
                terminal, decision, binding, null, null, null, recovery, failure);
    }

    /** True when this prepared invocation will run a real outbound adapter session. */
    public boolean isExternal() {
        return attempt != null;
    }

    /** The terminal of a terminal-only prepared invocation (null when external). */
    public LiveAttemptTerminal terminal() {
        return terminal;
    }

    public RouteDecision decision() {
        return decision;
    }

    /** The route-decision binding (external only when {@link #isExternal()}). */
    public InvocationBinding binding() {
        return binding;
    }

    /** The materialized attempt identity (non-null only when external). */
    public ExternalAttemptBinding attempt() {
        return attempt;
    }

    /** The immutable protocol request consumed by the external phase. */
    public ModelProtocolRequest protocolRequest() {
        return protocolRequest;
    }

    /** The adapter resolved during prepare (non-null only when external). */
    public ModelProtocolAdapter adapter() {
        return adapter;
    }

    /** The recovery outcome of a terminal-only prepared invocation. */
    public RecoveryOutcome recovery() {
        return recovery;
    }

    /** The failure of the adapter-misconfiguration terminal (otherwise null). */
    public com.virtualcompanion.modelruntime.contract.AdapterFailure failure() {
        return failure;
    }
}
