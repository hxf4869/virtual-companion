package com.virtualcompanion.runtime.generation.web;

import com.virtualcompanion.platform.persistence.GenerationFeedbackRecord;
import com.virtualcompanion.platform.persistence.GenerationFeedbackService;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Generation feedback HTTP vertical slice (FEEDBACK / FR-CHAT-003).
 *
 * <p>{@code POST /api/v1/generations/{generationId}/feedback} records one
 * owner-scoped feedback row per (generation, kind) via the V35
 * {@code vc.record_generation_feedback} SECURITY DEFINER function. A repeated
 * submission of the same kind for the same generation is an idempotent no-op
 * (the first note wins). Unapproved kinds map to 400 INVALID_REQUEST via
 * {@link GenerationFeedbackService#normalizeKind}; a foreign or absent
 * generation maps to 404 NOT_FOUND_OR_FORBIDDEN so existence is never
 * disclosed.
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner GUC
 * is bound upstream by the owner-injection filter so the SD call runs in the
 * server-trusted tenant context.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class GenerationFeedbackController {

    private final GenerationFeedbackService feedbackService;

    public GenerationFeedbackController(GenerationFeedbackService feedbackService) {
        this.feedbackService = feedbackService;
    }

    @PostMapping("/generations/{generationId}/feedback")
    public FeedbackResponse recordFeedback(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String generationId,
            @Valid @RequestBody FeedbackCreateRequest request) {
        long generation = parseId(generationId, "generationId");
        // FEEDBACK: eager kind validation rejects unapproved codes with a 400.
        String kind = GenerationFeedbackService.normalizeKind(request.kind());
        GenerationFeedbackRecord recorded = feedbackService
                .record(ownerUserId, generation, kind, request.note())
                .orElseThrow(() -> new ResourceNotFoundException("generation"));
        return new FeedbackResponse(
                recorded.generationId(),
                recorded.kind(),
                recorded.note(),
                recorded.createdAt().toString());
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

    /** Intake request body (OpenAPI {@code GenerationFeedbackCreateRequest}). */
    public record FeedbackCreateRequest(
            @NotBlank String kind,
            @Size(max = GenerationFeedbackService.MAX_NOTE_LENGTH) String note) {
    }

    /** Feedback response (OpenAPI {@code GenerationFeedbackResponse}). */
    public record FeedbackResponse(
            long generationId,
            String kind,
            String note,
            String createdAt) {
    }
}
