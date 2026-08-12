package com.virtualcompanion.runtime.message.web;

import com.virtualcompanion.platform.persistence.MessageHistoryRecord;
import com.virtualcompanion.platform.persistence.MessageHistoryService;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Paginated message history HTTP API (TASK-0179). Implements the OpenAPI
 * {@code listMessages} endpoint backed by the V10
 * {@code vc.list_messages} SECURITY DEFINER function.
 *
 * <p>Keyset pagination: {@code after} is the last message id seen (opaque
 * cursor) and {@code limit} is clamped to a safe band by the server (default
 * 50, maximum 100). A foreign or absent conversation yields an empty page —
 * existence is never disclosed (the OpenAPI contract has no 404 for this
 * endpoint). The owning conversation id of every message is the path
 * conversation id.
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
public class MessageHistoryController {

    private final MessageHistoryService messageHistoryService;

    public MessageHistoryController(MessageHistoryService messageHistoryService) {
        this.messageHistoryService = messageHistoryService;
    }

    @GetMapping("/conversations/{conversationId}/messages")
    public List<MessageResponse> listMessages(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String conversationId,
            @RequestParam(name = "after", required = false) String after,
            @RequestParam(name = "limit", required = false) String limit) {
        long conversation = parseId(conversationId, "conversationId");
        Long afterId = parseOptionalLong(after, "after");
        Integer pageLimit = parseOptionalInt(limit, "limit");
        return messageHistoryService
                .listMessages(ownerUserId, conversation, afterId, pageLimit)
                .stream()
                .map(record -> toResponse(conversation, record))
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

    private static MessageResponse toResponse(long conversationId, MessageHistoryRecord record) {
        return new MessageResponse(
                record.id(),
                conversationId,
                record.role(),
                record.content(),
                record.createdAt() == null ? null : record.createdAt().toString());
    }

    /** Response body (OpenAPI {@code Message}). */
    public record MessageResponse(
            long messageId,
            long conversationId,
            String role,
            String content,
            String createdAt) {
    }
}
