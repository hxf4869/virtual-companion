package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.OptionalLong;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * S0-31-B named job lease and run history. Runtime roles never take table DML.
 */
public final class JobLease {

    public static final String RETENTION_PURGE = "RETENTION_PURGE";
    public static final String AUTH_EVENT_PURGE = "AUTH_EVENT_PURGE";
    public static final String DAU_METRICS = "DAU_METRICS";
    public static final String EXPORT_EXPIRY = "EXPORT_EXPIRY";

    static final String ACQUIRE_SQL =
            "SELECT out_acquired, out_paused, out_dry_run FROM vc.try_acquire_job_lease(?, ?, ?)";
    static final String START_SQL = "SELECT vc.start_job_run(?)";
    static final String FINISH_SQL = "SELECT vc.finish_job_run(?, ?, ?::jsonb, ?)";
    static final String HEALTH_SQL = "SELECT * FROM vc.list_job_health()";

    public record Permit(boolean acquired, boolean paused, boolean dryRun) {
    }

    /** Acquired run plus the database-controlled dry-run mode. */
    public record Run(long id, boolean dryRun) {
    }

    /** Fixed scheduler metadata only; no owner or user content is exposed. */
    public record Health(
            String jobName,
            boolean paused,
            boolean dryRun,
            Instant lastSuccessAt,
            String latestStatus,
            Instant latestStartedAt,
            Instant latestFinishedAt) {
    }

    private final JdbcTemplate jdbc;

    public JobLease(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    public Permit tryAcquire(String jobName, String holder, int leaseSeconds) {
        Objects.requireNonNull(jobName, "jobName must not be null");
        Objects.requireNonNull(holder, "holder must not be null");
        if (leaseSeconds <= 0) {
            throw new IllegalArgumentException("leaseSeconds must be positive");
        }
        return jdbc.query(
                ACQUIRE_SQL,
                (rs, rowNum) -> new Permit(
                        rs.getBoolean("out_acquired"),
                        rs.getBoolean("out_paused"),
                        rs.getBoolean("out_dry_run")),
                jobName,
                holder,
                leaseSeconds).stream().findFirst().orElseThrow(() ->
                new IllegalStateException("try_acquire_job_lease returned no row"));
    }

    public long startRun(String jobName) {
        Objects.requireNonNull(jobName, "jobName must not be null");
        Long id = jdbc.queryForObject(START_SQL, Long.class, jobName);
        if (id == null || id <= 0) {
            throw new IllegalStateException("start_job_run returned no id");
        }
        return id;
    }

    /** Acquire the named lease, open a run, and preserve DB dry-run mode for the caller. */
    public Optional<Run> beginExclusiveRun(String jobName, String holder, int leaseSeconds) {
        Permit permit = tryAcquire(jobName, holder, leaseSeconds);
        if (!permit.acquired()) {
            return Optional.empty();
        }
        return Optional.of(new Run(startRun(jobName), permit.dryRun()));
    }

    /**
     * Acquire the named lease and open a run. Empty means this process must
     * skip (lost leader, paused, or dry-run already recorded).
     */
    public OptionalLong beginExclusive(String jobName, String holder, int leaseSeconds) {
        Optional<Run> run = beginExclusiveRun(jobName, holder, leaseSeconds);
        if (run.isEmpty()) {
            return OptionalLong.empty();
        }
        if (run.get().dryRun()) {
            finishRun(run.get().id(), "DRY_RUN", "{}", "");
            return OptionalLong.empty();
        }
        return OptionalLong.of(run.get().id());
    }

    public boolean finishRun(long runId, String status, String countsJson, String error) {
        if (runId <= 0) {
            throw new IllegalArgumentException("runId must be positive");
        }
        Objects.requireNonNull(status, "status must not be null");
        Boolean done = jdbc.queryForObject(
                FINISH_SQL,
                Boolean.class,
                runId,
                status,
                countsJson == null || countsJson.isBlank() ? "{}" : countsJson,
                error);
        return Boolean.TRUE.equals(done);
    }

    public List<Health> readHealth() {
        return jdbc.query(
                HEALTH_SQL,
                (rs, rowNum) -> new Health(
                        rs.getString("out_job_name"),
                        rs.getBoolean("out_paused"),
                        rs.getBoolean("out_dry_run"),
                        instant(rs.getTimestamp("out_last_success_at")),
                        rs.getString("out_latest_status"),
                        instant(rs.getTimestamp("out_latest_started_at")),
                        instant(rs.getTimestamp("out_latest_finished_at"))));
    }

    private static Instant instant(java.sql.Timestamp value) {
        return value == null ? null : value.toInstant();
    }
}
