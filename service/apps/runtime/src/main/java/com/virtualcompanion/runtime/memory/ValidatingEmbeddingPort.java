package com.virtualcompanion.runtime.memory;

import java.util.Objects;

/**
 * S0-09 decorator: every embed() result must match the port's declared
 * space (dimension + finite values).
 */
public final class ValidatingEmbeddingPort implements EmbeddingPort {

    private final EmbeddingPort inner;

    public ValidatingEmbeddingPort(EmbeddingPort inner) {
        this.inner = Objects.requireNonNull(inner, "inner");
    }

    @Override
    public EmbeddingSpace space() {
        return inner.space();
    }

    @Override
    public float[] embed(String text) {
        return EmbeddingVectorGuard.requireValid(inner.embed(text), inner.space());
    }
}
