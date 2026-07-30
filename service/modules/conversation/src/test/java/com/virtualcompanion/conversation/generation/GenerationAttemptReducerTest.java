package com.virtualcompanion.conversation.generation;

import com.virtualcompanion.catalog.GenerationState;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GenerationAttemptReducerTest {

    @Test
    void eos_freezes_candidate_without_completing_generation() {
        var binding = binding("source-a", 7);
        var reducer = new GenerationAttemptReducer(
                binding,
                "candidate-a",
                GenerationState.IN_PROGRESS
        );

        reducer.accept(new ModelProtocolEvent.OutputDelta(
                binding,
                0,
                new ModelPayload.TextChunk("你")
        ));
        reducer.accept(new ModelProtocolEvent.OutputDelta(
                binding,
                1,
                new ModelPayload.TextChunk("好")
        ));
        reducer.accept(new ModelProtocolEvent.UsageReported(
                binding,
                2,
                new TokenUsage(2, 2, 4)
        ));
        var terminal = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                reducer.accept(new ModelProtocolEvent.AttemptEos(
                        binding,
                        3,
                        StopReason.STOP
                ))
        );

        assertEquals(AttemptOutcome.SUCCEEDED, terminal.termination().outcome());
        assertEquals("你好", assertInstanceOf(
                CandidateContent.Text.class,
                assertInstanceOf(
                        AttemptTermination.Succeeded.class,
                        terminal.termination()
                ).candidate().content()
        ).value());
        assertEquals(GenerationState.IN_PROGRESS, reducer.generationState());
    }

    @Test
    void wrong_binding_and_sequence_do_not_advance() {
        var expected = binding("source-a", 7);
        var reducer = new GenerationAttemptReducer(
                expected,
                "candidate-a",
                GenerationState.IN_PROGRESS
        );

        var wrongBinding = assertInstanceOf(
                AttemptEventResult.Discarded.class,
                reducer.accept(new ModelProtocolEvent.OutputDelta(
                        binding("source-b", 7),
                        0,
                        new ModelPayload.TextChunk("wrong")
                ))
        );
        var wrongSequence = assertInstanceOf(
                AttemptEventResult.Discarded.class,
                reducer.accept(new ModelProtocolEvent.OutputDelta(
                        expected,
                        1,
                        new ModelPayload.TextChunk("gap")
                ))
        );

        assertEquals(
                AttemptEventResult.DiscardReason.BINDING_MISMATCH,
                wrongBinding.reason()
        );
        assertEquals(
                AttemptEventResult.DiscardReason.SEQUENCE_MISMATCH,
                wrongSequence.reason()
        );
        assertEquals(0, reducer.expectedSequence());
        assertTrue(reducer.candidate().isEmpty());
    }

    @Test
    void mixed_payload_fails_closed() {
        var binding = binding("source-a", 7);
        var reducer = new GenerationAttemptReducer(
                binding,
                "candidate-a",
                GenerationState.IN_PROGRESS
        );

        reducer.accept(new ModelProtocolEvent.OutputDelta(
                binding,
                0,
                new ModelPayload.TextChunk("partial")
        ));
        var result = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                reducer.accept(new ModelProtocolEvent.OutputDelta(
                        binding,
                        1,
                        new ModelPayload.StructuredJson("{\"answer\":\"mixed\"}")
                ))
        );

        assertEquals(AttemptOutcome.INVALID_STREAM, result.termination().outcome());
        assertTrue(reducer.candidate().isEmpty());
    }

    @Test
    void duplicate_usage_fails_closed() {
        var binding = binding("source-a", 7);
        var reducer = new GenerationAttemptReducer(
                binding,
                "candidate-a",
                GenerationState.IN_PROGRESS
        );
        var usage = new TokenUsage(1, 1, 2);

        reducer.accept(new ModelProtocolEvent.UsageReported(binding, 0, usage));
        var result = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                reducer.accept(new ModelProtocolEvent.UsageReported(binding, 1, usage))
        );

        assertEquals(AttemptOutcome.INVALID_STREAM, result.termination().outcome());
    }

    @Test
    void failed_attempt_clears_partial_and_rejects_later_eos() {
        var binding = binding("source-a", 7);
        var reducer = new GenerationAttemptReducer(
                binding,
                "candidate-a",
                GenerationState.IN_PROGRESS
        );

        reducer.accept(new ModelProtocolEvent.OutputDelta(
                binding,
                0,
                new ModelPayload.TextChunk("must-not-survive")
        ));
        var failed = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                reducer.accept(new ModelProtocolEvent.AttemptFailed(
                        binding,
                        1,
                        new AdapterFailure.Disconnected()
                ))
        );
        var lateEos = assertInstanceOf(
                AttemptEventResult.Discarded.class,
                reducer.accept(new ModelProtocolEvent.AttemptEos(
                        binding,
                        2,
                        StopReason.STOP
                ))
        );

        assertEquals(AttemptOutcome.FAILED, failed.termination().outcome());
        assertTrue(reducer.candidate().isEmpty());
        assertEquals(
                AttemptEventResult.DiscardReason.ALREADY_TERMINAL,
                lateEos.reason()
        );
    }

    @Test
    void structured_content_is_frozen_as_one_value() {
        var binding = binding("source-a", 7);
        var reducer = new GenerationAttemptReducer(
                binding,
                "candidate-a",
                GenerationState.IN_PROGRESS
        );
        var json = "{\"answer\":\"今晚辛苦了\"}";

        reducer.accept(new ModelProtocolEvent.OutputDelta(
                binding,
                0,
                new ModelPayload.StructuredJson(json)
        ));
        reducer.accept(new ModelProtocolEvent.AttemptEos(
                binding,
                1,
                StopReason.STOP
        ));

        assertEquals(
                json,
                assertInstanceOf(
                        CandidateContent.StructuredJson.class,
                        reducer.candidate().orElseThrow().content()
                ).value()
        );
    }

    @Test
    void eos_without_content_fails_closed() {
        var binding = binding("source-a", 7);
        var reducer = new GenerationAttemptReducer(
                binding,
                "candidate-a",
                GenerationState.IN_PROGRESS
        );

        var result = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                reducer.accept(new ModelProtocolEvent.AttemptEos(
                        binding,
                        0,
                        StopReason.STOP
                ))
        );

        assertEquals(AttemptOutcome.INVALID_STREAM, result.termination().outcome());
    }

    @Test
    void constructor_rejects_every_terminal_generation_state() {
        for (var state : List.of(
                GenerationState.INPUT_BLOCKED,
                GenerationState.COMPLETED,
                GenerationState.COMPLETED_FALLBACK,
                GenerationState.CANCELLED,
                GenerationState.OUTPUT_BLOCKED,
                GenerationState.FAILED_FINAL
        )) {
            assertThrows(
                    IllegalArgumentException.class,
                    () -> new GenerationAttemptReducer(
                            binding("source-a", 1),
                            "candidate-a",
                            state
                    ),
                    state::name
            );
        }
    }

    @Test
    void constructor_preserves_every_non_terminal_generation_state() {
        for (var state : List.of(
                GenerationState.CREATED,
                GenerationState.INPUT_REVIEW,
                GenerationState.QUEUED,
                GenerationState.IN_PROGRESS,
                GenerationState.WAITING_FOR_CAPACITY,
                GenerationState.FINAL_REVIEW,
                GenerationState.COMMITTING,
                GenerationState.CANCEL_REQUESTED
        )) {
            var reducer = new GenerationAttemptReducer(
                    binding("source-a", 1),
                    "candidate-a",
                    state
            );

            assertEquals(state, reducer.generationState(), state::name);
        }
    }

    @Test
    void candidate_string_representation_omits_content_and_binding_identifiers() {
        var binding = binding("sensitive-source", 7);
        var reducer = new GenerationAttemptReducer(
                binding,
                "candidate-a",
                GenerationState.IN_PROGRESS
        );
        reducer.accept(new ModelProtocolEvent.OutputDelta(
                binding,
                0,
                new ModelPayload.TextChunk("sensitive-content")
        ));
        reducer.accept(new ModelProtocolEvent.AttemptEos(
                binding,
                1,
                StopReason.STOP
        ));

        var representation = reducer.candidate().orElseThrow().toString();

        assertFalse(representation.contains("sensitive-content"));
        assertFalse(representation.contains("sensitive-source"));
    }

    private static InvocationBinding.DeterministicSourceBinding binding(
            String sourceId,
            long fence
    ) {
        return new InvocationBinding.DeterministicSourceBinding(
                new OwnershipTuple(
                        "owner-1",
                        "relationship-1",
                        "conversation-1",
                        "generation-1"
                ),
                sourceId,
                fence
        );
    }
}
