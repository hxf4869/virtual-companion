package com.virtualcompanion.platform.persistence;

import java.util.Objects;

/**
 * Result of a {@link RealtimeResumeService#resume} call. The
 * {@code disposition} is one of the realtime-contract resume dispositions
 * (RESUMED, TERMINAL_SNAPSHOT, GAP_EXPIRED, RESET_REQUIRED,
 * NOT_FOUND_OR_FORBIDDEN). {@code eventsJson} carries the envelope-encoded
 * durable events when RESUMED or TERMINAL_SNAPSHOT; {@code snapshotJson}
 * carries the committed snapshot when TERMINAL_SNAPSHOT. Both are opaque JSON
 * blobs produced by {@code vc.resume_stream} so this layer stays free of a JSON
 * parser dependency.
 */
public record ResumeResult(String disposition, String eventsJson, String snapshotJson) {

    public static final String DISPOSITION_RESUMED = "RESUMED";
    public static final String DISPOSITION_TERMINAL_SNAPSHOT = "TERMINAL_SNAPSHOT";
    public static final String DISPOSITION_GAP_EXPIRED = "GAP_EXPIRED";
    public static final String DISPOSITION_RESET_REQUIRED = "RESET_REQUIRED";
    public static final String DISPOSITION_NOT_FOUND_OR_FORBIDDEN = "NOT_FOUND_OR_FORBIDDEN";

    public ResumeResult {
        Objects.requireNonNull(disposition, "disposition must not be null");
        if (disposition.isBlank()) {
            throw new IllegalArgumentException("disposition must not be blank");
        }
        Objects.requireNonNull(eventsJson, "eventsJson must not be null");
        Objects.requireNonNull(snapshotJson, "snapshotJson must not be null");
    }
}
