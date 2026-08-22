package com.virtualcompanion.modelruntime.execution;

import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.LinkedHashSet;

/**
 * S0-26: the declared data-category provenance of an outbound payload.
 *
 * <p>This is the executable half of the "payload field → processing purpose →
 * data category → provider/region" mapping required by S0-26: for one
 * {@link LiveInvocationRequest} it declares, per message, which
 * {@link DataCategory} that message carries. The provider/region and purpose
 * dimensions of the mapping are already first-class on the authorization
 * snapshot ({@code AuthorizationSnapshot.providerId()/region()/purpose()});
 * this record supplies the missing per-message category dimension so the
 * {@code LiveModelInvoker} can intersect the ACTUAL outbound payload with the
 * CURRENT execution authorization immediately before any transfer.
 *
 * <p>The list is parallel to the request's {@code messages}: entry i classifies
 * {@code messages.get(i)}. A SYSTEM block assembled from recalled memory maps
 * to {@code MEMORY_SNIPPET}; a persona/preference SYSTEM block maps to
 * {@code ACCOUNT_METADATA}; conversation history (user/assistant turns) maps to
 * {@code MESSAGE_TEXT}. Classification is declaration, not inspection — the
 * assembler that built the payload states what it put in, and the invoker
 * enforces against that statement; a request whose composition is undeclared
 * ({@code null}) can never be authorized item-by-item and fails closed.
 *
 * <p>Category codes are the only thing this type carries — never message
 * content — so it is safe for audit surfaces.
 */
public record PayloadComposition(List<DataCategory> messageCategories) {

    public PayloadComposition {
        Objects.requireNonNull(messageCategories, "messageCategories must not be null");
        if (messageCategories.isEmpty()) {
            throw new IllegalArgumentException("messageCategories must not be empty");
        }
        messageCategories.forEach(category -> Objects.requireNonNull(
                category, "messageCategories must not contain null"));
        messageCategories = List.copyOf(messageCategories);
    }

    /** The distinct categories present in the payload (declaration order). */
    public Set<DataCategory> presentCategories() {
        return new LinkedHashSet<>(messageCategories);
    }

    /**
     * Indices of the messages classified as {@code category}, in payload order —
     * the deletion plan for an unauthorized category.
     */
    public List<Integer> indicesOf(DataCategory category) {
        Objects.requireNonNull(category, "category must not be null");
        return java.util.stream.IntStream.range(0, messageCategories.size())
                .filter(index -> messageCategories.get(index) == category)
                .boxed()
                .toList();
    }

    /**
     * A composition declaring every message as {@code MESSAGE_TEXT} — the shape
     * of a plain history-only conversation payload.
     */
    public static PayloadComposition allMessageText(int messageCount) {
        if (messageCount <= 0) {
            throw new IllegalArgumentException("messageCount must be positive");
        }
        return new PayloadComposition(
                java.util.Collections.nCopies(messageCount, DataCategory.MESSAGE_TEXT));
    }

    /** Convenience factory parallel to {@link ProtocolMessage} lists under test. */
    public static PayloadComposition of(DataCategory... categories) {
        return new PayloadComposition(List.of(categories));
    }
}
