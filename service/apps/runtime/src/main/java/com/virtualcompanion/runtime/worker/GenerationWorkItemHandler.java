package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.catalog.ProviderAttemptStatus;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import com.virtualcompanion.modelruntime.execution.LiveAttemptOutcome;
import com.virtualcompanion.modelruntime.execution.LiveAttemptTerminal;
import com.virtualcompanion.modelruntime.execution.LiveInvocationRequest;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.modelruntime.execution.PreparedInvocation;
import com.virtualcompanion.modelruntime.execution.ProviderAttemptAudit;
import com.virtualcompanion.platform.persistence.AuthorizationSnapshotProvider;
import com.virtualcompanion.platform.persistence.ConversationRepository;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.RealtimeEventRepository;
import com.virtualcompanion.platform.persistence.WorkItemClaim;
import com.virtualcompanion.platform.persistence.WorkItemEnqueueService;
import com.virtualcompanion.runtime.realtime.LiveDeltaBroker;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
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
 *       work-item complete atomically (INV-TX-001); the same transaction also
 *       enqueues the {@code MEMORY_EXTRACT} item (MEM-LOOP), so memory
 *       extraction is scheduled exactly once per completed generation and
 *       rolls back with the finalize on any failure;</li>
 *   <li><b>guarded-fail-tx</b> (any non-success terminal): the same explicit
 *       claim guard, then {@code FAILED_FINAL} + per-item work-item fail;</li>
 *   <li><b>guarded-retry-tx</b> (V29 RETRY-A, external RETRYABLE_FAILED only):
 *       the same explicit claim guard, then requeue with bounded backoff — or
 *       dead-letter + {@code FAILED_FINAL} when the attempt budget (initial + 2
 *       retries) is exhausted; non-retryable / safety / authorization failures
 *       stay on the guarded-fail path;</li>
 *   <li>the worker applies the <b>independent-fail-tx</b> when any segment
 *       above throws (fresh transaction, only the original item/token/fence).</li>
 * </ol>
 */
public class GenerationWorkItemHandler implements WorkItemHandler {

    private static final Logger log = LoggerFactory.getLogger(GenerationWorkItemHandler.class);

    /** Work-item kind handled here; also the dispatcher's GENERATION key. */
    public static final String KIND_GENERATION = "GENERATION";

    /**
     * V29 RETRY-A attempt budget: one initial provider attempt plus at most two
     * retries (Owner-approved bound). Only explicit RETRYABLE_FAILED outcomes
     * consume the budget; TIMED_OUT and NON_RETRYABLE failures stay terminal.
     */
    static final int MAX_PROVIDER_ATTEMPTS = 3;

    /**
     * STREAM-LIVE: seq slots reserved for live deltas per external attempt
     * (deltas consume seq without persisting, V8). Unused slots surface as the
     * client's sanctioned gap → snapshot recovery at completion.
     */
    static final int DELTA_SEQ_BLOCK = 64;

    private static final String EVENT_CHAT_ACCEPTED = "chat.accepted";

    private final GenerationStateService stateService;
    private final GenerationFinalizeService finalizeService;
    private final LiveInvocationAssembler assembler;
    private final ObjectProvider<LiveModelInvoker> liveModelInvokerProvider;
    private final ObjectProvider<AuthorizationSnapshotProvider> authorizationSnapshotServiceProvider;
    private final WorkItemEnqueueService enqueueService;
    private final RealtimeEventRepository realtimeEventRepository;
    private final LiveDeltaBroker deltaBroker;
    private final ConversationRepository conversationRepository;
    private final GenerationRepository generationRepository;

    public GenerationWorkItemHandler(
            GenerationStateService stateService,
            GenerationFinalizeService finalizeService,
            LiveInvocationAssembler assembler,
            ObjectProvider<LiveModelInvoker> liveModelInvokerProvider,
            ObjectProvider<AuthorizationSnapshotProvider> authorizationSnapshotServiceProvider,
            WorkItemEnqueueService enqueueService,
            RealtimeEventRepository realtimeEventRepository,
            LiveDeltaBroker deltaBroker,
            ConversationRepository conversationRepository,
            GenerationRepository generationRepository) {
        this.stateService = stateService;
        this.finalizeService = finalizeService;
        this.assembler = assembler;
        this.liveModelInvokerProvider = liveModelInvokerProvider;
        this.authorizationSnapshotServiceProvider = authorizationSnapshotServiceProvider;
        this.enqueueService = enqueueService;
        this.realtimeEventRepository = realtimeEventRepository;
        this.deltaBroker = deltaBroker;
        this.conversationRepository = conversationRepository;
        this.generationRepository = generationRepository;
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
            // STREAM-LIVE: forward accepted session deltas to the live broker.
            // The sink is in-memory only (no database access inside execute) and
            // uses the seq block reserved in the prepare segment.
            AtomicLong nextDeltaSeq = new AtomicLong(prepared.firstDeltaSeq());
            Consumer<ModelProtocolEvent> sink = event -> {
                if (!(event instanceof ModelProtocolEvent.OutputDelta delta)
                        || !(delta.payload() instanceof ModelPayload.TextChunk chunk)) {
                    return;
                }
                long seq = nextDeltaSeq.getAndIncrement();
                if (prepared.externalMode()
                        && seq - prepared.firstDeltaSeq() < DELTA_SEQ_BLOCK) {
                    deltaBroker.publish(generationId, new LiveDeltaBroker.LiveEvent(
                            prepared.streamEpoch(), seq, "chat.delta", chunk.text()));
                }
            };
            LiveAttemptOutcome outcome =
                    prepared.invokerValue().execute(prepared.invocationValue(), sink);
            // ---- audit-outcome-tx ----
            if (outcome.externalAttemptCreated()) {
                auditOutcomeSegment(executor, ownerUserId, outcome);
            }
            // ---- guarded finalize / guarded fail ----
            if (outcome.terminal() == LiveAttemptTerminal.SUCCEEDED) {
                finalizeExternalSuccess(executor, claim, ownerUserId, generationId, outcome);
            } else if (outcome.terminal() == LiveAttemptTerminal.ZERO_LLM_COMPLETED) {
                finalizeZeroLlmSuccess(executor, claim, ownerUserId, generationId, outcome);
            } else if (prepared.externalMode() && retryableFailure(outcome)) {
                // V29 RETRY-A: the adapter explicitly classified the failure as
                // retryable; requeue with bounded backoff or dead-letter.
                retrySegment(executor, claim, ownerUserId, generationId);
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
        } finally {
            // STREAM-LIVE: the live tail completes once this item is fully
            // processed (durable terminal state committed); the client's next
            // resume attempt then delivers the terminal snapshot.
            deltaBroker.publishEnd(generationId);
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
            // STREAM-LIVE: the turn is accepted once the worker picked it up —
            // the durable chat.accepted event is seq 1 of the generation stream.
            // GEN-RECONC: a retried (V29 backoff) or crash-recovered re-run of
            // this prepare segment must not append a second chat.accepted —
            // append allocates a fresh seq on every call and is not idempotent.
            long epoch = realtimeEventRepository.streamEpoch(ownerUserId, generationId);
            if (!realtimeEventRepository.hasDurableEvent(
                    ownerUserId, generationId, EVENT_CHAT_ACCEPTED)) {
                realtimeEventRepository.appendDurableEvent(
                        ownerUserId,
                        generationId,
                        epoch,
                        EVENT_CHAT_ACCEPTED,
                        "{\"generation_id\":" + generationId + "}");
            }
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
                    // GEN-RECONC: a previous run of this work item may have left
                    // a CREATED intent behind (retry / crash recovery). Close it
                    // as ABANDONED_LATE before persisting the new intent so the
                    // audit trail never ends on a permanently-open intent.
                    finalizeService.closeStaleAttemptIntents(ownerUserId, claim.id());
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
                    // STREAM-LIVE: reserve the delta seq block (deltas consume
                    // seq without persisting, V8 advance_realtime_seq).
                    long nextSeq = realtimeEventRepository.advanceSeq(
                            ownerUserId, generationId, DELTA_SEQ_BLOCK);
                    ref[0] = new Prepared(
                            invoker, prepared, null, true, epoch, nextSeq - DELTA_SEQ_BLOCK);
                } else {
                    ref[0] = new Prepared(invoker, prepared, null, false, epoch, 0L);
                }
            } else {
                LiveInvocationRequest request =
                        assembler.assemble(ownerUserId, generationId, claim.claimFence());
                ref[0] = new Prepared(invoker, invoker.prepare(request), null, false, epoch, 0L);
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
            // outboxEligible=false: extraction is scheduled through the
            // work-item queue instead (MEMORY_EXTRACT enqueued below), so no
            // dormant PENDING outbox row is left behind (MEM-LOOP).
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
            enqueueMemoryExtract(ownerUserId, generationId);
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
            enqueueMemoryExtract(ownerUserId, generationId);
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

    /**
     * MEM-LOOP: schedule memory extraction for a completed generation inside
     * the guarded finalize transaction, so the enqueue commits or rolls back
     * with the finalize (extraction happens exactly once per completed
     * generation). Must run in the owner-bound segment transaction.
     *
     * <p>INC-MODE (FR-CHAT-005): incognito conversations never produce
     * long-term memory candidates, so the enqueue is skipped entirely (safety
     * checks and statutory logs still apply — incognito is not "no records").
     *
     * <p>GEN-VER (FR-CHAT-003): a regenerate of an already-completed user
     * message must not write a second memory candidate.
     */
    private void enqueueMemoryExtract(long ownerUserId, long generationId) {
        if (conversationRepository.isIncognitoForGeneration(ownerUserId, generationId)) {
            log.info("skipping MEMORY_EXTRACT for incognito generation {}", generationId);
            return;
        }
        if (generationRepository.hasCompletedSiblingVersion(ownerUserId, generationId)) {
            log.info("skipping MEMORY_EXTRACT for regenerate generation {}", generationId);
            return;
        }
        enqueueService.enqueue(
                ownerUserId, MemoryExtractWorkItemHandler.KIND_MEMORY_EXTRACT, generationId);
    }

    /**
     * V29 RETRY-A: a real outbound attempt whose audit status is exactly
     * RETRYABLE_FAILED (adapter-classified, e.g. rate limited). TIMED_OUT,
     * NON_RETRYABLE and safety/authorization failures are not retried — they
     * stay on the guarded-fail path. The attempt outcome was already recorded
     * in the audit-outcome segment, so the retry leaves a complete audit trail.
     */
    private static boolean retryableFailure(LiveAttemptOutcome outcome) {
        if (outcome.terminal() != LiveAttemptTerminal.FAILED || outcome.audits().isEmpty()) {
            return false;
        }
        return outcome.audits().get(0).status() == ProviderAttemptStatus.RETRYABLE_FAILED;
    }

    /**
     * Guarded retry tx (V29): claim guard first, then requeue-or-dead-letter
     * atomically. A retryable failure returns the item to PENDING with
     * deterministic backoff and leaves the generation IN_PROGRESS; when the
     * attempt budget is exhausted the item is dead-lettered and the generation
     * is terminalized FAILED_FINAL in the same transaction.
     */
    private void retrySegment(
            WorkItemWorker.OwnerExecutor executor,
            WorkItemClaim claim,
            long ownerUserId,
            long generationId) {
        executor.asOwner(ownerUserId, () -> {
            finalizeService.assertActiveClaim(
                    ownerUserId, claim.id(), claim.claimToken(), claim.claimFence());
            String branch = finalizeService.requeueRetryableFailure(
                    ownerUserId,
                    claim.id(),
                    claim.claimToken(),
                    claim.claimFence(),
                    MAX_PROVIDER_ATTEMPTS);
            if (GenerationFinalizeService.DEAD_LETTERED.equals(branch)) {
                finalizeService.terminalizeAsFailed(ownerUserId, generationId, "external-dead-lettered");
                log.warn("generation {} dead-lettered after {} provider attempts for owner {}",
                        generationId, MAX_PROVIDER_ATTEMPTS, ownerUserId);
            } else {
                log.info("generation {} retryable failure requeued for owner {} (attempt recorded)",
                        generationId, ownerUserId);
            }
        });
    }

    /** Immutable per-item prepare result: invoker, prepared invocation, external
     *  mode, and the STREAM-LIVE stream (epoch, first reserved delta seq). */
    private record Prepared(
            LiveModelInvoker invokerValue,
            PreparedInvocation invocationValue,
            String degradeFault,
            boolean externalMode,
            long streamEpoch,
            long firstDeltaSeq) {

        static Prepared degrade(String fault) {
            return new Prepared(null, null, fault, false, 0L, 0L);
        }
    }
}
