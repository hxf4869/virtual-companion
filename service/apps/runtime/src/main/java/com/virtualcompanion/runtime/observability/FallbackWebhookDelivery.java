package com.virtualcompanion.runtime.observability;

import java.time.Instant;
import java.util.Objects;

/**
 * Optional independent fallback alert channel. It intentionally supports only
 * the generic signed-webhook protocol: no primary provider credential or chat
 * target is reused, so deployment must inject a genuinely separate endpoint.
 */
public final class FallbackWebhookDelivery {

    private final AlertFallbackProperties properties;
    private final WebhookDelivery delegate;

    public FallbackWebhookDelivery(AlertFallbackProperties properties) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.delegate = new WebhookDelivery(new AlertProperties(
                properties.webhookUrl(),
                "generic",
                properties.connectTimeout(),
                60_000L,
                24L,
                1L,
                properties.webhookSecret(),
                "",
                "",
                "",
                properties.webhookAllowedHosts(),
                1,
                1));
    }

    public boolean isConfigured() {
        return properties.webhookUrl() != null
                && !properties.webhookUrl().isBlank()
                && properties.webhookSecret() != null
                && !properties.webhookSecret().isBlank()
                && delegate.isConfigured();
    }

    public WebhookDelivery.Outcome post(
            String severity,
            String code,
            String message,
            Instant occurredAt) {
        if (!isConfigured()) {
            return WebhookDelivery.Outcome.REFUSED;
        }
        return delegate.post(severity, code, message, occurredAt);
    }
}
