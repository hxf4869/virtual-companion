package com.virtualcompanion.modelopenai.contract;

import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;

import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.adapter;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.choiceChunk;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.completion;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.done;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.drain;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.sse;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.textRequest;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.usageChunk;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpenAiChatCompletionsFailureContractTest {

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
        var validChoice = choiceChunk("prefix", null);
        var finish = choiceChunk(null, "stop");
        var usage = usageChunk(2, 1);
        var multipleChoices = """
                {"object":"chat.completion.chunk","choices":[
                  {"index":0,"delta":{"content":"a"},"finish_reason":null},
                  {"index":1,"delta":{"content":"b"},"finish_reason":null}
                ]}
                """;
        var wrongIndex = validChoice.replace("\"index\":0", "\"index\":1");
        var unknownFinish = choiceChunk(null, "provider_new_reason");
        var badUsage = """
                {"object":"chat.completion.chunk","choices":[],
                 "usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":99}}
                """;

        var malformedStreams = List.of(
                "event: message\n" + sse(validChoice) + sse(finish) + sse(usage) + done(),
                sse("{not-json") + done(),
                sse(multipleChoices) + done(),
                sse(wrongIndex) + done(),
                sse(validChoice) + sse(unknownFinish) + sse(usage) + done(),
                sse(validChoice) + sse(finish) + sse(finish) + sse(usage) + done(),
                sse(validChoice) + sse(finish) + sse(badUsage) + done(),
                sse(validChoice) + sse(finish) + sse(usage),
                sse(validChoice) + sse(finish) + done()
        );
        for (String stream : malformedStreams) {
            try (var server = new MockOpenAiServer(MockOpenAiServer.fixed(
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
    void invalid_content_type_json_and_choices_fail_closed() throws Exception {
        var invalidResponses = List.of(
                new ResponseCase(
                        "text/plain",
                        completion("content", "stop", 1, 1)
                ),
                new ResponseCase("application/json", "{not-json"),
                new ResponseCase(
                        "application/json",
                        """
                        {"object":"chat.completion","choices":[],"usage":{
                          "prompt_tokens":1,"completion_tokens":1,"total_tokens":2
                        }}
                        """
                ),
                new ResponseCase(
                        "application/json",
                        """
                        {"object":"chat.completion","choices":[
                          {"index":0,"message":{"content":"a"},"finish_reason":"stop"},
                          {"index":1,"message":{"content":"b"},"finish_reason":"stop"}
                        ],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}
                        """
                ),
                new ResponseCase(
                        "application/json",
                        completion("content", "not-legal", 1, 1)
                ),
                new ResponseCase(
                        "application/json",
                        completion("content", "stop", 1, 1)
                                .replace("\"total_tokens\":2", "\"total_tokens\":3")
                )
        );

        for (var response : invalidResponses) {
            try (var server = new MockOpenAiServer(MockOpenAiServer.fixed(
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
    void non_429_4xx_is_body_free_malformed_failure_without_retry()
            throws Exception {
        var secretResponse = "provider-body-must-not-cross-boundary";
        try (var server = new MockOpenAiServer(MockOpenAiServer.fixed(
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
        try (var server = new MockOpenAiServer(MockOpenAiServer.fixed(
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

    private record ResponseCase(String contentType, String body) {
    }
}
