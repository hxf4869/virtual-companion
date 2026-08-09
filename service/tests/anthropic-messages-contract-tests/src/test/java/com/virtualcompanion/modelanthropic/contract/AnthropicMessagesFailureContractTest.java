package com.virtualcompanion.modelanthropic.contract;

import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;

import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.adapter;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.completion;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.contentBlockStart;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.contentBlockStartToolUse;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.contentBlockStop;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.drain;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.inputJsonDelta;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.messageDelta;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.messageStart;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.messageStop;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.sse;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.structuredRequest;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.textDelta;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.textRequest;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.toolUseCompletion;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AnthropicMessagesFailureContractTest {

    @Test
    @DisplayName("429_mapping")
    void http_429_mapping() throws Exception {
        assertStatusFailure(429, new AdapterFailure.RateLimited());
    }

    @Test
    @DisplayName("5xx_mapping")
    void http_5xx_mapping() throws Exception {
        for (int status : List.of(500, 502, 503, 599)) {
            assertStatusFailure(status, new AdapterFailure.UpstreamUnavailable());
        }
    }

    @Test
    void malformed_event() throws Exception {
        var deltaWithoutStart = sse(contentBlockStart())
                + sse(textDelta("no-start"))
                + sse(contentBlockStop())
                + sse(messageDelta("end_turn", 1))
                + sse(messageStop());

        var missingMessageStop = sse(messageStart(2))
                + sse(contentBlockStart())
                + sse(textDelta("no-stop-event"))
                + sse(contentBlockStop())
                + sse(messageDelta("end_turn", 1));

        var missingStopReason = sse(messageStart(2))
                + sse(contentBlockStart())
                + sse(textDelta("no-reason"))
                + sse(contentBlockStop())
                + sse(messageDelta(null, 1))
                + sse(messageStop());

        var missingOutputTokens = sse(messageStart(2))
                + sse(contentBlockStart())
                + sse(textDelta("no-output"))
                + sse(contentBlockStop())
                + sse("{\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\",\"stop_sequence\":null}}")
                + sse(messageStop());

        var duplicateStopReason = sse(messageStart(2))
                + sse(contentBlockStart())
                + sse(textDelta("dup"))
                + sse(contentBlockStop())
                + sse(messageDelta("end_turn", 1))
                + sse(messageDelta("max_tokens", 2))
                + sse(messageStop());

        var stopWithoutContent = sse(messageStart(2))
                + sse(contentBlockStop())
                + sse(messageDelta("end_turn", 1))
                + sse(messageStop());

        var unknownEventType = sse(messageStart(2))
                + sse(contentBlockStart())
                + sse(textDelta("unknown"))
                + sse(contentBlockStop())
                + sse(messageDelta("end_turn", 1))
                + sse("{\"type\":\"provider_new_event\",\"data\":true}")
                + sse(messageStop());

        var malformedStreams = List.of(
                sse("{not-json"),
                deltaWithoutStart,
                missingMessageStop,
                missingStopReason,
                missingOutputTokens,
                duplicateStopReason,
                stopWithoutContent,
                unknownEventType
        );

        for (String stream : malformedStreams) {
            try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                    200,
                    "text/event-stream",
                    stream
            ))) {
                var client = new CountingHttpClient();
                var events = assertTimeoutPreemptively(
                        Duration.ofSeconds(5),
                        () -> drain(adapter(client, server.endpoint()).open(
                                textRequest(true, "malformed")
                        ))
                );

                assertInstanceOf(AdapterFailure.MalformedResponse.class, onlyFailure(events));
                assertTrue(events.stream()
                        .noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
                assertEquals(1, server.requestCount());
                assertEquals(1, client.asynchronousCalls());
            }
        }
    }

    @Test
    void structured_non_stream_rejects_wrong_missing_and_blank_tool_names()
            throws Exception {
        var responses = List.of(
                toolUseCompletion("wrong_tool", "{\"answer\":\"wrong\"}", "end_turn", 2, 1),
                toolUseCompletion(null, "{\"answer\":\"missing\"}", "end_turn", 2, 1),
                toolUseCompletion("   ", "{\"answer\":\"blank\"}", "end_turn", 2, 1)
        );

        for (var response : responses) {
            try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                    200,
                    "application/json",
                    response
            ))) {
                var events = drain(adapter(
                        new CountingHttpClient(),
                        server.endpoint()
                ).open(structuredRequest(false, "invalid tool name")));

                assertMalformedWithoutSuccess(events, true);
            }
        }
    }

    @Test
    void structured_stream_rejects_tool_name_and_block_index_violations()
            throws Exception {
        var wrongName = sse(messageStart(2))
                + sse(contentBlockStartToolUse("wrong_tool", 0));
        var missingName = sse(messageStart(2))
                + sse(contentBlockStartToolUse(null, 0));
        var blankName = sse(messageStart(2))
                + sse(contentBlockStartToolUse("   ", 0));
        var mismatchedDelta = sse(messageStart(2))
                + sse(contentBlockStartToolUse("companion_response", 3))
                + sse(inputJsonDelta(4, "{\"answer\":\"wrong\"}"));
        var mismatchedStop = sse(messageStart(2))
                + sse(contentBlockStartToolUse("companion_response", 3))
                + sse(inputJsonDelta(3, "{\"answer\":\"wrong\"}"))
                + sse(contentBlockStop(4));
        var secondToolBlock = sse(messageStart(2))
                + sse(contentBlockStartToolUse("companion_response", 0))
                + sse(inputJsonDelta(0, "{\"answer\":\"first\"}"))
                + sse(contentBlockStop(0))
                + sse(contentBlockStartToolUse("companion_response", 1));
        var negativeStart = sse(messageStart(2))
                + sse(contentBlockStartToolUse("companion_response", -1));
        var negativeDelta = sse(messageStart(2))
                + sse(contentBlockStartToolUse("companion_response", 0))
                + sse(inputJsonDelta(-1, "{}"));
        var negativeStop = sse(messageStart(2))
                + sse(contentBlockStartToolUse("companion_response", 0))
                + sse(inputJsonDelta(0, "{}"))
                + sse(contentBlockStop(-1));

        for (var stream : List.of(
                wrongName,
                missingName,
                blankName,
                mismatchedDelta,
                mismatchedStop,
                secondToolBlock,
                negativeStart,
                negativeDelta,
                negativeStop
        )) {
            try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                    200,
                    "text/event-stream",
                    stream
            ))) {
                var events = drain(adapter(
                        new CountingHttpClient(),
                        server.endpoint()
                ).open(structuredRequest(true, "invalid structured stream")));

                assertMalformedWithoutSuccess(events, true);
            }
        }
    }

    @Test
    void text_stream_rejects_mismatched_delta_and_stop_indexes()
            throws Exception {
        var mismatchedDelta = sse(messageStart(2))
                + sse(contentBlockStart(3))
                + sse(textDelta(4, "must not emit"));
        var mismatchedStop = sse(messageStart(2))
                + sse(contentBlockStart(3))
                + sse(textDelta(3, "already emitted"))
                + sse(contentBlockStop(4));

        for (var stream : List.of(mismatchedDelta, mismatchedStop)) {
            try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                    200,
                    "text/event-stream",
                    stream
            ))) {
                var events = drain(adapter(
                        new CountingHttpClient(),
                        server.endpoint()
                ).open(textRequest(true, "invalid text stream")));

                assertMalformedWithoutSuccess(events, false);
            }
        }
    }

    @Test
    void invalid_content_type_json_and_body_fail_closed() throws Exception {
        var invalidResponses = List.of(
                new ResponseCase(
                        "text/plain",
                        completion("content", "end_turn", 1, 1)
                ),
                new ResponseCase("application/json", "{not-json"),
                new ResponseCase(
                        "application/json",
                        "{\"type\":\"not_message\",\"content\":[],\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}"
                ),
                new ResponseCase(
                        "application/json",
                        "{\"type\":\"message\",\"content\":[],"
                                + "\"stop_reason\":\"end_turn\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}"
                ),
                new ResponseCase(
                        "application/json",
                        "{\"type\":\"message\",\"content\":[{\"type\":\"tool_use\",\"text\":\"a\"}],"
                                + "\"stop_reason\":\"end_turn\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}"
                ),
                new ResponseCase(
                        "application/json",
                        completion("content", "not-legal", 1, 1)
                ),
                new ResponseCase(
                        "application/json",
                        completion("content", "end_turn", 1, 1)
                                .replace("\"output_tokens\":1", "\"output_tokens\":-1")
                )
        );

        for (var response : invalidResponses) {
            try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                    200,
                    response.contentType,
                    response.body
            ))) {
                var events = drain(adapter(
                        new CountingHttpClient(),
                        server.endpoint()
                ).open(textRequest(false, "invalid response")));
                assertInstanceOf(AdapterFailure.MalformedResponse.class, onlyFailure(events));
                assertTrue(events.stream()
                        .noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
            }
        }
    }

    @Test
    void trailing_json_tokens_fail_closed_without_eos() throws Exception {
        var trailingRoot = "{\"extra\":true}";
        var structuredWithTrailingRoot = "{\"answer\":\"ok\"}" + trailingRoot;
        var scenarios = List.of(
                new TrailingTokenCase(
                        "application/json",
                        completion("content", "end_turn", 1, 1) + trailingRoot,
                        textRequest(false, "trailing non-stream")
                ),
                new TrailingTokenCase(
                        "application/json",
                        completion(structuredWithTrailingRoot, "end_turn", 1, 1),
                        structuredRequest(false, "trailing structured non-stream")
                ),
                new TrailingTokenCase(
                        "text/event-stream",
                        sse(messageStart(1))
                                + sse(contentBlockStart())
                                + sse(textDelta(structuredWithTrailingRoot))
                                + sse(contentBlockStop())
                                + sse(messageDelta("end_turn", 1))
                                + sse(messageStop()),
                        structuredRequest(true, "trailing structured stream")
                )
        );

        for (var scenario : scenarios) {
            try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                    200,
                    scenario.contentType,
                    scenario.body
            ))) {
                var client = new CountingHttpClient();
                var events = drain(adapter(client, server.endpoint()).open(
                        scenario.request
                ));

                assertInstanceOf(AdapterFailure.MalformedResponse.class, onlyFailure(events));
                assertTrue(events.stream()
                        .noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
                assertEquals(1, server.requestCount());
                assertEquals(1, client.asynchronousCalls());
            }
        }
    }

    @Test
    void non_429_4xx_is_body_free_malformed_failure_without_retry()
            throws Exception {
        var secretResponse = "provider-body-must-not-cross-boundary";
        try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                400,
                "application/json",
                secretResponse
        ))) {
            var client = new CountingHttpClient();
            var events = drain(adapter(client, server.endpoint()).open(
                    textRequest(false, "bad request")
            ));

            var failure = onlyFailure(events);
            assertInstanceOf(AdapterFailure.MalformedResponse.class, failure);
            assertEquals(1, server.requestCount());
            assertEquals(1, client.asynchronousCalls());
            assertTrue(!failure.toString().contains(secretResponse));
        }
    }

    private static void assertStatusFailure(
            int status,
            AdapterFailure expectedType
    ) throws Exception {
        var providerBody = "sensitive-provider-body-" + status;
        try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                status,
                "application/json",
                providerBody
        ))) {
            var client = new CountingHttpClient();
            var events = drain(adapter(client, server.endpoint()).open(
                    textRequest(false, "status")
            ));

            var failure = onlyFailure(events);
            assertEquals(expectedType.getClass(), failure.getClass());
            assertTrue(!failure.toString().contains(providerBody));
            assertEquals(1, server.requestCount());
            assertEquals(1, client.asynchronousCalls());
        }
    }

    private static AdapterFailure onlyFailure(List<ModelProtocolEvent> events) {
        return assertInstanceOf(
                ModelProtocolEvent.AttemptFailed.class,
                events.getLast()
        ).failure();
    }

    private static void assertMalformedWithoutSuccess(
            List<ModelProtocolEvent> events,
            boolean outputForbidden
    ) {
        assertInstanceOf(AdapterFailure.MalformedResponse.class, onlyFailure(events));
        assertTrue(events.stream()
                .noneMatch(ModelProtocolEvent.UsageReported.class::isInstance));
        assertTrue(events.stream()
                .noneMatch(ModelProtocolEvent.AttemptEos.class::isInstance));
        if (outputForbidden) {
            assertEquals(1, events.size());
            assertTrue(events.stream()
                    .noneMatch(ModelProtocolEvent.OutputDelta.class::isInstance));
        }
    }

    private record ResponseCase(String contentType, String body) {
    }

    private record TrailingTokenCase(
            String contentType,
            String body,
            com.virtualcompanion.modelruntime.contract.ModelProtocolRequest request
    ) {
    }
}
