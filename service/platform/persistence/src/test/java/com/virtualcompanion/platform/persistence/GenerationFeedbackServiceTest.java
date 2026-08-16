package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Unit tests for {@link GenerationFeedbackService} (FEEDBACK / FR-CHAT-003):
 * eager kind normalization, note length validation, the SD call shape, and the
 * row mapping (including the idempotent repeat that returns the existing row).
 */
class GenerationFeedbackServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-16T10:00:00Z");

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);

    private final GenerationFeedbackService service = new GenerationFeedbackService(jdbc);

    @Test
    void normalizeKindKeepsApprovedCodes() {
        assertEquals("TOO_MECHANICAL", GenerationFeedbackService.normalizeKind("TOO_MECHANICAL"));
        assertEquals("FORGOT_CONTEXT", GenerationFeedbackService.normalizeKind("FORGOT_CONTEXT"));
        assertEquals("CROSSED_BOUNDARY", GenerationFeedbackService.normalizeKind("CROSSED_BOUNDARY"));
        assertEquals("FACTUAL_ERROR", GenerationFeedbackService.normalizeKind("FACTUAL_ERROR"));
        assertEquals("UNSAFE", GenerationFeedbackService.normalizeKind("UNSAFE"));
    }

    @Test
    void normalizeKindRejectsBlankOrUnapproved() {
        assertThrows(IllegalArgumentException.class,
                () -> GenerationFeedbackService.normalizeKind(null));
        assertThrows(IllegalArgumentException.class,
                () -> GenerationFeedbackService.normalizeKind("  "));
        assertThrows(IllegalArgumentException.class,
                () -> GenerationFeedbackService.normalizeKind("TOO_SLOW"));
        assertThrows(IllegalArgumentException.class,
                () -> GenerationFeedbackService.normalizeKind("UNSAFE; DROP TABLE x"));
    }

    @Test
    void recordRejectsNonPositiveIdsAndOverlongNote() {
        assertThrows(IllegalArgumentException.class,
                () -> service.record(0L, 5L, "UNSAFE", null));
        assertThrows(IllegalArgumentException.class,
                () -> service.record(1L, 0L, "UNSAFE", null));
        assertThrows(IllegalArgumentException.class,
                () -> service.record(1L, 5L, "UNSAFE", "x".repeat(501)));
    }

    @Test
    void recordCallsTheSdFunctionAndMapsTheRow() {
        when(jdbc.query(
                eq("SELECT o_generation_id, o_kind, o_note, o_created_at "
                        + "FROM vc.record_generation_feedback(?, ?, ?, ?)"),
                any(org.springframework.jdbc.core.RowMapper.class),
                eq(1L),
                eq(55L),
                eq("FACTUAL_ERROR"),
                eq("那个数字不对")))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("o_generation_id")).thenReturn(55L);
                    when(rs.getString("o_kind")).thenReturn("FACTUAL_ERROR");
                    when(rs.getString("o_note")).thenReturn("那个数字不对");
                    when(rs.getTimestamp("o_created_at")).thenReturn(Timestamp.from(NOW));
                    var mapper = invocation.getArgument(1, org.springframework.jdbc.core.RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        Optional<GenerationFeedbackRecord> recorded = service.record(1L, 55L, "FACTUAL_ERROR", "那个数字不对");

        assertTrue(recorded.isPresent());
        assertEquals(55L, recorded.get().generationId());
        assertEquals("FACTUAL_ERROR", recorded.get().kind());
        assertEquals("那个数字不对", recorded.get().note());
        assertEquals(NOW, recorded.get().createdAt());
    }

    @Test
    void recordMapsEmptyRowsToEmptyForAbsentGeneration() {
        when(jdbc.query(
                any(String.class),
                any(org.springframework.jdbc.core.RowMapper.class),
                eq(1L),
                eq(999L),
                eq("UNSAFE"),
                isNull()))
                .thenReturn(List.of());

        assertTrue(service.record(1L, 999L, "UNSAFE", null).isEmpty());
    }
}
