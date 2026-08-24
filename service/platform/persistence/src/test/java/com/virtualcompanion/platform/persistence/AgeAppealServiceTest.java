package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
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
 * Unit tests for {@link AgeAppealService} (AGE-APPEAL / V56): the SD call
 * shapes, reason normalization and the owner-scoped record mapping.
 */
class AgeAppealServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-19T12:00:00Z");

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AgeAppealService service = new AgeAppealService(jdbc);

    @Test
    void submitTrimsTheReasonAndReturnsTheId() {
        when(jdbc.queryForObject(
                eq("SELECT vc.submit_age_appeal(?, ?)"),
                eq(Long.class),
                eq(1L),
                eq("核验结果有误")))
                .thenReturn(7L);

        assertEquals(7L, service.submit(1L, "  核验结果有误  "));
    }

    @Test
    void submitRejectsBlankOrOverlongReasons() {
        assertThrows(IllegalArgumentException.class, () -> service.submit(1L, "   "));
        assertThrows(IllegalArgumentException.class, () -> service.submit(1L, null));
        assertThrows(IllegalArgumentException.class,
                () -> service.submit(1L, "x".repeat(501)));
        assertThrows(IllegalArgumentException.class, () -> service.submit(0L, "ok"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void resolvesThroughTheRestrictedFunctionAndMapsResult() {
        when(jdbc.query(
                eq(AgeAppealService.RESOLVE_SQL),
                any(RowMapper.class),
                eq(41L),
                eq(7L),
                eq("REVERIFY"),
                eq("重新核验")))
                .thenAnswer(invocation -> {
                    RowMapper<AgeAppealService.Resolution> mapper =
                            (RowMapper<AgeAppealService.Resolution>) invocation.getArgument(1);
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_appeal_id")).thenReturn(7L);
                    when(rs.getString("out_decision")).thenReturn("REVERIFY");
                    when(rs.getString("out_age_state")).thenReturn("AGE_REVERIFY_REQUIRED");
                    when(rs.getTimestamp("out_resolved_at")).thenReturn(Timestamp.from(NOW));
                    return List.of(mapper.mapRow(rs, 0));
                });

        AgeAppealService.Resolution result =
                service.resolve(41L, 7L, "REVERIFY", " 重新核验 ");
        assertEquals(7L, result.appealId());
        assertEquals("REVERIFY", result.decision());
        assertEquals("AGE_REVERIFY_REQUIRED", result.ageState());
        assertEquals(NOW, result.resolvedAt());
    }

    @Test
    void resolveRejectsUnsupportedOrMissingHumanDecision() {
        assertThrows(IllegalArgumentException.class,
                () -> service.resolve(41L, 7L, "UNKNOWN", "note"));
        assertThrows(IllegalArgumentException.class,
                () -> service.resolve(41L, 7L, "SUSPEND", " "));
        assertThrows(IllegalArgumentException.class,
                () -> service.resolve(0L, 7L, "SUSPEND", "note"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void listMapsTheOwnerScopedRows() {
        when(jdbc.query(
                anyString(),
                any(RowMapper.class),
                eq(1L),
                eq(null),
                eq(20)))
                .thenAnswer(invocation -> {
                    RowMapper<AgeAppealRecord> mapper =
                            (RowMapper<AgeAppealRecord>) invocation.getArgument(1);
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_id")).thenReturn(7L);
                    when(rs.getString("out_reason")).thenReturn("判错了");
                    when(rs.getString("out_status")).thenReturn("SUBMITTED");
                    when(rs.getString("out_resolution_note")).thenReturn("");
                    when(rs.getTimestamp("out_created_at"))
                            .thenReturn(Timestamp.from(NOW));
                    when(rs.getTimestamp("out_resolved_at")).thenReturn(null);
                    return List.of(mapper.mapRow(rs, 0));
                });

        List<AgeAppealRecord> rows = service.list(1L, null, 20);
        assertEquals(1, rows.size());
        assertEquals(7L, rows.get(0).id());
        assertEquals("SUBMITTED", rows.get(0).status());
        assertEquals("", rows.get(0).resolutionNote());
        assertEquals(null, rows.get(0).resolvedAt());
    }
}
