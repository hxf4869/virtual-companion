package com.virtualcompanion.runtime.worker;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.virtualcompanion.platform.persistence.ConsentRecord;
import com.virtualcompanion.platform.persistence.ConsentService;
import com.virtualcompanion.platform.persistence.ConversationListRecord;
import com.virtualcompanion.platform.persistence.ConversationListService;
import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.MemoryRecord;
import com.virtualcompanion.platform.persistence.MemoryService;
import com.virtualcompanion.platform.persistence.MessageRepository;
import com.virtualcompanion.platform.persistence.RelationshipRecord;
import com.virtualcompanion.platform.persistence.RelationshipService;
import com.virtualcompanion.platform.persistence.ReminderRecord;
import com.virtualcompanion.platform.persistence.ReminderService;
import com.virtualcompanion.platform.persistence.WorkItemClaim;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Data-export work-item handler (DATA-EXPORT / FR-DATA-002).
 *
 * <p>Consumes {@code DATA_EXPORT} items enqueued by
 * {@code vc.create_export_request} (refId is the export request id). In one
 * owner-bound transaction it asserts the active claim (V28 token/fence),
 * aggregates the owner's data into the export document — conversations with
 * their full message history and per-message AI-content markers, memories
 * (including soft-deleted rows), reminders and the effective consent state —
 * serializes it to JSON, and seals the export as READY with a fresh one-time
 * download token and a short-lived expiry via {@code vc.complete_export}.
 * The per-item work-item complete runs in the same transaction; a failure
 * terminalizes the export as FAILED (best-effort, own transaction) and is
 * rethrown so the worker applies its independent per-item fail.
 *
 * <p>Technical Alpha stores the document inline (no object storage); the
 * expiry sweep ({@code vc.expire_stale_exports}) purges the payload, which is
 * the Alpha realization of 过期后自动删除对象存储文件. Conversation pages
 * are keyset-walked to their end, so the document is complete rather than
 * clamped to the first page.
 */
public class DataExportWorkItemHandler implements WorkItemHandler {

    private static final Logger log = LoggerFactory.getLogger(DataExportWorkItemHandler.class);

    /** Work-item kind handled here; also the dispatcher's DATA_EXPORT key. */
    public static final String KIND_DATA_EXPORT = "DATA_EXPORT";

    /** Stable FAILED reason (no user content ever lands in error_message). */
    static final String FAULT_EXPORT_FAILED = "export-failed";

    /** FR-DATA-002 包含 AI 生成内容标识 — plain-language notice in every document. */
    static final String AI_CONTENT_NOTICE =
            "本导出包含 AI 生成内容：role 为 assistant 的消息由 AI 模型生成，"
                    + "以 aiGenerated=true 标识，可能包含不准确信息。";

    /** Keyset page size when walking the owner's conversations to their end. */
    static final int CONVERSATION_PAGE = 100;

    private final GenerationFinalizeService finalizeService;
    private final ExportService exportService;
    private final RelationshipService relationshipService;
    private final ConversationListService conversationListService;
    private final MessageRepository messageRepository;
    private final MemoryService memoryService;
    private final ReminderService reminderService;
    private final ConsentService consentService;
    private final ObjectMapper objectMapper;
    private final Duration ttl;

    public DataExportWorkItemHandler(
            GenerationFinalizeService finalizeService,
            ExportService exportService,
            RelationshipService relationshipService,
            ConversationListService conversationListService,
            MessageRepository messageRepository,
            MemoryService memoryService,
            ReminderService reminderService,
            ConsentService consentService,
            ObjectMapper objectMapper,
            Duration ttl) {
        this.finalizeService = finalizeService;
        this.exportService = exportService;
        this.relationshipService = relationshipService;
        this.conversationListService = conversationListService;
        this.messageRepository = messageRepository;
        this.memoryService = memoryService;
        this.reminderService = reminderService;
        this.consentService = consentService;
        this.objectMapper = objectMapper.copy()
                .setSerializationInclusion(JsonInclude.Include.NON_NULL);
        this.ttl = ttl;
    }

    @Override
    public void handle(WorkItemClaim claim) {
        if (!KIND_DATA_EXPORT.equals(claim.kind())) {
            log.warn("data-export handler skipping non-DATA_EXPORT item kind={}", claim.kind());
            return;
        }
        WorkItemWorker.OwnerExecutor executor = WorkItemWorker.segmentExecutor();
        long ownerUserId = claim.ownerUserId();
        long exportId = claim.refId();
        try {
            executor.asOwner(ownerUserId, () -> buildAndSeal(ownerUserId, exportId, claim));
        } catch (RuntimeException e) {
            log.error(
                    "data-export handler failed for owner={} export={} workItem={}",
                    ownerUserId,
                    exportId,
                    claim.id(),
                    e);
            // Best-effort FAILED terminal state in its own owner transaction;
            // then rethrow so the worker fails the work item independently.
            markFailed(ownerUserId, exportId, executor);
            throw e;
        }
    }

    /** One owner-bound transaction: guard, aggregate, serialize, seal, complete. */
    private void buildAndSeal(long ownerUserId, long exportId, WorkItemClaim claim) {
        finalizeService.assertActiveClaim(
                ownerUserId, claim.id(), claim.claimToken(), claim.claimFence());
        ExportDocument document = buildDocument(ownerUserId, exportId);
        Instant expiresAt = Instant.now().plus(ttl);
        String payload = serialize(withExpiry(document, expiresAt));
        String token = UUID.randomUUID().toString();
        boolean sealed = exportService.complete(ownerUserId, exportId, payload, token, expiresAt);
        if (!sealed) {
            throw new IllegalStateException(
                    "complete_export moved 0 rows for owner=" + ownerUserId + " export=" + exportId);
        }
        int rows = finalizeService.completeWorkItem(
                claim.id(), claim.claimToken(), claim.claimFence());
        if (rows != 1) {
            throw new IllegalStateException(
                    "per-item complete inside data-export returned rows=" + rows);
        }
    }

    /** Best-effort FAILED terminal state (never blocks the worker's own fail). */
    private void markFailed(long ownerUserId, long exportId, WorkItemWorker.OwnerExecutor executor) {
        try {
            executor.asOwner(
                    ownerUserId, () -> exportService.fail(ownerUserId, exportId, FAULT_EXPORT_FAILED));
        } catch (RuntimeException suppressed) {
            log.error(
                    "failed to mark export {} FAILED for owner {}",
                    exportId,
                    ownerUserId,
                    suppressed);
        }
    }

    /**
     * Aggregate the owner's data. Conversations are keyset-walked to their end
     * (the list SD clamps pages to 1..100); the other sections are
     * relationship-scoped reads plus the effective consent state.
     */
    private ExportDocument buildDocument(long ownerUserId, long exportId) {
        List<ExportConversation> conversations = new ArrayList<>();
        Long afterId = null;
        while (true) {
            List<ConversationListRecord> page = conversationListService.listConversations(
                    ownerUserId, null, afterId, CONVERSATION_PAGE);
            if (page.isEmpty()) {
                break;
            }
            for (ConversationListRecord conversation : page) {
                List<MessageRepository.Message> messages =
                        messageRepository.listByConversation(ownerUserId, conversation.id());
                conversations.add(new ExportConversation(
                        String.valueOf(conversation.id()),
                        String.valueOf(conversation.relationshipId()),
                        conversation.title(),
                        conversation.incognito(),
                        messages.stream()
                                .map(DataExportWorkItemHandler::toExportMessage)
                                .toList()));
            }
            afterId = page.get(page.size() - 1).id();
        }

        List<ExportMemory> memories = new ArrayList<>();
        List<ExportReminder> reminders = new ArrayList<>();
        for (RelationshipRecord relationship : relationshipService.list(ownerUserId)) {
            for (MemoryRecord memory :
                    memoryService.list(ownerUserId, relationship.id(), Boolean.TRUE)) {
                memories.add(toExportMemory(memory));
            }
            for (ReminderRecord reminder :
                    reminderService.list(ownerUserId, relationship.id(), null, null)) {
                reminders.add(toExportReminder(reminder));
            }
        }

        List<ExportConsent> consents = consentService.list(ownerUserId).stream()
                .map(DataExportWorkItemHandler::toExportConsent)
                .toList();

        return new ExportDocument(
                String.valueOf(exportId),
                Instant.now().toString(),
                null,
                AI_CONTENT_NOTICE,
                conversations,
                memories,
                reminders,
                consents);
    }

    /** Stamp the document with the authoritative download expiry before sealing. */
    private static ExportDocument withExpiry(ExportDocument document, Instant expiresAt) {
        return new ExportDocument(
                document.exportId(),
                document.generatedAt(),
                expiresAt.toString(),
                document.aiContentNotice(),
                document.conversations(),
                document.memories(),
                document.reminders(),
                document.consents());
    }

    private String serialize(ExportDocument document) {
        try {
            return objectMapper.writeValueAsString(document);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("export document serialization failed", e);
        }
    }

    private static ExportMessage toExportMessage(MessageRepository.Message message) {
        return new ExportMessage(
                String.valueOf(message.id()),
                message.role(),
                message.content(),
                "assistant".equalsIgnoreCase(message.role()));
    }

    private static ExportMemory toExportMemory(MemoryRecord memory) {
        return new ExportMemory(
                String.valueOf(memory.id()),
                memory.relationshipId() == null ? null : String.valueOf(memory.relationshipId()),
                memory.scope(),
                memory.summary(),
                memory.status(),
                memory.createdAt().toString(),
                memory.deletedAt() == null ? null : memory.deletedAt().toString());
    }

    private static ExportReminder toExportReminder(ReminderRecord reminder) {
        return new ExportReminder(
                String.valueOf(reminder.id()),
                String.valueOf(reminder.relationshipId()),
                reminder.text(),
                reminder.remindAt().toString(),
                reminder.recurrence(),
                reminder.status());
    }

    private static ExportConsent toExportConsent(ConsentRecord consent) {
        return new ExportConsent(
                String.valueOf(consent.id()),
                consent.consentType(),
                consent.version(),
                consent.granted(),
                consent.grantedAt().toString(),
                consent.revokedAt() == null ? null : consent.revokedAt().toString());
    }

    /**
     * The serialized document (OpenAPI {@code ExportDownload}). expiresAt is
     * stamped by {@link #withExpiry} right before sealing, so every stored
     * document carries the authoritative download expiry.
     */
    record ExportDocument(
            String exportId,
            String generatedAt,
            String expiresAt,
            String aiContentNotice,
            List<ExportConversation> conversations,
            List<ExportMemory> memories,
            List<ExportReminder> reminders,
            List<ExportConsent> consents) {
    }

    record ExportConversation(
            String conversationId,
            String relationshipId,
            String title,
            boolean incognito,
            List<ExportMessage> messages) {
    }

    record ExportMessage(String messageId, String role, String content, boolean aiGenerated) {
    }

    record ExportMemory(
            String memoryId,
            String relationshipId,
            String scope,
            String summary,
            String status,
            String createdAt,
            String deletedAt) {
    }

    record ExportReminder(
            String reminderId,
            String relationshipId,
            String text,
            String remindAt,
            String recurrence,
            String status) {
    }

    record ExportConsent(
            String consentId,
            String consentType,
            String version,
            boolean granted,
            String grantedAt,
            String revokedAt) {
    }
}
