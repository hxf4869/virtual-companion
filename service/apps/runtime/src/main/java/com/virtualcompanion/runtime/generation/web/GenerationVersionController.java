package com.virtualcompanion.runtime.generation.web;

import com.virtualcompanion.platform.persistence.GenerationVersionService;
import com.virtualcompanion.platform.persistence.GenerationVersionService.GenerationVersion;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * GEN-VER (FR-CHAT-003): list and select generation versions for one user
 * message. The default history only shows the selected assistant version.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class GenerationVersionController {

    private final GenerationVersionService generationVersionService;

    public GenerationVersionController(GenerationVersionService generationVersionService) {
        this.generationVersionService = generationVersionService;
    }

    @GetMapping("/messages/{messageId}/generation-versions")
    public List<GenerationVersionResponse> list(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String messageId) {
        return generationVersionService.list(ownerUserId, parseId(messageId, "messageId"))
                .stream()
                .map(GenerationVersionController::toResponse)
                .toList();
    }

    @PostMapping("/generations/{generationId}/select")
    public GenerationVersionResponse select(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String generationId) {
        long id = parseId(generationId, "generationId");
        if (!generationVersionService.select(ownerUserId, id)) {
            throw new ResourceNotFoundException("generation");
        }
        return generationVersionService.find(ownerUserId, id)
                .map(GenerationVersionController::toResponse)
                .orElseThrow(() -> new ResourceNotFoundException("generation"));
    }

    private static GenerationVersionResponse toResponse(GenerationVersion row) {
        return new GenerationVersionResponse(
                Long.toString(row.generationId()),
                row.selected(),
                row.status(),
                row.createdAt() == null ? null : row.createdAt().toString(),
                row.assistantMessageId() == null ? null : Long.toString(row.assistantMessageId()));
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

    public record GenerationVersionResponse(
            String generationId,
            boolean selected,
            String status,
            String createdAt,
            String assistantMessageId) {
    }
}
