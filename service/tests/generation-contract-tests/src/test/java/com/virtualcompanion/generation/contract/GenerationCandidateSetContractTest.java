package com.virtualcompanion.generation.contract;

import com.virtualcompanion.conversation.generation.GenerationCandidateSet;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import org.junit.jupiter.api.Test;

import java.util.List;

import static com.virtualcompanion.generation.contract.GenerationContractTestSupport.deterministicBinding;
import static com.virtualcompanion.generation.contract.GenerationContractTestSupport.ownership;
import static com.virtualcompanion.generation.contract.GenerationContractTestSupport.textCandidate;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GenerationCandidateSetContractTest {

    @Test
    void registration_never_selects_and_only_one_explicit_winner_is_allowed() {
        var candidateSet = new GenerationCandidateSet(ownership());
        var first = textCandidate(
                deterministicBinding("source-a", 1),
                "candidate-a",
                "candidate A"
        );
        var second = textCandidate(
                deterministicBinding("source-b", 2),
                "candidate-b",
                "candidate B"
        );

        assertEquals(
                GenerationCandidateSet.CandidateRegistrationResult.REGISTERED,
                candidateSet.register(first)
        );
        assertEquals(
                GenerationCandidateSet.CandidateRegistrationResult.REGISTERED,
                candidateSet.register(second)
        );
        assertTrue(candidateSet.selectedCandidate().isEmpty());
        assertEquals(List.of(first, second), candidateSet.candidates());

        assertEquals(
                GenerationCandidateSet.CandidateSelectionResult.CANDIDATE_NOT_FOUND,
                candidateSet.select("candidate-unknown")
        );
        assertTrue(candidateSet.selectedCandidate().isEmpty());
        assertEquals(
                GenerationCandidateSet.CandidateSelectionResult.SELECTED,
                candidateSet.select("candidate-a")
        );
        assertEquals(
                GenerationCandidateSet.CandidateSelectionResult.ALREADY_SELECTED,
                candidateSet.select("candidate-a")
        );
        assertEquals(
                GenerationCandidateSet.CandidateSelectionResult
                        .DIFFERENT_CANDIDATE_ALREADY_SELECTED,
                candidateSet.select("candidate-b")
        );
        assertEquals(first, candidateSet.selectedCandidate().orElseThrow());
    }

    @Test
    void duplicate_candidate_id_is_rejected_without_replacement() {
        var candidateSet = new GenerationCandidateSet(ownership());
        var original = textCandidate(
                deterministicBinding("source-a", 1),
                "candidate-shared",
                "original"
        );
        var replacement = textCandidate(
                deterministicBinding("source-b", 2),
                "candidate-shared",
                "replacement"
        );

        assertEquals(
                GenerationCandidateSet.CandidateRegistrationResult.REGISTERED,
                candidateSet.register(original)
        );
        assertEquals(
                GenerationCandidateSet.CandidateRegistrationResult.DUPLICATE_ID,
                candidateSet.register(replacement)
        );
        assertEquals(List.of(original), candidateSet.candidates());
        assertEquals(
                original,
                candidateSet.candidate("candidate-shared").orElseThrow()
        );
        assertTrue(candidateSet.selectedCandidate().isEmpty());
    }

    @Test
    void every_ownership_mismatch_is_rejected_without_registration() {
        var expected = ownership();
        var candidateSet = new GenerationCandidateSet(expected);
        var mismatches = List.of(
                ownership("owner-2", "relationship-1", "conversation-1", "generation-1"),
                ownership("owner-1", "relationship-2", "conversation-1", "generation-1"),
                ownership("owner-1", "relationship-1", "conversation-2", "generation-1"),
                ownership("owner-1", "relationship-1", "conversation-1", "generation-2")
        );

        for (int index = 0; index < mismatches.size(); index++) {
            var mismatch = mismatches.get(index);
            var candidate = textCandidate(
                    deterministicBinding(
                            mismatch,
                            "mismatch-source-" + index,
                            index
                    ),
                    "mismatch-candidate-" + index,
                    "must not register"
            );
            assertEquals(
                    GenerationCandidateSet.CandidateRegistrationResult.OWNERSHIP_MISMATCH,
                    candidateSet.register(candidate)
            );
            assertTrue(candidateSet.candidates().isEmpty());
            assertTrue(candidateSet.selectedCandidate().isEmpty());
        }
    }

    @Test
    void candidate_sets_and_ids_remain_isolated_by_generation() {
        var firstOwnership = ownership(
                "owner-1",
                "relationship-1",
                "conversation-1",
                "generation-1"
        );
        var secondOwnership = ownership(
                "owner-1",
                "relationship-1",
                "conversation-1",
                "generation-2"
        );
        var firstSet = new GenerationCandidateSet(firstOwnership);
        var secondSet = new GenerationCandidateSet(secondOwnership);
        var first = textCandidate(
                deterministicBinding(firstOwnership, "source-a", 1),
                "candidate-a",
                "first generation"
        );
        var second = textCandidate(
                deterministicBinding(secondOwnership, "source-b", 1),
                "candidate-a",
                "second generation"
        );

        assertEquals(
                GenerationCandidateSet.CandidateRegistrationResult.REGISTERED,
                firstSet.register(first)
        );
        assertEquals(
                GenerationCandidateSet.CandidateRegistrationResult.REGISTERED,
                secondSet.register(second)
        );
        assertEquals("generation-1", first.binding().ownership().generationId());
        assertEquals("generation-2", second.binding().ownership().generationId());
        assertEquals("first generation", first.content().value());
        assertEquals("second generation", second.content().value());
        assertEquals(
                GenerationCandidateSet.CandidateRegistrationResult.OWNERSHIP_MISMATCH,
                firstSet.register(second)
        );
        assertEquals(List.of(first), firstSet.candidates());
        assertEquals(List.of(second), secondSet.candidates());
    }
}
