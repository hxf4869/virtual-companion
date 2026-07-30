package com.virtualcompanion.conversation.generation;

import com.virtualcompanion.catalog.GenerationState;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.TokenUsage;

import java.util.Optional;

/**
 * Single-threaded, deterministic reducer for exactly one immutable invocation binding.
 *
 * <p>The reducer performs no routing, retry, selection, I/O or generation state
 * transition. An EOS freezes one candidate while preserving the caller-supplied
 * non-terminal generation state.</p>
 */
public final class GenerationAttemptReducer {

    private final InvocationBinding binding;
    private final String candidateId;
    private final GenerationState generationState;

    private long expectedSequence;
    private StringBuilder text;
    private String structuredJson;
    private TokenUsage usage;
    private AttemptTermination termination;

    public GenerationAttemptReducer(
            InvocationBinding binding,
            String candidateId,
            GenerationState generationState
    ) {
        this.binding = ConversationChecks.requireNonNull(binding, "binding");
        this.candidateId = ConversationChecks.requireNonBlank(candidateId, "candidateId");
        this.generationState = GenerationStateRules.requireNonTerminal(generationState);
    }

    public AttemptEventResult accept(ModelProtocolEvent event) {
        ConversationChecks.requireNonNull(event, "event");

        if (termination != null) {
            return discarded(AttemptEventResult.DiscardReason.ALREADY_TERMINAL, event);
        }
        if (!binding.equals(event.binding())) {
            return discarded(AttemptEventResult.DiscardReason.BINDING_MISMATCH, event);
        }
        if (event.sequence() != expectedSequence) {
            return discarded(AttemptEventResult.DiscardReason.SEQUENCE_MISMATCH, event);
        }
        if (expectedSequence == Long.MAX_VALUE) {
            return terminate(
                    event.sequence(),
                    new AttemptTermination.InvalidStream(
                            AttemptTermination.Reason.SEQUENCE_EXHAUSTED
                    )
            );
        }

        var acceptedSequence = expectedSequence;
        expectedSequence++;

        if (event instanceof ModelProtocolEvent.OutputDelta outputDelta) {
            return acceptPayload(acceptedSequence, outputDelta.payload());
        }
        if (event instanceof ModelProtocolEvent.UsageReported usageReported) {
            return acceptUsage(acceptedSequence, usageReported.usage());
        }
        if (event instanceof ModelProtocolEvent.AttemptEos eos) {
            return acceptEos(acceptedSequence, eos);
        }
        if (event instanceof ModelProtocolEvent.AttemptFailed failed) {
            return terminate(
                    acceptedSequence,
                    new AttemptTermination.Failed(failed.failure())
            );
        }
        if (event instanceof ModelProtocolEvent.AttemptCancelled) {
            return terminate(acceptedSequence, new AttemptTermination.Cancelled());
        }
        throw new IllegalStateException(
                "unsupported sealed ModelProtocolEvent: " + event.getClass().getName()
        );
    }

    public InvocationBinding binding() {
        return binding;
    }

    public String candidateId() {
        return candidateId;
    }

    public GenerationState generationState() {
        return generationState;
    }

    public long expectedSequence() {
        return expectedSequence;
    }

    public AttemptOutcome outcome() {
        return termination == null ? AttemptOutcome.OPEN : termination.outcome();
    }

    public Optional<AttemptTermination> termination() {
        return Optional.ofNullable(termination);
    }

    public Optional<FrozenGenerationCandidate> candidate() {
        if (termination instanceof AttemptTermination.Succeeded succeeded) {
            return Optional.of(succeeded.candidate());
        }
        return Optional.empty();
    }

    private AttemptEventResult acceptPayload(
            long acceptedSequence,
            ModelPayload payload
    ) {
        if (payload instanceof ModelPayload.TextChunk textChunk) {
            if (structuredJson != null) {
                return terminate(
                        acceptedSequence,
                        new AttemptTermination.InvalidStream(
                                AttemptTermination.Reason.MIXED_PAYLOAD_TYPES
                        )
                );
            }
            if (text == null) {
                text = new StringBuilder();
            }
            text.append(textChunk.text());
            return accepted(acceptedSequence);
        }

        var structured = (ModelPayload.StructuredJson) payload;
        if (text != null) {
            return terminate(
                    acceptedSequence,
                    new AttemptTermination.InvalidStream(
                            AttemptTermination.Reason.MIXED_PAYLOAD_TYPES
                    )
            );
        }
        if (structuredJson != null) {
            return terminate(
                    acceptedSequence,
                    new AttemptTermination.InvalidStream(
                            AttemptTermination.Reason.MULTIPLE_STRUCTURED_PAYLOADS
                    )
            );
        }
        structuredJson = structured.json();
        return accepted(acceptedSequence);
    }

    private AttemptEventResult acceptUsage(long acceptedSequence, TokenUsage reportedUsage) {
        if (usage != null) {
            return terminate(
                    acceptedSequence,
                    new AttemptTermination.InvalidStream(
                            AttemptTermination.Reason.DUPLICATE_USAGE
                    )
            );
        }
        usage = reportedUsage;
        return accepted(acceptedSequence);
    }

    private AttemptEventResult acceptEos(
            long acceptedSequence,
            ModelProtocolEvent.AttemptEos eos
    ) {
        CandidateContent content;
        if (text != null) {
            content = new CandidateContent.Text(text.toString());
        } else if (structuredJson != null) {
            content = new CandidateContent.StructuredJson(structuredJson);
        } else {
            return terminate(
                    acceptedSequence,
                    new AttemptTermination.InvalidStream(
                            AttemptTermination.Reason.EOS_WITHOUT_CONTENT
                    )
            );
        }

        var candidate = FrozenGenerationCandidate.freeze(
                candidateId,
                binding,
                generationState,
                content,
                Optional.ofNullable(usage),
                eos.stopReason()
        );
        return terminate(
                acceptedSequence,
                new AttemptTermination.Succeeded(candidate)
        );
    }

    private AttemptEventResult.Accepted accepted(long acceptedSequence) {
        return new AttemptEventResult.Accepted(acceptedSequence, expectedSequence);
    }

    private AttemptEventResult.Discarded discarded(
            AttemptEventResult.DiscardReason reason,
            ModelProtocolEvent event
    ) {
        return new AttemptEventResult.Discarded(
                reason,
                event.sequence(),
                expectedSequence
        );
    }

    private AttemptEventResult.Terminated terminate(
            long terminalSequence,
            AttemptTermination terminalResult
    ) {
        if (!(terminalResult instanceof AttemptTermination.Succeeded)) {
            if (text != null) {
                text.setLength(0);
                text = null;
            }
            structuredJson = null;
            usage = null;
        }
        termination = terminalResult;
        return new AttemptEventResult.Terminated(
                terminalSequence,
                expectedSequence,
                terminalResult
        );
    }
}
