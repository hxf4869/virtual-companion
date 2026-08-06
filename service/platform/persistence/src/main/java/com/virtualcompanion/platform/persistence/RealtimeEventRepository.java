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
