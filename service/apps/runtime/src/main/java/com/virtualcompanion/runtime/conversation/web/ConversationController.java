package com.virtualcompanion.runtime.conversation.web;

import com.virtualcompanion.platform.persistence.ConversationCreateService;
import com.virtualcompanion.platform.persistence.ConversationListRecord;
import com.virtualcompanion.platform.persistence.ConversationListService;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
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

    public ConversationController(
            ConversationCreateService conversationCreateService,
            ConversationListService conversationListService) {
        this.conversationCreateService = conversationCreateService;
        this.conversationListService = conversationListService;
    }

    @PostMapping
    public ConversationResponse create(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @RequestBody CreateConversationRequest request) {
        long conversationId = conversationCreateService.create(ownerUserId, request.relationshipId());
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
                record.createdAt().toString());
    }

    /** Request body: the relationship under which to open the conversation. */
    public record CreateConversationRequest(long relationshipId) {
        public CreateConversationRequest {
            if (relationshipId <= 0) {
                throw new IllegalArgumentException("relationshipId must be positive");
            }
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
            String createdAt) {
    }
}
