package com.virtualcompanion.runtime.memory;

/**
 * Vendor-agnostic embedding seam (EMBED-RECALL / §11.13).
 *
 * <p>Technical Alpha ships {@link DeterministicEmbedder}; a real embedding
 * provider later replaces the implementation, never the callers. The vector
 * space identity travels with every vector (§11.17: 绝不能只保存向量而不
 * 保存结构化原文 — memory_item stays canonical; the space lineage makes a
 * later model switch a controlled double-write migration, never a silent mix).
 */
public interface EmbeddingPort {

    /** The identity of the vector space this port produces. */
    EmbeddingSpace space();

    /** Embed one text into the port's space. */
    float[] embed(String text);

    /** Immutable space identity (§11.17). */
    record EmbeddingSpace(String modelId, String modelVersion, int dimension, String spaceId) {
    }
}
