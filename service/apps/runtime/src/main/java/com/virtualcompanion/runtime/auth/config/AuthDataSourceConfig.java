package com.virtualcompanion.runtime.auth.config;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.authorization.InMemoryAuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.authorization.ProcessingPurpose;
import com.virtualcompanion.modelruntime.authorization.ProviderContractRef;
import com.virtualcompanion.modelruntime.authorization.ProviderRegion;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.platform.persistence.AdminConsoleService;
import com.virtualcompanion.platform.persistence.AgeAppealService;
import com.virtualcompanion.platform.persistence.AgeVerificationService;
import com.virtualcompanion.platform.persistence.AuthorizationSnapshotProvider;
import com.virtualcompanion.platform.persistence.ChatWipeService;
import com.virtualcompanion.platform.persistence.ConversationCreateService;
import com.virtualcompanion.platform.persistence.ConversationListService;
import com.virtualcompanion.platform.persistence.ConversationRepository;
import com.virtualcompanion.platform.persistence.ConversationSummaryService;
import com.virtualcompanion.platform.persistence.ConsentService;
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
import com.virtualcompanion.runtime.export.ExportExpiryScheduler;
import com.virtualcompanion.runtime.modelproviders.ApprovedModelProviders;
import com.virtualcompanion.runtime.realtime.LiveDeltaBroker;
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

    @Bean
    public DataSource authDataSource(
            @Value("${virtual-companion.auth.datasource.url:}") String url,
            @Value("${virtual-companion.auth.datasource.username:}") String username,
            @Value("${virtual-companion.auth.datasource.password:}") String password) {
        if (url == null || url.isBlank()) {
            throw new IllegalStateException(
                    "virtual-companion.auth.datasource.url (VC_DB_URL) is required when the auth datasource is enabled");
        }
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl(url);
        dataSource.setUsername(username);
        dataSource.setPassword(password);
        dataSource.setMaximumPoolSize(5);
        return dataSource;
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
            @Value("${spring.flyway.password:}") String password) {
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
            QuotaReconciliationService quotaReconciliationService) {
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
                quotaReconciliationService);
    }

    /** ADMIN-OPS (V36): minimal internal admin console reads. */
    @Bean
    public AdminConsoleService adminConsoleService(JdbcTemplate authJdbcTemplate) {
        return new AdminConsoleService(authJdbcTemplate);
    }

    @Bean
    public AuthController authController(AuthService authService, AuthAbuseGuard authAbuseGuard) {
        return new AuthController(authService, authAbuseGuard);
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
            @Value("${virtual-companion.auth.audit-retention-days:180}") int retentionDays) {
        return new IdentityAuthEventPurgeScheduler(authJdbcTemplate, retentionDays);
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
    @Bean
    public GenerationReceiveService generationReceiveService(JdbcTemplate authJdbcTemplate) {
        return new GenerationReceiveService(authJdbcTemplate);
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

    /** DATA-EXPORT (V42): asynchronous user data export (FR-DATA-002). */
    @Bean
    public ExportService exportService(JdbcTemplate authJdbcTemplate) {
        return new ExportService(authJdbcTemplate);
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
     * (defaults mirror the betaGate declarations in product-scope).
     */
    @Bean
    public com.virtualcompanion.runtime.servicemode.BetaServiceWindow betaServiceWindow(
            @Value("${virtual-companion.beta.service-window.enabled:false}") boolean enabled,
            @Value("${virtual-companion.beta.service-window.paused:false}") boolean paused,
            @Value("${virtual-companion.beta.service-window.window-from:20:30}") String windowFrom,
            @Value("${virtual-companion.beta.service-window.max-daily-active-users:10}")
                    int maxDailyActiveUsers,
            @Value("${virtual-companion.beta.service-window.zone:Asia/Shanghai}") String zone) {
        return new com.virtualcompanion.runtime.servicemode.BetaServiceWindow(
                enabled, paused, windowFrom, maxDailyActiveUsers, zone);
    }

    /** EMBED-RECALL (V62): deterministic embedder — the local recall floor. */
    @Bean
    public com.virtualcompanion.runtime.memory.EmbeddingPort embeddingPort() {
        return new com.virtualcompanion.runtime.memory.DeterministicEmbedder();
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
    public ConversationSummaryService conversationSummaryService(JdbcTemplate authJdbcTemplate) {
        return new ConversationSummaryService(authJdbcTemplate);
    }

    /** SAFETY-WIRE (V58): deterministic classifier — the local safety floor. */
    @Bean
    public com.virtualcompanion.safety.SafetyClassifierPort safetyClassifierPort() {
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

    /** AGE-MIN: the simulated verification port (Alpha; no real vendor). */
    @Bean
    public AgeVerificationPort ageVerificationPort() {
        return new SimulatedAgeVerifier();
    }

    /** AGE-MIN: the simulated verifier, exposed for the flow walk. */
    @Bean
    public SimulatedAgeVerifier simulatedAgeVerifier() {
        return new SimulatedAgeVerifier();
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
    public MessageHistoryService messageHistoryService(JdbcTemplate authJdbcTemplate) {
        return new MessageHistoryService(authJdbcTemplate);
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
            RelationshipService relationshipService) {
        return new MemoryService(authJdbcTemplate, relationshipService);
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
     * {@code create_authorization_snapshots} SECURITY DEFINER function and
     * mirroring the minted dual snapshots into the in-memory store the
     * {@code ExecutionAuthorizationGuard} reads. The provider id is derived
     * from the live registry with the {@code DeterministicRouter} candidate
     * rule; region / contract / purpose / data categories come from the
     * {@code virtual-companion.external-attempt} configuration (defaults align
     * with the infra/db test 67/68 fixtures).
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
            InMemoryAuthorizationSnapshotStore authorizationSnapshotStore,
            ApprovedModelProviders approvedModelProviders,
            @Value("${virtual-companion.external-attempt.protocol:OPENAI_CHAT_COMPLETIONS}") ModelProtocol externalProtocol,
            @Value("${virtual-companion.external-attempt.region:us}") String region,
            @Value("${virtual-companion.external-attempt.contract-ref:alpha-standard}") String contractRef,
            @Value("${virtual-companion.external-attempt.purpose:COMPANION_CHAT}") String purpose,
            @Value("${virtual-companion.external-attempt.data-categories:MESSAGE_TEXT}") String dataCategories) {
        return new JdbcAuthorizationSnapshotProvider(
                authJdbcTemplate,
                authorizationSnapshotStore,
                approvedModelProviders.registry(),
                externalProtocol,
                new ProviderRegion(region),
                new ProviderContractRef(contractRef),
                ProcessingPurpose.valueOf(purpose),
                parseDataCategories(dataCategories));
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
    public MessageRepository messageRepository(JdbcTemplate authJdbcTemplate) {
        return new MessageRepository(authJdbcTemplate);
    }

    /**
     * TASK-0176: generation finalize / candidate / terminalize service wrapping
     * the V7 {@code finalize_generation}, V15 {@code insert_generation_candidate}
     * and {@code terminalize_generation} SECURITY DEFINER functions.
     */
    @Bean
    public GenerationFinalizeService generationFinalizeService(JdbcTemplate authJdbcTemplate) {
        return new GenerationFinalizeService(authJdbcTemplate);
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
            @Value("${virtual-companion.generation.context-budget.max-input-tokens:8000}") int maxInputTokens,
            @Value("${virtual-companion.generation.context-budget.max-output-tokens:2048}") int maxOutputTokens,
            @Value("${virtual-companion.generation.context-budget.max-turns:64}") int maxTurns,
            EntitlementSnapshotService entitlementSnapshotService,
            com.virtualcompanion.runtime.memory.EmbeddingPort embeddingPort,
            @Value("${virtual-companion.model-providers.degraded:false}") boolean degraded) {
        return new LiveInvocationAssembler(
                generationRepository,
                conversationRepository,
                messageRepository,
                memoryService,
                relationshipService,
                authJdbcTemplate,
                zeroLlmSourceId,
                externalProtocol,
                new com.virtualcompanion.conversation.contextplan.ContextBudget(
                        maxInputTokens, maxOutputTokens, maxTurns),
                entitlementSnapshotService,
                embeddingPort,
                degraded);
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
            com.virtualcompanion.safety.SafetyClassifierPort safetyClassifierPort,
            SafetyEventService safetyEventService,
            ConversationSummaryService conversationSummaryService,
            @Value("${virtual-companion.data-export.ttl-seconds:86400}") long exportTtlSeconds) {
        GenerationWorkItemHandler generationHandler = new GenerationWorkItemHandler(
                generationStateService,
                generationFinalizeService,
                liveInvocationAssembler,
                liveModelInvokerProvider,
                authorizationSnapshotServiceProvider,
                workItemEnqueueService,
                realtimeEventRepository,
                liveDeltaBroker,
                conversationRepository,
                generationRepository,
                safetyClassifierPort,
                safetyEventService,
                conversationSummaryService);
        MemoryExtractWorkItemHandler memoryExtractHandler = new MemoryExtractWorkItemHandler(
                generationRepository,
                conversationRepository,
                messageRepository,
                memoryService,
                generationFinalizeService);
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
                Duration.ofSeconds(exportTtlSeconds));
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
     * conditional configuration (auth + datasource enabled) is live.
     */
    @Bean
    public GenerationReconcileScheduler generationReconcileScheduler(
            GenerationFinalizeService generationFinalizeService) {
        return new GenerationReconcileScheduler(generationFinalizeService);
    }

    /**
     * DATA-EXPORT (V42): periodic expiry sweep of READY exports (FR-DATA-002
     * 过期后自动删除). Runs on its own slow cadence; only active while this
     * conditional configuration (auth + datasource enabled) is live.
     */
    @Bean
    public ExportExpiryScheduler exportExpiryScheduler(ExportService exportService) {
        return new ExportExpiryScheduler(exportService);
    }
}
