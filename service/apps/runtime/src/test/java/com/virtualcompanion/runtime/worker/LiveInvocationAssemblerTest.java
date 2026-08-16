package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.conversation.contextplan.ContextBudget;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.execution.LiveInvocationRequest;
import com.virtualcompanion.modelruntime.routing.Entitlement;
import com.virtualcompanion.modelruntime.routing.RoutingRequest;
import com.virtualcompanion.modelruntime.routing.ServiceClass;
import com.virtualcompanion.platform.persistence.ConversationRepository;
import com.virtualcompanion.platform.persistence.GenerationRecord;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.MemoryRecord;
import com.virtualcompanion.platform.persistence.MemoryService;
import com.virtualcompanion.platform.persistence.MessageRepository;
import com.virtualcompanion.platform.persistence.RelationshipRecord;
import com.virtualcompanion.platform.persistence.RelationshipService;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Unit tests for {@link LiveInvocationAssembler} (TASK-0176, MEM-LOOP).
 * Verifies the two-hop ownership resolution (generation → conversation →
 * relationship), fence derivation from the {@code vc.job_fence} GUC, the
 * ZERO_LLM routing tuning, the message mapping with placeholder fallback, and
 * the recalled-memory SYSTEM context prepended on both assembly paths.
 */
class LiveInvocationAssemblerTest {

    private static final Instant NOW = Instant.parse("2026-08-16T08:00:00Z");

    /** CTX-BUDGET: generous default budget so legacy cases stay uncut. */
    private static final ContextBudget BUDGET = new ContextBudget(8_000, 2_048, 64);

    private final GenerationRepository generationRepository = mock(GenerationRepository.class);
    private final ConversationRepository conversationRepository = mock(ConversationRepository.class);
    private final MessageRepository messageRepository = mock(MessageRepository.class);
    private final MemoryService memoryService = mock(MemoryService.class);
    private final RelationshipService relationshipService = mock(RelationshipService.class);
    private final JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);

    private LiveInvocationAssembler assembler(String sourceId) {
        return assembler(sourceId, BUDGET);
    }

    private LiveInvocationAssembler assembler(String sourceId, ContextBudget budget) {
        return new LiveInvocationAssembler(
                generationRepository, conversationRepository, messageRepository, memoryService,
                relationshipService, jdbcTemplate, sourceId, ModelProtocol.OPENAI_CHAT_COMPLETIONS,
                budget);
    }

    @Test
    void assemblesZeroLlmRequestWithTwoHopOwnershipAndFence() {
        when(generationRepository.find(1L, 10L)).thenReturn(Optional.of(
                new GenerationRecord(1L, 10L, 5L, "gen-logical", "IN_PROGRESS", "idem-1")));
        when(conversationRepository.find(1L, 5L)).thenReturn(Optional.of(
                new ConversationRepository.Conversation(1L, 5L, 9L, null)));
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(List.of(
                new MessageRepository.Message(1L, 100L, 5L, "user", "hello"),
                new MessageRepository.Message(1L, 101L, 5L, "assistant", "hi there")));
        String fenceUuid = "12345678-1234-1234-1234-123456789abc";
        long expectedFence =
                UUID.fromString(fenceUuid).getMostSignificantBits() & Long.MAX_VALUE;
        when(jdbcTemplate.queryForObject(
                eq("SELECT current_setting('vc.job_fence', true)"), eq(String.class)))
                .thenReturn(fenceUuid);

        LiveInvocationRequest request = assembler("ZERO_LLM_FALLBACK").assemble(1L, 10L);

        RoutingRequest routing = request.routingRequest();
        OwnershipTuple ownership = routing.ownership();
        assertEquals("1", ownership.ownerUserId());
        assertEquals("9", ownership.relationshipId());
        assertEquals("5", ownership.conversationId());
        assertEquals("10", ownership.generationId());

        Entitlement entitlement = routing.entitlement();
        assertEquals("1", entitlement.ownerUserId());
        assertEquals(ServiceClass.zeroLlmOnly(), entitlement.serviceClass());
        assertTrue(entitlement.serviceClass().zeroLlmFallbackAllowed());
        assertEquals(ModelProtocol.ZERO_LLM, routing.requiredProtocol());
        assertTrue(routing.requiredCapabilities().values().isEmpty());
        assertEquals("ZERO_LLM_FALLBACK", routing.zeroLlmSourceId());
        assertEquals(expectedFence, routing.fence());

        assertEquals(2, request.messages().size());
        assertEquals(ProtocolMessage.Role.USER, request.messages().get(0).role());
        assertEquals(ProtocolMessage.Role.ASSISTANT, request.messages().get(1).role());
    }

    @Test
    void usesPlaceholderAndZeroFenceWhenNoMessagesAndNoGuc() {
        when(generationRepository.find(anyLong(), anyLong())).thenReturn(Optional.of(
                new GenerationRecord(2L, 20L, 7L, "gen-2", "IN_PROGRESS", "idem-2")));
        when(conversationRepository.find(anyLong(), anyLong())).thenReturn(Optional.of(
                new ConversationRepository.Conversation(2L, 7L, 11L, null)));
        when(messageRepository.listByConversation(anyLong(), anyLong())).thenReturn(List.of());
        when(jdbcTemplate.queryForObject(
                eq("SELECT current_setting('vc.job_fence', true)"), eq(String.class)))
                .thenReturn(null);

        LiveInvocationRequest request = assembler("SRC").assemble(2L, 20L);

        // Placeholder keeps the request valid; ZERO_LLM never reads it.
        assertEquals(1, request.messages().size());
        assertNotNull(request.messages().get(0).content());
        assertEquals(0L, request.routingRequest().fence());
        assertEquals("SRC", request.routingRequest().zeroLlmSourceId());
        // Capability set stays empty but non-null.
        assertTrue(request.routingRequest()
                .requiredCapabilities() instanceof ModelProtocolCapabilities);
    }

    @Test
    void assemblesExternalRequestWithSimulatedEntitlementAndSnapshots() {
        when(generationRepository.find(1L, 10L)).thenReturn(Optional.of(
                new GenerationRecord(1L, 10L, 5L, "gen-logical", "IN_PROGRESS", "idem-1")));
        when(conversationRepository.find(1L, 5L)).thenReturn(Optional.of(
                new ConversationRepository.Conversation(1L, 5L, 9L, null)));
        when(messageRepository.listByConversation(1L, 5L)).thenReturn(List.of(
                new MessageRepository.Message(1L, 100L, 5L, "user", "hello")));
        when(jdbcTemplate.queryForObject(
                eq("SELECT current_setting('vc.job_fence', true)"), eq(String.class)))
                .thenReturn(null);

        LiveInvocationRequest request = assembler("ZERO_LLM_FALLBACK")
                .assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec");

        RoutingRequest routing = request.routingRequest();
        // simulated entitlement: external allowed + ZERO_LLM fallback allowed.
        assertEquals(ServiceClass.simulated(), routing.entitlement().serviceClass());
        assertTrue(routing.entitlement().serviceClass().externalAttemptAllowed());
        // both snapshot ids bound for the external binding selection.
        assertEquals("snap-10-req", routing.requestedAuthorizationSnapshotId());
        assertEquals("snap-10-exec", routing.executionAuthorizationSnapshotId());
        // configured external protocol + fallback ZERO_LLM source carried.
        assertEquals(ModelProtocol.OPENAI_CHAT_COMPLETIONS, routing.requiredProtocol());
        assertEquals("ZERO_LLM_FALLBACK", routing.zeroLlmSourceId());
        // two-hop ownership reused.
        assertEquals("10", routing.ownership().generationId());
        assertEquals(0L, routing.fence());
    }

    // ---- MEM-LOOP recall context ----

    private void stubOwnershipAndMessages(long owner, long generationId, long conversationId,
            long relationshipId, List<MessageRepository.Message> messages) {
        when(generationRepository.find(owner, generationId)).thenReturn(Optional.of(
                new GenerationRecord(owner, generationId, conversationId, "gen", "IN_PROGRESS", "idem")));
        when(conversationRepository.find(owner, conversationId)).thenReturn(Optional.of(
                new ConversationRepository.Conversation(owner, conversationId, relationshipId, null)));
        when(messageRepository.listByConversation(owner, conversationId)).thenReturn(messages);
        when(jdbcTemplate.queryForObject(
                eq("SELECT current_setting('vc.job_fence', true)"), eq(String.class)))
                .thenReturn(null);
        // PERSONA-WIRE: default — no relationship row (no persona context).
        when(relationshipService.get(owner, relationshipId)).thenReturn(Optional.empty());
    }

    @Test
    void prependsRecalledMemoryAsSystemContextOnZeroLlmPath() {
        stubOwnershipAndMessages(1L, 10L, 5L, 9L, List.of(
                new MessageRepository.Message(1L, 100L, 5L, "user", "hello")));
        when(memoryService.recall(1L, 9L, 5L, 20)).thenReturn(List.of(
                new MemoryRecord(30L, null, "RELATIONSHIP", "用户养了一只猫叫雪球", "ACCEPTED",
                        null, null, NOW)));

        LiveInvocationRequest request = assembler("SRC").assemble(1L, 10L);

        assertEquals(2, request.messages().size());
        assertEquals(ProtocolMessage.Role.SYSTEM, request.messages().get(0).role());
        assertTrue(request.messages().get(0).content().contains("用户养了一只猫叫雪球"));
        assertEquals(ProtocolMessage.Role.USER, request.messages().get(1).role());
    }

    @Test
    void prependsRecalledMemoryAsSystemContextOnExternalPath() {
        stubOwnershipAndMessages(1L, 10L, 5L, 9L, List.of(
                new MessageRepository.Message(1L, 100L, 5L, "user", "hello")));
        when(memoryService.recall(1L, 9L, 5L, 20)).thenReturn(List.of(
                new MemoryRecord(30L, null, "RELATIONSHIP", "用户养了一只猫叫雪球", "ACCEPTED",
                        null, null, NOW)));

        LiveInvocationRequest request = assembler("SRC")
                .assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec");

        assertEquals(2, request.messages().size());
        assertEquals(ProtocolMessage.Role.SYSTEM, request.messages().get(0).role());
        assertTrue(request.messages().get(0).content().contains("用户养了一只猫叫雪球"));
    }

    // ---- PERSONA-WIRE persona context ----

    @Test
    void prependsPersonaAsOutermostSystemContextOnExternalPath() {
        stubOwnershipAndMessages(1L, 10L, 5L, 9L, List.of(
                new MessageRepository.Message(1L, 100L, 5L, "user", "hello")));
        when(relationshipService.get(1L, 9L)).thenReturn(Optional.of(
                new RelationshipRecord(9L, "gentle-listener", true, NOW)));
        when(memoryService.recall(1L, 9L, 5L, 20)).thenReturn(List.of(
                new MemoryRecord(30L, null, "RELATIONSHIP", "用户养了一只猫叫雪球", "ACCEPTED",
                        null, null, NOW)));

        LiveInvocationRequest request = assembler("SRC")
                .assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec");

        // persona SYSTEM first, then recall SYSTEM, then the history.
        assertEquals(3, request.messages().size());
        assertEquals(ProtocolMessage.Role.SYSTEM, request.messages().get(0).role());
        assertTrue(request.messages().get(0).content().contains("Gentle Listener"));
        assertTrue(request.messages().get(0).content().contains("calm, reflective"));
        assertTrue(request.messages().get(1).content().contains("用户养了一只猫叫雪球"));
    }

    @Test
    void unknownPersonaRefLeavesMessagesUntouched() {
        stubOwnershipAndMessages(1L, 10L, 5L, 9L, List.of(
                new MessageRepository.Message(1L, 100L, 5L, "user", "hello")));
        when(relationshipService.get(1L, 9L)).thenReturn(Optional.of(
                new RelationshipRecord(9L, "some-legacy-ref", true, NOW)));

        LiveInvocationRequest request = assembler("SRC")
                .assembleExternal(1L, 10L, "snap-10-req", "snap-10-exec");

        // No persona context invented for an unknown ref.
        assertEquals(1, request.messages().size());
        assertEquals(ProtocolMessage.Role.USER, request.messages().get(0).role());
    }

    @Test
    void zeroLlmPathDoesNotConsumePersonaContext() {
        stubOwnershipAndMessages(1L, 10L, 5L, 9L, List.of(
                new MessageRepository.Message(1L, 100L, 5L, "user", "hello")));
        when(relationshipService.get(1L, 9L)).thenReturn(Optional.of(
                new RelationshipRecord(9L, "gentle-listener", true, NOW)));

        LiveInvocationRequest request = assembler("SRC").assemble(1L, 10L);

        // The deterministic ZERO_LLM content is fixed; no persona is injected.
        assertEquals(1, request.messages().size());
        assertEquals(ProtocolMessage.Role.USER, request.messages().get(0).role());
    }

    @Test
    void emptyRecallLeavesMessagesUntouched() {
        stubOwnershipAndMessages(1L, 10L, 5L, 9L, List.of(
                new MessageRepository.Message(1L, 100L, 5L, "user", "hello")));
        when(memoryService.recall(1L, 9L, 5L, 20)).thenReturn(List.of());

        LiveInvocationRequest request = assembler("SRC").assemble(1L, 10L);

        assertEquals(1, request.messages().size());
        assertEquals(ProtocolMessage.Role.USER, request.messages().get(0).role());
    }

    // ---- CTX-BUDGET ----

    @Test
    void estimateTokensIsByteBasedAndDeterministic() {
        assertEquals(1, LiveInvocationAssembler.estimateTokens("a"));
        // ASCII: 4 bytes = 1 token, 5 bytes = 2 tokens.
        assertEquals(1, LiveInvocationAssembler.estimateTokens("abcd"));
        assertEquals(2, LiveInvocationAssembler.estimateTokens("abcde"));
        // CJK: one char is 3 UTF-8 bytes, so two chars (6 bytes) = 2 tokens.
        assertEquals(2, LiveInvocationAssembler.estimateTokens("你好"));
        assertEquals(0, LiveInvocationAssembler.estimateTokens(""));
        assertEquals(0, LiveInvocationAssembler.estimateTokens(null));
    }

    @Test
    void keepsOnlyTheNewestMessagesWhenTheBudgetIsTight() {
        // Each message is ~2 tokens ("old-1" is 5 bytes → 2 tokens). A budget
        // of 4 tokens keeps only the two newest messages; the oldest is cut.
        stubOwnershipAndMessages(1L, 10L, 5L, 9L, List.of(
                new MessageRepository.Message(1L, 100L, 5L, "user", "old-1"),
                new MessageRepository.Message(1L, 101L, 5L, "assistant", "mid-2"),
                new MessageRepository.Message(1L, 102L, 5L, "user", "new-3")));
        when(memoryService.recall(1L, 9L, 5L, 20)).thenReturn(List.of());

        LiveInvocationRequest request =
                assembler("SRC", new ContextBudget(4, 128, 64)).assemble(1L, 10L);

        assertEquals(2, request.messages().size());
        assertEquals("mid-2", request.messages().get(0).content());
        assertEquals("new-3", request.messages().get(1).content());
    }

    @Test
    void alwaysKeepsTheNewestMessageEvenForATinyBudget() {
        stubOwnershipAndMessages(1L, 10L, 5L, 9L, List.of(
                new MessageRepository.Message(1L, 100L, 5L, "user", "old"),
                new MessageRepository.Message(1L, 101L, 5L, "user", "new")));
        when(memoryService.recall(1L, 9L, 5L, 20)).thenReturn(List.of());

        LiveInvocationRequest request =
                assembler("SRC", new ContextBudget(1, 128, 64)).assemble(1L, 10L);

        assertEquals(1, request.messages().size());
        assertEquals("new", request.messages().get(0).content());
    }

    @Test
    void recallBlockIsCutToTheRecallBudgetShare() {
        // Budget 90 → recall share 30 tokens; the header (~15 CJK chars ≈ 12
        // tokens) plus each "- xxx" line (7-9 bytes ≈ 2-3 tokens) fills up and
        // the tail entries are dropped.
        stubOwnershipAndMessages(1L, 10L, 5L, 9L, List.of(
                new MessageRepository.Message(1L, 100L, 5L, "user", "hello")));
        List<MemoryRecord> recalled = new java.util.ArrayList<>();
        for (int i = 0; i < 20; i++) {
            recalled.add(new MemoryRecord(
                    30L + i, null, "RELATIONSHIP", "记忆条目" + i, "ACCEPTED",
                    null, null, NOW));
        }
        when(memoryService.recall(1L, 9L, 5L, 20)).thenReturn(recalled);

        LiveInvocationRequest request =
                assembler("SRC", new ContextBudget(90, 128, 64)).assemble(1L, 10L);

        assertEquals(2, request.messages().size());
        String recall = request.messages().get(0).content();
        assertEquals(ProtocolMessage.Role.SYSTEM, request.messages().get(0).role());
        assertTrue(recall.contains("记忆条目0"));
        assertTrue(!recall.contains("记忆条目19"));
    }
}
