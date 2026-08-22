package com.virtualcompanion.runtime.observability;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * METRICS-ALERT deployment configuration. {@code webhook-url} is injected by
 * the deployment (env {@code VC_ALERT_WEBHOOK_URL}); a blank value disables
 * the alert channel entirely — metrics stay exposed, nothing is posted. The
 * R3/R4 SLA hours drive the admin safety-queue breach flag (§20.5 人工处置
 * 时限的机器可见形态; thresholds are a draft pending Owner review).
 */
@ConfigurationProperties("virtual-companion.alerts")
public record AlertProperties(
        @DefaultValue("")
        String webhookUrl,
        @DefaultValue("2s")
        Duration connectTimeout,
        @DefaultValue("60000")
        long throttleMillis,
        @DefaultValue("24")
        long r3SlaHours,
        @DefaultValue("1")
        long r4SlaHours,
        @DefaultValue("")
        String webhookSecret,
        @DefaultValue("")
        String webhookAllowedHosts,
        @DefaultValue("5")
        int webhookMaxAttempts,
        @DefaultValue("5")
        int webhookBackoffSeconds) {
}
