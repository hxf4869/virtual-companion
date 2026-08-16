package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Durable realtime event persistence bound to the
 * {@code vc.append_realtime_event} SECURITY DEFINER function.
 *
 * <p>Only durable events (per {@code specs/catalog/realtime-events.yaml}) are
 * persisted; non-durable deltas consume sequence via {@code advance_realtime_seq}
 * at the runtime layer but never reach this repository. The function allocates a
 * monotonic {@code eventSeq} from the per-(generation, epoch) stream cursor and
 * rejects an epoch mismatch, so an event can never be appended to a stale epoch.
 *
 * <p>Argument validation is eager and side-effect free so it is unit-testable
 * without a database; the durable runtime behavior is proven by the SQL test
 * suite under {@code infra/db/tests}.
 */
public class RealtimeEventRepository {

    private final JdbcTemplate jdbc;

    public RealtimeEventRepository(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /**
     * Append one durable event and return the assigned monotonic eventSeq.
     *
     * @param payloadJson envelope payload as a JSON string (cast to jsonb server-side)
     */
    public long appendDurableEvent(
            long ownerUserId,
            long generationId,
            long streamEpoch,
            String eventType,
            String payloadJson) {
        validateAppend(ownerUserId, generationId, streamEpoch, eventType, payloadJson);
        Long eventSeq = jdbc.queryForObject(
                "SELECT vc.append_realtime_event(?, ?, ?, ?, ?::jsonb)",
                Long.class,
                ownerUserId,
                generationId,
                streamEpoch,
                eventType,
                payloadJson);
        if (eventSeq == null) {
            throw new IllegalStateException("append_realtime_event returned no eventSeq");
        }
        return eventSeq;
    }

    /**
     * STREAM-LIVE: read the current stream epoch for a generation, ensuring the
     * per-generation stream row exists (V8 {@code vc.ensure_realtime_stream}).
     * Used before the first durable append so the epoch is known to the caller.
     */
    public long streamEpoch(long ownerUserId, long generationId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        Long epoch = jdbc.query(
                "SELECT out_stream_epoch FROM vc.ensure_realtime_stream(?, ?)",
                (rs, rowNum) -> rs.getLong("out_stream_epoch"),
                ownerUserId,
                generationId).stream().findFirst().orElse(null);
        if (epoch == null) {
            throw new IllegalStateException("ensure_realtime_stream returned no epoch");
        }
        return epoch;
    }

    /**
     * STREAM-LIVE: reserve {@code count} seq slots for non-durable live deltas
     * (V8 {@code vc.advance_realtime_seq} — deltas consume seq without
     * persisting). Returns the post-increment high water mark, so the reserved
     * block is {@code [next - count, next)}. Must run in the prepare segment
     * while the generation is non-terminal.
     */
    public long advanceSeq(long ownerUserId, long generationId, int count) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        if (count < 0) {
            throw new IllegalArgumentException("count must be non-negative");
        }
        Long next = jdbc.queryForObject(
                "SELECT vc.advance_realtime_seq(?, ?, ?)",
                Long.class,
                ownerUserId,
                generationId,
                count);
        if (next == null) {
            throw new IllegalStateException("advance_realtime_seq returned no high water mark");
        }
        return next;
    }

    /**
     * GEN-RECONC: existence probe for one durable event of a generation (V33
     * {@code vc.generation_has_event}). The worker's prepare segment uses it to
     * skip re-appending {@code chat.accepted} when a retried or crash-recovered
     * run re-enters prepare (append is not idempotent — every call allocates a
     * fresh seq). The trusted-owner assertion inside the SD function fails
     * closed for a foreign owner.
     */
    public boolean hasDurableEvent(long ownerUserId, long generationId, String eventType) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        if (eventType == null || eventType.isBlank()) {
            throw new IllegalArgumentException("eventType must not be blank");
        }
        Boolean present = jdbc.queryForObject(
                "SELECT vc.generation_has_event(?, ?, ?)",
                Boolean.class,
                ownerUserId,
                generationId,
                eventType);
        return Boolean.TRUE.equals(present);
    }

    /**
     * Pure argument validation for a durable append. Exposed for unit testing;
     * throws {@link IllegalArgumentException} on any invalid combination.
     */
    static void validateAppend(
            long ownerUserId,
            long generationId,
            long streamEpoch,
            String eventType,
            String payloadJson) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        if (streamEpoch <= 0) {
            throw new IllegalArgumentException("streamEpoch must be positive");
        }
        if (eventType == null || eventType.isBlank()) {
            throw new IllegalArgumentException("eventType must not be blank");
        }
        if (payloadJson == null) {
            throw new IllegalArgumentException("payloadJson must not be null");
        }
    }
}
