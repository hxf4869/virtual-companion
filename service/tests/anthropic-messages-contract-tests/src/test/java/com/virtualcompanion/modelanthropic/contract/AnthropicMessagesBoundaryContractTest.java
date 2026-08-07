package com.virtualcompanion.modelanthropic.contract;

import com.virtualcompanion.modelanthropic.AnthropicMessagesAdapter;
import com.virtualcompanion.modelanthropic.AnthropicMessagesConfig;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.stream.Stream;

import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.ANTHROPIC_VERSION;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.API_KEY;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.EXECUTION_AUTH;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.MAX_TOKENS;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.MODEL;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.REQUESTED_AUTH;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.adapter;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.binding;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.contentBlockStart;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.contentBlockStop;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.deterministicBinding;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.drain;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.invalidStructuredRequest;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.messageDelta;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.messageStart;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.messageStop;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.sse;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.textDelta;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.textRequest;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AnthropicMessagesBoundaryContractTest {

    @Test
    void deterministic_binding_and_invalid_schema_make_zero_network_calls() {
        var client = new NeverCompletingHttpClient();
        var endpoint = URI.create("http://127.0.0.1:9/v1/messages");
        var adapter = adapter(client, endpoint);

        var deterministicSession = adapter.open(textRequest(
                deterministicBinding(),
                false,
                "must not leave process",
                new TimeoutBudget(
                        Duration.ofSeconds(1),
                        Duration.ofSeconds(1),
                        Duration.ofSeconds(2)
                )
        ));
        var deterministicFailure = assertInstanceOf(
                ModelProtocolEvent.AttemptFailed.class,
                deterministicSession.next().orElseThrow()
        );
        assertEquals(deterministicBinding(), deterministicFailure.binding());
        assertInstanceOf(
                AdapterFailure.UnsupportedBinding.class,
                deterministicFailure.failure()
        );
        assertTrue(deterministicSession.next().isEmpty());

        var invalidSchema = drain(adapter.open(invalidStructuredRequest()));
        assertInstanceOf(
                AdapterFailure.MalformedResponse.class,
                assertInstanceOf(
                        ModelProtocolEvent.AttemptFailed.class,
                        invalidSchema.getFirst()
                ).failure()
        );
        assertEquals(0, client.calls());
    }

    @Test
    void config_rejects_non_contract_endpoints_and_header_injection() {
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create("ftp://127.0.0.1/v1/messages"),
                        API_KEY,
                        ANTHROPIC_VERSION,
                        MODEL,
                        MAX_TOKENS
                )
        );
        var validConfig = new AnthropicMessagesConfig(
                URI.create("http://127.0.0.1/v1/messages"),
                API_KEY,
                ANTHROPIC_VERSION,
                MODEL,
                MAX_TOKENS
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesAdapter(
                        HttpClient.newBuilder()
                                .followRedirects(HttpClient.Redirect.ALWAYS)
                                .build(),
                        validConfig
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create("http://127.0.0.1/v1/chat/completions"),
                        API_KEY,
                        ANTHROPIC_VERSION,
                        MODEL,
                        MAX_TOKENS
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create("http://127.0.0.1/%76%31/messages"),
                        API_KEY,
                        ANTHROPIC_VERSION,
                        MODEL,
                        MAX_TOKENS
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create("http://user@127.0.0.1/v1/messages"),
                        API_KEY,
                        ANTHROPIC_VERSION,
                        MODEL,
                        MAX_TOKENS
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create("http://127.0.0.1/v1/messages?key=value"),
                        API_KEY,
                        ANTHROPIC_VERSION,
                        MODEL,
                        MAX_TOKENS
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create("http://127.0.0.1/v1/messages"),
                        API_KEY + "\r\nInjected: value",
                        ANTHROPIC_VERSION,
                        MODEL,
                        MAX_TOKENS
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnthropicMessagesConfig(
                        URI.create("http://127.0.0.1/v1/messages"),
                        API_KEY,
                        ANTHROPIC_VERSION,
                        MODEL,
                        0
                )
        );
    }

    @Test
    void config_rejects_unicode_header_key_without_leak_or_network() {
        var invalidKey = "synthetic-key-密钥-🙂";
        var client = new NeverCompletingHttpClient();

        var failure = assertThrows(
                IllegalArgumentException.class,
                () -> {
                    var config = new AnthropicMessagesConfig(
                            URI.create("http://127.0.0.1:9/v1/messages"),
                            invalidKey,
                            ANTHROPIC_VERSION,
                            MODEL,
                            MAX_TOKENS
                    );
                    new AnthropicMessagesAdapter(client, config)
                            .open(textRequest(false, "must stay offline"));
                }
        );

        assertFalse(failure.toString().contains(invalidKey));
        assertFalse(failure.toString().contains("密钥"));
        assertEquals(0, client.calls());
    }

    @Test
    void new_type_string_representations_are_secret_and_body_free() {
        var endpoint = URI.create("http://127.0.0.1:9/v1/messages");
        var config = new AnthropicMessagesConfig(endpoint, API_KEY, ANTHROPIC_VERSION, MODEL, MAX_TOKENS);
        var client = new NeverCompletingHttpClient();
        var adapter = new AnthropicMessagesAdapter(client, config);
        var session = adapter.open(textRequest(
                binding(),
                true,
                "body-sentinel",
                new TimeoutBudget(
                        Duration.ofSeconds(1),
                        Duration.ofSeconds(1),
                        Duration.ofSeconds(2)
                )
        ));
        try {
            for (String value : List.of(
                    config.toString(),
                    adapter.toString(),
                    session.toString()
            )) {
                assertFalse(value.contains(API_KEY));
                assertFalse(value.contains("body-sentinel"));
                assertFalse(value.contains(REQUESTED_AUTH));
                assertFalse(value.contains(EXECUTION_AUTH));
            }
        } finally {
            session.cancel();
        }
    }

    @Test
    void multiline_sse_data_is_decoded_as_one_json_event() throws Exception {
        var chunk = textDelta("multi-data");
        int split = chunk.indexOf(",\"index\"");
        var multiline = "data: " + chunk.substring(0, split + 1) + "\n"
                + "data: " + chunk.substring(split + 1) + "\n\n";
        try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                200,
                "text/event-stream",
                sse(messageStart(1))
                        + sse(contentBlockStart())
                        + multiline
                        + sse(contentBlockStop())
                        + sse(messageDelta("end_turn", 1))
                        + sse(messageStop())
        ))) {
            var events = drain(adapter(
                    new CountingHttpClient(),
                    server.endpoint()
            ).open(textRequest(true, "multi-line")));
            assertEquals(
                    "multi-data",
                    ((com.virtualcompanion.modelruntime.contract.ModelPayload.TextChunk)
                            assertInstanceOf(
                                    ModelProtocolEvent.OutputDelta.class,
                                    events.get(0)
                            ).payload()).text()
            );
        }
    }

    @Test
    void streaming_rejects_json_content_type_without_parsing_body()
            throws Exception {
        try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                200,
                "application/json",
                "{\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}"
        ))) {
            var events = drain(adapter(
                    new CountingHttpClient(),
                    server.endpoint()
            ).open(textRequest(true, "wrong content type")));
            assertInstanceOf(
                    AdapterFailure.MalformedResponse.class,
                    assertInstanceOf(
                            ModelProtocolEvent.AttemptFailed.class,
                            events.getFirst()
                    ).failure()
            );
        }
    }

    @Test
    void adapter_has_no_default_real_endpoint_environment_or_runtime_wiring()
            throws Exception {
        assertTrue(List.of(AnthropicMessagesAdapter.class.getConstructors()).stream()
                .allMatch(constructor -> List.of(constructor.getParameterTypes())
                        .contains(AnthropicMessagesConfig.class)));

        var root = findRepositoryRoot();
        final String adapterSources;
        try (Stream<Path> sourcePaths = Files.walk(
                root.resolve("service/adapters/model-anthropic/src/main/java")
        )) {
            adapterSources = sourcePaths
                    .filter(Files::isRegularFile)
                    .map(path -> {
                        try {
                            return Files.readString(path);
                        } catch (Exception exception) {
                            throw new IllegalStateException(exception);
                        }
                    })
                    .reduce("", String::concat);
        }
        assertFalse(adapterSources.contains("api.anthropic.com"));
        assertFalse(adapterSources.contains("System.getenv"));
        assertFalse(adapterSources.contains("System.getProperty"));
        assertFalse(adapterSources.contains("org.slf4j"));
        assertFalse(adapterSources.contains("java.util.logging"));

        var runtimePom = Files.readString(
                root.resolve("service/apps/runtime/pom.xml")
        );
        assertFalse(runtimePom.contains("virtual-companion-model-anthropic"));
    }

    private static Path findRepositoryRoot() {
        var current = Path.of("").toAbsolutePath();
        while (current != null
                && (!Files.isRegularFile(current.resolve("pom.xml"))
                || !Files.isDirectory(current.resolve(".harness")))) {
            current = current.getParent();
        }
        if (current == null) {
            throw new IllegalStateException("repository root not found");
        }
        return current;
    }
}
