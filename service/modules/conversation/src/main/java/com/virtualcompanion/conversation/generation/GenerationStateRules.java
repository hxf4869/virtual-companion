package com.virtualcompanion.conversation.generation;

import com.virtualcompanion.catalog.GenerationState;

final class GenerationStateRules {

    private GenerationStateRules() {
    }

    static GenerationState requireNonTerminal(GenerationState state) {
        ConversationChecks.requireNonNull(state, "generationState");
        if (isTerminal(state)) {
            throw new IllegalArgumentException(
                    "generationState must be non-terminal: " + state.code()
            );
        }
        return state;
    }

    private static boolean isTerminal(GenerationState state) {
        return switch (state) {
            case INPUT_BLOCKED,
                    COMPLETED,
                    COMPLETED_FALLBACK,
                    CANCELLED,
                    OUTPUT_BLOCKED,
                    FAILED_FINAL -> true;
            case CREATED,
                    INPUT_REVIEW,
                    QUEUED,
                    IN_PROGRESS,
                    WAITING_FOR_CAPACITY,
                    FINAL_REVIEW,
                    COMMITTING,
                    CANCEL_REQUESTED -> false;
        };
    }
}
