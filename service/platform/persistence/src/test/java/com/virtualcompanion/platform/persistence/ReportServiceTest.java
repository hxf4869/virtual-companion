package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link ReportService} (REPORT-BE / V56): the SD call
 * shapes, reason/note normalization, the empty-create existence hiding and
 * the owner-scoped record mapping.
 */
class ReportServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-19T12:00:00Z");

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ReportService service = new ReportService(jdbc);

    @Test
    void createReturnsTheIdForAnAnchoredReport() {
        when(jdbc.queryForObject(
                eq("SELECT vc.create_report(?, ?, ?, ?)"),
                eq(Long.class),
                eq(1L),
                eq(10L),
                eq("UNSAFE_CONTENT"),
                eq("让我不安")))
                .thenReturn(5L);

        OptionalLong id = service.create(1L, 10L, "UNSAFE_CONTENT", "  让我不安  ");
        assertTrue(id.isPresent());
        assertEquals(5L, id.getAsLong());
    }

    @Test
    void createHidesExistenceForAForeignOrAbsentAnchor() {
        when(jdbc.queryForObject(
                anyString(),
                eq(Long.class),
                eq(1L),
                eq(999L),
                eq("OTHER"),
                eq("x")))
                .thenReturn(0L);

        OptionalLong id = service.create(1L, 999L, "OTHER", "x");
        assertFalse(id.isPresent());
    }

    @Test
    void createRejectsUnapprovedReasonsAndBadNotes() {
        assertThrows(IllegalArgumentException.class,
                () -> service.create(1L, null, "NOT_A_REASON", "x"));
        assertThrows(IllegalArgumentException.class,
                () -> service.create(1L, null, "OTHER", "   "));
        assertThrows(IllegalArgumentException.class,
                () -> service.create(1L, null, "OTHER", "x".repeat(2001)));
        assertThrows(IllegalArgumentException.class,
                () -> service.create(1L, 0L, "OTHER", "x"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void listMapsTheOwnerScopedRowsWithANullableAnchor() {
        when(jdbc.query(
                anyString(),
                any(RowMapper.class),
                eq(1L),
                eq(null),
                eq(20)))
                .thenAnswer(invocation -> {
                    RowMapper<ReportRecord> mapper =
                            (RowMapper<ReportRecord>) invocation.getArgument(1);
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_id")).thenReturn(5L);
                    when(rs.getObject("out_message_id")).thenReturn(null);
                    when(rs.getString("out_reason")).thenReturn("PRIVACY_OR_DATA");
                    when(rs.getString("out_note")).thenReturn("导出不完整");
                    when(rs.getString("out_status")).thenReturn("SUBMITTED");
                    when(rs.getString("out_resolution_note")).thenReturn("");
                    when(rs.getTimestamp("out_created_at"))
                            .thenReturn(Timestamp.from(NOW));
                    when(rs.getTimestamp("out_resolved_at")).thenReturn(null);
                    return List.of(mapper.mapRow(rs, 0));
                });

        List<ReportRecord> rows = service.list(1L, null, 20);
        assertEquals(1, rows.size());
        assertEquals(null, rows.get(0).messageId());
        assertEquals("SUBMITTED", rows.get(0).status());
        assertEquals(Optional.empty(), Optional.ofNullable(rows.get(0).messageId()));
    }
}
