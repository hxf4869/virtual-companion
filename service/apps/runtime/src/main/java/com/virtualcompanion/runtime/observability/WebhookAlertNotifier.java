package com.virtualcompanion.runtime.observability;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * METRICS-ALERT (§26.6): webhook alert channel. The URL comes from
 * deployment configuration ({@code VC_ALERT_WEBHOOK_URL}); a blank URL
 * disables the notifier completely. Sends are async fire-and-forget with a
 * short connect timeout, failures are only logged, and identical codes are
 * throttled so a hot rejection loop cannot turn into a webhook flood.
 */
public class WebhookAlertNotifier implements AlertNotifier {

    private static final Logger log = LoggerFactory.getLogger(WebhookAlertNotifier.class);

    private final AlertProperties properties;
    private final ObjectMapper mapper =
            new ObjectMapper().findAndRegisterModules();
    private final HttpClient http;
    private final ConcurrentHashMap<String, Long> lastSentAtMillis = new ConcurrentHashMap<>();

    public WebhookAlertNotifier(AlertProperties properties) {
        this.properties = properties;
        this.http = HttpClient.newBuilder()
                .connectTimeout(properties.connectTimeout())
                .build();
    }

    @Override
    public void alert(AlertSeverity severity, String code, String message) {
        String url = properties.webhookUrl();
        if (url == null || url.isBlank()) {
            return;
        }
        long now = System.currentTimeMillis();
        Long last = lastSentAtMillis.get(code);
        if (last != null && now - last < properties.throttleMillis()) {
            return;
        }
        lastSentAtMillis.put(code, now);
        String body;
        try {
            body = mapper.writeValueAsString(Map.of(
                    "severity", severity.name(),
                    "code", code,
                    "message", message,
                    "occurredAt", Instant.now().toString()));
        } catch (Exception e) {
            log.warn("alert {} {} skipped: payload serialization failed", severity, code, e);
            return;
        }
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(properties.connectTimeout())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        http.sendAsync(request, HttpResponse.BodyHandlers.discarding())
                .whenComplete((response, error) -> {
                    if (error != null) {
                        log.warn("alert {} {} webhook delivery failed: {}",
                                severity, code, error.toString());
                    } else if (response.statusCode() >= 300) {
                        log.warn("alert {} {} webhook returned HTTP {}",
                                severity, code, response.statusCode());
                    }
                });
    }
}
