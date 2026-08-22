package com.virtualcompanion.platform.persistence;

import java.util.Objects;
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

    public record Permit(boolean acquired, boolean paused, boolean dryRun) {
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

    /**
     * Acquire the named lease and open a run. Empty means this process must
     * skip (lost leader, paused, or dry-run already recorded).
     */
    public OptionalLong beginExclusive(String jobName, String holder, int leaseSeconds) {
        Permit permit = tryAcquire(jobName, holder, leaseSeconds);
        if (!permit.acquired()) {
            return OptionalLong.empty();
        }
        long runId = startRun(jobName);
        if (permit.dryRun()) {
            finishRun(runId, "DRY_RUN", "{}", "");
            return OptionalLong.empty();
        }
        return OptionalLong.of(runId);
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
}
