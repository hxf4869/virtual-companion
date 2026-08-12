package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import com.virtualcompanion.modelruntime.execution.LiveAttemptOutcome;
import com.virtualcompanion.modelruntime.execution.LiveAttemptTerminal;
import com.virtualcompanion.modelruntime.execution.LiveInvocationRequest;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
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
 * completion, TASK-0177 external provider completion).
 * Handles {@code kind='GENERATION'} items inside the worker's owner-bound
 * transaction (the coordinator claimed the batch and bound
 * {@code vc.owner_user_id} + {@code vc.job_fence}), so every {@code vc.*}
 * SECURITY DEFINER call here executes in the correct server-trusted tenant
 * context.
 *
 * <p>Lifecycle per item:
 * <ol>
 *   <li>promote the generation {@code CREATED → IN_PROGRESS} (V25);</li>
 *   <li>when a {@link LiveModelInvoker} bean is available, choose the
 *       completion path by the active mode:
 *       <ul>
 *         <li><b>external</b> (an {@link AuthorizationSnapshotProvider} bean is
 *             present, i.e. {@code model-providers.enabled=true}): create the
 *             dual authorization snapshots, assemble an external
 *             {@code LiveInvocationRequest}, invoke the engine, and on
 *             {@code SUCCEEDED} record the {@code provider_attempt} bound to
 *             both snapshots (V20, INV-AUTH-001), insert the candidate, promote
 *             to {@code FINAL_REVIEW} and finalize with the real usage (V7);</li>
 *         <li><b>ZERO_LLM</b> (invoker present, no snapshot service): assemble a
 *             ZERO_LLM request and on {@code ZERO_LLM_COMPLETED} finalize the
 *             deterministic output as {@code COMPLETED} (zero-token usage, no
 *             outbox).</li>
 *       </ul>
 *   <li>when the invoker bean is absent, or the outcome is not a completion
 *       terminal, terminate the generation as {@code FAILED_FINAL} so no
 *       generation is left stuck. A degraded external outcome that already
 *       opened an adapter (FAILED / TIMED_OUT / CANCELLED) records its
 *       {@code provider_attempt} first; safety / auth denial and
 *       no-eligible-deployment happen before any outbound transfer and record
 *       nothing.</li>
 * </ol>
 *
 * <p>The real loopback-adapter end-to-end success (no fake adapter accepts an
 * {@code ExternalAttemptBinding} yet) and the real safety classifier are
 * follow-up cards; this handler proves the external persistence + audit chain
 * with a mocked invoker and a DB-level SD chain test.
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
        long ownerUserId = claim.ownerUserId();
        long generationId = claim.refId();
        try {
            stateService.promote(ownerUserId, generationId, GenerationStateService.IN_PROGRESS);

            LiveModelInvoker invoker = liveModelInvokerProvider.getIfAvailable();
            if (invoker == null) {
                finalizeService.terminalizeAsFailed(ownerUserId, generationId, "model-providers-disabled");
                log.info("generation {} terminated as FAILED_FINAL for owner {} (fault=model-providers-disabled)",
                        generationId, ownerUserId);
                return;
            }
            // External mode is active iff the real model-provider beans are wired
            // (model-providers.enabled=true wires both the invoker and the
            // AuthorizationSnapshotProvider). Otherwise the ZERO_LLM-only invoker
            // is present and the deterministic completion path runs.
            AuthorizationSnapshotProvider snapshotService =
                    authorizationSnapshotServiceProvider.getIfAvailable();
            if (snapshotService != null) {
                completeViaExternal(invoker, snapshotService, ownerUserId, generationId);
            } else {
                completeViaZeroLlm(invoker, ownerUserId, generationId);
            }
        } catch (RuntimeException e) {
            log.error("generation handler failed for owner={} generation={}",
                    ownerUserId, generationId, e);
            // Best-effort terminalization so the generation is not stuck; if this
            // also fails the worker's fail_work_item still records the batch.
            safeTerminalize(ownerUserId, generationId, "handler-exception");
            throw e;
        }
    }

    private void completeViaZeroLlm(
            LiveModelInvoker invoker, long ownerUserId, long generationId) {
        LiveInvocationRequest request = assembler.assemble(ownerUserId, generationId);
        LiveAttemptOutcome outcome = invoker.invoke(request);
        if (outcome.terminal() == LiveAttemptTerminal.ZERO_LLM_COMPLETED) {
            String content = outcome.response();
            long candidateId = finalizeService.insertCandidate(ownerUserId, generationId, content);
            stateService.promote(ownerUserId, generationId, GenerationStateService.FINAL_REVIEW);
            finalizeService.finalizeCompleted(
                    ownerUserId, generationId, candidateId, content, "", false);
            log.info("generation {} completed via ZERO_LLM for owner {} (candidate={})",
                    generationId, ownerUserId, candidateId);
            return;
        }
        finalizeService.terminalizeAsFailed(
                ownerUserId, generationId, "zero-llm-unexpected-outcome:" + outcome.terminal());
        log.warn("generation {} terminated as FAILED_FINAL for owner {} (unexpected outcome={})",
                generationId, ownerUserId, outcome.terminal());
    }

    /**
     * External-provider completion path (TASK-0177). Creates the dual
     * authorization snapshots, assembles the external request, invokes the
     * engine, and finalizes on {@code SUCCEEDED}. Every degraded terminal is
     * fail-closed to {@code FAILED_FINAL} (the generation sits in
     * {@code IN_PROGRESS} when the invoker returns — safety/auth denial and
     * no-eligible happen before any outbound transfer, so no
     * {@code provider_attempt} row exists; FAILED/TIMED_OUT/CANCELLED record
     * their audit first because a real outbound attempt happened).
     */
    private void completeViaExternal(
            LiveModelInvoker invoker,
            AuthorizationSnapshotProvider snapshotService,
            long ownerUserId,
            long generationId) {
        AuthorizationSnapshotProvider.SnapshotIds snapshots =
                snapshotService.createFor(ownerUserId, generationId);
        LiveInvocationRequest request = assembler.assembleExternal(
                ownerUserId, generationId, snapshots.requestedId(), snapshots.executionId());
        LiveAttemptOutcome outcome = invoker.invoke(request);
        LiveAttemptTerminal terminal = outcome.terminal();

        if (terminal == LiveAttemptTerminal.SUCCEEDED) {
            finalizeExternalSuccess(ownerUserId, generationId, outcome);
            return;
        }
        // A real outbound attempt happened iff the outcome carries an audit
        // (FAILED / TIMED_OUT / CANCELLED). Record it before terminalizing so
        // the audit chain binds the dual snapshots (INV-AUTH-001). The blocked
        // and no-eligible paths never opened an adapter, so nothing to record.
        if (outcome.externalAttemptCreated()) {
            recordExternalAttempt(ownerUserId, generationId, outcome);
        }
        String fault = "external-" + terminal.name().toLowerCase(java.util.Locale.ROOT);
        finalizeService.terminalizeAsFailed(ownerUserId, generationId, fault);
        log.warn("generation {} terminated as FAILED_FINAL for owner {} (external outcome={})",
                generationId, ownerUserId, terminal);
    }

    private void finalizeExternalSuccess(
            long ownerUserId, long generationId, LiveAttemptOutcome outcome) {
        InvocationBinding.ExternalAttemptBinding binding =
                (InvocationBinding.ExternalAttemptBinding) outcome.binding();
        ProviderAttemptAudit audit = outcome.audits().get(0);
        TokenUsage usage = outcome.usage();
        long inputTokens = usage == null ? 0L : usage.inputTokens();
        long outputTokens = usage == null ? 0L : usage.outputTokens();
        String content = outcome.response();

        // Record the real outbound attempt bound to both snapshots first
        // (INV-AUTH-001); the row is independent of generation state and
        // survives a later finalize fault (the attempt provably happened).
        finalizeService.recordProviderAttempt(
                ownerUserId,
                generationId,
                audit.providerId(),
                audit.supplierName(),
                audit.status().code(),
                binding.requestedAuthorizationSnapshotId(),
                binding.executionAuthorizationSnapshotId());

        long candidateId = finalizeService.insertCandidate(ownerUserId, generationId, content);
        stateService.promote(ownerUserId, generationId, GenerationStateService.FINAL_REVIEW);
        // outboxEligible=false: the memory Java domain is not yet wired, so do
        // not leave a dangling PENDING memory.extract outbox row. Real model
        // output memory extraction is a follow-up memory-domain task.
        finalizeService.finalizeCompletedWithUsage(
                ownerUserId,
                generationId,
                candidateId,
                content,
                audit.providerAttemptId(),
                inputTokens,
                outputTokens,
                0d,
                "USD",
                1,
                false);
        log.info("generation {} completed via external provider for owner {} (candidate={}, in={}, out={})",
                generationId, ownerUserId, candidateId, inputTokens, outputTokens);
    }

    private void recordExternalAttempt(
            long ownerUserId, long generationId, LiveAttemptOutcome outcome) {
        InvocationBinding.ExternalAttemptBinding binding =
                (InvocationBinding.ExternalAttemptBinding) outcome.binding();
        ProviderAttemptAudit audit = outcome.audits().get(0);
        finalizeService.recordProviderAttempt(
                ownerUserId,
                generationId,
                audit.providerId(),
                audit.supplierName(),
                audit.status().code(),
                binding.requestedAuthorizationSnapshotId(),
                binding.executionAuthorizationSnapshotId());
    }

    private void safeTerminalize(long ownerUserId, long generationId, String fault) {
        try {
            finalizeService.terminalizeAsFailed(ownerUserId, generationId, fault);
        } catch (RuntimeException suppressed) {
            log.warn("post-exception terminalize also failed for generation={}; {}",
                    generationId, suppressed.getMessage());
        }
    }
}
