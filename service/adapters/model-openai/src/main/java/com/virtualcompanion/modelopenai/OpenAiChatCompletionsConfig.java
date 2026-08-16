package com.virtualcompanion.modelopenai;

import com.virtualcompanion.modelruntime.contract.SizeLimits;
import com.virtualcompanion.modelruntime.port.ProviderEgressPolicy;
import java.net.URI;
import java.util.Objects;

/**
 * Supplier-specific configuration kept behind the neutral model runtime port.
 *
 * <p>The bearer token is intentionally excluded from {@link #toString()}.</p>
 *
 * <p>SAMPLE-CFG: {@code maxTokens} and {@code temperature} are deployment-level
 * sampling defaults carried into every request body by the codec (no request-
 * level override until real providers are admitted).</p>
 */
public final class OpenAiChatCompletionsConfig {

    public static final String CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

    /** SAMPLE-CFG: deployment default when the operator does not tune it. */
    public static final int DEFAULT_MAX_TOKENS = SizeLimits.MAX_OPENAI_OUTPUT_TOKENS;
    static final double DEFAULT_TEMPERATURE = 1.0;

    /** SAMPLE-CFG: OpenAI temperature legal band (inclusive). */
    static final double MIN_TEMPERATURE = 0.0;
    static final double MAX_TEMPERATURE = 2.0;

    private final URI endpoint;
    private final String bearerToken;
    private final String model;
    private final int maxTokens;
    private final double temperature;

    public OpenAiChatCompletionsConfig(
            URI endpoint,
            String bearerToken,
            String model
    ) {
        this(endpoint, bearerToken, model, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE);
    }

    public OpenAiChatCompletionsConfig(
            URI endpoint,
            String bearerToken,
            String model,
            int maxTokens,
            double temperature
    ) {
        this.endpoint = requireEndpoint(endpoint);
        this.bearerToken = requireSecret(bearerToken);
        this.model = requireNonBlank(model, "model");
        this.maxTokens = requireMaxTokens(maxTokens);
        this.temperature = requireTemperature(temperature);
    }

    public URI endpoint() {
        return endpoint;
    }

    public String model() {
        return model;
    }

    public int maxTokens() {
        return maxTokens;
    }

    public double temperature() {
        return temperature;
    }

    String bearerToken() {
        return bearerToken;
    }

    static int requireMaxTokens(int value) {
        if (value < 1 || value > SizeLimits.MAX_OPENAI_OUTPUT_TOKENS) {
            throw new IllegalArgumentException(
                    "maxTokens must be between 1 and " + SizeLimits.MAX_OPENAI_OUTPUT_TOKENS
            );
        }
        return value;
    }

    static double requireTemperature(double value) {
        if (!Double.isFinite(value) || value < MIN_TEMPERATURE || value > MAX_TEMPERATURE) {
            throw new IllegalArgumentException(
                    "temperature must be between " + MIN_TEMPERATURE + " and " + MAX_TEMPERATURE
            );
        }
        return value;
    }

    @Override
    public String toString() {
        return "OpenAiChatCompletionsConfig[endpoint="
                + endpoint
                + ", bearerToken=<redacted>, model=<configured>, maxTokens="
                + maxTokens
                + ", temperature="
                + temperature
                + "]";
    }

    private static URI requireEndpoint(URI value) {
        Objects.requireNonNull(value, "endpoint must not be null");
        var scheme = value.getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            throw new IllegalArgumentException("endpoint must use http or https");
        }
        if (value.getHost() == null || value.getHost().isBlank()) {
            throw new IllegalArgumentException("endpoint must include a host");
        }
        if (!CHAT_COMPLETIONS_PATH.equals(value.getRawPath())) {
            throw new IllegalArgumentException(
                    "endpoint path must be " + CHAT_COMPLETIONS_PATH
            );
        }
        if (value.getUserInfo() != null
                || value.getQuery() != null
                || value.getFragment() != null) {
            throw new IllegalArgumentException(
                    "endpoint must not include user info, query, or fragment"
            );
        }
        ProviderEgressPolicy.defaults().requireAllowed(value);
        return value;
    }

    private static String requireSecret(String value) {
        value = requireNonBlank(value, "bearerToken");
        if (value.chars().anyMatch(character ->
                character > 0xFF || Character.isISOControl(character))) {
            throw new IllegalArgumentException("bearerToken contains an invalid character");
        }
        return value;
    }

    private static String requireNonBlank(String value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
