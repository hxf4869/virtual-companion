package com.virtualcompanion.runtime.auth.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.AccountDeletionIntentService;
import com.virtualcompanion.platform.persistence.ConsentService;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.JdbcProviderDeploymentRepository;
import com.virtualcompanion.platform.persistence.SafetyEventService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.safety.OwnerBoundTransactionalExecutor;
import com.virtualcompanion.runtime.safety.OwnerGatedSafetyClassifier;
import com.virtualcompanion.runtime.testsupport.PostgresTestInstance;
import com.virtualcompanion.safety.CompositeSafetyClassifier;
import com.virtualcompanion.safety.DeterministicSafetyClassifier;
import com.virtualcompanion.safety.SafetyClassification;
import com.virtualcompanion.safety.SafetyClassifierPort;
import com.virtualcompanion.safety.SafetyStage;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mockito.Mockito;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.Authentication;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

/**
 * DOGFOOD-STABILIZATION-04 (audit defect G): REAL-transaction acceptance of
 * the web INPUT path over a real PostgreSQL instance —
 *
 * <ul>
 *   <li>the {@link OwnerInjectionFilter} wraps the request in ONE owner-bound
 *       REQUIRED transaction (DataSourceTransactionManager, production
 *       OwnerContext wiring, vc_api role, FORCE-RLS);</li>
 *   <li>a CONSENT shortfall and a PROBE SQL EXCEPTION each make the
 *       production composite return BLOCK with ZERO remote HTTP, and the
 *       INPUT_BLOCKED terminal walk commits INSIDE the same request
 *       transaction (the 03-round defect was a rollback-only outer tx);</li>
 *   <li>the remote delegate runs with NO active database transaction (the
 *       HTTP phase suspends everything), while the probes run inside their
 *       own short REQUIRES_NEW transaction.</li>
 * </ul>
 *
 * <p>The wiring mirrors the {@code AuthDataSourceConfig#safetyClassifierPort}
 * bean exactly, except the HTTP client is a counting stub (no real provider
 * is ever contacted — a dogfood red line). Everything else — hard-rule
 * classifier, owner-gated wrapper, probe services, transactional executor,
 * filter, state/finalize/safety services — is the production code.</p>
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OwnerInjectionFilterTransactionIntegrationTest {

    private static final long OWNER = 51L;
    private static final String CLEAN_TEXT = "今天天气不错，我们随便聊聊。";

    private PostgresTestInstance.PostgresInstanceHandle postgres;
    private PostgresTestInstance.RoleDataSource dataSource;
    private JdbcTemplate jdbc;
    private PlatformTransactionManager transactionManager;
    private TransactionTemplate transactions;
    private OwnerContext ownerContext;
    private GenerationStateService stateService;
    private GenerationFinalizeService finalizeService;
    private SafetyEventService safetyEventService;
    private OwnerInjectionFilter filter;
    private ObjectProvider<OwnerContext> ownerContextProvider;

    /** Counts remote-leg invocations; asserts the HTTP phase has no tx. */
    static final class CountingDelegate implements SafetyClassifierPort {
        final AtomicInteger calls = new AtomicInteger();
        final AtomicBoolean sawActiveTransaction = new AtomicBoolean(true);

        // The gate's HTTP phase invokes the delegate exactly like
        // ProviderModerationClassifier: through the owner-LESS overload
        // (authorization already happened in the probe phase).
        @Override
        public SafetyClassification classify(SafetyStage stage, String text) {
            calls.incrementAndGet();
            // The remote HTTP phase must run with every database transaction
            // suspended (defect C of round 03, asserted for real here).
            sawActiveTransaction.set(TransactionSynchronizationManager.isActualTransactionActive());
            return new SafetyClassification(
                    com.virtualcompanion.catalog.RiskLevel.R0_NORMAL,
                    java.util.List.of(),
                    new com.virtualcompanion.safety.ClassifierReport(
                            com.virtualcompanion.catalog.SafetyClassifierOutcome.CLASSIFIED, 0.99),
                    com.virtualcompanion.safety.SafetyVerdict.ALLOW);
        }

        @Override
        public SafetyClassification classify(long ownerUserId, SafetyStage stage, String text) {
            return classify(stage, text);
        }
    }

    @BeforeAll
    void startPostgresAndWiring() throws Exception {
        postgres = PostgresTestInstance.get();
        dataSource =
                new PostgresTestInstance.RoleDataSource(postgres.jdbcUrl());
        jdbc = new JdbcTemplate(dataSource);
        transactionManager = new DataSourceTransactionManager(dataSource);
        transactions = new TransactionTemplate(transactionManager);
        ownerContext = new OwnerContext(
                jdbc, transactions, PostgresTestInstance.TEST_OWNER_BINDING_SECRET);
        stateService = new GenerationStateService(jdbc);
        finalizeService = new GenerationFinalizeService(jdbc);
        safetyEventService = new SafetyEventService(jdbc);
        ownerContextProvider = Mockito.mock(ObjectProvider.class);
        when(ownerContextProvider.getIfAvailable()).thenReturn(ownerContext);
        filter = new OwnerInjectionFilter(ownerContextProvider);
    }

    @BeforeEach
    void cleanSlate() throws Exception {
        superuserUpdate("TRUNCATE vc.safety_event, vc.consent_record, vc.generation_candidate, "
                + "vc.generation, vc.message, vc.realtime_event, vc.work_item, "
                + "vc.conversation, vc.relationship, vc.export_request, "
                + "vc.export_upload_intent, vc.account_deletion_intent, "
                + "vc.entitlement_snapshot, vc.outbox_event CASCADE");
        superuserUpdate("INSERT INTO vc.vc_user(id, display_name) VALUES (" + OWNER
                + ", 'it-owner') ON CONFLICT (id) DO NOTHING");
        superuserUpdate("INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) "
                + "VALUES (" + OWNER + ", 1, 'gentle-listener', true)");
        superuserUpdate("INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) "
                + "VALUES (" + OWNER + ", 1, 1, NULL)");
        // A moderation provider deployment, currently ADMITTED (V4 registry).
        superuserUpdate("INSERT INTO vc.provider_deployment(provider_id, protocol, capabilities, "
                + "admission_state) VALUES ('it-moderation', 'OPENAI_CHAT_COMPLETIONS', "
                + "ARRAY[]::text[], 'ADMITTED') ON CONFLICT (provider_id) DO NOTHING");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(
                        new JwtTokenService.Principal(OWNER, "USER", "it-owner"), null));
    }

    @AfterEach
    void clearSecurityContext() throws Exception {
        SecurityContextHolder.clearContext();
        superuserUpdate("DELETE FROM vc.vc_user WHERE id = " + OWNER);
    }

    @AfterAll
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void consentShortfallBlocksZeroHttpAndCommitsInputBlockedInTheRequestTransaction()
            throws Exception {
        CountingDelegate delegate = new CountingDelegate();
        CompositeSafetyClassifier composite = productionComposite(delegate, true, null);
        long generationId = receiveGeneration("it-consent-missing");
        AtomicReference<String> chainVerdict = new AtomicReference<>("allowed");

        runWithinOwnerInjectionFilter((request, response) -> {
            var classification = composite.classify(OWNER, SafetyStage.INPUT, CLEAN_TEXT);
            chainVerdict.set(classification.allowed() ? "allowed" : "blocked");
            if (!classification.allowed()) {
                // The controller's INPUT_BLOCKED walk (V58), verbatim shape.
                stateService.promote(OWNER, generationId, GenerationStateService.INPUT_REVIEW);
                finalizeService.terminalizeAsInputBlocked(OWNER, generationId, "INTERNAL_BLOCK");
                safetyEventService.record(
                        OWNER, generationId, SafetyEventService.STAGE_INPUT,
                        classification.riskLevel().code(), "INTERNAL_BLOCK");
            }
        });

        // Fail-closed with ZERO remote HTTP; the terminal state COMMITTED in
        // the same request transaction (visible after the filter returned —
        // a rollback-only outer tx would have lost it, the 03-round defect).
        assertThat(chainVerdict.get()).isEqualTo("blocked");
        assertThat(delegate.calls.get()).isZero();
        assertThat(superuserQuery("SELECT status FROM vc.generation WHERE id = "
                + generationId)).isEqualTo("INPUT_BLOCKED");
        assertThat(superuserQuery("SELECT count(*) FROM vc.safety_event "
                + "WHERE owner_user_id = " + OWNER + " AND stage = 'INPUT'")).isEqualTo("1");
    }

    @Test
    void probeSqlExceptionBlocksZeroHttpAndStillCommitsInputBlocked() throws Exception {
        CountingDelegate delegate = new CountingDelegate();
        AtomicBoolean probeSawActiveTransaction = new AtomicBoolean(false);
        CompositeSafetyClassifier composite = productionComposite(
                delegate, true, probeSawActiveTransaction);
        long generationId = receiveGeneration("it-probe-sql-failure");
        // The deletion-intent probe's SQL now fails for the app role (a real
        // SQL exception against the real database).
        superuserUpdate("REVOKE EXECUTE ON FUNCTION "
                + "vc.account_deletion_intent_active_current() FROM vc_api");
        try {
            AtomicReference<String> chainVerdict = new AtomicReference<>("allowed");
            runWithinOwnerInjectionFilter((request, response) -> {
                var classification = composite.classify(OWNER, SafetyStage.INPUT, CLEAN_TEXT);
                chainVerdict.set(classification.allowed() ? "allowed" : "blocked");
                if (!classification.allowed()) {
                    stateService.promote(OWNER, generationId,
                            GenerationStateService.INPUT_REVIEW);
                    finalizeService.terminalizeAsInputBlocked(
                            OWNER, generationId, "INTERNAL_BLOCK");
                    safetyEventService.record(
                            OWNER, generationId, SafetyEventService.STAGE_INPUT,
                            classification.riskLevel().code(), "INTERNAL_BLOCK");
                }
            });
            assertThat(chainVerdict.get()).isEqualTo("blocked");
            assertThat(delegate.calls.get()).isZero();
            assertThat(superuserQuery("SELECT status FROM vc.generation WHERE id = "
                    + generationId)).isEqualTo("INPUT_BLOCKED");
        } finally {
            superuserUpdate("GRANT EXECUTE ON FUNCTION "
                    + "vc.account_deletion_intent_active_current() TO vc_api, vc_worker, "
                    + "vc_job_coordinator");
        }
    }

    @Test
    void allowedFlowRunsTheDelegateOutsideEveryDatabaseTransaction() throws Exception {
        grantAllRequiredConsents();
        CountingDelegate delegate = new CountingDelegate();
        AtomicBoolean probeSawActiveTransaction = new AtomicBoolean(false);
        CompositeSafetyClassifier composite = productionComposite(
                delegate, true, probeSawActiveTransaction);
        AtomicReference<String> chainVerdict = new AtomicReference<>("blocked");

        runWithinOwnerInjectionFilter((request, response) ->
                chainVerdict.set(composite.classify(OWNER, SafetyStage.INPUT, CLEAN_TEXT)
                        .allowed() ? "allowed" : "blocked"));

        assertThat(chainVerdict.get()).isEqualTo("allowed");
        // Exactly one remote call, and it ran with NO active transaction.
        assertThat(delegate.calls.get()).isEqualTo(1);
        assertThat(delegate.sawActiveTransaction.get())
                .as("the HTTP phase must suspend every database transaction")
                .isFalse();
        // The probes ran inside their own SHORT owner transaction (REQUIRES_NEW
        // inside the filter's request transaction).
        assertThat(probeSawActiveTransaction.get())
                .as("the probe phase must run inside its own transaction")
                .isTrue();
    }

    // ---- helpers ----

    /** The AuthDataSourceConfig wiring, with a counting stub for HTTP. */
    private CompositeSafetyClassifier productionComposite(
            CountingDelegate delegate, boolean termsVerified,
            AtomicBoolean probeSawActiveTransaction) {
        ConsentService consents = new ConsentService(jdbc);
        AccountDeletionIntentService deletionIntents = new AccountDeletionIntentService(jdbc);
        JdbcProviderDeploymentRepository deployments =
                new JdbcProviderDeploymentRepository(jdbc);
        OwnerGatedSafetyClassifier gated = new OwnerGatedSafetyClassifier(
                delegate,
                (owner, type) -> {
                    if (probeSawActiveTransaction != null) {
                        probeSawActiveTransaction.set(
                                TransactionSynchronizationManager.isActualTransactionActive());
                    }
                    return consents.findLatestByType(owner, type)
                            .map(record -> record.granted())
                            .orElse(false);
                },
                deletionIntents::activeCurrent,
                providerRef -> deployments.findByProviderId(providerRef)
                        .map(record -> record.isAdmitted())
                        .orElse(false),
                "it-moderation",
                termsVerified,
                new OwnerBoundTransactionalExecutor(
                        ownerContext::asOwner,
                        ownerContext::asOwnerRequiresNew,
                        transactionManager));
        return new CompositeSafetyClassifier(new DeterministicSafetyClassifier(), gated);
    }

    /** Receive a clean turn through the production owner context (real SD). */
    private long receiveGeneration(String idempotencyKey) {
        AtomicReference<Long> generationId = new AtomicReference<>();
        ownerContext.asOwner(OWNER, () -> {
            var row = jdbc.queryForMap(
                    "SELECT generation_id AS gen FROM vc.receive_generation(?, ?, ?, 'user', ?)",
                    OWNER, 1L, idempotencyKey, CLEAN_TEXT);
            generationId.set(((Number) row.get("gen")).longValue());
        });
        return generationId.get();
    }

    /** Run the chain exactly as the servlet container would, inside the filter. */
    private void runWithinOwnerInjectionFilter(RequestChain chain) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/generations");
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, res) -> {
            try {
                chain.run((HttpServletRequest) req, (ServletResponse) res);
            } catch (Exception e) {
                // Mirror the filter's own capture semantics: rethrow as an
            // unchecked failure so the transaction still rolls back and the
            // test sees the real exception.
                throw new IllegalStateException("chain failed", e);
            }
        });
    }

    @FunctionalInterface
    private interface RequestChain {
        void run(HttpServletRequest request, ServletResponse response) throws Exception;
    }

    private void grantAllRequiredConsents() throws Exception {
        superuserUpdate("INSERT INTO vc.consent_record(owner_user_id, id, consent_type, version, "
                + "granted) VALUES "
                + "(" + OWNER + ", 1, 'SERVICE_TERMS', 'v1', true), "
                + "(" + OWNER + ", 2, 'PRIVACY_POLICY', 'v1', true), "
                + "(" + OWNER + ", 3, 'AI_CONTENT_NOTICE', 'v1', true), "
                + "(" + OWNER + ", 4, 'THIRD_PARTY_MODEL_PROCESSING', 'v1', true), "
                + "(" + OWNER + ", 5, 'SENSITIVE_DATA_PROCESSING', 'v1', true)");
    }

    private void superuserUpdate(String sql) throws Exception {
        try (Connection connection = postgres.superuserConnection();
             Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private String superuserQuery(String sql) throws Exception {
        try (Connection connection = postgres.superuserConnection();
             Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery(sql)) {
            if (!resultSet.next()) {
                throw new IllegalStateException("no rows for: " + sql);
            }
            return String.valueOf(resultSet.getObject(1));
        }
    }
}
