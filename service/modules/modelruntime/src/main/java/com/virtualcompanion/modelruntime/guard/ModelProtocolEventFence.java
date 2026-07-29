package com.virtualcompanion.modelruntime.guard;

import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;

import java.util.Objects;
import java.util.Optional;

/**
 * Fail-closed gate for normalized adapter events.
 */
public final class ModelProtocolEventFence {

    private ModelProtocolEventFence() {
    }

    /**
     * Accepts only an event carrying the complete expected binding.
     *
     * @return the event when accepted, otherwise empty to represent discard
     */
    public static Optional<ModelProtocolEvent> accept(
            InvocationBinding expected,
            ModelProtocolEvent candidate
    ) {
        Objects.requireNonNull(expected, "expected must not be null");
        Objects.requireNonNull(candidate, "candidate must not be null");
        return expected.equals(candidate.binding())
                ? Optional.of(candidate)
                : Optional.empty();
    }
}
