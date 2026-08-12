package com.virtualcompanion.runtime.realtime.web;

import com.virtualcompanion.platform.persistence.RealtimeTicketRepository;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Realtime resume ticket HTTP API (TASK-0182). Implements the single OpenAPI
 * endpoint backed by the V8 {@code vc.issue_realtime_ticket} SECURITY DEFINER
 * function:
 * <ul>
 *   <li>{@code POST /api/v1/realtime/tickets} — mint a short-lived single-use
 *       Fetch-SSE resume ticket bound to the caller's generation cursor. The
 *       plaintext secret is returned exactly once; only its sha256 is
 *       persisted (realtime-contract {@code serverStoresHashOnly}).</li>
 * </ul>
 *
 * <p>Authenticated: the principal's account id is the owner id (never taken
 * from the body) and the owner GUC is bound upstream by the owner-injection
 * filter, so the SD call runs in the server-trusted tenant context. Transport
 * is fixed to {@code FETCH_SSE} — the only Alpha realtime transport — and is
 * not accepted from the body. {@code issue_realtime_ticket} internally calls
 * {@code ensure_realtime_stream}, which raises (without disclosing existence)
 * when the generation is absent or foreign; that business raise surfaces here
 * as a {@link DataAccessException} that is translated to 404
 * {@code NOT_FOUND_OR_FORBIDDEN}. A {@link BadSqlGrammarException} (schema
 * unavailable) is re-thrown so the global advice maps it to 503.
 *
 * <p>The ticket is consumed later when opening the SSE resume stream; that
 * endpoint is delivered by a separate task.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class RealtimeTicketController {

    /** The only transport allowed in the Technical Alpha (realtime-contract). */
    static final String TRANSPORT_FETCH_SSE = "FETCH_SSE";

    private final RealtimeTicketRepository ticketRepository;

    public RealtimeTicketController(RealtimeTicketRepository ticketRepository) {
        this.ticketRepository = ticketRepository;
    }

    @PostMapping("/realtime/tickets")
    public RealtimeTicketResponse createTicket(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @Valid @RequestBody RealtimeTicketCreateRequest request) {
        long generationId = parseId(request.generationId(), "generationId");
        long streamEpoch = parseId(request.streamEpoch(), "streamEpoch");
        long afterSeq = parseNonNegative(request.afterSeq(), "afterSeq");
        try {
            RealtimeTicketRepository.IssuedTicket ticket = ticketRepository.issue(
                    ownerUserId,
                    generationId,
                    request.sessionId(),
                    request.origin(),
                    TRANSPORT_FETCH_SSE,
                    streamEpoch,
                    afterSeq);
            return new RealtimeTicketResponse(
                    String.valueOf(ticket.ticketId()),
                    ticket.secret());
        } catch (BadSqlGrammarException e) {
            // Schema unavailable (SQLSTATE 42xxx): let the global advice map 503.
            throw e;
        } catch (DataAccessException e) {
            // generation foreign/absent → ensure_realtime_stream raised; do not
            // disclose existence. The global AuthExceptionHandler would otherwise
            // mis-map a DataAccessException to 401, so translate here.
            throw new ResourceNotFoundException("generation");
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

    /** Request body (OpenAPI {@code RealtimeTicketCreateRequest}). */
    public record RealtimeTicketCreateRequest(
            @NotBlank String generationId,
            @NotBlank String sessionId,
            @NotBlank String origin,
            @NotBlank String streamEpoch,
            @NotBlank String afterSeq) {
    }

    /** Response body (OpenAPI {@code RealtimeTicket}). */
    public record RealtimeTicketResponse(String ticketId, String secret) {
    }
}
