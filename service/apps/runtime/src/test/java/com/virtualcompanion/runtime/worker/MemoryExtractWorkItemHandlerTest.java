package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertThrows;
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

import com.virtualcompanion.platform.persistence.ConversationRepository;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationRecord;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.MemoryRecord;
import com.virtualcompanion.platform.persistence.MemoryService;
import com.virtualcompanion.platform.persistence.MessageRepository;
import com.virtualcompanion.platform.persistence.WorkItemClaim;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link MemoryExtractWorkItemHandler} (MEM-LOOP entry half).
 * The handler runs inside the worker's segment-executor channel with a
 * synchronous test executor. Verifies: non-MEMORY_EXTRACT items are skipped;
 * a substantial user message becomes a RELATIONSHIP candidate with the
 * message id as evidence; short or missing user messages are skipped without
 * creating anything; the claim guard and the per-item complete run in the
 * same transaction; a guard failure propagates (the worker applies the
 * independent per-item fail).
 */
class MemoryExtractWorkItemHandlerTest {

    private static final Instant NOW = Instant.parse("2026-08-16T08:00:00Z");

    private final GenerationRepository generationRepository = mock(GenerationRepository.class);
    private final ConversationRepository conversationRepository = mock(ConversationRepository.class);
    private final MessageRepository messageRepository = mock(MessageRepository.class);
    private final MemoryService memoryService = mock(MemoryService.class);
    private final GenerationFinalizeService finalizeService = mock(GenerationFinalizeService.class);
    private final com.virtualcompanion.runtime.memory.EmbeddingPort embeddingPort =
            mock(com.virtualcompanion.runtime.memory.EmbeddingPort.class);

    private final MemoryExtractWorkItemHandler handler = new MemoryExtractWorkItemHandler(
            generationRepository,
            conversationRepository,
            messageRepository,
            memoryService,
            finalizeService,
            embeddingPort);

    private final WorkItemWorker.OwnerExecutor executor = (ownerUserId, work) -> work.run();

    private void handle(WorkItemClaim claim) {
        WorkItemWorker.withSegmentExecutor(executor, () -> {
            handler.handle(claim);
            return null;
        });
    }

    private static WorkItemClaim extractClaim(long ownerId, long genId) {
        return new WorkItemClaim(
                ownerId, 1L, MemoryExtractWorkItemHandler.KIND_MEMORY_EXTRACT, genId, null,
                "token-1", "FENCE-A");
    }

    private static GenerationRecord generation(long conversationId) {
        return new GenerationRecord(1L, 10L, conversationId, "logical-10", "COMPLETED", "key-1");
    }

    private static ConversationRepository.Conversation conversation(long relationshipId) {
        return new ConversationRepository.Conversation(1L, 5L, relationshipId, null);
    }

    private static MessageRepository.Message message(long id, String role, String content) {
        return new MessageRepository.Message(1L, id, 5L, role, content);
    }

    private static MemoryRecord candidate(long id) {
        return new MemoryRecord(
                id, null, "RELATIONSHIP", "summary", "PENDING_CONFIRMATION", null, null, NOW);
    }

    @Test
    void skipsNonMemoryExtractItem() {
        WorkItemClaim claim =
                new WorkItemClaim(1L, 1L, "GENERATION", 10L, null, "token-1", "FENCE-A");
        handle(claim);
        verify(finalizeService, never()).assertActiveClaim(anyLong(), anyLong(), anyString(), anyString());
        verify(finalizeService, never()).completeWorkItem(anyLong(), anyString(), anyString());
    }

    @Test
    void proposesRelationshipCandidateFromTheCompletedTurn() {
        when(generationRepository.find(1L, 10L)).thenReturn(Optional.of(generation(5L)));
        when(conversationRepository.find(1L, 5L)).thenReturn(Optional.of(conversation(9L)));
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(List.of(
                message(101L, "user", "我今天和老板聊了升职的事情"),
                message(102L, "assistant", "听起来很重要，我记住了")));
        when(memoryService.create(1L, 9L, "RELATIONSHIP", "我今天和老板聊了升职的事情",
                null, List.of("message:101"))).thenReturn(Optional.of(candidate(201L)));
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(extractClaim(1L, 10L));

        verify(finalizeService).assertActiveClaim(1L, 1L, "token-1", "FENCE-A");
        verify(memoryService).create(
                1L, 9L, "RELATIONSHIP", "我今天和老板聊了升职的事情", null, List.of("message:101"));
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
    }

    @Test
    void skipsShortUserMessageButStillCompletesTheItem() {
        when(generationRepository.find(1L, 10L)).thenReturn(Optional.of(generation(5L)));
        when(conversationRepository.find(1L, 5L)).thenReturn(Optional.of(conversation(9L)));
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(List.of(
                message(101L, "user", "嗯"),
                message(102L, "assistant", "我在听")));
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(extractClaim(1L, 10L));

        verify(memoryService, never()).create(
                anyLong(), anyLong(), anyString(), anyString(), isNull(), any());
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
    }

    @Test
    void skipsWhenTheExchangeCarriesNoUserMessage() {
        when(generationRepository.find(1L, 10L)).thenReturn(Optional.of(generation(5L)));
        when(conversationRepository.find(1L, 5L)).thenReturn(Optional.of(conversation(9L)));
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(List.of(
                message(102L, "assistant", "我在听")));
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(extractClaim(1L, 10L));

        verify(memoryService, never()).create(
                anyLong(), anyLong(), anyString(), anyString(), isNull(), any());        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
    }

    @Test
    void clampsOversizedUserMessageToCandidateBound() {
        String longMessage = "长".repeat(MemoryExtractWorkItemHandler.MAX_CANDIDATE_CHARS + 100);
        when(generationRepository.find(1L, 10L)).thenReturn(Optional.of(generation(5L)));
        when(conversationRepository.find(1L, 5L)).thenReturn(Optional.of(conversation(9L)));
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(List.of(
                message(101L, "user", longMessage),
                message(102L, "assistant", "好的")));
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(extractClaim(1L, 10L));

        verify(memoryService).create(
                1L,
                9L,
                "RELATIONSHIP",
                "长".repeat(MemoryExtractWorkItemHandler.MAX_CANDIDATE_CHARS),
                null,
                List.of("message:101"));
    }

    @Test
    void skipsUserMessageFlaggedNoMemoryButStillCompletesTheItem() {
        when(generationRepository.find(1L, 10L)).thenReturn(Optional.of(generation(5L)));
        when(conversationRepository.find(1L, 5L)).thenReturn(Optional.of(conversation(9L)));
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(List.of(
                new MessageRepository.Message(1L, 101L, 5L, "user", "这条不要记住", true),
                new MessageRepository.Message(1L, 102L, 5L, "assistant", "好的")));
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(extractClaim(1L, 10L));

        verify(memoryService, never()).create(
                anyLong(), anyLong(), anyString(), anyString(), isNull(), any());
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
    }

    @Test
    void stillCompletesWhenCandidateCreateResolvesToEmpty() {
        when(generationRepository.find(1L, 10L)).thenReturn(Optional.of(generation(5L)));
        when(conversationRepository.find(1L, 5L)).thenReturn(Optional.of(conversation(9L)));
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(List.of(
                message(101L, "user", "我今天和老板聊了升职的事情"),
                message(102L, "assistant", "好的")));
        when(memoryService.create(1L, 9L, "RELATIONSHIP", "我今天和老板聊了升职的事情",
                null, List.of("message:101"))).thenReturn(Optional.empty());
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(extractClaim(1L, 10L));

        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
    }

    @Test
    void guardFailurePropagatesForTheWorkerIndependentFail() {
        org.mockito.Mockito.doThrow(new IllegalStateException("claim guard rejected"))
                .when(finalizeService)
                .assertActiveClaim(1L, 1L, "token-1", "FENCE-A");

        assertThrows(IllegalStateException.class, () -> handle(extractClaim(1L, 10L)));

        verify(generationRepository, never()).find(anyLong(), anyLong());
        verify(finalizeService, never()).completeWorkItem(anyLong(), anyString(), anyString());
    }

    @Test
    void completeRejectionThrows() {
        when(generationRepository.find(1L, 10L)).thenReturn(Optional.of(generation(5L)));
        when(conversationRepository.find(1L, 5L)).thenReturn(Optional.of(conversation(9L)));
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(List.of(
                message(101L, "user", "我今天和老板聊了升职的事情"),
                message(102L, "assistant", "好的")));
        when(memoryService.create(eq(1L), eq(9L), eq("RELATIONSHIP"),
                eq("我今天和老板聊了升职的事情"), isNull(), any())).thenReturn(Optional.of(candidate(201L)));
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(0);

        assertThrows(IllegalStateException.class, () -> handle(extractClaim(1L, 10L)));
    }

    @Test
    void whitelistHitAutoSavesAsAcceptedWithEmbeddingWhenEnabled() {
        when(generationRepository.find(1L, 10L)).thenReturn(Optional.of(generation(5L)));
        when(conversationRepository.find(1L, 5L)).thenReturn(Optional.of(conversation(9L)));
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(List.of(
                message(101L, "user", "以后请叫我小雪，谢谢你"),
                message(102L, "assistant", "好的")));
        when(memoryService.autoSaveEnabled(1L)).thenReturn(true);
        when(embeddingPort.space()).thenReturn(
                new com.virtualcompanion.runtime.memory.EmbeddingPort.EmbeddingSpace(
                        "deterministic-hash", "1", 64, "alpha-hash-64"));
        when(embeddingPort.embed(anyString())).thenReturn(new float[64]);
        MemoryRecord autoSaved = new MemoryRecord(
                202L, null, "RELATIONSHIP", "称呼偏好：小雪", "ACCEPTED", null, null, NOW, true);
        when(memoryService.createAutoSaved(1L, 9L, "RELATIONSHIP", "称呼偏好：小雪",
                null, List.of("message:101"))).thenReturn(Optional.of(autoSaved));
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(extractClaim(1L, 10L));

        verify(memoryService).createAutoSaved(
                1L, 9L, "RELATIONSHIP", "称呼偏好：小雪", null, List.of("message:101"));
        // An auto-saved memory is canonical immediately, so its embedding is
        // written right away (mirroring the confirm path).
        verify(memoryService).upsertEmbedding(
                eq(1L), eq(202L), anyString(), anyString(), anyInt(), anyString(), anyString());
        verify(memoryService, never()).create(
                anyLong(), anyLong(), anyString(), anyString(), isNull(), any());
        verify(finalizeService).completeWorkItem(1L, "token-1", "FENCE-A");
    }

    @Test
    void whitelistHitStaysPendingWhenTheOwnerSwitchedAutoSaveOff() {
        when(generationRepository.find(1L, 10L)).thenReturn(Optional.of(generation(5L)));
        when(conversationRepository.find(1L, 5L)).thenReturn(Optional.of(conversation(9L)));
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(List.of(
                message(101L, "user", "以后请叫我小雪，谢谢你"),
                message(102L, "assistant", "好的")));
        when(memoryService.autoSaveEnabled(1L)).thenReturn(false);
        when(memoryService.create(1L, 9L, "RELATIONSHIP", "以后请叫我小雪，谢谢你",
                null, List.of("message:101"))).thenReturn(Optional.of(candidate(201L)));
        when(finalizeService.completeWorkItem(1L, "token-1", "FENCE-A")).thenReturn(1);

        handle(extractClaim(1L, 10L));

        verify(memoryService, never()).createAutoSaved(
                anyLong(), anyLong(), anyString(), anyString(), isNull(), any());
        verify(memoryService).create(
                1L, 9L, "RELATIONSHIP", "以后请叫我小雪，谢谢你", null, List.of("message:101"));
    }
}
