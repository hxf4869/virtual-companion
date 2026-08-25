package com.virtualcompanion.runtime.safety;

import com.virtualcompanion.catalog.RiskLevel;
import com.virtualcompanion.modelruntime.port.EgressDnsGuard;
import com.virtualcompanion.modelruntime.port.ProviderEgressPolicy;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
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
 * DOGFOOD-04 (ADR-0006 §5.2): remote safety classification over an
 * OpenAI-compatible {@code POST {base-url}/chat/completions} endpoint (e.g.
 * the WeChat ChatAPI channel whose provenance — not a default value — the
 * ADR records). The request carries ONLY a fixed Chinese classification
 * instruction plus the text under review: no persona, memory or conversation
 * context, and a minimal output budget (max_tokens 128, json_object mode).
 *
 * <p>DOGFOOD-STABILIZATION audit: the client is no longer a bare HttpClient
 * egress. The endpoint must pass {@link ProviderEgressPolicy} (exact
 * host:port allowlist, HTTPS outside loopback) at construction and the
 * per-call {@link EgressDnsGuard} DNS-rebinding check; redirects are never
 * followed and the response body is size-capped so a hostile or broken
 * channel cannot stream unbounded data into the host. The owner-bound
 * consent/admission/terms gate lives one layer up in
 * {@code OwnerGatedSafetyClassifier}.</p>
 *
 * <p>Fail-closed everywhere: timeouts, HTTP &ge; 300, non-JSON content,
 * missing/invalid fields, out-of-range confidence, type errors, an R0 with
 * non-empty violations conflict, a missing or null violations field, an
 * oversized response, more than one choice or empty content all throw. The
 * composite classifier turns any such exception into a BLOCK; this client
 * itself never decides a verdict.</p>
 */
public final class ChatCompletionsSafetyClient {

    private static final Logger log = LoggerFactory.getLogger(ChatCompletionsSafetyClient.class);

    /** Hard cap on the classification response body (a verdict is tiny). */
    private static final int MAX_RESPONSE_BYTES = 128 * 1024;

    /**
     * Fixed classification instruction (Chinese; strict JSON-only output).
     * Kept context-free by design so no persona/memory ever leaves the host.
     */
    private static final String SYSTEM_INSTRUCTION = "你是内容安全分类器。对用户给出的文本做安全风险分类，"
            + "只输出一个 JSON 对象，不输出任何其他文字或解释。"
            + "JSON 对象仅含以下字段："
            + "riskLevel（必须精确等于 R0_NORMAL、R1_DISTRESS、R2_ELEVATED、R3_HIGH、R4_IMMINENT 之一）、"
            + "confidence（0 到 1 之间的数值，表示分类置信度）、"
            + "violations（字符串数组，列出命中的风险类别，可为空数组）。"
            + "riskLevel 为 R0_NORMAL 时 violations 必须为空数组。";

    private final String baseUrl;
    private final String model;
    private final String apiKey;
    private final String providerRef;
    private final String modelVersion;
    private final ProviderEgressPolicy egressPolicy;
    private final EgressDnsGuard dnsGuard;
    private final URI endpoint;
    private final HttpClient http;

    public ChatCompletionsSafetyClient(String baseUrl, String model, String apiKey) {
        this(baseUrl, model, apiKey, "unspecified", "unspecified");
    }

    public ChatCompletionsSafetyClient(
            String baseUrl,
            String model,
            String apiKey,
            String providerRef,
            String modelVersion) {
        this(baseUrl, model, apiKey, providerRef, modelVersion,
                ProviderEgressPolicy.defaults(), EgressDnsGuard.defaults());
    }

    public ChatCompletionsSafetyClient(
            String baseUrl,
            String model,
            String apiKey,
            String providerRef,
            String modelVersion,
            ProviderEgressPolicy egressPolicy,
            EgressDnsGuard dnsGuard) {
        this.baseUrl = requireText(baseUrl, "baseUrl").replaceAll("/+$", "");
        this.model = requireText(model, "model");
        this.apiKey = requireText(apiKey, "apiKey");
        this.providerRef = requireText(providerRef, "providerRef");
        this.modelVersion = requireText(modelVersion, "modelVersion");
        this.egressPolicy = Objects.requireNonNull(egressPolicy, "egressPolicy");
        this.dnsGuard = Objects.requireNonNull(dnsGuard, "dnsGuard");
        this.endpoint = URI.create(this.baseUrl + "/chat/completions");
        // Fail fast at wiring time: an endpoint outside the approved egress
        // allowlist never becomes reachable at runtime.
        this.egressPolicy.requireAllowed(endpoint);
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    /** Strictly parsed classification result (no verdict semantics). */
    public record ClassificationResult(
            RiskLevel riskLevel, List<String> violations, double confidence) {
    }

    /** Classify one text; strict JSON only. Any deviation throws (fail-closed). */
    public ClassificationResult classify(String text) {
        Objects.requireNonNull(text, "text must not be null");
        String body;
        try {
            body = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(
                    java.util.Map.of(
                            "model", model,
                            "messages", List.of(
                                    java.util.Map.of("role", "system", "content", SYSTEM_INSTRUCTION),
                                    java.util.Map.of("role", "user", "content", text)),
                            "max_tokens", 128,
                            "response_format", java.util.Map.of("type", "json_object")));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("chat-completions request could not be serialized", e);
        }
        HttpRequest request = HttpRequest.newBuilder()
                .uri(endpoint)
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        long startedNanos = System.nanoTime();
        try {
            // DNS rebinding defense in depth: the allowlist check above is
            // lexical, so the actual resolution is validated per call before
            // a connection is opened (loopback stays reachable for offline
            // contract tests).
            dnsGuard.requireAllowedResolution(endpoint);
        } catch (IOException | IllegalArgumentException dnsBlocked) {
            audit("EGRESS_REFUSED", startedNanos);
            throw new IllegalStateException("chat-completions egress was refused", dnsBlocked);
        }
        HttpResponse<String> response;
        try {
            response = http.send(request, new BoundedBodyHandler());
        } catch (Exception e) {
            // Covers connect/request timeouts, the response-size cap and
            // every transport failure.
            audit("UNAVAILABLE", startedNanos);
            throw new IllegalStateException("chat-completions call failed", e);
        }
        if (response.statusCode() >= 300) {
            audit("HTTP_ERROR", startedNanos);
            throw new IllegalStateException(
                    "chat-completions call returned HTTP " + response.statusCode());
        }
        ClassificationResult result;
        try {
            result = parse(response.body());
        } catch (RuntimeException invalidResponse) {
            audit("INVALID_RESPONSE", startedNanos);
            throw invalidResponse;
        }
        audit("CLASSIFIED", startedNanos);
        return result;
    }

    /**
     * Strictly parses a non-streaming completion body: exactly one choice
     * whose message content is a JSON object holding only the known fields.
     */
    public static ClassificationResult parse(String json) {
        com.fasterxml.jackson.databind.JsonNode root;
        try {
            root = new com.fasterxml.jackson.databind.ObjectMapper().readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException("chat-completions payload is not JSON", e);
        }
        if (root == null || !root.isObject()) {
            throw new IllegalStateException("chat-completions payload is not a JSON object");
        }
        com.fasterxml.jackson.databind.JsonNode choices = root.get("choices");
        if (choices == null || !choices.isArray() || choices.size() != 1
                || !choices.get(0).isObject()) {
            throw new IllegalStateException(
                    "chat-completions payload must carry exactly one choice");
        }
        com.fasterxml.jackson.databind.JsonNode message = choices.get(0).get("message");
        com.fasterxml.jackson.databind.JsonNode contentNode =
                message == null ? null : message.get("content");
        if (contentNode == null || !contentNode.isTextual() || contentNode.asText().isBlank()) {
            throw new IllegalStateException("chat-completions content is empty");
        }
        com.fasterxml.jackson.databind.JsonNode content;
        try {
            content = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(contentNode.asText());
        } catch (Exception e) {
            throw new IllegalArgumentException("chat-completions content is not JSON", e);
        }
        if (content == null || !content.isObject()) {
            throw new IllegalStateException("chat-completions content is not a JSON object");
        }
        var fieldNames = content.fieldNames();
        while (fieldNames.hasNext()) {
            String field = fieldNames.next();
            if (!field.equals("riskLevel") && !field.equals("confidence")
                    && !field.equals("violations")) {
                throw new IllegalStateException(
                        "chat-completions content has an unknown field: " + field);
            }
        }
        com.fasterxml.jackson.databind.JsonNode riskNode = content.get("riskLevel");
        if (riskNode == null || !riskNode.isTextual()) {
            throw new IllegalStateException("chat-completions riskLevel is missing or not text");
        }
        RiskLevel riskLevel;
        try {
            riskLevel = RiskLevel.valueOf(riskNode.asText());
        } catch (IllegalArgumentException unknownLevel) {
            throw new IllegalStateException(
                    "chat-completions riskLevel is not a known level: " + riskNode.asText());
        }
        com.fasterxml.jackson.databind.JsonNode confidenceNode = content.get("confidence");
        if (confidenceNode == null || !confidenceNode.isNumber()) {
            throw new IllegalStateException("chat-completions confidence is missing or not a number");
        }
        double confidence = confidenceNode.doubleValue();
        if (!Double.isFinite(confidence) || confidence < 0.0 || confidence > 1.0) {
            throw new IllegalStateException("chat-completions confidence is out of range");
        }
        List<String> violations = new ArrayList<>();
        com.fasterxml.jackson.databind.JsonNode violationsNode = content.get("violations");
        if (violationsNode == null || violationsNode.isNull()) {
            // DOGFOOD-STABILIZATION audit: violations is a required field —
            // a missing or explicitly null array is malformed, never "none".
            throw new IllegalStateException("chat-completions violations is missing or null");
        }
        if (!violationsNode.isArray()) {
            throw new IllegalStateException("chat-completions violations is not an array");
        }
        for (com.fasterxml.jackson.databind.JsonNode item : violationsNode) {
            if (!item.isTextual() || item.asText().isBlank()) {
                throw new IllegalStateException(
                        "chat-completions violations entries must be non-blank strings");
            }
            violations.add(item.asText());
        }
        if (riskLevel == RiskLevel.R0_NORMAL && !violations.isEmpty()) {
            throw new IllegalStateException(
                    "chat-completions riskLevel/violations conflict (R0 with violations)");
        }
        return new ClassificationResult(riskLevel, List.copyOf(violations), confidence);
    }

    private void audit(String outcome, long startedNanos) {
        long latencyMillis = Math.max(0L,
                java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(
                        System.nanoTime() - startedNanos));
        // Never logs the classified text or any prompt content.
        log.info(
                "safety-classification provider={} model={} version={} latencyMs={} outcome={}",
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

    /**
     * Size-capped {@code ofString} body handler: reads at most
     * {@link #MAX_RESPONSE_BYTES} bytes; anything larger fails closed instead
     * of buffering an unbounded channel response.
     */
    private static final class BoundedBodyHandler
            implements HttpResponse.BodyHandler<String> {
        @Override
        public HttpResponse.BodySubscriber<String> apply(
                HttpResponse.ResponseInfo responseInfo) {
            HttpResponse.BodySubscriber<InputStream> upstream =
                    HttpResponse.BodySubscribers.ofInputStream();
            return HttpResponse.BodySubscribers.mapping(
                    upstream,
                    BoundedBodyHandler::readCapped);
        }

        private static String readCapped(InputStream stream) {
            try (stream) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int total = 0;
                int read;
                while ((read = stream.read(chunk)) != -1) {
                    total += read;
                    if (total > MAX_RESPONSE_BYTES) {
                        throw new IllegalStateException(
                                "chat-completions response exceeded the size cap");
                    }
                    buffer.write(chunk, 0, read);
                }
                return buffer.toString(java.nio.charset.StandardCharsets.UTF_8);
            } catch (IOException e) {
                throw new IllegalStateException(
                        "chat-completions response could not be read", e);
            }
        }
    }
}
