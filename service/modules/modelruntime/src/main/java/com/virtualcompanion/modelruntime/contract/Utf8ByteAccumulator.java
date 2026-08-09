package com.virtualcompanion.modelruntime.contract;

import java.util.Objects;

/**
 * Incremental UTF-8 byte counter whose result matches the complete logical
 * concatenation of all accepted chunks.
 *
 * <p>A trailing high surrogate is retained as state while its one-byte
 * replacement is included in {@link #bytes()}. If the next accepted chunk
 * starts with a low surrogate, that replacement is upgraded to the four-byte
 * pair representation.</p>
 */
public final class Utf8ByteAccumulator {

    private final long maximum;
    private long bytes;
    private boolean pendingHighSurrogate;

    public Utf8ByteAccumulator(long maximum) {
        if (maximum < 0) {
            throw new IllegalArgumentException("maximum must not be negative");
        }
        this.maximum = maximum;
    }

    /**
     * Atomically accepts one chunk if the resulting logical output stays
     * within the configured maximum.
     */
    public boolean tryAppend(String chunk) {
        Objects.requireNonNull(chunk, "chunk must not be null");
        long chunkBytes = SizeLimits.utf8Bytes(chunk);
        if (pendingHighSurrogate
                && !chunk.isEmpty()
                && Character.isLowSurrogate(chunk.charAt(0))) {
            // The two isolated replacements total two bytes, while the pair
            // in the logical concatenation occupies four.
            chunkBytes += 2;
        }
        if (chunkBytes > maximum - bytes) {
            return false;
        }

        bytes += chunkBytes;
        if (!chunk.isEmpty()) {
            pendingHighSurrogate = Character.isHighSurrogate(
                    chunk.charAt(chunk.length() - 1)
            );
        }
        return true;
    }

    public long bytes() {
        return bytes;
    }
}
