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
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    /** Embed one text; returns the vendor's vector as float[]. */
    public float[] embed(String text) {
        Objects.requireNonNull(text, "text must not be null");
        String body = "{\"model\":\"" + escapeJsonString(model)
                + "\",\"input\":\"" + escapeJsonString(text) + "\"}";
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
        } catch (Exception e) {
            throw new IllegalStateException("embeddings call failed", e);
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
            v[i] = (float) arr.get(i).asDouble();
        }
        return v;
    }
}
