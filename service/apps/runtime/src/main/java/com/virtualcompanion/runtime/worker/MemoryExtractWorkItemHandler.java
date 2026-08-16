package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.platform.persistence.ConversationRepository;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationRecord;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.MemoryRecord;
import com.virtualcompanion.platform.persistence.MemoryService;
import com.virtualcompanion.platform.persistence.MessageRepository;
import com.virtualcompanion.platform.persistence.WorkItemClaim;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Memory-extraction work-item handler (MEM-LOOP entry half).
 *
 * <p>Consumes {@code MEMORY_EXTRACT} items enqueued by the generation handler
 * in its guarded finalize transaction. Technical Alpha has no real extraction
 * model (fake/zero-LLM adapters return canned text), so the extractor is
 * deterministic: the completed turn's <em>user message</em> is proposed
 * verbatim (clamped) as a {@code RELATIONSHIP}-scoped candidate, with the
 * message id cited as evidence. A trimmed message shorter than
 * {@link #MIN_CANDIDATE_CHARS} (greetings, acknowledgments) carries no memory
 * value and is skipped.
 *
 * <p>The candidate is always {@code PENDING_CONFIRMATION} — canonical memory is
 * reached only through user confirmation (INV-MEM-001/002), so the
 * confirmation gate (confirm/reject/edit UI already exists) is the safety
 * valve for extraction noise. When a real model runtime is wired, this
 * handler is the seam to replace with a model-based extraction prompt.
 *
 * <p>Unlike {@link GenerationWorkItemHandler} there is no external call, so
 * the handler runs one short owner-bound transaction: claim guard (V28
 * explicit token/fence), ownership two-hop, exchange read, candidate create,
 * per-item complete. A failure throws to the worker, which applies the
 * independent per-item fail (terminal — there is nothing transient to
 * retry and the completed generation is unaffected either way).
 */
public class MemoryExtractWorkItemHandler implements WorkItemHandler {

    private static final Logger log = LoggerFactory.getLogger(MemoryExtractWorkItemHandler.class);

    /** Work-item kind handled here; also the dispatcher's MEMORY_EXTRACT key. */
    public static final String KIND_MEMORY_EXTRACT = "MEMORY_EXTRACT";

    /** Minimum trimmed user-message length that still carries memory value. */
    static final int MIN_CANDIDATE_CHARS = 8;

    /** Candidate summary clamp; the SD stores the summary verbatim. */
    static final int MAX_CANDIDATE_CHARS = 2000;

    private final GenerationRepository generationRepository;
    private final ConversationRepository conversationRepository;
    private final MessageRepository messageRepository;
    private final MemoryService memoryService;
    private final GenerationFinalizeService finalizeService;

    public MemoryExtractWorkItemHandler(
            GenerationRepository generationRepository,
            ConversationRepository conversationRepository,
            MessageRepository messageRepository,
            MemoryService memoryService,
            GenerationFinalizeService finalizeService) {
        this.generationRepository = generationRepository;
        this.conversationRepository = conversationRepository;
        this.messageRepository = messageRepository;
        this.memoryService = memoryService;
        this.finalizeService = finalizeService;
    }

    @Override
    public void handle(WorkItemClaim claim) {
        if (!KIND_MEMORY_EXTRACT.equals(claim.kind())) {
            log.warn("memory-extract handler skipping non-MEMORY_EXTRACT item kind={}", claim.kind());
            return;
        }
        WorkItemWorker.OwnerExecutor executor = WorkItemWorker.segmentExecutor();
        long ownerUserId = claim.ownerUserId();
        long generationId = claim.refId();
        try {
            executor.asOwner(ownerUserId, () -> extractSegment(ownerUserId, generationId, claim));
        } catch (RuntimeException e) {
            log.error("memory-extract handler failed for owner={} generation={} workItem={}",
                    ownerUserId, generationId, claim.id(), e);
            // The worker applies the independent per-item fail (fresh
            // transaction, only the original item/token/fence).
            throw e;
        }
    }

    /** One owner-bound transaction: guard, resolve, extract, create, complete. */
    private void extractSegment(long ownerUserId, long generationId, WorkItemClaim claim) {
        finalizeService.assertActiveClaim(
                ownerUserId, claim.id(), claim.claimToken(), claim.claimFence());
        Exchange exchange = resolveExchange(ownerUserId, generationId);
        Optional<MemoryRecord> created = extractCandidate(ownerUserId, exchange);
        if (created.isPresent()) {
            log.info("memory candidate {} proposed for owner {} from generation {}",
                    created.get().id(), ownerUserId, generationId);
        }
        int rows = finalizeService.completeWorkItem(
                claim.id(), claim.claimToken(), claim.claimFence());
        if (rows != 1) {
            throw new IllegalStateException(
                    "per-item complete inside memory-extract returned rows=" + rows);
        }
    }

    /** generation → conversation → relationship two-hop + the completed exchange. */
    private Exchange resolveExchange(long ownerUserId, long generationId) {
        GenerationRecord generation = generationRepository
                .find(ownerUserId, generationId)
                .orElseThrow(() -> new IllegalStateException(
                        "generation " + generationId + " not found for owner " + ownerUserId));
        long conversationId = generation.conversationId();
        long relationshipId = conversationRepository
                .find(ownerUserId, conversationId)
                .orElseThrow(() -> new IllegalStateException(
                        "conversation " + conversationId + " not found for owner " + ownerUserId))
                .relationshipId();
        List<MessageRepository.Message> messages =
                messageRepository.listByConversation(ownerUserId, conversationId);
        return new Exchange(relationshipId, lastUserMessage(messages));
    }

    /**
     * Propose the user's own statement as a {@code RELATIONSHIP} candidate
     * (canonicalLongTermMemoryScope), or nothing when the message is too short
     * or a candidate cannot be created (relationship vanished mid-flight —
     * extraction is best-effort and never blocks the completed generation).
     */
    private Optional<MemoryRecord> extractCandidate(long ownerUserId, Exchange exchange) {
        MessageRepository.Message userMessage = exchange.userMessage();
        if (userMessage == null) {
            return Optional.empty();
        }
        String summary = clamp(userMessage.content());
        if (summary.isBlank() || summary.trim().length() < MIN_CANDIDATE_CHARS) {
            log.debug("skipping memory extraction for owner {}: user message too short",
                    ownerUserId);
            return Optional.empty();
        }
        return memoryService.create(
                ownerUserId,
                exchange.relationshipId(),
                "RELATIONSHIP",
                summary,
                null,
                List.of("message:" + userMessage.id()));
    }

    /** The most recent non-blank user message (chronological, capped at 64). */
    private static MessageRepository.Message lastUserMessage(
            List<MessageRepository.Message> messages) {
        for (int i = messages.size() - 1; i >= 0; i--) {
            MessageRepository.Message message = messages.get(i);
            if (!"user".equalsIgnoreCase(message.role())) {
                continue;
            }
            String content = message.content();
            if (content != null && !content.isBlank()) {
                return message;
            }
        }
        return null;
    }

    private static String clamp(String content) {
        if (content.length() <= MAX_CANDIDATE_CHARS) {
            return content;
        }
        return content.substring(0, MAX_CANDIDATE_CHARS);
    }

    /** Immutable resolution result for one completed exchange. */
    private record Exchange(long relationshipId, MessageRepository.Message userMessage) {
    }
}
