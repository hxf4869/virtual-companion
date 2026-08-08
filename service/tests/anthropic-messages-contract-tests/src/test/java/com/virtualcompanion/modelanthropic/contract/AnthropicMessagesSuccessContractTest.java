package com.virtualcompanion.modelanthropic.contract;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.API_KEY;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.ANTHROPIC_VERSION;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.EXECUTION_AUTH;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.MAX_TOKENS;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.MODEL;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.REQUESTED_AUTH;
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
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.parseJson;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.sse;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.sseCrLf;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.structuredRequest;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.textDelta;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.textRequest;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.toolUseCompletion;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AnthropicMessagesSuccessContractTest {

    @Test
    void non_stream_success() throws Exception {
        try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                200,
                "application/json; charset=utf-8",
                completion("你好，今晚辛苦了🙂", "end_turn", 12, 7)
        ))) {
            var client = new CountingHttpClient();
            var adapter = adapter(client, server.endpoint());

            var events = assertTimeoutPreemptively(
                    Duration.ofSeconds(5),
                    () -> drain(adapter.open(textRequest(false, "请回复")))
            );

            assertEquals(ModelProtocol.ANTHROPIC_MESSAGES, adapter.protocol());
            assertTrue(adapter.capabilities().supports(
                    ModelProtocolCapabilities.Capability.STREAMING
            ));
            assertTrue(adapter.capabilities().supports(
                    ModelProtocolCapabilities.Capability.STRUCTURED_OUTPUT
            ));
            assertEquals(
                    new ModelPayload.TextChunk("你好，今晚辛苦了🙂"),
                    assertInstanceOf(
                            ModelProtocolEvent.OutputDelta.class,
                            events.get(0)
                    ).payload()
            );
            assertEquals(
                    new TokenUsage(12, 7, 19),
                    assertInstanceOf(
                            ModelProtocolEvent.UsageReported.class,
                            events.get(1)
                    ).usage()
            );
            assertEquals(
                    StopReason.STOP,
                    assertInstanceOf(
                            ModelProtocolEvent.AttemptEos.class,
                            events.get(2)
                    ).stopReason()
            );

            var captured = server.awaitRequest();
            assertEquals("POST", captured.method());
            assertEquals("/v1/messages", captured.uri().getRawPath());
            assertEquals(null, captured.uri().getQuery());
            assertTrue(captured.loopback());
            assertEquals("application/json", captured.firstHeader("Content-Type"));
            assertEquals("application/json", captured.firstHeader("Accept"));
            assertEquals(API_KEY, captured.firstHeader("x-api-key"));
            assertEquals(ANTHROPIC_VERSION, captured.firstHeader("anthropic-version"));
            assertEquals(1, server.requestCount());
            assertEquals(1, client.asynchronousCalls());

            var body = parseJson(captured.body());
            assertEquals(MODEL, body.get("model").stringValue());
            assertEquals(MAX_TOKENS, body.get("max_tokens").intValue());
            assertFalse(body.get("stream").booleanValue());
            assertEquals("synthetic-system", body.get("system").stringValue());
            assertEquals(
                    List.of("user", "assistant"),
                    java.util.stream.StreamSupport.stream(
                                    body.get("messages").spliterator(),
                                    false
                            )
                            .map(message -> message.get("role").stringValue())
                            .toList()
            );
            assertEquals("请回复", body.get("messages").get(0).get("content").stringValue());
            assertFalse(captured.body().contains(API_KEY));
            assertFalse(captured.body().contains(REQUESTED_AUTH));
            assertFalse(captured.body().contains(EXECUTION_AUTH));
        }
    }

    @Test
    void sse_stream_success() throws Exception {
        var stream = sse(messageStart(9))
                + sse(contentBlockStart())
                + sse(textDelta("第一段"))
                + sseCrLf(textDelta(" / 第二段🙂"))
                + sse(contentBlockStop())
                + sse(messageDelta("end_turn", 5))
                + sse(messageStop());
        try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                200,
                "text/event-stream; charset=utf-8",
                stream
        ))) {
            var client = new CountingHttpClient();
            var events = assertTimeoutPreemptively(
                    Duration.ofSeconds(5),
                    () -> drain(adapter(client, server.endpoint()).open(
                            textRequest(true, "流式回复")
                    ))
            );

            assertEquals(
                    List.of("第一段", " / 第二段🙂"),
                    textDeltas(events)
            );
            assertEquals(
                    new TokenUsage(9, 5, 14),
                    assertInstanceOf(
                            ModelProtocolEvent.UsageReported.class,
                            events.get(2)
                    ).usage()
            );
            assertEquals(
                    StopReason.STOP,
                    assertInstanceOf(
                            ModelProtocolEvent.AttemptEos.class,
                            events.get(3)
                    ).stopReason()
            );
            var captured = server.awaitRequest();
            var body = parseJson(captured.body());
            assertTrue(body.get("stream").booleanValue());
            assertEquals("text/event-stream", captured.firstHeader("Accept"));
            assertEquals(1, server.requestCount());
            assertEquals(1, client.asynchronousCalls());
        }
    }

    @Test
    void sse_stream_success_with_explicit_event_lines_and_ping() throws Exception {
        // Anthropic emits explicit `event:` lines and `: ping`-style heartbeat
        // comments; the decoder must tolerate both without changing semantics.
        var stream = "event: message_start\n" + "data: " + messageStart(3) + "\n\n"
                + ": heartbeat\n\n"
                + "event: content_block_start\n" + "data: " + contentBlockStart() + "\n\n"
                + "event: content_block_delta\n" + "data: " + textDelta("event-line") + "\n\n"
                + "event: content_block_stop\n" + "data: " + contentBlockStop() + "\n\n"
                + "event: message_delta\n" + "data: " + messageDelta("end_turn", 2) + "\n\n"
                + "event: message_stop\n" + "data: " + messageStop() + "\n\n";
        try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                200,
                "text/event-stream",
                stream
        ))) {
            var events = assertTimeoutPreemptively(
                    Duration.ofSeconds(5),
                    () -> drain(adapter(
                            new CountingHttpClient(),
                            server.endpoint()
                    ).open(textRequest(true, "event lines")))
            );

            assertEquals(List.of("event-line"), textDeltas(events));
            assertEquals(
                    new TokenUsage(3, 2, 5),
                    assertInstanceOf(
                            ModelProtocolEvent.UsageReported.class,
                            events.get(1)
                    ).usage()
            );
        }
    }

    @Test
    void unicode_and_long_text() throws Exception {
        var unit = "陪伴🙂é汉字/晚安";
        var longText = unit.repeat(8_192);
        try (var nonStreamingServer = new MockAnthropicServer(MockAnthropicServer.fixed(
                200,
                "application/json",
                completion(longText, "end_turn", 1, 2)
        )); var streamingServer = new MockAnthropicServer(MockAnthropicServer.fixed(
                200,
                "text/event-stream",
                sse(messageStart(1))
                        + sse(contentBlockStart())
                        + sse(textDelta(longText.substring(0, longText.length() / 2)))
                        + sse(textDelta(longText.substring(longText.length() / 2)))
                        + sse(contentBlockStop())
                        + sse(messageDelta("end_turn", 2))
                        + sse(messageStop())
        ))) {
            var nonStreaming = assertTimeoutPreemptively(
                    Duration.ofSeconds(10),
                    () -> drain(adapter(
                            new CountingHttpClient(),
                            nonStreamingServer.endpoint()
                    ).open(textRequest(false, "长文本")))
            );
            var streaming = assertTimeoutPreemptively(
                    Duration.ofSeconds(10),
                    () -> drain(adapter(
                            new CountingHttpClient(),
                            streamingServer.endpoint()
                    ).open(textRequest(true, "长文本")))
            );

            assertEquals(longText, joinedText(nonStreaming));
            assertEquals(longText, joinedText(streaming));
        }
    }

    @Test
    void usage_mapping() throws Exception {
        try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                200,
                "application/json",
                completion("usage", "end_turn", 123, 45)
        ))) {
            var events = drain(adapter(
                    new CountingHttpClient(),
                    server.endpoint()
            ).open(textRequest(false, "usage")));

            assertEquals(
                    new TokenUsage(123, 45, 168),
                    events.stream()
                            .filter(ModelProtocolEvent.UsageReported.class::isInstance)
                            .map(ModelProtocolEvent.UsageReported.class::cast)
                            .findFirst()
                            .orElseThrow()
                            .usage()
            );
        }
    }

    @Test
    void finish_or_stop_reason_mapping() throws Exception {
        var expected = Map.of(
                "end_turn", StopReason.STOP,
                "stop_sequence", StopReason.STOP,
                "max_tokens", StopReason.LENGTH,
                "tool_use", StopReason.UNKNOWN
        );
        for (var entry : expected.entrySet()) {
            try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                    200,
                    "application/json",
                    completion("result", entry.getKey(), 1, 1)
            ))) {
                var events = drain(adapter(
                        new CountingHttpClient(),
                        server.endpoint()
                ).open(textRequest(false, "finish")));
                assertEquals(
                        entry.getValue(),
                        assertInstanceOf(
                                ModelProtocolEvent.AttemptEos.class,
                                events.getLast()
                        ).stopReason()
                );
            }
        }
    }

    @Test
    void structured_output_when_claimed() throws Exception {
        var structuredJson = "{\"answer\":\"今晚辛苦了\"}";
        // Real tool-use protocol: the non-streaming answer is a tool_use
        // content block and the streaming answer arrives as input_json_delta
        // fragments, not as text blocks or text_delta events.
        var nonStreamingStream = toolUseCompletion(structuredJson, "end_turn", 4, 3);
        var streamingStream = sse(messageStart(4))
                + sse(contentBlockStartToolUse())
                + sse(inputJsonDelta("{\"answer\":\"今"))
                + sse(inputJsonDelta("晚辛苦了\"}"))
                + sse(contentBlockStop())
                + sse(messageDelta("end_turn", 3))
                + sse(messageStop());
        try (var nonStreamingServer = new MockAnthropicServer(MockAnthropicServer.fixed(
                200,
                "application/json",
                nonStreamingStream
        )); var streamingServer = new MockAnthropicServer(MockAnthropicServer.fixed(
                200,
                "text/event-stream",
                streamingStream
        ))) {
            var nonStreaming = drain(adapter(
                    new CountingHttpClient(),
                    nonStreamingServer.endpoint()
            ).open(structuredRequest(false, "结构化")));
            var streaming = drain(adapter(
                    new CountingHttpClient(),
                    streamingServer.endpoint()
            ).open(structuredRequest(true, "结构化流")));

            assertStructuredOnly(nonStreaming, structuredJson);
            assertStructuredOnly(streaming, structuredJson);

            var nonStreamingBody = parseJson(nonStreamingServer.awaitRequest().body());
            var streamingBody = parseJson(streamingServer.awaitRequest().body());
            for (var body : List.of(nonStreamingBody, streamingBody)) {
                var tools = body.get("tools");
                assertEquals(1, tools.size());
                var tool = tools.get(0);
                assertEquals("companion_response", tool.get("name").stringValue());
                assertEquals("object", tool.get("input_schema").get("type").stringValue());
                var toolChoice = body.get("tool_choice");
                assertEquals("tool", toolChoice.get("type").stringValue());
                assertEquals("companion_response", toolChoice.get("name").stringValue());
            }
        }
    }

    @Test
    void nonStreamingToolUseWithoutStructuredModeFailsClosed() throws Exception {
        var stream = toolUseCompletion("{\"answer\":\"ignored\"}", "end_turn", 4, 3);
        try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                200,
                "application/json",
                stream
        ))) {
            var session = adapter(
                    new CountingHttpClient(),
                    server.endpoint()
            ).open(textRequest(false, "finish"));
            var events = drain(session);
            assertEquals(1, events.size());
            assertInstanceOf(ModelProtocolEvent.AttemptFailed.class, events.getFirst());
            assertInstanceOf(
                    AdapterFailure.MalformedResponse.class,
                    assertInstanceOf(
                            ModelProtocolEvent.AttemptFailed.class,
                            events.getFirst()
                    ).failure()
            );
        }
    }

    private static void assertStructuredOnly(
            List<ModelProtocolEvent> events,
            String expectedJson
    ) {
        assertEquals(3, events.size());
        assertEquals(
                new ModelPayload.StructuredJson(expectedJson),
                assertInstanceOf(
                        ModelProtocolEvent.OutputDelta.class,
                        events.get(0)
                ).payload()
        );
        assertInstanceOf(ModelProtocolEvent.UsageReported.class, events.get(1));
        assertInstanceOf(ModelProtocolEvent.AttemptEos.class, events.get(2));
        assertTrue(events.stream()
                .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                .map(ModelProtocolEvent.OutputDelta.class::cast)
                .noneMatch(event -> event.payload() instanceof ModelPayload.TextChunk));
    }

    private static List<String> textDeltas(List<ModelProtocolEvent> events) {
        return events.stream()
                .filter(ModelProtocolEvent.OutputDelta.class::isInstance)
                .map(ModelProtocolEvent.OutputDelta.class::cast)
                .map(ModelProtocolEvent.OutputDelta::payload)
                .filter(ModelPayload.TextChunk.class::isInstance)
                .map(ModelPayload.TextChunk.class::cast)
                .map(ModelPayload.TextChunk::text)
                .toList();
    }

    private static String joinedText(List<ModelProtocolEvent> events) {
        return textDeltas(events).stream().collect(Collectors.joining());
    }
}
