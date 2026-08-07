package com.virtualcompanion.modelanthropic;

import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;

import java.util.Objects;
import java.util.Optional;

/**
 * Network-free fail-closed session for invalid requests.
 */
final class ImmediateTerminalSession implements ModelProtocolSession {

    private final ModelProtocolEvent terminal;
    private boolean delivered;

    private ImmediateTerminalSession(ModelProtocolEvent terminal) {
        this.terminal = Objects.requireNonNull(terminal, "terminal must not be null");
    }

    static ImmediateTerminalSession failed(
            InvocationBinding binding,
            AdapterFailure failure
    ) {
        return new ImmediateTerminalSession(new ModelProtocolEvent.AttemptFailed(
                binding,
                0,
                failure
        ));
    }

    @Override
    public Optional<ModelProtocolEvent> next() {
        if (delivered) {
            return Optional.empty();
        }
        delivered = true;
        return Optional.of(terminal);
    }

    @Override
    public void cancel() {
        // The terminal failure is already fixed; cancellation is idempotent.
    }

    @Override
    public void close() {
        // No external resource was created.
    }

    @Override
    public String toString() {
        return "ImmediateTerminalSession[terminal=<redacted>]";
    }
}
