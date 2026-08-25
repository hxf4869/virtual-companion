package com.virtualcompanion.runtime.worker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
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
import com.virtualcompanion.runtime.export.ExportObjectStorage;
import com.virtualcompanion.platform.persistence.WorkItemClaim;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * Unit tests for {@link DataExportWorkItemHandler} (DATA-EXPORT / V42): the
 * handler aggregates the owner's data into the JSON document (AI-content
 * markers included), seals it READY with a fresh token/expiry and completes
 * the work item; a failed seal terminalizes the export FAILED and rethrows so
 * the worker applies its independent per-item fail. DOGFOOD-02 (V109) adds
 * the object-mode path: upload-then-seal via a fake
 * {@link ExportObjectStorage}, and an upload failure taking the same FAILED
 * terminal path. DOGFOOD-STABILIZATION adds the no-orphan protocol: the
 * bucket object is an OPAQUE AES-GCM envelope, and a failed seal keeps a
 * durable pointer (V110) or compensates the object away — never a
 * pointer-less orphan.
 */
class DataExportWorkItemHandlerTest {

    /** Minimal in-memory fake: records puts, can be told to fail. */
    static class FakeObjectStorage implements ExportObjectStorage {
        final Map<String, byte[]> objects = new HashMap<>();
        boolean failPuts;
        boolean failDeletes;
        /** Simulates a client timeout AFTER the server-side put landed. */
        boolean timeoutAfterPut;

        @Override
        public void put(String key, byte[] bytes) {
            if (failPuts) {
                throw new IllegalStateException("put failed");
            }
            objects.put(key, bytes);
            if (timeoutAfterPut) {
                throw new IllegalStateException("put timed out after landing");
            }
        }

        @Override
        public byte[] get(String key) {
            byte[] bytes = objects.get(key);
            if (bytes == null) {
                throw new IllegalStateException("missing object");
            }
            return bytes;
        }

        @Override
        public void delete(String key) {
            if (failDeletes) {
                throw new IllegalStateException("delete failed");
            }
            objects.remove(key);
        }

        @Override
        public java.util.List<String> list(String prefix) {
            return objects.keySet().stream()
                    .filter(key -> key.startsWith(prefix))
                    .sorted()
                    .collect(java.util.stream.Collectors.toList());
        }

        @Override
        public ExportObjectStorage.ObjectListing listPage(
                String prefix, String startAfter, int limit) {
            java.util.List<String> page = objects.keySet().stream()
                    .filter(key -> key.startsWith(prefix))
                    .filter(key -> startAfter == null || startAfter.isBlank()
                            || key.compareTo(startAfter) > 0)
                    .sorted()
                    .limit(limit)
                    .collect(java.util.stream.Collectors.toList());
            String nextCursor = page.size() < limit ? null : page.get(page.size() - 1);
            return new ExportObjectStorage.ObjectListing(page, nextCursor);
        }
    }

    /**
     * Real TransactionTemplate semantics without a database: commits count on
     * normal return, rollbacks count when the segment work throws. The
     * no-rollback plain executor below cannot express "the pointer write
     * rolled back", which is exactly the assumption the round-2 audit
     * invalidated.
     */
    static final class RecordingTransactionManager
            extends org.springframework.transaction.support.AbstractPlatformTransactionManager {
        int commits;
        int rollbacks;

        @Override
        protected Object doGetTransaction() {
            return new Object();
        }

        @Override
        protected void doBegin(
                Object transaction,
                org.springframework.transaction.TransactionDefinition definition) {
        }

        @Override
        protected void doCommit(
                org.springframework.transaction.support.DefaultTransactionStatus status) {
            commits++;
        }

        @Override
        protected void doRollback(
                org.springframework.transaction.support.DefaultTransactionStatus status) {
            rollbacks++;
        }
    }

    /** Real cipher with a fixed test key so envelope semantics are exercised. */
    private static final com.virtualcompanion.platform.persistence.RestFieldCipher
            TEST_CIPHER = new com.virtualcompanion.platform.persistence.RestFieldCipher(
            java.util.Base64.getEncoder().encodeToString(new byte[32]));

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

    private void handle(WorkItemClaim claim, WorkItemWorker.OwnerExecutor segmentExecutor) {
        WorkItemWorker.withSegmentExecutor(segmentExecutor, () -> {
            handler.handle(claim);
            return null;
        });
    }

    private static WorkItemClaim exportClaim(long ownerId, long exportId) {
        return exportClaim(ownerId, exportId, "FENCE-A");
    }

    private static WorkItemClaim exportClaim(long ownerId, long exportId, String fence) {
        return new WorkItemClaim(
                ownerId, 1L, DataExportWorkItemHandler.KIND_DATA_EXPORT, exportId, null,
                "token-1", fence);
    }

    /** The attempt-scoped object key of the default FENCE-A claim. */
    private static final String KEY_A =
            DataExportWorkItemHandler.objectKey(1L, 9L, "FENCE-A");

    private void stubEmptyData(long ownerId) {
        when(conversationListService.listConversations(ownerId, null, null, 100))
                .thenReturn(List.of());
        when(relationshipService.list(ownerId)).thenReturn(List.of());
        when(consentService.list(ownerId)).thenReturn(List.of());
        // 07: the post-put synchronous final renewal (and any heartbeat that
        // fires during the test) defaults to healthy — fail-closed tests
        // override this with a doAnswer.
        when(exportService.renewUploadLease(
                anyLong(), anyLong(), anyString(), anyInt())).thenReturn(1);
    }

    @Test
    void skipsNonDataExportItem() {
        WorkItemClaim claim =
                new WorkItemClaim(1L, 1L, "GENERATION", 10L, null, "token-1", "FENCE-A");
        handle(claim);

        verify(finalizeService, never()).assertActiveClaim(anyLong(), anyLong(), anyString(), anyString());
        verify(exportService, never()).complete(anyLong(), anyLong(), anyString(), any());
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
        when(exportService.complete(anyLong(), anyLong(), anyString(), any()))
                .thenReturn(true);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(exportClaim(1L, 9L));

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(exportService).complete(eq(1L), eq(9L), payload.capture(), any());
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
        when(exportService.complete(anyLong(), anyLong(), anyString(), any()))
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
        when(exportService.complete(anyLong(), anyLong(), anyString(), any()))
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
        verify(exportService, never()).complete(anyLong(), anyLong(), anyString(), any());
    }

    private DataExportWorkItemHandler objectModeHandler(
            FakeObjectStorage storage,
            com.virtualcompanion.runtime.observability.AlertNotifier alerts) {
        return new DataExportWorkItemHandler(
                finalizeService, exportService, relationshipService, conversationListService,
                messageRepository, memoryService, reminderService, consentService,
                objectMapper, Duration.ofHours(24), storage, TEST_CIPHER, alerts);
    }

    @Test
    void objectModeUploadsThenSealsWithThePointerOnly() {
        FakeObjectStorage storage = new FakeObjectStorage();
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A),
                anyLong(), any())).thenReturn(true);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(exportClaim(1L, 9L));

        // Upload happened with the serialized document under the owner-scoped
        // key, and the seal is object-mode (pointer, no inline payload).
        byte[] uploaded = storage.objects.get(KEY_A);
        assertTrue(uploaded != null && uploaded.length > 0);
        verify(exportService).completeObject(eq(1L), eq(9L), eq(KEY_A),
                eq((long) uploaded.length), any());
        verify(exportService, never()).complete(anyLong(), anyLong(), anyString(), any());
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
    }

    @Test
    void objectModeUploadFailureTerminalizesTheExportAndRethrows() {
        FakeObjectStorage storage = new FakeObjectStorage();
        storage.failPuts = true;
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);

        // The ambiguous-upload compensation rethrows the PossibleUpload
        // failure after delete-compensating (a no-op on an empty fake) and
        // marking the export FAILED.
        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L)));

        verify(exportService).fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED);
        verify(exportService, never()).completeObject(anyLong(), anyLong(), anyString(),
                anyLong(), any());
        verify(finalizeService, never()).completeWorkItem(anyLong(), anyString(), anyString());
    }

    @Test
    void inlineModeNeverTouchesObjectStorage() {
        // handler built with the 10-arg constructor: no storage wired.
        stubEmptyData(1L);
        when(exportService.complete(anyLong(), anyLong(), anyString(), any()))
                .thenReturn(true);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(exportClaim(1L, 9L));

        verify(exportService).complete(eq(1L), eq(9L), anyString(), any());
        verify(exportService, never()).completeObject(anyLong(), anyLong(), anyString(),
                anyLong(), any());
    }

    @Test
    void uploadedObjectIsAnOpaqueEncryptedEnvelopeNotPlaintextJson() throws Exception {
        FakeObjectStorage storage = new FakeObjectStorage();
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A),
                anyLong(), any())).thenReturn(true);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(exportClaim(1L, 9L));

        String uploaded = new String(
                storage.objects.get(KEY_A), StandardCharsets.UTF_8);
        // DOGFOOD-STABILIZATION audit: plaintext export JSON never reaches the
        // bucket — the object is a RestFieldCipher envelope, and only the
        // matching key turns it back into the sealed document.
        assertTrue(uploaded.startsWith("enc2:"));
        assertTrue(uploaded.indexOf("\"exportId\"") < 0);
        JsonNode doc = objectMapper.readTree(TEST_CIPHER.decrypt(uploaded));
        assertEquals("9", doc.get("exportId").asText());
        assertTrue(doc.get("aiContentNotice").asText().contains("AI 生成内容"));
    }

    @Test
    void sealReturningFalseKeepsTheDurablePointerAndRethrows() {
        // Audit A.2: upload succeeded, complete_export moved 0 rows — the
        // object survives WITH a V110 pointer; nothing is deleted and plain
        // fail() is not needed (the row is already terminal).
        FakeObjectStorage storage = new FakeObjectStorage();
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A),
                anyLong(), any())).thenReturn(false);
        when(exportService.failWithObject(eq(1L), eq(9L), eq(KEY_A),
                anyLong(), anyString())).thenReturn(true);

        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L)));

        verify(exportService).failWithObject(
                eq(1L), eq(9L), eq(KEY_A), anyLong(),
                eq(DataExportWorkItemHandler.FAULT_EXPORT_FAILED));
        assertTrue(storage.objects.containsKey(KEY_A));
        verify(finalizeService, never()).completeWorkItem(anyLong(), anyString(), anyString());
    }

    @Test
    void sealThrowingKeepsTheDurablePointerAndRethrows() {
        // Audit A.3: complete_export throws after the upload.
        FakeObjectStorage storage = new FakeObjectStorage();
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A),
                anyLong(), any())).thenThrow(new IllegalStateException("db down"));
        when(exportService.failWithObject(eq(1L), eq(9L), eq(KEY_A),
                anyLong(), anyString())).thenReturn(true);

        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L)));

        verify(exportService).failWithObject(
                eq(1L), eq(9L), eq(KEY_A), anyLong(),
                eq(DataExportWorkItemHandler.FAULT_EXPORT_FAILED));
        assertTrue(storage.objects.containsKey(KEY_A));
    }

    @Test
    void sealedRowWithFailedWorkItemCompleteKeepsThePointerUnderRealTransactions() {
        // DOGFOOD-STABILIZATION-02 audit: the per-item complete shares the seal
        // transaction, so returning 0 ROLLS THE POINTER WRITE BACK — the
        // handler must then run preserve-or-compensate with the deterministic
        // key (durable FAILED-with-pointer in a FRESH committed transaction),
        // never assume the READY pointer survived. Driven through a real
        // TransactionTemplate so the rollback is expressed, not assumed.
        FakeObjectStorage storage = new FakeObjectStorage();
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A),
                anyLong(), any())).thenReturn(true);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(0);
        when(exportService.failWithObject(eq(1L), eq(9L), eq(KEY_A),
                anyLong(), anyString())).thenReturn(true);
        RecordingTransactionManager txManager = new RecordingTransactionManager();
        org.springframework.transaction.support.TransactionTemplate template =
                new org.springframework.transaction.support.TransactionTemplate(txManager);
        WorkItemWorker.OwnerExecutor realTxExecutor = (ownerUserId, work) ->
                template.executeWithoutResult(status -> work.run());

        assertThrows(RuntimeException.class,
                () -> handle(exportClaim(1L, 9L), realTxExecutor));

        // The seal segment rolled back; the pointer-preserving write ran in
        // its own committed transaction; the object survives WITH a pointer.
        org.assertj.core.api.Assertions.assertThat(txManager.rollbacks).isGreaterThanOrEqualTo(1);
        org.assertj.core.api.Assertions.assertThat(txManager.commits).isGreaterThanOrEqualTo(1);
        verify(exportService).failWithObject(
                eq(1L), eq(9L), eq(KEY_A), anyLong(),
                eq(DataExportWorkItemHandler.FAULT_EXPORT_FAILED));
        assertTrue(storage.objects.containsKey(KEY_A));
    }

    @Test
    void workItemCompleteThrowingUnderRealTransactionsKeepsThePointer() {
        FakeObjectStorage storage = new FakeObjectStorage();
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A),
                anyLong(), any())).thenReturn(true);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A"))
                .thenThrow(new IllegalStateException("work item complete failed"));
        when(exportService.failWithObject(eq(1L), eq(9L), eq(KEY_A),
                anyLong(), anyString())).thenReturn(true);
        RecordingTransactionManager txManager = new RecordingTransactionManager();
        org.springframework.transaction.support.TransactionTemplate template =
                new org.springframework.transaction.support.TransactionTemplate(txManager);
        WorkItemWorker.OwnerExecutor realTxExecutor = (ownerUserId, work) ->
                template.executeWithoutResult(status -> work.run());

        assertThrows(RuntimeException.class,
                () -> handle(exportClaim(1L, 9L), realTxExecutor));

        org.assertj.core.api.Assertions.assertThat(txManager.rollbacks).isGreaterThanOrEqualTo(1);
        verify(exportService).failWithObject(
                eq(1L), eq(9L), eq(KEY_A), anyLong(),
                eq(DataExportWorkItemHandler.FAULT_EXPORT_FAILED));
        assertTrue(storage.objects.containsKey(KEY_A));
    }

    @Test
    void ambiguousPutTimeoutCompensatesThePossiblyLandedObject() {
        // DOGFOOD-STABILIZATION-02: the client threw AFTER the server-side put
        // landed; no seal ran, so the compensation deletes the possibly-live
        // object (deleting an absent key is harmless) and terminalizes plain
        // FAILED — no durable pointer needed.
        FakeObjectStorage storage = new FakeObjectStorage();
        storage.timeoutAfterPut = true;
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);

        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L)));

        assertTrue(storage.objects.isEmpty());
        verify(exportService, never()).completeObject(anyLong(), anyLong(), anyString(),
                anyLong(), any());
        verify(exportService, never()).failWithObject(anyLong(), anyLong(), anyString(),
                anyLong(), anyString());
        verify(exportService).fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED);
    }

    @Test
    void ambiguousPutWithFailingDeleteKeepsTheDurablePointer() {
        // The delete could not confirm the object's absence — fall back to the
        // durable FAILED-with-pointer terminal so the sweep removes the object
        // once the store recovers; no orphan-risk alert.
        FakeObjectStorage storage = new FakeObjectStorage();
        storage.timeoutAfterPut = true;
        storage.failDeletes = true;
        com.virtualcompanion.runtime.observability.AlertNotifier alerts =
                mock(com.virtualcompanion.runtime.observability.AlertNotifier.class);
        handler = objectModeHandler(storage, alerts);
        stubEmptyData(1L);
        when(exportService.failWithObject(eq(1L), eq(9L), eq(KEY_A),
                anyLong(), anyString())).thenReturn(true);

        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L)));

        verify(exportService).failWithObject(
                eq(1L), eq(9L), eq(KEY_A), anyLong(),
                eq(DataExportWorkItemHandler.FAULT_EXPORT_FAILED));
        verify(alerts, never()).alert(any(), anyString(), anyString());
    }

    @Test
    void ambiguousPutWithEverythingFailingAlertsOrphanRisk() {
        FakeObjectStorage storage = new FakeObjectStorage();
        storage.timeoutAfterPut = true;
        storage.failDeletes = true;
        com.virtualcompanion.runtime.observability.AlertNotifier alerts =
                mock(com.virtualcompanion.runtime.observability.AlertNotifier.class);
        handler = objectModeHandler(storage, alerts);
        stubEmptyData(1L);
        when(exportService.failWithObject(anyLong(), anyLong(), anyString(), anyLong(),
                anyString())).thenThrow(new IllegalStateException("db still down"));

        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L)));

        verify(alerts).alert(
                eq(com.virtualcompanion.runtime.observability.AlertSeverity.P1),
                eq(DataExportWorkItemHandler.ALERT_ORPHAN_RISK),
                anyString());
        assertTrue(storage.objects.containsKey(KEY_A));
    }

    @Test
    void activeDeletionIntentBlocksTheSealBeforeAnyUpload() {
        // DOGFOOD-STABILIZATION-02 (ADR-0006 §7 order): once the deletion
        // intent is persisted no new seal may start — the pre-cascade cleanup
        // loop must not race a fresh object.
        FakeObjectStorage storage = new FakeObjectStorage();
        com.virtualcompanion.platform.persistence.AccountDeletionIntentService intents =
                mock(com.virtualcompanion.platform.persistence.AccountDeletionIntentService.class);
        when(intents.activeCurrent(1L)).thenReturn(true);
        handler = new DataExportWorkItemHandler(
                finalizeService, exportService, relationshipService, conversationListService,
                messageRepository, memoryService, reminderService, consentService,
                objectMapper, Duration.ofHours(24), storage, TEST_CIPHER, null, intents);
        stubEmptyData(1L);

        assertThrows(IllegalStateException.class, () -> handle(exportClaim(1L, 9L)));

        assertTrue(storage.objects.isEmpty());
        verify(exportService, never()).completeObject(anyLong(), anyLong(), anyString(),
                anyLong(), any());
        verify(exportService).fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED);
    }

    @Test
    void failedPointerWriteCompensatesByDeletingTheObject() {
        // Audit A.5a: the DB is too broken to keep a pointer — the just
        // uploaded object is compensated away so no pointer-less orphan can
        // remain, and the row takes the plain FAILED path.
        FakeObjectStorage storage = new FakeObjectStorage();
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A),
                anyLong(), any())).thenThrow(new IllegalStateException("db down"));
        when(exportService.failWithObject(anyLong(), anyLong(), anyString(), anyLong(),
                anyString())).thenThrow(new IllegalStateException("db still down"));
        when(exportService.fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED))
                .thenReturn(true);

        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L)));

        assertTrue(storage.objects.isEmpty());
        verify(exportService).fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED);
    }

    @Test
    void failedPointerAndFailedCompensationAlertsOrphanRisk() {
        // Audit A.5b: neither the pointer nor the deletion worked — a P1
        // EXPORT_OBJECT_ORPHAN_RISK fires (the DB is down for every path).
        FakeObjectStorage storage = new FakeObjectStorage();
        storage.failDeletes = true;
        com.virtualcompanion.runtime.observability.AlertNotifier alerts =
                mock(com.virtualcompanion.runtime.observability.AlertNotifier.class);
        handler = objectModeHandler(storage, alerts);
        stubEmptyData(1L);
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A),
                anyLong(), any())).thenThrow(new IllegalStateException("db down"));
        when(exportService.failWithObject(anyLong(), anyLong(), anyString(), anyLong(),
                anyString())).thenThrow(new IllegalStateException("db still down"));

        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L)));

        verify(alerts).alert(
                eq(com.virtualcompanion.runtime.observability.AlertSeverity.P1),
                eq(DataExportWorkItemHandler.ALERT_ORPHAN_RISK),
                anyString());
        assertTrue(storage.objects.containsKey(KEY_A));
    }

    // ---- DOGFOOD-STABILIZATION-03 (audit defect E): per-claim object isolation ----

    @Test
    void objectKeyIsAttemptScopedAndNeverExposesTheRawClaimSecret() {
        String keyA = DataExportWorkItemHandler.objectKey(1L, 9L, "FENCE-A");
        String keyB = DataExportWorkItemHandler.objectKey(1L, 9L, "FENCE-B");
        org.junit.jupiter.api.Assertions.assertNotEquals(keyA, keyB);
        assertTrue(keyA.startsWith("exports/1/9-") && keyA.endsWith(".json"));
        // Neither the claim fence nor the claim token is recoverable from the
        // key (only its SHA-256 prefix is embedded).
        assertFalse(keyA.contains("FENCE-A"));
        assertFalse(keyA.contains("token-1"));
    }

    @Test
    void staleClaimantCompensationCannotDeleteTheTakeoverSeal() {
        // Timeline: claimant A (FENCE-A) uploads and stalls; the lease expires,
        // claimant B (FENCE-B) takes over and seals READY under ITS key; A
        // then resumes, fails its seal and runs the compensation — which may
        // only ever touch A's own key. B's object and the READY pointer stay.
        FakeObjectStorage storage = new FakeObjectStorage();
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        String keyB = DataExportWorkItemHandler.objectKey(1L, 9L, "FENCE-B");

        // Claimant B succeeds first (fresh lease, its own fence).
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-B")).thenReturn(1);
        when(exportService.completeObject(eq(1L), eq(9L), eq(keyB), anyLong(), any()))
                .thenReturn(true);
        handle(exportClaim(1L, 9L, "FENCE-B"));
        assertTrue(storage.objects.containsKey(keyB));

        // Claimant A resumes with its stale fence: the seal refuses (the row
        // is no longer PENDING → completeObject false), the durable-pointer
        // fallback also refuses (failWithObject false) — A compensates away
        // only ITS OWN object.
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A), anyLong(), any()))
                .thenReturn(false);
        when(exportService.failWithObject(eq(1L), eq(9L), eq(KEY_A), anyLong(), anyString()))
                .thenReturn(false);
        when(exportService.fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED))
                .thenReturn(true);
        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L, "FENCE-A")));

        // B's object survived A's compensation; A's own object is gone.
        assertTrue(storage.objects.containsKey(keyB),
                "the takeover claimant's READY object must survive");
        assertFalse(storage.objects.containsKey(KEY_A),
                "the stale claimant's own object must be compensated away");
        // The READY seal was written for B's key only — never A's.
        verify(exportService, org.mockito.Mockito.never()).failWithObject(
                eq(1L), eq(9L), eq(keyB), anyLong(), anyString());
    }

    @Test
    void takeoverSealSweepsStaleAttemptObjectsLeftByACrashedClaimant() {
        // A crashed AFTER uploading (no compensation ever ran): its object
        // sits in the bucket with no pointer. B takes over, seals READY under
        // its own key, and the post-seal sweep removes A's residue.
        FakeObjectStorage storage = new FakeObjectStorage();
        storage.objects.put(KEY_A, "orphaned envelope".getBytes(StandardCharsets.UTF_8));
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        String keyB = DataExportWorkItemHandler.objectKey(1L, 9L, "FENCE-B");
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-B")).thenReturn(1);
        when(exportService.completeObject(eq(1L), eq(9L), eq(keyB), anyLong(), any()))
                .thenReturn(true);

        handle(exportClaim(1L, 9L, "FENCE-B"));

        assertTrue(storage.objects.containsKey(keyB));
        assertFalse(storage.objects.containsKey(KEY_A),
                "the crashed claimant's residue must be swept after the seal");
        assertEquals(java.util.List.of(keyB), storage.list("exports/1/9-"));
    }

    @Test
    void deletionIntentCommittingAfterThePrecheckRefusesTheSealAndCompensatesTheObject() {
        // DOGFOOD-STABILIZATION-03 (audit defect D), Java side of the V113
        // timeline: the worker PASSED its application-level intent check
        // (activeCurrent=false at buildAndSeal start) and uploaded, then the
        // deletion intent committed; the SQL barrier refuses the seal
        // (complete_export RAISEs) and the pointer fallback
        // (fail_export_with_object RAISEs) — the worker must compensate its
        // OWN just-uploaded object away, leaving neither a DB pointer nor a
        // bucket orphan.
        FakeObjectStorage storage = new FakeObjectStorage();
        com.virtualcompanion.platform.persistence.AccountDeletionIntentService intents =
                mock(com.virtualcompanion.platform.persistence.AccountDeletionIntentService.class);
        when(intents.activeCurrent(1L)).thenReturn(false);
        handler = new DataExportWorkItemHandler(
                finalizeService, exportService, relationshipService, conversationListService,
                messageRepository, memoryService, reminderService, consentService,
                objectMapper, Duration.ofHours(24), storage, TEST_CIPHER, null, intents);
        stubEmptyData(1L);
        // V113 barrier: both pointer writes raise after the intent committed.
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A), anyLong(), any()))
                .thenThrow(new IllegalStateException(
                        "complete_export: account deletion is in progress"));
        when(exportService.failWithObject(eq(1L), eq(9L), eq(KEY_A), anyLong(), anyString()))
                .thenThrow(new IllegalStateException(
                        "fail_export_with_object: account deletion is in progress"));
        when(exportService.fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED))
                .thenReturn(true);

        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L)));

        // Neither a pointer nor an orphan: the barrier refused every pointer
        // write and the worker deleted its own uploaded envelope.
        verify(exportService, never()).complete(anyLong(), anyLong(), anyString(), any());
        assertTrue(storage.objects.isEmpty(),
                "the just-uploaded object must be compensated away");
        verify(exportService).fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED);
    }

    // ---- DOGFOOD-STABILIZATION-04 (audit defect E): durable upload intent ----

    @Test
    void uploadIntentIsRecordedBeforeTheBucketPut() {
        FakeObjectStorage storage = new FakeObjectStorage();
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A), anyLong(), any()))
                .thenReturn(true);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);
        // The intent row must be durably committed while the bucket is still
        // EMPTY — a crash at any later point leaves a reclaimable record.
        org.mockito.Mockito.doAnswer(invocation -> {
                    assertFalse(storage.objects.containsKey(KEY_A),
                            "the upload intent must be recorded before the put");
                    return 77L;
                }).when(exportService).recordUploadIntent(1L, 9L, KEY_A, DataExportWorkItemHandler.UPLOAD_LEASE_SECONDS);

        handle(exportClaim(1L, 9L));

        org.mockito.Mockito.verify(exportService).recordUploadIntent(1L, 9L, KEY_A, DataExportWorkItemHandler.UPLOAD_LEASE_SECONDS);
        assertTrue(storage.objects.containsKey(KEY_A));
        org.mockito.Mockito.verify(exportService)
                .completeObject(eq(1L), eq(9L), eq(KEY_A), anyLong(), any());
    }

    @Test
    void aCrashAfterThePutLeavesTheIntentRowForTheReconciliationSweep() {
        // The seal fails AND the durable pointer fails AND the compensation
        // delete fails (process/DB/store outage): the handler alerts and
        // rethrows, but the intent row recorded before the put PERSISTS —
        // the ExportUploadReconciliationScheduler reclaims the object once
        // the store recovers (see its test class for the reclaim).
        FakeObjectStorage storage = new FakeObjectStorage();
        storage.failDeletes = true;
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A), anyLong(), any()))
                .thenThrow(new IllegalStateException("seal db down"));
        when(exportService.failWithObject(eq(1L), eq(9L), eq(KEY_A), anyLong(), anyString()))
                .thenThrow(new IllegalStateException("pointer db down"));

        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L)));

        // The intent was recorded BEFORE the upload, so the reclaim path has
        // its durable worklist entry even though nothing else succeeded.
        org.mockito.Mockito.verify(exportService).recordUploadIntent(1L, 9L, KEY_A, DataExportWorkItemHandler.UPLOAD_LEASE_SECONDS);
        assertTrue(storage.objects.containsKey(KEY_A));
    }

    // ---- DOGFOOD-STABILIZATION-05: fenced upload protocol ordering ----

    @Test
    void theUploadIntentIsRecordedAfterTheEnvelopeAndNextToThePutOutsideEverySegment() {
        // The protocol ordering is structural: document first, fenced intent
        // record second (its own committed segment, as close to the put as
        // possible), the put OUTSIDE every database segment, the seal last.
        List<String> events = new java.util.ArrayList<>();
        FakeObjectStorage storage = new FakeObjectStorage() {
            @Override
            public void put(String key, byte[] bytes) {
                events.add("put");
                super.put(key, bytes);
            }
        };
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        org.mockito.Mockito.doAnswer(invocation -> {
            events.add("build");
            return List.of();
        }).when(conversationListService).listConversations(eq(1L), isNull(), any(), eq(100));
        org.mockito.Mockito.doAnswer(invocation -> {
            events.add("record");
            return 77L;
        }).when(exportService).recordUploadIntent(1L, 9L, KEY_A, DataExportWorkItemHandler.UPLOAD_LEASE_SECONDS);
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A), anyLong(), any()))
                .thenReturn(true);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(exportClaim(1L, 9L), (ownerUserId, work) -> {
            events.add("segment-begin");
            work.run();
            events.add("segment-end");
        });

        // Envelope built inside the FIRST segment; the intent recorded inside
        // the SECOND segment; the put strictly BETWEEN segments (no database
        // transaction spans the external upload); the seal inside the third.
        int buildAt = eventIndex(events, "build");
        int recordAt = eventIndex(events, "record");
        int putAt = eventIndex(events, "put");
        assertTrue(buildAt < recordAt, "envelope must be built before the record");
        assertTrue(recordAt < putAt, "the record must precede the put");
        assertEquals("segment-end", events.get(putAt - 1),
                "the put must run outside every database segment");
        assertEquals("segment-begin", events.get(putAt + 1),
                "the put must run outside every database segment");
        org.mockito.Mockito.verify(exportService).completeObject(
                eq(1L), eq(9L), eq(KEY_A), anyLong(), any());
    }

    private static int eventIndex(List<String> events, String marker) {
        int index = events.indexOf(marker);
        assertTrue(index >= 0, "missing event " + marker);
        return index;
    }

    @Test
    void aRefusedUploadIntentPreemptsThePutEntirely() {
        // A fenced refusal of the record (deletion barrier, attempt reclaimed
        // by the sweeper, terminal export) must happen BEFORE any object
        // exists: no put, no seal, FAILED terminal state only.
        FakeObjectStorage storage = new FakeObjectStorage() {
            @Override
            public void put(String key, byte[] bytes) {
                throw new IllegalStateException("the put must never run");
            }
        };
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        org.mockito.Mockito.doThrow(new IllegalStateException(
                "record_export_upload_intent: this upload attempt was already reclaimed"))
                .when(exportService).recordUploadIntent(1L, 9L, KEY_A, DataExportWorkItemHandler.UPLOAD_LEASE_SECONDS);
        when(exportService.fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED))
                .thenReturn(true);

        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L)));

        assertTrue(storage.objects.isEmpty());
        verify(exportService).fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED);
        verify(exportService, never()).completeObject(anyLong(), anyLong(), anyString(),
                anyLong(), any());
        verify(exportService, never()).failWithObject(anyLong(), anyLong(), anyString(),
                anyLong(), anyString());
    }

    // ---- DOGFOOD-STABILIZATION-07: the durable heartbeat covers the whole upload ----

    @Test
    void theLeaseIsThreeHeartbeatIntervalsAndNeverAZeroSecondDefault() {
        // 07 (defect B): the per-call timeout is NOT the upload's duration
        // bound (multipart = many calls). The recorded lease must be kept
        // alive by the heartbeat and sized as a multiple of the cadence —
        // never a zero-second or single-call-shaped lease.
        assertThat(DataExportWorkItemHandler.UPLOAD_LEASE_SECONDS)
                .isGreaterThanOrEqualTo(
                        3 * DataExportWorkItemHandler.UPLOAD_HEARTBEAT_SECONDS)
                .isGreaterThan(0);
    }

    @Test
    void aLongRunningPutStaysCoveredByTheLeaseRecordedBeforeIt() throws Exception {
        // A slow (multipart, many-HTTP-call) upload: the put blocks on a
        // latch — no real sleeping. While the put is in flight, the fenced
        // intent row with its covering lease is ALREADY durably recorded, so
        // the reconciliation sweep (which re-validates the live lease inside
        // the atomic claim) cannot reclaim the attempt mid-upload; once the
        // put completes, the seal runs normally.
        java.util.concurrent.CountDownLatch putStarted = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch releasePut = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicInteger leaseRecordedWhenPutStarted =
                new java.util.concurrent.atomic.AtomicInteger(-1);
        FakeObjectStorage storage = new FakeObjectStorage() {
            @Override
            public void put(String key, byte[] bytes) {
                putStarted.countDown();
                try {
                    assertTrue(releasePut.await(10, java.util.concurrent.TimeUnit.SECONDS),
                            "test latch must be released");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("interrupted", e);
                }
                super.put(key, bytes);
            }
        };
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        org.mockito.Mockito.doAnswer(invocation -> {
            leaseRecordedWhenPutStarted.set(invocation.getArgument(3));
            return 77L;
        }).when(exportService).recordUploadIntent(eq(1L), eq(9L), eq(KEY_A), anyInt());
        when(exportService.completeObject(eq(1L), eq(9L), eq(KEY_A), anyLong(), any()))
                .thenReturn(true);
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        java.util.concurrent.atomic.AtomicReference<Throwable> workerFailure =
                new java.util.concurrent.atomic.AtomicReference<>();
        Thread worker = new Thread(() -> {
            try {
                handle(exportClaim(1L, 9L));
            } catch (Throwable t) {
                workerFailure.set(t);
            }
        }, "export-worker");
        worker.start();
        assertTrue(putStarted.await(10, java.util.concurrent.TimeUnit.SECONDS),
                "the put must have started");

        // Mid-upload: the lease covering this put is already committed — a
        // heartbeat-sized multiple, not a single-call-shaped window.
        assertThat(leaseRecordedWhenPutStarted.get())
                .isEqualTo(DataExportWorkItemHandler.UPLOAD_LEASE_SECONDS);
        // The seal cannot have run while the put is still in flight.
        org.mockito.Mockito.verify(exportService, never()).completeObject(
                anyLong(), anyLong(), anyString(), anyLong(), any());

        releasePut.countDown();
        worker.join(10_000);
        assertThat(worker.isAlive()).isFalse();
        if (workerFailure.get() != null) {
            throw new AssertionError("worker failed after the released latch",
                    workerFailure.get());
        }
        assertTrue(storage.objects.containsKey(KEY_A));
        org.mockito.Mockito.verify(exportService).completeObject(
                eq(1L), eq(9L), eq(KEY_A), anyLong(), any());
    }

    @Test
    void aFailedLeaseRenewalAbortsTheUploadAndFailsClosed() {
        // 07 (defect B): the heartbeat's renewal fails (0 rows — the attempt
        // was claimed/fenced — or a database error) while the multipart put
        // runs. The put's outcome is then NOT trusted: no READY seal, the
        // possibly-live object is compensated away and the export
        // terminalizes plain FAILED. The renewal fires deterministically
        // BEFORE the put finishes (a latch orders them — no real 30s wait).
        java.util.concurrent.CountDownLatch renewHappened =
                new java.util.concurrent.CountDownLatch(1);
        FakeObjectStorage storage = new FakeObjectStorage() {
            @Override
            public void put(String key, byte[] bytes) {
                try {
                    assertTrue(renewHappened.await(10, java.util.concurrent.TimeUnit.SECONDS),
                            "the failed renewal must fire while the put runs");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("interrupted", e);
                }
                super.put(key, bytes);
            }
        };
        handler = new DataExportWorkItemHandler(
                finalizeService, exportService, relationshipService, conversationListService,
                messageRepository, memoryService, reminderService, consentService,
                objectMapper, Duration.ofHours(24), storage, TEST_CIPHER, null) {
            @Override
            DataExportWorkItemHandler.UploadLeaseHeartbeat newUploadLeaseHeartbeat(
                    DataExportWorkItemHandler.UploadLeaseHeartbeat.Renewal renewal) {
                return DataExportWorkItemHandler.UploadLeaseHeartbeat.start(renewal, 5L);
            }
        };
        stubEmptyData(1L);
        // 0 rows = the lease was lost (claimed/fenced out) — every renewal,
        // background and the synchronous post-put gate included.
        org.mockito.Mockito.doAnswer(invocation -> {
            renewHappened.countDown();
            return 0;
        }).when(exportService).renewUploadLease(
                eq(1L), eq(9L), eq(KEY_A), eq(DataExportWorkItemHandler.UPLOAD_LEASE_SECONDS));
        when(exportService.fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED))
                .thenReturn(true);

        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L)));

        // Fail-closed: no READY seal, the export terminalizes FAILED, the
        // possibly-live object is compensated away.
        verify(exportService, never()).completeObject(anyLong(), anyLong(), anyString(),
                anyLong(), any());
        verify(exportService).fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED);
        assertTrue(storage.objects.isEmpty(),
                "the ambiguous object must be compensated away");
        org.mockito.Mockito.verify(exportService, org.mockito.Mockito.atLeastOnce())
                .renewUploadLease(
                        eq(1L), eq(9L), eq(KEY_A), eq(DataExportWorkItemHandler.UPLOAD_LEASE_SECONDS));
    }

    @Test
    void aPutExceedingTheBoundedWindowStopsSealingAndEntersCompensation() {
        // The put itself cannot finish (a client error): the attempt stops
        // sealing and enters the compensation path — the export never ends
        // up sealed on an untracked object.
        FakeObjectStorage storage = new FakeObjectStorage();
        storage.failPuts = true;
        handler = objectModeHandler(storage, null);
        stubEmptyData(1L);
        when(exportService.fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED))
                .thenReturn(true);

        assertThrows(RuntimeException.class, () -> handle(exportClaim(1L, 9L)));

        assertTrue(storage.objects.isEmpty(),
                "the ambiguous object must be compensated away");
        verify(exportService).fail(1L, 9L, DataExportWorkItemHandler.FAULT_EXPORT_FAILED);
        verify(exportService, never()).completeObject(anyLong(), anyLong(), anyString(),
                anyLong(), any());
    }
}
