package com.virtualcompanion.runtime.memory;

import com.virtualcompanion.runtime.memory.EmbeddingPort.EmbeddingSpace;
import java.util.Objects;

/**
 * S0-09: dimension / space / finite checks for embedding vectors. Empty
 * vectors, wrong dimension, NaN/Infinity and space mismatch fail closed so
 * a later provider cannot mix spaces or poison recall.
 */
public final class EmbeddingVectorGuard {

    private EmbeddingVectorGuard() {}

    public static float[] requireValid(float[] vector, EmbeddingSpace expected) {
        Objects.requireNonNull(expected, "expected");
        if (vector == null || vector.length == 0) {
            throw new IllegalStateException("embedding vector must not be empty");
        }
        if (vector.length != expected.dimension()) {
            throw new IllegalStateException(
                    "embedding dimension mismatch: expected "
                            + expected.dimension() + " got " + vector.length);
        }
        for (float value : vector) {
            if (!Float.isFinite(value)) {
                throw new IllegalStateException("embedding vector contains a non-finite value");
            }
        }
        return vector;
    }

    /**
     * Checkpoint re-embed seam: a stored vector whose space id differs from
     * the current port must be rewritten. Same-space rows are left alone.
     */
    public static boolean needsReembed(String storedSpaceId, EmbeddingSpace current) {
        Objects.requireNonNull(current, "current");
        if (storedSpaceId == null || storedSpaceId.isBlank()) {
            return true;
        }
        return !current.spaceId().equals(storedSpaceId);
    }
}
