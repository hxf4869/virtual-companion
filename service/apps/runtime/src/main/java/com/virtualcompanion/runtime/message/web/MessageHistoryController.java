package com.virtualcompanion.runtime.message.web;

import com.virtualcompanion.platform.persistence.MessageHistoryRecord;
import com.virtualcompanion.platform.persistence.MessageHistoryService;
import com.virtualcompanion.platform.persistence.MessageRepository;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import jakarta.validation.Valid;

/**
 * Paginated message history HTTP API (TASK-0179) plus single-message deletion
 * (MSG-DELETE / FR-CHAT-004). Implements the OpenAPI {@code listMessages} and
 * {@code deleteMessage} endpoints backed by the V10 {@code vc.list_messages}
 * and V37 {@code vc.delete_message} SECURITY DEFINER functions.
 *
 * <p>Keyset pagination: {@code after} is the last message id seen (opaque
 * cursor) and {@code limit} is clamped to a safe band by the server (default
 * 50, maximum 100). A foreign or absent conversation yields an empty page —
 * existence is never disclosed (the OpenAPI contract has no 404 for this
 * endpoint). The owning conversation id of every message is the path
 * conversation id.
 *
 * <p>MSG-DELETE: deleting a message also removes its memory_evidence rows
 * inside the SD; a foreign or absent message maps to 404
 * NOT_FOUND_OR_FORBIDDEN so existence is never disclosed.
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner GUC
 * is bound upstream by the owner-injection filter so the V10/V37 calls run in
 * the server-trusted tenant context.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class MessageHistoryController {

    private final MessageHistoryService messageHistoryService;
    private final MessageRepository messageRepository;

    public MessageHistoryController(
            MessageHistoryService messageHistoryService,
            MessageRepository messageRepository) {
        this.messageHistoryService = messageHistoryService;
        this.messageRepository = messageRepository;
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

    /** MSG-DELETE (V37): delete one message of the caller's conversation. */
    @DeleteMapping("/conversations/{conversationId}/messages/{messageId}")
    public MessageDeletedResponse deleteMessage(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String conversationId,
            @PathVariable String messageId) {
        long conversation = parseId(conversationId, "conversationId");
        long message = parseId(messageId, "messageId");
        boolean deleted = messageRepository.deleteMessage(ownerUserId, conversation, message);
        if (!deleted) {
            // Foreign or absent: existence is never disclosed.
            throw new ResourceNotFoundException("message");
        }
        return new MessageDeletedResponse(true);
    }

    /**
     * MEM-NEG (V44): flip the "不记住" negative-memory marker of one owned
     * message. A foreign or absent message maps to 404 NOT_FOUND_OR_FORBIDDEN
     * so existence is never disclosed; the response carries the updated
     * message state (including noMemory).
     */
    @PatchMapping("/conversations/{conversationId}/messages/{messageId}")
    public MessageResponse setNoMemory(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String conversationId,
            @PathVariable String messageId,
            @Valid @RequestBody MessageNoMemoryUpdate request) {
        long conversation = parseId(conversationId, "conversationId");
        long message = parseId(messageId, "messageId");
        boolean changed = messageRepository.setNoMemory(
                ownerUserId, conversation, message, request.noMemory());
        if (!changed) {
            throw new ResourceNotFoundException("message");
        }
        return messageHistoryService
                .listMessages(ownerUserId, conversation, message - 1, 1)
                .stream()
                .filter(record -> record.id() == message)
                .findFirst()
                .map(record -> toResponse(conversation, record))
                .orElseThrow(() -> new ResourceNotFoundException("message"));
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
                record.createdAt() == null ? null : record.createdAt().toString(),
                record.noMemory());
    }

    /** Response body (OpenAPI {@code Message}). */
    public record MessageResponse(
            long messageId,
            long conversationId,
            String role,
            String content,
            String createdAt,
            boolean noMemory) {
    }

    /** MEM-NEG (V44): body (OpenAPI {@code MessageNoMemoryUpdate}). */
    public record MessageNoMemoryUpdate(@NotNull Boolean noMemory) {
    }

    /** MSG-DELETE: response body (OpenAPI {@code MessageDeletedResponse}). */
    public record MessageDeletedResponse(boolean ok) {
    }
}
