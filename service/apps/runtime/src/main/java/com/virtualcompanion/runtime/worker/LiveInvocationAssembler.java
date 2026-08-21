package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import com.virtualcompanion.conversation.contextplan.CompanionPreferenceInstructions;
import com.virtualcompanion.conversation.contextplan.ContextBudget;
import com.virtualcompanion.conversation.contextplan.PersonaSkeleton;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.execution.LiveInvocationRequest;
import com.virtualcompanion.modelruntime.routing.Entitlement;
import com.virtualcompanion.modelruntime.routing.RoutingRequest;
import com.virtualcompanion.modelruntime.routing.ServiceClass;
import com.virtualcompanion.platform.persistence.ConversationRepository;
import com.virtualcompanion.platform.persistence.EntitlementSnapshotService;
import com.virtualcompanion.runtime.memory.EmbeddingPort;
import com.virtualcompanion.platform.persistence.GenerationRecord;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.MemoryRecord;
import com.virtualcompanion.platform.persistence.MemoryService;
import com.virtualcompanion.platform.persistence.MessageRepository;
import com.virtualcompanion.platform.persistence.CompanionPrefs;
import com.virtualcompanion.platform.persistence.RelationshipRecord;
import com.virtualcompanion.platform.persistence.RelationshipService;
import com.virtualcompanion.safety.ClassifierReport;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Builds the {@link LiveInvocationRequest} that drives a generation's ZERO_LLM
 * deterministic completion (TASK-0176).
 *
 * <p>The request is tuned so the {@code DeterministicRouter} selects the
 * deterministic source and never enters the external-attempt branch: the
 * entitlement is {@link ServiceClass#zeroLlmOnly()} (external forbidden), the
 * {@code zeroLlmSourceId} is the configured non-blank source, and both
 * authorization snapshot ids are null (ZERO_LLM needs no external snapshot).
 *
 * <p>Ownership is resolved with the server-trusted ids already established by
 * the worker's owner-bound transaction: {@code generation → conversation →
 * relationship} (two repository hops, since the generation row carries only the
 * conversation id). The fence is read from the transaction-local
 * {@code vc.job_fence} GUC the claim path bound, masked to a non-negative
 * {@code long} (the router uses it only as decision identity/audit; ZERO_LLM
 * never gates an external session on it).
 *
 * <p>{@code messages} are loaded so the request satisfies the non-empty
 * constructor contract and so the external-attempt path can reuse this
 * assembler later; the ZERO_LLM branch never consumes them.
 *
 * <p>MEM-LOOP: confirmed memory (V13 {@code vc.recall_memory}) is prepended as
 * a SYSTEM context message — RELATIONSHIP-scoped across conversations,
 * SESSION-scoped only for the generating conversation. The ZERO_LLM branch
 * ignores it (deterministic content), the external branch consumes it.
 */
public class LiveInvocationAssembler {

    /** Safe per-message byte budget below {@code SizeLimits.MAX_MESSAGE_BYTES} (64 KiB). */
    private static final int MAX_MESSAGE_BYTES = 65_500;
    private static final int MAX_MESSAGES = 64;
    private static final String PLACEHOLDER_USER_CONTENT = ".";

    /** Recall budget: entries cap handed to the SD and per-summary char clamp. */
    private static final int MAX_RECALL_ENTRIES = 20;
    private static final int MAX_RECALL_SUMMARY_CHARS = 500;
    private static final String RECALL_HEADER =
            "以下是关于用户的长期记忆（仅参考与当前对话相关的条目）：";

    /**
     * CTX-BUDGET: deterministic token estimate divisor. UTF-8 bytes / 4 is a
     * conservative, provider-neutral estimate (≈ one token per four bytes,
     * safe for CJK and ASCII alike) with no external dependency — the same
     * input always reproduces the same estimate.
     */
    private static final int TOKEN_ESTIMATE_BYTES_PER_TOKEN = 4;

    /** CTX-BUDGET: share of the input budget reserved for the recall block. */
    private static final int RECALL_BUDGET_SHARE = 3;

    private final GenerationRepository generationRepository;
    private final ConversationRepository conversationRepository;
    private final MessageRepository messageRepository;
    private final MemoryService memoryService;
    private final RelationshipService relationshipService;
    private final JdbcTemplate jdbcTemplate;
    private final String zeroLlmSourceId;
    private final ModelProtocol externalProtocol;
    private final ContextBudget budget;
    private final EntitlementSnapshotService entitlementSnapshotService;
    private final EmbeddingPort embeddingPort;
    private final boolean degraded;
    /** EXTERNAL-TIMEOUT: real-provider budget for the external attempt path. */
    private final TimeoutBudget externalTimeoutBudget;

    public LiveInvocationAssembler(
            GenerationRepository generationRepository,
            ConversationRepository conversationRepository,
            MessageRepository messageRepository,
            MemoryService memoryService,
            RelationshipService relationshipService,
            JdbcTemplate jdbcTemplate,
            String zeroLlmSourceId,
            ModelProtocol externalProtocol,
            ContextBudget budget,
            EntitlementSnapshotService entitlementSnapshotService,
            EmbeddingPort embeddingPort,
            boolean degraded) {
        this(
                generationRepository,
                conversationRepository,
                messageRepository,
                memoryService,
                relationshipService,
                jdbcTemplate,
                zeroLlmSourceId,
                externalProtocol,
                budget,
                entitlementSnapshotService,
                embeddingPort,
                degraded,
                // Legacy default: tight loopback-era budget (1s). Real-provider
                // deployments must pass an explicit budget via the configurable
                // constructor (EXTERNAL-TIMEOUT).
                new TimeoutBudget(
                        Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1)));
    }

    public LiveInvocationAssembler(
            GenerationRepository generationRepository,
            ConversationRepository conversationRepository,
            MessageRepository messageRepository,
            MemoryService memoryService,
            RelationshipService relationshipService,
            JdbcTemplate jdbcTemplate,
            String zeroLlmSourceId,
            ModelProtocol externalProtocol,
            ContextBudget budget,
            EntitlementSnapshotService entitlementSnapshotService,
            EmbeddingPort embeddingPort,
            boolean degraded,
            TimeoutBudget externalTimeoutBudget) {
        this.generationRepository = Objects.requireNonNull(generationRepository);
        this.conversationRepository = Objects.requireNonNull(conversationRepository);
        this.messageRepository = Objects.requireNonNull(messageRepository);
        this.memoryService = Objects.requireNonNull(memoryService, "memoryService must not be null");
        this.relationshipService =
                Objects.requireNonNull(relationshipService, "relationshipService must not be null");
        this.jdbcTemplate = Objects.requireNonNull(jdbcTemplate);
        this.zeroLlmSourceId = requireSourceId(zeroLlmSourceId);
        this.externalProtocol = Objects.requireNonNull(externalProtocol, "externalProtocol must not be null");
        this.budget = Objects.requireNonNull(budget, "budget must not be null");
        this.entitlementSnapshotService = Objects.requireNonNull(
                entitlementSnapshotService, "entitlementSnapshotService must not be null");
        this.embeddingPort = Objects.requireNonNull(embeddingPort, "embeddingPort must not be null");
        this.degraded = degraded;
        this.externalTimeoutBudget = Objects.requireNonNull(
                externalTimeoutBudget, "externalTimeoutBudget must not be null");
    }

    /**
     * Assemble the ZERO_LLM {@code LiveInvocationRequest} for one generation.
     *
     * @throws IllegalStateException if the generation or its conversation cannot
     *     be resolved for the owner (fail closed; the handler terminalizes).
     */
    public LiveInvocationRequest assemble(long ownerUserId, long generationId) {
        return assemble(ownerUserId, generationId, null);
    }

    /**
     * Assemble the ZERO_LLM {@code LiveInvocationRequest} for one generation
     * with the claim fence passed explicitly (TASK-0194). The fence is read
     * from the caller's claim (V28 returns it from {@code claim_work_items})
     * because it is transaction-local in the claim transaction and therefore
     * no longer visible in the segmented prepare transaction.
     *
     * @param claimFence the claim fence issued by the coordinator (may be null
     *     for legacy callers, which fall back to the transaction-local GUC)
     */
    public LiveInvocationRequest assemble(long ownerUserId, long generationId, String claimFence) {
        ResolvedContext context = loadContext(ownerUserId, generationId);
        OwnershipTuple ownership = context.ownership();
        // CTX-BUDGET: fixed SYSTEM blocks (recall; the ZERO_LLM path carries no
        // persona) are budgeted first, history takes the remaining tokens.
        String recallBlock = recallBlock(ownerUserId, ownership);
        List<ProtocolMessage> messages = loadMessages(
                ownerUserId, ownership.conversationId(), messageTokenBudget(null, recallBlock));
        messages = prependBlocks(messages, null, recallBlock);
        long fence = fenceValue(claimFence, readFence());

        Entitlement entitlement = new Entitlement(
                ownership.ownerUserId(), ServiceClass.zeroLlmOnly());
        RoutingRequest routing = new RoutingRequest(
                ownership,
                entitlement,
                ModelProtocol.ZERO_LLM,
                new ModelProtocolCapabilities(java.util.Set.of()),
                null,
                null,
                zeroLlmSourceId,
                fence);

        return new LiveInvocationRequest(
                routing,
                messages,
                new ResponseMode.Text(),
                false,
                new TimeoutBudget(
                        Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1)),
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.80));
    }

    /**
     * Assemble the external-provider {@code LiveInvocationRequest} for one
     * generation (TASK-0177).
     *
     * <p>Tuned so the {@code DeterministicRouter} selects an
     * {@code ExternalAttemptBinding} for an admitted deployment: the entitlement
     * is {@link ServiceClass#simulated()} (external allowed, ZERO_LLM fallback
     * allowed), both authorization snapshot ids are non-null, the required
     * protocol matches the configured deployment, and the configured ZERO_LLM
     * source id is carried as the fallback source. The safety gate receives an
     * adequate classifier report and no hard-rule violations so a simulated /
     * loopback attempt is released (the real classifier integration is a later
     * safety-domain task).
     *
     * @param requestedSnapshotId   the requested authorization snapshot id
     *     ({@link AuthorizationSnapshotService#createFor} minted the row)
     * @param executionSnapshotId   the execution authorization snapshot id
     * @throws IllegalStateException if the generation or conversation cannot be
     *     resolved for the owner (fail closed; the handler terminalizes)
     */
    public LiveInvocationRequest assembleExternal(
            long ownerUserId,
            long generationId,
            String requestedSnapshotId,
            String executionSnapshotId) {
        return assembleExternal(
                ownerUserId, generationId, requestedSnapshotId, executionSnapshotId, null);
    }

    /**
     * Assemble the external-provider {@code LiveInvocationRequest} for one
     * generation with the claim fence passed explicitly (TASK-0194; see
     * {@link #assemble(long, long, String)} for why the fence cannot be read
     * from the transaction-local GUC in the segmented prepare transaction).
     *
     * @param claimFence the claim fence issued by the coordinator (may be null
     *     for legacy callers, which fall back to the transaction-local GUC)
     */
    public LiveInvocationRequest assembleExternal(
            long ownerUserId,
            long generationId,
            String requestedSnapshotId,
            String executionSnapshotId,
            String claimFence) {
        Objects.requireNonNull(requestedSnapshotId, "requestedSnapshotId must not be null");
        Objects.requireNonNull(executionSnapshotId, "executionSnapshotId must not be null");
        if (requestedSnapshotId.isBlank() || executionSnapshotId.isBlank()) {
            throw new IllegalArgumentException(
                    "requestedSnapshotId and executionSnapshotId must not be blank");
        }
        ResolvedContext context = loadContext(ownerUserId, generationId);
        OwnershipTuple ownership = context.ownership();
        // ENT-SNAP (A3-001): mint (or resolve) the generation's immutable
        // entitlement snapshot inside the guarded prepare transaction; the
        // ADMIN-assigned class (ECONOMY/PREMIUM, ECONOMY default) becomes the
        // routing entitlement instead of the hardcoded simulated tier. Retries
        // of the same logical generation resolve the same snapshot
        // (FR-ENT-004).
        // DEGRADED-AI (V62 / §12.10 D2): when the deployment declares a
        // degradation, the SD mints PREMIUM entitlements one class lower
        // (ECONOMY actual); the snapshot records the 应得 vs 实际 pair and
        // the router consumes the ACTUAL class.
        EntitlementSnapshotService.MintedEntitlementSnapshot minted =
                entitlementSnapshotService.mint(ownerUserId, generationId, degraded);
        Entitlement entitlement = new Entitlement(
                ownership.ownerUserId(), ServiceClass.fromCode(minted.serviceClass()));
        // PERSONA-WIRE: the companion persona is the outermost SYSTEM context
        // (so it prepends BEFORE the recall block); consumed by the external
        // branch only (the ZERO_LLM branch ignores it). Real persona content
        // is approved out of band — only the approved skeleton fields are
        // rendered, nothing is invented. CHAT-MODE: an explicitly requested
        // LISTEN/DISCUSS overrides the persona default for this turn.
        // CTX-BUDGET: both SYSTEM blocks are budgeted first, history takes the
        // remaining input tokens (most recent messages kept first).
        String personaBlock = personaBlock(ownerUserId, ownership, context.mode());
        String recallBlock = recallBlock(ownerUserId, ownership);
        List<ProtocolMessage> messages = loadMessages(
                ownerUserId, ownership.conversationId(), messageTokenBudget(personaBlock, recallBlock));
        messages = prependBlocks(messages, personaBlock, recallBlock);
        long fence = fenceValue(claimFence, readFence());

        RoutingRequest routing = new RoutingRequest(
                ownership,
                entitlement,
                externalProtocol,
                new ModelProtocolCapabilities(java.util.Set.of()),
                requestedSnapshotId,
                executionSnapshotId,
                zeroLlmSourceId,
                fence);

        // STREAM-LIVE: the external attempt streams — the adapter emits
        // incremental deltas forwarded live by the worker's event sink.
        // EXTERNAL-TIMEOUT: real providers (reasoning models in particular)
        // need a generous budget — a 1s total would time out before the first
        // content delta; the budget is deployment-tunable, not hard-coded.
        return new LiveInvocationRequest(
                routing,
                messages,
                new ResponseMode.Text(),
                true,
                externalTimeoutBudget,
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.80));
    }

    /**
     * CHAT-MODE: resolve the owner-bound ownership tuple together with the
     * generation's frozen reception mode (a single record fetch serves both).
     */
    private ResolvedContext loadContext(long ownerUserId, long generationId) {
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
        return new ResolvedContext(
                new OwnershipTuple(
                        Long.toString(ownerUserId),
                        Long.toString(relationshipId),
                        Long.toString(conversationId),
                        Long.toString(generationId)),
                generation.mode());
    }

    /** Ownership + frozen reception mode for one generation turn. */
    private record ResolvedContext(OwnershipTuple ownership, String mode) {
    }

    /**
     * CTX-BUDGET: load history most-recent-first under a token budget. Rows
     * are walked backwards from the newest message, each clamped to
     * {@link #MAX_MESSAGE_BYTES} and counted via {@link #estimateTokens}; once
     * the budget is exhausted no older message is added (at least the newest
     * one is always kept). The result is returned oldest-first as before, and
     * the list never exceeds {@link #MAX_MESSAGES} entries.
     */
    private List<ProtocolMessage> loadMessages(
            long ownerUserId, String conversationIdStr, int maxMessageTokens) {
        long conversationId = Long.parseLong(conversationIdStr);
        List<com.virtualcompanion.platform.persistence.MessageRepository.Message> rows =
                messageRepository.listByConversation(ownerUserId, conversationId);
        List<ProtocolMessage> newestFirst = new ArrayList<>();
        int usedTokens = 0;
        for (int i = rows.size() - 1; i >= 0 && newestFirst.size() < MAX_MESSAGES; i--) {
            com.virtualcompanion.platform.persistence.MessageRepository.Message m = rows.get(i);
            String content = m.content();
            if (content == null || content.isBlank()) {
                continue;
            }
            String clamped = clamp(content);
            int tokens = estimateTokens(clamped);
            if (usedTokens + tokens > maxMessageTokens && !newestFirst.isEmpty()) {
                break;
            }
            newestFirst.add(new ProtocolMessage(toRole(m.role()), clamped));
            usedTokens += tokens;
        }
        if (newestFirst.isEmpty()) {
            // Constructor requires a non-empty list; ZERO_LLM never reads it, so a
            // single placeholder keeps the request valid without inventing history.
            return List.of(new ProtocolMessage(ProtocolMessage.Role.USER, PLACEHOLDER_USER_CONTENT));
        }
        List<ProtocolMessage> oldestFirst = new ArrayList<>(newestFirst.size());
        for (int i = newestFirst.size() - 1; i >= 0; i--) {
            oldestFirst.add(newestFirst.get(i));
        }
        return oldestFirst;
    }

    /**
     * CTX-BUDGET: remaining input tokens for the message history after the
     * fixed SYSTEM blocks (persona + recall) are accounted for. Always at
     * least one token so the newest message can always be carried.
     */
    private int messageTokenBudget(String personaBlock, String recallBlock) {
        int fixed = (personaBlock == null ? 0 : estimateTokens(personaBlock))
                + (recallBlock == null ? 0 : estimateTokens(recallBlock));
        return Math.max(1, budget.maxInputTokens() - fixed);
    }

    /**
     * PERSONA-WIRE: render the relationship's persona SYSTEM block from the
     * approved skeleton fields only (display name, tone, default interaction
     * mode, reflection style). An unknown/absent personaRef yields null — no
     * synthetic persona is invented.
     *
     * <p>CHAT-MODE: an explicitly requested {@code LISTEN} or {@code DISCUSS}
     * appends a fixed, approved turn-mode instruction that overrides the
     * persona default for this turn. {@code AUTO} (or an absent mode) keeps the
     * persona default untouched.
     */
    private String personaBlock(long ownerUserId, OwnershipTuple ownership, String mode) {
        long relationshipId = Long.parseLong(ownership.relationshipId());
        RelationshipRecord relationship =
                relationshipService.get(ownerUserId, relationshipId).orElse(null);
        if (relationship == null) {
            return null;
        }
        List<String> parts = new ArrayList<>();
        PersonaSkeleton persona = personaFor(relationship.personaRef());
        if (persona != null) {
            parts.add("Companion persona: %s. Tone: %s. Default interaction mode: %s. Reflection style: %s."
                    .formatted(
                            persona.displayName(),
                            persona.tone(),
                            persona.defaultMode().name().toLowerCase(java.util.Locale.ROOT),
                            persona.reflectionPromptStyle()));
        }
        CompanionPrefs prefs = relationship.prefs();
        String prefBlock = CompanionPreferenceInstructions.render(
                prefs.companionName(),
                prefs.userAddressAs(),
                prefs.replyLength(),
                prefs.initiative(),
                prefs.humor(),
                prefs.advicePref(),
                prefs.memoryShareScope(),
                prefs.avoidTopics(),
                prefs.gender());
        if (prefBlock != null && !prefBlock.isBlank()) {
            parts.add(prefBlock);
        }
        String override = modeInstruction(mode);
        if (override != null) {
            parts.add(override);
        }
        return parts.isEmpty() ? null : String.join(" ", parts);
    }

    /**
     * CHAT-MODE: fixed approved turn-mode instruction for an explicit
     * LISTEN/DISCUSS/CASUAL request; null for AUTO so the persona default rules.
     */
    private static String modeInstruction(String mode) {
        return switch (mode) {
            case "LISTEN" ->
                    "User-requested interaction mode for this turn: LISTEN."
                            + " Listen first and reflect feelings; do not volunteer advice or solutions.";
            case "DISCUSS" ->
                    "User-requested interaction mode for this turn: DISCUSS."
                            + " The user opened an active exchange: ask questions and analyze together.";
            case "CASUAL" ->
                    "User-requested interaction mode for this turn: CASUAL."
                            + " Keep a light everyday tone; stay present without pushing plans.";
            default -> null;
        };
    }

    /** PERSONA-WIRE: persona-templates catalog id → approved skeleton. */
    private static PersonaSkeleton personaFor(String personaRef) {
        if ("gentle-listener".equals(personaRef)) {
            return PersonaSkeleton.gentleListener();
        }
        return null;
    }

    /** EMBED-RECALL: the generating conversation's latest user message text. */
    private String latestUserContent(long ownerUserId, long conversationId) {
        try {
            List<String> rows = jdbcTemplate.queryForList(
                    "SELECT content FROM vc.message "
                            + "WHERE owner_user_id = ? AND conversation_id = ? AND role = 'user' "
                            + "ORDER BY id DESC LIMIT 1",
                    String.class,
                    ownerUserId, conversationId);
            return rows.isEmpty() ? null : rows.get(0);
        } catch (org.springframework.dao.DataAccessException e) {
            return null;
        }
    }

    /**
     * EMBED-RECALL (V62 / §11.13): structured (recency) recall merged with
     * cosine semantic recall — dedupe by memory id, structured entries keep
     * their order, semantic hits fill the remaining slots. A missing embedding
     * or a failed semantic read degrades to the structured result alone
     * (never blocks generation).
     */
    private List<MemoryRecord> recalledMemories(
            long ownerUserId, long relationshipId, long conversationId, String queryText) {
        List<MemoryRecord> structured = memoryService.recall(
                ownerUserId, relationshipId, conversationId, MAX_RECALL_ENTRIES);
        if (queryText == null || queryText.isBlank()) {
            return structured;
        }
        List<MemoryRecord> merged = new ArrayList<>(structured);
        java.util.Set<Long> seen = new java.util.HashSet<>();
        for (MemoryRecord record : structured) {
            seen.add(record.id());
        }
        try {
            float[] queryVector = embeddingPort.embed(queryText);
            EmbeddingPort.EmbeddingSpace space = embeddingPort.space();
            String literal = com.virtualcompanion.runtime.memory.DeterministicEmbedder
                    .toVectorLiteral(queryVector);
            for (com.virtualcompanion.platform.persistence.MemoryService.SemanticMemoryRecord hit
                    : memoryService.semanticRecall(
                            ownerUserId, relationshipId, space.spaceId(),
                            literal, MAX_RECALL_ENTRIES)) {
                if (seen.add(hit.memoryId()) && merged.size() < MAX_RECALL_ENTRIES) {
                    merged.add(new MemoryRecord(
                            hit.memoryId(), relationshipId, null,
                            hit.summary(), "ACCEPTED", conversationId,
                            null, java.time.Instant.now()));
                }
            }
        } catch (RuntimeException e) {
            // Semantic recall is additive; any failure keeps the structured half.
        }
        return merged;
    }

    /**
     * MEM-LOOP: build the SYSTEM recall block carrying the confirmed memory
     * recalled for this relationship (and conversation, for SESSION scope).
     * Empty recall yields null — no synthetic context. CTX-BUDGET: entries are
     * appended most-recent-first only while the recall share of the input
     * budget (a third) is not exhausted.
     */
    private String recallBlock(long ownerUserId, OwnershipTuple ownership) {
        long relationshipId = Long.parseLong(ownership.relationshipId());
        long conversationId = Long.parseLong(ownership.conversationId());
        List<MemoryRecord> recalled = recalledMemories(
                ownerUserId, relationshipId, conversationId, latestUserContent(ownerUserId, conversationId));
        RelationshipRecord relationship =
                relationshipService.get(ownerUserId, relationshipId).orElse(null);
        if (relationship != null
                && "SESSION".equals(relationship.prefs().memoryShareScope())) {
            recalled = recalled.stream()
                    .filter(memory -> "SESSION".equals(memory.scope()))
                    .toList();
        }
        if (recalled.isEmpty()) {
            return null;
        }
        int recallBudgetTokens = Math.max(1, budget.maxInputTokens() / RECALL_BUDGET_SHARE);
        StringBuilder block = new StringBuilder(RECALL_HEADER);
        int usedTokens = estimateTokens(RECALL_HEADER);
        int added = 0;
        for (MemoryRecord memory : recalled) {
            String line = "\n- " + clampRecall(memory.summary());
            // §11.12: an event whose time has passed (and was never marked
            // completed/cancelled) may only be followed up with a question —
            // the model must never fabricate how the event turned out.
            if (isDueForFollowUp(memory)) {
                line += "（该事件时间已过：只能询问后续进展，不得编造结果）";
            }
            int lineTokens = estimateTokens(line);
            if (usedTokens + lineTokens > recallBudgetTokens && added > 0) {
                break;
            }
            block.append(line);
            usedTokens += lineTokens;
            added++;
        }
        return added == 0 ? null : block.toString();
    }

    /**
     * MEM-EVENT (V68 / §11.12): an event memory is due for follow-up when its
     * {@code eventAt} has passed and its status is still PLANNED or UNKNOWN
     * (null status on a legacy event row behaves as UNKNOWN).
     */
    private static boolean isDueForFollowUp(MemoryRecord memory) {
        if (memory.eventAt() == null || memory.eventAt().isAfter(java.time.Instant.now())) {
            return false;
        }
        String status = memory.eventStatus();
        return status == null || "PLANNED".equals(status) || "UNKNOWN".equals(status);
    }

    /** Prepend the fixed SYSTEM blocks (persona outermost) to the history. */
    private static List<ProtocolMessage> prependBlocks(
            List<ProtocolMessage> messages, String personaBlock, String recallBlock) {
        int extra = (personaBlock == null ? 0 : 1) + (recallBlock == null ? 0 : 1);
        if (extra == 0) {
            return messages;
        }
        List<ProtocolMessage> withBlocks = new ArrayList<>(messages.size() + extra);
        if (personaBlock != null) {
            withBlocks.add(new ProtocolMessage(ProtocolMessage.Role.SYSTEM, personaBlock));
        }
        if (recallBlock != null) {
            withBlocks.add(new ProtocolMessage(ProtocolMessage.Role.SYSTEM, recallBlock));
        }
        withBlocks.addAll(messages);
        return withBlocks;
    }

    /**
     * CTX-BUDGET: deterministic, provider-neutral token estimate. UTF-8 bytes
     * divided by {@link #TOKEN_ESTIMATE_BYTES_PER_TOKEN} (rounded up, minimum
     * one) — conservative for both CJK and ASCII, no external dependency, same
     * input always reproduces the same estimate.
     */
    static int estimateTokens(String text) {
        if (text == null || text.isEmpty()) {
            return 0;
        }
        int bytes = text.getBytes(StandardCharsets.UTF_8).length;
        return Math.max(
                1, (bytes + TOKEN_ESTIMATE_BYTES_PER_TOKEN - 1) / TOKEN_ESTIMATE_BYTES_PER_TOKEN);
    }

    private static String clampRecall(String summary) {
        return summary.length() <= MAX_RECALL_SUMMARY_CHARS
                ? summary
                : summary.substring(0, MAX_RECALL_SUMMARY_CHARS);
    }

    private long readFence() {
        String value = jdbcTemplate.queryForObject(
                "SELECT current_setting('vc.job_fence', true)", String.class);
        return fenceValue(value, 0L);
    }

    /**
     * Parse the explicit claim fence (a coordinator-issued UUID) into the
     * non-negative long the router uses as decision identity/audit. Falls back
     * to {@code fallback} when the fence is missing/unparseable, mirroring the
     * legacy GUC-read behavior.
     */
    private static long fenceValue(String claimFence, long fallback) {
        if (claimFence == null || claimFence.isBlank()) {
            return fallback;
        }
        try {
            // Mask the sign bit so the result is always non-negative (the router
            // only requires fence >= 0 and uses it as decision identity/audit).
            return UUID.fromString(claimFence).getMostSignificantBits() & Long.MAX_VALUE;
        } catch (IllegalArgumentException notAUuid) {
            return fallback;
        }
    }

    private static ProtocolMessage.Role toRole(String role) {
        if (role == null) {
            return ProtocolMessage.Role.USER;
        }
        return switch (role.toLowerCase(java.util.Locale.ROOT)) {
            case "assistant" -> ProtocolMessage.Role.ASSISTANT;
            case "system" -> ProtocolMessage.Role.SYSTEM;
            default -> ProtocolMessage.Role.USER;
        };
    }

    private static String clamp(String content) {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length <= MAX_MESSAGE_BYTES) {
            return content;
        }
        return new String(bytes, 0, MAX_MESSAGE_BYTES, StandardCharsets.UTF_8);
    }

    private static String requireSourceId(String zeroLlmSourceId) {
        Objects.requireNonNull(zeroLlmSourceId, "zeroLlmSourceId must not be null");
        if (zeroLlmSourceId.isBlank()) {
            throw new IllegalArgumentException("zeroLlmSourceId must not be blank");
        }
        return zeroLlmSourceId;
    }
}
