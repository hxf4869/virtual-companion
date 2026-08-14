package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.modelruntime.contract.TokenUsage;
import com.virtualcompanion.modelruntime.execution.LiveAttemptOutcome;
import com.virtualcompanion.modelruntime.execution.LiveAttemptTerminal;
import com.virtualcompanion.modelruntime.execution.LiveInvocationRequest;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.modelruntime.execution.PreparedInvocation;
import com.virtualcompanion.modelruntime.execution.ProviderAttemptAudit;
import com.virtualcompanion.platform.persistence.AuthorizationSnapshotProvider;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.WorkItemClaim;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;

/**
 * Generation work-item handler (TASK-0174 wiring, TASK-0176 ZERO_LLM
 * completion, TASK-0177 external provider completion, TASK-0194 segmented
 * transaction boundary).
 * Handles {@code kind='GENERATION'} items with the frozen segmented flow —
 * every segment is its own short server-trusted owner-bound transaction
 * (owner proof re-established per segment via the worker's
 * {@link WorkItemWorker.OwnerExecutor}, V27):
 * <ol>
 *   <li><b>prepare-tx</b>: promote {@code CREATED → IN_PROGRESS} (V25); when
 *       the external runtime is active, create the dual authorization
 *       snapshots, assemble the request (all DB reads), run the invoker's
 *       prepare phase (route/auth/safety + execution-snapshot read) and
 *       persist the {@code CREATED} attempt intent (V28) — an intent write
 *       failure aborts the transaction and forbids the outbound (adapter zero
 *       calls);</li>
 *   <li><b>external-no-db</b>: {@code LiveModelInvoker.execute} consumes only
 *       the immutable {@link PreparedInvocation} (adapter/session only — no
 *       database transaction, no claim row lock);</li>
 *   <li><b>audit-outcome-tx</b>: update the SAME intent row's outcome
 *       ({@code SUCCEEDED/FAILED/TIMED_OUT/CANCELLED}, V28);</li>
 *   <li><b>guarded-finalize-tx</b> (success): {@code assert_active_claim}
 *       (explicit work_item_id + token + fence, never a GUC) then candidate +
 *       promote {@code FINAL_REVIEW} + finalize (usage/quota/event) + per-item
 *       work-item complete atomically (INV-TX-001);</li>
 *   <li><b>guarded-fail-tx</b> (any non-success terminal): the same explicit
 *       claim guard, then {@code FAILED_FINAL} + per-item work-item fail;</li>
 *   <li>the worker applies the <b>independent-fail-tx</b> when any segment
 *       above throws (fresh transaction, only the original item/token/fence).</li>
 * </ol>
 */
public class GenerationWorkItemHandler implements WorkItemHandler {

    private static final Logger log = LoggerFactory.getLogger(GenerationWorkItemHandler.class);

    static final String KIND_GENERATION = "GENERATION";

    private final GenerationStateService stateService;
    private final GenerationFinalizeService finalizeService;
    private final LiveInvocationAssembler assembler;
    private final ObjectProvider<LiveModelInvoker> liveModelInvokerProvider;
    private final ObjectProvider<AuthorizationSnapshotProvider> authorizationSnapshotServiceProvider;

    public GenerationWorkItemHandler(
            GenerationStateService stateService,
            GenerationFinalizeService finalizeService,
            LiveInvocationAssembler assembler,
            ObjectProvider<LiveModelInvoker> liveModelInvokerProvider,
            ObjectProvider<AuthorizationSnapshotProvider> authorizationSnapshotServiceProvider) {
        this.stateService = stateService;
        this.finalizeService = finalizeService;
        this.assembler = assembler;
        this.liveModelInvokerProvider = liveModelInvokerProvider;
        this.authorizationSnapshotServiceProvider = authorizationSnapshotServiceProvider;
    }

    @Override
    public void handle(WorkItemClaim claim) {
        if (!KIND_GENERATION.equals(claim.kind())) {
            log.warn("generation handler skipping non-GENERATION item kind={}", claim.kind());
            return;
        }
        WorkItemWorker.OwnerExecutor executor = WorkItemWorker.segmentExecutor();
        long ownerUserId = claim.ownerUserId();
        long generationId = claim.refId();
        try {
            // ---- prepare-tx ----
            Prepared prepared = prepareSegment(executor, claim, ownerUserId, generationId);
            if (prepared.degradeFault() != null) {
                // No provider runtime wired: degrade inside a guarded fail tx.
                failSegment(executor, claim, ownerUserId, generationId, prepared.degradeFault());
                return;
            }
            // ---- external-no-db (adapter/session only, no database) ----
            LiveAttemptOutcome outcome = prepared.invokerValue().execute(prepared.invocationValue());
            // ---- audit-outcome-tx ----
            if (outcome.externalAttemptCreated()) {
                auditOutcomeSegment(executor, ownerUserId, outcome);
            }
            // ---- guarded finalize / guarded fail ----
            if (outcome.terminal() == LiveAttemptTerminal.SUCCEEDED) {
                finalizeExternalSuccess(executor, claim, ownerUserId, generationId, outcome);
            } else if (outcome.terminal() == LiveAttemptTerminal.ZERO_LLM_COMPLETED) {
                finalizeZeroLlmSuccess(executor, claim, ownerUserId, generationId, outcome);
            } else {
                String fault = prepared.externalMode()
                        ? "external-" + outcome.terminal().name().toLowerCase(java.util.Locale.ROOT)
                        : "zero-llm-unexpected-outcome:" + outcome.terminal();
                failSegment(executor, claim, ownerUserId, generationId, fault);
                log.warn("generation {} terminated as FAILED_FINAL for owner {} (outcome={})",
                        generationId, ownerUserId, outcome.terminal());
            }
        } catch (RuntimeException e) {
            log.error("generation handler failed for owner={} generation={} workItem={}",
                    ownerUserId, generationId, claim.id(), e);
            // The worker performs the independent per-item fail (fresh
            // transaction, only the original item/token/fence).
            throw e;
        }
    }

    /**
     * Prepare segment (short owner-bound transaction): promote, assemble,
     * invoker prepare (all DB reads), and — for the external path — persist the
     * CREATED attempt intent before any outbound.
     */
    private Prepared prepareSegment(
            WorkItemWorker.OwnerExecutor executor,
            WorkItemClaim claim,
            long ownerUserId,
            long generationId) {
        final Prepared[] ref = new Prepared[1];
        executor.asOwner(ownerUserId, () -> {
            stateService.promote(ownerUserId, generationId, GenerationStateService.IN_PROGRESS);
            LiveModelInvoker invoker = liveModelInvokerProvider.getIfAvailable();
            if (invoker == null) {
                ref[0] = Prepared.degrade("model-providers-disabled");
                return;
            }
            AuthorizationSnapshotProvider snapshotService =
                    authorizationSnapshotServiceProvider.getIfAvailable();
            if (snapshotService != null) {
                AuthorizationSnapshotProvider.SnapshotIds snapshots =
                        snapshotService.createFor(ownerUserId, generationId);
                LiveInvocationRequest request = assembler.assembleExternal(
                        ownerUserId,
                        generationId,
                        snapshots.requestedId(),
                        snapshots.executionId(),
                        claim.claimFence());
                PreparedInvocation prepared = invoker.prepare(request);
                if (prepared.isExternal()) {
                    // Intent failure raises here → prepare-tx aborts → the
                    // outbound is forbidden (adapter zero calls, test 74).
                    finalizeService.createAttemptIntent(
                            ownerUserId,
                            claim.id(),
                            generationId,
                            claim.claimToken(),
                            claim.claimFence(),
                            prepared.attempt().providerAttemptId(),
                            prepared.attempt().providerId(),
                            prepared.attempt().supplierName(),
                            prepared.attempt().requestedAuthorizationSnapshotId(),
                            prepared.attempt().executionAuthorizationSnapshotId());
                }
                ref[0] = new Prepared(invoker, prepared, null, true);
            } else {
                LiveInvocationRequest request =
                        assembler.assemble(ownerUserId, generationId, claim.claimFence());
                ref[0] = new Prepared(invoker, invoker.prepare(request), null, false);
            }
        });
        return ref[0];
    }

    /** Audit-outcome segment: update the same intent row (never a second row). */
    private void auditOutcomeSegment(
            WorkItemWorker.OwnerExecutor executor,
            long ownerUserId,
            LiveAttemptOutcome outcome) {
        ProviderAttemptAudit audit = outcome.audits().get(0);
        executor.asOwner(ownerUserId, () -> {
            int rows = finalizeService.recordAttemptOutcome(
                    ownerUserId, audit.providerAttemptId(), audit.status().code());
            if (rows != 1) {
                throw new IllegalStateException(
                        "record_attempt_outcome did not update the intent (rows=" + rows + ")");
            }
        });
    }

    /** Guarded finalize tx: claim guard + candidate + FINAL_REVIEW + finalize + per-item complete. */
    private void finalizeExternalSuccess(
            WorkItemWorker.OwnerExecutor executor,
            WorkItemClaim claim,
            long ownerUserId,
            long generationId,
            LiveAttemptOutcome outcome) {
        ProviderAttemptAudit audit = outcome.audits().get(0);
        TokenUsage usage = outcome.usage();
        long inputTokens = usage == null ? 0L : usage.inputTokens();
        long outputTokens = usage == null ? 0L : usage.outputTokens();
        String content = outcome.response();
        String attemptId = audit.providerAttemptId();

        executor.asOwner(ownerUserId, () -> {
            // Explicit claim guard first (work_item_id + token + fence, never a GUC).
            finalizeService.assertActiveClaim(
                    ownerUserId, claim.id(), claim.claimToken(), claim.claimFence());
            long candidateId = finalizeService.insertCandidate(ownerUserId, generationId, content);
            stateService.promote(ownerUserId, generationId, GenerationStateService.FINAL_REVIEW);
            // outboxEligible=false: the memory Java domain is not yet wired, so do
            // not leave a dangling PENDING memory.extract outbox row.
            finalizeService.finalizeCompletedWithUsage(
                    ownerUserId,
                    generationId,
                    candidateId,
                    content,
                    attemptId,
                    inputTokens,
                    outputTokens,
                    0d,
                    "USD",
                    1,
                    false);
            int rows = finalizeService.completeWorkItem(
                    claim.id(), claim.claimToken(), claim.claimFence());
            if (rows != 1) {
                throw new IllegalStateException(
                        "per-item complete inside the guarded finalize returned rows=" + rows);
            }
        });
        log.info("generation {} completed via external provider for owner {} (candidate in={} out={})",
                generationId, ownerUserId, inputTokens, outputTokens);
    }

    /** Guarded finalize tx for the ZERO_LLM deterministic completion. */
    private void finalizeZeroLlmSuccess(
            WorkItemWorker.OwnerExecutor executor,
            WorkItemClaim claim,
            long ownerUserId,
            long generationId,
            LiveAttemptOutcome outcome) {
        String content = outcome.response();
        executor.asOwner(ownerUserId, () -> {
            finalizeService.assertActiveClaim(
                    ownerUserId, claim.id(), claim.claimToken(), claim.claimFence());
            long candidateId = finalizeService.insertCandidate(ownerUserId, generationId, content);
            stateService.promote(ownerUserId, generationId, GenerationStateService.FINAL_REVIEW);
            finalizeService.finalizeCompleted(
                    ownerUserId, generationId, candidateId, content, "", false);
            int rows = finalizeService.completeWorkItem(
                    claim.id(), claim.claimToken(), claim.claimFence());
            if (rows != 1) {
                throw new IllegalStateException(
                        "per-item complete inside the guarded finalize returned rows=" + rows);
            }
        });
        log.info("generation {} completed via ZERO_LLM for owner {} (candidate={})",
                generationId, ownerUserId, outcome.response().length());
    }

    /** Guarded fail tx: claim guard + FAILED_FINAL + per-item fail (atomic). */
    private void failSegment(
            WorkItemWorker.OwnerExecutor executor,
            WorkItemClaim claim,
            long ownerUserId,
            long generationId,
            String fault) {
        executor.asOwner(ownerUserId, () -> {
            finalizeService.assertActiveClaim(
                    ownerUserId, claim.id(), claim.claimToken(), claim.claimFence());
            finalizeService.terminalizeAsFailed(ownerUserId, generationId, fault);
            int rows = finalizeService.failWorkItem(
                    claim.id(), claim.claimToken(), claim.claimFence());
            if (rows != 1) {
                throw new IllegalStateException(
                        "per-item fail inside the guarded fail returned rows=" + rows);
            }
        });
    }

    /** Immutable per-item prepare result: invoker, prepared invocation, external mode, or a degrade fault. */
    private record Prepared(
            LiveModelInvoker invokerValue,
            PreparedInvocation invocationValue,
            String degradeFault,
            boolean externalMode) {

        static Prepared degrade(String fault) {
            return new Prepared(null, null, fault, false);
        }
    }
}
