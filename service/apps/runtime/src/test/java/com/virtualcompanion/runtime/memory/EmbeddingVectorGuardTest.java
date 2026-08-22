package com.virtualcompanion.runtime.memory;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.runtime.memory.EmbeddingPort.EmbeddingSpace;
import org.junit.jupiter.api.Test;

/**
 * S0-09: the shipped guard rejects empty/wrong-dimension/NaN vectors and
 * marks a space-id mismatch as needing re-embed.
 */
class EmbeddingVectorGuardTest {

    private static final EmbeddingSpace SPACE =
            new EmbeddingSpace("deterministic-hash", "1", 64, "alpha-hash-64");

    @Test
    void validatingPortAcceptsTheDeterministicEmbedder() {
        EmbeddingPort port = new ValidatingEmbeddingPort(new DeterministicEmbedder());
        float[] vector = port.embed("ordinary recall query");
        assertArrayEquals(vector, EmbeddingVectorGuard.requireValid(vector, port.space()));
    }

    @Test
    void emptyWrongDimensionAndNanFailClosed() {
        assertThrows(IllegalStateException.class,
                () -> EmbeddingVectorGuard.requireValid(new float[0], SPACE));
        assertThrows(IllegalStateException.class,
                () -> EmbeddingVectorGuard.requireValid(new float[8], SPACE));
        float[] nan = new float[64];
        nan[3] = Float.NaN;
        assertThrows(IllegalStateException.class,
                () -> EmbeddingVectorGuard.requireValid(nan, SPACE));
        float[] inf = new float[64];
        inf[3] = Float.POSITIVE_INFINITY;
        assertThrows(IllegalStateException.class,
                () -> EmbeddingVectorGuard.requireValid(inf, SPACE));
    }

    @Test
    void reembedSeamDetectsSpaceDrift() {
        assertTrue(EmbeddingVectorGuard.needsReembed(null, SPACE));
        assertTrue(EmbeddingVectorGuard.needsReembed("old-space", SPACE));
        assertFalse(EmbeddingVectorGuard.needsReembed("alpha-hash-64", SPACE));
    }
}
