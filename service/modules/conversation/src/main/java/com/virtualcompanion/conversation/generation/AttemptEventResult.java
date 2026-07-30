package com.virtualcompanion.conversation.generation;

import java.util.Optional;

/**
 * Explicit result of offering one normalized protocol event to a reducer.
 */
public sealed interface AttemptEventResult
        permits AttemptEventResult.Accepted,
        AttemptEventResult.Discarded,
        AttemptEventResult.Terminated {

    record Accepted(long acceptedSequence, long nextExpectedSequence)
            implements AttemptEventResult {

        public Accepted {
            ConversationChecks.requireNonNegative(acceptedSequence, "acceptedSequence");
            ConversationChecks.requireNonNegative(nextExpectedSequence, "nextExpectedSequence");
        }
    }

    record Discarded(
            DiscardReason reason,
            long discardedSequence,
            long expectedSequence
    ) implements AttemptEventResult {

        public Discarded {
            reason = ConversationChecks.requireNonNull(reason, "reason");
            ConversationChecks.requireNonNegative(discardedSequence, "discardedSequence");
            ConversationChecks.requireNonNegative(expectedSequence, "expectedSequence");
        }
    }

    record Terminated(
            long terminalSequence,
            long nextExpectedSequence,
            AttemptTermination termination
    ) implements AttemptEventResult {

        public Terminated {
            ConversationChecks.requireNonNegative(terminalSequence, "terminalSequence");
            ConversationChecks.requireNonNegative(nextExpectedSequence, "nextExpectedSequence");
            termination = ConversationChecks.requireNonNull(termination, "termination");
        }

        public AttemptOutcome outcome() {
            return termination.outcome();
        }

        public Optional<FrozenGenerationCandidate> candidate() {
            if (termination instanceof AttemptTermination.Succeeded succeeded) {
                return Optional.of(succeeded.candidate());
            }
            return Optional.empty();
        }
    }

    enum DiscardReason {
        BINDING_MISMATCH,
        SEQUENCE_MISMATCH,
        ALREADY_TERMINAL
    }
}
