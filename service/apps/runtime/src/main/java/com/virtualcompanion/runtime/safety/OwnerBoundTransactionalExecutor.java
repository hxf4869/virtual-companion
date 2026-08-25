package com.virtualcompanion.runtime.safety;

import java.util.Objects;
import java.util.function.BiConsumer;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * DOGFOOD-STABILIZATION-03 (audit defect C): the production
 * {@link OwnerGatedSafetyClassifier.OwnerBoundExecutor}.
 *
 * <p>The two owner-work strategies are injected as functions (the auth slice
 * supplies {@code OwnerContext::asOwner} / {@code asOwnerRequiresNew}) so the
 * safety slice never depends on the auth slice — Spring Modulith rejects an
 * auth → safety → auth cycle.</p>
 *
 * <ul>
 *   <li>{@code asOwnerIndependent} — the DB probe phase in one SHORT
 *       REQUIRES_NEW owner transaction. The web INPUT path runs inside the
 *       OwnerInjectionFilter's request-scoped transaction; a REQUIRED join
 *       would both run the probes in that long transaction and let a failing
 *       probe poison it (PostgreSQL aborts the whole transaction on a raised
 *       statement error), un-committing the INPUT_BLOCKED terminal that
 *       follows. REQUIRES_NEW isolates any probe failure to the short
 *       transaction, which rolls back and is thrown away.</li>
 *   <li>{@code withoutTransaction} — the remote HTTP phase with every
 *       database transaction SUSPENDED (PROPAGATION_NOT_SUPPORTED), so the
 *       classifier call never extends the request transaction.</li>
 *   <li>{@code asOwner} — the legacy join-or-open semantics, kept for
 *       worker-side callers that run outside any transaction (REQUIRED then
 *       opens the same short transaction).</li>
 * </ul>
 */
public final class OwnerBoundTransactionalExecutor
        implements OwnerGatedSafetyClassifier.OwnerBoundExecutor {

    private final BiConsumer<Long, Runnable> joinOrOpenOwnerWork;
    private final BiConsumer<Long, Runnable> independentOwnerWork;
    private final TransactionTemplate notSupported;

    public OwnerBoundTransactionalExecutor(
            BiConsumer<Long, Runnable> joinOrOpenOwnerWork,
            BiConsumer<Long, Runnable> independentOwnerWork,
            PlatformTransactionManager transactionManager) {
        this.joinOrOpenOwnerWork =
                Objects.requireNonNull(joinOrOpenOwnerWork, "joinOrOpenOwnerWork must not be null");
        this.independentOwnerWork =
                Objects.requireNonNull(independentOwnerWork, "independentOwnerWork must not be null");
        Objects.requireNonNull(transactionManager, "transactionManager must not be null");
        this.notSupported = new TransactionTemplate(transactionManager);
        this.notSupported.setPropagationBehavior(
                TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
    }

    @Override
    public void asOwner(long ownerUserId, Runnable work) {
        joinOrOpenOwnerWork.accept(ownerUserId, work);
    }

    @Override
    public void asOwnerIndependent(long ownerUserId, Runnable work) {
        independentOwnerWork.accept(ownerUserId, work);
    }

    @Override
    public void withoutTransaction(Runnable work) {
        notSupported.executeWithoutResult(status -> work.run());
    }
}
