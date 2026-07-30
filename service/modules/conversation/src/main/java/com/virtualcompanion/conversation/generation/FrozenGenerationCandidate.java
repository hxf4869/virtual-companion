package com.virtualcompanion.conversation.generation;

import com.virtualcompanion.catalog.GenerationState;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TokenUsage;

import java.util.Objects;
import java.util.Optional;

/**
 * Immutable output frozen by one successful attempt EOS.
 *
 * <p>This is not a final assistant message and does not imply that the
 * generation has completed or passed final review. The private
 * constructor prevents callers from promoting arbitrary partial output into a
 * candidate.</p>
 */
public final class FrozenGenerationCandidate {

    private final String candidateId;
    private final InvocationBinding sourceBinding;
    private final GenerationState generationState;
    private final CandidateContent content;
    private final Optional<TokenUsage> usage;
    private final StopReason stopReason;
    private final String contentSha256;

    private FrozenGenerationCandidate(
            String candidateId,
            InvocationBinding sourceBinding,
            GenerationState generationState,
            CandidateContent content,
            Optional<TokenUsage> usage,
            StopReason stopReason
    ) {
        this.candidateId = ConversationChecks.requireNonBlank(candidateId, "candidateId");
        this.sourceBinding = ConversationChecks.requireNonNull(sourceBinding, "sourceBinding");
        this.generationState = GenerationStateRules.requireNonTerminal(generationState);
        this.content = ConversationChecks.requireNonNull(content, "content");
        this.usage = ConversationChecks.requireNonNull(usage, "usage");
        this.stopReason = ConversationChecks.requireNonNull(stopReason, "stopReason");
        this.contentSha256 = CandidateContentAddress.sha256(content);
    }

    static FrozenGenerationCandidate freeze(
            String candidateId,
            InvocationBinding sourceBinding,
            GenerationState generationState,
            CandidateContent content,
            Optional<TokenUsage> usage,
            StopReason stopReason
    ) {
        return new FrozenGenerationCandidate(
                candidateId,
                sourceBinding,
                generationState,
                content,
                usage,
                stopReason
        );
    }

    public String candidateId() {
        return candidateId;
    }

    public InvocationBinding sourceBinding() {
        return sourceBinding;
    }

    public InvocationBinding binding() {
        return sourceBinding;
    }

    public GenerationState generationState() {
        return generationState;
    }

    public CandidateContent content() {
        return content;
    }

    public Optional<TokenUsage> usage() {
        return usage;
    }

    public StopReason stopReason() {
        return stopReason;
    }

    public String contentSha256() {
        return contentSha256;
    }

    public String contentAddress() {
        return contentSha256;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof FrozenGenerationCandidate candidate)) {
            return false;
        }
        return candidateId.equals(candidate.candidateId)
                && sourceBinding.equals(candidate.sourceBinding)
                && generationState == candidate.generationState
                && content.equals(candidate.content)
                && usage.equals(candidate.usage)
                && stopReason == candidate.stopReason
                && contentSha256.equals(candidate.contentSha256);
    }

    @Override
    public int hashCode() {
        return Objects.hash(
                candidateId,
                sourceBinding,
                generationState,
                content,
                usage,
                stopReason,
                contentSha256
        );
    }

    @Override
    public String toString() {
        return "FrozenGenerationCandidate["
                + "candidateId=" + candidateId
                + ", generationState=" + generationState
                + ", contentType=" + content.type()
                + ", stopReason=" + stopReason
                + ", contentSha256=" + contentSha256
                + ']';
    }
}
