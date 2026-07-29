package com.virtualcompanion.modelfake;

import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;

import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * Single-consumer deterministic session. Package-private so callers interact
 * only through the supplier-neutral session port.
 */
final class FakeModelProtocolSession implements ModelProtocolSession {

    private final List<ModelProtocolEvent> events;
    private final InvocationBinding binding;

    private int index;
    private long nextSequence;
    private boolean cancellationRequested;
    private boolean terminalDelivered;

    FakeModelProtocolSession(List<ModelProtocolEvent> events) {
        Objects.requireNonNull(events, "events must not be null");
        this.events = List.copyOf(events);
        if (this.events.isEmpty()) {
            throw new IllegalArgumentException("events must not be empty");
        }

        this.binding = this.events.getFirst().binding();
        validateEventSequence();
    }

    @Override
    public Optional<ModelProtocolEvent> next() {
        if (terminalDelivered) {
            return Optional.empty();
        }
        if (cancellationRequested) {
            terminalDelivered = true;
            return Optional.of(new ModelProtocolEvent.AttemptCancelled(
                    binding,
                    nextSequence
            ));
        }

        var event = events.get(index++);
        nextSequence = event.sequence() + 1;
        if (event.terminal()) {
            terminalDelivered = true;
        }
        return Optional.of(event);
    }

    @Override
    public void cancel() {
        if (!terminalDelivered) {
            cancellationRequested = true;
        }
    }

    @Override
    public void close() {
        cancel();
    }

    private void validateEventSequence() {
        for (int eventIndex = 0; eventIndex < events.size(); eventIndex++) {
            var event = events.get(eventIndex);
            if (!binding.equals(event.binding())) {
                throw new IllegalArgumentException(
                        "all events must use the same invocation binding"
                );
            }
            if (event.sequence() != eventIndex) {
                throw new IllegalArgumentException(
                        "event sequences must start at zero and be contiguous"
                );
            }
            boolean last = eventIndex == events.size() - 1;
            if (event.terminal() != last) {
                throw new IllegalArgumentException(
                        "events must contain exactly one final terminal event"
                );
            }
        }
    }
}
