package com.virtualcompanion.modelruntime.execution;

import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import com.virtualcompanion.modelruntime.routing.QuotaReservation;
import com.virtualcompanion.modelruntime.routing.RecoveryOutcome;
import com.virtualcompanion.modelruntime.routing.RouteDecision;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * Immutable outcome of one live model invocation.
 *
 * <p>Carries the original {@link RouteDecision} (stable {@code decisionNo} and
 * reservation), exactly one {@link LiveAttemptTerminal}, the audit records for
 * any real outbound attempt, the normalized usage, and the recovery decision
 * for every degraded/blocked path (quota disposition + deterministic response).
 * An external attempt always records a {@link ProviderAttemptAudit}; the
 * blocked / ZERO_LLM / no-eligible paths record none because they create no
 * {@code provider_attempt} (generation contract: ZERO_LLM and blocked paths
 * never fabricate an outbound attempt).</p>
 */
public record LiveAttemptOutcome(
        LiveAttemptTerminal terminal,
        RouteDecision decision,
        InvocationBinding binding,
        List<ProviderAttemptAudit> audits,
        TokenUsage usage,
        AdapterFailure failure,
        RecoveryOutcome recovery,
        String response,
        QuotaReservation quotaReservation) {

    public LiveAttemptOutcome {
        Objects.requireNonNull(terminal, "terminal must not be null");
        Objects.requireNonNull(decision, "decision must not be null");
        audits = audits == null ? List.of() : List.copyOf(audits);
        Objects.requireNonNull(response, "response must not be null");
        switch (terminal) {
            case SUCCEEDED, CANCELLED ->
                    Objects.requireNonNull(binding, "binding must not be null for " + terminal);
            case FAILED, TIMED_OUT -> {
                Objects.requireNonNull(binding, "binding must not be null for " + terminal);
                Objects.requireNonNull(failure, "failure must not be null for " + terminal);
                Objects.requireNonNull(recovery, "recovery must not be null for " + terminal);
            }
            case BLOCKED_BY_AUTHORIZATION, BLOCKED_BY_SAFETY,
                 ZERO_LLM_COMPLETED, NO_ELIGIBLE_DEPLOYMENT ->
                    Objects.requireNonNull(recovery, "recovery must not be null for " + terminal);
            default -> throw new IllegalStateException("unexpected terminal: " + terminal);
        }
    }

    public Optional<InvocationBinding> bindingOptional() {
        return Optional.ofNullable(binding);
    }

    public Optional<TokenUsage> usageOptional() {
        return Optional.ofNullable(usage);
    }

    public Optional<AdapterFailure> failureOptional() {
        return Optional.ofNullable(failure);
    }

    public Optional<RecoveryOutcome> recoveryOptional() {
        return Optional.ofNullable(recovery);
    }

    public Optional<QuotaReservation> quotaReservationOptional() {
        return Optional.ofNullable(quotaReservation);
    }

    /**
     * The {@code realtime_event} type the upstream streaming layer emits for
     * this terminal, so the audit chain covers provider attempt, usage and
     * realtime event without the streaming layer re-interpreting the outcome.
     * Only a success (or the ZERO_LLM completion) maps to
     * {@code CHAT_COMPLETED}; every failure, cancellation, safety block and
     * no-eligible path never fabricates a completed event.
     */
    public com.virtualcompanion.catalog.RealtimeEventType realtimeEventType() {
        return switch (terminal) {
            case SUCCEEDED, ZERO_LLM_COMPLETED -> com.virtualcompanion.catalog.RealtimeEventType.CHAT_COMPLETED;
            case CANCELLED, BLOCKED_BY_AUTHORIZATION -> com.virtualcompanion.catalog.RealtimeEventType.CHAT_CANCELLED;
            case BLOCKED_BY_SAFETY -> com.virtualcompanion.catalog.RealtimeEventType.CHAT_BLOCKED;
            case FAILED, TIMED_OUT, NO_ELIGIBLE_DEPLOYMENT -> com.virtualcompanion.catalog.RealtimeEventType.CHAT_FAILED;
        };
    }

    /**
     * True when a real outbound provider attempt was created (a
     * {@code provider_attempt} row exists). This is exactly when the outcome
     * carries a non-empty audit list: every real outbound attempt records an
     * audit, and every path that never opened an adapter (blocked, ZERO_LLM,
     * no-eligible, or a misconfiguration that failed before transfer) records
     * none. A path that merely resolved an external binding but never
     * transferred is therefore not a created provider attempt.
     */
    public boolean externalAttemptCreated() {
        return !audits.isEmpty();
    }

    /**
     * A successful external attempt. The quota reservation is retained for the
     * upstream finalization path to settle; it is never released here.
     */
    public static LiveAttemptOutcome succeeded(
            RouteDecision decision,
            InvocationBinding binding,
            ProviderAttemptAudit audit,
            String response,
            TokenUsage usage,
            QuotaReservation reservation) {
        return new LiveAttemptOutcome(
                LiveAttemptTerminal.SUCCEEDED,
                decision,
                binding,
                List.of(audit),
                usage,
                null,
                null,
                response,
                reservation);
    }

    /**
     * A failed external attempt (quota already released by recovery). The audit
     * may be null when no real outbound transfer happened (e.g. an adapter or
     * supplier-name misconfiguration), in which case no provider_attempt row
     * exists.
     */
    public static LiveAttemptOutcome failed(
            RouteDecision decision,
            InvocationBinding binding,
            ProviderAttemptAudit audit,
            AdapterFailure failure,
            RecoveryOutcome recovery,
            LiveAttemptTerminal terminal) {
        return new LiveAttemptOutcome(
                terminal,
                decision,
                binding,
                audit == null ? List.of() : List.of(audit),
                null,
                Objects.requireNonNull(failure, "failure must not be null"),
                recovery,
                recovery.response(),
                null);
    }

    /** A cancelled external attempt (quota released, no fabricated terminal). */
    public static LiveAttemptOutcome cancelled(
            RouteDecision decision,
            InvocationBinding binding,
            ProviderAttemptAudit audit,
            RecoveryOutcome recovery) {
        return new LiveAttemptOutcome(
                LiveAttemptTerminal.CANCELLED,
                decision,
                binding,
                List.of(audit),
                null,
                null,
                recovery,
                "",
                null);
    }

    /** Blocked by the authorization guard before any outbound transfer. */
    public static LiveAttemptOutcome blockedByAuthorization(
            RouteDecision decision,
            RecoveryOutcome recovery) {
        return new LiveAttemptOutcome(
                LiveAttemptTerminal.BLOCKED_BY_AUTHORIZATION,
                decision,
                null,
                List.of(),
                null,
                null,
                recovery,
                "",
                null);
    }

    /** Blocked by the safety gate before any outbound transfer (deterministic response). */
    public static LiveAttemptOutcome blockedBySafety(
            RouteDecision decision,
            RecoveryOutcome recovery) {
        return new LiveAttemptOutcome(
                LiveAttemptTerminal.BLOCKED_BY_SAFETY,
                decision,
                null,
                List.of(),
                null,
                null,
                recovery,
                recovery.response(),
                null);
    }

    /** ZERO_LLM deterministic-source completion; never a provider attempt. */
    public static LiveAttemptOutcome zeroLlmCompleted(
            RouteDecision decision,
            InvocationBinding binding,
            RecoveryOutcome recovery) {
        return new LiveAttemptOutcome(
                LiveAttemptTerminal.ZERO_LLM_COMPLETED,
                decision,
                binding,
                List.of(),
                null,
                null,
                recovery,
                recovery.response(),
                null);
    }

    /** No eligible deployment (quota no-capacity or missing deployment). */
    public static LiveAttemptOutcome noEligibleDeployment(
            RouteDecision decision,
            RecoveryOutcome recovery) {
        return new LiveAttemptOutcome(
                LiveAttemptTerminal.NO_ELIGIBLE_DEPLOYMENT,
                decision,
                null,
                List.of(),
                null,
                null,
                recovery,
                recovery.response(),
                null);
    }
}
