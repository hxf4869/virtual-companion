package com.virtualcompanion.modelanthropic;

import java.net.URI;
import java.util.Objects;

/**
 * Supplier-specific configuration kept behind the neutral model runtime port.
 *
 * <p>The API key is intentionally excluded from {@link #toString()}.</p>
 */
public final class AnthropicMessagesConfig {

    public static final String MESSAGES_PATH = "/v1/messages";

    private final URI endpoint;
    private final String apiKey;
    private final String anthropicVersion;
    private final String model;
    private final int maxTokens;

    public AnthropicMessagesConfig(
            URI endpoint,
            String apiKey,
            String anthropicVersion,
            String model,
            int maxTokens
    ) {
        this.endpoint = requireEndpoint(endpoint);
        this.apiKey = requireSecret(apiKey);
        this.anthropicVersion = requireNonBlank(anthropicVersion, "anthropicVersion");
        this.model = requireNonBlank(model, "model");
        if (maxTokens <= 0) {
            throw new IllegalArgumentException("maxTokens must be positive");
        }
        this.maxTokens = maxTokens;
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

    String apiKey() {
        return apiKey;
    }

    String anthropicVersion() {
        return anthropicVersion;
    }

    @Override
    public String toString() {
        return "AnthropicMessagesConfig[endpoint="
                + endpoint
                + ", apiKey=<redacted>, anthropicVersion="
                + anthropicVersion
                + ", model=<configured>, maxTokens="
                + maxTokens
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
