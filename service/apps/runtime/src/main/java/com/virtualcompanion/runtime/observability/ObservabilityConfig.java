package com.virtualcompanion.runtime.observability;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * METRICS-ALERT wiring. MeterRegistry comes from the actuator
 * auto-configuration; the Prometheus registry dependency adds the
 * {@code /actuator/prometheus} endpoint alongside the existing health page.
 */
@Configuration
public class ObservabilityConfig {

    @Bean
    public VcMetrics vcMetrics(io.micrometer.core.instrument.MeterRegistry registry) {
        return new VcMetrics(registry);
    }

    /**
     * DOGFOOD-05 (ADR-0006 §3.4): the rolling last-20 canary window is
     * unconditional — it simply stays empty until real provider attempts
     * record their terminal outcomes.
     */
    @Bean
    public RollingOutcomeWindow rollingOutcomeWindow(
            io.micrometer.core.instrument.MeterRegistry registry) {
        return new RollingOutcomeWindow(registry);
    }

    /**
     * DOGFOOD-05 (ADR-0006 §3.3): plan status derivation with once-per-day
     * P2 alerting on UNKNOWN. Never gates an outbound (the Owner canary
     * continues); alerts only.
     */
    @Bean
    public ProviderPlanMonitor providerPlanMonitor(
            ProviderPlanProperties properties, AlertNotifier alertNotifier) {
        return new ProviderPlanMonitor(properties, Clock.systemDefaultZone(), alertNotifier);
    }

    @Bean
    public WebhookDelivery webhookDelivery(AlertProperties properties) {
        return new WebhookDelivery(properties);
    }

    @Bean
    public FallbackWebhookDelivery fallbackWebhookDelivery(AlertFallbackProperties properties) {
        return new FallbackWebhookDelivery(properties);
    }

    @Bean
    public AlertNotifier alertNotifier(
            AlertProperties properties,
            VcMetrics metrics,
            WebhookDelivery webhookDelivery,
            org.springframework.beans.factory.ObjectProvider<
                    com.virtualcompanion.platform.persistence.AlertWebhookOutbox> outbox) {
        return new WebhookAlertNotifier(properties, outbox, webhookDelivery, metrics);
    }
}
