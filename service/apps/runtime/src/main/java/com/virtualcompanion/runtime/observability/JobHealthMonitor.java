package com.virtualcompanion.runtime.observability;

import com.virtualcompanion.platform.persistence.JobLease;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * S0-31 scheduler freshness monitor. It reads only the fixed V107 job metadata
 * projection and emits fixed operational codes/messages; user text and owner
 * identifiers can never enter an alert through this path.
 */
public final class JobHealthMonitor {

    private static final Logger log = LoggerFactory.getLogger(JobHealthMonitor.class);

    private final JobLease jobLease;
    private final AlertNotifier alerts;
    private final Clock clock;
    private final Instant startedAt;
    private final Map<String, Policy> policies;
    private final Map<String, Instant> reportedFailures = new HashMap<>();

    public JobHealthMonitor(
            JobLease jobLease,
            AlertNotifier alerts,
            boolean retentionEnabled,
            long dauStaleSeconds,
            long exportStaleSeconds,
            long authPurgeStaleSeconds,
            long retentionStaleSeconds) {
        this(jobLease, alerts, retentionEnabled, dauStaleSeconds, exportStaleSeconds,
                authPurgeStaleSeconds, retentionStaleSeconds, Clock.systemUTC());
    }

    JobHealthMonitor(
            JobLease jobLease,
            AlertNotifier alerts,
            boolean retentionEnabled,
            long dauStaleSeconds,
            long exportStaleSeconds,
            long authPurgeStaleSeconds,
            long retentionStaleSeconds,
            Clock clock) {
        this.jobLease = java.util.Objects.requireNonNull(jobLease, "jobLease must not be null");
        this.alerts = java.util.Objects.requireNonNull(alerts, "alerts must not be null");
        this.clock = java.util.Objects.requireNonNull(clock, "clock must not be null");
        this.startedAt = clock.instant();
        Map<String, Policy> configured = new LinkedHashMap<>();
        configured.put(JobLease.DAU_METRICS, policy(dauStaleSeconds, 120));
        configured.put(JobLease.EXPORT_EXPIRY, policy(exportStaleSeconds, 180));
        configured.put(JobLease.AUTH_EVENT_PURGE, policy(authPurgeStaleSeconds, 1800));
        if (retentionEnabled) {
            configured.put(JobLease.RETENTION_PURGE, policy(retentionStaleSeconds, 1800));
        }
        this.policies = Collections.unmodifiableMap(configured);
    }

    @Scheduled(
            fixedDelayString = "${virtual-companion.jobs.health-poll-ms:60000}",
            initialDelayString = "${virtual-companion.jobs.health-initial-delay-ms:60000}")
    public void checkFreshness() {
        Instant now = clock.instant();
        Map<String, JobLease.Health> healthByJob = new HashMap<>();
        try {
            for (JobLease.Health health : jobLease.readHealth()) {
                healthByJob.put(health.jobName(), health);
            }
        } catch (RuntimeException unavailable) {
            // The durable outbox uses the same database, so attempting to enqueue
            // here would only create a second failure. Scrape/health detects DB loss.
            log.error("scheduled job freshness read failed", unavailable);
            return;
        }

        for (Map.Entry<String, Policy> entry : policies.entrySet()) {
            String job = entry.getKey();
            Policy policy = entry.getValue();
            JobLease.Health health = healthByJob.get(job);
            if (health != null && health.paused()) {
                continue;
            }
            boolean latestFailed = health != null && "FAILED".equals(health.latestStatus());
            Instant failedRun = latestFailed ? health.latestStartedAt() : null;
            if (latestFailed && failedRun != null
                    && !failedRun.equals(reportedFailures.put(job, failedRun))) {
                alerts.alert(
                        AlertSeverity.P1,
                        job + "_FAILED",
                        "scheduled job reported a failed run");
            } else if (!latestFailed) {
                reportedFailures.remove(job);
            }
            boolean overdueSuccess = elapsed(now,
                    health == null || health.lastSuccessAt() == null
                            ? startedAt : health.lastSuccessAt()) > policy.staleAfterSeconds();
            boolean expiredRun = health != null
                    && "STARTED".equals(health.latestStatus())
                    && health.latestStartedAt() != null
                    && elapsed(now, health.latestStartedAt()) > policy.maxRunSeconds();
            if (overdueSuccess || expiredRun) {
                alerts.alert(
                        AlertSeverity.P1,
                        job + "_STALE",
                        "scheduled job has no recent successful completion");
            }
        }
    }

    private static Policy policy(long staleAfterSeconds, long maxRunSeconds) {
        if (staleAfterSeconds <= 0) {
            throw new IllegalArgumentException("job stale threshold must be positive");
        }
        return new Policy(staleAfterSeconds, maxRunSeconds);
    }

    private static long elapsed(Instant now, Instant then) {
        return Math.max(0, Duration.between(then, now).toSeconds());
    }

    private record Policy(long staleAfterSeconds, long maxRunSeconds) {
    }
}
