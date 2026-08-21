package com.virtualcompanion.runtime.observability;

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

    @Bean
    public AlertNotifier alertNotifier(AlertProperties properties) {
        return new WebhookAlertNotifier(properties);
    }
}
