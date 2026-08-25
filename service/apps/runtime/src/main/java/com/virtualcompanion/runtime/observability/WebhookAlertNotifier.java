package com.virtualcompanion.runtime.observability;

import com.virtualcompanion.platform.persistence.AlertWebhookOutbox;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;

/**
 * METRICS-ALERT (§26.6) / S0-31-A: alert sink. A blank provider target disables
 * posting. When an outbox is wired the notifier only enqueues; the dispatcher
 * authenticates, allowlists and retries. Without an outbox (no-DB tests) the
 * notifier delivers directly. Failures never propagate into the business path.
 */
public class WebhookAlertNotifier implements AlertNotifier {

    private static final Logger log = LoggerFactory.getLogger(WebhookAlertNotifier.class);

    private final AlertProperties properties;
    private final ObjectProvider<AlertWebhookOutbox> outbox;
    private final AlertWebhookOutbox directOutbox;
    private final WebhookDelivery delivery;
    private final VcMetrics metrics;
    private final ConcurrentHashMap<String, Long> lastSentAtMillis = new ConcurrentHashMap<>();

    public WebhookAlertNotifier(AlertProperties properties) {
        this(properties, null, null, new WebhookDelivery(properties), null);
    }

    public WebhookAlertNotifier(
            AlertProperties properties,
            AlertWebhookOutbox outbox,
            WebhookDelivery delivery,
            VcMetrics metrics) {
        this(properties, null, outbox, delivery, metrics);
    }

    public WebhookAlertNotifier(
            AlertProperties properties,
            ObjectProvider<AlertWebhookOutbox> outbox,
            WebhookDelivery delivery,
            VcMetrics metrics) {
        this(properties, outbox, null, delivery, metrics);
    }

    private WebhookAlertNotifier(
            AlertProperties properties,
            ObjectProvider<AlertWebhookOutbox> outbox,
            AlertWebhookOutbox directOutbox,
            WebhookDelivery delivery,
            VcMetrics metrics) {
        this.properties = properties;
        this.outbox = outbox;
        this.directOutbox = directOutbox;
        this.delivery = delivery;
        this.metrics = metrics;
    }

    @Override
    public void alert(AlertSeverity severity, String code, String message) {
        alert(severity, code, message, properties.throttleMillis());
    }

    @Override
    public void alert(AlertSeverity severity, String code, String message, long dedupWindowMillis) {
        try {
            if (!delivery.isConfigured()) {
                return;
            }
            String safeCode = code == null ? "" : code.trim();
            String safeMessage = message == null ? "" : message.trim();
            if (safeCode.isEmpty() || safeMessage.isEmpty()) {
                record("refused");
                return;
            }
            long windowMillis = Math.max(1L, dedupWindowMillis);
            AlertWebhookOutbox box = resolveOutbox();
            if (box != null) {
                // Durable per-code dedup: the outbox window is supplied by the
                // caller, so a day-sized window survives same-day restarts.
                int windowSeconds = (int) Math.max(1L, windowMillis / 1000L);
                AlertWebhookOutbox.EnqueueResult result = box.enqueue(
                        severity.name(), safeCode, safeMessage, windowSeconds);
                record(result.inserted() ? "enqueued" : "duplicate");
                return;
            }
            long now = System.currentTimeMillis();
            Long last = lastSentAtMillis.get(safeCode);
            if (last != null && now - last < windowMillis) {
                record("duplicate");
                return;
            }
            lastSentAtMillis.put(safeCode, now);
            WebhookDelivery.Outcome outcome = delivery.post(
                    severity.name(), safeCode, safeMessage, Instant.now());
            record(switch (outcome) {
                case DELIVERED -> "delivered";
                case RETRYABLE -> "retried";
                case REFUSED -> "refused";
            });
        } catch (RuntimeException failed) {
            log.warn("alert {} {} skipped: sink failed", severity, code);
            record("refused");
        }
    }

    private AlertWebhookOutbox resolveOutbox() {
        if (directOutbox != null) {
            return directOutbox;
        }
        return outbox == null ? null : outbox.getIfAvailable();
    }

    private void record(String result) {
        if (metrics != null) {
            metrics.alertWebhook(result);
        }
    }
}
