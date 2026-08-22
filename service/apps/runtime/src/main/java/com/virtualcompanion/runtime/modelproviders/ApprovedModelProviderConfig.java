package com.virtualcompanion.runtime.modelproviders;

import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationGuard;
import com.virtualcompanion.modelruntime.authorization.AuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.authorization.InMemoryAuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.modelruntime.routing.DeterministicRouter;
import com.virtualcompanion.modelruntime.routing.GenerationRecovery;
import com.virtualcompanion.modelruntime.registry.AuthorityGatedProviderRegistry;
import com.virtualcompanion.modelruntime.registry.ProviderRegistry;
import com.virtualcompanion.modelruntime.routing.QuotaLedger;
import com.virtualcompanion.platform.persistence.JdbcAuthorizationSnapshotStore;
import com.virtualcompanion.platform.persistence.JdbcProviderAdmissionAuthority;
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
 * <p>S0-25: the {@code ExecutionAuthorizationGuard} and the invoker's
 * execution-snapshot identity check read the DB-backed
 * {@code JdbcAuthorizationSnapshotStore} (when the auth datasource is wired) as
 * the pre-outbound authority, so a committed consent withdrawal stops every
 * queued task's next outbound on every instance; the in-memory store is only
 * the degenerate no-datasource fallback.</p>
 *
 * <p>S0-11-A: when the auth datasource is wired, {@link ApprovedModelProviders}
 * overlays {@code vc.provider_deployment} admission onto the config-wired
 * adapters. A config-enabled deployment that is missing, {@code DISABLED} or
 * {@code REJECTED} in the table is never eligible for outbound. Without a
 * datasource the process-local register-as-admitted path remains, matching
 * the no-DB test context.</p>
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
            java.util.List<String> approvedEgressHosts,
            org.springframework.beans.factory.ObjectProvider<JdbcProviderAdmissionAuthority>
                    admissionAuthority) {
        ApprovedModelProviders wired = ApprovedModelProviderProvisioner.provision(
                properties,
                providerSecretReader,
                com.virtualcompanion.modelruntime.port.ProviderEgressPolicy.defaultsPlus(
                        approvedEgressHosts));
        return new ApprovedModelProviders(
                durableAdmissionRegistry(
                        wired.registry(), admissionAuthority.getIfAvailable()),
                wired.locator(),
                wired.supplierNames());
    }

    /**
     * S0-11-A: the runtime registry overlays durable DB admission whenever the
     * auth datasource is wired. Config-enabled adapters remain in the locator;
     * they are not admitted unless {@code vc.provider_deployment} currently
     * reports {@code ADMITTED}. The in-memory registry is only the degenerate
     * no-datasource fallback.
     */
    static ProviderRegistry durableAdmissionRegistry(
            ProviderRegistry wired,
            JdbcProviderAdmissionAuthority dbAuthority) {
        return dbAuthority == null
                ? wired
                : new AuthorityGatedProviderRegistry(wired, dbAuthority);
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

    /**
     * S0-25: the pre-outbound snapshot authority is the DB-backed
     * {@link JdbcAuthorizationSnapshotStore} whenever the auth datasource is
     * wired — every {@code ExecutionAuthorizationGuard} decision and the
     * invoker's execution-snapshot identity check then re-read
     * {@code vc.authorization_snapshot}, so a committed consent withdrawal is
     * observed before the next outbound attempt on every instance. The
     * in-memory store remains only for the degenerate model-providers-enabled
     * runtime without a datasource, where no snapshots can be minted and every
     * external attempt already fails closed at the guard ("snapshot missing").
     *
     * @param dbAuthority the DB-backed authority, or {@code null} when the
     *                    auth datasource is not wired
     */
    static AuthorizationSnapshotStore preOutboundAuthority(
            JdbcAuthorizationSnapshotStore dbAuthority,
            InMemoryAuthorizationSnapshotStore processLocalFallback) {
        return dbAuthority != null ? dbAuthority : processLocalFallback;
    }

    @Bean
    ExecutionAuthorizationGuard executionAuthorizationGuard(
            InMemoryAuthorizationSnapshotStore authorizationSnapshotStore,
            org.springframework.beans.factory.ObjectProvider<JdbcAuthorizationSnapshotStore>
                    authorizationSnapshotAuthorityStore,
            ApprovedModelProviders approvedModelProviders) {
        return new ExecutionAuthorizationGuard(
                preOutboundAuthority(
                        authorizationSnapshotAuthorityStore.getIfAvailable(),
                        authorizationSnapshotStore),
                approvedModelProviders.registry());
    }

    @Bean
    DeterministicRouter deterministicRouter(
            ApprovedModelProviders approvedModelProviders,
            QuotaLedger quotaLedger,
            com.virtualcompanion.modelruntime.routing.RouteHealthPolicy routeHealthPolicy) {
        // ROUTE-HARDEN (§12.12 / §12.8): health-aware selection — the
        // conversation's sticky deployment is preferred while healthy, OPEN
        // supplier circuits are skipped (failover at the turn boundary), and
        // a cooled-down OPEN supplier is only probed when nothing is healthy.
        return new DeterministicRouter(
                approvedModelProviders.registry(), quotaLedger, routeHealthPolicy);
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
            org.springframework.beans.factory.ObjectProvider<JdbcAuthorizationSnapshotStore>
                    authorizationSnapshotAuthorityStore,
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
                // S0-25: the execution-snapshot identity check reads the same
                // DB-backed authority as the guard (in-memory only when no
                // datasource exists — see preOutboundAuthority).
                preOutboundAuthority(
                        authorizationSnapshotAuthorityStore.getIfAvailable(),
                        authorizationSnapshotStore),
                approvedModelProviders.locator(),
                generationRecovery,
                approvedModelProviders.supplierNames(),
                activeInvocationRegistry,
                new com.virtualcompanion.modelruntime.execution.BudgetGuard(reader, budgetMonthlyUsd));
    }
}
