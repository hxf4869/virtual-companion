package com.virtualcompanion.modelopenai;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.util.Objects;
import java.util.Set;

import static java.net.http.HttpRequest.BodyPublishers;

/**
 * OpenAI Chat Completions HTTP/SSE protocol adapter.
 *
 * <p>This component performs one HTTP operation per valid external attempt. It
 * owns no routing, retry, fallback, persistence, or runtime wiring policy.</p>
 */
public final class OpenAiChatCompletionsAdapter implements ModelProtocolAdapter {

    private static final ModelProtocolCapabilities CAPABILITIES =
            new ModelProtocolCapabilities(Set.of(
                    ModelProtocolCapabilities.Capability.STREAMING,
                    ModelProtocolCapabilities.Capability.STRUCTURED_OUTPUT
            ));

    private final HttpClient httpClient;
    private final OpenAiChatCompletionsConfig config;
    private final OpenAiChatCompletionsCodec codec;

    public OpenAiChatCompletionsAdapter(OpenAiChatCompletionsConfig config) {
        this(
                HttpClient.newBuilder()
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .version(HttpClient.Version.HTTP_1_1)
                        .build(),
                config
        );
    }

    /**
     * Explicit client injection exists for deterministic offline contract
     * tests. The adapter still invokes {@code sendAsync} exactly once.
     */
    public OpenAiChatCompletionsAdapter(
            HttpClient httpClient,
            OpenAiChatCompletionsConfig config
    ) {
        this.httpClient = Objects.requireNonNull(httpClient, "httpClient must not be null");
        if (httpClient.followRedirects() != HttpClient.Redirect.NEVER) {
            throw new IllegalArgumentException(
                    "httpClient must disable redirects to preserve one-request semantics"
            );
        }
        this.config = Objects.requireNonNull(config, "config must not be null");
        this.codec = new OpenAiChatCompletionsCodec();
    }

    @Override
    public ModelProtocol protocol() {
        return ModelProtocol.OPENAI_CHAT_COMPLETIONS;
    }

    @Override
    public ModelProtocolCapabilities capabilities() {
        return CAPABILITIES;
    }

    @Override
    public ModelProtocolSession open(ModelProtocolRequest request) {
        Objects.requireNonNull(request, "request must not be null");
        if (!(request.binding() instanceof InvocationBinding.ExternalAttemptBinding)) {
            return ImmediateTerminalSession.failed(
                    request.binding(),
                    new AdapterFailure.UnsupportedBinding()
            );
        }

        final String requestBody;
        try {
            requestBody = codec.encodeRequest(
                    request, config.model(), config.maxTokens(), config.temperature());
        } catch (OpenAiCodecException exception) {
            return ImmediateTerminalSession.failed(
                    request.binding(),
                    new AdapterFailure.MalformedResponse()
            );
        }

        var httpRequest = HttpRequest.newBuilder(config.endpoint())
                .header("Authorization", "Bearer " + config.bearerToken())
                .header("Content-Type", "application/json")
                .header("Accept", request.streaming()
                        ? "text/event-stream"
                        : "application/json")
                .timeout(request.timeoutBudget().totalTimeout())
                .POST(BodyPublishers.ofString(requestBody))
                .build();

        return new OpenAiChatCompletionsSession(
                httpClient,
                httpRequest,
                request,
                codec
        );
    }

    @Override
    public String toString() {
        return "OpenAiChatCompletionsAdapter[protocol=OPENAI_CHAT_COMPLETIONS,"
                + " endpoint=" + config.endpoint() + "]";
    }
}
