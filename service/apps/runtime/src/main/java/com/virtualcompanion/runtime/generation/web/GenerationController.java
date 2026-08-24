package com.virtualcompanion.runtime.generation.web;

import com.virtualcompanion.platform.persistence.GenerationCancelService;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationReceiveService;
import com.virtualcompanion.platform.persistence.GenerationReceiveService.ReceivedGeneration;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.GenerationRecord;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.SafetyEventService;
import com.virtualcompanion.platform.persistence.ServiceWindowService;
import com.virtualcompanion.platform.persistence.WorkItemEnqueueService;
import com.virtualcompanion.runtime.admission.GenerationAdmission;
import com.virtualcompanion.runtime.servicemode.BetaServiceWindow;
import com.virtualcompanion.runtime.servicemode.ServiceWindowClosedException;
import com.virtualcompanion.safety.ExitIntentDetector;
import com.virtualcompanion.safety.SafetyClassification;
import com.virtualcompanion.safety.SafetyClassifierPort;
import com.virtualcompanion.safety.SafetyStage;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Generation HTTP vertical slice (TASK-0174).
 *
 * <ul>
 *   <li>{@code POST /api/v1/conversations/{conversationId}/generations} —
 *       idempotent intake ({@code vc.receive_generation}) followed by enqueuing
 *       a {@code GENERATION} work item on first creation. The coordinator polls
 *       the work item and the {@code GenerationWorkItemHandler} runs the model
 *       and finalizes.</li>
 *   <li>{@code GET /api/v1/generations/{generationId}/snapshot} — owner-scoped
 *       status + realtime events for client polling.</li>
 * </ul>
 *
 * <p>SAFETY-WIRE (V58, FR-CHAT-001 step 4 输入安全检查): a fresh send is
 * classified at intake. A deterministic hard-rule hit keeps the user message
 * persisted (data rights) but walks the generation CREATED → INPUT_REVIEW →
 * INPUT_BLOCKED with a durable {@code chat.blocked} event and a minimal
 * safety-event row — no work item is scheduled and no model is invoked. A
 * regenerate reuses the original message, which was already classified on its
 * first send, so only fresh content is re-checked here.
 *
 * <p>Authenticated: the principal's account id is the owner id and the owner
 * GUC is bound upstream by the owner-injection filter. Enqueue happens only on
 * first creation ({@code created=true}); duplicate idempotency keys resolve to
 * the same logical generation without re-enqueuing.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class GenerationController {

    private static final String WORK_ITEM_KIND = "GENERATION";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<List<Map<String, Object>>> SNAPSHOT_EVENTS_TYPE =
            new TypeReference<>() {};

    private final GenerationReceiveService receiveService;
    private final WorkItemEnqueueService enqueueService;
    private final GenerationRepository generationRepository;
    private final GenerationStateService generationStateService;
    private final GenerationFinalizeService finalizeService;
    private final SafetyClassifierPort safetyClassifier;
    private final SafetyEventService safetyEventService;
    private final GenerationCancelService cancelService;
    private final BetaServiceWindow serviceWindow;
    private final ServiceWindowService serviceWindowService;
    private final GenerationAdmission admission;
    private final com.virtualcompanion.runtime.observability.VcMetrics metrics;
    private final com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier;

    public GenerationController(
            GenerationReceiveService receiveService,
            WorkItemEnqueueService enqueueService,
            GenerationRepository generationRepository,
            GenerationStateService generationStateService,
            GenerationFinalizeService finalizeService,
            SafetyClassifierPort safetyClassifier,
            SafetyEventService safetyEventService,
            GenerationCancelService cancelService,
            BetaServiceWindow serviceWindow,
            ServiceWindowService serviceWindowService,
            GenerationAdmission admission,
            com.virtualcompanion.runtime.observability.VcMetrics metrics,
            com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier) {
        this.receiveService = receiveService;
        this.enqueueService = enqueueService;
        this.generationRepository = generationRepository;
        this.generationStateService = generationStateService;
        this.finalizeService = finalizeService;
        this.safetyClassifier = safetyClassifier;
        this.safetyEventService = safetyEventService;
        this.cancelService = cancelService;
        this.serviceWindow = serviceWindow;
        this.serviceWindowService = serviceWindowService;
        this.admission = admission;
        this.metrics = metrics;
        this.alertNotifier = alertNotifier;
    }

    @PostMapping("/conversations/{conversationId}/generations")
    public GenerationResponse sendGeneration(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String conversationId,
            @Valid @RequestBody SendGenerationRequest request) {
        long conversation = parseId(conversationId, "conversationId");

        // S0-04: server admission (account, Beta switch, adult, consents,
        // service window/DAU) is the security source. Frontend next-step
        // copy cannot create a generation. Read failures fail closed.
        admission.assertAdmitted(ownerUserId);
        assertServiceWindowOpen(ownerUserId);

        // CHAT-MODE: eager validation rejects unapproved modes with a 400
        // (fail closed toward the persona default; the SD function falls back
        // to AUTO only for direct callers).
        String mode = GenerationReceiveService.normalizeMode(request.mode());

        ReceivedGeneration received;
        if (request.sourceUserMessageId() != null && !request.sourceUserMessageId().isBlank()) {
            long source = parseId(request.sourceUserMessageId(), "sourceUserMessageId");
            received = receiveService.receive(
                    ownerUserId,
                    conversation,
                    request.idempotencyKey(),
                    GenerationReceiveService.DEFAULT_USER_ROLE,
                    request.userContent() == null ? "" : request.userContent(),
                    mode,
                    source);
        } else {
            received = receiveService.receive(
                    ownerUserId,
                    conversation,
                    request.idempotencyKey(),
                    GenerationReceiveService.DEFAULT_USER_ROLE,
                    request.userContent(),
                    mode);
        }

        // Enqueue only on first creation; a duplicate reception resolves to the
        // same logical generation and must not produce a second work item.
        // SAFETY-WIRE: on first creation a fresh message is classified at
        // intake — a hard-rule hit blocks the turn instead of scheduling it.
        // NL-EXIT: an exit-intent message cancels the turn (no generation, no
        // retention wording; the durable chat.cancelled event is the audit).
        if (received.created() && isInputBlocked(ownerUserId, request, received.generationId())) {
            // fall through: the response carries the INPUT_BLOCKED terminal state
        } else if (received.created() && isExitRequested(ownerUserId, request, received.generationId())) {
            // fall through: the response carries the CANCELLED terminal state
        } else if (received.created()) {
            enqueueService.enqueue(ownerUserId, WORK_ITEM_KIND, received.generationId());
        }

        GenerationRecord record = generationRepository
                .find(ownerUserId, received.generationId())
                .orElseThrow(() -> new IllegalStateException(
                        "generation " + received.generationId() + " not found after receive"));
        return new GenerationResponse(
                record.id(),
                record.conversationId(),
                record.logicalGenerationId(),
                record.status(),
                record.mode());
    }

    /**
     * SVC-WINDOW: refuse the turn when the window is closed. An owner already
     * active today never consumes an extra DAU slot, so an in-flight
     * conversation is not split by the cap.
     */
    private void assertServiceWindowOpen(long ownerUserId) {
        if (!serviceWindow.enabled()) {
            return;
        }
        Instant now = Instant.now();
        ServiceWindowService.WindowState state =
                serviceWindowService.state(ownerUserId, serviceWindow.dayStart(now));
        serviceWindow.rejectReason(now, state.dailyActiveUsers(), state.ownerActiveToday())
                .ifPresent(reason -> {
                    if ("daily-active-limit".equals(reason)) {
                        // METRICS-ALERT (§26.6): the DAU cap refusing a new
                        // active user is the configured P2 signal; the
                        // notifier throttles repeat hits per code.
                        alertNotifier.alert(
                                com.virtualcompanion.runtime.observability.AlertSeverity.P2,
                                "DAU_CAP_REACHED",
                                "daily active users reached the beta cap; new actives refused");
                    }
                    throw new ServiceWindowClosedException(reason);
                });
    }

    /**
     * SAFETY-WIRE input check for a fresh send. A regenerate reuses the
     * original message (already classified on its first send) and is skipped.
     * Returns true when the turn was blocked; the walk is the catalog path
     * CREATED → INPUT_REVIEW → INPUT_BLOCKED with a durable chat.blocked event
     * and one minimal safety-event row.
     */
    private boolean isInputBlocked(
            long ownerUserId, SendGenerationRequest request, long generationId) {
        boolean regenerate =
                request.sourceUserMessageId() != null && !request.sourceUserMessageId().isBlank();
        String content = request.userContent() == null ? "" : request.userContent().trim();
        if (regenerate || content.isEmpty()) {
            return false;
        }
        SafetyClassification classification =
                safetyClassifier.classify(SafetyStage.INPUT, content);
        if (classification.allowed()) {
            return false;
        }
        // A non-adequate classifier report can BLOCK with zero hard-rule
        // hits (fail-closed); use a fixed internal rule id in that case
        // instead of throwing on the empty violations list.
        String ruleId = classification.hardRuleViolations().isEmpty()
                ? "INTERNAL_BLOCK"
                : classification.hardRuleViolations().get(0);
        metrics.generationTerminal("blocked_input");
        metrics.safetyEvent(SafetyEventService.STAGE_INPUT, classification.riskLevel().code());
        generationStateService.promote(
                ownerUserId, generationId, GenerationStateService.INPUT_REVIEW);
        finalizeService.terminalizeAsInputBlocked(ownerUserId, generationId, ruleId);
        safetyEventService.record(
                ownerUserId,
                generationId,
                SafetyEventService.STAGE_INPUT,
                classification.riskLevel().code(),
                ruleId);
        return true;
    }

    /**
     * NL-EXIT (§21.3.4): a fresh exit-intent message stops the turn before
     * any model work — the generation cancels through the existing catalog
     * double-hop (CREATED → CANCEL_REQUESTED → CANCELLED) with the durable
     * chat.cancelled event as the auditable exit record. No confirmation
     * reply is generated and nothing retains the user. Safety input blocks
     * take precedence (checked first); a regenerate reuses the original
     * message and is not re-detected.
     */
    private boolean isExitRequested(
            long ownerUserId, SendGenerationRequest request, long generationId) {
        boolean regenerate =
                request.sourceUserMessageId() != null && !request.sourceUserMessageId().isBlank();
        String content = request.userContent() == null ? "" : request.userContent().trim();
        if (regenerate || content.isEmpty() || !ExitIntentDetector.isExitIntent(content)) {
            return false;
        }
        cancelService.cancel(ownerUserId, generationId);
        return true;
    }

    @GetMapping("/generations/{generationId}/snapshot")
    public GenerationSnapshotResponse snapshot(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String generationId) {
        long generation = parseId(generationId, "generationId");
        GenerationStateService.GenerationSnapshot snapshot =
                generationStateService.readSnapshot(ownerUserId, generation);
        GenerationSnapshotResponse.UsageResponse usage =
                snapshot.inputTokens() == null || snapshot.outputTokens() == null
                        ? null
                        : new GenerationSnapshotResponse.UsageResponse(
                                snapshot.inputTokens(), snapshot.outputTokens());
        return new GenerationSnapshotResponse(
                snapshot.status(),
                snapshot.assistantMessageId(),
                parseSnapshotEvents(snapshot.eventsJson()),
                usage);
    }

    private static List<Map<String, Object>> parseSnapshotEvents(String eventsJson) {
        try {
            return MAPPER.readValue(eventsJson, SNAPSHOT_EVENTS_TYPE);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("generation snapshot events are malformed", e);
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

    /** Intake request body (OpenAPI {@code SendGenerationRequest}). */
    public record SendGenerationRequest(
            @NotBlank @Size(max = 128) String idempotencyKey,
            @Size(max = 4096) String userContent,
            String mode,
            String sourceUserMessageId) {
    }

    /** Generation response (OpenAPI {@code Generation}). */
    public record GenerationResponse(
            long generationId,
            long conversationId,
            String logicalGenerationId,
            String status,
            String mode) {
    }

    /**
     * Snapshot response (OpenAPI {@code GenerationSnapshot}). USAGE-VIZ:
     * {@code usage} is absent until finalize settles the provider usage.
     */
    public record GenerationSnapshotResponse(
            String status,
            Long assistantMessageId,
            List<Map<String, Object>> events,
            @JsonInclude(JsonInclude.Include.NON_NULL) UsageResponse usage) {

        /** Settled provider usage (OpenAPI {@code GenerationUsage}). */
        public record UsageResponse(long inputTokens, long outputTokens) {
        }
    }
}
