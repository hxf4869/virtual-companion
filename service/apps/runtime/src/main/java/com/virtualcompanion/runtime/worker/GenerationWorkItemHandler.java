package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.modelruntime.execution.LiveAttemptOutcome;
import com.virtualcompanion.modelruntime.execution.LiveAttemptTerminal;
import com.virtualcompanion.modelruntime.execution.LiveInvocationRequest;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.WorkItemClaim;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;

/**
 * Generation work-item handler (TASK-0174 wiring, TASK-0176 ZERO_LLM completion).
 * Handles {@code kind='GENERATION'} items inside the worker's owner-bound
 * transaction (the coordinator claimed the batch and bound
 * {@code vc.owner_user_id} + {@code vc.job_fence}), so every {@code vc.*}
 * SECURITY DEFINER call here executes in the correct server-trusted tenant
 * context.
 *
 * <p>Lifecycle per item:
 * <ol>
 *   <li>promote the generation {@code CREATED → IN_PROGRESS} (V25);</li>
 *   <li>when a {@link LiveModelInvoker} bean is available (ZERO_LLM runtime
 *       enabled), assemble a ZERO_LLM {@code LiveInvocationRequest}, invoke the
 *       engine, and on a {@code ZERO_LLM_COMPLETED} outcome finalize the
 *       deterministic output as {@code COMPLETED}: insert a candidate, promote
 *       to {@code FINAL_REVIEW}, and run the atomic {@code finalize_generation}
 *       (V7) which writes the final message, COMPLETED terminal, zero-token
 *       usage, {@code chat.completed} event and no outbox (the deterministic
 *       fallback string must not produce a memory candidate);</li>
 *   <li>when the invoker bean is absent ({@code model-providers.enabled=false}
 *       and {@code zero-llm.enabled=false}) or the outcome is not the expected
 *       ZERO_LLM completion, terminate the generation as {@code FAILED_FINAL}
 *       so no generation is left stuck in {@code CREATED}/{@code IN_PROGRESS}.</li>
 * </ol>
 *
 * <p>The real external provider success path (build a request from a live
 * authorization snapshot, record a provider attempt, route to an admitted
 * adapter) is the subject of a follow-up card; the ZERO_LLM path is the minimal
 * deterministic completion that needs no provider, credential or adapter.
 */
public class GenerationWorkItemHandler implements WorkItemHandler {

    private static final Logger log = LoggerFactory.getLogger(GenerationWorkItemHandler.class);

    static final String KIND_GENERATION = "GENERATION";

    private final GenerationStateService stateService;
    private final GenerationFinalizeService finalizeService;
    private final LiveInvocationAssembler assembler;
    private final ObjectProvider<LiveModelInvoker> liveModelInvokerProvider;

    public GenerationWorkItemHandler(
            GenerationStateService stateService,
            GenerationFinalizeService finalizeService,
            LiveInvocationAssembler assembler,
            ObjectProvider<LiveModelInvoker> liveModelInvokerProvider) {
        this.stateService = stateService;
        this.finalizeService = finalizeService;
        this.assembler = assembler;
        this.liveModelInvokerProvider = liveModelInvokerProvider;
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
            completeViaZeroLlm(invoker, ownerUserId, generationId);
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

    private void safeTerminalize(long ownerUserId, long generationId, String fault) {
        try {
            finalizeService.terminalizeAsFailed(ownerUserId, generationId, fault);
        } catch (RuntimeException suppressed) {
            log.warn("post-exception terminalize also failed for generation={}; {}",
                    generationId, suppressed.getMessage());
        }
    }
}
