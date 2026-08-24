package com.virtualcompanion.runtime.observability;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.virtualcompanion.modelruntime.port.EgressDnsGuard;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/** Feishu application-bot tenant-token lifecycle and group-message protocol. */
final class FeishuAppBotDelivery {

    static final URI TOKEN_ENDPOINT = URI.create(
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal");
    static final URI MESSAGE_ENDPOINT = URI.create(
            "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id");

    private static final int MAX_REQUEST_BYTES = 150 * 1024;
    private static final int MAX_RESPONSE_BYTES = 16 * 1024;
    private static final int RATE_LIMIT_CODE = 230020;
    private static final int MESSAGE_SENDING_CODE = 230049;
    private static final int LEGACY_MESSAGE_SENDING_CODE = 18121;

    private final AlertProperties properties;
    private final WebhookEgressPolicy egressPolicy;
    private final EgressDnsGuard dnsGuard;
    private final HttpClient http;
    private final ObjectMapper mapper;
    private final URI tokenEndpoint;
    private final URI messageEndpoint;
    private final Clock clock;
    private final Object tokenRefreshLock = new Object();
    private final AtomicReference<CachedToken> cachedToken = new AtomicReference<>();

    FeishuAppBotDelivery(
            AlertProperties properties,
            WebhookEgressPolicy egressPolicy,
            EgressDnsGuard dnsGuard,
            HttpClient http,
            ObjectMapper mapper,
            URI tokenEndpoint,
            URI messageEndpoint,
            Clock clock) {
        this.properties = properties;
        this.egressPolicy = egressPolicy;
        this.dnsGuard = dnsGuard;
        this.http = http;
        this.mapper = mapper;
        this.tokenEndpoint = tokenEndpoint;
        this.messageEndpoint = messageEndpoint;
        this.clock = clock;
    }

    WebhookDelivery.Outcome post(
            String severity,
            String code,
            String message,
            Instant occurredAt,
            String deliveryId) {
        String appId = trimmed(properties.feishuAppId());
        String appSecret = trimmed(properties.feishuAppSecret());
        String chatId = trimmed(properties.feishuChatId());
        if (appId == null || appSecret == null || chatId == null || !chatId.startsWith("oc_")) {
            return WebhookDelivery.Outcome.REFUSED;
        }
        try {
            requireAllowed(tokenEndpoint);
            requireAllowed(messageEndpoint);
        } catch (IOException | RuntimeException rejected) {
            return WebhookDelivery.Outcome.REFUSED;
        }

        String body;
        try {
            body = messageBody(
                    severity,
                    code,
                    message,
                    occurredAt,
                    chatId,
                    requestUuid(deliveryId, code, occurredAt));
        } catch (RuntimeException serialization) {
            return WebhookDelivery.Outcome.REFUSED;
        }
        if (body.getBytes(StandardCharsets.UTF_8).length > MAX_REQUEST_BYTES) {
            return WebhookDelivery.Outcome.REFUSED;
        }

        TokenResolution resolved = resolveTenantToken(appId, appSecret);
        if (resolved.failure() != null) {
            return resolved.failure();
        }
        return sendMessage(resolved.token().value(), body);
    }

    private TokenResolution resolveTenantToken(String appId, String appSecret) {
        Instant now = clock.instant();
        CachedToken current = cachedToken.get();
        if (current != null && current.reusableAt(now)) {
            return TokenResolution.success(current);
        }
        synchronized (tokenRefreshLock) {
            now = clock.instant();
            current = cachedToken.get();
            if (current != null && current.reusableAt(now)) {
                return TokenResolution.success(current);
            }
            TokenResolution fetched = fetchTenantToken(appId, appSecret, now);
            if (fetched.failure() == null) {
                cachedToken.set(fetched.token());
            }
            return fetched;
        }
    }

    private TokenResolution fetchTenantToken(String appId, String appSecret, Instant requestedAt) {
        String body;
        try {
            body = mapper.writeValueAsString(Map.of(
                    "app_id", appId,
                    "app_secret", appSecret));
        } catch (Exception serialization) {
            return TokenResolution.failed(WebhookDelivery.Outcome.REFUSED);
        }
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder()
                    .uri(tokenEndpoint)
                    .timeout(properties.connectTimeout())
                    .header("Content-Type", "application/json; charset=utf-8")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
        } catch (RuntimeException invalidRequest) {
            return TokenResolution.failed(WebhookDelivery.Outcome.REFUSED);
        }

        try {
            HttpResponse<InputStream> response = http.send(
                    request, HttpResponse.BodyHandlers.ofInputStream());
            int status = response.statusCode();
            byte[] responseBytes;
            try (InputStream responseBody = response.body()) {
                responseBytes = readBounded(responseBody);
            }
            if (status < 200 || status >= 300) {
                return TokenResolution.failed(WebhookDelivery.httpFailure(status));
            }
            JsonNode json = parseObject(responseBytes);
            JsonNode code = json == null ? null : json.get("code");
            if (!isIntegral(code)) {
                return TokenResolution.failed(WebhookDelivery.Outcome.RETRYABLE);
            }
            int businessCode = code.intValue();
            if (businessCode != 0) {
                return TokenResolution.failed(tokenFailure(businessCode));
            }
            JsonNode expiresIn = json.get("expire");
            String token = json.path("tenant_access_token").asText("").trim();
            if (token.isEmpty()
                    || !safeBearerToken(token)
                    || expiresIn == null
                    || !expiresIn.isIntegralNumber()
                    || !expiresIn.canConvertToLong()) {
                return TokenResolution.failed(WebhookDelivery.Outcome.RETRYABLE);
            }
            long expiresInSeconds = expiresIn.longValue();
            if (expiresInSeconds <= 0 || expiresInSeconds > Duration.ofDays(1).toSeconds()) {
                return TokenResolution.failed(WebhookDelivery.Outcome.RETRYABLE);
            }
            long refreshMarginSeconds = Math.min(
                    Duration.ofMinutes(5).toSeconds(),
                    Math.max(1L, expiresInSeconds / 10L));
            CachedToken fetched = new CachedToken(
                    token,
                    requestedAt.plusSeconds(expiresInSeconds - refreshMarginSeconds));
            return TokenResolution.success(fetched);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return TokenResolution.failed(WebhookDelivery.Outcome.RETRYABLE);
        } catch (Exception delivery) {
            return TokenResolution.failed(WebhookDelivery.Outcome.RETRYABLE);
        }
    }

    private WebhookDelivery.Outcome sendMessage(String token, String body) {
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder()
                    .uri(messageEndpoint)
                    .timeout(properties.connectTimeout())
                    .header("Authorization", "Bearer " + token)
                    .header("Content-Type", "application/json; charset=utf-8")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
        } catch (RuntimeException invalidRequest) {
            invalidateToken(token);
            return WebhookDelivery.Outcome.RETRYABLE;
        }

        try {
            HttpResponse<InputStream> response = http.send(
                    request, HttpResponse.BodyHandlers.ofInputStream());
            int status = response.statusCode();
            byte[] responseBytes;
            try (InputStream responseBody = response.body()) {
                responseBytes = readBounded(responseBody);
            }
            if (status == 401) {
                invalidateToken(token);
                return WebhookDelivery.Outcome.RETRYABLE;
            }
            if (status == 429 || status >= 500) {
                return WebhookDelivery.Outcome.RETRYABLE;
            }
            if (status >= 200 && status < 300) {
                return messageOutcome(
                        responseBytes, true, WebhookDelivery.Outcome.RETRYABLE, token);
            }
            if (status >= 400 && status < 500) {
                return messageOutcome(
                        responseBytes, false, WebhookDelivery.Outcome.REFUSED, token);
            }
            return WebhookDelivery.httpFailure(status);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return WebhookDelivery.Outcome.RETRYABLE;
        } catch (Exception delivery) {
            return WebhookDelivery.Outcome.RETRYABLE;
        }
    }

    private WebhookDelivery.Outcome messageOutcome(
            byte[] responseBody,
            boolean successfulHttpStatus,
            WebhookDelivery.Outcome malformedOutcome,
            String usedToken) {
        JsonNode response = parseObject(responseBody);
        JsonNode code = response == null ? null : response.get("code");
        if (!isIntegral(code)) {
            return malformedOutcome;
        }
        int codeValue = code.intValue();
        if (tokenInvalid(codeValue)) {
            invalidateToken(usedToken);
            return WebhookDelivery.Outcome.RETRYABLE;
        }
        if (codeValue == RATE_LIMIT_CODE
                || codeValue == MESSAGE_SENDING_CODE
                || codeValue == LEGACY_MESSAGE_SENDING_CODE) {
            return WebhookDelivery.Outcome.RETRYABLE;
        }
        if (codeValue != 0) {
            return WebhookDelivery.Outcome.REFUSED;
        }
        if (!successfulHttpStatus) {
            return WebhookDelivery.Outcome.RETRYABLE;
        }
        String messageId = response.path("data").path("message_id").asText("").trim();
        return messageId.isEmpty()
                ? WebhookDelivery.Outcome.RETRYABLE
                : WebhookDelivery.Outcome.DELIVERED;
    }

    private String messageBody(
            String severity,
            String code,
            String message,
            Instant occurredAt,
            String chatId,
            String uuid) {
        try {
            String content = mapper.writeValueAsString(Map.of(
                    "text", WebhookDelivery.feishuText(severity, code, message, occurredAt)));
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("receive_id", chatId);
            payload.put("msg_type", "text");
            payload.put("content", content);
            payload.put("uuid", uuid);
            return mapper.writeValueAsString(payload);
        } catch (Exception serialization) {
            throw new IllegalArgumentException("Feishu app-bot serialization failed", serialization);
        }
    }

    private void requireAllowed(URI endpoint) throws IOException {
        egressPolicy.requireAllowed(endpoint);
        dnsGuard.requireAllowedResolution(endpoint);
    }

    private void invalidateToken(String usedToken) {
        cachedToken.getAndUpdate(current -> current != null && current.value().equals(usedToken)
                ? null
                : current);
    }

    private JsonNode parseObject(byte[] responseBody) {
        try {
            JsonNode response = mapper.readTree(responseBody);
            return response != null && response.isObject() ? response : null;
        } catch (IOException malformed) {
            return null;
        }
    }

    private static byte[] readBounded(InputStream responseBody) throws IOException {
        byte[] bytes = responseBody.readNBytes(MAX_RESPONSE_BYTES + 1);
        if (bytes.length > MAX_RESPONSE_BYTES) {
            throw new IOException("Feishu response exceeds limit");
        }
        return bytes;
    }

    private static WebhookDelivery.Outcome tokenFailure(int code) {
        return switch (code) {
            case 10003, 10005, 10014, 10015, 20002, 20009, 50003,
                    99991662, 99991673 -> WebhookDelivery.Outcome.REFUSED;
            default -> WebhookDelivery.Outcome.RETRYABLE;
        };
    }

    private static boolean tokenInvalid(int code) {
        return code == 20013 || code == 99991663 || code == 99991665;
    }

    private static String requestUuid(String deliveryId, String code, Instant occurredAt) {
        String source = deliveryId == null || deliveryId.isBlank()
                ? "vca-" + occurredAt.getEpochSecond() + "-" + occurredAt.getNano() + "-" + code
                : deliveryId;
        String safe = source.replaceAll("[^A-Za-z0-9_-]", "_");
        if (safe.isEmpty()) {
            safe = "vca-" + occurredAt.toEpochMilli();
        }
        return safe.length() <= 50 ? safe : safe.substring(0, 50);
    }

    private static String trimmed(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static boolean safeBearerToken(String token) {
        return token.chars().allMatch(character -> character > 0x20 && character < 0x7f);
    }

    private static boolean isIntegral(JsonNode value) {
        return value != null && value.isIntegralNumber() && value.canConvertToInt();
    }

    private record CachedToken(String value, Instant refreshAt) {
        private boolean reusableAt(Instant now) {
            return refreshAt.isAfter(now);
        }
    }

    private record TokenResolution(CachedToken token, WebhookDelivery.Outcome failure) {
        private static TokenResolution success(CachedToken token) {
            return new TokenResolution(token, null);
        }

        private static TokenResolution failed(WebhookDelivery.Outcome failure) {
            return new TokenResolution(null, failure);
        }
    }
}
