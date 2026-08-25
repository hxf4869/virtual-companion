package com.virtualcompanion.runtime.safety;

import java.util.List;

/**
 * DOGFOOD-STABILIZATION-04 (audit defect C): the generation egress gate's
 * refusal. Carries ONLY the persisted message ids of the offending rows and
 * the matched category names — never message content — so the worker can
 * atomically mark those rows model-ineligible and terminalize the turn
 * without the refusal itself leaking any text into logs or exceptions.
 *
 * <p>{@code messageIndices} are positions in the request's message list (the
 * same indices {@link com.virtualcompanion.modelruntime.execution
 * .PayloadComposition#indicesOf} yields); the handler resolves them to
 * persisted ids through the assembler's parallel id list.</p>
 */
public final class GenerationEgressBlockedException extends IllegalStateException {

    private static final long serialVersionUID = 1L;

    private final List<Integer> messageIndices;
    private final List<Long> messageIds;
    private final List<String> categories;

    public GenerationEgressBlockedException(
            List<Integer> messageIndices, List<Long> messageIds, List<String> categories) {
        super("unverified generation provider terms allow only MESSAGE_TEXT free "
                + "of sensitive data (matched categories: " + categories + ")");
        this.messageIndices = List.copyOf(messageIndices);
        this.messageIds = List.copyOf(messageIds);
        this.categories = List.copyOf(categories);
    }

    /** Positions in the outbound message list whose text matched (in order). */
    public List<Integer> messageIndices() {
        return messageIndices;
    }

    /**
     * Persisted ids of the offending rows (empty when the assembler provided
     * no parallel id list or every hit was a synthesized placeholder).
     */
    public List<Long> messageIds() {
        return messageIds;
    }

    /** Matched category names, fixed order, no content. */
    public List<String> categories() {
        return categories;
    }
}
