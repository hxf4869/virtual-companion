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
import java.security.GeneralSecurityException;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Authenticated delivery facade for generic, Feishu custom-bot and Feishu
 * application-bot alert channels. Failures never throw; callers persist the
 * {@link Outcome}. The HTTP client does not follow redirects.
 */
public final class WebhookDelivery {

    private static final int FEISHU_MAX_REQUEST_BYTES = 20 * 1024;
    private static final int MAX_RESPONSE_BYTES = 16 * 1024;
    private static final int FEISHU_RATE_LIMIT_CODE = 11232;

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
    private final FeishuAppBotDelivery feishuAppBotDelivery;

    public WebhookDelivery(AlertProperties properties) {
        this(properties, WebhookEgressPolicy.parse(properties.webhookAllowedHosts()),
                EgressDnsGuard.defaults());
    }

    WebhookDelivery(
            AlertProperties properties,
            WebhookEgressPolicy egressPolicy,
            EgressDnsGuard dnsGuard) {
        this(properties, egressPolicy, dnsGuard,
                FeishuAppBotDelivery.TOKEN_ENDPOINT,
                FeishuAppBotDelivery.MESSAGE_ENDPOINT,
                Clock.systemUTC());
    }

    WebhookDelivery(
            AlertProperties properties,
            WebhookEgressPolicy egressPolicy,
            EgressDnsGuard dnsGuard,
            URI feishuTokenEndpoint,
            URI feishuMessageEndpoint,
            Clock clock) {
        this.properties = properties;
        this.egressPolicy = egressPolicy;
        this.dnsGuard = dnsGuard;
        this.http = HttpClient.newBuilder()
                .connectTimeout(properties.connectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        this.mapper = new ObjectMapper().findAndRegisterModules();
        this.feishuAppBotDelivery = new FeishuAppBotDelivery(
                properties,
                egressPolicy,
                dnsGuard,
                http,
                mapper,
                feishuTokenEndpoint,
                feishuMessageEndpoint,
                clock);
    }

    public boolean isConfigured() {
        WebhookProvider provider;
        try {
            provider = WebhookProvider.parse(properties.webhookProvider());
        } catch (RuntimeException unsupported) {
            return false;
        }
        return switch (provider) {
            case GENERIC, FEISHU_CUSTOM_BOT -> hasText(properties.webhookUrl());
            case FEISHU_APP_BOT -> hasText(properties.feishuAppId())
                    && hasText(properties.feishuAppSecret())
                    && hasText(properties.feishuChatId());
        };
    }

    public Outcome post(String severity, String code, String message, Instant occurredAt) {
        return post(severity, code, message, occurredAt, null);
    }

    Outcome post(
            String severity,
            String code,
            String message,
            Instant occurredAt,
            String deliveryId) {
        if (severity == null || code == null || message == null || occurredAt == null) {
            return Outcome.REFUSED;
        }
        WebhookProvider provider;
        try {
            provider = WebhookProvider.parse(properties.webhookProvider());
        } catch (RuntimeException unsupported) {
            return Outcome.REFUSED;
        }
        return switch (provider) {
            case GENERIC, FEISHU_CUSTOM_BOT -> postWebhook(
                    provider, severity, code, message, occurredAt);
            case FEISHU_APP_BOT -> feishuAppBotDelivery.post(
                    severity, code, message, occurredAt, deliveryId);
        };
    }

    private Outcome postWebhook(
            WebhookProvider provider,
            String severity,
            String code,
            String message,
            Instant occurredAt) {
        String url = properties.webhookUrl();
        if (!hasText(url)) {
            return Outcome.REFUSED;
        }
        String secret = properties.webhookSecret();
        if (!hasText(secret)) {
            return Outcome.REFUSED;
        }
        URI endpoint;
        try {
            endpoint = URI.create(url.trim());
            egressPolicy.requireAllowed(endpoint);
            dnsGuard.requireAllowedResolution(endpoint);
        } catch (IOException | RuntimeException rejected) {
            return Outcome.REFUSED;
        }
        String body;
        try {
            body = switch (provider) {
                case GENERIC -> genericBody(severity, code, message, occurredAt);
                case FEISHU_CUSTOM_BOT -> feishuBody(
                        severity,
                        code,
                        message,
                        occurredAt,
                        secret,
                        Instant.now().getEpochSecond());
                case FEISHU_APP_BOT -> throw new IllegalStateException(
                        "application bot must use its API delivery path");
            };
        } catch (GeneralSecurityException | RuntimeException serialization) {
            return Outcome.REFUSED;
        }
        if (provider == WebhookProvider.FEISHU_CUSTOM_BOT
                && body.getBytes(StandardCharsets.UTF_8).length > FEISHU_MAX_REQUEST_BYTES) {
            return Outcome.REFUSED;
        }
        HttpRequest.Builder request = HttpRequest.newBuilder()
                .uri(endpoint)
                .timeout(properties.connectTimeout())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body));
        if (provider == WebhookProvider.GENERIC) {
            try {
                request.header("X-VC-Signature", "sha256=" + sign(secret, body));
            } catch (GeneralSecurityException | RuntimeException signing) {
                return Outcome.REFUSED;
            }
        }
        try {
            HttpResponse<InputStream> response = http.send(
                    request.build(), HttpResponse.BodyHandlers.ofInputStream());
            int status = response.statusCode();
            try (InputStream responseBody = response.body()) {
                if (status < 200 || status >= 300) {
                    return httpFailure(status);
                }
                if (provider == WebhookProvider.GENERIC) {
                    return Outcome.DELIVERED;
                }
                return feishuOutcome(readBounded(responseBody));
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return Outcome.RETRYABLE;
        } catch (Exception delivery) {
            return Outcome.RETRYABLE;
        }
    }

    private String genericBody(
            String severity,
            String code,
            String message,
            Instant occurredAt) {
        try {
            return mapper.writeValueAsString(Map.of(
                    "severity", severity,
                    "code", code,
                    "message", message,
                    "occurredAt", occurredAt.toString()));
        } catch (Exception serialization) {
            throw new IllegalArgumentException("generic webhook serialization failed", serialization);
        }
    }

    private String feishuBody(
            String severity,
            String code,
            String message,
            Instant occurredAt,
            String secret,
            long timestamp) throws GeneralSecurityException {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("timestamp", Long.toString(timestamp));
        payload.put("sign", signFeishu(secret, timestamp));
        payload.put("msg_type", "text");
        payload.put("content", Map.of("text", feishuText(severity, code, message, occurredAt)));
        try {
            return mapper.writeValueAsString(payload);
        } catch (Exception serialization) {
            throw new IllegalArgumentException("Feishu webhook serialization failed", serialization);
        }
    }

    static String feishuText(
            String severity,
            String code,
            String message,
            Instant occurredAt) {
        return "Virtual Companion 告警\n"
                + "severity=" + severity + "\n"
                + "code=" + code + "\n"
                + "message=" + message + "\n"
                + "occurredAt=" + occurredAt;
    }

    private Outcome feishuOutcome(byte[] responseBody) {
        JsonNode response;
        try {
            response = mapper.readTree(responseBody);
        } catch (IOException malformed) {
            return Outcome.RETRYABLE;
        }
        if (response == null || !response.isObject()) {
            return Outcome.RETRYABLE;
        }
        JsonNode code = response.get("code");
        JsonNode statusCode = response.get("StatusCode");
        if (code == null && statusCode == null) {
            return Outcome.RETRYABLE;
        }
        if (!isIntegral(code) || !isIntegral(statusCode)) {
            return Outcome.RETRYABLE;
        }
        int codeValue = code == null ? 0 : code.intValue();
        int statusCodeValue = statusCode == null ? 0 : statusCode.intValue();
        if (codeValue == 0 && statusCodeValue == 0) {
            return Outcome.DELIVERED;
        }
        if ((codeValue == 0 || codeValue == FEISHU_RATE_LIMIT_CODE)
                && (statusCodeValue == 0 || statusCodeValue == FEISHU_RATE_LIMIT_CODE)) {
            return Outcome.RETRYABLE;
        }
        return Outcome.REFUSED;
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static boolean isIntegral(JsonNode value) {
        return value == null || (value.isIntegralNumber() && value.canConvertToInt());
    }

    private static byte[] readBounded(InputStream responseBody) throws IOException {
        byte[] bytes = responseBody.readNBytes(MAX_RESPONSE_BYTES + 1);
        if (bytes.length > MAX_RESPONSE_BYTES) {
            throw new IOException("webhook response exceeds limit");
        }
        return bytes;
    }

    static Outcome httpFailure(int status) {
        if (status >= 400 && status < 500 && status != 429) {
            return Outcome.REFUSED;
        }
        return Outcome.RETRYABLE;
    }

    static String sign(String secret, String body) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
    }

    static String signFeishu(String secret, long timestamp) throws GeneralSecurityException {
        String stringToSign = timestamp + "\n" + secret;
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(
                stringToSign.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return Base64.getEncoder().encodeToString(mac.doFinal(new byte[0]));
    }

    private enum WebhookProvider {
        GENERIC,
        FEISHU_CUSTOM_BOT,
        FEISHU_APP_BOT;

        private static WebhookProvider parse(String configured) {
            String normalized = configured == null
                    ? "generic"
                    : configured.trim().toLowerCase(Locale.ROOT).replace('_', '-');
            return switch (normalized) {
                case "", "generic" -> GENERIC;
                case "feishu-custom-bot" -> FEISHU_CUSTOM_BOT;
                case "feishu-app-bot" -> FEISHU_APP_BOT;
                default -> throw new IllegalArgumentException("unsupported webhook provider");
            };
        }
    }
}
