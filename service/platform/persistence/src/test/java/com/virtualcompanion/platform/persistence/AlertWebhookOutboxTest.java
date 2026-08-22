package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class AlertWebhookOutboxTest {

    @Test
    void enqueuePinsSqlAndMapsInserted() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), eq("P2"), eq("DAU_CAP_REACHED"), eq("m"), eq(60)))
                .thenReturn(List.of(new AlertWebhookOutbox.EnqueueResult(9L, true)));
        AlertWebhookOutbox outbox = new AlertWebhookOutbox(jdbc);

        AlertWebhookOutbox.EnqueueResult result =
                outbox.enqueue("P2", "DAU_CAP_REACHED", "m", 60);

        assertEquals(9L, result.id());
        assertTrue(result.inserted());
        verify(jdbc).query(
                eq(AlertWebhookOutbox.ENQUEUE_SQL),
                any(RowMapper.class),
                eq("P2"), eq("DAU_CAP_REACHED"), eq("m"), eq(60));
    }

    @Test
    void claimMapsRow() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        Instant occurred = Instant.parse("2026-08-23T00:00:00Z");
        when(jdbc.query(anyString(), any(RowMapper.class), eq(16)))
                .thenReturn(List.of(new AlertWebhookOutbox.Claimed(
                        3L, "P1", "BUDGET_HALT_REACHED", "halt", occurred, 1)));
        AlertWebhookOutbox outbox = new AlertWebhookOutbox(jdbc);

        List<AlertWebhookOutbox.Claimed> claimed = outbox.claim(16);
        assertEquals(1, claimed.size());
        assertEquals(3L, claimed.getFirst().id());
        assertEquals("BUDGET_HALT_REACHED", claimed.getFirst().code());
        verify(jdbc).query(eq(AlertWebhookOutbox.CLAIM_SQL), any(RowMapper.class), eq(16));
    }

    @Test
    void completePinsFunction() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(
                eq(AlertWebhookOutbox.COMPLETE_SQL),
                eq(Boolean.class),
                eq(3L), eq("DELIVERED"), eq(""), eq(5), eq(5)))
                .thenReturn(true);
        AlertWebhookOutbox outbox = new AlertWebhookOutbox(jdbc);
        assertTrue(outbox.complete(3L, "DELIVERED", "", 5, 5));
        when(jdbc.queryForObject(
                eq(AlertWebhookOutbox.COMPLETE_SQL),
                eq(Boolean.class),
                eq(4L), eq("RETRY"), eq("retryable"), eq(5), eq(5)))
                .thenReturn(false);
        assertFalse(outbox.complete(4L, "RETRY", "retryable", 5, 5));
    }
}
