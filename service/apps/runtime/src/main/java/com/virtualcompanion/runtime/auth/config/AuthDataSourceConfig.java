package com.virtualcompanion.runtime.auth.config;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.platform.persistence.AuthorizationSnapshotProvider;
import com.virtualcompanion.platform.persistence.ConversationCreateService;
import com.virtualcompanion.platform.persistence.ConversationRepository;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationReceiveService;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository;
import com.virtualcompanion.platform.persistence.IdentityRefreshTokenRepository;
import com.virtualcompanion.platform.persistence.MessageRepository;
import com.virtualcompanion.platform.persistence.WorkItemClaimService;
import com.virtualcompanion.platform.persistence.WorkItemEnqueueService;
import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.application.AuthService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import com.virtualcompanion.runtime.auth.web.AuthController;
import com.virtualcompanion.runtime.worker.GenerationWorkItemHandler;
import com.virtualcompanion.runtime.worker.LiveInvocationAssembler;
import com.virtualcompanion.runtime.worker.LoggingWorkItemHandler;
import com.virtualcompanion.runtime.worker.WorkItemCoordinator;
import com.virtualcompanion.runtime.worker.WorkItemHandler;
import com.virtualcompanion.runtime.worker.WorkItemWorker;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Duration;
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
            TransactionTemplate authTransactionTemplate) {
        return new OwnerContext(authJdbcTemplate, authTransactionTemplate);
    }

    @Bean
    public AuthService authService(
            IdentityAccountRepository identityAccountRepository,
            IdentityRefreshTokenRepository identityRefreshTokenRepository,
            PasswordEncoder passwordEncoder,
            JwtTokenService jwtTokenService,
            @Value("${virtual-companion.auth.refresh-token-ttl:7d}") Duration refreshTtl) {
        return new AuthService(
                identityAccountRepository,
                identityRefreshTokenRepository,
                passwordEncoder,
                jwtTokenService,
                refreshTtl);
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

    @Bean
    public GenerationStateService generationStateService(JdbcTemplate authJdbcTemplate) {
        return new GenerationStateService(authJdbcTemplate);
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
     * the generation snapshot (ownership two-hop + messages + fence GUC). The
     * ZERO_LLM source id tunes the deterministic path; the external protocol
     * tunes the external-attempt path so the router selects an admitted
     * deployment of the configured protocol.
     */
    @Bean
    public LiveInvocationAssembler liveInvocationAssembler(
            GenerationRepository generationRepository,
            ConversationRepository conversationRepository,
            MessageRepository messageRepository,
            JdbcTemplate authJdbcTemplate,
            @Value("${virtual-companion.zero-llm.source-id:ZERO_LLM_FALLBACK}") String zeroLlmSourceId,
            @Value("${virtual-companion.external-attempt.protocol:OPENAI_CHAT_COMPLETIONS}") ModelProtocol externalProtocol) {
        return new LiveInvocationAssembler(
                generationRepository,
                conversationRepository,
                messageRepository,
                authJdbcTemplate,
                zeroLlmSourceId,
                externalProtocol);
    }

    /**
     * TASK-0174 wiring (TASK-0176 ZERO_LLM / TASK-0177 external persistence
     * path): the generation work-item handler promotes a claimed generation and,
     * when a {@link LiveModelInvoker} bean is available, runs the active
     * completion path to a terminal. {@link LiveModelInvoker} and
     * {@link AuthorizationSnapshotProvider} are both optional
     * ({@code ObjectProvider#getIfAvailable} returns {@code null} when no
     * {@code model-providers.enabled=true} / {@code zero-llm.enabled=true}
     * runtime is active); the external branch is not runtime-active until the
     * snapshot-creation SD function lands (TASK-0178). {@link AuthorizationSnapshotProvider}
     * has no bean in this task, so the external branch is exercised only by unit
     * tests and reached at runtime once TASK-0178 wires a provider.
     */
    @Bean
    public WorkItemHandler workItemHandler(
            GenerationStateService generationStateService,
            GenerationFinalizeService generationFinalizeService,
            LiveInvocationAssembler liveInvocationAssembler,
            ObjectProvider<LiveModelInvoker> liveModelInvokerProvider,
            ObjectProvider<AuthorizationSnapshotProvider> authorizationSnapshotServiceProvider) {
        return new GenerationWorkItemHandler(
                generationStateService,
                generationFinalizeService,
                liveInvocationAssembler,
                liveModelInvokerProvider,
                authorizationSnapshotServiceProvider);
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
}
