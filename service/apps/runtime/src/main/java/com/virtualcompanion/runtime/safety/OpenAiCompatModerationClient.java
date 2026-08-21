package com.virtualcompanion.runtime.safety;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * R49 MODERATION flexible-provider path: an OpenAI-compatible /moderations
 * client. Base URL, model and key are deployment-injected; any compatible
 * third-party works by configuration alone. The deterministic classifier
 * stays the fallback when this provider is not configured.
 */
public final class OpenAiCompatModerationClient {

    private final String baseUrl;
    private final String model;
    private final String apiKey;
    private final HttpClient http;

    public OpenAiCompatModerationClient(String baseUrl, String model, String apiKey) {
        this.baseUrl = Objects.requireNonNull(baseUrl, "baseUrl").replaceAll("/+$", "");
        this.model = Objects.requireNonNull(model, "model");
        this.apiKey = Objects.requireNonNull(apiKey, "apiKey");
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    public record ModerationResult(boolean flagged, List<String> categories) {
    }

    /** Moderate one text; returns flagged flag plus the tripped category names. */
    public ModerationResult moderate(String text) {
        Objects.requireNonNull(text, "text must not be null");
        String safe = text.replace("\\", "\\\\").replace("\"", "\\\"");
        String body = "{\"model\":\"" + model + "\",\"input\":\"" + safe + "\"}";
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/moderations"))
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            throw new IllegalStateException("moderations call failed", e);
        }
        if (response.statusCode() >= 300) {
            throw new IllegalStateException(
                    "moderations call returned HTTP " + response.statusCode());
        }
        return parse(response.body());
    }

    /** Parses {@code results[0]} into a ModerationResult. */
    public static ModerationResult parse(String json) {
        com.fasterxml.jackson.databind.JsonNode root;
        try {
            root = new com.fasterxml.jackson.databind.ObjectMapper().readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException("moderations payload is not JSON", e);
        }
        com.fasterxml.jackson.databind.JsonNode r0 = root.path("results").path(0);
        boolean flagged = r0.path("flagged").asBoolean(false);
        List<String> categories = new ArrayList<>();
        com.fasterxml.jackson.databind.JsonNode cats = r0.path("categories");
        if (cats.isObject()) {
            cats.fieldNames().forEachRemaining(name -> {
                if (cats.get(name).asBoolean(false)) {
                    categories.add(name);
                }
            });
        }
        return new ModerationResult(flagged, List.copyOf(categories));
    }
}
