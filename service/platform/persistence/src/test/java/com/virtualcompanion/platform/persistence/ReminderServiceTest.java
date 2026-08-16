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
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link ReminderService} (REMINDER / FR-NOTIFY-001): eager
 * recurrence/status/text validation, the SD call shapes, and the row mapping.
 */
class ReminderServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-16T12:00:00Z");

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ReminderService service = new ReminderService(jdbc);

    @Test
    void normalizeRecurrenceDefaultsBlankToNoneAndKeepsApproved() {
        assertEquals("NONE", ReminderService.normalizeRecurrence(null));
        assertEquals("NONE", ReminderService.normalizeRecurrence("  "));
        assertEquals("DAILY", ReminderService.normalizeRecurrence("DAILY"));
        assertEquals("WEEKLY", ReminderService.normalizeRecurrence("WEEKLY"));
        assertThrows(IllegalArgumentException.class,
                () -> ReminderService.normalizeRecurrence("MONTHLY"));
    }

    @Test
    void normalizeStatusKeepsApprovedAndRejectsOthers() {
        assertEquals("ACTIVE", ReminderService.normalizeStatus("ACTIVE"));
        assertEquals("DISMISSED", ReminderService.normalizeStatus("DISMISSED"));
        assertThrows(IllegalArgumentException.class,
                () -> ReminderService.normalizeStatus(null));
        assertThrows(IllegalArgumentException.class,
                () -> ReminderService.normalizeStatus("DONE"));
    }

    @Test
    void validateTextAndInstantRejectsBadInput() {
        assertThrows(IllegalArgumentException.class,
                () -> ReminderService.validateTextAndInstant("  ", NOW));
        assertThrows(IllegalArgumentException.class,
                () -> ReminderService.validateTextAndInstant("x".repeat(501), NOW));
        assertThrows(NullPointerException.class,
                () -> ReminderService.validateTextAndInstant("ok", null));
    }

    @Test
    void createCallsTheSdFunctionAndReturnsTheId() {
        when(jdbc.queryForObject(
                eq("SELECT vc.create_reminder(?, ?, ?, ?, ?)"),
                eq(Long.class),
                eq(1L),
                eq(10L),
                eq("明天晚上问我面试怎么样"),
                any(Timestamp.class),
                eq("NONE")))
                .thenReturn(55L);

        long id = service.create(1L, 10L, " 明天晚上问我面试怎么样 ", NOW, null);

        assertEquals(55L, id);
    }

    @Test
    void getMapsTheOwnedRow() {
        when(jdbc.query(
                any(String.class),
                any(RowMapper.class),
                eq(1L),
                eq(55L)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_id")).thenReturn(55L);
                    when(rs.getLong("out_relationship_id")).thenReturn(10L);
                    when(rs.getString("out_text")).thenReturn("晚上十点提醒我准备休息");
                    when(rs.getTimestamp("out_remind_at")).thenReturn(Timestamp.from(NOW));
                    when(rs.getString("out_recurrence")).thenReturn("WEEKLY");
                    when(rs.getString("out_status")).thenReturn("ACTIVE");
                    when(rs.getTimestamp("out_created_at")).thenReturn(Timestamp.from(NOW));
                    when(rs.getTimestamp("out_updated_at")).thenReturn(Timestamp.from(NOW));
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        Optional<ReminderRecord> record = service.get(1L, 55L);

        assertTrue(record.isPresent());
        assertEquals(55L, record.get().id());
        assertEquals("WEEKLY", record.get().recurrence());
        assertEquals(NOW, record.get().remindAt());
    }

    @Test
    void getReturnsEmptyForNonPositiveIds() {
        assertTrue(service.get(0L, 55L).isEmpty());
        assertTrue(service.get(1L, 0L).isEmpty());
    }

    @Test
    void updateRejectsUnapprovedCodesEagerly() {
        assertThrows(IllegalArgumentException.class,
                () -> service.update(1L, 55L, "text", NOW, "MONTHLY", "ACTIVE"));
        assertThrows(IllegalArgumentException.class,
                () -> service.update(1L, 55L, "text", NOW, "NONE", "DONE"));
    }

    @Test
    void updateReturnsEmptyForAForeignOrAbsentRow() {
        when(jdbc.queryForObject(
                eq("SELECT vc.update_reminder(?, ?, ?, ?, ?, ?)"),
                eq(Boolean.class),
                eq(1L),
                eq(999L),
                eq("text"),
                any(Timestamp.class),
                eq("NONE"),
                eq("DISMISSED")))
                .thenReturn(false);

        assertTrue(service.update(1L, 999L, "text", NOW, "NONE", "DISMISSED").isEmpty());
    }

    @Test
    void deleteReturnsFalseForForeignOrAbsentIds() {
        assertFalse(service.delete(0L, 55L));
        when(jdbc.queryForObject(
                eq("SELECT vc.delete_reminder(?, ?)"),
                eq(Boolean.class),
                eq(1L),
                eq(999L)))
                .thenReturn(false);
        assertFalse(service.delete(1L, 999L));
    }
}
