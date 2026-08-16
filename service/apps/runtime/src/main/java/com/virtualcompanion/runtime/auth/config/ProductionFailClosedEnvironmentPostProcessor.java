package com.virtualcompanion.runtime.auth.config;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.Profiles;

/**
 * Production fail-closed switch guard (EnvironmentPostProcessor). Runs right
 * after the production profile configuration is loaded and BEFORE any bean is
 * created, so the failure message is deterministic and never competes with a
 * later dependency-resolution failure.
 *
 * <p>In the production profile the auth and datasource switches have no
 * defaults ({@code ${VC_AUTH_ENABLED}} / {@code ${VC_AUTH_DATASOURCE_ENABLED}}
 * in {@code application.yaml}), so a missing variable already fails startup at
 * placeholder resolution (the property lookup below raises). This guard closes
 * the remaining hole: an EXPLICIT {@code false} resolves successfully but must
 * also refuse startup — the deployment policy requires both switches to be
 * {@code true} in production, and a silently degraded "auth off" production
 * runtime is never acceptable.
 *
 * <p>Only the two master switches are forced here. {@code VC_FLYWAY_ENABLED}
 * may legitimately stay {@code false} in production (migrations may run out of
 * process via the migrator principal), so it is not part of this guard.
 */
public class ProductionFailClosedEnvironmentPostProcessor implements EnvironmentPostProcessor {

    @Override
    public void postProcessEnvironment(
            ConfigurableEnvironment environment, SpringApplication application) {
        if (!environment.acceptsProfiles(Profiles.of("production"))) {
            return;
        }
        // The lookups resolve the ${VC_AUTH_ENABLED} / ${VC_AUTH_DATASOURCE_ENABLED}
        // placeholders; a missing variable raises here (fail closed, unchanged).
        String authEnabled = environment.getProperty("virtual-companion.auth.enabled");
        if ("false".equalsIgnoreCase(authEnabled)) {
            throw new IllegalStateException(
                    "virtual-companion.auth.enabled (VC_AUTH_ENABLED) must be true in the "
                            + "production profile; an explicit false is rejected");
        }
        String datasourceEnabled =
                environment.getProperty("virtual-companion.auth.datasource-enabled");
        if ("false".equalsIgnoreCase(datasourceEnabled)) {
            throw new IllegalStateException(
                    "virtual-companion.auth.datasource-enabled (VC_AUTH_DATASOURCE_ENABLED) must "
                            + "be true in the production profile; an explicit false is rejected");
        }
    }
}
