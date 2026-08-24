package com.virtualcompanion.runtime.observability;

import com.virtualcompanion.platform.persistence.AlertWebhookOutbox;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * S0-31-A: drains the alert webhook outbox. Leader/lease is S0-31-B; this
 * dispatcher is safe under the S0-33 single-replica gate. Delivery errors
 * stay in the outbox — they never throw into other jobs.
 */
public class AlertWebhookDispatcher {

    private static final Logger log = LoggerFactory.getLogger(AlertWebhookDispatcher.class);

    private final AlertWebhookOutbox outbox;
    private final WebhookDelivery delivery;
    private final FallbackWebhookDelivery fallbackDelivery;
    private final AlertProperties properties;
    private final VcMetrics metrics;

    public AlertWebhookDispatcher(
            AlertWebhookOutbox outbox,
            WebhookDelivery delivery,
            AlertProperties properties,
            VcMetrics metrics) {
        this(outbox, delivery, null, properties, metrics);
    }

    public AlertWebhookDispatcher(
            AlertWebhookOutbox outbox,
            WebhookDelivery delivery,
            FallbackWebhookDelivery fallbackDelivery,
            AlertProperties properties,
            VcMetrics metrics) {
        this.outbox = outbox;
        this.delivery = delivery;
        this.fallbackDelivery = fallbackDelivery;
        this.properties = properties;
        this.metrics = metrics;
    }

    @Scheduled(fixedDelayString = "${virtual-companion.alerts.webhook-drain-ms:5000}")
    public void drain() {
        if (!delivery.isConfigured()
                && (fallbackDelivery == null || !fallbackDelivery.isConfigured())) {
            return;
        }
        try {
            for (AlertWebhookOutbox.Claimed claimed : outbox.claim(16)) {
                WebhookDelivery.Outcome outcome = delivery.post(
                        claimed.severity(),
                        claimed.code(),
                        claimed.message(),
                        claimed.occurredAt(),
                        "vca-" + claimed.id() + "-" + claimed.occurredAt().toEpochMilli());
                if (outcome != WebhookDelivery.Outcome.DELIVERED
                        && fallbackDelivery != null
                        && fallbackDelivery.isConfigured()) {
                    WebhookDelivery.Outcome fallback = fallbackDelivery.post(
                            claimed.severity(),
                            claimed.code(),
                            claimed.message(),
                            claimed.occurredAt());
                    if (fallback == WebhookDelivery.Outcome.DELIVERED) {
                        outcome = WebhookDelivery.Outcome.DELIVERED;
                        metrics.alertWebhook("fallback_delivered");
                    } else if (outcome == WebhookDelivery.Outcome.REFUSED
                            && fallback == WebhookDelivery.Outcome.RETRYABLE) {
                        outcome = WebhookDelivery.Outcome.RETRYABLE;
                    }
                }
                switch (outcome) {
                    case DELIVERED -> {
                        outbox.complete(claimed.id(), "DELIVERED", "",
                                properties.webhookMaxAttempts(),
                                properties.webhookBackoffSeconds());
                        metrics.alertWebhook("delivered");
                    }
                    case REFUSED -> {
                        outbox.complete(claimed.id(), "DEAD", "refused",
                                properties.webhookMaxAttempts(),
                                properties.webhookBackoffSeconds());
                        metrics.alertWebhook("dead");
                    }
                    case RETRYABLE -> {
                        outbox.complete(claimed.id(), "RETRY", "retryable",
                                properties.webhookMaxAttempts(),
                                properties.webhookBackoffSeconds());
                        metrics.alertWebhook("retried");
                    }
                }
            }
        } catch (RuntimeException failed) {
            log.warn("alert webhook drain failed");
        }
    }
}
