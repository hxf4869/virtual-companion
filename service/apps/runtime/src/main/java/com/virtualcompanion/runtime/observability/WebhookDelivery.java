package com.virtualcompanion.runtime.observability;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.virtualcompanion.modelruntime.port.EgressDnsGuard;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * One signed POST to the configured alert webhook. Failures never throw;
 * callers persist the {@link Outcome}. The HTTP client does not follow
 * redirects. Messages must already be catalog-sized operator text.
 */
public final class WebhookDelivery {

    public enum Outcome {
        DELIVERED,
        RETRYABLE,
        REFUSED
    }

    private final AlertProperties properties;
    private final WebhookEgressPolicy egressPolicy;
    private final EgressDnsGuard dnsGuard;
    private final HttpClient http;
    private final ObjectMapper mapper;

    public WebhookDelivery(AlertProperties properties) {
        this(properties, WebhookEgressPolicy.parse(properties.webhookAllowedHosts()),
                EgressDnsGuard.defaults());
    }

    WebhookDelivery(
            AlertProperties properties,
            WebhookEgressPolicy egressPolicy,
            EgressDnsGuard dnsGuard) {
        this.properties = properties;
        this.egressPolicy = egressPolicy;
        this.dnsGuard = dnsGuard;
        this.http = HttpClient.newBuilder()
                .connectTimeout(properties.connectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        this.mapper = new ObjectMapper().findAndRegisterModules();
    }

    public Outcome post(String severity, String code, String message, Instant occurredAt) {
        String url = properties.webhookUrl();
        if (url == null || url.isBlank()) {
            return Outcome.REFUSED;
        }
        String secret = properties.webhookSecret();
        if (secret == null || secret.isBlank()) {
            return Outcome.REFUSED;
        }
        URI endpoint;
        try {
            endpoint = URI.create(url.trim());
            egressPolicy.requireAllowed(endpoint);
            dnsGuard.requireAllowedResolution(endpoint);
        } catch (java.io.IOException | RuntimeException rejected) {
            return Outcome.REFUSED;
        }
        String body;
        try {
            body = mapper.writeValueAsString(Map.of(
                    "severity", severity,
                    "code", code,
                    "message", message,
                    "occurredAt", occurredAt.toString()));
        } catch (Exception serialization) {
            return Outcome.REFUSED;
        }
        String signature;
        try {
            signature = sign(secret, body);
        } catch (GeneralSecurityException | RuntimeException signing) {
            return Outcome.REFUSED;
        }
        HttpRequest request = HttpRequest.newBuilder()
                .uri(endpoint)
                .timeout(properties.connectTimeout())
                .header("Content-Type", "application/json")
                .header("X-VC-Signature", "sha256=" + signature)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        try {
            HttpResponse<Void> response = http.send(request, HttpResponse.BodyHandlers.discarding());
            int status = response.statusCode();
            if (status >= 200 && status < 300) {
                return Outcome.DELIVERED;
            }
            if (status >= 400 && status < 500 && status != 429) {
                return Outcome.REFUSED;
            }
            return Outcome.RETRYABLE;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return Outcome.RETRYABLE;
        } catch (Exception delivery) {
            return Outcome.RETRYABLE;
        }
    }

    static String sign(String secret, String body) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
    }
}
