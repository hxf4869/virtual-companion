package com.virtualcompanion.runtime.conversation.web;

import com.virtualcompanion.platform.persistence.ConversationCreateService;
import com.virtualcompanion.platform.persistence.ConversationListRecord;
import com.virtualcompanion.platform.persistence.ConversationListService;
import com.virtualcompanion.platform.persistence.ConversationRepository;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import jakarta.validation.constraints.Size;
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
 * Conversation intake and listing (TASK-0174, CONV-HIST). {@code POST} opens a
 * conversation row under one of the owner's relationships (V25); {@code GET}
 * lists the caller's conversations keyset-paginated with a last-message
 * preview (V30), optionally scoped to one relationship.
 *
 * <p>Both endpoints are authenticated ({@code anyRequest().authenticated()});
 * the authenticated principal's account id is the owner id, and the owner GUC
 * is already bound upstream by the owner-injection filter so the V25/V30
 * SECURITY DEFINER functions execute inside the server-trusted owner context.
 * A foreign or absent relationship filter resolves to an empty page — the
 * OpenAPI contract has no 404 for the list endpoint.
 */
@RestController
@RequestMapping("/api/v1/conversations")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class ConversationController {

    private final ConversationCreateService conversationCreateService;
    private final ConversationListService conversationListService;
    private final ConversationRepository conversationRepository;

    public ConversationController(
            ConversationCreateService conversationCreateService,
            ConversationListService conversationListService,
            ConversationRepository conversationRepository) {
        this.conversationCreateService = conversationCreateService;
        this.conversationListService = conversationListService;
        this.conversationRepository = conversationRepository;
    }

    @PostMapping
    public ConversationResponse create(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @RequestBody CreateConversationRequest request) {
        long conversationId = conversationCreateService.create(
                ownerUserId, request.relationshipId(), request.incognitoFlag());
        return new ConversationResponse(conversationId);
    }

    @GetMapping
    public List<ConversationListResponse> list(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @RequestParam(name = "relationshipId", required = false) String relationshipId,
            @RequestParam(name = "after", required = false) String after,
            @RequestParam(name = "limit", required = false) String limit) {
        Long relationship = parseOptionalLong(relationshipId, "relationshipId");
        Long afterId = parseOptionalLong(after, "after");
        Integer pageLimit = parseOptionalInt(limit, "limit");
        return conversationListService
                .listConversations(ownerUserId, relationship, afterId, pageLimit)
                .stream()
                .map(ConversationController::toResponse)
                .toList();
    }

    /**
     * CONV-MGMT (V32): delete one conversation. In-flight work items are
     * cancelled and dependent rows cascade inside the SD function. A foreign
     * or absent id maps to 404 NOT_FOUND_OR_FORBIDDEN (existence undisclosed).
     */
    @DeleteMapping("/{conversationId}")
    public ConversationDeletedResponse delete(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String conversationId) {
        long id = parseRequiredLong(conversationId, "conversationId");
        if (!conversationRepository.delete(ownerUserId, id)) {
            throw new ResourceNotFoundException("conversation");
        }
        return new ConversationDeletedResponse(true);
    }

    /**
     * CONV-MGMT (V32): rename one conversation (blank title clears it). A
     * foreign or absent id maps to 404 NOT_FOUND_OR_FORBIDDEN.
     */
    @PatchMapping("/{conversationId}")
    public ConversationRenamedResponse rename(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String conversationId,
            @RequestBody RenameConversationRequest request) {
        long id = parseRequiredLong(conversationId, "conversationId");
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        if (!conversationRepository.rename(ownerUserId, id, request.title())) {
            throw new ResourceNotFoundException("conversation");
        }
        return new ConversationRenamedResponse(id, request.title());
    }

    private static long parseRequiredLong(String raw, String name) {
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

    private static Integer parseOptionalInt(String raw, String name) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " is not a valid number: " + raw, e);
        }
    }

    private static ConversationListResponse toResponse(ConversationListRecord record) {
        return new ConversationListResponse(
                record.id(),
                record.relationshipId(),
                record.lastMessageRole(),
                record.lastMessagePreview(),
                record.createdAt().toString(),
                record.title(),
                record.incognito());
    }

    /**
     * Request body: the relationship under which to open the conversation and
     * the optional creation-time incognito flag. {@code incognito} is a boxed
     * Boolean so an omitted JSON field deserializes cleanly (a missing
     * primitive would fail message conversion); absent means false.
     */
    public record CreateConversationRequest(long relationshipId, Boolean incognito) {
        public CreateConversationRequest {
            if (relationshipId <= 0) {
                throw new IllegalArgumentException("relationshipId must be positive");
            }
        }

        /** INC-MODE: absent flag means false. */
        public boolean incognitoFlag() {
            return Boolean.TRUE.equals(incognito);
        }
    }

    /** Response body: the newly allocated conversation id. */
    public record ConversationResponse(long conversationId) {
    }

    /** Response body (OpenAPI {@code ConversationListItem}). */
    public record ConversationListResponse(
            long conversationId,
            long relationshipId,
            String lastMessageRole,
            String lastMessagePreview,
            String createdAt,
            String title,
            boolean incognito) {
    }

    /** CONV-MGMT: {@code DELETE /api/v1/conversations/{id}} result. */
    public record ConversationDeletedResponse(boolean ok) {
    }

    /** CONV-MGMT: {@code PATCH /api/v1/conversations/{id}} result. */
    public record ConversationRenamedResponse(long conversationId, String title) {
    }

    /** CONV-MGMT: rename body (OpenAPI {@code RenameConversationRequest}). */
    public record RenameConversationRequest(@Size(max = 200) String title) {
    }
}
