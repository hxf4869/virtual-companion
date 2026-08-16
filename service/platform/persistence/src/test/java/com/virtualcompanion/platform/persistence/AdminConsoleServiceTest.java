package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link AdminConsoleService} (ADMIN-OPS / V36): the SD call
 * shapes, the row mappings, and the usage-window clamp.
 */
class AdminConsoleServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-16T10:00:00Z");

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);

    private final AdminConsoleService service = new AdminConsoleService(jdbc);

    @Test
    void rejectsNonPositiveActingAccount() {
        assertThrows(IllegalArgumentException.class,
                () -> service.listAuditEvents(0L, null, 50));
        assertThrows(IllegalArgumentException.class,
                () -> service.usageSummary(0L, 14));
    }

    @Test
    void listAuditEventsCallsTheSdFunctionAndMapsRows() {
        when(jdbc.query(
                eq("SELECT out_id, out_event_type, out_account_id, out_username, out_occurred_at "
                        + "FROM vc.identity_auth_event_list(?, ?, ?)"),
                any(RowMapper.class),
                eq(1L),
                eq(500L),
                eq(50)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_id")).thenReturn(500L);
                    when(rs.getString("out_event_type")).thenReturn("ACCOUNT_DISABLE");
                    when(rs.getObject("out_account_id")).thenReturn(7L);
                    when(rs.getString("out_username")).thenReturn("alice");
                    when(rs.getTimestamp("out_occurred_at")).thenReturn(Timestamp.from(NOW));
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        List<AuditEventRecord> events = service.listAuditEvents(1L, 500L, 50);

        assertEquals(1, events.size());
        AuditEventRecord event = events.get(0);
        assertEquals(500L, event.id());
        assertEquals("ACCOUNT_DISABLE", event.eventType());
        assertEquals(7L, event.accountId());
        assertEquals("alice", event.username());
        assertEquals(NOW, event.occurredAt());
    }

    @Test
    void usageSummaryClampsTheWindowAndMapsRows() {
        when(jdbc.query(
                eq("SELECT out_day, out_generations, out_input_tokens, out_output_tokens, out_cost "
                        + "FROM vc.admin_usage_summary(?, ?)"),
                any(RowMapper.class),
                eq(1L),
                any(Timestamp.class)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getDate("out_day")).thenReturn(java.sql.Date.valueOf("2026-08-16"));
                    when(rs.getLong("out_generations")).thenReturn(3L);
                    when(rs.getLong("out_input_tokens")).thenReturn(1200L);
                    when(rs.getLong("out_output_tokens")).thenReturn(800L);
                    when(rs.getBigDecimal("out_cost")).thenReturn(new BigDecimal("0.012"));
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        List<UsageSummaryRecord> rows = service.usageSummary(1L, 999);

        assertEquals(1, rows.size());
        UsageSummaryRecord row = rows.get(0);
        assertEquals(LocalDate.parse("2026-08-16"), row.day());
        assertEquals(3L, row.generations());
        assertEquals(1200L, row.inputTokens());
        assertEquals(800L, row.outputTokens());
        assertEquals(new BigDecimal("0.012"), row.cost());
    }
}
