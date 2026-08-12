package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Advances generation lifecycle state and reads snapshots, bound to the V25
 * {@code vc.promote_generation} and V8 {@code vc.read_generation_snapshot}
 * SECURITY DEFINER functions (TASK-0174).
 *
 * <p>{@code receive_generation} creates a generation in {@code CREATED};
 * {@code finalize_generation} requires {@code FINAL_REVIEW}. This service
 * drives the forward transitions {@code CREATED → IN_PROGRESS} (worker began)
 * and {@code IN_PROGRESS → FINAL_REVIEW} (candidate ready), serializing against
 * concurrent cancel/finalize via the function's FOR UPDATE lock. Terminal and
 * non-adjacent states are rejected (fail-closed).
 */
public class GenerationStateService {

    /** Legal forward-transition targets (V25 promote_generation enforces adjacency). */
    public static final String IN_PROGRESS = "IN_PROGRESS";
    public static final String FINAL_REVIEW = "FINAL_REVIEW";

    private static final Set<String> VALID_TARGETS = Set.of(IN_PROGRESS, FINAL_REVIEW);

    private final JdbcTemplate jdbc;

    public GenerationStateService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /**
     * Advance a generation to an adjacent forward state.
     *
     * @return the resulting status
     */
    public String promote(long ownerUserId, long generationId, String toStatus) {
        validatePromote(ownerUserId, generationId, toStatus);
        String result = jdbc.queryForObject(
                "SELECT vc.promote_generation(?, ?, ?)",
                String.class,
                ownerUserId,
                generationId,
                toStatus);
        if (result == null) {
            throw new IllegalStateException("promote_generation returned no status");
        }
        return result;
    }

    /**
     * Read a generation snapshot (status + assistant message id + committed
     * realtime events) via {@code vc.read_generation_snapshot} (V8).
     */
    public GenerationSnapshot readSnapshot(long ownerUserId, long generationId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        return jdbc.queryForObject(
                "SELECT out_status, out_assistant_message_id, out_events "
                        + "FROM vc.read_generation_snapshot(?, ?)",
                (rs, rowNum) -> new GenerationSnapshot(
                        rs.getString("out_status"),
                        (Long) rs.getObject("out_assistant_message_id"),
                        rs.getString("out_events")),
                ownerUserId,
                generationId);
    }

    static void validatePromote(long ownerUserId, long generationId, String toStatus) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        if (!VALID_TARGETS.contains(toStatus)) {
            throw new IllegalArgumentException("unsupported target status: " + toStatus);
        }
    }

    /** Generation snapshot view returned by {@code vc.read_generation_snapshot}. */
    public record GenerationSnapshot(String status, Long assistantMessageId, String eventsJson) {
        public GenerationSnapshot {
            Objects.requireNonNull(status, "status must not be null");
        }
    }
}
