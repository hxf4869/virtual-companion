package com.virtualcompanion.runtime.memory.web;

import com.virtualcompanion.platform.persistence.MemoryEvidenceRecord;
import com.virtualcompanion.platform.persistence.MemoryRecord;
import com.virtualcompanion.platform.persistence.MemoryService;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Memory management HTTP API (TASK-0180). Implements the 8 OpenAPI memory
 * endpoints backed by the V11/V12/V13 SECURITY DEFINER functions:
 * <ul>
 *   <li>{@code POST /api/v1/relationships/{relationshipId}/memories/candidates}
 *       — create a PENDING_CONFIRMATION candidate from model extraction
 *       (foreign relationship → 404);</li>
 *   <li>{@code GET /api/v1/relationships/{relationshipId}/memories} — list the
 *       relationship's memory (foreign relationship → 200 empty page, no 404);</li>
 *   <li>{@code GET /api/v1/memories/{memoryId}} — fetch one non-deleted
 *       memory (foreign/absent/deleted → 404);</li>
 *   <li>{@code PATCH /api/v1/memories/{memoryId}} — edit the summary
 *       (status-preserving; dead-end status → 404);</li>
 *   <li>{@code DELETE /api/v1/memories/{memoryId}} — soft-delete (200 with the
 *       pre-delete snapshot; foreign/absent/already-deleted → 404);</li>
 *   <li>{@code POST /api/v1/memories/{memoryId}/confirm} — PENDING_CONFIRMATION
 *       → ACCEPTED, the sole canonical path (INV-MEM-002; non-pending → 404);</li>
 *   <li>{@code POST /api/v1/memories/{memoryId}/reject} — PENDING_CONFIRMATION
 *       → REJECTED (non-pending → 404);</li>
 *   <li>{@code GET /api/v1/memories/{memoryId}/evidence} — the source Evidence
 *       chain (foreign/absent/deleted → 200 empty array, no 404).</li>
 * </ul>
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner GUC is
 * bound upstream by the owner-injection filter so every V11/V12/V13 call runs
 * in the server-trusted tenant context. A foreign or absent resource maps to
 * 404 {@code NOT_FOUND_OR_FORBIDDEN} so existence is never disclosed.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class MemoryController {

    private final MemoryService memoryService;

    public MemoryController(MemoryService memoryService) {
        this.memoryService = memoryService;
    }

    @PostMapping("/relationships/{relationshipId}/memories/candidates")
    public MemoryResponse createMemoryCandidate(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId,
            @Valid @RequestBody MemoryCandidateCreateRequest request) {
        long relationship = parseId(relationshipId, "relationshipId");
        Long conversationId = parseOptionalLong(request.conversationId(), "conversationId");
        MemoryRecord record = memoryService
                .create(ownerUserId, relationship, request.scope(), request.summary(),
                        conversationId, request.evidence())
                .orElseThrow(() -> new ResourceNotFoundException("relationship"));
        return toMemoryResponse(record);
    }

    @GetMapping("/relationships/{relationshipId}/memories")
    public List<MemoryResponse> listMemories(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId,
            @RequestParam(name = "includeDeleted", required = false) String includeDeleted) {
        long relationship = parseId(relationshipId, "relationshipId");
        Boolean include = parseOptionalBoolean(includeDeleted);
        return memoryService.list(ownerUserId, relationship, include).stream()
                .map(MemoryController::toMemoryResponse)
                .toList();
    }

    @GetMapping("/memories/{memoryId}")
    public MemoryResponse getMemory(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String memoryId) {
        long id = parseId(memoryId, "memoryId");
        return memoryService.get(ownerUserId, id)
                .map(MemoryController::toMemoryResponse)
                .orElseThrow(() -> new ResourceNotFoundException("memory"));
    }

    @PatchMapping("/memories/{memoryId}")
    public MemoryResponse updateMemory(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String memoryId,
            @Valid @RequestBody MemoryUpdateRequest request) {
        long id = parseId(memoryId, "memoryId");
        return memoryService.update(ownerUserId, id, request.summary())
                .map(MemoryController::toMemoryResponse)
                .orElseThrow(() -> new ResourceNotFoundException("memory"));
    }

    @DeleteMapping("/memories/{memoryId}")
    public MemoryResponse deleteMemory(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String memoryId) {
        long id = parseId(memoryId, "memoryId");
        return memoryService.delete(ownerUserId, id)
                .map(MemoryController::toMemoryResponse)
                .orElseThrow(() -> new ResourceNotFoundException("memory"));
    }

    @PostMapping("/memories/{memoryId}/confirm")
    public MemoryResponse confirmMemoryCandidate(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String memoryId) {
        long id = parseId(memoryId, "memoryId");
        return memoryService.confirm(ownerUserId, id)
                .map(MemoryController::toMemoryResponse)
                .orElseThrow(() -> new ResourceNotFoundException("memory"));
    }

    @PostMapping("/memories/{memoryId}/reject")
    public MemoryResponse rejectMemoryCandidate(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String memoryId) {
        long id = parseId(memoryId, "memoryId");
        return memoryService.reject(ownerUserId, id)
                .map(MemoryController::toMemoryResponse)
                .orElseThrow(() -> new ResourceNotFoundException("memory"));
    }

    @GetMapping("/memories/{memoryId}/evidence")
    public List<MemoryEvidenceResponse> listMemoryEvidence(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String memoryId) {
        long id = parseId(memoryId, "memoryId");
        return memoryService.listEvidence(ownerUserId, id).stream()
                .map(MemoryController::toEvidenceResponse)
                .toList();
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

    private static Long parseOptionalLong(String raw, String name) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " is not a valid id: " + raw, e);
        }
    }

    /** Strict boolean parse: only {@code true}/{@code false} (case-insensitive)
     *  are accepted, so a malformed query value fails as 400 instead of being
     *  silently coerced by {@code Boolean.parseBoolean}. */
    private static Boolean parseOptionalBoolean(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        if ("true".equalsIgnoreCase(raw)) {
            return Boolean.TRUE;
        }
        if ("false".equalsIgnoreCase(raw)) {
            return Boolean.FALSE;
        }
        throw new IllegalArgumentException("includeDeleted must be true or false: " + raw);
    }

    private static MemoryResponse toMemoryResponse(MemoryRecord record) {
        return new MemoryResponse(
                record.id(),
                record.scope(),
                record.summary(),
                record.status(),
                record.conversationId() == null ? null : record.conversationId().toString(),
                record.createdAt() == null ? null : record.createdAt().toString(),
                record.deletedAt() == null ? null : record.deletedAt().toString());
    }

    private static MemoryEvidenceResponse toEvidenceResponse(MemoryEvidenceRecord record) {
        return new MemoryEvidenceResponse(
                record.id(),
                record.sourceRef(),
                record.createdAt() == null ? null : record.createdAt().toString());
    }

    /** Request body (OpenAPI {@code MemoryCandidateCreateRequest}). */
    public record MemoryCandidateCreateRequest(
            @NotBlank String scope,
            @NotBlank String summary,
            String conversationId,
            List<String> evidence) {
    }

    /** Request body (OpenAPI {@code MemoryUpdateRequest}). */
    public record MemoryUpdateRequest(@NotBlank String summary) {
    }

    /** Response body (OpenAPI {@code Memory}). */
    public record MemoryResponse(
            long memoryId,
            String scope,
            String summary,
            String status,
            String conversationId,
            String createdAt,
            String deletedAt) {
    }

    /** Response body (OpenAPI {@code MemoryEvidence}). */
    public record MemoryEvidenceResponse(
            long evidenceId,
            String sourceRef,
            String createdAt) {
    }
}
