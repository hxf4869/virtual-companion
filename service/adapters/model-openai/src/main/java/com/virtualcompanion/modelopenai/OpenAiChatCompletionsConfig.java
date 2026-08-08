package com.virtualcompanion.modelopenai;

import com.virtualcompanion.modelruntime.port.ProviderEgressPolicy;
import java.net.URI;
import java.util.Objects;

/**
 * Supplier-specific configuration kept behind the neutral model runtime port.
 *
 * <p>The bearer token is intentionally excluded from {@link #toString()}.</p>
 */
public final class OpenAiChatCompletionsConfig {

    public static final String CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

    private final URI endpoint;
    private final String bearerToken;
    private final String model;

    public OpenAiChatCompletionsConfig(
            URI endpoint,
            String bearerToken,
            String model
    ) {
        this.endpoint = requireEndpoint(endpoint);
        this.bearerToken = requireSecret(bearerToken);
        this.model = requireNonBlank(model, "model");
    }

    public URI endpoint() {
        return endpoint;
    }

    public String model() {
        return model;
    }

    String bearerToken() {
        return bearerToken;
    }

    @Override
    public String toString() {
        return "OpenAiChatCompletionsConfig[endpoint="
                + endpoint
                + ", bearerToken=<redacted>, model=<configured>]";
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
