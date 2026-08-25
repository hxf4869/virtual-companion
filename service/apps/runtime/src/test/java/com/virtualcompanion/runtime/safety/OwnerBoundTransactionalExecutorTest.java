package com.virtualcompanion.runtime.safety;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import com.virtualcompanion.safety.SafetyClassification;
import com.virtualcompanion.safety.SafetyClassifierPort;
import com.virtualcompanion.safety.SafetyStage;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * DOGFOOD-STABILIZATION-03 (audit defect C): propagation behavior of the
 * owner-gated safety classifier's probe/HTTP phases under a REAL Spring
 * transaction manager (the full {@link AbstractPlatformTransactionManager}
 * state machine — begin/commit/rollback plus suspend/resume — over a
 * recording resource, not a Mockito stub of the manager and not a ThreadLocal
 * simulation).
 *
 * <p>The web INPUT path runs inside the OwnerInjectionFilter's request-scoped
 * transaction; these tests pin the three required properties:</p>
 * <ol>
 *   <li>the DB probe phase runs in a SHORT, INDEPENDENT (REQUIRES_NEW)
 *       transaction — it neither joins nor poisons the outer transaction;</li>
 *   <li>the remote HTTP phase runs with every transaction SUSPENDED
 *       (NOT_SUPPORTED), even while the request transaction is active;</li>
 *   <li>a rejecting probe (consent missing, read failure, …) rolls back only
 *       the short transaction — the outer transaction stays committable, so
 *       the INPUT_BLOCKED terminal that follows actually commits.</li>
 * </ol>
 */
class OwnerBoundTransactionalExecutorTest {

    private static final class Recording extends AbstractPlatformTransactionManager {
        private static final long serialVersionUID = 1L;

        /** Whether the thread currently holds the transaction resource. */
        private final AtomicBoolean resourceHeld = new AtomicBoolean();
        final AtomicInteger begins = new AtomicInteger();
        final AtomicInteger commits = new AtomicInteger();
        final AtomicInteger rollbacks = new AtomicInteger();
        final AtomicInteger suspends = new AtomicInteger();
        final AtomicInteger resumes = new AtomicInteger();

        private record Tx() {
        }

        @Override
        protected Object doGetTransaction() {
            return new Tx();
        }

        @Override
        protected boolean isExistingTransaction(Object transaction) {
            return resourceHeld.get();
        }

        @Override
        protected void doBegin(Object transaction, TransactionDefinition definition) {
            resourceHeld.set(true);
            begins.incrementAndGet();
        }

        @Override
        protected Object doSuspend(Object transaction) {
            resourceHeld.set(false);
            suspends.incrementAndGet();
            return new Object();
        }

        @Override
        protected void doResume(Object transaction, Object suspendedResources) {
            resourceHeld.set(true);
            resumes.incrementAndGet();
        }

        @Override
        protected void doCommit(DefaultTransactionStatus status) {
            resourceHeld.set(false);
            commits.incrementAndGet();
        }

        @Override
        protected void doRollback(DefaultTransactionStatus status) {
            resourceHeld.set(false);
            rollbacks.incrementAndGet();
        }
    }

    private static JdbcTemplate stubbedJdbc() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForMap(anyString())).thenReturn(Map.of("pid", 1, "xact", "tx-1"));
        // The set_owner_context query(..., ResultSetExtractor, args) call is
        // never executed by the mock — the extractor lambda stays uncalled,
        // which is all runBound needs.
        return jdbc;
    }

    private static OwnerContext ownerContext(JdbcTemplate jdbc, Recording manager) {
        TransactionTemplate template = new TransactionTemplate(manager);
        return new OwnerContext(jdbc, template,
                "0123456789abcdef0123456789abcdef0123456789abcdef");
    }

    private static OwnerBoundTransactionalExecutor executor(
            OwnerContext context, Recording manager) {
        return new OwnerBoundTransactionalExecutor(
                context::asOwner, context::asOwnerRequiresNew, manager);
    }

    /** All-granted probes; the delegate records when/where HTTP ran. */
    private static OwnerGatedSafetyClassifier gate(
            Recording manager, OwnerContext context, SafetyClassifierPort delegate) {
        return new OwnerGatedSafetyClassifier(
                delegate,
                (owner, type) -> true,
                owner -> false,
                provider -> true,
                "moderation-provider",
                true,
                executor(context, manager));
    }

    @Test
    void webInputPathProbesRunInAnIndependentShortTransactionAndHttpOutsideEveryTransaction() {
        Recording manager = new Recording();
        OwnerContext context = ownerContext(stubbedJdbc(), manager);
        AtomicBoolean httpSawActiveTransaction = new AtomicBoolean(true);
        AtomicInteger httpCalls = new AtomicInteger();
        AtomicBoolean probeSawTransaction = new AtomicBoolean(false);
        // Probe that observes the (fresh) transaction it runs inside.
        OwnerGatedSafetyClassifier.ConsentProbe observingConsent = (owner, type) -> {
            probeSawTransaction.set(
                    TransactionSynchronizationHolder.isActive());
            return true;
        };
        OwnerGatedSafetyClassifier gate = new OwnerGatedSafetyClassifier(
                (stage, text) -> {
                    httpCalls.incrementAndGet();
                    httpSawActiveTransaction.set(
                            TransactionSynchronizationHolder.isActive());
                    return clean();
                },
                observingConsent,
                owner -> false,
                provider -> true,
                "moderation-provider",
                true,
                executor(context, manager));

        // The request-scoped transaction (OwnerInjectionFilter semantics):
        // outer REQUIRED template wrapping the whole classification.
        TransactionTemplate request = new TransactionTemplate(manager);
        AtomicBoolean outerCommitted = new AtomicBoolean(false);
        request.executeWithoutResult(status -> {
            gate.classify(7L, SafetyStage.INPUT, "hello");
            // The outer transaction must still be committable after the
            // classification: the probe ran in its own transaction and the
            // HTTP phase suspended this one.
            assertFalse(status.isRollbackOnly());
        });
        outerCommitted.set(manager.commits.get() > 0);

        assertTrue(probeSawTransaction.get(), "probes must run inside a transaction");
        assertFalse(httpSawActiveTransaction.get(),
                "the HTTP phase must run with every transaction suspended");
        assertEquals(1, httpCalls.get());
        // Two commits at most: the short probe transaction + the outer request
        // transaction — never a join (a join would be exactly one).
        assertTrue(manager.commits.get() >= 2,
                "probe tx and request tx must commit independently (commits="
                        + manager.commits.get() + ")");
        assertTrue(outerCommitted.get());
        assertTrue(manager.suspends.get() >= 2,
                "outer tx suspended for the probe tx and for the HTTP phase (suspends="
                        + manager.suspends.get() + ")");
        assertEquals(0, manager.rollbacks.get());
    }

    @Test
    void rejectingProbesRollBackOnlyTheShortTransactionNotTheOuterRequest() {
        Recording manager = new Recording();
        OwnerContext context = ownerContext(stubbedJdbc(), manager);
        AtomicInteger httpCalls = new AtomicInteger();
        OwnerGatedSafetyClassifier denying = new OwnerGatedSafetyClassifier(
                (stage, text) -> {
                    httpCalls.incrementAndGet();
                    return clean();
                },
                (owner, type) -> false,
                owner -> false,
                provider -> true,
                "moderation-provider",
                true,
                executor(context, manager));
        AtomicReference<RuntimeException> thrown = new AtomicReference<>();

        TransactionTemplate request = new TransactionTemplate(manager);
        assertThrows(RuntimeException.class, () -> request.executeWithoutResult(status -> {
            try {
                denying.classify(7L, SafetyStage.INPUT, "hello");
            } catch (RuntimeException probeFailure) {
                assertFalse(status.isRollbackOnly(),
                        "a rejecting probe must not mark the outer transaction"
                                + " rollback-only");
                thrown.set(probeFailure);
                throw probeFailure;
            }
        }));
        assertTrue(thrown.get() != null);
        // The SAME outer template shape still commits cleanly afterwards —
        // proving the request transaction was not poisoned by the denial.
        AtomicBoolean outerSurvivedAndCommitted = new AtomicBoolean(false);
        request.executeWithoutResult(
                status -> outerSurvivedAndCommitted.set(!status.isRollbackOnly()));
        assertTrue(manager.commits.get() > 0,
                "the outer request transaction must still be committable");

        assertEquals(0, httpCalls.get(), "zero remote calls on a denied probe");
        assertTrue(manager.rollbacks.get() >= 1,
                "the short probe transaction rolled back");
        assertTrue(outerSurvivedAndCommitted.get());
    }

    @Test
    void workerFinalPathWithoutAnOuterTransactionStillGetsAShortProbeTxAndPlainHttp() {
        Recording manager = new Recording();
        OwnerContext context = ownerContext(stubbedJdbc(), manager);
        AtomicBoolean httpSawActiveTransaction = new AtomicBoolean(true);
        AtomicInteger httpCalls = new AtomicInteger();
        OwnerGatedSafetyClassifier gate = gate(
                manager,
                context,
                (stage, text) -> {
                    httpCalls.incrementAndGet();
                    httpSawActiveTransaction.set(TransactionSynchronizationHolder.isActive());
                    return clean();
                });

        // No outer transaction — exactly how the worker's FINAL review calls
        // the classifier (outside every executor segment).
        gate.classify(7L, SafetyStage.OUTPUT, "final output");

        assertEquals(1, httpCalls.get());
        assertFalse(httpSawActiveTransaction.get());
        assertEquals(1, manager.begins.get(), "exactly one short probe transaction");
        assertEquals(1, manager.commits.get());
        assertEquals(0, manager.suspends.get(), "nothing to suspend without an outer tx");
        assertEquals(0, manager.rollbacks.get());
    }

    private static SafetyClassification clean() {
        return new SafetyClassification(
                com.virtualcompanion.catalog.RiskLevel.R0_NORMAL,
                List.of(),
                new com.virtualcompanion.safety.ClassifierReport(
                        com.virtualcompanion.catalog.SafetyClassifierOutcome.CLASSIFIED, 0.99),
                com.virtualcompanion.safety.SafetyVerdict.ALLOW);
    }

    /** Thin wrapper so the tests read as "is a transaction active right now". */
    private static final class TransactionSynchronizationHolder {
        static boolean isActive() {
            return org.springframework.transaction.support
                    .TransactionSynchronizationManager.isActualTransactionActive();
        }
    }
}
