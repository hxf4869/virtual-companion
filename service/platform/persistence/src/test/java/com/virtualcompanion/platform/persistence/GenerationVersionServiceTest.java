package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link GenerationVersionService} (GEN-VER / V53): SD call
 * shapes and the version-row mapping.
 */
class GenerationVersionServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-18T12:00:00Z");

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final GenerationVersionService service = new GenerationVersionService(jdbc);

    @Test
    void listMapsVersionRows() {
        when(jdbc.query(any(String.class), any(RowMapper.class), eq(1L), eq(9L)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_generation_id")).thenReturn(55L);
                    when(rs.getBoolean("out_selected")).thenReturn(true);
                    when(rs.getString("out_status")).thenReturn("COMPLETED");
                    when(rs.getTimestamp("out_created_at")).thenReturn(Timestamp.from(NOW));
                    when(rs.getObject("out_assistant_message_id")).thenReturn(88L);
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        List<GenerationVersionService.GenerationVersion> rows = service.list(1L, 9L);

        assertEquals(1, rows.size());
        assertEquals(55L, rows.get(0).generationId());
        assertTrue(rows.get(0).selected());
        assertEquals(88L, rows.get(0).assistantMessageId());
    }

    @Test
    void selectCallsTheSd() {
        when(jdbc.queryForObject(
                eq("SELECT vc.select_generation_version(?, ?)"),
                eq(Boolean.class),
                eq(1L),
                eq(55L)))
                .thenReturn(true);

        assertTrue(service.select(1L, 55L));
    }

    @Test
    void selectMissingReturnsFalse() {
        when(jdbc.queryForObject(
                eq("SELECT vc.select_generation_version(?, ?)"),
                eq(Boolean.class),
                eq(1L),
                eq(99L)))
                .thenReturn(false);

        assertFalse(service.select(1L, 99L));
    }

    @Test
    void rejectsNonPositiveIds() {
        assertThrows(IllegalArgumentException.class, () -> service.list(0L, 1L));
        assertThrows(IllegalArgumentException.class, () -> service.select(1L, 0L));
    }
}
