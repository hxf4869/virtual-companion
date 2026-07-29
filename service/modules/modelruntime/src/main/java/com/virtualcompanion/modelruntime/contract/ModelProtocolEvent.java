package com.virtualcompanion.modelruntime.contract;

/**
 * Ordered normalized event from one adapter session.
 *
 * <p>An {@link AttemptEos} closes only this session/attempt. It never means
 * that a Generation or assistant message has been finalized.</p>
 */
public sealed interface ModelProtocolEvent
        permits ModelProtocolEvent.OutputDelta,
        ModelProtocolEvent.UsageReported,
        ModelProtocolEvent.AttemptEos,
        ModelProtocolEvent.AttemptFailed,
        ModelProtocolEvent.AttemptCancelled {

    InvocationBinding binding();

    long sequence();

    default boolean terminal() {
        return this instanceof AttemptEos
                || this instanceof AttemptFailed
                || this instanceof AttemptCancelled;
    }

    record OutputDelta(
            InvocationBinding binding,
            long sequence,
            ModelPayload payload
    ) implements ModelProtocolEvent {

        public OutputDelta {
            binding = requireEventBinding(binding);
            sequence = requireEventSequence(sequence);
            payload = ContractChecks.requireNonNull(payload, "payload");
        }
    }

    record UsageReported(
            InvocationBinding binding,
            long sequence,
            TokenUsage usage
    ) implements ModelProtocolEvent {

        public UsageReported {
            binding = requireEventBinding(binding);
            sequence = requireEventSequence(sequence);
            usage = ContractChecks.requireNonNull(usage, "usage");
        }
    }

    record AttemptEos(
            InvocationBinding binding,
            long sequence,
            StopReason stopReason
    ) implements ModelProtocolEvent {

        public AttemptEos {
            binding = requireEventBinding(binding);
            sequence = requireEventSequence(sequence);
            stopReason = ContractChecks.requireNonNull(stopReason, "stopReason");
        }
    }

    record AttemptFailed(
            InvocationBinding binding,
            long sequence,
            AdapterFailure failure
    ) implements ModelProtocolEvent {

        public AttemptFailed {
            binding = requireEventBinding(binding);
            sequence = requireEventSequence(sequence);
            failure = ContractChecks.requireNonNull(failure, "failure");
        }
    }

    record AttemptCancelled(
            InvocationBinding binding,
            long sequence
    ) implements ModelProtocolEvent {

        public AttemptCancelled {
            binding = requireEventBinding(binding);
            sequence = requireEventSequence(sequence);
        }
    }

    private static InvocationBinding requireEventBinding(InvocationBinding binding) {
        return ContractChecks.requireNonNull(binding, "binding");
    }

    private static long requireEventSequence(long sequence) {
        return ContractChecks.requireNonNegative(sequence, "sequence");
    }
}
