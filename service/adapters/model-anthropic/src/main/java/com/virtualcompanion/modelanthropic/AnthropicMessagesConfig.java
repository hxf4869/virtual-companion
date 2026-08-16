package com.virtualcompanion.modelanthropic;

import com.virtualcompanion.modelruntime.port.ProviderEgressPolicy;
import java.net.URI;
import java.util.Objects;

/**
 * Supplier-specific configuration kept behind the neutral model runtime port.
 *
 * <p>The API key is intentionally excluded from {@link #toString()}.</p>
 *
 * <p>SAMPLE-CFG: {@code temperature} is a deployment-level sampling default
 * carried into every request body by the codec (no request-level override
 * until real providers are admitted).</p>
 */
public final class AnthropicMessagesConfig {

    public static final String MESSAGES_PATH = "/v1/messages";
    static final int MAX_TOKENS = 8192;

    /** SAMPLE-CFG: deployment default when the operator does not tune it. */
    static final double DEFAULT_TEMPERATURE = 1.0;

    /** SAMPLE-CFG: Anthropic temperature legal band (inclusive). */
    static final double MIN_TEMPERATURE = 0.0;
    static final double MAX_TEMPERATURE = 1.0;

    private final URI endpoint;
    private final String apiKey;
    private final String anthropicVersion;
    private final String model;
    private final int maxTokens;
    private final double temperature;

    public AnthropicMessagesConfig(
            URI endpoint,
            String apiKey,
            String anthropicVersion,
            String model,
            int maxTokens
    ) {
        this(endpoint, apiKey, anthropicVersion, model, maxTokens, DEFAULT_TEMPERATURE);
    }

    public AnthropicMessagesConfig(
            URI endpoint,
            String apiKey,
            String anthropicVersion,
            String model,
            int maxTokens,
            double temperature
    ) {
        this.endpoint = requireEndpoint(endpoint);
        this.apiKey = requireSecret(apiKey);
        this.anthropicVersion = requireNonBlank(anthropicVersion, "anthropicVersion");
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

    String apiKey() {
        return apiKey;
    }

    String anthropicVersion() {
        return anthropicVersion;
    }

    static double requireTemperature(double value) {
        if (!Double.isFinite(value) || value < MIN_TEMPERATURE || value > MAX_TEMPERATURE) {
            throw new IllegalArgumentException(
                    "temperature must be between " + MIN_TEMPERATURE + " and " + MAX_TEMPERATURE
            );
        }
        return value;
    }

    static int requireMaxTokens(int value) {
        if (value < 1 || value > MAX_TOKENS) {
            throw new IllegalArgumentException(
                    "maxTokens must be between 1 and " + MAX_TOKENS
            );
        }
        return value;
    }

    @Override
    public String toString() {
        return "AnthropicMessagesConfig[endpoint="
                + endpoint
                + ", apiKey=<redacted>, anthropicVersion="
                + anthropicVersion
                + ", model=<configured>, maxTokens="
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
        if (!MESSAGES_PATH.equals(value.getRawPath())) {
            throw new IllegalArgumentException(
                    "endpoint path must be " + MESSAGES_PATH
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
        value = requireNonBlank(value, "apiKey");
        if (value.chars().anyMatch(character ->
                character > 0xFF || Character.isISOControl(character))) {
            throw new IllegalArgumentException("apiKey contains an invalid character");
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
