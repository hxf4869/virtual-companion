package com.virtualcompanion.runtime.modelproviders;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Runtime-config-driven approved live model provider deployments.
 *
 * <p>This is the single runtime-configuration surface for TASK-0035's approved
 * provider set {OpenAI Chat Completions, Anthropic Messages}. Concrete model
 * names, API endpoints, supplier display names and credential secret references
 * are supplied by the operator at runtime and are deliberately not hard-coded.
 * Credentials themselves never appear here: each deployment references a
 * credential by its Docker-secret / secret-file name ({@code credentialSecret}),
 * and the value is read only through the injected secret reader.</p>
 *
 * <p>The master switch defaults to disabled. With {@code enabled=false} the
 * runtime wires no live model providers, so every external attempt fails
 * closed at the router (no eligible deployment).</p>
 *
 * @param enabled        master switch for approved live provider wiring
 * @param secretRoot     directory holding Docker-style secret files
 *                       (default {@code /run/secrets})
 * @param deployments    the approved deployment list (all are ignored unless
 *                       both {@code enabled} and the per-deployment flag are true)
 */
@ConfigurationProperties("virtual-companion.model-providers")
@Validated
public record ModelProviderProperties(
        boolean enabled,
        @DefaultValue("/run/secrets") String secretRoot,
        @Valid List<Deployment> deployments) {

    public ModelProviderProperties {
        deployments = deployments == null ? List.of() : List.copyOf(deployments);
    }

    /**
     * One approved provider deployment.
     *
     * @param providerId       stable provider id (must match the authorization
     *                         snapshot provider bound at execution time)
     * @param protocol         OPENAI_CHAT_COMPLETIONS or ANTHROPIC_MESSAGES
     * @param supplierName     supplier display name (runtime-configured, not
     *                         hard-coded; used for the audit chain)
     * @param model            concrete model name supplied by the operator
     * @param endpoint         concrete API base + path (e.g.
     *                         {@code https://api.openai.com/v1/chat/completions})
     * @param credentialSecret name of the Docker secret / secret file whose
     *                         content is the bearer token / API key
     * @param anthropicVersion Anthropic Messages API version (Anthropic only)
     * @param maxTokens        max output tokens (Anthropic only, must be > 0)
     * @param enabled          per-deployment switch
     */
    public record Deployment(
            @NotBlank String providerId,
            @NotBlank String protocol,
            @NotBlank String supplierName,
            @NotBlank String model,
            @NotBlank String endpoint,
            @NotBlank String credentialSecret,
            String anthropicVersion,
            Integer maxTokens,
            boolean enabled) {

        public Deployment {
            anthropicVersion = anthropicVersion == null ? "" : anthropicVersion;
            maxTokens = maxTokens == null ? 0 : maxTokens;
        }

        boolean anthropicConfigured() {
            return maxTokens > 0 && !anthropicVersion.isBlank();
        }
    }
}
