package com.virtualcompanion.runtime.retention;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.JobLease;
import com.virtualcompanion.runtime.observability.AlertNotifier;
import java.util.Optional;
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
        // Activation probe: every category ACTIVE by default (individual
        // tests flip selected categories to DRAFT).
        when(jdbc.queryForObject(contains("retention_category_active"), eq(Boolean.class),
                any(Object[].class))).thenReturn(true);
        when(jdbc.queryForObject(contains("active_retention_days"), eq(Integer.class),
                any(Object[].class))).thenAnswer(inv -> {
                    String category = (String) inv.getArgument(2);
                    return switch (category) {
                        case "NORMAL_CHAT" -> 365;
                        case "MEMORY_CANDIDATE" -> 90;
                        default -> 30;
                    };
                });
        when(jdbc.queryForObject(contains("run_retention_category"), eq(Integer.class),
                any(), any())).thenAnswer(inv -> {
                    String category = inv.getArgument(2, String.class);
                    Boolean dryRun = inv.getArgument(3, Boolean.class);
                    assertThat(dryRun).isFalse();
                    purged.add(category);
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
        assertThat(purged).containsExactly(
                "NORMAL_CHAT", "DELETED_CHAT", "MEMORY_CANDIDATE",
                "REJECTED_CANDIDATE", "MODEL_CALL_DETAIL", "SAFETY_LOG",
                "EXPORT_RESIDUE", "STREAM_FRAGMENT");
        assertThat(alerts).isEmpty();
    }

    @Test
    void oneFailingCategoryAlertsP1AndDoesNotStopTheOthers() {
        when(jdbc.queryForObject(contains("run_retention_category"),
                eq(Integer.class), eq("SAFETY_LOG"), eq(false)))
                .thenThrow(new IllegalStateException("boom"));

        scheduler().purgeExpiredData();

        // The other seven categories still ran.
        assertThat(purged).hasSize(7);
        assertThat(purged).doesNotContain("SAFETY_LOG");
        assertThat(alerts).hasSize(1);
        assertThat(alerts.get(0)).startsWith("P1:RETENTION_PURGE_FAILED:");
        assertThat(alerts.get(0)).contains("SAFETY_LOG");
    }

    @Test
    void activatedCategoryWithBrokenPolicyFailsClosedAndAlerts() {
        // The activation probe passed but the policy read broke — an
        // ACTIVATED category still fails closed with a P1.
        when(jdbc.queryForObject(contains("active_retention_days"), eq(Integer.class),
                any(Object[].class))).thenReturn(null);

        scheduler().purgeExpiredData();

        assertThat(purged).isEmpty();
        assertThat(alerts).hasSize(8);
        assertThat(alerts.get(0)).startsWith("P1:RETENTION_PURGE_FAILED:");
    }

    @Test
    void draftCategoriesAreSkippedWithoutAlertsAndTheRunStaysSucceeded() {
        // DOGFOOD-STABILIZATION audit: 1 ACTIVE + 7 DRAFT — only the ACTIVE
        // category purges, DRAFT categories record SKIP with no P1, and the
        // JobRun is not FAILED.
        when(jdbc.queryForObject(contains("retention_category_active"), eq(Boolean.class),
                any(Object[].class))).thenAnswer(inv ->
                "NORMAL_CHAT".equals(inv.getArgument(2)));
        JobLease lease = mock(JobLease.class);
        when(lease.beginExclusiveRun(eq(JobLease.RETENTION_PURGE), any(), eq(600)))
                .thenReturn(Optional.of(new JobLease.Run(21L, false)));
        when(lease.finishRun(eq(21L), eq("SUCCEEDED"), anyString(), eq("")))
                .thenReturn(true);

        new RetentionPurgeScheduler(jdbc, (severity, code, message) ->
                alerts.add(severity + ":" + code + ":" + message), lease)
                .purgeExpiredData();

        assertThat(purged).containsExactly("NORMAL_CHAT");
        assertThat(alerts).isEmpty();
        // The run reports SUCCEEDED with SKIP markers for the DRAFT rest.
        verify(lease).finishRun(eq(21L), eq("SUCCEEDED"),
                contains("\"DELETED_CHAT\":\"SKIP\""), eq(""));
        verify(lease).finishRun(eq(21L), eq("SUCCEEDED"),
                contains("\"NORMAL_CHAT\":\"1\""), eq(""));
    }

    @Test
    void activationProbeReadFailureFailsClosedWithP1() {
        when(jdbc.queryForObject(contains("retention_category_active"), eq(Boolean.class),
                any(Object[].class))).thenThrow(new IllegalStateException("db down"));

        scheduler().purgeExpiredData();

        assertThat(purged).isEmpty();
        assertThat(alerts).hasSize(8);
        assertThat(alerts.get(0)).startsWith("P1:RETENTION_PURGE_FAILED:");
    }

    @Test
    void lostLeaseDoesNotPurge() {
        JobLease lease = mock(JobLease.class);
        when(lease.beginExclusiveRun(eq(JobLease.RETENTION_PURGE), any(), eq(600)))
                .thenReturn(Optional.empty());

        new RetentionPurgeScheduler(jdbc, (severity, code, message) ->
                alerts.add(severity + ":" + code + ":" + message), lease)
                .purgeExpiredData();

        assertThat(purged).isEmpty();
        assertThat(alerts).isEmpty();
    }

    @Test
    void explicitDryRunUsesEstimateWrapperForEveryCategory() {
        JdbcTemplate dryJdbc = mock(JdbcTemplate.class);
        when(dryJdbc.queryForObject(contains("retention_category_active"), eq(Boolean.class),
                any(Object[].class))).thenReturn(true);
        when(dryJdbc.queryForObject(contains("active_retention_days"), eq(Integer.class),
                any(Object[].class))).thenReturn(30);
        when(dryJdbc.queryForObject(contains("run_retention_category"), eq(Integer.class),
                any(), eq(true))).thenReturn(2);

        new RetentionPurgeScheduler(
                dryJdbc, (severity, code, message) -> {}, null, true)
                .purgeExpiredData();

        verify(dryJdbc, times(8)).queryForObject(
                contains("run_retention_category"), eq(Integer.class), any(), eq(true));
    }

    @Test
    void databaseDryRunExecutesEstimatesAndRecordsCategoryCounts() {
        JobLease lease = mock(JobLease.class);
        when(lease.beginExclusiveRun(eq(JobLease.RETENTION_PURGE), any(), eq(600)))
                .thenReturn(Optional.of(new JobLease.Run(11L, true)));
        when(lease.finishRun(eq(11L), eq("DRY_RUN"), anyString(), eq("")))
                .thenReturn(true);
        JdbcTemplate dryJdbc = mock(JdbcTemplate.class);
        when(dryJdbc.queryForObject(contains("retention_category_active"), eq(Boolean.class),
                any(Object[].class))).thenReturn(true);
        when(dryJdbc.queryForObject(contains("active_retention_days"), eq(Integer.class),
                any(Object[].class))).thenReturn(30);
        when(dryJdbc.queryForObject(contains("run_retention_category"), eq(Integer.class),
                any(), eq(true))).thenReturn(3);

        new RetentionPurgeScheduler(
                dryJdbc, (severity, code, message) -> {}, lease, false)
                .purgeExpiredData();

        verify(dryJdbc, times(8)).queryForObject(
                contains("run_retention_category"), eq(Integer.class), any(), eq(true));
        verify(lease).finishRun(eq(11L), eq("DRY_RUN"), contains("\"NORMAL_CHAT\":\"3\""), eq(""));
    }
}
