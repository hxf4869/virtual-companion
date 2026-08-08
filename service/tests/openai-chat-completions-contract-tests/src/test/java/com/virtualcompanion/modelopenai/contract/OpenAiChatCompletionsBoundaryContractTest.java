package com.virtualcompanion.modelopenai.contract;

import com.virtualcompanion.modelopenai.OpenAiChatCompletionsAdapter;
import com.virtualcompanion.modelopenai.OpenAiChatCompletionsConfig;
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

import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.EXECUTION_AUTH;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.MODEL;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.REQUESTED_AUTH;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.TOKEN;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.adapter;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.binding;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.choiceChunk;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.deterministicBinding;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.done;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.drain;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.invalidStructuredRequest;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.sse;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.textRequest;
import static com.virtualcompanion.modelopenai.contract.OpenAiContractTestSupport.usageChunk;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpenAiChatCompletionsBoundaryContractTest {

    @Test
    void deterministic_binding_and_invalid_schema_make_zero_network_calls() {
        var client = new NeverCompletingHttpClient();
        var endpoint = URI.create("http://127.0.0.1:9/v1/chat/completions");
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
                () -> new OpenAiChatCompletionsConfig(
                        URI.create("ftp://127.0.0.1/v1/chat/completions"),
                        TOKEN,
                        MODEL
                )
        );
        var validConfig = new OpenAiChatCompletionsConfig(
                URI.create("http://127.0.0.1/v1/chat/completions"),
                TOKEN,
                MODEL
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsAdapter(
                        HttpClient.newBuilder()
                                .followRedirects(HttpClient.Redirect.ALWAYS)
                                .build(),
                        validConfig
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsConfig(
                        URI.create("http://127.0.0.1/v1/responses"),
                        TOKEN,
                        MODEL
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsConfig(
                        URI.create("http://127.0.0.1/%76%31/chat/completions"),
                        TOKEN,
                        MODEL
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsConfig(
                        URI.create("http://user@127.0.0.1/v1/chat/completions"),
                        TOKEN,
                        MODEL
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsConfig(
                        URI.create("http://127.0.0.1/v1/chat/completions?key=value"),
                        TOKEN,
                        MODEL
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new OpenAiChatCompletionsConfig(
                        URI.create("http://127.0.0.1/v1/chat/completions"),
                        TOKEN + "\r\nInjected: value",
                        MODEL
                )
        );
    }

    @Test
    void config_rejects_unicode_header_token_without_leak_or_network() {
        var invalidToken = "synthetic-token-密钥-🙂";
        var client = new NeverCompletingHttpClient();

        var failure = assertThrows(
                IllegalArgumentException.class,
                () -> {
                    var config = new OpenAiChatCompletionsConfig(
                            URI.create("http://127.0.0.1:9/v1/chat/completions"),
                            invalidToken,
                            MODEL
                    );
                    new OpenAiChatCompletionsAdapter(client, config)
                            .open(textRequest(false, "must stay offline"));
                }
        );

        assertFalse(failure.toString().contains(invalidToken));
        assertFalse(failure.toString().contains("密钥"));
        assertEquals(0, client.calls());
    }

    @Test
    void new_type_string_representations_are_secret_and_body_free() {
        var endpoint = URI.create("http://127.0.0.1:9/v1/chat/completions");
        var config = new OpenAiChatCompletionsConfig(endpoint, TOKEN, MODEL);
        var client = new NeverCompletingHttpClient();
        var adapter = new OpenAiChatCompletionsAdapter(client, config);
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
                assertFalse(value.contains(TOKEN));
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
        var chunk = choiceChunk("multi-data", null);
        int split = chunk.indexOf(",\"choices\"");
        var multiline = "data: " + chunk.substring(0, split + 1) + "\n"
                + "data: " + chunk.substring(split + 1) + "\n\n";
        try (var server = new MockOpenAiServer(MockOpenAiServer.fixed(
                200,
                "text/event-stream",
                multiline
                        + sse(choiceChunk(null, "stop"))
                        + sse(usageChunk(1, 1))
                        + done()
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
                                    events.getFirst()
                            ).payload()).text()
            );
        }
    }

    @Test
    void streaming_rejects_json_content_type_without_parsing_body()
            throws Exception {
        try (var server = new MockOpenAiServer(MockOpenAiServer.fixed(
                200,
                "application/json",
                "{\"object\":\"chat.completion.chunk\",\"choices\":[]}"
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
        assertTrue(List.of(OpenAiChatCompletionsAdapter.class.getConstructors()).stream()
                .allMatch(constructor -> List.of(constructor.getParameterTypes())
                        .contains(OpenAiChatCompletionsConfig.class)));

        var root = findRepositoryRoot();
        final String adapterSources;
        try (Stream<Path> sourcePaths = Files.walk(
                root.resolve("service/adapters/model-openai/src/main/java")
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
        assertFalse(adapterSources.contains("api.openai.com"));
        assertFalse(adapterSources.contains("System.getenv"));
        assertFalse(adapterSources.contains("System.getProperty"));
        assertFalse(adapterSources.contains("org.slf4j"));
        assertFalse(adapterSources.contains("java.util.logging"));

        var runtimePom = Files.readString(
                root.resolve("service/apps/runtime/pom.xml")
        );
        // Approved live model suppliers are legitimate compile-time runtime
        // dependencies (TASK-0035). What the boundary must guarantee instead
        // is that providers stay disabled by default and that no default
        // endpoint or credential is ever committed.
        assertTrue(runtimePom.contains("virtual-companion-model-openai"));
        assertTrue(runtimePom.contains("virtual-companion-model-anthropic"));

        var runtimeConfig = Files.readString(
                root.resolve("service/apps/runtime/src/main/resources/application.yaml")
        );
        // The master switch defaults to disabled, and no provider endpoint,
        // secret literal or committed URL exists in runtime configuration.
        assertTrue(runtimeConfig.contains("${VC_MODEL_PROVIDERS_ENABLED:false}"));
        assertFalse(runtimeConfig.contains("api.openai.com"));
        assertFalse(runtimeConfig.contains("sk-"));

        // The provisioner wires a deployment only when its per-deployment
        // switch is true, and never hard-codes a scheme, endpoint or
        // credential: only approved runtime configuration can provision.
        var provisionerSources = Files.readString(
                root.resolve("service/apps/runtime/src/main/java/"
                        + "com/virtualcompanion/runtime/modelproviders/"
                        + "ApprovedModelProviderProvisioner.java")
        );
        assertTrue(provisionerSources.contains("if (!deployment.enabled())"));
        assertFalse(provisionerSources.contains("http://"));
        assertFalse(provisionerSources.contains("https://"));
        assertFalse(provisionerSources.contains("sk-"));
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
