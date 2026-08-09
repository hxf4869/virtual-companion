package com.virtualcompanion.runtime.modelproviders;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.modelruntime.registry.ProviderId;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * ApprovedModelProviderProvisioner tests for the TASK-0035 acceptance matrix:
 * only approved, enabled deployments are wired; unknown protocols and missing
 * credentials fail closed; anthropic deployments require version and maxTokens;
 * and the credential never leaks into a business type's string representation.
 */
class ApprovedModelProviderProvisionerTest {

    @TempDir
    Path tempDir;

    @BeforeEach
    void writeSecrets() throws IOException {
        Files.writeString(tempDir.resolve("openai-key"), "sk-live-token");
        Files.writeString(tempDir.resolve("anthropic-key"), "sk-ant-live");
    }

    @Test
    void provisionsOnlyEnabledApprovedDeployments() {
        ApprovedModelProviders set = provision(
                openai("openai-key", true),
                anthropic("anthropic-key", false));

        assertEquals(1, set.registry().deployments().size());
        ProviderId providerId = new ProviderId("openai-approved");
        assertNotNull(set.locator().adapterFor(providerId));
        assertEquals("OpenAI", set.supplierNames().get(providerId));
        // A provider outside the approved set is never reachable.
        assertThrows(IllegalStateException.class,
                () -> set.locator().adapterFor(new ProviderId("never-approved")));
    }

    @Test
    void credentialsNeverLeakIntoBusinessTypes() {
        ApprovedModelProviders set = provision(openai("openai-key", true));

        var adapter = set.locator().adapterFor(new ProviderId("openai-approved"));
        String representation = adapter.toString();
        assertFalse(representation.contains("sk-live-token"));
        assertFalse(representation.contains("Bearer"));
        assertTrue(representation.contains("openai-approved")
                || representation.contains("127.0.0.1"));
    }

    @Test
    void rejectsUnknownProtocolFailClosed() {
        ModelProviderProperties.Deployment unapproved = new ModelProviderProperties.Deployment(
                "responses-provider", "OPENAI_RESPONSES", "OpenAI Responses",
                "gpt-5", "http://127.0.0.1:1/v1/responses", "openai-key", "", 0, true);

        IllegalStateException exception = assertThrows(
                IllegalStateException.class, () -> provision(unapproved));
        assertTrue(exception.getMessage().contains("approved protocols"));
    }

    @Test
    void anthropicDeploymentRequiresVersionAndMaxTokens() {
        ModelProviderProperties.Deployment incomplete = new ModelProviderProperties.Deployment(
                "anthropic-approved", "ANTHROPIC_MESSAGES", "Anthropic",
                "claude-sonnet-5", "http://127.0.0.1:1/v1/messages",
                "anthropic-key", "", 0, true);

        IllegalStateException exception = assertThrows(
                IllegalStateException.class, () -> provision(incomplete));
        assertTrue(exception.getMessage().contains("anthropic-version and max-tokens"));
    }

    @Test
    void anthropicMaxTokensCeilingFailsBeforeRegistration() {
        for (int maxTokens : new int[]{8193, Integer.MAX_VALUE}) {
            IllegalArgumentException exception = assertThrows(
                    IllegalArgumentException.class,
                    () -> provision(anthropic("anthropic-key", true, maxTokens))
            );
            assertFalse(exception.getMessage().contains("sk-ant-live"));
        }
    }

    @Test
    void anthropicMaxTokensUpperBoundaryRegisters() {
        ApprovedModelProviders set = provision(anthropic("anthropic-key", true, 8192));

        assertEquals(1, set.registry().deployments().size());
        assertNotNull(set.locator().adapterFor(new ProviderId("anthropic-approved")));
    }

    @Test
    void disabledAnthropicDeploymentSkipsMaxTokensValidation() {
        ApprovedModelProviders set = provision(
                anthropic("anthropic-key", false, Integer.MAX_VALUE));

        assertTrue(set.registry().deployments().isEmpty());
        assertTrue(set.supplierNames().isEmpty());
    }

    @Test
    void disabledDeploymentsAreNotRegistered() {
        ApprovedModelProviders set = provision(openai("openai-key", false));

        assertTrue(set.registry().deployments().isEmpty());
        assertTrue(set.supplierNames().isEmpty());
    }

    @Test
    void missingCredentialFailsClosed() {
        ModelProviderProperties.Deployment missingSecret = new ModelProviderProperties.Deployment(
                "openai-approved", "OPENAI_CHAT_COMPLETIONS", "OpenAI",
                "gpt-4o-mini", "http://127.0.0.1:1/v1/chat/completions",
                "does-not-exist", "", 0, true);

        assertThrows(IllegalStateException.class, () -> provision(missingSecret));
    }

    @Test
    void endpointOutsideEgressAllowlistFailsClosed() {
        ModelProviderProperties.Deployment unapproved = new ModelProviderProperties.Deployment(
                "openai-approved", "OPENAI_CHAT_COMPLETIONS", "OpenAI",
                "gpt-4o-mini", "https://evil.example.com/v1/chat/completions",
                "openai-key", "", 0, true);

        assertThrows(IllegalArgumentException.class, () -> provision(unapproved));
    }

    @Test
    void traversalSecretReferenceFailsClosed() {
        ModelProviderProperties.Deployment traversal = new ModelProviderProperties.Deployment(
                "openai-approved", "OPENAI_CHAT_COMPLETIONS", "OpenAI",
                "gpt-4o-mini", "http://127.0.0.1:1/v1/chat/completions",
                "../openai-key", "", 0, true);

        assertThrows(IllegalArgumentException.class, () -> provision(traversal));
    }

    private ApprovedModelProviders provision(
            ModelProviderProperties.Deployment... deployments) {
        ModelProviderProperties properties =
                new ModelProviderProperties(true, tempDir.toString(), List.of(deployments));
        return ApprovedModelProviderProvisioner.provision(properties, new ProviderSecretReader(tempDir));
    }

    private static ModelProviderProperties.Deployment openai(String secret, boolean enabled) {
        return new ModelProviderProperties.Deployment(
                "openai-approved", "OPENAI_CHAT_COMPLETIONS", "OpenAI",
                "gpt-4o-mini", "http://127.0.0.1:1/v1/chat/completions",
                secret, "", 0, enabled);
    }

    private static ModelProviderProperties.Deployment anthropic(String secret, boolean enabled) {
        return anthropic(secret, enabled, 2048);
    }

    private static ModelProviderProperties.Deployment anthropic(
            String secret,
            boolean enabled,
            int maxTokens) {
        return new ModelProviderProperties.Deployment(
                "anthropic-approved", "ANTHROPIC_MESSAGES", "Anthropic",
                "claude-sonnet-5", "http://127.0.0.1:1/v1/messages",
                secret, "2023-06-01", maxTokens, enabled);
    }
}
