package com.virtualcompanion.runtime.retention;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.JobLease;
import com.virtualcompanion.runtime.observability.AlertNotifier;
import java.sql.Timestamp;
import java.util.OptionalLong;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * RETENTION (§16.7): the scheduler reads every period from the policy table,
 * purges all eight categories, isolates a failing category behind a P1
 * {@code RETENTION_PURGE_FAILED} alert, and never hardcodes a period.
 */
class RetentionPurgeSchedulerTest {

    private JdbcTemplate jdbc;
    private final List<String> alerts = new ArrayList<>();
    private final List<String> purged = new ArrayList<>();

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        purged.clear();
        alerts.clear();
        when(jdbc.queryForObject(contains("active_retention_days"), eq(Integer.class),
                any(Object[].class))).thenAnswer(inv -> {
                    String category = (String) inv.getArgument(2);
                    return switch (category) {
                        case "NORMAL_CHAT" -> 365;
                        case "MEMORY_CANDIDATE" -> 90;
                        default -> 30;
                    };
                });
        when(jdbc.queryForObject(contains("retention_purge_"), eq(Integer.class),
                any(Object[].class))).thenAnswer(inv -> {
                    String sql = inv.getArgument(0, String.class);
                    Timestamp cutoff = inv.getArgument(2);
                    assertThat(cutoff).isNotNull();
                    purged.add(sql);
                    return 1;
                });
    }

    private RetentionPurgeScheduler scheduler() {
        return new RetentionPurgeScheduler(jdbc, (severity, code, message) ->
                alerts.add(severity + ":" + code + ":" + message));
    }

    @Test
    void purgesAllEightCategoriesWithPolicyDrivenCutoffs() {
        scheduler().purgeExpiredData();

        assertThat(purged).hasSize(8);
        assertThat(purged.stream().filter(sql -> sql.contains("normal_chat")).count())
                .isEqualTo(1);
        assertThat(alerts).isEmpty();
    }

    @Test
    void oneFailingCategoryAlertsP1AndDoesNotStopTheOthers() {
        when(jdbc.queryForObject(contains("retention_purge_safety_log"),
                eq(Integer.class), any(Object[].class)))
                .thenThrow(new IllegalStateException("boom"));

        scheduler().purgeExpiredData();

        // The other seven categories still ran.
        assertThat(purged).hasSize(7);
        assertThat(purged.stream().anyMatch(sql -> sql.contains("safety_log"))).isFalse();
        assertThat(alerts).hasSize(1);
        assertThat(alerts.get(0)).startsWith("P1:RETENTION_PURGE_FAILED:");
        assertThat(alerts.get(0)).contains("SAFETY_LOG");
    }

    @Test
    void missingPolicyRowFailsClosedAndAlerts() {
        when(jdbc.queryForObject(contains("active_retention_days"), eq(Integer.class),
                any(Object[].class))).thenReturn(null);

        scheduler().purgeExpiredData();

        assertThat(purged).isEmpty();
        assertThat(alerts).hasSize(8);
        assertThat(alerts.get(0)).startsWith("P1:RETENTION_PURGE_FAILED:");
    }

    @Test
    void lostLeaseDoesNotPurge() {
        JobLease lease = mock(JobLease.class);
        when(lease.beginExclusive(eq(JobLease.RETENTION_PURGE), any(), eq(600)))
                .thenReturn(OptionalLong.empty());

        new RetentionPurgeScheduler(jdbc, (severity, code, message) ->
                alerts.add(severity + ":" + code + ":" + message), lease)
                .purgeExpiredData();

        assertThat(purged).isEmpty();
        assertThat(alerts).isEmpty();
    }
}
