package com.virtualcompanion.runtime.auth.config;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.authorization.ProcessingPurpose;
import com.virtualcompanion.modelruntime.authorization.ProviderContractRef;
import com.virtualcompanion.modelruntime.authorization.ProviderRegion;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.platform.persistence.AdminConsoleService;
import com.virtualcompanion.platform.persistence.SurveyService;
import com.virtualcompanion.platform.persistence.AgeAppealService;
import com.virtualcompanion.platform.persistence.AgeVerificationService;
import com.virtualcompanion.platform.persistence.AuthorizationSnapshotProvider;
import com.virtualcompanion.platform.persistence.ChatWipeService;
import com.virtualcompanion.platform.persistence.ConversationCreateService;
import com.virtualcompanion.platform.persistence.ConversationListService;
import com.virtualcompanion.platform.persistence.ConversationRepository;
import com.virtualcompanion.platform.persistence.ConversationSummaryService;
import com.virtualcompanion.platform.persistence.ConsentService;
import com.virtualcompanion.platform.persistence.EmergencyContactService;
import com.virtualcompanion.platform.persistence.EntitlementSnapshotService;
import com.virtualcompanion.platform.persistence.InviteCodeService;
import com.virtualcompanion.platform.persistence.QuotaReconciliationService;
import com.virtualcompanion.platform.persistence.ReportService;
import com.virtualcompanion.platform.persistence.TrialService;
import com.virtualcompanion.platform.persistence.SafetyEventService;
import com.virtualcompanion.platform.persistence.ServiceWindowService;
import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.platform.persistence.GenerationCancelService;
import com.virtualcompanion.platform.persistence.GenerationFeedbackService;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationReceiveService;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.GenerationVersionService;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository;
import com.virtualcompanion.platform.persistence.IncognitoPrefService;
import com.virtualcompanion.platform.persistence.IdentityRefreshTokenRepository;
import com.virtualcompanion.platform.persistence.JdbcAuthorizationSnapshotProvider;
import com.virtualcompanion.platform.persistence.JdbcAuthorizationSnapshotStore;
import com.virtualcompanion.platform.persistence.JdbcProductQuotaBook;
import com.virtualcompanion.platform.persistence.JdbcProviderAdmissionAuthority;
import com.virtualcompanion.platform.persistence.JdbcProviderDeploymentRepository;
import com.virtualcompanion.platform.persistence.MemoryImportService;
import com.virtualcompanion.platform.persistence.MemoryService;
import com.virtualcompanion.platform.persistence.MessageHistoryService;
import com.virtualcompanion.platform.persistence.MessageRepository;
import com.virtualcompanion.platform.persistence.RealtimeEventRepository;
import com.virtualcompanion.platform.persistence.RealtimeResumeService;
import com.virtualcompanion.platform.persistence.RealtimeTicketRepository;
import com.virtualcompanion.platform.persistence.RelationshipService;
import com.virtualcompanion.platform.persistence.ReminderService;
import com.virtualcompanion.platform.persistence.UsageHealthService;
import com.virtualcompanion.platform.persistence.WorkItemClaimService;
import com.virtualcompanion.platform.persistence.WorkItemEnqueueService;
import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.application.AuthService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import com.virtualcompanion.runtime.auth.web.AuthController;
import com.virtualcompanion.runtime.age.AgeVerificationPort;
import com.virtualcompanion.runtime.age.SimulatedAgeVerifier;
import com.virtualcompanion.runtime.export.ExportObjectStorage;
import com.virtualcompanion.runtime.export.MinioExportObjectStorage;
import com.virtualcompanion.runtime.export.ExportExpiryScheduler;
import com.virtualcompanion.runtime.modelproviders.ApprovedModelProviders;
import com.virtualcompanion.runtime.realtime.LiveDeltaBroker;
import com.virtualcompanion.runtime.replica.RuntimeSingletonLease;
import com.virtualcompanion.runtime.replica.SingletonLeaseDataSource;
import com.virtualcompanion.runtime.worker.DataExportWorkItemHandler;
import com.virtualcompanion.runtime.worker.DispatchingWorkItemHandler;
import com.virtualcompanion.runtime.worker.GenerationWorkItemHandler;
import com.virtualcompanion.runtime.worker.LiveInvocationAssembler;
import com.virtualcompanion.runtime.worker.LoggingWorkItemHandler;
import com.virtualcompanion.runtime.worker.MemoryExtractWorkItemHandler;
import com.virtualcompanion.runtime.worker.WorkItemCoordinator;
import com.virtualcompanion.runtime.worker.GenerationReconcileScheduler;
import com.virtualcompanion.runtime.worker.WorkItemHandler;
import com.virtualcompanion.runtime.worker.WorkItemWorker;
import com.zaxxer.hikari.HikariDataSource;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.flyway.autoconfigure.FlywayConfigurationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Database wiring for the identity subsystem, active only when
 * {@code virtual-companion.auth.datasource-enabled=true} (a live PostgreSQL 18
 * running the V14 migration). The runtime DataSource reads injected credentials
 * (VC_DB_URL / VC_DB_USERNAME / VC_DB_PASSWORD) and fails fast when a required
 * value is missing; the identity repositories are bound to the V14 SECURITY
 * DEFINER functions. In-app Flyway (spring-boot-starter-flyway) runs the
 * db/migration scripts with an explicit migrator datasource (VC_MIGRATOR_DB_*)
 * fully separate from this runtime DataSource (P1-11), and a
 * {@link SchemaReadinessHealthIndicator} gates health on the applied schema.
 *
 * <p>Deliberately NOT component-scanned by the runtime's base package (it is a
 * runtime-local config), so the default context -- and the tests -- stay free
 * of any database requirement.
 */
@Configuration
@EnableScheduling
@ConditionalOnProperty(
        name = {"virtual-companion.auth.enabled", "virtual-companion.auth.datasource-enabled"},
        havingValue = "true")
public class AuthDataSourceConfig {

    /**
     * S0-33 / §12.7: the single-replica hard gate is enforced on every
     * connection of this DataSource. The returned
     * {@link SingletonLeaseDataSource} wraps the Hikari pool and requires a
     * PostgreSQL session-scoped advisory lock ({@code vc.runtime.singleton})
     * before any data-path connection is handed out; a second live runtime
     * instance sharing the deployment database is refused at startup (exit
     * code 87) and can never serve. The declared replica count is additionally
     * rejected by {@code SingleReplicaPreflightEnvironmentPostProcessor}.
     */
    @Bean
    public DataSource authDataSource(
            @Value("${virtual-companion.auth.datasource.url:}") String url,
            @Value("${virtual-companion.auth.datasource.username:}") String username,
            @Value("${virtual-companion.auth.datasource.password:}") String password) {
        if (url == null || url.isBlank()) {
            throw new IllegalStateException(
                    "virtual-companion.auth.datasource.url (VC_DB_URL) is required when the auth datasource is enabled");
        }
        if (username == null || username.isBlank() || password == null || password.isBlank()) {
            throw new IllegalStateException(
                    "VC_DB_USERNAME and VC_DB_PASSWORD are required for the runtime datasource");
        }
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl(url);
        dataSource.setUsername(username);
        dataSource.setPassword(password);
        dataSource.setMaximumPoolSize(5);
        RuntimeSingletonLease lease = new RuntimeSingletonLease(
                RuntimeSingletonLease.driverManagerConnector(url, username, password),
                RuntimeSingletonLease.defaultHalt(
                        org.slf4j.LoggerFactory.getLogger(RuntimeSingletonLease.class)),
                RuntimeSingletonLease.DEFAULT_WATCHDOG_INTERVAL_MILLIS);
        return new SingletonLeaseDataSource(dataSource, lease);
    }

    /**
     * P1-11 migrator/runtime separation guard. When in-app Flyway is enabled,
     * Boot 4.1.0 builds the Flyway connection from {@code spring.flyway.url /
     * user / password} (VC_MIGRATOR_DB_*) into its own SimpleDriverDataSource,
     * independent of the runtime {@code authDataSource}. This customizer bean
     * exists only in that case and fails fast with a precise message when a
     * migrator credential is missing, instead of letting Flyway fail later on
     * an empty URL. It is intentionally a no-op beyond validation.
     */
    @Bean
    @ConditionalOnProperty(name = "spring.flyway.enabled", havingValue = "true")
    public FlywayConfigurationCustomizer flywayMigratorCredentialsGuard(
            @Value("${spring.flyway.url:}") String url,
            @Value("${spring.flyway.user:}") String username,
            @Value("${spring.flyway.password:}") String password,
            @Value("${virtual-companion.auth.datasource.username:}") String runtimeUsername) {
        if (url == null || url.isBlank()) {
            throw new IllegalStateException(
                    "spring.flyway.url (VC_MIGRATOR_DB_URL) is required when in-app Flyway is enabled");
        }
        if (username == null || username.isBlank()) {
            throw new IllegalStateException(
                    "spring.flyway.user (VC_MIGRATOR_DB_USERNAME) is required when in-app Flyway is enabled");
        }
        if (password == null || password.isBlank()) {
            throw new IllegalStateException(
                    "spring.flyway.password (VC_MIGRATOR_DB_PASSWORD) is required when in-app Flyway is enabled");
        }
        if (runtimeUsername == null || runtimeUsername.isBlank()) {
            throw new IllegalStateException(
                    "virtual-companion.auth.datasource.username (VC_DB_USERNAME) is required");
        }
        if (username.equalsIgnoreCase(runtimeUsername)) {
            throw new IllegalStateException(
                    "migrator and runtime database principals must be different");
        }
        return configuration -> {
            // Validation is the point; the Flyway connection itself is built
            // by Boot from the spring.flyway.* properties.
        };
    }

    /**
     * TASK-0191: after Flyway applies the migrations (including the V27
     * owner-binding schema) and before the application serves traffic, the
     * migrator principal idempotently seeds/verifies the owner-binding secret
     * with bound JDBC parameters -- the key is never expanded into versioned
     * SQL. A missing, too-short or inconsistent {@code VC_OWNER_BINDING_SECRET}
     * fails startup here, ahead of any readiness signal.
     */
    @Bean
    @ConditionalOnProperty(name = "spring.flyway.enabled", havingValue = "true")
    public org.springframework.boot.flyway.autoconfigure.FlywayMigrationStrategy
            ownerBindingSecretBootstrapStrategy(
                    @Value("${spring.flyway.url:}") String url,
                    @Value("${spring.flyway.user:}") String username,
                    @Value("${spring.flyway.password:}") String password,
                    @Value("${virtual-companion.auth.owner-binding-secret:}") String secret) {
        DataSource migratorDataSource =
                new org.springframework.jdbc.datasource.DriverManagerDataSource(url, username, password);
        OwnerBindingSecretBootstrap bootstrap =
                new OwnerBindingSecretBootstrap(secret, migratorDataSource);
        return flyway -> {
            flyway.migrate();
            bootstrap.initializeAndVerify();
        };
    }

    /**
     * P1-11 schema readiness gate (see {@link SchemaReadinessHealthIndicator}).
     * Registered whenever the auth datasource is enabled; when in-app Flyway is
     * enabled the version check runs through the Flyway (migrator) connection,
     * otherwise the indicator runs in marker-only mode.
     */
    @Bean
    public SchemaReadinessHealthIndicator schemaReadinessHealthIndicator(
            JdbcTemplate authJdbcTemplate,
            ObjectProvider<Flyway> flyway) {
        Flyway flywayInstance = flyway.getIfAvailable();
        JdbcTemplate migratorJdbc = flywayInstance == null
                ? null
                : new JdbcTemplate(flywayInstance.getConfiguration().getDataSource());
        return new SchemaReadinessHealthIndicator(
                authJdbcTemplate,
                migratorJdbc,
                SchemaReadinessHealthIndicator.expectedSchemaVersionFromClasspath());
    }

    @Bean
    public JdbcTemplate authJdbcTemplate(DataSource authDataSource) {
        return new JdbcTemplate(authDataSource);
    }

    @Bean
    @ConditionalOnProperty(
            name = "virtual-companion.auth.enforce-db-least-privilege",
            havingValue = "true")
    public RuntimeDatabasePrivilegeGuard runtimeDatabasePrivilegeGuard(
            JdbcTemplate authJdbcTemplate) {
        return new RuntimeDatabasePrivilegeGuard(authJdbcTemplate);
    }

    @Bean
    public IdentityAccountRepository identityAccountRepository(JdbcTemplate authJdbcTemplate) {
        return new IdentityAccountRepository(authJdbcTemplate);
    }

    @Bean
    public IdentityRefreshTokenRepository identityRefreshTokenRepository(JdbcTemplate authJdbcTemplate) {
        return new IdentityRefreshTokenRepository(authJdbcTemplate);
    }

    @Bean
    public DataSourceTransactionManager authTransactionManager(DataSource authDataSource) {
        return new DataSourceTransactionManager(authDataSource);
    }

    @Bean
    public TransactionTemplate authTransactionTemplate(DataSourceTransactionManager authTransactionManager) {
        return new TransactionTemplate(authTransactionManager);
    }

    @Bean
    public OwnerContext ownerContext(
            JdbcTemplate authJdbcTemplate,
            TransactionTemplate authTransactionTemplate,
            @Value("${virtual-companion.auth.owner-binding-secret:}") String ownerBindingSecret) {
        return new OwnerContext(authJdbcTemplate, authTransactionTemplate, ownerBindingSecret);
    }

    @Bean
    public com.virtualcompanion.platform.persistence.SensitiveRouteAdmission sensitiveRouteAdmission(
            JdbcTemplate authJdbcTemplate) {
        return new com.virtualcompanion.platform.persistence.SensitiveRouteAdmission(authJdbcTemplate);
    }

    @Bean
    @ConditionalOnProperty(
            name = "virtual-companion.auth.shared-rate-enabled", havingValue = "true")
    public com.virtualcompanion.runtime.auth.application.SharedSourceAdmission
            sharedSourceAdmission(
                    JdbcTemplate authJdbcTemplate,
                    @Value("${virtual-companion.auth.shared-rate-secret:}") String secret) {
        return new com.virtualcompanion.runtime.auth.application.SharedSourceAdmission(
                authJdbcTemplate, secret);
    }

    @Bean
    public com.virtualcompanion.runtime.auth.jwt.AccessSnapshot.Authority accessSnapshotAuthority(
            IdentityAccountRepository identityAccountRepository) {
        return accountId -> identityAccountRepository.accessSnapshot(accountId)
                .map(snapshot -> new com.virtualcompanion.runtime.auth.jwt.AccessSnapshot(
                        snapshot.status(), snapshot.sessionEpoch(), snapshot.role(),
                        snapshot.passwordMustChange()));
    }

    @Bean
    public AuthService authService(
            IdentityAccountRepository identityAccountRepository,
            IdentityRefreshTokenRepository identityRefreshTokenRepository,
            PasswordEncoder passwordEncoder,
            JwtTokenService jwtTokenService,
            @Value("${virtual-companion.auth.refresh-token-ttl:7d}") Duration refreshTtl,
            AdminConsoleService adminConsoleService,
            EntitlementSnapshotService entitlementSnapshotService,
            InviteCodeService inviteCodeService,
            TrialService trialService,
            QuotaReconciliationService quotaReconciliationService,
            com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier,
            org.springframework.beans.factory.ObjectProvider<
                    com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry>
                    activeInvocations,
            org.springframework.beans.factory.ObjectProvider<
                    com.virtualcompanion.runtime.auth.application.AccountDeletionCoordinator>
                    deletionCoordinators) {
        return new AuthService(
                identityAccountRepository,
                identityRefreshTokenRepository,
                passwordEncoder,
                jwtTokenService,
                refreshTtl,
                adminConsoleService,
                entitlementSnapshotService,
                inviteCodeService,
                trialService,
                quotaReconciliationService,
                alertNotifier,
                activeInvocations, deletionCoordinators);
    }

    /** ADMIN-OPS (V36): minimal internal admin console reads. */
    @Bean
    public AdminConsoleService adminConsoleService(JdbcTemplate authJdbcTemplate) {
        return new AdminConsoleService(authJdbcTemplate);
    }

    /**
     * ADR-0006 §7.7 (DOGFOOD-08): shared current-password gate for the
     * high-risk self-service operations OUTSIDE the auth module (export
     * creation, consent withdrawal). Lives in the shared web module so the
     * export/consent slices never depend on the auth module (which would be a
     * Modulith cycle — auth already wires the export expiry scheduler).
     */
    @Bean
    public com.virtualcompanion.runtime.web.CurrentPasswordGuard currentPasswordGuard(
            IdentityAccountRepository identityAccountRepository,
            org.springframework.security.crypto.password.PasswordEncoder passwordEncoder) {
        return new com.virtualcompanion.runtime.web.CurrentPasswordGuard(
                identityAccountRepository, passwordEncoder);
    }

    @Bean
    public AuthController authController(
            AuthService authService,
            AuthAbuseGuard authAbuseGuard,
            com.virtualcompanion.runtime.observability.AlertProperties alertProperties,
            com.virtualcompanion.platform.persistence.OpsCase opsCase) {
        return new AuthController(authService, authAbuseGuard, alertProperties, opsCase);
    }

    @Bean
    public com.virtualcompanion.platform.persistence.OpsCase opsCase(JdbcTemplate authJdbcTemplate) {
        return new com.virtualcompanion.platform.persistence.OpsCase(authJdbcTemplate);
    }

    @Bean
    public com.virtualcompanion.platform.persistence.AccountDeletionIntentService
            accountDeletionIntentService(JdbcTemplate authJdbcTemplate) {
        return new com.virtualcompanion.platform.persistence.AccountDeletionIntentService(
                authJdbcTemplate);
    }

    @Bean
    public com.virtualcompanion.platform.persistence.RetentionLegalHoldService
            retentionLegalHoldService(JdbcTemplate authJdbcTemplate) {
        return new com.virtualcompanion.platform.persistence.RetentionLegalHoldService(
                authJdbcTemplate);
    }

    @Bean
    public com.virtualcompanion.runtime.auth.application.AccountDeletionCoordinator
            accountDeletionCoordinator(
                    OwnerContext ownerContext,
                    com.virtualcompanion.platform.persistence.AccountDeletionIntentService intents,
                    org.springframework.beans.factory.ObjectProvider<
                            com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry>
                            activeInvocations,
                    org.springframework.beans.factory.ObjectProvider<ExportObjectStorage>
                            exportObjectStorage,
                    org.springframework.beans.factory.ObjectProvider<
                            com.virtualcompanion.platform.persistence.ExportService>
                            exportService,
                    com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier) {
        return new com.virtualcompanion.runtime.auth.application.AccountDeletionCoordinator(
                ownerContext,
                intents,
                activeInvocations,
                // DOGFOOD-STABILIZATION audit: remove the owner's export
                // bucket objects BEFORE the account cascade destroys the
                // pointers; a deletion failure aborts the account deletion.
                exportObjectStorage,
                exportService,
                alertNotifier);
    }

    @Bean
    public com.virtualcompanion.runtime.auth.application.AccountDeletionCancellationPoller
            accountDeletionCancellationPoller(
                    com.virtualcompanion.platform.persistence.AccountDeletionIntentService intents,
                    org.springframework.beans.factory.ObjectProvider<
                            com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry>
                            activeInvocations,
                    OwnerContext ownerContext) {
        return new com.virtualcompanion.runtime.auth.application.AccountDeletionCancellationPoller(
                intents, activeInvocations, ownerContext);
    }

    @Bean
    public AdminSeedRunner adminSeedRunner(
            AuthService authService,
            @Value("${virtual-companion.auth.admin-seed.username:}") String username,
            @Value("${virtual-companion.auth.admin-seed.password:}") String password,
            @Value("${virtual-companion.auth.admin-seed.display-name:}") String displayName) {
        return new AdminSeedRunner(authService, username, password, displayName);
    }

    /**
     * P2-03 audit retention (Owner 2026-08-12: 180-day retention with an
     * automated purge). The scheduler calls the V22
     * {@code vc.identity_auth_event_purge} SECURITY DEFINER function daily to
     * delete {@code identity_auth_event} rows older than the configured window.
     * {@link EnableScheduling} above activates Spring's scheduler only while
     * this conditional configuration (auth + datasource enabled) is live, so
     * no purge runs without a real database.
     */
    @Bean
    public IdentityAuthEventPurgeScheduler identityAuthEventPurgeScheduler(
            JdbcTemplate authJdbcTemplate,
            @Value("${virtual-companion.auth.audit-retention-days:180}") int retentionDays,
            com.virtualcompanion.platform.persistence.JobLease jobLease,
            com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier) {
        return new IdentityAuthEventPurgeScheduler(
                authJdbcTemplate, retentionDays, jobLease, alertNotifier);
    }

    /**
     * RETENTION (§16.7 / R48): categorized purge driven by the versioned
     * {@code vc.data_retention_policy} (V70). Opt-in via
     * {@code virtual-companion.retention.enabled=true} — the seeded v1 periods
     * are a DRAFT pending Owner/legal review, so no deployment purges user
     * data before that review lands. Same scheduling lifecycle as the audit
     * purge above (EnableScheduling + live datasource only).
     */
    @Bean
    @org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
            name = "virtual-companion.retention.enabled", havingValue = "true")
    public com.virtualcompanion.runtime.retention.RetentionPurgeScheduler retentionPurgeScheduler(
            JdbcTemplate authJdbcTemplate,
            com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier,
            com.virtualcompanion.platform.persistence.JobLease jobLease,
            @Value("${virtual-companion.retention.dry-run:true}") boolean dryRun) {
        return new com.virtualcompanion.runtime.retention.RetentionPurgeScheduler(
                authJdbcTemplate, alertNotifier, jobLease, dryRun);
    }

    /**
     * METRICS-ALERT (§26.6): periodic {@code vc_beta_dau} gauge refresh from
     * the V77 job SD — an aggregate count only (no owner identity, no
     * content), so it runs with the live datasource like the other jobs.
     */
    @Bean
    public com.virtualcompanion.runtime.observability.DauMetricsScheduler dauMetricsScheduler(
            JdbcTemplate authJdbcTemplate,
            com.virtualcompanion.runtime.observability.VcMetrics metrics,
            com.virtualcompanion.runtime.servicemode.BetaServiceWindow betaServiceWindow,
            com.virtualcompanion.platform.persistence.JobLease jobLease,
            com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier) {
        return new com.virtualcompanion.runtime.observability.DauMetricsScheduler(
                authJdbcTemplate, metrics, betaServiceWindow, jobLease, alertNotifier);
    }

    @Bean
    public com.virtualcompanion.platform.persistence.JobLease jobLease(
            JdbcTemplate authJdbcTemplate) {
        return new com.virtualcompanion.platform.persistence.JobLease(authJdbcTemplate);
    }

    @Bean
    public com.virtualcompanion.runtime.observability.JobHealthMonitor jobHealthMonitor(
            com.virtualcompanion.platform.persistence.JobLease jobLease,
            com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier,
            @Value("${virtual-companion.retention.enabled:false}") boolean retentionEnabled,
            @Value("${virtual-companion.jobs.dau-stale-seconds:300}") long dauStaleSeconds,
            @Value("${virtual-companion.jobs.export-stale-seconds:300}") long exportStaleSeconds,
            @Value("${virtual-companion.jobs.auth-purge-stale-seconds:93600}")
                    long authPurgeStaleSeconds,
            @Value("${virtual-companion.jobs.retention-stale-seconds:93600}")
                    long retentionStaleSeconds) {
        return new com.virtualcompanion.runtime.observability.JobHealthMonitor(
                jobLease, alertNotifier, retentionEnabled, dauStaleSeconds, exportStaleSeconds,
                authPurgeStaleSeconds, retentionStaleSeconds);
    }

    @Bean
    public com.virtualcompanion.platform.persistence.AlertWebhookOutbox alertWebhookOutbox(
            JdbcTemplate authJdbcTemplate) {
        return new com.virtualcompanion.platform.persistence.AlertWebhookOutbox(authJdbcTemplate);
    }

    @Bean
    public com.virtualcompanion.platform.persistence.ProviderRollbackService providerRollbackService(
            JdbcTemplate authJdbcTemplate) {
        return new com.virtualcompanion.platform.persistence.ProviderRollbackService(authJdbcTemplate);
    }

    @Bean
    @org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
            name = "virtual-companion.model-providers.enabled", havingValue = "true")
    public com.virtualcompanion.runtime.observability.DurableProviderRollbackListener
            durableProviderRollbackListener(
                    com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker circuitBreaker,
                    com.virtualcompanion.runtime.modelproviders.ApprovedModelProviders providers,
                    com.virtualcompanion.platform.persistence.ProviderRollbackService rollbackService,
                    com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier) {
        return new com.virtualcompanion.runtime.observability.DurableProviderRollbackListener(
                circuitBreaker, providers, rollbackService, alertNotifier);
    }

    /**
     * DOGFOOD-05 (ADR-0006 §3.4): the FINAL-output R4 safety-leak path to the
     * same durable rollback seam. Wired only while live providers are on; the
     * generation handler treats it as optional (no-database tests run null).
     */
    @Bean
    @org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
            name = "virtual-companion.model-providers.enabled", havingValue = "true")
    public com.virtualcompanion.runtime.observability.SafetyLeakProviderDisabler
            safetyLeakProviderDisabler(
                    com.virtualcompanion.platform.persistence.ProviderRollbackService rollbackService,
                    com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier,
                    com.virtualcompanion.modelruntime.registry.LocalDeploymentIsolation
                            localDeploymentIsolation) {
        return new com.virtualcompanion.runtime.observability.SafetyLeakProviderDisabler(
                rollbackService, alertNotifier, localDeploymentIsolation);
    }

    @Bean
    public com.virtualcompanion.runtime.observability.AlertWebhookDispatcher alertWebhookDispatcher(
            com.virtualcompanion.platform.persistence.AlertWebhookOutbox alertWebhookOutbox,
            com.virtualcompanion.runtime.observability.WebhookDelivery webhookDelivery,
            com.virtualcompanion.runtime.observability.FallbackWebhookDelivery fallbackWebhookDelivery,
            com.virtualcompanion.runtime.observability.AlertProperties alertProperties,
            com.virtualcompanion.runtime.observability.VcMetrics metrics) {
        return new com.virtualcompanion.runtime.observability.AlertWebhookDispatcher(
                alertWebhookOutbox, webhookDelivery, fallbackWebhookDelivery, alertProperties, metrics);
    }

    /**
     * CRYPTO-REST one-shot backfill: opt-in via
     * {@code virtual-companion.crypto.backfill-enabled=true} for exactly one
     * boot after enabling at-rest encryption; idempotent, so an accidental
     * second boot is a no-op scan.
     */
    @Bean
    @org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
            name = "virtual-companion.crypto.backfill-enabled", havingValue = "true")
    public com.virtualcompanion.runtime.crypto.DataCryptoBackfillRunner dataCryptoBackfillRunner(
            JdbcTemplate authJdbcTemplate,
            com.virtualcompanion.platform.persistence.RestFieldCipher restFieldCipher) {
        return new com.virtualcompanion.runtime.crypto.DataCryptoBackfillRunner(
                authJdbcTemplate, restFieldCipher);
    }

    /** Fail closed when stale effective summaries exist but backfill is disabled. */
    @Bean
    @org.springframework.context.annotation.Profile("production")
    @org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
            name = "virtual-companion.crypto.backfill-enabled",
            havingValue = "false",
            matchIfMissing = true)
    public com.virtualcompanion.runtime.crypto.ConversationSummaryCipherReadiness
            conversationSummaryCipherReadiness(
                    JdbcTemplate authJdbcTemplate,
                    com.virtualcompanion.platform.persistence.RestFieldCipher restFieldCipher) {
        return new com.virtualcompanion.runtime.crypto.ConversationSummaryCipherReadiness(
                authJdbcTemplate, restFieldCipher);
    }

    /**
     * P1-04 worker execution half (Owner 2026-08-12: server-side asOwner
     * injection, runtime in-process). Wires the claim family of SECURITY
     * DEFINER functions (V5/V17/V23) plus the worker batch primitive; the
     * worker reuses this authDataSource connection pool (V23 grants vc_api
     * EXECUTE). No polling: coordinator (OWNER_GATE) decides which owner
     * queue to process and issues fences.
     */
    @Bean
    public WorkItemClaimService workItemClaimService(JdbcTemplate authJdbcTemplate) {
        return new WorkItemClaimService(authJdbcTemplate);
    }

    /**
     * TASK-0174: generation HTTP vertical slice persistence services (V25 intake
     * primitives + existing receive/repository). All bound to the auth
     * datasource's vc_api JDBC pool and run inside the server-trusted owner
     * context established upstream.
     */

    /** B1-SURVEY (§26.5 / R45): daily 被理解感 score capture. */
    @Bean
    public SurveyService surveyService(JdbcTemplate authJdbcTemplate) {
        return new SurveyService(authJdbcTemplate);
    }

    /** CRYPTO-REST (§16.5/§17.4): at-rest cipher for chat bodies. The dev
     * default key keeps local development and CI friction-free; production
     * rejects it (fail-closed) and must inject VC_CRYPTO_REST_KEY. */
    @Bean
    public com.virtualcompanion.platform.persistence.RestFieldCipher restFieldCipher(
            @org.springframework.beans.factory.annotation.Value(
                    "${virtual-companion.crypto.rest-key}") String restKey,
            @org.springframework.beans.factory.annotation.Value(
                    "${virtual-companion.crypto.rest-key-id:default}") String restKeyId,
            @org.springframework.beans.factory.annotation.Value(
                    "${virtual-companion.crypto.rest-key-version:1}") int restKeyVersion,
            @org.springframework.beans.factory.annotation.Value(
                    "${virtual-companion.crypto.previous-rest-key:}") String previousRestKey,
            @org.springframework.beans.factory.annotation.Value(
                    "${virtual-companion.crypto.previous-rest-key-id:}") String previousRestKeyId,
            @org.springframework.beans.factory.annotation.Value(
                    "${virtual-companion.crypto.previous-rest-key-version:0}") int previousRestKeyVersion) {
        return new com.virtualcompanion.platform.persistence.RestFieldCipher(
                restKeyId,
                restKeyVersion,
                restKey,
                previousRestKeyId,
                previousRestKeyVersion,
                previousRestKey);
    }

    @Bean
    public GenerationReceiveService generationReceiveService(
            JdbcTemplate authJdbcTemplate,
            com.virtualcompanion.platform.persistence.RestFieldCipher restFieldCipher) {
        return new GenerationReceiveService(authJdbcTemplate, restFieldCipher);
    }

    /** FEEDBACK (V35): owner-scoped generation feedback recording. */
    @Bean
    public GenerationFeedbackService generationFeedbackService(JdbcTemplate authJdbcTemplate) {
        return new GenerationFeedbackService(authJdbcTemplate);
    }

    /** REMINDER (V39): structured user-created reminders (FR-NOTIFY-001). */
    @Bean
    public ReminderService reminderService(JdbcTemplate authJdbcTemplate) {
        return new ReminderService(authJdbcTemplate);
    }

    /** CONSENT (V41): versioned user consent records (FR-AUTH-003). */
    @Bean
    public ConsentService consentService(JdbcTemplate authJdbcTemplate) {
        return new ConsentService(authJdbcTemplate);
    }

    /** EMERGENCY-CONTACT (V65): the §20.14 emergency contact lifecycle. */
    @Bean
    public EmergencyContactService emergencyContactService(JdbcTemplate authJdbcTemplate) {
        return new EmergencyContactService(authJdbcTemplate);
    }

    /**
     * DATA-EXPORT (V42): asynchronous user data export (FR-DATA-002). The
     * sealed document encrypts at rest with the CRYPTO-REST cipher; with the
     * V76 hashed download token, a table reader now holds neither the
     * document nor a working download secret.
     */
    @Bean
    public ExportService exportService(
            JdbcTemplate authJdbcTemplate,
            com.virtualcompanion.platform.persistence.RestFieldCipher restFieldCipher) {
        return new ExportService(authJdbcTemplate, restFieldCipher);
    }

    /**
     * DOGFOOD-02 (ADR-0006 §7.3): local MinIO object-storage consumer for
     * data exports. Opt-in — the bean exists only while
     * {@code virtual-companion.data-export.object-storage.enabled=true}.
     * Fail-closed like {@code ProductionFailClosed}: with the switch on,
     * every setting (endpoint/access key/secret key/bucket) must be present
     * and the bucket must already exist (provisioned by the compose
     * {@code minio-init} service), otherwise startup refuses. Credentials
     * come from deployment env only and are never logged.
     */
    @Bean
    @org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
            name = "virtual-companion.data-export.object-storage.enabled",
            havingValue = "true")
    public ExportObjectStorage exportObjectStorage(
            @Value("${virtual-companion.data-export.object-storage.endpoint:}")
                    String endpoint,
            @Value("${virtual-companion.data-export.object-storage.access-key:}")
                    String accessKey,
            @Value("${virtual-companion.data-export.object-storage.secret-key:}")
                    String secretKey,
            @Value("${virtual-companion.data-export.object-storage.bucket:}")
                    String bucket) {
        if (endpoint == null || endpoint.isBlank()
                || accessKey == null || accessKey.isBlank()
                || secretKey == null || secretKey.isBlank()
                || bucket == null || bucket.isBlank()) {
            throw new IllegalStateException(
                    "data-export object-storage is enabled but endpoint/access-key/secret-key/"
                            + "bucket are not fully configured (VC_EXPORT_S3_*): refusing to "
                            + "start");
        }
        return new MinioExportObjectStorage(endpoint, accessKey, secretKey, bucket);
    }

    /** AGE-MIN (V45): adult-verification result persistence (FR-AUTH-002). */
    @Bean
    public AgeVerificationService ageVerificationService(JdbcTemplate authJdbcTemplate) {
        return new AgeVerificationService(authJdbcTemplate);
    }

    /** AGE-APPEAL (V56): age-appeal intake persistence (FR-AUTH-002 申诉入口). */
    @Bean
    public AgeAppealService ageAppealService(JdbcTemplate authJdbcTemplate) {
        return new AgeAppealService(authJdbcTemplate);
    }

    /** REPORT-BE (V56): report/complaint intake persistence (FR-DATA-001, §20.15). */
    @Bean
    public ReportService reportService(JdbcTemplate authJdbcTemplate) {
        return new ReportService(authJdbcTemplate);
    }

    /** CHAT-WIPE (V57): account-wide chat wipe (FR-DATA-003 全部聊天删除). */
    @Bean
    public ChatWipeService chatWipeService(JdbcTemplate authJdbcTemplate) {
        return new ChatWipeService(authJdbcTemplate);
    }

    /** SAFETY-WIRE (V58): minimal safety-event persistence (§20.10/§20.11). */
    @Bean
    public SafetyEventService safetyEventService(JdbcTemplate authJdbcTemplate) {
        return new SafetyEventService(authJdbcTemplate);
    }

    /** INVITE (V60): single-use invite-code provisioning (§7.4). */
    @Bean
    public InviteCodeService inviteCodeService(JdbcTemplate authJdbcTemplate) {
        return new InviteCodeService(authJdbcTemplate);
    }

    /** SVC-WINDOW (V60): DAU + owner-active state over vc.generation (§24.7). */
    @Bean
    public ServiceWindowService serviceWindowService(JdbcTemplate authJdbcTemplate) {
        return new ServiceWindowService(authJdbcTemplate);
    }

    /**
     * SVC-WINDOW: the pure window policy. Disabled by default so local
     * development and CI never hit the gate; the Beta deployment turns it on
     * (defaults mirror §24.7: generative chat 10:00–22:00 Asia/Shanghai).
     */
    @Bean
    public com.virtualcompanion.runtime.servicemode.BetaServiceWindow betaServiceWindow(
            @Value("${virtual-companion.beta.service-window.enabled:false}") boolean enabled,
            @Value("${virtual-companion.beta.service-window.paused:false}") boolean paused,
            @Value("${virtual-companion.beta.service-window.window-from:10:00}") String windowFrom,
            @Value("${virtual-companion.beta.service-window.window-until:22:00}") String windowUntil,
            @Value("${virtual-companion.beta.service-window.max-daily-active-users:10}")
                    int maxDailyActiveUsers,
            @Value("${virtual-companion.beta.service-window.zone:Asia/Shanghai}") String zone) {
        return new com.virtualcompanion.runtime.servicemode.BetaServiceWindow(
                enabled, paused, windowFrom, windowUntil, maxDailyActiveUsers, zone);
    }

    /**
     * S0-04: server generation admission. Required consents stay empty until
     * product/legal confirm the set; adult/consent enforcement follows the
     * Beta window or an explicit flag. The durable release gate and read
     * failures always fail closed.
     */
    @Bean
    public com.virtualcompanion.platform.persistence.ReleaseGate releaseGate(
            JdbcTemplate authJdbcTemplate) {
        return new com.virtualcompanion.platform.persistence.ReleaseGate(authJdbcTemplate);
    }

    @Bean
    public com.virtualcompanion.runtime.admission.GenerationAdmission generationAdmission(
            IdentityAccountRepository identityAccountRepository,
            AgeVerificationService ageVerificationService,
            ConsentService consentService,
            com.virtualcompanion.runtime.servicemode.BetaServiceWindow betaServiceWindow,
            ServiceWindowService serviceWindowService,
            com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier,
            @Value("${virtual-companion.beta.generation-enabled:false}") boolean betaGenerationEnabled,
            @Value("${virtual-companion.admission.enforce:false}") boolean enforce,
            @Value("${virtual-companion.admission.required-consent-types:}")
                    java.util.List<String> requiredConsentTypes,
            com.virtualcompanion.platform.persistence.ReleaseGate releaseGate,
            com.virtualcompanion.platform.persistence.AccountDeletionIntentService deletionIntents) {
        return new com.virtualcompanion.runtime.admission.GenerationAdmissionService(
                identityAccountRepository,
                ageVerificationService,
                consentService,
                betaServiceWindow,
                serviceWindowService,
                alertNotifier,
                betaGenerationEnabled,
                enforce,
                requiredConsentTypes,
                releaseGate,
                deletionIntents);
    }

    /** EMBED-RECALL (V62): deterministic embedder — the local recall floor. */
    /**
     * S0-09: EmbeddingPort is always validated (dimension/finite/space).
     * Real provider embeddings stay default-off.
     */
    @Bean
    public com.virtualcompanion.runtime.memory.EmbeddingPort embeddingPort(
            com.virtualcompanion.platform.persistence.ConsentService consentService,
            com.virtualcompanion.platform.persistence.AccountDeletionIntentService deletionIntents,
            @Value("${virtual-companion.embedding.enabled:false}") boolean enabled,
            @Value("${virtual-companion.embedding.base-url:}") String baseUrl,
            @Value("${virtual-companion.embedding.model:}") String model,
            @Value("${virtual-companion.embedding.model-version:}") String modelVersion,
            @Value("${virtual-companion.embedding.dimension:64}") int dimension,
            @Value("${virtual-companion.embedding.space-id:}") String spaceId,
            @Value("${virtual-companion.embedding.api-key:}") String apiKey) {
        com.virtualcompanion.runtime.memory.EmbeddingPort selected;
        if (!enabled) {
            selected = new com.virtualcompanion.runtime.memory.DeterministicEmbedder();
        } else {
            if (baseUrl == null || baseUrl.isBlank()
                    || model == null || model.isBlank()
                    || modelVersion == null || modelVersion.isBlank()
                    || spaceId == null || spaceId.isBlank()
                    || apiKey == null || apiKey.isBlank()) {
                throw new IllegalStateException(
                        "embedding.enabled=true requires base-url, model, model-version, space-id and api-key");
            }
            var client = new com.virtualcompanion.runtime.memory.OpenAiCompatEmbedder(
                    baseUrl, model, apiKey);
            selected = new com.virtualcompanion.runtime.memory.ConsentGatedEmbeddingPort(
                    new com.virtualcompanion.runtime.memory.OpenAiCompatEmbeddingPort(
                            client, model, modelVersion, dimension, spaceId),
                    consentService, deletionIntents);
        }
        return new com.virtualcompanion.runtime.memory.ValidatingEmbeddingPort(selected);
    }

    @Bean
    public com.virtualcompanion.platform.persistence.EmbeddingReembedService embeddingReembedService(
            JdbcTemplate authJdbcTemplate) {
        return new com.virtualcompanion.platform.persistence.EmbeddingReembedService(authJdbcTemplate);
    }

    @Bean
    @org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
            name = {"virtual-companion.embedding.enabled",
                    "virtual-companion.embedding.reembed-enabled"},
            havingValue = "true")
    public com.virtualcompanion.runtime.memory.EmbeddingReembedScheduler embeddingReembedScheduler(
            com.virtualcompanion.platform.persistence.EmbeddingReembedService reembedService,
            com.virtualcompanion.runtime.memory.EmbeddingPort embeddingPort,
            com.virtualcompanion.platform.persistence.RestFieldCipher restFieldCipher,
            @Value("${virtual-companion.embedding.source-space-id:alpha-hash-64}") String sourceSpaceId,
            @Value("${virtual-companion.embedding.reembed-batch-size:16}") int batchSize) {
        return new com.virtualcompanion.runtime.memory.EmbeddingReembedScheduler(
                reembedService, embeddingPort, restFieldCipher, sourceSpaceId, batchSize);
    }

    /** ENT-TRIAL (V61): simulated trial grants (FR-ENT-005). */
    @Bean
    public TrialService trialService(JdbcTemplate authJdbcTemplate) {
        return new TrialService(authJdbcTemplate);
    }

    /** QUOTA-PERSIST (V61): ledger reconciliation + persisted registry reads. */
    @Bean
    public QuotaReconciliationService quotaReconciliationService(JdbcTemplate authJdbcTemplate) {
        return new QuotaReconciliationService(authJdbcTemplate);
    }

    /** CONV-SUMMARY (V63): L2 conversation summaries (§11.18). */
    @Bean
    public ConversationSummaryService conversationSummaryService(
            JdbcTemplate authJdbcTemplate,
            com.virtualcompanion.platform.persistence.RestFieldCipher restFieldCipher) {
        return new ConversationSummaryService(authJdbcTemplate, restFieldCipher);
    }

    /**
     * S0-07: CompositeSafetyClassifier — deterministic hard rules first.
     * Real moderation stays default-off; when enabled the provider can only
     * raise risk and any transport/schema failure blocks.
     *
     * <p>DOGFOOD-04 (ADR-0006 §5.2): {@code virtual-companion.moderation.mode}
     * selects the remote family while both share the same base-url semantics
     * (OpenAI-compatible root such as {@code .../v1}):
     * {@code openai-moderations} → {@code POST {base-url}/moderations}
     * (default, unchanged); {@code chat-completions} → strict JSON
     * classification via {@code POST {base-url}/chat/completions} for
     * channels without a /moderations endpoint. The actual endpoint and
     * credential are deployment-injected only. {@code @Primary} keeps every
     * by-type consumer (e.g. the input-side controller) on this composite
     * once the incremental-only bean below also exists. The remote leg is
     * wrapped in {@code OwnerGatedSafetyClassifier} (ADR-0006 §4) and only
     * ever sees locally clean input (hard rules first, zero remote calls on
     * any local block).
     */
    @Bean
    @org.springframework.context.annotation.Primary
    public com.virtualcompanion.safety.SafetyClassifierPort safetyClassifierPort(
            ConsentService consentService,
            com.virtualcompanion.platform.persistence.AccountDeletionIntentService deletionIntents,
            com.virtualcompanion.platform.persistence.JdbcProviderDeploymentRepository
                    providerDeployments,
            OwnerContext ownerContext,
            DataSourceTransactionManager authTransactionManager,
            @Value("${virtual-companion.moderation.enabled:false}") boolean moderationEnabled,
            @Value("${virtual-companion.moderation.mode:chat-completions}") String moderationMode,
            @Value("${virtual-companion.moderation.base-url:}") String moderationBaseUrl,
            @Value("${virtual-companion.moderation.model:omni-moderation-latest}") String moderationModel,
            @Value("${virtual-companion.moderation.provider-ref:}") String moderationProviderRef,
            @Value("${virtual-companion.moderation.model-version:}") String moderationModelVersion,
            @Value("${virtual-companion.moderation.api-key:}") String moderationApiKey,
            @Value("${virtual-companion.moderation.provider-terms-verified:false}")
                    boolean moderationProviderTermsVerified,
            @Value("${virtual-companion.moderation.allowed-hosts:}")
                    java.util.List<String> moderationAllowedHosts) {
        com.virtualcompanion.safety.SafetyClassifierPort hard =
                new com.virtualcompanion.safety.DeterministicSafetyClassifier();
        if (!moderationEnabled) {
            return new com.virtualcompanion.safety.CompositeSafetyClassifier(hard);
        }
        if (moderationBaseUrl == null || moderationBaseUrl.isBlank()
                || moderationModel == null || moderationModel.isBlank()
                || moderationProviderRef == null || moderationProviderRef.isBlank()
                || moderationModelVersion == null || moderationModelVersion.isBlank()
                || moderationApiKey == null || moderationApiKey.isBlank()) {
            throw new IllegalStateException(
                    "moderation.enabled=true requires base-url, model, provider-ref, model-version and api-key (fail-closed)");
        }
        var egressPolicy = com.virtualcompanion.modelruntime.port.ProviderEgressPolicy
                .defaultsPlus(moderationAllowedHosts);
        com.virtualcompanion.runtime.safety.ProviderModerationClassifier provider;
        if ("chat-completions".equals(moderationMode)) {
            provider = new com.virtualcompanion.runtime.safety.ProviderModerationClassifier(
                    new com.virtualcompanion.runtime.safety.ChatCompletionsSafetyClient(
                            moderationBaseUrl, moderationModel, moderationApiKey,
                            moderationProviderRef, moderationModelVersion,
                            egressPolicy,
                            com.virtualcompanion.modelruntime.port.EgressDnsGuard.defaults()));
        } else if ("openai-moderations".equals(moderationMode)) {
            // DOGFOOD-STABILIZATION-02 audit: this branch's client does not
            // yet carry the egress allowlist / DNS-rebinding guard / bounded
            // response body that chat-completions enforces, so the reachable
            // configuration is refused this round instead of shipping an
            // unprotected default path. Re-enable only together with equal
            // protections in OpenAiCompatModerationClient.
            throw new IllegalStateException(
                    "moderation.mode=openai-moderations is disabled this round (no egress/"
                            + "DNS/response-size protections); use chat-completions "
                            + "(VC_MODERATION_MODE=chat-completions)");
        } else {
            throw new IllegalStateException(
                    "moderation.mode must be openai-moderations or chat-completions (fail-closed)");
        }
        // DOGFOOD-STABILIZATION audit (ADR-0006 §4/§5): the remote leg is
        // owner-gated per call — deletion intent, the fixed five-type
        // necessary-consent set, current provider admission and (until the
        // provider terms are verified) the local sensitive-data detector must
        // all pass before any HTTP leaves the host; every deny or read failure
        // fails closed with zero remote calls. DOGFOOD-STABILIZATION-02: the
        // probe phase runs inside one short owner-bound transaction
        // (OwnerContext::asOwner) because the worker's FINAL classification
        // executes outside any owner transaction; the HTTP phase itself stays
        // DB-free.
        com.virtualcompanion.runtime.safety.OwnerGatedSafetyClassifier gated =
                new com.virtualcompanion.runtime.safety.OwnerGatedSafetyClassifier(
                        provider,
                        (ownerUserId, consentType) -> consentService
                                .findLatestByType(ownerUserId, consentType)
                                .map(com.virtualcompanion.platform.persistence.ConsentRecord::granted)
                                .orElse(false),
                        deletionIntents::activeCurrent,
                        providerRef -> providerDeployments.findByProviderId(providerRef)
                                .map(com.virtualcompanion.platform.persistence
                                        .ProviderDeploymentRecord::isAdmitted)
                                .orElse(false),
                        moderationProviderRef,
                        moderationProviderTermsVerified,
                        new com.virtualcompanion.runtime.safety.OwnerBoundTransactionalExecutor(
                                ownerContext::asOwner,
                                ownerContext::asOwnerRequiresNew,
                                authTransactionManager));
        return new com.virtualcompanion.safety.CompositeSafetyClassifier(hard, gated);
    }

    /**
     * DOGFOOD-04 (ADR-0006 §5.1/§5.3): the streaming incremental review is
     * ALWAYS the local deterministic classifier — never the composite — so
     * enabling remote moderation can never add per-fragment remote calls.
     * Remote classification stays bounded to one INPUT and one FINAL call
     * per turn through the primary composite above.
     */
    @Bean
    public com.virtualcompanion.safety.SafetyClassifierPort safetyIncrementalClassifier() {
        return new com.virtualcompanion.safety.DeterministicSafetyClassifier();
    }

    /** USAGE-HEALTH (V52): continuous-use reminder prefs + heartbeat. */
    @Bean
    public UsageHealthService usageHealthService(JdbcTemplate authJdbcTemplate) {
        return new UsageHealthService(authJdbcTemplate);
    }

    /** GEN-VER (V53): list/select generation versions for one user message. */
    @Bean
    public GenerationVersionService generationVersionService(JdbcTemplate authJdbcTemplate) {
        return new GenerationVersionService(authJdbcTemplate);
    }

    /** INC-PREF (V54): default incognito flag for the next new conversation. */
    @Bean
    public IncognitoPrefService incognitoPrefService(JdbcTemplate authJdbcTemplate) {
        return new IncognitoPrefService(authJdbcTemplate);
    }

    /** MEM-IMPORT (V55): explicit archive / import of confirmed relationship memories. */
    @Bean
    public MemoryImportService memoryImportService(JdbcTemplate authJdbcTemplate) {
        return new MemoryImportService(authJdbcTemplate);
    }

    /** S0-12: simulated by default; real adapter requires explicit complete config. */
    @Bean
    public AgeVerificationPort ageVerificationPort(
            @Value("${virtual-companion.age-provider.enabled:false}") boolean enabled,
            @Value("${virtual-companion.age-provider.endpoint:}") String endpoint,
            @Value("${virtual-companion.age-provider.api-key:}") String apiKey,
            @Value("${virtual-companion.age-provider.provider-ref:}") String providerRef,
            @Value("${virtual-companion.age-provider.provider-version:}") String providerVersion,
            @Value("${virtual-companion.age-provider.subject-secret:}") String subjectSecret,
            @Value("${virtual-companion.age-provider.allowed-hosts:}") java.util.List<String> allowedHosts) {
        if (!enabled) {
            return new SimulatedAgeVerifier();
        }
        java.net.URI configuredEndpoint = java.net.URI.create(endpoint);
        java.util.List<String> explicitHosts = allowedHosts == null
                ? java.util.List.of()
                : allowedHosts.stream()
                        .filter(host -> host != null && !host.isBlank())
                        .map(String::trim)
                        .toList();
        String configuredHost = configuredEndpoint.getHost();
        if (configuredHost == null
                || (!(com.virtualcompanion.modelruntime.port.EgressDnsGuard.LOOPBACK_HOST
                                .equals(configuredHost))
                        && explicitHosts.stream().noneMatch(configuredHost::equalsIgnoreCase))) {
            throw new IllegalArgumentException(
                    "enabled age provider endpoint host must be explicitly allowed");
        }
        return new com.virtualcompanion.runtime.age.HttpAgeVerificationAdapter(
                endpoint, apiKey, providerRef, providerVersion, subjectSecret,
                com.virtualcompanion.modelruntime.port.ProviderEgressPolicy.defaultsPlus(explicitHosts),
                com.virtualcompanion.modelruntime.port.EgressDnsGuard.defaults());
    }


    @Bean
    public GenerationRepository generationRepository(JdbcTemplate authJdbcTemplate) {
        return new GenerationRepository(authJdbcTemplate);
    }

    @Bean
    public ConversationRepository conversationRepository(JdbcTemplate authJdbcTemplate) {
        return new ConversationRepository(authJdbcTemplate);
    }

    @Bean
    public WorkItemEnqueueService workItemEnqueueService(JdbcTemplate authJdbcTemplate) {
        return new WorkItemEnqueueService(authJdbcTemplate);
    }

    @Bean
    public ConversationCreateService conversationCreateService(JdbcTemplate authJdbcTemplate) {
        return new ConversationCreateService(authJdbcTemplate);
    }

    /** CONV-HIST: keyset-paginated conversation list (V30) for the H5 chat page. */
    @Bean
    public ConversationListService conversationListService(JdbcTemplate authJdbcTemplate) {
        return new ConversationListService(authJdbcTemplate);
    }

    @Bean
    public GenerationStateService generationStateService(JdbcTemplate authJdbcTemplate) {
        return new GenerationStateService(authJdbcTemplate);
    }

    /**
     * TASK-0178: relationship lifecycle over the V9 SECURITY DEFINER functions
     * (create/list/get/activate/deactivate), consumed by the Relationship HTTP
     * API controller. Runs inside the server-trusted owner context established
     * by the owner-injection filter.
     */
    @Bean
    public RelationshipService relationshipService(JdbcTemplate authJdbcTemplate) {
        return new RelationshipService(authJdbcTemplate);
    }

    /**
     * TASK-0179: paginated message history over the V10
     * {@code vc.list_messages} SECURITY DEFINER function, consumed by the
     * message history HTTP API controller.
     */
    @Bean
    public MessageHistoryService messageHistoryService(
            JdbcTemplate authJdbcTemplate,
            com.virtualcompanion.platform.persistence.RestFieldCipher restFieldCipher) {
        return new MessageHistoryService(authJdbcTemplate, restFieldCipher);
    }

    /**
     * TASK-0180: Canonical Memory management over the V11/V12/V13 SECURITY
     * DEFINER functions (create/list/get/update/delete/confirm/reject/evidence),
     * consumed by the memory HTTP API controller. The relationship existence
     * pre-check for candidate creation reuses {@link RelationshipService}.
     */
    @Bean
    public MemoryService memoryService(
            JdbcTemplate authJdbcTemplate,
            RelationshipService relationshipService,
            com.virtualcompanion.platform.persistence.RestFieldCipher restFieldCipher) {
        return new MemoryService(authJdbcTemplate, relationshipService, restFieldCipher);
    }

    /**
     * TASK-0182: realtime resume / ticket / event persistence over the V8
     * SECURITY DEFINER functions (issue_realtime_ticket, resume_stream,
     * read_generation_snapshot, append_realtime_event), all already GRANTed to
     * vc_api. The ticket repository backs the {@code POST /api/v1/realtime/tickets}
     * HTTP endpoint; resume and event repositories are wired ahead of the SSE
     * resume endpoint (separate task). All run inside the server-trusted owner
     * context established upstream.
     */
    @Bean
    public RealtimeTicketRepository realtimeTicketRepository(JdbcTemplate authJdbcTemplate) {
        return new RealtimeTicketRepository(authJdbcTemplate);
    }

    @Bean
    public RealtimeResumeService realtimeResumeService(JdbcTemplate authJdbcTemplate) {
        return new RealtimeResumeService(authJdbcTemplate);
    }

    @Bean
    public RealtimeEventRepository realtimeEventRepository(JdbcTemplate authJdbcTemplate) {
        return new RealtimeEventRepository(authJdbcTemplate);
    }

    /**
     * STREAM-LIVE: process-local live delta broker shared by the generation
     * worker (publish) and the Fetch-SSE stream controller (subscribe).
     * In-memory only — deltas are non-durable per the realtime-events catalog.
     */
    @Bean
    public LiveDeltaBroker liveDeltaBroker() {
        return new LiveDeltaBroker();
    }

    /**
     * TASK-0181: JDBC {@link AuthorizationSnapshotProvider} wiring the V26
     * {@code create_authorization_snapshots} SECURITY DEFINER function.
     * S0-25: the minted rows in {@code vc.authorization_snapshot} are the
     * authoritative pre-outbound state — the guard re-reads them through
     * {@link #authorizationSnapshotAuthorityStore(JdbcTemplate)} immediately
     * before every outbound transfer, so no process-local mirror is kept (a
     * stale per-instance copy could stay ACTIVE across a committed withdrawal).
     * The provider id is derived from the live registry with the
     * {@code DeterministicRouter} candidate rule; region / contract / purpose /
     * data categories come from the {@code virtual-companion.external-attempt}
     * configuration (defaults align with the infra/db test 67/68 fixtures).
     *
     * <p>Active only when the live model-provider runtime is wired
     * ({@code model-providers.enabled=true}, the same condition as
     * {@code ApprovedModelProviderConfig}), so the generation handler's
     * external branch becomes runtime-active exactly when an approved provider
     * set exists; with the switch off no provider bean exists and the branch
     * stays inactive (fail closed, no eligible deployment). The runtime
     * datasource is required for this path, so a model-providers-enabled
     * runtime without a datasource fails closed at wiring time.
     */
    @Bean
    @ConditionalOnProperty(
            name = "virtual-companion.model-providers.enabled",
            havingValue = "true")
    public AuthorizationSnapshotProvider authorizationSnapshotProvider(
            JdbcTemplate authJdbcTemplate,
            ApprovedModelProviders approvedModelProviders,
            @Value("${virtual-companion.external-attempt.protocol:OPENAI_CHAT_COMPLETIONS}") ModelProtocol externalProtocol,
            @Value("${virtual-companion.external-attempt.region:us}") String region,
            @Value("${virtual-companion.external-attempt.contract-ref:alpha-standard}") String contractRef,
            @Value("${virtual-companion.external-attempt.purpose:COMPANION_CHAT}") String purpose,
            @Value("${virtual-companion.external-attempt.data-categories:MESSAGE_TEXT}") String dataCategories) {
        return new JdbcAuthorizationSnapshotProvider(
                authJdbcTemplate,
                approvedModelProviders.registry(),
                externalProtocol,
                new ProviderRegion(region),
                new ProviderContractRef(contractRef),
                ProcessingPurpose.valueOf(purpose),
                parseDataCategories(dataCategories));
    }

    /**
     * S0-25: the DB-backed pre-outbound authorization authority. The
     * {@code ExecutionAuthorizationGuard} and the invoker's execution-snapshot
     * identity check read {@code vc.authorization_snapshot} through this store
     * inside the worker's owner-bound prepare transaction, so a consent
     * withdrawal committed by any instance (V46
     * {@code vc.withdraw_authorization_snapshots}) is observed before the next
     * outbound attempt, and an unreadable authority fails closed instead of
     * falling back to process-local state. RLS keeps every read scoped to the
     * bound owner; V3 grants vc_api SELECT.
     */
    @Bean
    public JdbcAuthorizationSnapshotStore authorizationSnapshotAuthorityStore(
            JdbcTemplate authJdbcTemplate) {
        return new JdbcAuthorizationSnapshotStore(authJdbcTemplate);
    }

    /**
     * S0-11-A: durable provider-deployment admission. Runtime roles SELECT
     * {@code vc.provider_deployment}; coordinator writes transitions. The
     * approved-provider registry overlays this authority onto config-wired
     * adapters so an unadmitted row never becomes an outbound candidate.
     */
    @Bean
    public JdbcProviderDeploymentRepository jdbcProviderDeploymentRepository(
            JdbcTemplate authJdbcTemplate) {
        return new JdbcProviderDeploymentRepository(authJdbcTemplate);
    }

    @Bean
    public JdbcProviderAdmissionAuthority jdbcProviderAdmissionAuthority(
            JdbcProviderDeploymentRepository jdbcProviderDeploymentRepository) {
        return new JdbcProviderAdmissionAuthority(jdbcProviderDeploymentRepository);
    }

    /**
     * S0-11-C: durable non-monetary product quota. Runtime SELECT only;
     * reserve/settle/release go through SECURITY DEFINER functions.
     */
    @Bean
    public JdbcProductQuotaBook jdbcProductQuotaBook(
            JdbcTemplate authJdbcTemplate,
            @Value("${virtual-companion.product-quota.default-allowance:1000000}")
            long defaultAllowance) {
        return new JdbcProductQuotaBook(authJdbcTemplate, defaultAllowance);
    }

    private static Set<DataCategory> parseDataCategories(String csv) {
        if (csv == null || csv.isBlank()) {
            throw new IllegalArgumentException(
                    "virtual-companion.external-attempt.data-categories must not be blank");
        }
        Set<DataCategory> result = new LinkedHashSet<>();
        for (String raw : csv.split(",")) {
            String name = raw.trim();
            if (!name.isEmpty()) {
                result.add(DataCategory.valueOf(name));
            }
        }
        if (result.isEmpty()) {
            throw new IllegalArgumentException(
                    "virtual-companion.external-attempt.data-categories must not be empty");
        }
        return result;
    }

    /**
     * TASK-0179: generation cancellation over the V10
     * {@code vc.cancel_generation} SECURITY DEFINER function, consumed by the
     * generation cancel HTTP API controller. Existence is pre-checked through
     * {@link GenerationRepository} so the not-owned / absent case maps to 404
     * without leaking existence.
     */
    @Bean
    public GenerationCancelService generationCancelService(
            JdbcTemplate authJdbcTemplate,
            GenerationRepository generationRepository) {
        return new GenerationCancelService(authJdbcTemplate, generationRepository);
    }

    /**
     * TASK-0176: message read access for the ZERO_LLM invocation assembler
     * (and the future external-provider request assembly). RLS-scoped reads
     * under the active tenant context.
     */
    @Bean
    public MessageRepository messageRepository(
            JdbcTemplate authJdbcTemplate,
            com.virtualcompanion.platform.persistence.RestFieldCipher restFieldCipher) {
        return new MessageRepository(authJdbcTemplate, restFieldCipher);
    }

    /**
     * TASK-0176: generation finalize / candidate / terminalize service wrapping
     * the V7 {@code finalize_generation}, V15 {@code insert_generation_candidate}
     * and {@code terminalize_generation} SECURITY DEFINER functions.
     */
    @Bean
    public GenerationFinalizeService generationFinalizeService(
            JdbcTemplate authJdbcTemplate,
            com.virtualcompanion.platform.persistence.RestFieldCipher restFieldCipher) {
        return new GenerationFinalizeService(authJdbcTemplate, restFieldCipher);
    }

    /**
     * TASK-0176 / TASK-0177: assembles the {@code LiveInvocationRequest} from
     * the generation snapshot (ownership two-hop + messages + fence GUC) and
     * prepends the recalled memory context (MEM-LOOP). The ZERO_LLM source id
     * tunes the deterministic path; the external protocol tunes the
     * external-attempt path so the router selects an admitted deployment of
     * the configured protocol.
     */
    @Bean
    public LiveInvocationAssembler liveInvocationAssembler(
            GenerationRepository generationRepository,
            ConversationRepository conversationRepository,
            MessageRepository messageRepository,
            MemoryService memoryService,
            RelationshipService relationshipService,
            JdbcTemplate authJdbcTemplate,
            @Value("${virtual-companion.zero-llm.source-id:ZERO_LLM_FALLBACK}") String zeroLlmSourceId,
            @Value("${virtual-companion.external-attempt.protocol:OPENAI_CHAT_COMPLETIONS}") ModelProtocol externalProtocol,
            // S0-03: the context budget binds through the type-safe
            // ContextBudgetProperties (canonical path
            // virtual-companion.context-budget.*, VC_CONTEXT_* env vars). The
            // former virtual-companion.generation.context-budget.* @Values read
            // a path application.yaml never declared, silently ignoring the
            // deployment variables.
            com.virtualcompanion.runtime.worker.ContextBudgetProperties contextBudgetProperties,
            EntitlementSnapshotService entitlementSnapshotService,
            com.virtualcompanion.runtime.memory.EmbeddingPort embeddingPort,
            @Value("${virtual-companion.model-providers.degraded:false}") boolean degraded,
            @Value("${virtual-companion.external-attempt.timeout-connect:10s}") Duration timeoutConnect,
            @Value("${virtual-companion.external-attempt.timeout-first-token:60s}") Duration timeoutFirstToken,
            @Value("${virtual-companion.external-attempt.timeout-total:240s}") Duration timeoutTotal,
            com.virtualcompanion.platform.persistence.RestFieldCipher restFieldCipher) {
        return new LiveInvocationAssembler(
                generationRepository,
                conversationRepository,
                messageRepository,
                memoryService,
                relationshipService,
                authJdbcTemplate,
                zeroLlmSourceId,
                externalProtocol,
                contextBudgetProperties.toBudget(),
                entitlementSnapshotService,
                embeddingPort,
                degraded,
                new com.virtualcompanion.modelruntime.contract.TimeoutBudget(
                        timeoutConnect, timeoutFirstToken, timeoutTotal),
                restFieldCipher);
    }

    /** ENT-SNAP (V40): simulated entitlement mint/assign/list. */
    @Bean
    public EntitlementSnapshotService entitlementSnapshotService(JdbcTemplate authJdbcTemplate) {
        return new EntitlementSnapshotService(authJdbcTemplate);
    }

    /**
     * TASK-0174 wiring (TASK-0176 ZERO_LLM / TASK-0177 external persistence
     * path): the generation work-item handler promotes a claimed generation and,
     * when a {@link LiveModelInvoker} bean is available, runs the active
     * completion path to a terminal. {@link LiveModelInvoker} and
     * {@link AuthorizationSnapshotProvider} are both optional
     * ({@code ObjectProvider#getIfAvailable} returns {@code null} when no
     * {@code model-providers.enabled=true} / {@code zero-llm.enabled=true}
     * runtime is active); the external branch is runtime-active since
     * TASK-0181 wires the JDBC {@link AuthorizationSnapshotProvider} bean
     * under the same {@code model-providers.enabled=true} condition.
     *
     * <p>MEM-LOOP: the worker now dispatches by kind — GENERATION stays on
     * {@link GenerationWorkItemHandler}, MEMORY_EXTRACT items (enqueued by the
     * generation handler in its guarded finalize transaction) go to
     * {@link MemoryExtractWorkItemHandler}, DATA_EXPORT items (enqueued by
     * {@code vc.create_export_request}, V42) go to
     * {@link DataExportWorkItemHandler}. An unknown kind terminalizes via
     * the worker's independent per-item fail instead of looping on lease
     * recovery.
     */
    @Bean
    public WorkItemHandler workItemHandler(
            GenerationStateService generationStateService,
            GenerationFinalizeService generationFinalizeService,
            LiveInvocationAssembler liveInvocationAssembler,
            ObjectProvider<LiveModelInvoker> liveModelInvokerProvider,
            ObjectProvider<AuthorizationSnapshotProvider> authorizationSnapshotServiceProvider,
            WorkItemEnqueueService workItemEnqueueService,
            WorkItemClaimService workItemClaimService,
            @Value("${virtual-companion.worker.external-claim-lease-seconds:300}")
            int externalClaimLeaseSeconds,
            GenerationRepository generationRepository,
            ConversationRepository conversationRepository,
            MessageRepository messageRepository,
            MemoryService memoryService,
            RealtimeEventRepository realtimeEventRepository,
            LiveDeltaBroker liveDeltaBroker,
            ExportService exportService,
            RelationshipService relationshipService,
            ConversationListService conversationListService,
            ReminderService reminderService,
            ConsentService consentService,
            com.virtualcompanion.runtime.memory.EmbeddingPort embeddingPort,
            @Qualifier("safetyClassifierPort")
            com.virtualcompanion.safety.SafetyClassifierPort safetyClassifierPort,
            @Qualifier("safetyIncrementalClassifier")
            com.virtualcompanion.safety.SafetyClassifierPort safetyIncrementalClassifier,
            SafetyEventService safetyEventService,
            ConversationSummaryService conversationSummaryService,
            com.virtualcompanion.runtime.observability.VcMetrics metrics,
            com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier,
            com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker circuitBreaker,
            com.virtualcompanion.modelruntime.routing.SessionDeploymentAffinity deploymentAffinity,
            @Qualifier("jdbcProductQuotaBook") JdbcProductQuotaBook productQuotaBook,
            ObjectProvider<com.virtualcompanion.platform.persistence.ModelCostReservationService>
                    modelCostReservations,
            @Value("${virtual-companion.model-providers.budget-reservation-output-tokens:8192}")
                    int budgetReservationOutputTokens,
            @Value("${virtual-companion.data-export.ttl-seconds:86400}") long exportTtlSeconds,
            @Value("${virtual-companion.model-providers.generation-provider-terms-verified:false}")
                    boolean generationProviderTermsVerified,
            ObjectProvider<ExportObjectStorage> exportObjectStorage,
            com.virtualcompanion.platform.persistence.AccountDeletionIntentService deletionIntents,
            com.virtualcompanion.platform.persistence.RestFieldCipher restFieldCipher,
            com.virtualcompanion.runtime.observability.RollingOutcomeWindow rollingOutcomeWindow,
            ObjectProvider<
                    com.virtualcompanion.runtime.observability.SafetyLeakProviderDisabler>
                    safetyLeakDisabler) {
        GenerationWorkItemHandler generationHandler = new GenerationWorkItemHandler(
                generationStateService,
                generationFinalizeService,
                liveInvocationAssembler,
                liveModelInvokerProvider,
                authorizationSnapshotServiceProvider,
                workItemEnqueueService,
                workItemClaimService,
                externalClaimLeaseSeconds,
                realtimeEventRepository,
                liveDeltaBroker,
                conversationRepository,
                generationRepository,
                safetyClassifierPort,
                // DOGFOOD-04 (ADR-0006 §5.1): streaming incremental review is
                // local-only; the composite stays on the final review above.
                safetyIncrementalClassifier,
                safetyEventService,
                conversationSummaryService,
                metrics,
                alertNotifier,
                // ROUTE-HARDEN: shared singletons from RouteHealthConfig —
                // routing must observe exactly what this worker records.
                circuitBreaker,
                deploymentAffinity,
                productQuotaBook);
        com.virtualcompanion.platform.persistence.ModelCostReservationService costReservations =
                modelCostReservations.getIfAvailable();
        if (costReservations != null) {
            generationHandler.withModelCostReservations(
                    costReservations, budgetReservationOutputTokens);
        }
        // DOGFOOD-05 (ADR-0006 §3.4): rolling canary window + R4 safety-leak
        // durable disable (the disabler bean exists only while live model
        // providers are enabled).
        generationHandler.withCanaryOutcomeWindow(rollingOutcomeWindow);
        // DOGFOOD-STABILIZATION-03 (audit defect B): sensitive-data gate at the
        // generation egress boundary — on unless the Owner verified the
        // generation provider's terms (VC_GENERATION_PROVIDER_TERMS_VERIFIED).
        generationHandler.withGenerationEgressSensitiveGate(
                new com.virtualcompanion.runtime.safety.GenerationEgressSensitiveGate(
                        generationProviderTermsVerified));
        com.virtualcompanion.runtime.observability.SafetyLeakProviderDisabler disabler =
                safetyLeakDisabler.getIfAvailable();
        if (disabler != null) {
            generationHandler.withSafetyLeakDisabler(disabler);
        }
        MemoryExtractWorkItemHandler memoryExtractHandler = new MemoryExtractWorkItemHandler(
                generationRepository,
                conversationRepository,
                messageRepository,
                memoryService,
                generationFinalizeService,
                embeddingPort);
        DataExportWorkItemHandler dataExportHandler = new DataExportWorkItemHandler(
                generationFinalizeService,
                exportService,
                relationshipService,
                conversationListService,
                messageRepository,
                memoryService,
                reminderService,
                consentService,
                new ObjectMapper(),
                Duration.ofSeconds(exportTtlSeconds),
                // DOGFOOD-02: null in inline mode; the MinIO adapter bean only
                // exists while object-storage.enabled=true. Object mode also
                // carries the AES-GCM envelope cipher and the orphan-risk
                // alerter (DOGFOOD-STABILIZATION audit). DOGFOOD-STABILIZATION
                // -02: the deletion-intent probe blocks new seals once the
                // account deletion intent is persisted (ADR-0006 §7 order).
                exportObjectStorage.getIfAvailable(),
                restFieldCipher,
                alertNotifier,
                deletionIntents);
        return new DispatchingWorkItemHandler(Map.of(
                GenerationWorkItemHandler.KIND_GENERATION, generationHandler,
                MemoryExtractWorkItemHandler.KIND_MEMORY_EXTRACT, memoryExtractHandler,
                DataExportWorkItemHandler.KIND_DATA_EXPORT, dataExportHandler));
    }

    @Bean
    public WorkItemWorker workItemWorker(
            WorkItemClaimService workItemClaimService,
            OwnerContext ownerContext,
            WorkItemHandler workItemHandler) {
        return new WorkItemWorker(
                workItemClaimService, ownerContext::asOwner, workItemHandler);
    }

    /**
     * §5.1.2 worker coordinator (Owner 2026-08-12: @Scheduled polling, runtime
     * in-process). Each poll round recovers expired claim leases (V24
     * {@code vc.recover_expired_claims}), enumerates owners with PENDING items
     * (V24 {@code vc.list_pending_owner_ids} -- vc_api has no table-level
     * SELECT on {@code work_item}) and runs one owner-bound worker batch per
     * owner under a freshly issued fence. {@link EnableScheduling} above
     * activates the polling only while this conditional configuration is live,
     * so no worker polling runs without a real database.
     */
    @Bean
    public WorkItemCoordinator workItemCoordinator(
            WorkItemWorker workItemWorker,
            JdbcTemplate authJdbcTemplate) {
        return new WorkItemCoordinator(workItemWorker, authJdbcTemplate);
    }

    /**
     * GEN-RECONC: periodic reconciliation of generations stuck IN_PROGRESS
     * whose work item is already terminal (V33). Runs on its own cadence
     * independent of the claim coordinator poll; only active while this
     * conditional configuration (auth + datasource enabled) is live. Every
     * terminalize runs inside the owner-bound executor (V27
     * {@code vc.set_owner_context}) — the SD terminalize function rejects a
     * principal whose server-trusted owner context is absent or mismatched.
     */
    @Bean
    public GenerationReconcileScheduler generationReconcileScheduler(
            GenerationFinalizeService generationFinalizeService,
            OwnerContext ownerContext) {
        return new GenerationReconcileScheduler(
                generationFinalizeService, ownerContext::asOwner);
    }

    /**
     * DATA-EXPORT (V42/V109): periodic expiry sweep of READY exports
     * (FR-DATA-002 过期后自动删除), plus the DOGFOOD-02 object-deletion pass
     * when object mode is on. Runs on its own slow cadence; only active
     * while this conditional configuration (auth + datasource enabled) is
     * live.
     */
    @Bean
    public ExportExpiryScheduler exportExpiryScheduler(
            ExportService exportService,
            com.virtualcompanion.platform.persistence.JobLease jobLease,
            com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier,
            ObjectProvider<ExportObjectStorage> exportObjectStorage) {
        return new ExportExpiryScheduler(
                exportService, jobLease, alertNotifier, exportObjectStorage.getIfAvailable());
    }

    /**
     * DOGFOOD-STABILIZATION-04 (audit defect E): periodic reclaim of
     * crash-after-put export objects — the durable consumer of the V114
     * upload-intent rows. Object mode only; without storage there is nothing
     * to reclaim (and no upload could ever have happened).
     */
    @Bean
    @org.springframework.boot.autoconfigure.condition.ConditionalOnBean(
            value = ExportObjectStorage.class)
    public com.virtualcompanion.runtime.export.ExportUploadReconciliationScheduler
            exportUploadReconciliationScheduler(
                    ExportService exportService,
                    com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier,
                    ObjectProvider<ExportObjectStorage> exportObjectStorage) {
        ExportObjectStorage storage = exportObjectStorage.getIfAvailable();
        if (storage == null) {
            throw new IllegalStateException(
                    "export upload reconciliation requires object storage");
        }
        return new com.virtualcompanion.runtime.export.ExportUploadReconciliationScheduler(
                exportService, storage, alertNotifier);
    }
}
