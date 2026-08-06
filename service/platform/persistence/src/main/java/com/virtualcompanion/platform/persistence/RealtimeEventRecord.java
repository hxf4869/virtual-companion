package com.virtualcompanion.platform.persistence;

import java.util.Objects;

/**
 * One durable realtime event in the envelope shape bound by
 * {@code specs/catalog/realtime-events.yaml}: {@code schemaVersion}, {@code event},
 * {@code generationId}, {@code streamEpoch}, {@code eventSeq}, {@code committedAt}
 * and {@code payload}. Non-durable events (deltas, gaps, resets) are never
 * persisted, so this type only ever describes a durable row.
 *
 * <p>This is the value object returned to callers; the database owns the
 * {@code eventSeq} and {@code committedAt} assignment through
 * {@code vc.append_realtime_event}. Field validation is eager so the type is
 * unit-testable without a database.
 */
public record RealtimeEventRecord(
        String eventType,
        long generationId,
        long streamEpoch,
        long eventSeq,
        String committedAt,
        String payloadJson) {

    public static final int ENVELOPE_SCHEMA_VERSION = 1;

    public RealtimeEventRecord {
        Objects.requireNonNull(eventType, "eventType must not be null");
        if (eventType.isBlank()) {
            throw new IllegalArgumentException("eventType must not be blank");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        if (streamEpoch <= 0) {
            throw new IllegalArgumentException("streamEpoch must be positive");
        }
        if (eventSeq < 0) {
            throw new IllegalArgumentException("eventSeq must be non-negative");
        }
        Objects.requireNonNull(committedAt, "committedAt must not be null");
        Objects.requireNonNull(payloadJson, "payloadJson must not be null");
    }
}
