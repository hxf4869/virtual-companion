package com.virtualcompanion.runtime.generation.web;

import com.virtualcompanion.platform.persistence.GenerationReceiveService;
import com.virtualcompanion.platform.persistence.GenerationReceiveService.ReceivedGeneration;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.GenerationRecord;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.WorkItemEnqueueService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Generation HTTP vertical slice (TASK-0174).
 *
 * <ul>
 *   <li>{@code POST /api/v1/conversations/{conversationId}/generations} —
 *       idempotent intake ({@code vc.receive_generation}) followed by enqueuing
 *       a {@code GENERATION} work item on first creation. The coordinator polls
 *       the work item and the {@code GenerationWorkItemHandler} runs the model
 *       and finalizes.</li>
 *   <li>{@code GET /api/v1/generations/{generationId}/snapshot} — owner-scoped
 *       status + realtime events for client polling.</li>
 * </ul>
 *
 * <p>Authenticated: the principal's account id is the owner id and the owner
 * GUC is bound upstream by the owner-injection filter. Enqueue happens only on
 * first creation ({@code created=true}); duplicate idempotency keys resolve to
 * the same logical generation without re-enqueuing.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class GenerationController {

    private static final String WORK_ITEM_KIND = "GENERATION";

    private final GenerationReceiveService receiveService;
    private final WorkItemEnqueueService enqueueService;
    private final GenerationRepository generationRepository;
    private final GenerationStateService generationStateService;

    public GenerationController(
            GenerationReceiveService receiveService,
            WorkItemEnqueueService enqueueService,
            GenerationRepository generationRepository,
            GenerationStateService generationStateService) {
        this.receiveService = receiveService;
        this.enqueueService = enqueueService;
        this.generationRepository = generationRepository;
        this.generationStateService = generationStateService;
    }

    @PostMapping("/conversations/{conversationId}/generations")
    public GenerationResponse sendGeneration(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String conversationId,
            @Valid @RequestBody SendGenerationRequest request) {
        long conversation = parseId(conversationId, "conversationId");

        ReceivedGeneration received = receiveService.receive(
                ownerUserId,
                conversation,
                request.idempotencyKey(),
                GenerationReceiveService.DEFAULT_USER_ROLE,
                request.userContent());

        // Enqueue only on first creation; a duplicate reception resolves to the
        // same logical generation and must not produce a second work item.
        if (received.created()) {
            enqueueService.enqueue(ownerUserId, WORK_ITEM_KIND, received.generationId());
        }

        GenerationRecord record = generationRepository
                .find(ownerUserId, received.generationId())
                .orElseThrow(() -> new IllegalStateException(
                        "generation " + received.generationId() + " not found after receive"));
        return new GenerationResponse(
                record.id(),
                record.conversationId(),
                record.logicalGenerationId(),
                record.status());
    }

    @GetMapping("/generations/{generationId}/snapshot")
    public GenerationSnapshotResponse snapshot(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String generationId) {
        long generation = parseId(generationId, "generationId");
        GenerationStateService.GenerationSnapshot snapshot =
                generationStateService.readSnapshot(ownerUserId, generation);
        return new GenerationSnapshotResponse(
                snapshot.status(),
                snapshot.assistantMessageId(),
                snapshot.eventsJson());
    }

    private static long parseId(String raw, String name) {
        try {
            long parsed = Long.parseLong(raw);
            if (parsed <= 0) {
                throw new IllegalArgumentException(name + " must be positive");
            }
            return parsed;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " is not a valid id: " + raw, e);
        }
    }

    /** Intake request body (OpenAPI {@code SendGenerationRequest}). */
    public record SendGenerationRequest(
            @NotBlank @Size(max = 128) String idempotencyKey,
            @Size(max = 4096) String userContent) {
    }

    /** Generation response (OpenAPI {@code Generation}). */
    public record GenerationResponse(
            long generationId,
            long conversationId,
            String logicalGenerationId,
            String status) {
    }

    /** Snapshot response (OpenAPI {@code GenerationSnapshot}). */
    public record GenerationSnapshotResponse(
            String status,
            Long assistantMessageId,
            String events) {
    }
}
