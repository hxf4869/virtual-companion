package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
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
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * Unit tests for {@link DataExportWorkItemHandler} (DATA-EXPORT / V42): the
 * handler aggregates the owner's data into the JSON document (AI-content
 * markers included), seals it READY with a fresh token/expiry and completes
 * the work item; a failed seal terminalizes the export FAILED and rethrows so
 * the worker applies its independent per-item fail.
 */
class DataExportWorkItemHandlerTest {

    private static final Instant NOW = Instant.parse("2026-08-17T12:00:00Z");

    private final GenerationFinalizeService finalizeService = mock(GenerationFinalizeService.class);
    private final ExportService exportService = mock(ExportService.class);
    private final RelationshipService relationshipService = mock(RelationshipService.class);
    private final ConversationListService conversationListService =
            mock(ConversationListService.class);
    private final MessageRepository messageRepository = mock(MessageRepository.class);
    private final MemoryService memoryService = mock(MemoryService.class);
    private final ReminderService reminderService = mock(ReminderService.class);
    private final ConsentService consentService = mock(ConsentService.class);
    private final ObjectMapper objectMapper = new ObjectMapper();

    private DataExportWorkItemHandler handler;

    private final WorkItemWorker.OwnerExecutor executor = (ownerUserId, work) -> work.run();

    @BeforeEach
    void setUp() {
        handler = new DataExportWorkItemHandler(
                finalizeService,
                exportService,
                relationshipService,
                conversationListService,
                messageRepository,
                memoryService,
                reminderService,
                consentService,
                objectMapper,
                Duration.ofHours(24));
    }

    private void handle(WorkItemClaim claim) {
        WorkItemWorker.withSegmentExecutor(executor, () -> {
            handler.handle(claim);
            return null;
        });
    }

    private static WorkItemClaim exportClaim(long ownerId, long exportId) {
        return new WorkItemClaim(
                ownerId, 1L, DataExportWorkItemHandler.KIND_DATA_EXPORT, exportId, null,
                "token-1", "FENCE-A");
    }

    private void stubEmptyData(long ownerId) {
        when(conversationListService.listConversations(ownerId, null, null, 100))
                .thenReturn(List.of());
        when(relationshipService.list(ownerId)).thenReturn(List.of());
        when(consentService.list(ownerId)).thenReturn(List.of());
    }

    @Test
    void skipsNonDataExportItem() {
        WorkItemClaim claim =
                new WorkItemClaim(1L, 1L, "GENERATION", 10L, null, "token-1", "FENCE-A");
        handle(claim);

        verify(finalizeService, never()).assertActiveClaim(anyLong(), anyLong(), anyString(), anyString());
        verify(exportService, never()).complete(anyLong(), anyLong(), anyString(), anyString(), any());
    }

    @Test
    void sealsTheAggregatedDocumentWithAiMarkers() throws Exception {
        stubEmptyData(1L);
        when(conversationListService.listConversations(eq(1L), isNull(), any(), eq(100)))
                .thenReturn(List.of(new ConversationListRecord(
                        5L, 9L, NOW, "assistant", "你好", null, false)))
                .thenReturn(List.of());
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(List.of(
                new MessageRepository.Message(1L, 101L, 5L, "user", "帮我记一下"),
                new MessageRepository.Message(1L, 102L, 5L, "assistant", "好的，已记住")));
        when(relationshipService.list(1L)).thenReturn(List.of(
                new RelationshipRecord(9L, "gentle-listener", true, NOW)));
        when(memoryService.list(1L, 9L, Boolean.TRUE)).thenReturn(List.of(
                new MemoryRecord(201L, 9L, "RELATIONSHIP", "帮我记一下", "ACCEPTED", null, null, NOW)));
        when(reminderService.list(1L, 9L, null, null)).thenReturn(List.of(
                new ReminderRecord(301L, 9L, "明天晚上问我面试", NOW, "NONE", "ACTIVE", NOW, NOW)));
        when(consentService.list(1L)).thenReturn(List.of(
                new ConsentRecord(401L, "MODEL_TRAINING", "2026-08", false, NOW, NOW)));
        when(exportService.complete(anyLong(), anyLong(), anyString(), anyString(), any()))
                .thenReturn(true);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(exportClaim(1L, 9L));

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> token = ArgumentCaptor.forClass(String.class);
        verify(exportService).complete(eq(1L), eq(9L), payload.capture(), token.capture(), any());
        assertTrue(token.getValue().length() > 10);
        verify(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");

        JsonNode doc = objectMapper.readTree(payload.getValue());
        assertEquals("9", doc.get("exportId").asText());
        assertTrue(doc.get("aiContentNotice").asText().contains("AI 生成内容"));
        assertEquals(1, doc.get("conversations").size());
        assertEquals("assistant",
                doc.get("conversations").get(0).get("messages").get(1).get("role").asText());
        assertTrue(doc.get("conversations").get(0).get("messages").get(1)
                .get("aiGenerated").asBoolean());
        assertTrue(doc.get("conversations").get(0).get("messages").get(0)
                .get("aiGenerated").asBoolean() == false);
        assertEquals(1, doc.get("memories").size());
        assertEquals("帮我记一下", doc.get("memories").get(0).get("summary").asText());
        assertEquals(1, doc.get("reminders").size());
        assertEquals(1, doc.get("consents").size());
        assertTrue(doc.has("expiresAt"));
    }

    @Test
    void walksConversationPagesToTheEnd() {
        when(conversationListService.listConversations(eq(1L), isNull(), any(), eq(100)))
                .thenReturn(List.of(new ConversationListRecord(5L, 9L, NOW, null, null, null, false)))
                .thenReturn(List.of(new ConversationListRecord(6L, 9L, NOW, null, null, null, false)))
                .thenReturn(List.of());
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(List.of());
        when(messageRepository.listByConversation(1L, 6L)).thenReturn(List.of());
        when(relationshipService.list(1L)).thenReturn(List.of());
        when(consentService.list(1L)).thenReturn(List.of());
        when(exportService.complete(anyLong(), anyLong(), anyString(), anyString(), any()))
                .thenReturn(true);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(exportClaim(1L, 9L));

        // The third page is empty: exactly two pages were walked, then seal.
        verify(conversationListService, org.mockito.Mockito.times(3))
                .listConversations(eq(1L), isNull(), any(), eq(100));
    }

    @Test
    void failedSealTerminalizesTheExportAndRethrows() {
        stubEmptyData(1L);
        when(exportService.complete(anyLong(), anyLong(), anyString(), anyString(), any()))
                .thenReturn(false);

        assertThrows(IllegalStateException.class, () -> handle(exportClaim(1L, 9L)));

        verify(exportService).fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED);
        verify(finalizeService, never()).completeWorkItem(anyLong(), anyString(), anyString());
    }

    @Test
    void guardFailureTerminalizesTheExportAndRethrows() {
        stubEmptyData(1L);
        org.mockito.Mockito.doThrow(new IllegalStateException("stale claim"))
                .when(finalizeService)
                .assertActiveClaim(1L, 1L, "token-1", "FENCE-A");

        assertThrows(IllegalStateException.class, () -> handle(exportClaim(1L, 9L)));

        verify(exportService).fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED);
        verify(exportService, never()).complete(anyLong(), anyLong(), anyString(), anyString(), any());
    }
}
