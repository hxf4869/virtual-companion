package com.virtualcompanion.generation.contract;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.conversation.generation.AttemptTermination;
import com.virtualcompanion.modelfake.FakeModelProtocolAdapter;
import com.virtualcompanion.modelfake.FakeResponseScript;
import com.virtualcompanion.modelfailure.FailureModelProtocolAdapter;
import com.virtualcompanion.modelfailure.FailureScenario;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import org.junit.jupiter.api.Test;

/**
 * Offline end-to-end fault matrix for the Fake/Failure slice (TASK-0022).
 *
 * <p>Each test runs {@link OfflineGenerationSlice} on synthetic data with one
 * Fake (success) or Failure adapter and asserts the unique terminal state. The
 * summary test proves the fault classes never collapse into one another, and
 * that an authorization denial never reaches the adapter (zero outbound
 * transfer on denial). All tests are in-process: no HTTP, no database, no real
 * provider, no safety-module compile dependency.
 */
class OfflineGenerationSliceTest {

    private static ModelProtocolAdapter fake() {
        return new FakeModelProtocolAdapter(FakeResponseScript.text(
                List.of("Hello ", "world", "!"),
                new TokenUsage(3, 3, 6),
                StopReason.STOP));
    }

    private static ModelProtocolAdapter failure(FailureScenario scenario) {
        return new FailureModelProtocolAdapter(scenario);
    }

    private static OfflineGenerationSlice.SliceOutcome run(
            OfflineGenerationSlice.SliceConfiguration config) {
        return OfflineGenerationSlice.run(config);
    }

    @Test
    void fakeSuccessCompletes() {
        var outcome = run(OfflineGenerationSlice.SliceConfiguration.success("fake-success", fake()));
        assertEquals(SliceTerminalState.COMPLETED, outcome.terminalState());
        assertTrue(outcome.authorized());
        assertTrue(outcome.safetyAllowedCompletion());
        assertTrue(outcome.termination() instanceof AttemptTermination.Succeeded);
    }

    @Test
    void safetyBlockPreventsCompletion() {
        var outcome = run(OfflineGenerationSlice.SliceConfiguration.blocked("safety-block", fake()));
        assertEquals(SliceTerminalState.BLOCKED_AT_SAFETY, outcome.terminalState());
        assertFalse(outcome.safetyAllowedCompletion());
        assertTrue(outcome.termination() instanceof AttemptTermination.Succeeded);
    }

    @Test
    void midStreamCancelTerminatesCancelled() {
        var outcome = run(OfflineGenerationSlice.SliceConfiguration.cancelled(
                "fake-cancel", fake(), 2));
        assertEquals(SliceTerminalState.CANCELLED, outcome.terminalState());
        assertTrue(outcome.termination() instanceof AttemptTermination.Cancelled);
    }

    @Test
    void authorizationDenialNeverReachesAdapter() {
        var outcome = run(OfflineGenerationSlice.SliceConfiguration.denied("auth-denied", fake()));
        assertEquals(SliceTerminalState.DENIED_BY_AUTHORIZATION, outcome.terminalState());
        assertFalse(outcome.authorized());
        assertNull(outcome.termination());
    }

    @Test
    void rateLimitedFailure() {
        assertEquals(SliceTerminalState.FAILED_RATE_LIMITED,
                run(OfflineGenerationSlice.SliceConfiguration.failure(
                        "429", failure(FailureScenario.HTTP_429))).terminalState());
    }

    @Test
    void upstreamUnavailableFailure() {
        assertEquals(SliceTerminalState.FAILED_UPSTREAM_UNAVAILABLE,
                run(OfflineGenerationSlice.SliceConfiguration.failure(
                        "5xx", failure(FailureScenario.HTTP_5XX))).terminalState());
    }

    @Test
    void connectTimeoutFailure() {
        var outcome = run(OfflineGenerationSlice.SliceConfiguration.failure(
                "connect-timeout", failure(FailureScenario.CONNECT_TIMEOUT)));
        assertEquals(SliceTerminalState.FAILED_TIMEOUT_CONNECT, outcome.terminalState());
        assertTrue(outcome.termination() instanceof AttemptTermination.Failed);
    }

    @Test
    void firstTokenTimeoutFailure() {
        assertEquals(SliceTerminalState.FAILED_TIMEOUT_FIRST_TOKEN,
                run(OfflineGenerationSlice.SliceConfiguration.failure(
                        "first-token-timeout", failure(FailureScenario.FIRST_TOKEN_TIMEOUT)))
                        .terminalState());
    }

    @Test
    void totalTimeoutFailure() {
        assertEquals(SliceTerminalState.FAILED_TIMEOUT_TOTAL,
                run(OfflineGenerationSlice.SliceConfiguration.failure(
                        "total-timeout", failure(FailureScenario.TOTAL_TIMEOUT)))
                        .terminalState());
    }

    @Test
    void malformedResponseFailure() {
        assertEquals(SliceTerminalState.FAILED_MALFORMED_RESPONSE,
                run(OfflineGenerationSlice.SliceConfiguration.failure(
                        "malformed", failure(FailureScenario.MALFORMED_EVENT)))
                        .terminalState());
    }

    @Test
    void disconnectFailureHasNoStaleDiscard() {
        var outcome = run(OfflineGenerationSlice.SliceConfiguration.failure(
                "disconnect", failure(FailureScenario.DISCONNECT)));
        assertEquals(SliceTerminalState.FAILED_DISCONNECTED, outcome.terminalState());
        assertEquals(0, outcome.discardedStaleEvents(),
                "DISCONNECT prefix uses the live binding and is not stale");
    }

    @Test
    void lateDeltaFailureDiscardsStaleFenceEvent() {
        var outcome = run(OfflineGenerationSlice.SliceConfiguration.failure(
                "late-delta", failure(FailureScenario.LATE_DELTA)));
        // The stale-fence prefix is discarded on a binding mismatch, which opens
        // a sequence gap that also rejects the following failure, so the reducer
        // never accepts a terminal event -> the stream is invalid; the stale
        // discard count is the LATE_DELTA signal that distinguishes it.
        assertEquals(SliceTerminalState.FAILED_INVALID_STREAM, outcome.terminalState());
        assertTrue(outcome.discardedStaleEvents() >= 1,
                "LATE_DELTA emits a stale-fence delta the reducer must discard");
    }

    @Test
    void cancellationFailedAfterCancelRequest() {
        var outcome = run(new OfflineGenerationSlice.SliceConfiguration(
                "cancellation-failed",
                failure(FailureScenario.CANCELLATION_FAILED),
                true,
                true,
                0,
                false));
        assertEquals(SliceTerminalState.FAILED_CANCELLATION_FAILED, outcome.terminalState());
        assertTrue(outcome.termination() instanceof AttemptTermination.Failed);
    }

    @Test
    void allFaultClassesProduceDistinctTerminalStates() {
        List<SliceTerminalState> states = new ArrayList<>();
        states.add(run(OfflineGenerationSlice.SliceConfiguration.success("s", fake())).terminalState());
        states.add(run(OfflineGenerationSlice.SliceConfiguration.failure(
                "429", failure(FailureScenario.HTTP_429))).terminalState());
        states.add(run(OfflineGenerationSlice.SliceConfiguration.failure(
                "5xx", failure(FailureScenario.HTTP_5XX))).terminalState());
        states.add(run(OfflineGenerationSlice.SliceConfiguration.failure(
                "ct", failure(FailureScenario.CONNECT_TIMEOUT))).terminalState());
        states.add(run(OfflineGenerationSlice.SliceConfiguration.failure(
                "ft", failure(FailureScenario.FIRST_TOKEN_TIMEOUT))).terminalState());
        states.add(run(OfflineGenerationSlice.SliceConfiguration.failure(
                "tt", failure(FailureScenario.TOTAL_TIMEOUT))).terminalState());
        states.add(run(OfflineGenerationSlice.SliceConfiguration.failure(
                "mf", failure(FailureScenario.MALFORMED_EVENT))).terminalState());
        states.add(run(OfflineGenerationSlice.SliceConfiguration.failure(
                "dc", failure(FailureScenario.DISCONNECT))).terminalState());
        states.add(run(OfflineGenerationSlice.SliceConfiguration.failure(
                "ld", failure(FailureScenario.LATE_DELTA))).terminalState());
        states.add(run(OfflineGenerationSlice.SliceConfiguration.cancelled(
                "c", fake(), 1)).terminalState());
        states.add(run(OfflineGenerationSlice.SliceConfiguration.blocked(
                "b", fake())).terminalState());
        states.add(run(OfflineGenerationSlice.SliceConfiguration.denied(
                "d", fake())).terminalState());
        states.add(run(new OfflineGenerationSlice.SliceConfiguration(
                "cf", failure(FailureScenario.CANCELLATION_FAILED), true, true, 0, false))
                .terminalState());

        // Every distinct fault class resolves to a distinct terminal state.
        Set<SliceTerminalState> distinct = Set.copyOf(states);
        assertEquals(states.size(), distinct.size(),
                "fault classes collapsed: " + states.stream()
                        .map(Enum::name)
                        .collect(Collectors.joining(",")));
    }
}
