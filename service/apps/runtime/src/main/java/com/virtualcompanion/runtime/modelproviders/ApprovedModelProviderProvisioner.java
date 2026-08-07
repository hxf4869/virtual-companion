package com.virtualcompanion.runtime.modelproviders;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelanthropic.AnthropicMessagesAdapter;
import com.virtualcompanion.modelanthropic.AnthropicMessagesConfig;
import com.virtualcompanion.modelopenai.OpenAiChatCompletionsAdapter;
import com.virtualcompanion.modelopenai.OpenAiChatCompletionsConfig;
import com.virtualcompanion.modelruntime.execution.AdapterLocator;
import com.virtualcompanion.modelruntime.execution.InMemoryAdapterLocator;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.registry.InMemoryProviderRegistry;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.registry.ProviderRegistration;
import java.net.URI;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Provisions the approved live model provider deployments declared by
 * {@link ModelProviderProperties} into the in-memory registry.
 *
 * <p>Only deployments whose master switch AND per-deployment flag are true are
 * wired. Concrete model names, endpoints, supplier names and credential secret
 * references all come from runtime configuration — nothing here guesses a
 * default model, vendor, endpoint or credential. An unknown protocol fails
 * closed. Each provider is registered exactly once and its supplier display
 * name is recorded for the audit chain; the approved set is therefore the only
 * reachable external surface.</p>
 */
final class ApprovedModelProviderProvisioner {

    private ApprovedModelProviderProvisioner() {
    }

    static ApprovedModelProviders provision(
            ModelProviderProperties properties,
            ProviderSecretReader secretReader) {
        Objects.requireNonNull(properties, "properties must not be null");
        Objects.requireNonNull(secretReader, "secretReader must not be null");

        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        List<ProviderRegistration> registrations = new ArrayList<>();
        Map<ProviderId, String> supplierNames = new HashMap<>();

        for (ModelProviderProperties.Deployment deployment : properties.deployments()) {
            Objects.requireNonNull(deployment, "deployments must not contain null");
            if (!deployment.enabled()) {
                continue;
            }
            ProviderId providerId = new ProviderId(deployment.providerId());
            ModelProtocolAdapter adapter = buildAdapter(deployment, secretReader);
            ProviderRegistration registration = new ProviderRegistration(
                    providerId, adapter.protocol(), adapter.capabilities(), adapter);
            registry.register(registration);
            registrations.add(registration);
            supplierNames.put(providerId, deployment.supplierName());
        }

        AdapterLocator locator = new InMemoryAdapterLocator(registrations);
        return new ApprovedModelProviders(registry, locator, supplierNames);
    }

    private static ModelProtocolAdapter buildAdapter(
            ModelProviderProperties.Deployment deployment,
            ProviderSecretReader secretReader) {
        ModelProtocol protocol = parseProtocol(deployment.protocol());
        String credential = secretReader.readSecret(deployment.credentialSecret());
        URI endpoint = URI.create(deployment.endpoint());
        return switch (protocol) {
            case OPENAI_CHAT_COMPLETIONS -> new OpenAiChatCompletionsAdapter(
                    new OpenAiChatCompletionsConfig(
                            endpoint, credential, deployment.model()));
            case ANTHROPIC_MESSAGES -> {
                if (!deployment.anthropicConfigured()) {
                    throw new IllegalStateException(
                            "ANTHROPIC_MESSAGES deployment " + deployment.providerId()
                                    + " requires anthropic-version and max-tokens");
                }
                yield new AnthropicMessagesAdapter(
                        new AnthropicMessagesConfig(
                                endpoint,
                                credential,
                                deployment.anthropicVersion(),
                                deployment.model(),
                                deployment.maxTokens()));
            }
            default -> throw new IllegalStateException(
                    "unsupported protocol " + deployment.protocol()
                            + " for deployment " + deployment.providerId()
                            + "; approved protocols are OPENAI_CHAT_COMPLETIONS and ANTHROPIC_MESSAGES");
        };
    }

    private static ModelProtocol parseProtocol(String code) {
        Objects.requireNonNull(code, "protocol must not be null");
        try {
            return ModelProtocol.valueOf(code);
        } catch (IllegalArgumentException unknown) {
            throw new IllegalStateException(
                    "unknown provider protocol " + code
                            + "; approved protocols are OPENAI_CHAT_COMPLETIONS and ANTHROPIC_MESSAGES",
                    unknown);
        }
    }
}
