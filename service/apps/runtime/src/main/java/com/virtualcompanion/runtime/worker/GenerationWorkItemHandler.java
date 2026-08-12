package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.WorkItemClaim;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;

import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;

/**
 * Generation work-item handler (TASK-0174). Replaces the
 * {@code LoggingWorkItemHandler} stub for {@code kind='GENERATION'} items.
 *
 * <p>Runs inside the worker's owner-bound transaction (the coordinator claimed
 * the batch and bound {@code vc.owner_user_id} + {@code vc.job_fence}), so
 * every {@code vc.*} SECURITY DEFINER call here executes in the correct
 * server-trusted tenant context.
 *
 * <p>Lifecycle per item:
 * <ol>
 *   <li>promote the generation {@code CREATED → IN_PROGRESS} (V25);</li>
 *   <li>when a {@link LiveModelInvoker} bean is absent
 *       ({@code model-providers.enabled=false}) or the model integration is
 *       not yet wired, terminate the generation as {@code FAILED_FINAL} with a
 *       recorded fault and return normally — the worker then completes the
 *       work item. This keeps the HTTP → work-item → handler → finalize
 *       pipeline observable end-to-end without a live provider.</li>
 * </ol>
 *
 * <p>The live model invocation path (build a {@code LiveInvocationRequest} from
 * the generation snapshot, invoke the engine, persist the provider attempt /
 * candidate, promote to {@code FINAL_REVIEW} and call {@code finalize_generation})
 * is the subject of a follow-up card: the request requires routing inputs
 * (authorization snapshot id, entitlement, protocol selection) that are
 * configured alongside the provider deployment. Until that wiring exists the
 * handler degrades every claimed generation to {@code FAILED_FINAL} so no
 * generation is left stuck in {@code CREATED}.
 */
public class GenerationWorkItemHandler implements WorkItemHandler {

    private static final Logger log = LoggerFactory.getLogger(GenerationWorkItemHandler.class);

    static final String KIND_GENERATION = "GENERATION";
    private static final String TERMINAL_EVENT = "chat.failed";

    private final GenerationStateService stateService;
    private final JdbcTemplate jdbcTemplate;
    private final ObjectProvider<LiveModelInvoker> liveModelInvokerProvider;

    public GenerationWorkItemHandler(
            GenerationStateService stateService,
            JdbcTemplate jdbcTemplate,
            ObjectProvider<LiveModelInvoker> liveModelInvokerProvider) {
        this.stateService = stateService;
        this.jdbcTemplate = jdbcTemplate;
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

            String fault = resolveFault();
            terminalizeAsFailed(ownerUserId, generationId, fault);
            log.info("generation {} terminated as FAILED_FINAL for owner {} (fault={})",
                    generationId, ownerUserId, fault);
        } catch (RuntimeException e) {
            log.error("generation handler failed for owner={} generation={}",
                    ownerUserId, generationId, e);
            // Best-effort terminalization so the generation is not stuck; if this
            // also fails the worker's fail_work_item still records the batch.
            safeTerminalize(ownerUserId, generationId, "handler-exception");
            throw e;
        }
    }

    /**
     * Determine why the live model path is unavailable. When the invoker bean
     * exists the handler still degrades (the request wiring is a follow-up),
     * but the fault string distinguishes the two cases.
     */
    private String resolveFault() {
        LiveModelInvoker invoker = liveModelInvokerProvider.getIfAvailable();
        return invoker == null ? "model-providers-disabled" : "model-integration-pending";
    }

    private void terminalizeAsFailed(long ownerUserId, long generationId, String fault) {
        jdbcTemplate.queryForObject(
                "SELECT vc.terminalize_generation(?, ?, ?, ?, ?)",
                String.class,
                ownerUserId,
                generationId,
                "FAILED_FINAL",
                TERMINAL_EVENT,
                "{\"fault\":\"" + fault + "\"}");
    }

    private void safeTerminalize(long ownerUserId, long generationId, String fault) {
        try {
            terminalizeAsFailed(ownerUserId, generationId, fault);
        } catch (RuntimeException suppressed) {
            log.warn("post-exception terminalize also failed for generation={}; {}",
                    generationId, suppressed.getMessage());
        }
    }
}
