package com.virtualcompanion.modelfailure;

import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;

import java.util.ArrayDeque;
import java.util.Objects;
import java.util.Optional;

/**
 * Package-private deterministic state machine used by the failure adapter.
 */
final class FailureModelProtocolSession implements ModelProtocolSession {

    private final InvocationBinding binding;
    private final FailureScenario scenario;
    private final ArrayDeque<ModelProtocolEvent> pendingEvents = new ArrayDeque<>();

    private long nextSequence;
    private boolean terminalScheduled;
    private boolean terminalDelivered;
    private boolean cancellationRequested;
    private boolean closed;

    FailureModelProtocolSession(
            ModelProtocolRequest request,
            FailureScript script
    ) {
        Objects.requireNonNull(request, "request must not be null");
        Objects.requireNonNull(script, "script must not be null");
        this.binding = request.binding();
        this.scenario = script.scenario();

        if (!(binding instanceof InvocationBinding.DeterministicSourceBinding deterministicBinding)) {
            scheduleFailure(new AdapterFailure.UnsupportedBinding());
            return;
        }
        if (request.responseMode() instanceof ResponseMode.StructuredJson) {
            scheduleFailure(new AdapterFailure.UnsupportedCapability(
                    ModelProtocolCapabilities.Capability.STRUCTURED_OUTPUT
            ));
            return;
        }

        scheduleScenario(deterministicBinding, script);
    }

    @Override
    public Optional<ModelProtocolEvent> next() {
        if (terminalDelivered) {
            return Optional.empty();
        }

        var event = pendingEvents.pollFirst();
        if (event == null) {
            return Optional.empty();
        }
        if (event.terminal()) {
            terminalDelivered = true;
            pendingEvents.clear();
        }
        return Optional.of(event);
    }

    @Override
    public void cancel() {
        if (cancellationRequested || terminalScheduled || terminalDelivered) {
            return;
        }
        cancellationRequested = true;
        if (scenario == FailureScenario.CANCELLATION_FAILED) {
            scheduleFailure(new AdapterFailure.CancellationFailed());
        } else {
            scheduleTerminal(new ModelProtocolEvent.AttemptCancelled(
                    binding,
                    nextSequence++
            ));
        }
    }

    @Override
    public void close() {
        if (closed) {
            return;
        }
        closed = true;
        cancel();
    }

    private void scheduleScenario(
            InvocationBinding.DeterministicSourceBinding deterministicBinding,
            FailureScript script
    ) {
        switch (scenario) {
            case HTTP_429 -> scheduleFailure(new AdapterFailure.RateLimited());
            case HTTP_5XX ->
                    scheduleFailure(new AdapterFailure.UpstreamUnavailable());
            case CONNECT_TIMEOUT ->
                    scheduleFailure(new AdapterFailure.Timeout(
                            AdapterFailure.TimeoutPhase.CONNECT
                    ));
            case FIRST_TOKEN_TIMEOUT ->
                    scheduleFailure(new AdapterFailure.Timeout(
                            AdapterFailure.TimeoutPhase.FIRST_TOKEN
                    ));
            case TOTAL_TIMEOUT -> {
                schedulePrefix(binding, script);
                scheduleFailure(new AdapterFailure.Timeout(
                        AdapterFailure.TimeoutPhase.TOTAL
                ));
            }
            case MALFORMED_EVENT ->
                    scheduleFailure(new AdapterFailure.MalformedResponse());
            case DISCONNECT -> {
                schedulePrefix(binding, script);
                scheduleFailure(new AdapterFailure.Disconnected());
            }
            case CANCELLATION_FAILED -> {
                // This scenario remains pending until cancel() or close().
            }
            case LATE_DELTA -> {
                var staleBinding = new InvocationBinding.DeterministicSourceBinding(
                        deterministicBinding.ownership(),
                        deterministicBinding.deterministicSourceId(),
                        staleFence(deterministicBinding.fence())
                );
                schedulePrefix(staleBinding, script);
                scheduleFailure(new AdapterFailure.Disconnected());
            }
        }
    }

    private void schedulePrefix(
            InvocationBinding eventBinding,
            FailureScript script
    ) {
        for (ModelPayload payload : script.prefixDeltas()) {
            pendingEvents.addLast(new ModelProtocolEvent.OutputDelta(
                    eventBinding,
                    nextSequence++,
                    payload
            ));
        }
    }

    private void scheduleFailure(AdapterFailure failure) {
        scheduleTerminal(new ModelProtocolEvent.AttemptFailed(
                binding,
                nextSequence++,
                failure
        ));
    }

    private void scheduleTerminal(ModelProtocolEvent terminal) {
        if (terminalScheduled || terminalDelivered) {
            return;
        }
        if (!terminal.terminal()) {
            throw new IllegalArgumentException("terminal event required");
        }
        terminalScheduled = true;
        pendingEvents.addLast(terminal);
    }

    private static long staleFence(long currentFence) {
        return currentFence == 0 ? 1 : currentFence - 1;
    }
}
