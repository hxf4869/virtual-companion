package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
/**
 * Fetch-SSE resume and snapshot recovery bound to the {@code vc.resume_stream}
 * and {@code vc.read_generation_snapshot} SECURITY DEFINER functions.
 *
 * <p>{@link #resume} returns the contract disposition (RESUMED,
 * TERMINAL_SNAPSHOT, GAP_EXPIRED, RESET_REQUIRED, NOT_FOUND_OR_FORBIDDEN) plus
 * the envelope-encoded durable events and, for a terminal generation, the
 * committed snapshot. The client advances only the last contiguous sequence and
 * missing deltas are never fabricated (INV-RT-001). chat.completed is only ever
 * seen after its transaction commits (INV-TX-001, INV-GEN-003).
 *
 * <p>Argument validation is eager and side-effect free so it is unit-testable
 * without a database; the resume/snapshot runtime behavior is proven by the SQL
 * test suite under {@code infra/db/tests}.
 */
public class RealtimeResumeService {

    private final JdbcTemplate jdbc;

    public RealtimeResumeService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /**
     * Resume a stream at the client cursor {@code (streamEpoch, afterSeq)}.
     * Returns the disposition, the durable events strictly after the cursor
     * (envelope JSON) and, for a terminal generation, the snapshot JSON.
     */
    public ResumeResult resume(long ownerUserId, long generationId, long streamEpoch, long afterSeq) {
        validateResume(ownerUserId, generationId, streamEpoch, afterSeq);
        return jdbc.queryForObject(
                "SELECT out_disposition, out_events::text, out_snapshot::text "
                        + "FROM vc.resume_stream(?, ?, ?, ?)",
                (rs, rowNum) -> new ResumeResult(
                        rs.getString("out_disposition"),
                        rs.getString("out_events"),
                        rs.getString("out_snapshot")),
                ownerUserId,
                generationId,
                streamEpoch,
                afterSeq);
    }

    /**
     * Read the snapshot of a generation (terminal or current best effort):
     * status, assistant message id and the durable events envelope JSON.
     */
    public StreamSnapshot readSnapshot(long ownerUserId, long generationId) {
        validateSnapshot(ownerUserId, generationId);
        return jdbc.queryForObject(
                "SELECT out_status, out_assistant_message_id, out_events::text "
                        + "FROM vc.read_generation_snapshot(?, ?)",
                (rs, rowNum) -> new StreamSnapshot(
                        rs.getString("out_status"),
                        (Long) rs.getObject("out_assistant_message_id"),
                        rs.getString("out_events")),
                ownerUserId,
                generationId);
    }

    static void validateResume(long ownerUserId, long generationId, long streamEpoch, long afterSeq) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        if (streamEpoch <= 0) {
            throw new IllegalArgumentException("streamEpoch must be positive");
        }
        if (afterSeq < 0) {
            throw new IllegalArgumentException("afterSeq must be non-negative");
        }
    }

    static void validateSnapshot(long ownerUserId, long generationId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
    }
}
