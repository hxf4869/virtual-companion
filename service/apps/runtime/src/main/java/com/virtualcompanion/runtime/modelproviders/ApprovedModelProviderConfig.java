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
            ProviderSecretReader providerSecretReader,
            @org.springframework.beans.factory.annotation.Value(
                    "${VC_MODEL_EGRESS_ALLOWED_HOSTS:}")
            java.util.List<String> approvedEgressHosts) {
        return ApprovedModelProviderProvisioner.provision(properties, providerSecretReader,
            com.virtualcompanion.modelruntime.port.ProviderEgressPolicy.defaultsPlus(
                    approvedEgressHosts));
    }

    /**
     * Synthetic in-memory quota ledger for the deterministic router.
     *
     * <p>QUOTA-FIX (本机联调): the ledger must provision every real owner —
     * the router degrades to ZERO_LLM whenever {@code reserve} returns empty,
     * which is exactly what an unprovisioned owner yields. Owners are dynamic
     * (invite-registered users), so explicit provisioning at wiring time is
     * impossible; the ledger therefore carries a practically-unbounded default
     * allowance auto-provisioned at first reservation. This stays safe because
     * the ledger is purely synthetic (Technical Alpha): real spend is enforced
     * by the execution BudgetGuard over the persisted {@code vc.generation_usage}
     * (BUDGET-HALT §22.18), never by this in-memory simulation.
     */
    @Bean
    QuotaLedger quotaLedger() {
        return new QuotaLedger(UNLIMITED_SYNTHETIC_ALLOWANCE);
    }

    /** Practically-unbounded synthetic per-owner allowance (see {@link #quotaLedger()}). */
    private static final long UNLIMITED_SYNTHETIC_ALLOWANCE = Long.MAX_VALUE;

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
            ActiveInvocationRegistry activeInvocationRegistry,
            org.springframework.beans.factory.ObjectProvider<org.springframework.jdbc.core.JdbcTemplate> authJdbcTemplate,
            @org.springframework.beans.factory.annotation.Value("${virtual-companion.model-providers.budget-monthly-usd:0}")
            double budgetMonthlyUsd) {
        // BUDGET-HALT (§22.18): month-to-date settled cost from generation_usage;
        // a non-positive cap disables the guard (Technical Alpha default).
        com.virtualcompanion.modelruntime.execution.BudgetGuard.MonthSpendReader reader =
                () -> java.util.Optional.ofNullable(authJdbcTemplate.getIfAvailable())
                        .map(jdbc -> jdbc.queryForObject(
                                "SELECT COALESCE(sum(actual_cost), 0) FROM vc.generation_usage "
                                        + "WHERE created_at >= date_trunc('month', now())",
                                Double.class))
                        .orElse(0.0);
        return new LiveModelInvoker(
                deterministicRouter,
                executionAuthorizationGuard,
                authorizationSnapshotStore,
                approvedModelProviders.locator(),
                generationRecovery,
                approvedModelProviders.supplierNames(),
                activeInvocationRegistry,
                new com.virtualcompanion.modelruntime.execution.BudgetGuard(reader, budgetMonthlyUsd));
    }
}
