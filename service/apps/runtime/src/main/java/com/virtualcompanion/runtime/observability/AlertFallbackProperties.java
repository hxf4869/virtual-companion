package com.virtualcompanion.runtime.observability;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * S0-24-C/S0-31: optional independent generic webhook used only after the
 * primary alert channel is unavailable or terminally refused. Blank URL keeps
 * it disabled. Credentials and the allowlist are deployment-only values.
 */
@ConfigurationProperties("virtual-companion.alerts.fallback")
public record AlertFallbackProperties(
        @DefaultValue("") String webhookUrl,
        @DefaultValue("") String webhookSecret,
        @DefaultValue("") String webhookAllowedHosts,
        @DefaultValue("2s") Duration connectTimeout) {
}
