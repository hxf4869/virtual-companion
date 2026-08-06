package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

/**
 * Pure unit tests for the {@link RealtimeTicketRepository.IssuedTicket} value
 * object and the eager {@code validateIssue}/{@code validateConsume} checks.
 *
 * <p>The single-use, TTL, hash-only and boundTo fail-closed behavior is proven
 * by the SQL test suite under {@code infra/db/tests}; this only pins the
 * in-process invariants.
 */
class RealtimeTicketRepositoryTest {

    @Test
    void issuedTicketKeepsFields() {
        RealtimeTicketRepository.IssuedTicket ticket =
                new RealtimeTicketRepository.IssuedTicket(42L, "secret-uuid");
        assertEquals(42L, ticket.ticketId());
        assertEquals("secret-uuid", ticket.secret());
    }

    @Test
    void issuedTicketRejectsInvalidValues() {
        assertThrows(IllegalArgumentException.class,
                () -> new RealtimeTicketRepository.IssuedTicket(0L, "s"));
        assertThrows(IllegalArgumentException.class,
                () -> new RealtimeTicketRepository.IssuedTicket(42L, "  "));
    }

    @Test
    void validateIssueAcceptsValidArguments() {
        assertDoesNotThrow(() -> RealtimeTicketRepository.validateIssue(
                7L, 901L, "sess-1", "https://app.example",
                RealtimeTicketRepository.TRANSPORT_FETCH_SSE, 1L, 0L));
    }

    @Test
    void validateIssueRejectsNonPositiveKeys() {
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateIssue(
                        0L, 901L, "s", "o", "FETCH_SSE", 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateIssue(
                        7L, 0L, "s", "o", "FETCH_SSE", 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateIssue(
                        7L, 901L, "s", "o", "FETCH_SSE", 0L, 0L));
    }

    @Test
    void validateIssueRejectsBlankOrWrongTransportAndTuple() {
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateIssue(
                        7L, 901L, "  ", "o", "FETCH_SSE", 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateIssue(
                        7L, 901L, "s", "  ", "FETCH_SSE", 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateIssue(
                        7L, 901L, "s", "o", "WEBSOCKET", 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateIssue(
                        7L, 901L, "s", "o", "FETCH_SSE", 1L, -1L));
    }

    @Test
    void validateConsumeAcceptsAndRejects() {
        assertDoesNotThrow(() -> RealtimeTicketRepository.validateConsume(
                7L, 42L, "secret", 901L, "sess-1", "https://app.example", "FETCH_SSE", 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateConsume(0L, 42L, "secret", 901L, "s", "o", "FETCH_SSE", 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateConsume(7L, 0L, "secret", 901L, "s", "o", "FETCH_SSE", 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateConsume(7L, 42L, "  ", 901L, "s", "o", "FETCH_SSE", 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateConsume(7L, 42L, "secret", 0L, "s", "o", "FETCH_SSE", 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateConsume(7L, 42L, "secret", 901L, "  ", "o", "FETCH_SSE", 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateConsume(7L, 42L, "secret", 901L, "s", "  ", "FETCH_SSE", 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateConsume(7L, 42L, "secret", 901L, "s", "o", "WEBSOCKET", 1L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateConsume(7L, 42L, "secret", 901L, "s", "o", "FETCH_SSE", 0L, 0L));
        assertThrows(IllegalArgumentException.class,
                () -> RealtimeTicketRepository.validateConsume(7L, 42L, "secret", 901L, "s", "o", "FETCH_SSE", 1L, -1L));
    }
}
