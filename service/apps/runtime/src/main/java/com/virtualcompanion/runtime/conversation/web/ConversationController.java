package com.virtualcompanion.runtime.conversation.web;

import com.virtualcompanion.platform.persistence.ConversationCreateService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Conversation intake (TASK-0174). Establishes a conversation row under one of
 * the owner's relationships so that generation requests can reference it.
 *
 * <p>The endpoint is authenticated ({@code anyRequest().authenticated()}); the
 * authenticated principal's account id is the owner id, and the owner GUC is
 * already bound upstream by the owner-injection filter so the V25
 * {@code vc.create_conversation} SECURITY DEFINER function executes inside the
 * server-trusted owner context.
 */
@RestController
@RequestMapping("/api/v1/conversations")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class ConversationController {

    private final ConversationCreateService conversationCreateService;

    public ConversationController(ConversationCreateService conversationCreateService) {
        this.conversationCreateService = conversationCreateService;
    }

    @PostMapping
    public ConversationResponse create(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @RequestBody CreateConversationRequest request) {
        long conversationId = conversationCreateService.create(ownerUserId, request.relationshipId());
        return new ConversationResponse(conversationId);
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
}
