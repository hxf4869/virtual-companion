package com.virtualcompanion.runtime.modelproviders;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.routing.DeterministicRouter;
import com.virtualcompanion.modelruntime.routing.QuotaLedger;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Runtime wiring of the approved live model provider path (TASK-0035): with the
 * master switch on and an approved, enabled OpenAI deployment whose credential
 * is injected as a secret file, the registry admits exactly the approved
 * deployment, the locator resolves it, the supplier display name is recorded,
 * and the credential never leaks into any business type string.
 */
@SpringBootTest(properties = {
        "virtual-companion.model-providers.enabled=true",
        "virtual-companion.model-providers.secret-root=${TEST_MODEL_SECRET_ROOT}",
        "virtual-companion.model-providers.deployments[0].provider-id=openai-approved",
        "virtual-companion.model-providers.deployments[0].protocol=OPENAI_CHAT_COMPLETIONS",
        "virtual-companion.model-providers.deployments[0].supplier-name=OpenAI",
        "virtual-companion.model-providers.deployments[0].model=gpt-4o-mini",
        "virtual-companion.model-providers.deployments[0].endpoint=http://127.0.0.1:1/v1/chat/completions",
        "virtual-companion.model-providers.deployments[0].credential-secret=openai-key",
        "virtual-companion.model-providers.deployments[0].enabled=true"})
class ApprovedModelProviderConfigTest {

    private static final Path SECRET_ROOT =
            Path.of("target", "test-model-provider-secrets");

    static {
        try {
            Files.createDirectories(SECRET_ROOT);
            Files.writeString(SECRET_ROOT.resolve("openai-key"), "sk-live-token");
        } catch (IOException exception) {
            throw new ExceptionInInitializerError(exception);
        }
        System.setProperty("TEST_MODEL_SECRET_ROOT", SECRET_ROOT.toAbsolutePath().toString());
    }

    @Autowired
    private ApprovedModelProviders approvedModelProviders;

    @Autowired
    private LiveModelInvoker liveModelInvoker;

    @Autowired
    private DeterministicRouter deterministicRouter;

    @Autowired
    private QuotaLedger quotaLedger;

    @Test
    void wiresExactlyTheApprovedDeployment() {
        assertEquals(1, approvedModelProviders.registry().deployments().size());
        ProviderId providerId = new ProviderId("openai-approved");
        assertNotNull(approvedModelProviders.locator().adapterFor(providerId));
        assertEquals("OpenAI", approvedModelProviders.supplierNames().get(providerId));
        assertNotNull(liveModelInvoker);
        assertNotNull(deterministicRouter);
        assertNotNull(quotaLedger);
    }

    @Test
    void credentialNeverLeaksIntoBusinessTypes() {
        var adapter = approvedModelProviders.locator()
                .adapterFor(new ProviderId("openai-approved"));
        String representation = adapter.toString();
        assertFalse(representation.contains("sk-live-token"));
        assertFalse(representation.contains("Bearer"));
    }
}
