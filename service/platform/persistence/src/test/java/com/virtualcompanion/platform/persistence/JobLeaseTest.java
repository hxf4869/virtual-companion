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

import java.util.List;
import java.util.OptionalLong;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class JobLeaseTest {

    @Test
    void acquirePinsSql() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), eq("RETENTION_PURGE"), eq("h1"), eq(60)))
                .thenReturn(List.of(new JobLease.Permit(true, false, false)));
        JobLease lease = new JobLease(jdbc);

        JobLease.Permit permit = lease.tryAcquire("RETENTION_PURGE", "h1", 60);
        assertTrue(permit.acquired());
        assertFalse(permit.paused());
        verify(jdbc).query(eq(JobLease.ACQUIRE_SQL), any(RowMapper.class),
                eq("RETENTION_PURGE"), eq("h1"), eq(60));
    }

    @Test
    void beginExclusiveSkipsWhenNotAcquired() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), eq("DAU_METRICS"), eq("h1"), eq(30)))
                .thenReturn(List.of(new JobLease.Permit(false, true, false)));
        assertTrue(new JobLease(jdbc).beginExclusive("DAU_METRICS", "h1", 30).isEmpty());
    }

    @Test
    void beginExclusiveRecordsDryRunAndSkipsWork() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), eq("EXPORT_EXPIRY"), eq("h1"), eq(60)))
                .thenReturn(List.of(new JobLease.Permit(true, false, true)));
        when(jdbc.queryForObject(eq(JobLease.START_SQL), eq(Long.class), eq("EXPORT_EXPIRY")))
                .thenReturn(4L);
        when(jdbc.queryForObject(
                eq(JobLease.FINISH_SQL), eq(Boolean.class),
                eq(4L), eq("DRY_RUN"), eq("{}"), eq("")))
                .thenReturn(true);

        OptionalLong run = new JobLease(jdbc).beginExclusive("EXPORT_EXPIRY", "h1", 60);
        assertTrue(run.isEmpty());
        verify(jdbc).queryForObject(JobLease.FINISH_SQL, Boolean.class, 4L, "DRY_RUN", "{}", "");
    }

    @Test
    void finishRunPinsFunction() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(
                eq(JobLease.FINISH_SQL), eq(Boolean.class),
                eq(9L), eq("SUCCEEDED"), eq("{\"removed\":1}"), eq("")))
                .thenReturn(true);
        assertTrue(new JobLease(jdbc).finishRun(9L, "SUCCEEDED", "{\"removed\":1}", ""));
        assertEquals(JobLease.START_SQL, "SELECT vc.start_job_run(?)");
    }
}
