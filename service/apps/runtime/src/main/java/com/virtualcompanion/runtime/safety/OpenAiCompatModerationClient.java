package com.virtualcompanion.runtime.safety;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * R49 MODERATION flexible-provider path: an OpenAI-compatible /moderations
 * client. Base URL, model and key are deployment-injected; any compatible
 * third-party works by configuration alone. The deterministic classifier
 * stays the fallback when this provider is not configured.
 */
public final class OpenAiCompatModerationClient {

    private static final Logger log = LoggerFactory.getLogger(OpenAiCompatModerationClient.class);
    private static final double DEFAULT_MIN_CLEAN_CONFIDENCE = 0.8;

    private final String baseUrl;
    private final String model;
    private final String apiKey;
    private final String providerRef;
    private final String modelVersion;
    private final double minCleanConfidence;
    private final HttpClient http;

    public OpenAiCompatModerationClient(String baseUrl, String model, String apiKey) {
        this(baseUrl, model, apiKey, "unspecified", "unspecified", DEFAULT_MIN_CLEAN_CONFIDENCE);
    }

    public OpenAiCompatModerationClient(
            String baseUrl,
            String model,
            String apiKey,
            String providerRef,
            String modelVersion,
            double minCleanConfidence) {
        this.baseUrl = requireText(baseUrl, "baseUrl").replaceAll("/+$", "");
        this.model = requireText(model, "model");
        this.apiKey = requireText(apiKey, "apiKey");
        this.providerRef = requireText(providerRef, "providerRef");
        this.modelVersion = requireText(modelVersion, "modelVersion");
        if (!(minCleanConfidence >= DEFAULT_MIN_CLEAN_CONFIDENCE && minCleanConfidence <= 1.0)) {
            throw new IllegalArgumentException("minCleanConfidence must be within 0.8..1.0");
        }
        this.minCleanConfidence = minCleanConfidence;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    public record ModerationResult(
            boolean flagged, List<String> categories, double confidence) {
    }

    /** Moderate one text; returns flagged flag plus the tripped category names. */
    public ModerationResult moderate(String text) {
        Objects.requireNonNull(text, "text must not be null");
        String body;
        try {
            body = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(
                    java.util.Map.of("model", model, "input", text));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("moderations request could not be serialized", e);
        }
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/moderations"))
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        long startedNanos = System.nanoTime();
        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            audit("UNAVAILABLE", startedNanos);
            throw new IllegalStateException("moderations call failed", e);
        }
        if (response.statusCode() >= 300) {
            audit("HTTP_ERROR", startedNanos);
            throw new IllegalStateException(
                    "moderations call returned HTTP " + response.statusCode());
        }
        ModerationResult result;
        try {
            result = parse(response.body());
        } catch (RuntimeException invalidResponse) {
            audit("INVALID_RESPONSE", startedNanos);
            throw invalidResponse;
        }
        if (!result.flagged() && result.confidence() < minCleanConfidence) {
            audit("LOW_CONFIDENCE", startedNanos);
            throw new IllegalStateException("moderations clean confidence below threshold");
        }
        audit(result.flagged() ? "FLAGGED" : "CLEAN", startedNanos);
        return result;
    }

    /** Parses {@code results[0]} into a ModerationResult. */
    public static ModerationResult parse(String json) {
        com.fasterxml.jackson.databind.JsonNode root;
        try {
            root = new com.fasterxml.jackson.databind.ObjectMapper().readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException("moderations payload is not JSON", e);
        }
        com.fasterxml.jackson.databind.JsonNode results = root.get("results");
        if (results == null || !results.isArray() || results.isEmpty()
                || !results.get(0).isObject()) {
            throw new IllegalStateException("moderations payload missing results[0]");
        }
        com.fasterxml.jackson.databind.JsonNode r0 = results.get(0);
        com.fasterxml.jackson.databind.JsonNode flaggedNode = r0.get("flagged");
        com.fasterxml.jackson.databind.JsonNode cats = r0.get("categories");
        com.fasterxml.jackson.databind.JsonNode scores = r0.get("category_scores");
        if (flaggedNode == null || !flaggedNode.isBoolean()
                || cats == null || !cats.isObject() || cats.isEmpty()
                || scores == null || !scores.isObject()
                || scores.size() != cats.size()) {
            throw new IllegalStateException("moderations payload has an invalid result schema");
        }
        boolean flagged = flaggedNode.booleanValue();
        List<String> categories = new ArrayList<>();
        double maxScore = 0.0;
        var names = cats.fieldNames();
        while (names.hasNext()) {
            String name = names.next();
            com.fasterxml.jackson.databind.JsonNode category = cats.get(name);
            com.fasterxml.jackson.databind.JsonNode score = scores.get(name);
            if (category == null || !category.isBoolean()
                    || score == null || !score.isNumber()) {
                throw new IllegalStateException("moderations category schema is invalid");
            }
            double value = score.doubleValue();
            if (!Double.isFinite(value) || value < 0.0 || value > 1.0) {
                throw new IllegalStateException("moderations category score is invalid");
            }
            maxScore = Math.max(maxScore, value);
            if (category.booleanValue()) {
                categories.add(name);
            }
        }
        if (flagged != !categories.isEmpty()) {
            throw new IllegalStateException("moderations flagged/categories conflict");
        }
        double confidence = flagged ? maxScore : 1.0 - maxScore;
        return new ModerationResult(flagged, List.copyOf(categories), confidence);
    }

    private void audit(String outcome, long startedNanos) {
        long latencyMillis = Math.max(0L,
                java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(
                        System.nanoTime() - startedNanos));
        log.info(
                "moderation provider={} model={} version={} latencyMs={} outcome={}",
                providerRef, model, modelVersion, latencyMillis, outcome);
    }

    private static String requireText(String value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        String normalized = value.trim();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return normalized;
    }
}
