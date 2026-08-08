package com.virtualcompanion.modelruntime.guard;

import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;

import java.util.Objects;

/**
 * Fail-closed stateful gate for normalized adapter events of one attempt.
 *
 * <p>Guards the exact expected {@link InvocationBinding} on every event and
 * enforces the attempt protocol: sequences are strictly contiguous from zero,
 * usage is reported at most once, and a terminal event closes the gate. An
 * {@code AttemptEos} only completes an attempt that already produced at least
 * one output delta — an empty EOS is a malformed stream, not a success.</p>
 *
 * <p>A {@link FenceViolation} means the stream is corrupt (wrong binding,
 * out-of-order or duplicate event, late event after terminal, or an EOS
 * without output); the caller must fail the whole attempt closed so a late or
 * wrong adapter event can never pollute the output or the billing chain.</p>
 */
public final class ModelProtocolEventFence {

    private final InvocationBinding expected;
    private long nextSequence;
    private boolean usageSeen;
    private boolean outputSeen;
    private boolean closed;

    public ModelProtocolEventFence(InvocationBinding expected) {
        this.expected = Objects.requireNonNull(expected, "expected must not be null");
    }

    /**
     * Accept one event when it satisfies the complete attempt protocol.
     *
     * @param candidate the next normalized adapter event
     * @return the accepted event (state advanced)
     * @throws FenceViolation when the event violates the attempt protocol; the
     *                        attempt must fail closed
     */
    public ModelProtocolEvent accept(ModelProtocolEvent candidate) {
        Objects.requireNonNull(candidate, "candidate must not be null");
        if (closed) {
            throw new FenceViolation("event after terminal");
        }
        if (!expected.equals(candidate.binding())) {
            throw new FenceViolation("unexpected binding " + candidate.binding());
        }
        if (candidate.sequence() != nextSequence) {
            throw new FenceViolation(
                    "sequence " + candidate.sequence() + " != expected " + nextSequence);
        }
        nextSequence++;
        if (candidate instanceof ModelProtocolEvent.OutputDelta) {
            outputSeen = true;
        } else if (candidate instanceof ModelProtocolEvent.UsageReported) {
            if (usageSeen) {
                throw new FenceViolation("duplicate usage report");
            }
            usageSeen = true;
        } else if (candidate instanceof ModelProtocolEvent.AttemptEos) {
            if (!outputSeen) {
                throw new FenceViolation("EOS without any output delta");
            }
            closed = true;
        } else if (candidate instanceof ModelProtocolEvent.AttemptFailed
                || candidate instanceof ModelProtocolEvent.AttemptCancelled) {
            closed = true;
        }
        return candidate;
    }

    /**
     * Signals a protocol violation. Deliberately carries no provider detail.
     */
    public static final class FenceViolation extends RuntimeException {
        public FenceViolation(String reason) {
            super(reason);
        }
    }
}
