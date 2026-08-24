package com.virtualcompanion.runtime.age;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.virtualcompanion.catalog.AgeState;
import com.virtualcompanion.modelruntime.port.EgressDnsGuard;
import com.virtualcompanion.modelruntime.port.ProviderEgressPolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.Objects;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * S0-12 minimal real age-verification adapter. The request contains only an
 * HMAC-pseudonymous account subject; it never accepts, sends or stores identity
 * document numbers, images or biometrics. Provider/region/privacy approval is a
 * separate launch gate, so this adapter stays default-off in configuration.
 */
public final class HttpAgeVerificationAdapter implements AgeVerificationPort {

    private static final Logger log = LoggerFactory.getLogger(HttpAgeVerificationAdapter.class);
    private static final ObjectMapper MAPPER = new ObjectMapper().findAndRegisterModules();

    private final URI endpoint;
    private final String apiKey;
    private final String providerRef;
    private final String providerVersion;
    private final byte[] subjectSecret;
    private final HttpClient http;
    private final EgressDnsGuard dnsGuard;

    public HttpAgeVerificationAdapter(
            String endpoint,
            String apiKey,
            String providerRef,
            String providerVersion,
            String subjectSecret,
            ProviderEgressPolicy egressPolicy,
            EgressDnsGuard dnsGuard) {
        this.endpoint = URI.create(requireText(endpoint, "endpoint"));
        Objects.requireNonNull(egressPolicy, "egressPolicy must not be null")
                .requireAllowed(this.endpoint);
        this.dnsGuard = Objects.requireNonNull(dnsGuard, "dnsGuard must not be null");
        this.apiKey = requireText(apiKey, "apiKey");
        this.providerRef = requireText(providerRef, "providerRef");
        this.providerVersion = requireText(providerVersion, "providerVersion");
        this.subjectSecret = requireText(subjectSecret, "subjectSecret")
                .getBytes(StandardCharsets.UTF_8);
        if (this.subjectSecret.length < 32) {
            throw new IllegalArgumentException("subjectSecret must be at least 32 bytes");
        }
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    @Override
    public AgeVerificationResult verify(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        long started = System.nanoTime();
        try {
            dnsGuard.requireAllowedResolution(endpoint);
        } catch (java.io.IOException | RuntimeException resolutionFailure) {
            audit("UNAVAILABLE", started);
            throw new IllegalStateException("age verification endpoint resolution was refused", resolutionFailure);
        }
        String body;
        try {
            body = MAPPER.writeValueAsString(Map.of("subject", subject(ownerUserId)));
        } catch (Exception serialization) {
            audit("INTERNAL_ERROR", started);
            throw new IllegalStateException("age verification request could not be serialized", serialization);
        }
        HttpRequest request = HttpRequest.newBuilder(endpoint)
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            audit("UNAVAILABLE", started);
            throw new IllegalStateException("age verification call interrupted", interrupted);
        } catch (java.io.IOException transport) {
            audit("UNAVAILABLE", started);
            throw new IllegalStateException("age verification call failed", transport);
        }
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            audit("HTTP_ERROR", started);
            throw new IllegalStateException("age verification call returned a non-success status");
        }

        AgeState state;
        try {
            state = parse(response.body(), providerVersion);
        } catch (RuntimeException invalid) {
            audit("INVALID_RESPONSE", started);
            throw invalid;
        }
        audit(state == AgeState.ADULT_VERIFIED ? "ADULT" : "MINOR", started);
        return new AgeVerificationResult(
                state, providerRef + "@" + providerVersion, Instant.now());
    }

    static AgeState parse(String json, String expectedProviderVersion) {
        JsonNode root;
        try {
            root = MAPPER.readTree(json);
        } catch (Exception malformed) {
            throw new IllegalArgumentException("age verification response is not JSON", malformed);
        }
        if (root == null || !root.isObject()
                || root.size() != 3
                || !root.path("state").isTextual()
                || !root.path("ageBand").isTextual()
                || !root.path("providerVersion").isTextual()) {
            throw new IllegalStateException("age verification response schema is invalid");
        }
        if (!expectedProviderVersion.equals(root.path("providerVersion").textValue())) {
            throw new IllegalStateException("age verification provider version mismatch");
        }
        String state = root.path("state").textValue();
        String ageBand = root.path("ageBand").textValue();
        if ("ADULT_VERIFIED".equals(state) && "18_PLUS".equals(ageBand)) {
            return AgeState.ADULT_VERIFIED;
        }
        if ("MINOR_VERIFIED".equals(state) && "UNDER_18".equals(ageBand)) {
            return AgeState.MINOR_VERIFIED;
        }
        throw new IllegalStateException("age verification state/ageBand conflict");
    }

    private String subject(long ownerUserId) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(subjectSecret, "HmacSHA256"));
            byte[] pseudonym = mac.doFinal(
                    ("vc-age-verification-v1|" + ownerUserId).getBytes(StandardCharsets.UTF_8));
            return "age_" + HexFormat.of().formatHex(pseudonym);
        } catch (Exception failure) {
            throw new IllegalStateException("age verification subject could not be derived", failure);
        }
    }

    private void audit(String outcome, long startedNanos) {
        long latencyMs = Math.max(0L, java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(
                System.nanoTime() - startedNanos));
        log.info("age verification provider={} version={} latencyMs={} outcome={}",
                providerRef, providerVersion, latencyMs, outcome);
    }

    private static String requireText(String value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        String normalized = value.trim();
        if (normalized.isEmpty()
                || normalized.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException(name + " must be non-blank printable text");
        }
        return normalized;
    }
}
