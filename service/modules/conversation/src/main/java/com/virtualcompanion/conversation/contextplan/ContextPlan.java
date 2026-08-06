package com.virtualcompanion.conversation.contextplan;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * Provider-neutral context plan for one generation turn: an ordered, deduped
 * sequence of {@link ContextEntry sources}, a {@link ContextBudget budget} and
 * the selected {@link InteractionMode}.
 *
 * <p>The plan is the deterministic projection required by TASK-0019: given the
 * same entries, budget and mode it always produces the same canonical assembly
 * order. The compact constructor validates that entries are non-empty, that
 * every assembly {@code order} is unique, then stores an unmodifiable copy
 * sorted ascending by {@code order}. Callers read the canonical sequence via
 * {@link #orderedEntries()}; {@link #entries()} returns the same canonical view.
 */
public record ContextPlan(List<ContextEntry> entries, ContextBudget budget, InteractionMode interactionMode) {

    public ContextPlan {
        Objects.requireNonNull(entries, "entries must not be null");
        if (entries.isEmpty()) {
            throw new IllegalArgumentException("entries must not be empty");
        }
        Objects.requireNonNull(budget, "budget must not be null");
        Objects.requireNonNull(interactionMode, "interactionMode must not be null");
        Set<Integer> seenOrders = new LinkedHashSet<>();
        for (ContextEntry entry : entries) {
            Objects.requireNonNull(entry, "entry must not be null");
            if (!seenOrders.add(entry.order())) {
                throw new IllegalArgumentException("duplicate context order: " + entry.order());
            }
        }
        List<ContextEntry> canonical = new ArrayList<>(entries);
        canonical.sort(Comparator.comparingInt(ContextEntry::order));
        entries = List.copyOf(canonical);
    }

    /**
     * The entries in canonical assembly order (ascending by {@code order}).
     */
    public List<ContextEntry> orderedEntries() {
        return entries;
    }
}
