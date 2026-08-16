package com.virtualcompanion.runtime.modelproviders;

import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationGuard;
import com.virtualcompanion.modelruntime.authorization.InMemoryAuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.modelruntime.routing.DeterministicRouter;
import com.virtualcompanion.modelruntime.routing.GenerationRecovery;
import com.virtualcompanion.modelruntime.routing.QuotaLedger;
import java.nio.file.Path;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the approved live model provider runtime.
 *
 * <p>Active only when {@code virtual-companion.model-providers.enabled=true}.
 * With the switch off (the default) no live provider beans exist and every
 * external attempt fails closed at routing with no eligible deployment —
 * credentials are never read and no outbound surface is reachable.</p>
 *
 * <p>The secret reader resolves credentials through the approved channel
 * (Docker secret / secret file / injected environment variable) and never
 * holds them in a business type, log line or API response.</p>
 */
@Configuration
@ConditionalOnProperty(
        name = "virtual-companion.model-providers.enabled",
        havingValue = "true")
public class ApprovedModelProviderConfig {

    @Bean
    ProviderSecretReader providerSecretReader(ModelProviderProperties properties) {
        return new ProviderSecretReader(Path.of(properties.secretRoot()));
    }

    @Bean
    ApprovedModelProviders approvedModelProviders(
            ModelProviderProperties properties,
            ProviderSecretReader providerSecretReader) {
        return ApprovedModelProviderProvisioner.provision(properties, providerSecretReader);
    }

    @Bean
    QuotaLedger quotaLedger() {
        return new QuotaLedger();
    }

    @Bean
    InMemoryAuthorizationSnapshotStore authorizationSnapshotStore() {
        return new InMemoryAuthorizationSnapshotStore();
    }

    @Bean
    ExecutionAuthorizationGuard executionAuthorizationGuard(
            InMemoryAuthorizationSnapshotStore authorizationSnapshotStore,
            ApprovedModelProviders approvedModelProviders) {
        return new ExecutionAuthorizationGuard(
                authorizationSnapshotStore, approvedModelProviders.registry());
    }

    @Bean
    DeterministicRouter deterministicRouter(
            ApprovedModelProviders approvedModelProviders,
            QuotaLedger quotaLedger) {
        return new DeterministicRouter(approvedModelProviders.registry(), quotaLedger);
    }

    @Bean
    GenerationRecovery generationRecovery(QuotaLedger quotaLedger) {
        return new GenerationRecovery(quotaLedger);
    }

    /** CANCEL-A: process-local registry bridging the HTTP cancel path into in-flight sessions. */
    @Bean
    ActiveInvocationRegistry activeInvocationRegistry() {
        return new ActiveInvocationRegistry();
    }

    @Bean
    LiveModelInvoker liveModelInvoker(
            DeterministicRouter deterministicRouter,
            ExecutionAuthorizationGuard executionAuthorizationGuard,
            InMemoryAuthorizationSnapshotStore authorizationSnapshotStore,
            ApprovedModelProviders approvedModelProviders,
            GenerationRecovery generationRecovery,
            ActiveInvocationRegistry activeInvocationRegistry) {
        return new LiveModelInvoker(
                deterministicRouter,
                executionAuthorizationGuard,
                authorizationSnapshotStore,
                approvedModelProviders.locator(),
                generationRecovery,
                approvedModelProviders.supplierNames(),
                activeInvocationRegistry);
    }
}
