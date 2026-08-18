package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link UsageHealthService} (USAGE-HEALTH / V52): SD call
 * shapes, approved-interval fences, and the status mapping.
 */
class UsageHealthServiceTest {

    private static final Instant STARTED = Instant.parse("2026-08-18T00:00:00Z");

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final UsageHealthService service = new UsageHealthService(jdbc);

    @Test
    void requireHelpersRejectUnapprovedValues() {
        assertThrows(IllegalArgumentException.class, () -> UsageHealthService.requireReminderMinutes(99));
        assertThrows(IllegalArgumentException.class, () -> UsageHealthService.requireGapMinutes(10));
        assertThrows(IllegalArgumentException.class, () -> UsageHealthService.requireResult("SNOOZE"));
        assertEquals(120, UsageHealthService.requireReminderMinutes(120));
        assertEquals(30, UsageHealthService.requireGapMinutes(30));
        assertEquals("CONTINUED", UsageHealthService.requireResult("CONTINUED"));
    }

    @Test
    void getMapsTheSdRow() {
        stubStatusQuery();

        UsageHealthService.UsageHealthStatus status = service.get(1L);

        assertEquals(120, status.reminderAfterMinutes());
        assertEquals(30, status.sessionGapMinutes());
        assertEquals(45, status.continuousMinutes());
        assertFalse(status.reminderDue());
        assertEquals(STARTED, status.sessionStartedAt());
    }

    @Test
    void updatePrefsRejectsUnapprovedIntervalsBeforeJdbc() {
        assertThrows(IllegalArgumentException.class, () -> service.updatePrefs(1L, 99, 15));
        assertThrows(IllegalArgumentException.class, () -> service.updatePrefs(1L, 60, 10));
    }

    @Test
    void updatePrefsCallsTheSdThenRereads() {
        when(jdbc.queryForObject(
                eq("SELECT vc.update_usage_health_prefs(?, ?, ?)"),
                eq(Boolean.class),
                eq(1L),
                eq(60),
                eq(15)))
                .thenReturn(true);
        stubStatusQuery();

        UsageHealthService.UsageHealthStatus status = service.updatePrefs(1L, 60, 15);

        assertEquals(120, status.reminderAfterMinutes());
        verify(jdbc).queryForObject(
                eq("SELECT vc.update_usage_health_prefs(?, ?, ?)"),
                eq(Boolean.class),
                eq(1L),
                eq(60),
                eq(15));
    }

    @Test
    void heartbeatCallsTheMutatingSd() {
        stubStatusQuery();

        service.heartbeat(1L);

        verify(jdbc).query(
                eq("SELECT out_reminder_after_minutes, out_session_gap_minutes, "
                        + "out_continuous_minutes, out_reminder_due, out_session_started_at "
                        + "FROM vc.usage_heartbeat(?)"),
                any(RowMapper.class),
                eq(1L));
    }

    @Test
    void recordReminderRejectsUnapprovedResults() {
        assertThrows(IllegalArgumentException.class, () -> service.recordReminder(1L, "SNOOZE"));
    }

    @Test
    void recordReminderCallsTheSd() {
        when(jdbc.queryForObject(
                eq("SELECT vc.record_usage_reminder(?, ?)"),
                eq(Long.class),
                eq(1L),
                eq("SHOWN")))
                .thenReturn(7L);
        stubStatusQuery();

        UsageHealthService.UsageHealthStatus status = service.recordReminder(1L, "SHOWN");

        assertTrue(status.continuousMinutes() >= 0);
        verify(jdbc).queryForObject(
                eq("SELECT vc.record_usage_reminder(?, ?)"),
                eq(Long.class),
                eq(1L),
                eq("SHOWN"));
    }

    @Test
    void ownerIdMustBePositive() {
        assertThrows(IllegalArgumentException.class, () -> service.get(0L));
        assertThrows(IllegalArgumentException.class, () -> service.heartbeat(-1L));
    }

    @SuppressWarnings("unchecked")
    private void stubStatusQuery() {
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getInt("out_reminder_after_minutes")).thenReturn(120);
                    when(rs.getInt("out_session_gap_minutes")).thenReturn(30);
                    when(rs.getInt("out_continuous_minutes")).thenReturn(45);
                    when(rs.getBoolean("out_reminder_due")).thenReturn(false);
                    when(rs.getTimestamp("out_session_started_at"))
                            .thenReturn(Timestamp.from(STARTED));
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });
    }
}
