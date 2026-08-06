package com.virtualcompanion.platform.persistence;

import java.util.Objects;

/**
 * Terminal (or current best-effort) snapshot of a generation, returned by
 * {@link RealtimeResumeService#readSnapshot}. {@code status} is the generation
 * state (e.g. COMPLETED, CANCELLED), {@code assistantMessageId} is {@code null}
 * until finalize binds the final message, and {@code eventsJson} carries the
 * envelope-encoded durable events for the generation so the client can rebuild
 * committed state. The JSON blob is produced by
 * {@code vc.read_generation_snapshot}; this layer adds no parser dependency.
 */
public record StreamSnapshot(String status, Long assistantMessageId, String eventsJson) {

    public StreamSnapshot {
        Objects.requireNonNull(status, "status must not be null");
        if (status.isBlank()) {
            throw new IllegalArgumentException("status must not be blank");
        }
        Objects.requireNonNull(eventsJson, "eventsJson must not be null");
    }
}
