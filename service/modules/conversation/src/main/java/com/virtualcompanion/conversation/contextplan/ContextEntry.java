package com.virtualcompanion.conversation.contextplan;

import java.util.Objects;

/**
 * One source contribution to a {@link ContextPlan}, carrying its
 * {@link ContextSourceKind}, a 1-based assembly {@code order} and its text.
 *
 * <p>{@code order} is the deterministic assembly priority; a {@link ContextPlan}
 * rejects duplicate orders so the assembled sequence is unambiguous.
 */
public record ContextEntry(ContextSourceKind sourceKind, int order, String content) {

    public ContextEntry {
        Objects.requireNonNull(sourceKind, "sourceKind must not be null");
        if (order <= 0) {
            throw new IllegalArgumentException("order must be positive (1-based)");
        }
        Objects.requireNonNull(content, "content must not be null");
    }
}
