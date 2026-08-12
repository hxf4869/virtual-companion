package com.virtualcompanion.runtime.relationship.web;

import com.virtualcompanion.platform.persistence.RelationshipRecord;
import com.virtualcompanion.platform.persistence.RelationshipService;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Relationship HTTP API (TASK-0178). Implements the OpenAPI relationship
 * endpoints backed by the V9 SECURITY DEFINER functions:
 * <ul>
 *   <li>{@code POST /api/v1/relationships} — create a Companion relationship
 *       (becomes the single active Companion; any prior active is deactivated);</li>
 *   <li>{@code GET /api/v1/relationships} — list the caller's relationships;</li>
 *   <li>{@code GET /api/v1/relationships/{relationshipId}} — fetch one;</li>
 *   <li>{@code POST /api/v1/relationships/{relationshipId}} — activate one
 *       (deactivates the others);</li>
 *   <li>{@code POST /api/v1/relationships/{relationshipId}/deactivate} —
 *       deactivate one (zero active Companions permitted).</li>
 * </ul>
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner GUC is
 * bound upstream by the owner-injection filter so every V9 call runs in the
 * server-trusted tenant context. A foreign or absent relationship id maps to
 * 404 {@code NOT_FOUND_OR_FORBIDDEN} so existence is never disclosed.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class RelationshipController {

    private final RelationshipService relationshipService;

    public RelationshipController(RelationshipService relationshipService) {
        this.relationshipService = relationshipService;
    }

    @PostMapping("/relationships")
    public RelationshipResponse create(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @Valid @RequestBody CreateRelationshipRequest request) {
        long id = relationshipService.create(ownerUserId, request.personaRef());
        RelationshipRecord record = relationshipService
                .get(ownerUserId, id)
                .orElseThrow(() -> new IllegalStateException(
                        "relationship " + id + " not found after create"));
        return toResponse(record);
    }

    @GetMapping("/relationships")
    public List<RelationshipResponse> list(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        return relationshipService.list(ownerUserId).stream()
                .map(RelationshipController::toResponse)
                .toList();
    }

    @GetMapping("/relationships/{relationshipId}")
    public RelationshipResponse get(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId) {
        long id = parseId(relationshipId);
        return relationshipService.get(ownerUserId, id)
                .map(RelationshipController::toResponse)
                .orElseThrow(() -> new ResourceNotFoundException("relationship"));
    }

    @PostMapping("/relationships/{relationshipId}")
    public RelationshipResponse activate(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId) {
        long id = parseId(relationshipId);
        return relationshipService.activate(ownerUserId, id)
                .map(RelationshipController::toResponse)
                .orElseThrow(() -> new ResourceNotFoundException("relationship"));
    }

    @PostMapping("/relationships/{relationshipId}/deactivate")
    public RelationshipResponse deactivate(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId) {
        long id = parseId(relationshipId);
        return relationshipService.deactivate(ownerUserId, id)
                .map(RelationshipController::toResponse)
                .orElseThrow(() -> new ResourceNotFoundException("relationship"));
    }

    private static long parseId(String raw) {
        try {
            long parsed = Long.parseLong(raw);
            if (parsed <= 0) {
                throw new IllegalArgumentException("id must be positive");
            }
            return parsed;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("id is not valid: " + raw, e);
        }
    }

    private static RelationshipResponse toResponse(RelationshipRecord record) {
        return new RelationshipResponse(
                record.id(),
                record.personaRef(),
                record.active(),
                record.createdAt() == null ? null : record.createdAt().toString());
    }

    /** Request body (OpenAPI {@code RelationshipCreateRequest}). */
    public record CreateRelationshipRequest(
            @NotBlank @Size(max = 128) String personaRef) {
    }

    /** Response body (OpenAPI {@code Relationship}). */
    public record RelationshipResponse(
            long relationshipId,
            String personaRef,
            boolean active,
            String createdAt) {
    }
}
