package com.virtualcompanion.runtime.memory;

import java.util.Objects;

/**
 * S0-09 OpenAI-compatible provider adapter for the vendor-neutral
 * {@link EmbeddingPort}. The current pgvector contract is intentionally frozen
 * at 64 dimensions; a mismatched deployment fails at startup instead of mixing
 * vector spaces silently.
 */
public final class OpenAiCompatEmbeddingPort implements EmbeddingPort {

    public static final int REGISTERED_DIMENSION = 64;

    private final OpenAiCompatEmbedder client;
    private final EmbeddingSpace space;

    public OpenAiCompatEmbeddingPort(
            OpenAiCompatEmbedder client,
            String modelId,
            String modelVersion,
            int dimension,
            String spaceId) {
        this.client = Objects.requireNonNull(client, "client must not be null");
        if (dimension != REGISTERED_DIMENSION) {
            throw new IllegalArgumentException("embedding dimension must match registered dimension 64");
        }
        this.space = new EmbeddingSpace(
                requireText(modelId, "modelId"),
                requireText(modelVersion, "modelVersion"),
                dimension,
                requireText(spaceId, "spaceId"));
    }

    @Override
    public EmbeddingSpace space() {
        return space;
    }

    @Override
    public float[] embed(String text) {
        return client.embed(text, space.dimension());
    }

    private static String requireText(String value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        String normalized = value.trim();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return normalized;
    }
}
