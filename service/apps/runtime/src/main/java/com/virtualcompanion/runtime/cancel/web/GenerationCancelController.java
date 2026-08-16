package com.virtualcompanion.runtime.cancel.web;

import com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry;
import com.virtualcompanion.platform.persistence.GenerationCancelService;
import com.virtualcompanion.platform.persistence.GenerationRecord;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Generation cancellation HTTP API (TASK-0179). Implements the OpenAPI
 * {@code cancelGeneration} endpoint backed by the V10
 * {@code vc.cancel_generation} SECURITY DEFINER function.
 *
 * <p>A cancellable non-terminal generation (CREATED / INPUT_REVIEW / QUEUED /
 * IN_PROGRESS / WAITING_FOR_CAPACITY / FINAL_REVIEW) transitions to CANCELLED
 * via the catalog double-hop; COMMITTING and terminal states are not
 * cancellable and surface as 400 INVALID_REQUEST (the OpenAPI contract defines
 * no dedicated status for the state conflict). A foreign or absent id maps to
 * 404 NOT_FOUND_OR_FORBIDDEN so existence is never disclosed.
 *
 * <p>CANCEL-A: after the database terminal state transition succeeds, the
 * process-local {@link ActiveInvocationRegistry} forwards the cooperative
 * cancel signal into the in-flight provider session (single-runtime Technical
 * Alpha assumption). The registry is best-effort and optional — it exists only
 * while the model-provider runtime is wired; the DB state stays the source of
 * truth and the V28 claim guard still rejects any late finalize.
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner GUC
 * is bound upstream by the owner-injection filter so the V10 call runs in the
 * server-trusted tenant context.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class GenerationCancelController {

    private final GenerationCancelService generationCancelService;
    private final ObjectProvider<ActiveInvocationRegistry> activeInvocationRegistry;

    public GenerationCancelController(
            GenerationCancelService generationCancelService,
            ObjectProvider<ActiveInvocationRegistry> activeInvocationRegistry) {
        this.generationCancelService = generationCancelService;
        this.activeInvocationRegistry = activeInvocationRegistry;
    }

    @PostMapping("/generations/{generationId}/cancel")
    public GenerationResponse cancel(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String generationId) {
        long generation = parseId(generationId);
        GenerationRecord record = generationCancelService
                .cancel(ownerUserId, generation)
                .orElseThrow(() -> new ResourceNotFoundException("generation"));
        ActiveInvocationRegistry registry = activeInvocationRegistry.getIfAvailable();
        if (registry != null) {
            registry.cancel(generation);
        }
        return new GenerationResponse(
                record.id(),
                record.conversationId(),
                record.logicalGenerationId(),
                record.status());
    }

    private static long parseId(String raw) {
        try {
            long parsed = Long.parseLong(raw);
            if (parsed <= 0) {
                throw new IllegalArgumentException("generationId must be positive");
            }
            return parsed;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("generationId is not a valid id: " + raw, e);
        }
    }

    /**
     * Response body (OpenAPI {@code Generation}).
     *
     * <p>Structurally identical to the {@code GenerationController} response;
     * it is declared here because the Spring Modulith application structure
     * forbids depending on a web-package type of the {@code generation} module
     * (and that package is a protected path that cannot add an exposes). The
     * wire format is unchanged.
     */
    public record GenerationResponse(
            long generationId,
            long conversationId,
            String logicalGenerationId,
            String status) {
    }
}
