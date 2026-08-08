package com.virtualcompanion.modelopenai.contract;

import com.virtualcompanion.catalog.ModelProtocol;
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

import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.EXECUTION_AUTH;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.MODEL;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.REQUESTED_AUTH;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.TOKEN;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.adapter;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.choiceChunk;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.completion;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.done;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.drain;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.parseJson;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.sse;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.sseCrLf;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.structuredRequest;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.textRequest;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.usageChunk;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpenAiChatCompletionsSuccessContractTest {

    @Test
    void non_stream_success() throws Exception {
        try (var server = new MockOpenAiServer(MockOpenAiServer.fixed(
                200,
                "application/json; charset=utf-8",
                completion("你好，今晚辛苦了🙂", "stop", 12, 7)
        ))) {
            var client = new CountingHttpClient();
            var adapter = adapter(client, server.endpoint());

            var events = assertTimeoutPreemptively(
                    Duration.ofSeconds(5),
                    () -> drain(adapter.open(textRequest(false, "请回复")))
            );

            assertEquals(ModelProtocol.OPENAI_CHAT_COMPLETIONS, adapter.protocol());
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
            assertEquals("/v1/chat/completions", captured.uri().getRawPath());
            assertEquals(null, captured.uri().getQuery());
            assertTrue(captured.loopback());
            assertEquals("application/json", captured.firstHeader("Content-Type"));
            assertEquals("application/json", captured.firstHeader("Accept"));
            assertEquals("Bearer " + TOKEN, captured.firstHeader("Authorization"));
            assertEquals(1, server.requestCount());
            assertEquals(1, client.asynchronousCalls());

            var body = parseJson(captured.body());
            assertEquals(MODEL, body.get("model").stringValue());
            assertEquals(8192, body.get("max_tokens").intValue());
            assertFalse(body.get("stream").booleanValue());
            assertEquals(
                    List.of("system", "user", "assistant"),
                    java.util.stream.StreamSupport.stream(
                                    body.get("messages").spliterator(),
                                    false
                            )
                            .map(message -> message.get("role").stringValue())
                            .toList()
            );
            assertEquals("请回复", body.get("messages").get(1).get("content").stringValue());
            assertEquals(null, body.get("stream_options"));
            assertFalse(captured.body().contains(TOKEN));
            assertFalse(captured.body().contains(REQUESTED_AUTH));
            assertFalse(captured.body().contains(EXECUTION_AUTH));
        }
    }

    @Test
    void sse_stream_success() throws Exception {
        var stream = ": synthetic-comment\r\n\r\n"
                + sseCrLf(choiceChunk(null, null))
                + sse(choiceChunk("第一段", null))
                + sseCrLf(choiceChunk(" / 第二段🙂", null))
                + sse(choiceChunk(null, "stop"))
                + sseCrLf(usageChunk(9, 5))
                + done();
        try (var server = new MockOpenAiServer(MockOpenAiServer.fixed(
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
            assertEquals(8192, body.get("max_tokens").intValue());
            assertTrue(body.get("stream").booleanValue());
            assertTrue(body.get("stream_options").get("include_usage").booleanValue());
            assertEquals("text/event-stream", captured.firstHeader("Accept"));
            assertEquals(1, server.requestCount());
            assertEquals(1, client.asynchronousCalls());
        }
    }

    @Test
    void unicode_and_long_text() throws Exception {
        var unit = "陪伴🙂e\u0301汉字/晚安";
        var longText = unit.repeat(8_192);
        try (var nonStreamingServer = new MockOpenAiServer(MockOpenAiServer.fixed(
                200,
                "application/json",
                completion(longText, "stop", 1, 2)
        )); var streamingServer = new MockOpenAiServer(MockOpenAiServer.fixed(
                200,
                "text/event-stream",
                sse(choiceChunk(longText.substring(0, longText.length() / 2), null))
                        + sse(choiceChunk(longText.substring(longText.length() / 2), null))
                        + sse(choiceChunk(null, "stop"))
                        + sse(usageChunk(1, 2))
                        + done()
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
        try (var server = new MockOpenAiServer(MockOpenAiServer.fixed(
                200,
                "application/json",
                completion("usage", "stop", 123, 45)
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
                "stop", StopReason.STOP,
                "length", StopReason.LENGTH,
                "content_filter", StopReason.POLICY,
                "tool_calls", StopReason.UNKNOWN,
                "function_call", StopReason.UNKNOWN
        );
        for (var entry : expected.entrySet()) {
            try (var server = new MockOpenAiServer(MockOpenAiServer.fixed(
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
        try (var nonStreamingServer = new MockOpenAiServer(MockOpenAiServer.fixed(
                200,
                "application/json",
                completion(structuredJson, "stop", 4, 3)
        )); var streamingServer = new MockOpenAiServer(MockOpenAiServer.fixed(
                200,
                "text/event-stream",
                sse(choiceChunk("{\"answer\":\"今", null))
                        + sse(choiceChunk("晚辛苦了\"}", null))
                        + sse(choiceChunk(null, "stop"))
                        + sse(usageChunk(4, 3))
                        + done()
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
                var responseFormat = body.get("response_format");
                assertEquals("json_schema", responseFormat.get("type").stringValue());
                var jsonSchema = responseFormat.get("json_schema");
                assertEquals("companion_response", jsonSchema.get("name").stringValue());
                assertTrue(jsonSchema.get("strict").booleanValue());
                assertEquals("object", jsonSchema.get("schema").get("type").stringValue());
            }
            assertTrue(streamingBody.get("stream_options").get("include_usage").booleanValue());
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
