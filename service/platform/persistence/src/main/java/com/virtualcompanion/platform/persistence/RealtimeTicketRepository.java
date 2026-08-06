package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Short-lived single-use resume ticket persistence bound to the
 * {@code vc.issue_realtime_ticket} / {@code vc.consume_realtime_ticket}
 * SECURITY DEFINER functions.
 *
 * <p>The server stores only {@code sha256(secret)}; {@link #issue} returns the
 * plaintext secret exactly once and {@link #consume} recomputes the hash
 * server-side, validates the contract seven-tuple (owner, generation, session,
 * origin, transport, streamEpoch, afterSeq), enforces single-use and the 45s
 * TTL, and fails closed on any mismatch. No long-lived credential is persisted.
 *
 * <p>Argument validation is eager and side-effect free so it is unit-testable
 * without a database; the single-use/TTL/hash-only runtime behavior is proven by
 * the SQL test suite under {@code infra/db/tests}.
 */
public class RealtimeTicketRepository {

    /** The only transport allowed in the Technical Alpha (realtime-contract). */
    public static final String TRANSPORT_FETCH_SSE = "FETCH_SSE";

    private final JdbcTemplate jdbc;

    public RealtimeTicketRepository(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /**
     * Mint a single-use ticket bound to the seven-tuple. The plaintext secret is
     * returned once; only its sha256 is persisted.
     */
    public IssuedTicket issue(
            long ownerUserId,
            long generationId,
            String sessionId,
            String origin,
            String transport,
            long streamEpoch,
            long afterSeq) {
        validateIssue(ownerUserId, generationId, sessionId, origin, transport, streamEpoch, afterSeq);
        return jdbc.queryForObject(
                "SELECT out_ticket_id, out_secret "
                        + "FROM vc.issue_realtime_ticket(?, ?, ?, ?, ?, ?, ?)",
                (rs, rowNum) -> new IssuedTicket(
                        rs.getLong("out_ticket_id"),
                        rs.getString("out_secret")),
                ownerUserId,
                generationId,
                sessionId,
                origin,
                transport,
                streamEpoch,
                afterSeq);
    }

    /**
     * Validate the secret, the seven-tuple, single-use and TTL. Returns
     * {@code true} when the ticket is consumed; throws otherwise (fail closed).
     */
    public boolean consume(
            long ownerUserId,
            long ticketId,
            String secret,
            long generationId,
            String sessionId,
            String origin,
            String transport,
            long streamEpoch,
            long afterSeq) {
        validateConsume(ownerUserId, ticketId, secret, generationId, sessionId, origin, transport, streamEpoch, afterSeq);
        Boolean consumed = jdbc.queryForObject(
                "SELECT vc.consume_realtime_ticket(?, ?, ?, ?, ?, ?, ?, ?, ?)",
                Boolean.class,
                ownerUserId,
                ticketId,
                secret,
                generationId,
                sessionId,
                origin,
                transport,
                streamEpoch,
                afterSeq);
        if (consumed == null) {
            throw new IllegalStateException("consume_realtime_ticket returned no value");
        }
        return consumed;
    }

    static void validateIssue(
            long ownerUserId,
            long generationId,
            String sessionId,
            String origin,
            String transport,
            long streamEpoch,
            long afterSeq) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalArgumentException("sessionId must not be blank");
        }
        if (origin == null || origin.isBlank()) {
            throw new IllegalArgumentException("origin must not be blank");
        }
        if (!TRANSPORT_FETCH_SSE.equals(transport)) {
            throw new IllegalArgumentException("transport must be FETCH_SSE");
        }
        if (streamEpoch <= 0) {
            throw new IllegalArgumentException("streamEpoch must be positive");
        }
        if (afterSeq < 0) {
            throw new IllegalArgumentException("afterSeq must be non-negative");
        }
    }

    static void validateConsume(
            long ownerUserId,
            long ticketId,
            String secret,
            long generationId,
            String sessionId,
            String origin,
            String transport,
            long streamEpoch,
            long afterSeq) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (ticketId <= 0) {
            throw new IllegalArgumentException("ticketId must be positive");
        }
        if (secret == null || secret.isBlank()) {
            throw new IllegalArgumentException("secret must not be blank");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalArgumentException("sessionId must not be blank");
        }
        if (origin == null || origin.isBlank()) {
            throw new IllegalArgumentException("origin must not be blank");
        }
        if (!TRANSPORT_FETCH_SSE.equals(transport)) {
            throw new IllegalArgumentException("transport must be FETCH_SSE");
        }
        if (streamEpoch <= 0) {
            throw new IllegalArgumentException("streamEpoch must be positive");
        }
        if (afterSeq < 0) {
            throw new IllegalArgumentException("afterSeq must be non-negative");
        }
    }

    /** A freshly minted ticket: its id and the one-time plaintext secret. */
    public record IssuedTicket(long ticketId, String secret) {
        public IssuedTicket {
            if (ticketId <= 0) {
                throw new IllegalArgumentException("ticketId must be positive");
            }
            Objects.requireNonNull(secret, "secret must not be null");
            if (secret.isBlank()) {
                throw new IllegalArgumentException("secret must not be blank");
            }
        }
    }
}
