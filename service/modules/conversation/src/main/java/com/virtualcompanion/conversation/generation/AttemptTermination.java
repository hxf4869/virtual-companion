package com.virtualcompanion.conversation.generation;

import com.virtualcompanion.modelruntime.contract.AdapterFailure;

/**
 * Exact terminal result of one attempt reducer.
 */
public sealed interface AttemptTermination
        permits AttemptTermination.Succeeded,
        AttemptTermination.Failed,
        AttemptTermination.Cancelled,
        AttemptTermination.InvalidStream {

    AttemptOutcome outcome();

    record Succeeded(FrozenGenerationCandidate candidate) implements AttemptTermination {

        public Succeeded {
            candidate = ConversationChecks.requireNonNull(candidate, "candidate");
        }

        @Override
        public AttemptOutcome outcome() {
            return AttemptOutcome.SUCCEEDED;
        }
    }

    record Failed(AdapterFailure failure) implements AttemptTermination {

        public Failed {
            failure = ConversationChecks.requireNonNull(failure, "failure");
        }

        @Override
        public AttemptOutcome outcome() {
            return AttemptOutcome.FAILED;
        }
    }

    record Cancelled() implements AttemptTermination {

        @Override
        public AttemptOutcome outcome() {
            return AttemptOutcome.CANCELLED;
        }
    }

    record InvalidStream(Reason reason) implements AttemptTermination {

        public InvalidStream {
            reason = ConversationChecks.requireNonNull(reason, "reason");
        }

        @Override
        public AttemptOutcome outcome() {
            return AttemptOutcome.INVALID_STREAM;
        }
    }

    enum Reason {
        MIXED_PAYLOAD_TYPES,
        MULTIPLE_STRUCTURED_PAYLOADS,
        DUPLICATE_USAGE,
        EOS_WITHOUT_CONTENT,
        SEQUENCE_EXHAUSTED
    }
}
