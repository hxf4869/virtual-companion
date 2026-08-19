package com.virtualcompanion.runtime.memory;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link DeterministicEmbedder} (EMBED-RECALL / §11.13): the
 * deterministic floor — same text yields the same unit vector, similar texts
 * rank closer than unrelated ones, and the space identity is stable.
 */
class DeterministicEmbedderTest {

    private final DeterministicEmbedder embedder = new DeterministicEmbedder();

    @Test
    void spaceIdentityIsStable() {
        EmbeddingPort.EmbeddingSpace space = embedder.space();
        assertEquals("deterministic-hash", space.modelId());
        assertEquals("1", space.modelVersion());
        assertEquals(64, space.dimension());
        assertEquals("alpha-hash-64", space.spaceId());
    }

    @Test
    void sameTextEmbedsToTheSameVector() {
        assertArrayEquals(
                embedder.embed("周五有项目汇报"),
                embedder.embed("周五有项目汇报"));
    }

    @Test
    void everyVectorIs64DimensionalAndUnitNorm() {
        float[] vector = embedder.embed("今天上班好累，想找人说说话");
        assertEquals(64, vector.length);
        double norm = 0.0;
        for (float v : vector) {
            norm += (double) v * v;
        }
        assertTrue(Math.abs(norm - 1.0) < 1e-4, "norm=" + norm);
    }

    @Test
    void similarTextsRankCloserThanUnrelatedOnes() {
        float[] a = embedder.embed("我喜欢安静的晚上");
        float[] b = embedder.embed("喜欢安静的晚上");
        float[] c = embedder.embed("周末去爬山");
        assertTrue(cosine(a, b) > cosine(a, c),
                "similar=" + cosine(a, b) + " unrelated=" + cosine(a, c));
    }

    @Test
    void differentTextsProduceDifferentVectors() {
        assertNotEquals(
                DeterministicEmbedder.toVectorLiteral(embedder.embed("安静")),
                DeterministicEmbedder.toVectorLiteral(embedder.embed("吵闹")));
    }

    @Test
    void nullTextIsRejected() {
        assertThrows(NullPointerException.class, () -> embedder.embed(null));
    }

    private static double cosine(float[] a, float[] b) {
        double dot = 0.0;
        for (int i = 0; i < a.length; i++) {
            dot += (double) a[i] * b[i];
        }
        return dot;
    }
}
