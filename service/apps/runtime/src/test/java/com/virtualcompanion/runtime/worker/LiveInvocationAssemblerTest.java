package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.catalog.ModelProtocol;
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

    private final GenerationRepository generationRepository = mock(GenerationRepository.class);
    private final ConversationRepository conversationRepository = mock(ConversationRepository.class);
    private final MessageRepository messageRepository = mock(MessageRepository.class);
    private final MemoryService memoryService = mock(MemoryService.class);
    private final JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);

    private LiveInvocationAssembler assembler(String sourceId) {
        return new LiveInvocationAssembler(
                generationRepository, conversationRepository, messageRepository, memoryService,
                jdbcTemplate, sourceId, ModelProtocol.OPENAI_CHAT_COMPLETIONS);
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

    @Test
    void emptyRecallLeavesMessagesUntouched() {
        stubOwnershipAndMessages(1L, 10L, 5L, 9L, List.of(
                new MessageRepository.Message(1L, 100L, 5L, "user", "hello")));
        when(memoryService.recall(1L, 9L, 5L, 20)).thenReturn(List.of());

        LiveInvocationRequest request = assembler("SRC").assemble(1L, 10L);

        assertEquals(1, request.messages().size());
        assertEquals(ProtocolMessage.Role.USER, request.messages().get(0).role());
    }
}
