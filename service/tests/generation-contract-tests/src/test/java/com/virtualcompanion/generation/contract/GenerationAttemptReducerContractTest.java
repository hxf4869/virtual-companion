package com.virtualcompanion.generation.contract;

import com.virtualcompanion.catalog.GenerationState;
import com.virtualcompanion.conversation.generation.AttemptEventResult;
import com.virtualcompanion.conversation.generation.AttemptOutcome;
import com.virtualcompanion.conversation.generation.AttemptTermination;
import com.virtualcompanion.conversation.generation.CandidateContent;
import com.virtualcompanion.conversation.generation.GenerationAttemptReducer;
import com.virtualcompanion.modelfailure.FailureModelProtocolAdapter;
import com.virtualcompanion.modelfailure.FailureScenario;
import com.virtualcompanion.modelfailure.FailureScript;
import com.virtualcompanion.modelfake.FakeModelProtocolAdapter;
import com.virtualcompanion.modelfake.FakeResponseScript;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import org.junit.jupiter.api.Test;

import java.util.List;

import static com.virtualcompanion.generation.contract.GenerationContractTestSupport.deterministicBinding;
import static com.virtualcompanion.generation.contract.GenerationContractTestSupport.events;
import static com.virtualcompanion.generation.contract.GenerationContractTestSupport.ownership;
import static com.virtualcompanion.generation.contract.GenerationContractTestSupport.reduce;
import static com.virtualcompanion.generation.contract.GenerationContractTestSupport.structuredRequest;
import static com.virtualcompanion.generation.contract.GenerationContractTestSupport.textRequest;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GenerationAttemptReducerContractTest {

    private static final TokenUsage USAGE = new TokenUsage(8, 5, 13);

    @Test
    void fake_non_stream_and_stream_freeze_the_same_candidate() {
        var binding = deterministicBinding("fake-source", 7);
        var adapter = new FakeModelProtocolAdapter(FakeResponseScript.text(
                List.of("你好", "🙂", "e\u0301"),
                USAGE,
                StopReason.LENGTH
        ));

        var nonStreaming = reduceFake(
                adapter,
                binding,
                "candidate-stable",
                false
        );
        var streaming = reduceFake(
                adapter,
                binding,
                "candidate-stable",
                true
        );

        assertEquals(nonStreaming, streaming);
        assertEquals(binding, streaming.binding());
        assertEquals(
                "generation-1",
                streaming.binding().ownership().generationId()
        );
        assertEquals(GenerationState.IN_PROGRESS, streaming.generationState());
        assertEquals(
                "你好🙂e\u0301",
                assertInstanceOf(CandidateContent.Text.class, streaming.content()).value()
        );
        assertEquals(USAGE, streaming.usage().orElseThrow());
        assertEquals(StopReason.LENGTH, streaming.stopReason());
        assertEquals(64, streaming.contentSha256().length());
    }

    @Test
    void structured_fake_freezes_one_structured_candidate() {
        var binding = deterministicBinding("structured-source", 3);
        var json = "{\"answer\":\"今晚辛苦了🙂\"}";
        var adapter = new FakeModelProtocolAdapter(FakeResponseScript.structured(
                List.of("unused"),
                USAGE,
                StopReason.STOP,
                json
        ));
        var reducer = reducer(binding, "candidate-structured");

        var results = reduce(
                reducer,
                events(adapter, structuredRequest(binding))
        );

        var terminal = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                results.getLast()
        );
        assertEquals(AttemptOutcome.SUCCEEDED, terminal.outcome());
        assertEquals(
                json,
                assertInstanceOf(
                        CandidateContent.StructuredJson.class,
                        terminal.candidate().orElseThrow().content()
                ).value()
        );
        assertEquals(GenerationState.IN_PROGRESS, reducer.generationState());
    }

    @Test
    void failure_prefix_is_erased_and_never_stitched_into_a_later_candidate() {
        var failedBinding = deterministicBinding("failure-source", 4);
        var failedReducer = reducer(failedBinding, "candidate-failed");
        var failureAdapter = new FailureModelProtocolAdapter(
                FailureScript.withTextPrefix(
                        FailureScenario.DISCONNECT,
                        List.of("must-", "not-leak")
                )
        );

        var failureResults = reduce(
                failedReducer,
                events(failureAdapter, textRequest(failedBinding, true))
        );

        var failureTerminal = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                failureResults.getLast()
        );
        assertEquals(AttemptOutcome.FAILED, failureTerminal.outcome());
        assertTrue(failureTerminal.candidate().isEmpty());
        assertTrue(failedReducer.candidate().isEmpty());
        var failedTermination = assertInstanceOf(
                AttemptTermination.Failed.class,
                failedReducer.termination().orElseThrow()
        );
        assertInstanceOf(AdapterFailure.Disconnected.class, failedTermination.failure());
        var eosAfterFailure = assertInstanceOf(
                AttemptEventResult.Discarded.class,
                failedReducer.accept(new ModelProtocolEvent.AttemptEos(
                        failedBinding,
                        3,
                        StopReason.STOP
                ))
        );
        assertEquals(
                AttemptEventResult.DiscardReason.ALREADY_TERMINAL,
                eosAfterFailure.reason()
        );
        assertTrue(failedReducer.candidate().isEmpty());

        var successfulBinding = deterministicBinding("success-source", 5);
        var successfulReducer = reducer(
                successfulBinding,
                "candidate-success"
        );
        var successAdapter = new FakeModelProtocolAdapter(FakeResponseScript.text(
                List.of("clean-", "candidate"),
                USAGE,
                StopReason.STOP
        ));
        reduce(
                successfulReducer,
                events(successAdapter, textRequest(successfulBinding, true))
        );

        var content = assertInstanceOf(
                CandidateContent.Text.class,
                successfulReducer.candidate().orElseThrow().content()
        ).value();
        assertEquals("clean-candidate", content);
        assertFalse(content.contains("must-not-leak"));
    }

    @Test
    void cancellation_and_cancellation_failure_never_create_candidates() {
        var cancelledBinding = deterministicBinding("cancel-source", 1);
        var cancelledReducer = reducer(
                cancelledBinding,
                "candidate-cancelled"
        );
        var cancelledResult = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                cancelledReducer.accept(new ModelProtocolEvent.AttemptCancelled(
                        cancelledBinding,
                        0
                ))
        );

        assertEquals(AttemptOutcome.CANCELLED, cancelledResult.outcome());
        assertTrue(cancelledReducer.candidate().isEmpty());

        var failedBinding = deterministicBinding("cancel-failure-source", 2);
        var failedReducer = reducer(
                failedBinding,
                "candidate-cancel-failed"
        );
        var session = new FailureModelProtocolAdapter(
                FailureScenario.CANCELLATION_FAILED
        ).open(textRequest(failedBinding, true));
        assertTrue(session.next().isEmpty());
        session.cancel();
        session.cancel();
        var event = session.next().orElseThrow();
        var failedResult = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                failedReducer.accept(event)
        );

        assertEquals(AttemptOutcome.FAILED, failedResult.outcome());
        assertInstanceOf(
                AdapterFailure.CancellationFailed.class,
                assertInstanceOf(
                        AttemptTermination.Failed.class,
                        failedReducer.termination().orElseThrow()
                ).failure()
        );
        assertTrue(failedReducer.candidate().isEmpty());
        assertTrue(session.next().isEmpty());
    }

    @Test
    void late_fenced_delta_and_its_sequence_do_not_mutate_the_reducer() {
        var expected = deterministicBinding("late-source", 7);
        var reducer = reducer(expected, "candidate-late");
        var lateEvents = events(
                new FailureModelProtocolAdapter(FailureScenario.LATE_DELTA),
                textRequest(expected, true)
        );

        var lateDelta = assertInstanceOf(
                AttemptEventResult.Discarded.class,
                reducer.accept(lateEvents.get(0))
        );
        var followingTerminal = assertInstanceOf(
                AttemptEventResult.Discarded.class,
                reducer.accept(lateEvents.get(1))
        );

        assertEquals(
                AttemptEventResult.DiscardReason.BINDING_MISMATCH,
                lateDelta.reason()
        );
        assertEquals(
                AttemptEventResult.DiscardReason.SEQUENCE_MISMATCH,
                followingTerminal.reason()
        );
        assertEquals(0, reducer.expectedSequence());
        assertEquals(AttemptOutcome.OPEN, reducer.outcome());
        assertTrue(reducer.candidate().isEmpty());
        assertTrue(reducer.termination().isEmpty());
    }

    @Test
    void every_external_binding_field_is_fenced_without_side_effects() {
        var expected = externalBinding(
                ownership(),
                "attempt-1",
                7,
                "requested-auth-1",
                "execution-auth-1"
        );
        var reducer = reducer(expected, "candidate-external");
        var mismatches = List.of(
                externalBinding(
                        ownership("owner-2", "relationship-1", "conversation-1", "generation-1"),
                        "attempt-1", 7, "requested-auth-1", "execution-auth-1"
                ),
                externalBinding(
                        ownership("owner-1", "relationship-2", "conversation-1", "generation-1"),
                        "attempt-1", 7, "requested-auth-1", "execution-auth-1"
                ),
                externalBinding(
                        ownership("owner-1", "relationship-1", "conversation-2", "generation-1"),
                        "attempt-1", 7, "requested-auth-1", "execution-auth-1"
                ),
                externalBinding(
                        ownership("owner-1", "relationship-1", "conversation-1", "generation-2"),
                        "attempt-1", 7, "requested-auth-1", "execution-auth-1"
                ),
                externalBinding(
                        ownership(), "attempt-2", 7,
                        "requested-auth-1", "execution-auth-1"
                ),
                externalBinding(
                        ownership(), "attempt-1", 8,
                        "requested-auth-1", "execution-auth-1"
                ),
                externalBinding(
                        ownership(), "attempt-1", 7,
                        "requested-auth-2", "execution-auth-1"
                ),
                externalBinding(
                        ownership(), "attempt-1", 7,
                        "requested-auth-1", "execution-auth-2"
                )
        );

        for (InvocationBinding mismatch : mismatches) {
            var result = assertInstanceOf(
                    AttemptEventResult.Discarded.class,
                    reducer.accept(new ModelProtocolEvent.OutputDelta(
                            mismatch,
                            0,
                            new ModelPayload.TextChunk("must-not-append")
                    ))
            );
            assertEquals(
                    AttemptEventResult.DiscardReason.BINDING_MISMATCH,
                    result.reason()
            );
            assertReducerOpenAndEmpty(reducer);
        }

        reducer.accept(new ModelProtocolEvent.OutputDelta(
                expected,
                0,
                new ModelPayload.TextChunk("accepted")
        ));
        reducer.accept(new ModelProtocolEvent.AttemptEos(
                expected,
                1,
                StopReason.STOP
        ));
        assertEquals(
                "accepted",
                assertInstanceOf(
                        CandidateContent.Text.class,
                        reducer.candidate().orElseThrow().content()
                ).value()
        );
    }

    @Test
    void gaps_duplicates_and_events_after_terminal_have_no_side_effects() {
        var binding = deterministicBinding("sequence-source", 9);
        var reducer = reducer(binding, "candidate-sequence");

        var gap = assertInstanceOf(
                AttemptEventResult.Discarded.class,
                reducer.accept(new ModelProtocolEvent.OutputDelta(
                        binding,
                        1,
                        new ModelPayload.TextChunk("gap")
                ))
        );
        assertEquals(AttemptEventResult.DiscardReason.SEQUENCE_MISMATCH, gap.reason());
        assertReducerOpenAndEmpty(reducer);

        reducer.accept(new ModelProtocolEvent.OutputDelta(
                binding,
                0,
                new ModelPayload.TextChunk("only")
        ));
        var duplicate = assertInstanceOf(
                AttemptEventResult.Discarded.class,
                reducer.accept(new ModelProtocolEvent.OutputDelta(
                        binding,
                        0,
                        new ModelPayload.TextChunk("duplicate")
                ))
        );
        assertEquals(
                AttemptEventResult.DiscardReason.SEQUENCE_MISMATCH,
                duplicate.reason()
        );
        assertEquals(1, reducer.expectedSequence());

        reducer.accept(new ModelProtocolEvent.AttemptEos(
                binding,
                1,
                StopReason.STOP
        ));
        var frozen = reducer.candidate().orElseThrow();
        var afterTerminal = assertInstanceOf(
                AttemptEventResult.Discarded.class,
                reducer.accept(new ModelProtocolEvent.OutputDelta(
                        binding,
                        2,
                        new ModelPayload.TextChunk("late")
                ))
        );

        assertEquals(
                AttemptEventResult.DiscardReason.ALREADY_TERMINAL,
                afterTerminal.reason()
        );
        assertEquals(2, reducer.expectedSequence());
        assertEquals(frozen, reducer.candidate().orElseThrow());
        assertEquals(
                "only",
                assertInstanceOf(CandidateContent.Text.class, frozen.content()).value()
        );
    }

    @Test
    void mixed_or_repeated_payload_and_usage_fail_closed() {
        var mixedBinding = deterministicBinding("mixed-source", 1);
        var mixedReducer = reducer(mixedBinding, "candidate-mixed");
        mixedReducer.accept(new ModelProtocolEvent.OutputDelta(
                mixedBinding,
                0,
                new ModelPayload.TextChunk("text")
        ));
        var mixed = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                mixedReducer.accept(new ModelProtocolEvent.OutputDelta(
                        mixedBinding,
                        1,
                        new ModelPayload.StructuredJson("{\"answer\":\"mixed\"}")
                ))
        );
        assertEquals(AttemptOutcome.INVALID_STREAM, mixed.outcome());
        assertTrue(mixedReducer.candidate().isEmpty());

        var duplicateStructuredBinding = deterministicBinding(
                "duplicate-structured-source",
                2
        );
        var duplicateStructuredReducer = reducer(
                duplicateStructuredBinding,
                "candidate-duplicate-structured"
        );
        duplicateStructuredReducer.accept(new ModelProtocolEvent.OutputDelta(
                duplicateStructuredBinding,
                0,
                new ModelPayload.StructuredJson("{\"answer\":1}")
        ));
        var duplicateStructured = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                duplicateStructuredReducer.accept(new ModelProtocolEvent.OutputDelta(
                        duplicateStructuredBinding,
                        1,
                        new ModelPayload.StructuredJson("{\"answer\":2}")
                ))
        );
        assertEquals(AttemptOutcome.INVALID_STREAM, duplicateStructured.outcome());
        assertTrue(duplicateStructuredReducer.candidate().isEmpty());

        var duplicateUsageBinding = deterministicBinding("duplicate-usage-source", 3);
        var duplicateUsageReducer = reducer(
                duplicateUsageBinding,
                "candidate-duplicate-usage"
        );
        duplicateUsageReducer.accept(new ModelProtocolEvent.OutputDelta(
                duplicateUsageBinding,
                0,
                new ModelPayload.TextChunk("text")
        ));
        duplicateUsageReducer.accept(new ModelProtocolEvent.UsageReported(
                duplicateUsageBinding,
                1,
                USAGE
        ));
        var duplicateUsage = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                duplicateUsageReducer.accept(new ModelProtocolEvent.UsageReported(
                        duplicateUsageBinding,
                        2,
                        USAGE
                ))
        );
        assertEquals(AttemptOutcome.INVALID_STREAM, duplicateUsage.outcome());
        assertTrue(duplicateUsageReducer.candidate().isEmpty());
    }

    @Test
    void eos_without_content_fails_closed_and_never_completes_generation() {
        var binding = deterministicBinding("empty-source", 1);
        var reducer = reducer(binding, "candidate-empty");

        var terminal = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                reducer.accept(new ModelProtocolEvent.AttemptEos(
                        binding,
                        0,
                        StopReason.STOP
                ))
        );

        assertEquals(AttemptOutcome.INVALID_STREAM, terminal.outcome());
        assertTrue(terminal.candidate().isEmpty());
        assertEquals(GenerationState.IN_PROGRESS, reducer.generationState());
    }

    private static com.virtualcompanion.conversation.generation.FrozenGenerationCandidate
            reduceFake(
                    FakeModelProtocolAdapter adapter,
                    InvocationBinding binding,
                    String candidateId,
                    boolean streaming
            ) {
        var reducer = reducer(binding, candidateId);
        var results = reduce(
                reducer,
                events(adapter, textRequest(binding, streaming))
        );
        var terminal = assertInstanceOf(
                AttemptEventResult.Terminated.class,
                results.getLast()
        );
        assertEquals(AttemptOutcome.SUCCEEDED, terminal.outcome());
        return terminal.candidate().orElseThrow();
    }

    private static GenerationAttemptReducer reducer(
            InvocationBinding binding,
            String candidateId
    ) {
        return new GenerationAttemptReducer(
                binding,
                candidateId,
                GenerationState.IN_PROGRESS
        );
    }

    private static InvocationBinding.ExternalAttemptBinding externalBinding(
            OwnershipTuple ownership,
            String attemptId,
            long fence,
            String requestedAuthorizationSnapshotId,
            String executionAuthorizationSnapshotId
    ) {
        return new InvocationBinding.ExternalAttemptBinding(
                ownership,
                attemptId,
                fence,
                requestedAuthorizationSnapshotId,
                executionAuthorizationSnapshotId
        );
    }

    private static void assertReducerOpenAndEmpty(
            GenerationAttemptReducer reducer
    ) {
        assertEquals(0, reducer.expectedSequence());
        assertEquals(AttemptOutcome.OPEN, reducer.outcome());
        assertTrue(reducer.candidate().isEmpty());
        assertTrue(reducer.termination().isEmpty());
    }
}
