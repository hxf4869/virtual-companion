package com.virtualcompanion.runtime.memory;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Objects;

/**
 * R49 MODERATION/EMBED flexible-provider path: an OpenAI-compatible
 * /embeddings client ({@code POST {base-url}/embeddings} with
 * {@code Authorization: Bearer <key>}). Base URL, model and key are all
 * deployment-injected so any compatible third-party vendor works by
 * configuration alone.
 */
public final class OpenAiCompatEmbedder {

    private static final String JSON = "application/json";

    private final String baseUrl;
    private final String model;
    private final String apiKey;
    private final HttpClient http;

    public OpenAiCompatEmbedder(String baseUrl, String model, String apiKey) {
        this.baseUrl = Objects.requireNonNull(baseUrl, "baseUrl").replaceAll("/+$", "");
        this.model = Objects.requireNonNull(model, "model");
        this.apiKey = Objects.requireNonNull(apiKey, "apiKey");
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    /** Embed one text; returns the vendor's vector as float[]. */
    public float[] embed(String text) {
        return embed(text, null);
    }

    /** Request an explicit output dimension for providers that support it. */
    public float[] embed(String text, int dimensions) {
        if (dimensions <= 0) {
            throw new IllegalArgumentException("dimensions must be positive");
        }
        return embed(text, Integer.valueOf(dimensions));
    }

    private float[] embed(String text, Integer dimensions) {
        Objects.requireNonNull(text, "text must not be null");
        var payload = new java.util.LinkedHashMap<String, Object>();
        payload.put("model", model);
        payload.put("input", text);
        if (dimensions != null) {
            payload.put("dimensions", dimensions);
        }
        String body;
        try {
            body = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(payload);
        } catch (com.fasterxml.jackson.core.JsonProcessingException serialization) {
            throw new IllegalStateException("embeddings request could not be serialized", serialization);
        }
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/embeddings"))
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", JSON)
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("embeddings call interrupted", interrupted);
        } catch (java.io.IOException transport) {
            throw new IllegalStateException("embeddings call failed", transport);
        }
        if (response.statusCode() >= 300) {
            throw new IllegalStateException(
                    "embeddings call returned HTTP " + response.statusCode());
        }
        return parseVector(response.body());
    }

    /**
     * Minimal JSON string escaping: quotes, backslash and control characters
     * (a raw newline inside the input would otherwise make the request body
     * invalid JSON and the vendor would reject the call).
     */
    public static String escapeJsonString(String value) {
        StringBuilder out = new StringBuilder(value.length() + 8);
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        return out.toString();
    }

    /** Extracts {@code data[0].embedding} from an OpenAI-compatible payload. */
    public static float[] parseVector(String json) {
        com.fasterxml.jackson.databind.JsonNode node;
        try {
            node = new com.fasterxml.jackson.databind.ObjectMapper().readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException("embeddings payload is not JSON", e);
        }
        com.fasterxml.jackson.databind.JsonNode arr =
                node.path("data").path(0).path("embedding");
        if (!arr.isArray() || arr.isEmpty()) {
            throw new IllegalArgumentException("embeddings payload missing data[0].embedding");
        }
        float[] v = new float[arr.size()];
        for (int i = 0; i < arr.size(); i++) {
            com.fasterxml.jackson.databind.JsonNode value = arr.get(i);
            if (value == null || !value.isNumber()) {
                throw new IllegalArgumentException("embedding vector contains a non-numeric value");
            }
            double parsed = value.doubleValue();
            float narrowed = (float) parsed;
            if (!Double.isFinite(parsed) || !Float.isFinite(narrowed)) {
                throw new IllegalArgumentException("embedding vector contains a non-finite value");
            }
            v[i] = narrowed;
        }
        return v;
    }
}
