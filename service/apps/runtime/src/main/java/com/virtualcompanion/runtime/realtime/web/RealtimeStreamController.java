package com.virtualcompanion.runtime.realtime.web;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.virtualcompanion.platform.persistence.GenerationRecord;
import com.virtualcompanion.platform.persistence.GenerationRepository;
import com.virtualcompanion.platform.persistence.RealtimeResumeService;
import com.virtualcompanion.platform.persistence.ResumeResult;
import com.virtualcompanion.platform.persistence.RealtimeTicketRepository;
import com.virtualcompanion.platform.persistence.SensitiveRouteAdmission;
import com.virtualcompanion.runtime.web.RuntimeRateLimitException;
import com.virtualcompanion.runtime.realtime.LiveDeltaBroker;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter.SseEventBuilder;

/**
 * Realtime Fetch-SSE resume stream (TASK-0184). Implements the single OpenAPI
 * SSE endpoint backed by the V8 {@code vc.consume_realtime_ticket} and
 * {@code vc.resume_stream} SECURITY DEFINER functions:
 * <ul>
 *   <li>{@code GET /api/v1/realtime/streams/{generationId}} — opens the Alpha
 *       realtime transport (FETCH_SSE) resume stream bound to a single-use
 *       ticket minted by {@code POST /api/v1/realtime/tickets}. The ticket
 *       secret, id, session, origin and epoch arrive as query parameters (the
 *       secret is a short-lived single-use credential, not the long-lived token
 *       forbidden in the realtime query); the cursor {@code afterSeq} is carried
 *       by the SSE-standard {@code Last-Event-ID} header (defaulting to 0).</li>
 * </ul>
 *
 * <p>Authenticated: the principal's account id is the owner id (never from the
 * query) and the owner GUC is bound upstream by the owner-injection filter, so
 * the SECURITY DEFINER calls run in the server-trusted tenant context. Transport
 * is fixed to {@code FETCH_SSE} — the only Alpha realtime transport — and is not
 * accepted from the query.
 *
 * <p>Fail-closed disclosure: a foreign or absent generation, an invalid/expired/
 * replayed ticket or any ticket binding mismatch is surfaced as a single
 * {@code stream.denied} event so existence is never disclosed (realtime-contract
 * {@code deniedEvent}); only a malformed or missing parameter before the stream
 * opens maps to 400 {@code INVALID_REQUEST}. A {@link BadSqlGrammarException}
 * (schema unavailable) is re-thrown so the global advice maps it to 503, mirrors
 * the ticket controller. The five {@code resume_stream} dispositions map to SSE
 * events: RESUMED / TERMINAL_SNAPSHOT emit the ordered durable events (and the
 * committed snapshot for a terminal generation); GAP_EXPIRED emits
 * {@code stream.gap}; RESET_REQUIRED emits {@code stream.reset}.
 *
 * <p>STREAM-LIVE: for a non-terminal generation the RESUMED stream does not
 * complete after the buffered durable events — it subscribes to the
 * process-local {@link LiveDeltaBroker} and forwards {@code chat.delta} chunks
 * as the worker publishes them, until the generation finishes or the tail
 * deadline expires. Missing deltas are never fabricated (INV-RT-001): a
 * reconnect answers from the durable resume path and gap recovery.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class RealtimeStreamController {

    /** The only transport allowed in the Technical Alpha (realtime-contract). */
    static final String TRANSPORT_FETCH_SSE = "FETCH_SSE";

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<List<Map<String, Object>>> EVENT_LIST_TYPE =
            new TypeReference<>() {};
    private static final TypeReference<Map<String, Object>> SNAPSHOT_TYPE =
            new TypeReference<>() {};
    private static final String EVENT_SNAPSHOT = "snapshot";
    private static final String EVENT_GAP = "stream.gap";
    private static final String EVENT_RESET = "stream.reset";
    private static final String EVENT_DENIED = "stream.denied";

    /** STREAM-LIVE: live-tail poll cadence and hard deadline (millis). */
    static final long LIVE_TAIL_POLL_MILLIS = 1000L;
    static final long LIVE_TAIL_TIMEOUT_MILLIS = 120_000L;
    static final int SSE_MAX_CONCURRENT = 3;
    static final int SSE_LEASE_TTL_SECONDS = 130;

    /** Generation statuses that can never emit live deltas again. */
    private static final Set<String> TERMINAL_STATUSES = Set.of(
            "INPUT_BLOCKED", "COMPLETED", "COMPLETED_FALLBACK", "CANCELLED",
            "OUTPUT_BLOCKED", "FAILED_FINAL");

    private final RealtimeTicketRepository ticketRepository;
    private final RealtimeResumeService resumeService;
    private final GenerationRepository generationRepository;
    private final LiveDeltaBroker deltaBroker;
    private ObjectProvider<SensitiveRouteAdmission> sensitiveAdmission;

    /** Overridable in tests: the live-tail hard deadline (millis). */
    long liveTailTimeoutMillis = LIVE_TAIL_TIMEOUT_MILLIS;

    public RealtimeStreamController(
            RealtimeTicketRepository ticketRepository,
            RealtimeResumeService resumeService,
            GenerationRepository generationRepository,
            LiveDeltaBroker deltaBroker) {
        this.ticketRepository = ticketRepository;
        this.resumeService = resumeService;
        this.generationRepository = generationRepository;
        this.deltaBroker = deltaBroker;
        this.sensitiveAdmission = null;
    }

    @org.springframework.beans.factory.annotation.Autowired
    public RealtimeStreamController(
            RealtimeTicketRepository ticketRepository,
            RealtimeResumeService resumeService,
            GenerationRepository generationRepository,
            LiveDeltaBroker deltaBroker,
            ObjectProvider<SensitiveRouteAdmission> sensitiveAdmission) {
        this(ticketRepository, resumeService, generationRepository, deltaBroker);
        this.sensitiveAdmission = sensitiveAdmission;
    }

    @GetMapping(value = "/realtime/streams/{generationId}", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter openStream(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String generationId,
            @RequestParam(name = "ticketId", required = false) String ticketId,
            @RequestParam(name = "secret", required = false) String secret,
            @RequestParam(name = "sessionId", required = false) String sessionId,
            @RequestParam(name = "origin", required = false) String origin,
            @RequestParam(name = "streamEpoch", required = false) String streamEpoch,
            @RequestHeader(name = "Last-Event-ID", required = false) String lastEventId) {
        long genId = parseId(generationId, "generationId");
        requireNonBlank(ticketId, "ticketId");
        long ticketIdValue = parseId(ticketId, "ticketId");
        requireNonBlank(secret, "secret");
        requireNonBlank(sessionId, "sessionId");
        requireNonBlank(origin, "origin");
        requireNonBlank(streamEpoch, "streamEpoch");
        long epoch = parseId(streamEpoch, "streamEpoch");
        long afterSeq = (lastEventId == null || lastEventId.isBlank())
                ? 0L
                : parseNonNegative(lastEventId, "Last-Event-ID");

        // No server-side timeout: the resume is one-shot and completes once the
        // currently buffered durable events are flushed.
        SseEmitter emitter = new SseEmitter(0L);
        SensitiveRouteAdmission limiter =
                sensitiveAdmission == null ? null : sensitiveAdmission.getIfAvailable();
        SensitiveRouteAdmission.Lease acquired = limiter == null
                ? null
                : limiter.acquireLease(
                        ownerUserId, SensitiveRouteAdmission.SSE,
                        SSE_MAX_CONCURRENT, SSE_LEASE_TTL_SECONDS);
        if (acquired != null && !acquired.admitted()) {
            throw new RuntimeRateLimitException(acquired.retryAfterSeconds());
        }
        AtomicBoolean leaseReleased = new AtomicBoolean();
        Runnable releaseLease = () -> {
            if (limiter != null && acquired != null
                    && leaseReleased.compareAndSet(false, true)) {
                limiter.releaseLease(ownerUserId, acquired.leaseId());
            }
        };
        emitter.onCompletion(releaseLease);
        emitter.onTimeout(releaseLease);
        emitter.onError(ignored -> releaseLease.run());

        // Consume the single-use ticket: validates the sha256 secret, the boundTo
        // seven-tuple, single-use and the 45s TTL. Any failure fails closed as a
        // single stream.denied event (no existence disclosure). A schema-unavailable
        // BadSqlGrammarException is re-thrown so the global advice maps 503.
        try {
            ticketRepository.consume(
                    ownerUserId,
                    ticketIdValue,
                    secret,
                    genId,
                    sessionId,
                    origin,
                    TRANSPORT_FETCH_SSE,
                    epoch,
                    afterSeq);
        } catch (BadSqlGrammarException e) {
            releaseLease.run();
            throw e;
        } catch (RuntimeException e) {
            releaseLease.run();
            deny(emitter);
            return emitter;
        }

        ResumeResult result;
        try {
            result = resumeService.resume(ownerUserId, genId, epoch, afterSeq);
        } catch (BadSqlGrammarException e) {
            // Schema unavailable (SQLSTATE 42xxx): let the global advice map 503.
            releaseLease.run();
            throw e;
        } catch (DataAccessException e) {
            // Same translation as the ticket path: the global
            // AuthExceptionHandler would mis-map a DataAccessException to 401,
            // which would make SSE clients think the session died and log out.
            releaseLease.run();
            deny(emitter);
            return emitter;
        }
        try {
            dispatch(emitter, result, ownerUserId, genId, epoch, afterSeq);
        } catch (RuntimeException failure) {
            releaseLease.run();
            throw failure;
        }
        return emitter;
    }

    private void dispatch(
            SseEmitter emitter, ResumeResult result, long ownerUserId, long genId,
            long epoch, long afterSeq) {
        try {
            switch (result.disposition()) {
                case ResumeResult.DISPOSITION_RESUMED -> {
                    long cursor = sendDurableEvents(emitter, result.eventsJson(), afterSeq);
                    // STREAM-LIVE: while the generation is still running the
                    // stream stays open and forwards live deltas; the tail
                    // completes the emitter itself.
                    liveTail(emitter, ownerUserId, genId, epoch, cursor);
                    return;
                }
                case ResumeResult.DISPOSITION_TERMINAL_SNAPSHOT -> {
                    sendSnapshot(emitter, result.snapshotJson());
                    sendDurableEvents(emitter, result.eventsJson(), afterSeq);
                }
                case ResumeResult.DISPOSITION_GAP_EXPIRED -> emitter.send(SseEmitter.event().name(EVENT_GAP));
                case ResumeResult.DISPOSITION_RESET_REQUIRED -> emitter.send(SseEmitter.event().name(EVENT_RESET));
                case ResumeResult.DISPOSITION_NOT_FOUND_OR_FORBIDDEN ->
                        emitter.send(SseEmitter.event().name(EVENT_DENIED));
                default -> emitter.send(SseEmitter.event().name(EVENT_DENIED));
            }
            emitter.complete();
        } catch (IOException e) {
            emitter.completeWithError(e);
        }
    }

    /**
     * STREAM-LIVE: keep the resume stream open while the generation runs and
     * forward the process-local broker's deltas (catalog envelope shape, same
     * {@code id}/{@code data} conventions as durable events). Completes when the
     * broker marks the generation finished, when the generation turns terminal,
     * or after the hard deadline — the client's next resume attempt then
     * delivers the durable terminal event/snapshot. Deltas published before
     * this subscription are lost and surface as the sanctioned gap recovery.
     */
    private void liveTail(
            SseEmitter emitter, long ownerUserId, long genId, long epoch, long cursor) {
        GenerationRecord record = generationRepository.find(ownerUserId, genId).orElse(null);
        if (record == null) {
            emitter.complete();
            return;
        }
        if (TERMINAL_STATUSES.contains(record.status())) {
            completeWithCommittedTerminal(emitter, ownerUserId, genId, epoch, cursor);
            return;
        }
        try (LiveDeltaBroker.Subscriber subscriber = deltaBroker.subscribe(genId)) {
            long deadline = System.currentTimeMillis() + liveTailTimeoutMillis;
            while (System.currentTimeMillis() < deadline) {
                LiveDeltaBroker.LiveEvent event = subscriber.poll(LIVE_TAIL_POLL_MILLIS);
                if (event == null) {
                    continue;
                }
                if (event.isEnd()) {
                    break;
                }
                Map<String, Object> envelope = new LinkedHashMap<>();
                envelope.put("event", event.eventType());
                envelope.put("generationId", Long.toString(genId));
                envelope.put("streamEpoch", event.streamEpoch());
                envelope.put("eventSeq", event.eventSeq());
                envelope.put("payload", event.payload());
                emitter.send(SseEmitter.event()
                        .name(event.eventType())
                        .id(String.valueOf(event.eventSeq()))
                        .data(envelope));
                cursor = Math.max(cursor, event.eventSeq());
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (IOException e) {
            emitter.completeWithError(e);
            return;
        }
        GenerationRecord completed = generationRepository.find(ownerUserId, genId).orElse(null);
        if (completed != null && TERMINAL_STATUSES.contains(completed.status())) {
            completeWithCommittedTerminal(emitter, ownerUserId, genId, epoch, cursor);
        } else {
            emitter.complete();
        }
    }

    private void completeWithCommittedTerminal(
            SseEmitter emitter, long ownerUserId, long genId, long epoch, long cursor) {
        try {
            ResumeResult committed = resumeService.resume(ownerUserId, genId, epoch, cursor);
            if (ResumeResult.DISPOSITION_TERMINAL_SNAPSHOT.equals(committed.disposition())) {
                sendSnapshot(emitter, committed.snapshotJson());
                sendDurableEvents(emitter, committed.eventsJson(), cursor);
            } else if (ResumeResult.DISPOSITION_RESUMED.equals(committed.disposition())) {
                sendDurableEvents(emitter, committed.eventsJson(), cursor);
            }
            emitter.complete();
        } catch (IOException | RuntimeException failure) {
            emitter.completeWithError(failure);
        }
    }

    /** Fail-closed single event: emit stream.denied and complete without reason. */
    private void deny(SseEmitter emitter) {
        try {
            emitter.send(SseEmitter.event().name(EVENT_DENIED));
            emitter.complete();
        } catch (IOException e) {
            emitter.completeWithError(e);
        }
    }

    private static long sendDurableEvents(
            SseEmitter emitter, String eventsJson, long cursor) throws IOException {
        List<Map<String, Object>> events = MAPPER.readValue(eventsJson, EVENT_LIST_TYPE);
        long advanced = cursor;
        if (events == null) {
            return advanced;
        }
        for (Map<String, Object> event : events) {
            Object eventType = event.get("event");
            String eventName = eventType == null ? "event" : String.valueOf(eventType);
            SseEventBuilder builder = SseEmitter.event().name(eventName).data(event);
            Object seq = event.get("eventSeq");
            Long sequence = null;
            if (seq != null) {
                try {
                    sequence = seq instanceof Number number
                            ? number.longValue() : Long.parseLong(String.valueOf(seq));
                } catch (NumberFormatException ignored) {
                    // Preserve a malformed opaque event for fail-safe compatibility.
                }
                if (sequence != null && sequence <= advanced) {
                    continue;
                }
                builder.id(String.valueOf(seq));
            }
            emitter.send(builder);
            if (sequence != null) {
                advanced = Math.max(advanced, sequence);
            }
        }
        return advanced;
    }

    private static void sendSnapshot(SseEmitter emitter, String snapshotJson) throws IOException {
        Map<String, Object> snapshot = MAPPER.readValue(snapshotJson, SNAPSHOT_TYPE);
        if (snapshot != null) {
            emitter.send(SseEmitter.event().name(EVENT_SNAPSHOT).data(snapshot));
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

    private static long parseNonNegative(String raw, String name) {
        try {
            long parsed = Long.parseLong(raw);
            if (parsed < 0) {
                throw new IllegalArgumentException(name + " must be non-negative");
            }
            return parsed;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " is not a valid counter: " + raw, e);
        }
    }

    private static void requireNonBlank(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
    }
}
