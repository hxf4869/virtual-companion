package com.virtualcompanion.runtime.observability;

import com.virtualcompanion.platform.persistence.JobLease;
import com.virtualcompanion.runtime.servicemode.BetaServiceWindow;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.OptionalLong;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * METRICS-ALERT (§22.10 / §26.6): refreshes the {@code vc_beta_dau} gauge
 * from the V77 job SD. The day boundary follows the beta service-window zone
 * — the same zone the DAU cap enforces — whether or not the gate itself is
 * enabled. A failed poll keeps the last gauge value, records a FAILED run and
 * emits the fixed P1 {@code DAU_METRICS_FAILED} alert; freshness monitoring
 * independently catches a poll loop that stops running.
 * {@code AuthDataSourceConfig} only while the auth datasource is live.
 */
public class DauMetricsScheduler {

    private static final Logger log = LoggerFactory.getLogger(DauMetricsScheduler.class);

    private final JdbcTemplate authJdbcTemplate;
    private final VcMetrics metrics;
    private final BetaServiceWindow serviceWindow;
    private final JobLease jobLease;
    private final AlertNotifier alertNotifier;
    private final String holder = UUID.randomUUID().toString();

    public DauMetricsScheduler(
            JdbcTemplate authJdbcTemplate, VcMetrics metrics, BetaServiceWindow serviceWindow) {
        this(authJdbcTemplate, metrics, serviceWindow, null, null);
    }

    public DauMetricsScheduler(
            JdbcTemplate authJdbcTemplate,
            VcMetrics metrics,
            BetaServiceWindow serviceWindow,
            JobLease jobLease) {
        this(authJdbcTemplate, metrics, serviceWindow, jobLease, null);
    }

    public DauMetricsScheduler(
            JdbcTemplate authJdbcTemplate,
            VcMetrics metrics,
            BetaServiceWindow serviceWindow,
            JobLease jobLease,
            AlertNotifier alertNotifier) {
        this.authJdbcTemplate = authJdbcTemplate;
        this.metrics = metrics;
        this.serviceWindow = serviceWindow;
        this.jobLease = jobLease;
        this.alertNotifier = alertNotifier;
    }

    @Scheduled(fixedDelayString = "${virtual-companion.observability.dau-poll-ms:60000}")
    public void pollDailyActiveUsers() {
        OptionalLong runId = jobLease == null
                ? OptionalLong.empty()
                : jobLease.beginExclusive(JobLease.DAU_METRICS, holder, 30);
        if (jobLease != null && runId.isEmpty()) {
            return;
        }
        Instant dayStart = serviceWindow.dayStart(Instant.now());
        try {
            Long dau = authJdbcTemplate.queryForObject(
                    "SELECT vc.job_daily_active_users(?)", Long.class, Timestamp.from(dayStart));
            long value = dau == null ? 0L : dau;
            metrics.dau(value);
            if (runId.isPresent()) {
                jobLease.finishRun(runId.getAsLong(), "SUCCEEDED", "{\"dau\":" + value + "}", "");
            }
        } catch (RuntimeException e) {
            log.error("daily-active-user metric poll failed", e);
            if (alertNotifier != null) {
                alertNotifier.alert(
                        AlertSeverity.P1,
                        "DAU_METRICS_FAILED",
                        "daily active user aggregate refresh failed");
            }
            if (runId.isPresent()) {
                jobLease.finishRun(runId.getAsLong(), "FAILED", "{}", "poll_failed");
            }
        }
    }
}
