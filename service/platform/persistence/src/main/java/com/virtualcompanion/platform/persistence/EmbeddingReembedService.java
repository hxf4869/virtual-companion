package com.virtualcompanion.platform.persistence;

import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/** S0-09 owner-free, function-only adapter for the restricted re-embed job. */
public final class EmbeddingReembedService {

    static final String ENSURE_SQL =
            "SELECT out_status, out_last_memory_item_id "
                    + "FROM vc.ensure_embedding_reembed_job(?, ?, ?, ?, ?, ?)";
    static final String CLAIM_SQL =
            "SELECT out_owner_user_id, out_memory_item_id, out_stored_summary "
                    + "FROM vc.claim_embedding_reembed_batch(?, ?)";
    static final String COMPLETE_SQL =
            "SELECT vc.complete_embedding_reembed_item(?, ?, ?, ?, ?)";
    static final String STATUS_SQL =
            "SELECT vc.set_embedding_reembed_status(?, ?)";
    static final String RETIRE_SQL =
            "SELECT vc.retire_embedding_space(?)";

    public record JobState(String status, long lastMemoryItemId) {}
    public record Claimed(long ownerUserId, long memoryItemId, String storedSummary) {}

    private final JdbcTemplate jdbc;

    public EmbeddingReembedService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    public JobState ensure(
            String targetSpaceId,
            String sourceSpaceId,
            String modelId,
            String modelVersion,
            int dimension,
            boolean start) {
        return jdbc.query(
                ENSURE_SQL,
                (rs, rowNum) -> new JobState(
                        rs.getString("out_status"),
                        rs.getLong("out_last_memory_item_id")),
                requireText(targetSpaceId, "targetSpaceId"),
                requireText(sourceSpaceId, "sourceSpaceId"),
                requireText(modelId, "modelId"),
                requireText(modelVersion, "modelVersion"),
                dimension,
                start).stream().findFirst().orElseThrow(() ->
                        new IllegalStateException("ensure_embedding_reembed_job returned no row"));
    }

    public List<Claimed> claim(String targetSpaceId, int limit) {
        if (limit <= 0 || limit > 100) {
            throw new IllegalArgumentException("limit must be within 1..100");
        }
        return jdbc.query(
                CLAIM_SQL,
                (rs, rowNum) -> new Claimed(
                        rs.getLong("out_owner_user_id"),
                        rs.getLong("out_memory_item_id"),
                        rs.getString("out_stored_summary")),
                requireText(targetSpaceId, "targetSpaceId"),
                limit);
    }

    public boolean completeSuccess(
            String targetSpaceId, long ownerUserId, long memoryItemId, String vectorLiteral) {
        return complete(targetSpaceId, ownerUserId, memoryItemId, "SUCCEEDED", vectorLiteral);
    }

    public boolean completeFailure(String targetSpaceId, long ownerUserId, long memoryItemId) {
        return complete(targetSpaceId, ownerUserId, memoryItemId, "FAILED", null);
    }

    public boolean setStatus(String targetSpaceId, String status) {
        if (!"PAUSED".equals(status) && !"RUNNING".equals(status)) {
            throw new IllegalArgumentException("status must be PAUSED or RUNNING");
        }
        return Boolean.TRUE.equals(jdbc.queryForObject(
                STATUS_SQL, Boolean.class, requireText(targetSpaceId, "targetSpaceId"), status));
    }

    public long retireSourceSpace(String sourceSpaceId) {
        Long count = jdbc.queryForObject(
                RETIRE_SQL, Long.class, requireText(sourceSpaceId, "sourceSpaceId"));
        return count == null ? 0L : count;
    }

    private boolean complete(
            String targetSpaceId,
            long ownerUserId,
            long memoryItemId,
            String outcome,
            String vectorLiteral) {
        if (ownerUserId <= 0 || memoryItemId <= 0) {
            throw new IllegalArgumentException("ids must be positive");
        }
        Boolean completed = jdbc.queryForObject(
                COMPLETE_SQL,
                Boolean.class,
                requireText(targetSpaceId, "targetSpaceId"),
                ownerUserId,
                memoryItemId,
                outcome,
                vectorLiteral);
        return Boolean.TRUE.equals(completed);
    }

    private static String requireText(String value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        String normalized = value.trim();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return normalized;
    }
}
