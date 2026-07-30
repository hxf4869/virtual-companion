package com.virtualcompanion.conversation.generation;

import com.virtualcompanion.catalog.GenerationState;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.StopReason;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class GenerationCandidateSetTest {

    @Test
    void selection_is_explicit_idempotent_and_single_winner() {
        var ownership = ownership("generation-1");
        var candidates = new GenerationCandidateSet(ownership);
        var first = candidate(ownership, "source-a", "candidate-a", "A");
        var second = candidate(ownership, "source-b", "candidate-b", "B");

        assertEquals(
                GenerationCandidateSet.CandidateRegistrationResult.REGISTERED,
                candidates.register(first)
        );
        assertEquals(
                GenerationCandidateSet.CandidateRegistrationResult.REGISTERED,
                candidates.register(second)
        );
        assertEquals(
                GenerationCandidateSet.CandidateSelectionResult.SELECTED,
                candidates.select("candidate-a")
        );
        assertEquals(
                GenerationCandidateSet.CandidateSelectionResult.ALREADY_SELECTED,
                candidates.select("candidate-a")
        );
        assertEquals(
                GenerationCandidateSet.CandidateSelectionResult
                        .DIFFERENT_CANDIDATE_ALREADY_SELECTED,
                candidates.select("candidate-b")
        );
        assertEquals("candidate-a", candidates.selectedCandidate().orElseThrow().candidateId());
    }

    @Test
    void complete_ownership_mismatch_is_rejected() {
        var candidates = new GenerationCandidateSet(ownership("generation-1"));
        var other = candidate(
                new OwnershipTuple(
                        "owner-2",
                        "relationship-1",
                        "conversation-1",
                        "generation-1"
                ),
                "source-b",
                "candidate-b",
                "B"
        );

        assertEquals(
                GenerationCandidateSet.CandidateRegistrationResult.OWNERSHIP_MISMATCH,
                candidates.register(other)
        );
    }

    @Test
    void duplicate_candidate_id_never_overwrites() {
        var ownership = ownership("generation-1");
        var candidates = new GenerationCandidateSet(ownership);
        var first = candidate(ownership, "source-a", "candidate-a", "A");
        var duplicate = candidate(ownership, "source-b", "candidate-a", "B");

        assertEquals(
                GenerationCandidateSet.CandidateRegistrationResult.REGISTERED,
                candidates.register(first)
        );
        assertEquals(
                GenerationCandidateSet.CandidateRegistrationResult.DUPLICATE_ID,
                candidates.register(duplicate)
        );
        assertEquals(
                new CandidateContent.Text("A"),
                candidates.candidate("candidate-a").orElseThrow().content()
        );
    }

    private static FrozenGenerationCandidate candidate(
            OwnershipTuple ownership,
            String sourceId,
            String candidateId,
            String text
    ) {
        var binding = new InvocationBinding.DeterministicSourceBinding(
                ownership,
                sourceId,
                1
        );
        var reducer = new GenerationAttemptReducer(
                binding,
                candidateId,
                GenerationState.IN_PROGRESS
        );
        reducer.accept(new ModelProtocolEvent.OutputDelta(
                binding,
                0,
                new ModelPayload.TextChunk(text)
        ));
        reducer.accept(new ModelProtocolEvent.AttemptEos(
                binding,
                1,
                StopReason.STOP
        ));
        return reducer.candidate().orElseThrow();
    }

    private static OwnershipTuple ownership(String generationId) {
        return new OwnershipTuple(
                "owner-1",
                "relationship-1",
                "conversation-1",
                generationId
        );
    }
}
