package com.virtualcompanion.generation.contract;

import com.virtualcompanion.catalog.GenerationState;
import com.virtualcompanion.conversation.generation.AttemptEventResult;
import com.virtualcompanion.conversation.generation.AttemptEventResult.DiscardReason;
import com.virtualcompanion.conversation.generation.AttemptTermination;
import com.virtualcompanion.conversation.generation.GenerationAttemptReducer;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshot;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotId;
import com.virtualcompanion.modelruntime.authorization.AuthorizationStatus;
import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationDecision;
import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationGuard;
import com.virtualcompanion.modelruntime.authorization.InMemoryAuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.authorization.ProcessingPurpose;
import com.virtualcompanion.modelruntime.authorization.ProviderContractRef;
import com.virtualcompanion.modelruntime.authorization.ProviderRegion;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import com.virtualcompanion.modelruntime.registry.InMemoryProviderRegistry;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistration;

import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * Offline end-to-end generation slice that wires the in-process runtime
 * primitives on synthetic data: ExecutionAuthorizationGuard -> ModelProtocolAdapter
 * -> GenerationAttemptReducer, producing one unique {@link SliceTerminalState} per run.
 *
 * <p>The slice is network-free and database-free: the Fake and Failure adapters
 * run in-process, the in-memory registry/snapshot-store back the guard, and the
 * JDBC-bound receive/claim/finalize/resume services is proven separately by the
 * SQL contract suite. The slice proves the model-runtime path end-to-end:
 * <ul>
 *   <li>a denied authorization returns before the adapter is opened (zero
 *       outbound transfer on denial — INV-AUTH-001);</li>
 *   <li>every normalized adapter failure maps to a distinct terminal state;</li>
 *   <li>a cancelled stream terminates as CANCELLED;</li>
 *   <li>a successful stream completes only when the final safety review allows
 *       it (the {@code safetyAllowsCompletion} input models the
 *       SafetyGate/SafetyReview decision proven by TASK-0020; a false value
 *       yields BLOCKED_AT_SAFETY so {@code chat.completed} never follows a
 *       final-review failure — INV-GEN-003, INV-TX-001);</li>
 *   <li>a stale-fence LATE_DELTA opens a sequence gap that invalidates the
 *       stream (INV-RT-001: missing deltas are never fabricated).</li>
 * </ul>
 *
 * <p>Pure and deterministic: the same {@link SliceConfiguration} always yields
 * the same {@link SliceOutcome}. The safety decision is supplied by the caller
 * rather than recomputed here, so this module stays free of a safety-module
 * compile dependency while still proving the terminal-state effect of safety.
 */
public final class OfflineGenerationSlice {

    private static final OwnershipTuple OWNERSHIP =
            new OwnershipTuple("owner-1", "rel-1", "conv-1", "gen-1");
    private static final ProviderId PROVIDER = new ProviderId("provider-slice");
    private static final ProviderRegion REGION = new ProviderRegion("region-a");
    private static final ProviderContractRef CONTRACT =
            new ProviderContractRef("contract-a");
    private static final ProcessingPurpose PURPOSE = ProcessingPurpose.COMPANION_CHAT;
    private static final Set<DataCategory> CATEGORIES =
            Set.of(DataCategory.MESSAGE_TEXT);

    private OfflineGenerationSlice() {
    }

    /**
     * Run one configured slice and return its unique terminal outcome.
     */
    public static SliceOutcome run(SliceConfiguration config) {
        Objects.requireNonNull(config, "config must not be null");

        InvocationBinding deterministicBinding =
                new InvocationBinding.DeterministicSourceBinding(OWNERSHIP, "src-1", 42L);
        InvocationBinding.ExternalAttemptBinding externalBinding =
                new InvocationBinding.ExternalAttemptBinding(
                        OWNERSHIP, "attempt-1", 42L, "snap-req", "snap-exec");

        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        registry.register(new ProviderRegistration(
                PROVIDER,
                config.adapter().protocol(),
                config.adapter().capabilities(),
                config.adapter()));
        InMemoryAuthorizationSnapshotStore store = new InMemoryAuthorizationSnapshotStore();
        store.put(activeSnapshot("snap-req"));
        store.put(config.denyAuthorization()
                ? snapshot("snap-exec", AuthorizationStatus.WITHDRAWN)
                : activeSnapshot("snap-exec"));

        ExecutionAuthorizationGuard guard =
                new ExecutionAuthorizationGuard(store, registry);
        ExecutionAuthorizationDecision decision = guard.authorize(externalBinding);
        if (!decision.allowed()) {
            return new SliceOutcome(
                    SliceTerminalState.DENIED_BY_AUTHORIZATION,
                    null,
                    false,
                    false,
                    0);
        }

        ModelProtocolRequest request = new ModelProtocolRequest(
                deterministicBinding,
                List.of(new ProtocolMessage(
                        ProtocolMessage.Role.USER,
                        "synthetic offline slice input")),
                new ResponseMode.Text(),
                true,
                timeoutBudget());

        GenerationAttemptReducer reducer = new GenerationAttemptReducer(
                deterministicBinding, "cand-1", GenerationState.IN_PROGRESS);

        int consumed = 0;
        int discardedStale = 0;
        boolean cancellationRequested = false;
        try (ModelProtocolSession session = config.adapter().open(request)) {
            while (reducer.termination().isEmpty()) {
                if (config.cancelMidStream()
                        && !cancellationRequested
                        && consumed >= config.cancelAfterEvents()) {
                    session.cancel();
                    cancellationRequested = true;
                }
                Optional<ModelProtocolEvent> next = session.next();
                if (next.isEmpty()) {
                    break;
                }
                AttemptEventResult result = reducer.accept(next.get());
                consumed++;
                if (result instanceof AttemptEventResult.Discarded discarded
                        && discarded.reason() == DiscardReason.BINDING_MISMATCH) {
                    discardedStale++;
                }
            }
        }

        AttemptTermination termination = reducer.termination().orElse(null);
        if (termination == null) {
            // No terminal event was accepted. A stale-fence LATE_DELTA discards
            // its prefix on a binding mismatch, opening a sequence gap that also
            // rejects the following failure, so the reducer never terminates:
            // the stream is invalid rather than completed, failed or cancelled.
            return new SliceOutcome(
                    SliceTerminalState.FAILED_INVALID_STREAM,
                    null,
                    false,
                    true,
                    discardedStale);
        }

        boolean safetyAllowedCompletion = false;
        SliceTerminalState state;
        if (termination instanceof AttemptTermination.Succeeded) {
            safetyAllowedCompletion = config.safetyAllowsCompletion();
            state = safetyAllowedCompletion
                    ? SliceTerminalState.COMPLETED
                    : SliceTerminalState.BLOCKED_AT_SAFETY;
        } else if (termination instanceof AttemptTermination.Failed failed) {
            state = mapFailure(failed.failure());
        } else if (termination instanceof AttemptTermination.Cancelled) {
            state = SliceTerminalState.CANCELLED;
        } else if (termination instanceof AttemptTermination.InvalidStream) {
            state = SliceTerminalState.FAILED_INVALID_STREAM;
        } else {
            throw new IllegalStateException(
                    "unhandled termination: " + termination);
        }

        return new SliceOutcome(state, termination, safetyAllowedCompletion, true, discardedStale);
    }

    private static SliceTerminalState mapFailure(AdapterFailure failure) {
        if (failure instanceof AdapterFailure.RateLimited) {
            return SliceTerminalState.FAILED_RATE_LIMITED;
        }
        if (failure instanceof AdapterFailure.UpstreamUnavailable) {
            return SliceTerminalState.FAILED_UPSTREAM_UNAVAILABLE;
        }
        if (failure instanceof AdapterFailure.Timeout timeout) {
            return switch (timeout.phase()) {
                case CONNECT -> SliceTerminalState.FAILED_TIMEOUT_CONNECT;
                case FIRST_TOKEN -> SliceTerminalState.FAILED_TIMEOUT_FIRST_TOKEN;
                case TOTAL -> SliceTerminalState.FAILED_TIMEOUT_TOTAL;
            };
        }
        if (failure instanceof AdapterFailure.MalformedResponse) {
            return SliceTerminalState.FAILED_MALFORMED_RESPONSE;
        }
        if (failure instanceof AdapterFailure.Disconnected) {
            return SliceTerminalState.FAILED_DISCONNECTED;
        }
        if (failure instanceof AdapterFailure.CancellationFailed) {
            return SliceTerminalState.FAILED_CANCELLATION_FAILED;
        }
        return SliceTerminalState.FAILED_INVALID_STREAM;
    }

    private static AuthorizationSnapshot activeSnapshot(String id) {
        return snapshot(id, AuthorizationStatus.ACTIVE);
    }

    private static AuthorizationSnapshot snapshot(String id, AuthorizationStatus status) {
        return new AuthorizationSnapshot(
                new AuthorizationSnapshotId(id),
                status,
                PROVIDER,
                REGION,
                CONTRACT,
                PURPOSE,
                CATEGORIES,
                false,
                false);
    }

    private static TimeoutBudget timeoutBudget() {
        return new TimeoutBudget(
                Duration.ofSeconds(1),
                Duration.ofSeconds(2),
                Duration.ofSeconds(3));
    }

    /**
     * One configured slice run.
     *
     * @param label                 human-readable scenario label
     * @param adapter               the in-process Fake or Failure adapter
     * @param safetyAllowsCompletion whether the final safety review allows completion
     *                               (models the SafetyGate/SafetyReview decision; false => BLOCKED_AT_SAFETY)
     * @param cancelMidStream       whether to cancel the stream before its natural terminal
     * @param cancelAfterEvents     number of events to consume before requesting cancellation
     * @param denyAuthorization     whether the execution snapshot is WITHDRAWN (forces denial)
     */
    public record SliceConfiguration(
            String label,
            ModelProtocolAdapter adapter,
            boolean safetyAllowsCompletion,
            boolean cancelMidStream,
            int cancelAfterEvents,
            boolean denyAuthorization) {

        public SliceConfiguration {
            Objects.requireNonNull(label, "label must not be null");
            if (label.isBlank()) {
                throw new IllegalArgumentException("label must not be blank");
            }
            Objects.requireNonNull(adapter, "adapter must not be null");
            if (cancelAfterEvents < 0) {
                throw new IllegalArgumentException("cancelAfterEvents must be non-negative");
            }
        }

        /** A successful-path slice that completes when safety allows. */
        public static SliceConfiguration success(String label, ModelProtocolAdapter adapter) {
            return new SliceConfiguration(label, adapter, true, false, 0, false);
        }

        /** A successful stream whose final safety review blocks completion. */
        public static SliceConfiguration blocked(String label, ModelProtocolAdapter adapter) {
            return new SliceConfiguration(label, adapter, false, false, 0, false);
        }

        /** A failure-injection slice driven by a Failure adapter. */
        public static SliceConfiguration failure(String label, ModelProtocolAdapter adapter) {
            return new SliceConfiguration(label, adapter, true, false, 0, false);
        }

        /** A slice that cancels the stream after the given number of events. */
        public static SliceConfiguration cancelled(
                String label, ModelProtocolAdapter adapter, int afterEvents) {
            return new SliceConfiguration(label, adapter, true, true, afterEvents, false);
        }

        /** A slice whose authorization is withdrawn, forcing a denial before outbound transfer. */
        public static SliceConfiguration denied(String label, ModelProtocolAdapter adapter) {
            return new SliceConfiguration(label, adapter, true, false, 0, true);
        }
    }

    /**
     * The outcome of one slice run.
     *
     * @param terminalState         the unique terminal state
     * @param termination           the reducer termination (null on denial or an invalid stream)
     * @param safetyAllowedCompletion whether the final safety review allowed completion (Succeeded runs only)
     * @param authorized            whether the guard allowed the attempt
     * @param discardedStaleEvents  events discarded for a stale-fence binding (LATE_DELTA signal)
     */
    public record SliceOutcome(
            SliceTerminalState terminalState,
            AttemptTermination termination,
            boolean safetyAllowedCompletion,
            boolean authorized,
            int discardedStaleEvents) {

        public SliceOutcome {
            Objects.requireNonNull(terminalState, "terminalState must not be null");
        }
    }
}
