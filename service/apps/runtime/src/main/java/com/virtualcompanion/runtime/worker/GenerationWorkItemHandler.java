package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.catalog.ProviderAttemptStatus;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
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
import com.virtualcompanion.platform.persistence.ConversationSummaryService;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.JdbcProductQuotaBook;
import com.virtualcompanion.platform.persistence.ModelCostReservationService;
import com.virtualcompanion.platform.persistence.RealtimeEventRepository;
import com.virtualcompanion.platform.persistence.SafetyEventService;
import com.virtualcompanion.platform.persistence.WorkItemClaim;
import com.virtualcompanion.platform.persistence.WorkItemClaimService;
import com.virtualcompanion.platform.persistence.WorkItemEnqueueService;
import com.virtualcompanion.runtime.realtime.LiveDeltaBroker;
import com.virtualcompanion.safety.SafetyClassification;
import com.virtualcompanion.safety.SafetyClassifierPort;
import com.virtualcompanion.safety.SafetyStage;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
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
    private final WorkItemClaimService claimService;
    private final int externalClaimLeaseSeconds;
    private final RealtimeEventRepository realtimeEventRepository;
    private final LiveDeltaBroker deltaBroker;
    private final ConversationRepository conversationRepository;
    private final GenerationRepository generationRepository;
    private final SafetyClassifierPort safetyClassifier;
    private final SafetyEventService safetyEventService;
    private final ConversationSummaryService summaryService;
    private final com.virtualcompanion.runtime.observability.VcMetrics metrics;
    private final com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier;
    private final com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker circuitBreaker;
    private final com.virtualcompanion.modelruntime.routing.SessionDeploymentAffinity deploymentAffinity;
    private final JdbcProductQuotaBook productQuotaBook;
    private ModelCostReservationService modelCosts;
    private int costReservationOutputTokens = 8192;

    public GenerationWorkItemHandler(
            GenerationStateService stateService,
            GenerationFinalizeService finalizeService,
            LiveInvocationAssembler assembler,
            ObjectProvider<LiveModelInvoker> liveModelInvokerProvider,
            ObjectProvider<AuthorizationSnapshotProvider> authorizationSnapshotServiceProvider,
            WorkItemEnqueueService enqueueService,
            WorkItemClaimService claimService,
            int externalClaimLeaseSeconds,
            RealtimeEventRepository realtimeEventRepository,
            LiveDeltaBroker deltaBroker,
            ConversationRepository conversationRepository,
            GenerationRepository generationRepository,
            SafetyClassifierPort safetyClassifier,
            SafetyEventService safetyEventService,
            ConversationSummaryService summaryService,
            com.virtualcompanion.runtime.observability.VcMetrics metrics,
            com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier,
            com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker circuitBreaker,
            com.virtualcompanion.modelruntime.routing.SessionDeploymentAffinity deploymentAffinity,
            JdbcProductQuotaBook productQuotaBook) {
        this.stateService = stateService;
        this.finalizeService = finalizeService;
        this.assembler = assembler;
        this.liveModelInvokerProvider = liveModelInvokerProvider;
        this.authorizationSnapshotServiceProvider = authorizationSnapshotServiceProvider;
        this.enqueueService = enqueueService;
        this.claimService = Objects.requireNonNull(claimService, "claimService must not be null");
        if (externalClaimLeaseSeconds <= 0) {
            throw new IllegalArgumentException(
                    "externalClaimLeaseSeconds must be positive");
        }
        this.externalClaimLeaseSeconds = externalClaimLeaseSeconds;
        this.realtimeEventRepository = realtimeEventRepository;
        this.deltaBroker = deltaBroker;
        this.conversationRepository = conversationRepository;
        this.generationRepository = generationRepository;
        this.safetyClassifier = safetyClassifier;
        this.safetyEventService = safetyEventService;
        this.summaryService = summaryService;
        this.metrics = metrics;
        this.alertNotifier = alertNotifier;
        this.circuitBreaker = circuitBreaker;
        this.deploymentAffinity = Objects.requireNonNull(
                deploymentAffinity, "deploymentAffinity must not be null");
        this.productQuotaBook = Objects.requireNonNull(
                productQuotaBook, "productQuotaBook must not be null");
        this.modelCosts = null;
    }

    public GenerationWorkItemHandler withModelCostReservations(
            ModelCostReservationService service, int estimatedOutputTokens) {
        this.modelCosts = Objects.requireNonNull(service, "service must not be null");
        if (estimatedOutputTokens <= 0) {
            throw new IllegalArgumentException("estimatedOutputTokens must be positive");
        }
        this.costReservationOutputTokens = estimatedOutputTokens;
        return this;
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
        // METRICS-ALERT (§22.10): one duration sample + one terminal counter
        // per handled work item, both fired from the finally block below;
        // result tags are the fixed strings assigned after each segment
        // succeeds (an exception anywhere leaves the initial "error").
        long startNanos = System.nanoTime();
        String metricResult = "error";
        com.virtualcompanion.modelruntime.routing.RouteDecision outboundDecision = null;
        try {
            // ---- prepare-tx ----
            Prepared prepared = prepareSegment(executor, claim, ownerUserId, generationId);
            if (prepared.degradeFault() != null) {
                // No provider runtime wired: degrade inside a guarded fail tx.
                failSegment(executor, claim, ownerUserId, generationId, prepared.degradeFault());
                metricResult = "failed";
                return;
            }
            if (prepared.refusedSupplier() != null) {
                // ROUTE-HARDEN (§12.12): routing selected this supplier before
                // the circuit tripped (or the half-open probe was already
                // taken by a concurrent turn); the outbound gate refused it —
                // no attempt intent exists, requeue via the bounded budget.
                log.info("generation {} outbound refused by OPEN circuit for supplier {} (owner {})",
                        generationId, prepared.refusedSupplier(), ownerUserId);
                retrySegment(executor, claim, ownerUserId, generationId);
                metricResult = "retried";
                return;
            }
            // ---- external-no-db (adapter/session only, no database) ----
            // STREAM-LIVE: forward accepted session deltas to the live broker.
            // The sink is in-memory only (no database access inside execute) and
            // uses the seq block reserved in the prepare segment.
            // SAFETY-WIRE (FR-CHAT-001): only fragments passing the incremental
            // review may become chat.delta — a paused fragment still consumes
            // its reserved seq (a sanctioned gap; the terminal snapshot or the
            // final-review backstop resolves the stream).
            AtomicInteger pausedDeltas = new AtomicInteger();
            AtomicLong nextDeltaSeq = new AtomicLong(prepared.firstDeltaSeq());
            AtomicLong firstOutputNanos = new AtomicLong();
            Consumer<ModelProtocolEvent> sink = event -> {
                if (!(event instanceof ModelProtocolEvent.OutputDelta delta)) {
                    return;
                }
                // S0-24-B2: this callback is deliberately memory-only. The
                // invoker forwards only fenced protocol events, so the first
                // accepted OutputDelta (text or structured) marks first output.
                firstOutputNanos.compareAndSet(0L, System.nanoTime());
                if (!(delta.payload() instanceof ModelPayload.TextChunk chunk)) {
                    return;
                }
                long seq = nextDeltaSeq.getAndIncrement();
                if (prepared.externalMode()
                        && seq - prepared.firstDeltaSeq() < DELTA_SEQ_BLOCK) {
                    SafetyClassification incremental =
                            safetyClassifier.classify(SafetyStage.OUTPUT, chunk.text());
                    if (incremental.allowed()) {
                        deltaBroker.publish(generationId, new LiveDeltaBroker.LiveEvent(
                                prepared.streamEpoch(), seq, "chat.delta", chunk.text()));
                    } else {
                        pausedDeltas.incrementAndGet();
                    }
                }
            };
            long outboundStartNanos = System.nanoTime();
            if (prepared.externalMode()) {
                // Once execute is entered, every later callback/DB segment is
                // post-outbound. Keep the durable reservation reachable so an
                // unexpected breaker/affinity/audit/finalize failure can be
                // compensated in a fresh owner transaction.
                outboundDecision = prepared.invocationValue().decision();
            }
            LiveAttemptOutcome outcome =
                    prepared.invokerValue().execute(prepared.invocationValue(), sink);
            long firstOutputMark = firstOutputNanos.get();
            Long firstOutputLatencyMs = firstOutputMark == 0L
                    ? null
                    : TimeUnit.NANOSECONDS.toMillis(
                            Math.max(0L, firstOutputMark - outboundStartNanos));
            // ROUTE-HARDEN (§12.12): record the outbound result on the
            // attempt's OWN supplier breaker — consecutive failures trip that
            // supplier OPEN and routing skips it (failover at the next turn
            // boundary); a success closes it and re-establishes session
            // stickiness (§12.8). CANCELLED is the user's choice, not supplier
            // health, and never counts.
            if (outcome.externalAttemptCreated()) {
                ProviderAttemptAudit audit = outcome.audits().get(0);
                if (outcome.terminal() == LiveAttemptTerminal.SUCCEEDED) {
                    circuitBreaker.success(audit.supplierName());
                    // 会话模型粘滞 (§12.8): remember the deployment that just
                    // served this conversation so the next turn prefers it.
                    deploymentAffinity.record(
                            audit.ownership().conversationId(),
                            new com.virtualcompanion.modelruntime.registry.ProviderId(
                                    audit.providerId()));
                } else if (outcome.terminal() == LiveAttemptTerminal.FAILED
                        || outcome.terminal() == LiveAttemptTerminal.TIMED_OUT) {
                    circuitBreaker.failure(audit.supplierName());
                }
            }
            double actualCostUsd = 0d;
            // ---- audit-outcome-tx ----
            if (outcome.externalAttemptCreated()) {
                metrics.providerAttempt(outcome.terminal().name());
                actualCostUsd = auditOutcomeSegment(
                        executor, ownerUserId, outcome, firstOutputLatencyMs);
            } else if (prepared.externalMode() && modelCosts != null && modelCosts.enabled()) {
                String attemptId = prepared.invocationValue().attempt().providerAttemptId();
                executor.asOwner(ownerUserId, () -> modelCosts.release(attemptId));
            }
            // ---- guarded finalize / guarded fail ----
            if (outcome.terminal() == LiveAttemptTerminal.SUCCEEDED) {
                boolean outputBlocked = finalizeExternalSuccess(
                        executor, claim, ownerUserId, generationId, outcome,
                        pausedDeltas.get(), actualCostUsd);
                metricResult = outputBlocked ? "blocked_output" : "completed";
            } else if (outcome.terminal() == LiveAttemptTerminal.ZERO_LLM_COMPLETED) {
                finalizeZeroLlmSuccess(executor, claim, ownerUserId, generationId, outcome);
                metricResult = "completed_zero_llm";
            } else if (prepared.externalMode() && retryableFailure(outcome)) {
                // V29 RETRY-A: the adapter explicitly classified the failure as
                // retryable; requeue with bounded backoff or dead-letter.
                executor.asOwner(ownerUserId, () -> releaseProductQuota(outcome.decision()));
                retrySegment(executor, claim, ownerUserId, generationId);
                metricResult = "retried";
            } else {
                String fault = prepared.externalMode()
                        ? "external-" + outcome.terminal().name().toLowerCase(java.util.Locale.ROOT)
                        : "zero-llm-unexpected-outcome:" + outcome.terminal();
                boolean budgetHalted =
                        outcome.terminal() == LiveAttemptTerminal.BLOCKED_BY_BUDGET;
                if (budgetHalted) {
                    alertNotifier.alert(
                            com.virtualcompanion.runtime.observability.AlertSeverity.P1,
                            "BUDGET_HALT_REACHED",
                            "month-to-date spend reached the configured cap; outbound refused");
                }
                executor.asOwner(ownerUserId, () -> releaseProductQuota(outcome.decision()));
                failSegment(executor, claim, ownerUserId, generationId, fault);
                metricResult = budgetHalted ? "blocked_budget" : "failed";
                log.warn("generation {} terminated as FAILED_FINAL for owner {} (outcome={}, failure={})",
                        generationId, ownerUserId, outcome.terminal(),
                        outcome.failureOptional()
                                .map(f -> f.getClass().getSimpleName())
                                .orElse("-"));
            }
        } catch (RuntimeException e) {
            if (outboundDecision != null && outboundDecision.quotaReservation() != null) {
                try {
                    var decision = outboundDecision;
                    executor.asOwner(ownerUserId, () -> releaseProductQuota(decision));
                } catch (RuntimeException releaseFailure) {
                    // Preserve the real post-outbound failure as the primary
                    // cause; quota release is idempotent and safe to retry.
                    if (releaseFailure != e) {
                        e.addSuppressed(releaseFailure);
                    }
                }
            }
            log.error("generation handler failed for owner={} generation={} workItem={}",
                    ownerUserId, generationId, claim.id(), e);
            // The worker performs the independent per-item fail (fresh
            // transaction, only the original item/token/fence).
            throw e;
        } finally {
            metrics.generationTerminal(metricResult);
            metrics.generationDuration(startNanos, metricResult);
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
        final com.virtualcompanion.modelruntime.routing.RouteDecision[] reservedDecision =
                new com.virtualcompanion.modelruntime.routing.RouteDecision[1];
        try {
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
                reservedDecision[0] = prepared.decision();
                persistRouteDecision(ownerUserId, generationId, prepared);
                if (prepared.isExternal()) {
                    // GEN-RECONC: a previous run of this work item may have left
                    // a CREATED intent behind (retry / crash recovery). Close it
                    // as ABANDONED_LATE before persisting the new intent so the
                    // audit trail never ends on a permanently-open intent.
                    finalizeService.closeStaleAttemptIntents(ownerUserId, claim.id());
                    // EXTERNAL-LEASE: a real provider turn (reasoning models in
                    // particular) can far outlive the 30s default claim lease;
                    // an expiry mid-flight would reject every later segment via
                    // assert_active_claim (and the coordinator could re-claim
                    // the item → duplicate provider calls). Renew the per-item
                    // lease inside this prepare transaction so the network
                    // phase and the finalize segments stay guarded. A renewal
                    // of 0 rows means the claim is already lost: fail closed
                    // before writing the attempt intent.
                    int renewed = claimService.renewPerItem(
                            claim.id(),
                            claim.claimToken(),
                            claim.claimFence(),
                            externalClaimLeaseSeconds);
                    if (renewed != 1) {
                        throw new IllegalStateException(
                                "external claim lease renewal failed (rows=" + renewed
                                        + ") for work item " + claim.id());
                    }
                    // ROUTE-HARDEN (§12.12): final outbound gate, AFTER routing
                    // picked the supplier but BEFORE the attempt intent — a
                    // refusal here leaves no intent row at all and requeues via
                    // the bounded RETRY-A budget instead of burning an outbound
                    // on an OPEN circuit. This is also where the half-open
                    // probe token is consumed (exactly one probe per cooldown).
                    if (circuitBreaker != null
                            && !circuitBreaker.allow(prepared.attempt().supplierName())) {
                        releaseProductQuota(prepared.decision());
                        ref[0] = Prepared.refused(prepared.attempt().supplierName());
                        return;
                    }
                    reserveModelCost(ownerUserId, claim.id(), prepared);
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
                            prepared.attempt().executionAuthorizationSnapshotId(),
                            prepared.attempt().modelId(),
                            prepared.attempt().modelRevision(),
                            prepared.attempt().promptBundleVersion(),
                            prepared.attempt().personaBundleVersion(),
                            prepared.attempt().configVersion());
                    // STREAM-LIVE: reserve the delta seq block (deltas consume
                    // seq without persisting, V8 advance_realtime_seq).
                    long nextSeq = realtimeEventRepository.advanceSeq(
                            ownerUserId, generationId, DELTA_SEQ_BLOCK);
                    ref[0] = new Prepared(
                            invoker, prepared, null, null, true, epoch, nextSeq - DELTA_SEQ_BLOCK);
                } else {
                    ref[0] = new Prepared(invoker, prepared, null, null, false, epoch, 0L);
                }
            } else {
                LiveInvocationRequest request =
                        assembler.assemble(ownerUserId, generationId, claim.claimFence());
                PreparedInvocation prepared = invoker.prepare(request);
                reservedDecision[0] = prepared.decision();
                persistRouteDecision(ownerUserId, generationId, prepared);
                ref[0] = new Prepared(invoker, prepared, null, null, false, epoch, 0L);
            }
            });
        } catch (RuntimeException prepareFailure) {
            // V97: an intent/release-gate failure rolls back the prepare tx,
            // but the route may already have reserved durable product quota.
            // Release only after that rollback, in a fresh owner segment.
            var decision = reservedDecision[0];
            if (decision != null && decision.quotaReservation() != null) {
                try {
                    executor.asOwner(ownerUserId, () -> releaseProductQuota(decision));
                } catch (RuntimeException releaseFailure) {
                    if (releaseFailure != prepareFailure) {
                        prepareFailure.addSuppressed(releaseFailure);
                    }
                }
            }
            if (isModelCostReservationFailure(prepareFailure)) {
                alertNotifier.alert(
                        com.virtualcompanion.runtime.observability.AlertSeverity.P1,
                        "BUDGET_HALT_REACHED",
                        "atomic model cost reservation refused outbound");
            }
            throw prepareFailure;
        }
        return ref[0];
    }


    private void reserveModelCost(
            long ownerUserId, long workItemId, PreparedInvocation prepared) {
        if (modelCosts == null || !modelCosts.enabled()) {
            return;
        }
        long characters = prepared.protocolRequest().messages().stream()
                .mapToLong(message -> message.content().codePointCount(
                        0, message.content().length()))
                .sum();
        long estimatedInputTokens = Math.max(1L, (characters + 3L) / 4L);
        ModelCostReservationService.Reservation reservation = modelCosts.reserve(
                ownerUserId,
                workItemId,
                prepared.attempt().providerAttemptId(),
                prepared.attempt().providerId(),
                prepared.attempt().modelId(),
                estimatedInputTokens,
                costReservationOutputTokens);
        if (!reservation.inserted() || "NONE".equals(reservation.threshold())) {
            return;
        }
        com.virtualcompanion.runtime.observability.AlertSeverity severity =
                switch (reservation.threshold()) {
                    case "BUDGET_100" ->
                            com.virtualcompanion.runtime.observability.AlertSeverity.P0;
                    case "BUDGET_95" ->
                            com.virtualcompanion.runtime.observability.AlertSeverity.P1;
                    default -> com.virtualcompanion.runtime.observability.AlertSeverity.P2;
                };
        alertNotifier.alert(
                severity, reservation.threshold(),
                "model cost reservation crossed a fixed monthly threshold");
    }
    /**
     * S0-11-B: persist the immutable route decision inside the prepare
     * transaction so a later crash still leaves "why this deployment / why
     * ZERO_LLM / why no-eligible" reconstructable. Failure aborts prepare
     * and forbids outbound.
     */
    private void persistRouteDecision(
            long ownerUserId, long generationId, PreparedInvocation prepared) {
        finalizeService.recordRouteDecision(ownerUserId, generationId, prepared.decision());
    }

    private void settleProductQuota(com.virtualcompanion.modelruntime.routing.RouteDecision decision) {
        var reservation = decision.quotaReservation();
        if (reservation == null) {
            return;
        }
        productQuotaBook.settle(reservation);
    }

    private void releaseProductQuota(com.virtualcompanion.modelruntime.routing.RouteDecision decision) {
        var reservation = decision.quotaReservation();
        if (reservation == null) {
            return;
        }
        productQuotaBook.release(reservation);
    }

    /** Audit-outcome segment: update the same intent row (never a second row). */
    private double auditOutcomeSegment(
            WorkItemWorker.OwnerExecutor executor,
            long ownerUserId,
            LiveAttemptOutcome outcome,
            Long firstOutputLatencyMs) {
        ProviderAttemptAudit audit = outcome.audits().get(0);
        String failureCode = outcome.failureOptional()
                .map(GenerationWorkItemHandler::normalizedFailureCode)
                .orElse(null);
        double[] actualCostUsd = {0d};
        executor.asOwner(ownerUserId, () -> {
            int rows = finalizeService.recordAttemptOutcome(
                    ownerUserId,
                    audit.providerAttemptId(),
                    audit.status().code(),
                    firstOutputLatencyMs,
                    failureCode);
            if (rows != 1) {
                throw new IllegalStateException(
                        "record_attempt_outcome did not update the intent (rows=" + rows + ")");
            }
            if (modelCosts != null && modelCosts.enabled()) {
                TokenUsage usage = outcome.usage();
                long inputTokens = usage == null ? 0L : usage.inputTokens();
                long outputTokens = usage == null ? 0L : usage.outputTokens();
                if (outcome.terminal() == LiveAttemptTerminal.SUCCEEDED) {
                    actualCostUsd[0] = modelCosts.settle(
                            audit.providerAttemptId(), inputTokens, outputTokens)
                            .actualUsd().doubleValue();
                } else {
                    modelCosts.release(audit.providerAttemptId());
                }
            }
        });
        return actualCostUsd[0];
    }

    private static boolean isModelCostReservationFailure(Throwable failure) {
        for (Throwable current = failure; current != null; current = current.getCause()) {
            if (current.getMessage() != null
                    && current.getMessage().contains("reserve_model_cost:")) {
                return true;
            }
        }
        return false;
    }

    /** Fixed-cardinality failure normalization; never persists exception text. */
    static String normalizedFailureCode(AdapterFailure failure) {
        Objects.requireNonNull(failure, "failure must not be null");
        if (failure instanceof AdapterFailure.RateLimited) {
            return "HTTP_429";
        }
        if (failure instanceof AdapterFailure.UpstreamUnavailable) {
            return "HTTP_5XX";
        }
        if (failure instanceof AdapterFailure.Disconnected) {
            return "DISCONNECTED";
        }
        if (failure instanceof AdapterFailure.Timeout timeout) {
            return switch (timeout.phase()) {
                case CONNECT -> "TIMEOUT_CONNECT";
                case FIRST_TOKEN -> "TIMEOUT_FIRST_TOKEN";
                case TOTAL -> "TIMEOUT_TOTAL";
            };
        }
        return "OTHER";
    }

    /**
     * Guarded finalize tx: claim guard + candidate + FINAL_REVIEW + finalize + per-item complete.
     *
     * <p>SAFETY-WIRE (V58, §20.11 最终复核): the full model output is
     * classified before anything is committed. A hard-rule hit walks
     * FINAL_REVIEW → OUTPUT_BLOCKED with a durable chat.blocked event and a
     * minimal safety-event row (plus one INCREMENTAL row when any fragment
     * was paused mid-stream) — no assistant message, no candidate, no memory
     * extraction; the work item still completes (the provider attempt itself
     * succeeded and is audited).
     *
     * @return {@code true} when the final review blocked the output (the
     *         caller counts the item as {@code blocked_output} instead of
     *         {@code completed}).
     */
    private boolean finalizeExternalSuccess(
            WorkItemWorker.OwnerExecutor executor,
            WorkItemClaim claim,
            long ownerUserId,
            long generationId,
            LiveAttemptOutcome outcome,
            int pausedDeltas,
            double actualCostUsd) {
        ProviderAttemptAudit audit = outcome.audits().get(0);
        TokenUsage usage = outcome.usage();
        long inputTokens = usage == null ? 0L : usage.inputTokens();
        long outputTokens = usage == null ? 0L : usage.outputTokens();
        String content = outcome.response();
        String attemptId = audit.providerAttemptId();

        SafetyClassification finalReview =
                safetyClassifier.classify(SafetyStage.OUTPUT, content);
        if (!finalReview.allowed()) {
            // S0-07: a composite classifier can block without any hard-rule
            // hit (provider-flagged escalation or fail-closed UNAVAILABLE).
            // Terminalize with the controller's stable INTERNAL_BLOCK rule id
            // instead of crashing on an empty list — an IndexOutOfBounds here
            // would skip OUTPUT_BLOCKED terminalization and requeue the item,
            // repeating the provider outbound.
            String ruleId = finalReview.hardRuleViolations().isEmpty()
                    ? "INTERNAL_BLOCK"
                    : finalReview.hardRuleViolations().get(0);
            executor.asOwner(ownerUserId, () -> {
                settleProductQuota(outcome.decision());
                finalizeService.assertActiveClaim(
                        ownerUserId, claim.id(), claim.claimToken(), claim.claimFence());
                stateService.promote(ownerUserId, generationId, GenerationStateService.FINAL_REVIEW);
                finalizeService.terminalizeAsBlocked(ownerUserId, generationId, ruleId);
                if (pausedDeltas > 0) {
                    metrics.safetyEvent(
                            SafetyEventService.STAGE_INCREMENTAL,
                            finalReview.riskLevel().code());
                    safetyEventService.record(
                            ownerUserId, generationId, SafetyEventService.STAGE_INCREMENTAL,
                            finalReview.riskLevel().code(), ruleId);
                }
                metrics.safetyEvent(
                        SafetyEventService.STAGE_FINAL, finalReview.riskLevel().code());
                safetyEventService.record(
                        ownerUserId, generationId, SafetyEventService.STAGE_FINAL,
                        finalReview.riskLevel().code(), ruleId);
                int rows = finalizeService.completeWorkItem(
                        claim.id(), claim.claimToken(), claim.claimFence());
                if (rows != 1) {
                    throw new IllegalStateException(
                            "per-item complete inside the blocked finalize returned rows=" + rows);
                }
            });
            log.warn("generation {} OUTPUT_BLOCKED by final review for owner {} (rule={}, pausedDeltas={})",
                    generationId, ownerUserId, ruleId, pausedDeltas);
            return true;
        }

        executor.asOwner(ownerUserId, () -> {
            settleProductQuota(outcome.decision());
            // Explicit claim guard first (work_item_id + token + fence, never a GUC).
            finalizeService.assertActiveClaim(
                    ownerUserId, claim.id(), claim.claimToken(), claim.claimFence());
            long candidateId = finalizeService.insertCandidate(ownerUserId, generationId, content);
            stateService.promote(ownerUserId, generationId, GenerationStateService.FINAL_REVIEW);
            if (pausedDeltas > 0) {
                // With substring rules a pause implies a final block, so this
                // is unreachable today; recorded anyway so the audit trail can
                // never silently drop a paused fragment.
                safetyEventService.record(
                        ownerUserId, generationId, SafetyEventService.STAGE_INCREMENTAL,
                        finalReview.riskLevel().code(), "incremental-pause-allowed-final");
            }
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
                    actualCostUsd,
                    "USD",
                    1,
                    false);
            metrics.tokens("input", inputTokens);
            metrics.tokens("output", outputTokens);
            enqueueMemoryExtract(ownerUserId, generationId);
            // CONV-SUMMARY (§11.18): external success updates the L2 summary
            // inside the same guarded transaction; the SD's quality floor may
            // skip the write (低质不覆盖高质) — that skip is a normal outcome.
            // Incognito conversations never update summaries (FR-CHAT-005).
            if (!conversationRepository.isIncognitoForGeneration(ownerUserId, generationId)) {
                summaryService.recordTurnSummary(ownerUserId, generationId);
            }
            int rows = finalizeService.completeWorkItem(
                    claim.id(), claim.claimToken(), claim.claimFence());
            if (rows != 1) {
                throw new IllegalStateException(
                        "per-item complete inside the guarded finalize returned rows=" + rows);
            }
        });
        log.info("generation {} completed via external provider for owner {} (candidate in={} out={})",
                generationId, ownerUserId, inputTokens, outputTokens);
        return false;
    }

    /**
     * Guarded finalize tx for the ZERO_LLM deterministic completion.
     *
     * <p>SAFETY-WIRE note: the ZERO_LLM response is the platform-authored
     * constant (DeterministicSafetyResponse), so no final review runs here —
     * there is no model output to review. The input side was already
     * classified at intake.
     */
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
     *  mode, and the STREAM-LIVE stream (epoch, first reserved delta seq).
     *  {@code refusedSupplier} is non-null when the circuit gate refused the
     *  outbound before any attempt intent was written. */
    private record Prepared(
            LiveModelInvoker invokerValue,
            PreparedInvocation invocationValue,
            String degradeFault,
            String refusedSupplier,
            boolean externalMode,
            long streamEpoch,
            long firstDeltaSeq) {

        static Prepared degrade(String fault) {
            return new Prepared(null, null, fault, null, false, 0L, 0L);
        }

        static Prepared refused(String supplierName) {
            return new Prepared(null, null, null, supplierName, false, 0L, 0L);
        }
    }
}
