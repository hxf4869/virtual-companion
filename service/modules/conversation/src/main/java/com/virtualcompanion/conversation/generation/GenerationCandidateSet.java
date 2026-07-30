package com.virtualcompanion.conversation.generation;

import com.virtualcompanion.modelruntime.contract.OwnershipTuple;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * In-memory candidate registry for exactly one complete ownership tuple.
 *
 * <p>Registration never selects a candidate. Selection is explicit, stable,
 * idempotent for the same ID and fail-closed for a different second ID.</p>
 */
public final class GenerationCandidateSet {

    private final OwnershipTuple ownership;
    private final Map<String, FrozenGenerationCandidate> candidates = new LinkedHashMap<>();
    private String selectedCandidateId;

    public GenerationCandidateSet(OwnershipTuple ownership) {
        this.ownership = ConversationChecks.requireNonNull(ownership, "ownership");
    }

    public CandidateRegistrationResult register(FrozenGenerationCandidate candidate) {
        ConversationChecks.requireNonNull(candidate, "candidate");
        if (!ownership.equals(candidate.sourceBinding().ownership())) {
            return CandidateRegistrationResult.OWNERSHIP_MISMATCH;
        }
        if (candidates.containsKey(candidate.candidateId())) {
            return CandidateRegistrationResult.DUPLICATE_ID;
        }
        candidates.put(candidate.candidateId(), candidate);
        return CandidateRegistrationResult.REGISTERED;
    }

    public CandidateSelectionResult select(String candidateId) {
        if (candidateId == null || candidateId.isBlank() || !candidates.containsKey(candidateId)) {
            return CandidateSelectionResult.CANDIDATE_NOT_FOUND;
        }
        if (selectedCandidateId == null) {
            selectedCandidateId = candidateId;
            return CandidateSelectionResult.SELECTED;
        }
        if (selectedCandidateId.equals(candidateId)) {
            return CandidateSelectionResult.ALREADY_SELECTED;
        }
        return CandidateSelectionResult.DIFFERENT_CANDIDATE_ALREADY_SELECTED;
    }

    public OwnershipTuple ownership() {
        return ownership;
    }

    public List<FrozenGenerationCandidate> candidates() {
        return List.copyOf(candidates.values());
    }

    public Optional<FrozenGenerationCandidate> candidate(String candidateId) {
        if (candidateId == null || candidateId.isBlank()) {
            return Optional.empty();
        }
        return Optional.ofNullable(candidates.get(candidateId));
    }

    public Optional<String> selectedCandidateId() {
        return Optional.ofNullable(selectedCandidateId);
    }

    public Optional<FrozenGenerationCandidate> selectedCandidate() {
        return Optional.ofNullable(selectedCandidateId).map(candidates::get);
    }

    public enum CandidateRegistrationResult {
        REGISTERED,
        OWNERSHIP_MISMATCH,
        DUPLICATE_ID
    }

    public enum CandidateSelectionResult {
        SELECTED,
        ALREADY_SELECTED,
        CANDIDATE_NOT_FOUND,
        DIFFERENT_CANDIDATE_ALREADY_SELECTED
    }
}
