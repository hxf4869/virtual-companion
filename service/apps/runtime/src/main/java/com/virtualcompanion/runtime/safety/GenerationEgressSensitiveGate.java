package com.virtualcompanion.runtime.safety;

import com.virtualcompanion.modelruntime.authorization.DataCategory;
import com.virtualcompanion.modelruntime.execution.LiveInvocationRequest;
import com.virtualcompanion.modelruntime.execution.PayloadComposition;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * DOGFOOD-STABILIZATION-03 (audit defect B): the sensitive-data gate at the
 * GENERATION provider's final egress boundary.
 *
 * <p>Defect: the {@link SensitiveDataDetector} only ran inside the remote
 * MODERATION classifier, so with {@code VC_MODERATION_ENABLED=false} (or any
 * configuration where moderation never sees the text) a generation outbound
 * carried MESSAGE_TEXT nobody had checked — the local hard-rule classifier is
 * a rule engine, not a personal-data detector, and must not be mistaken for
 * one.</p>
 *
 * <p>This gate is independent of moderation: whenever a generation provider
 * is enabled and the generation provider's terms are NOT yet verified, every
 * MESSAGE_TEXT message of the actually-outbound request — the current turn
 * AND every history row that made it into the payload — must pass
 * {@link SensitiveDataDetector} BEFORE the provider HTTP call. A hit throws
 * (fail closed, zero provider HTTP); the exception carries matched category
 * names only, never message content.</p>
 *
 * <p>MEMORY_SNIPPET / ACCOUNT_METADATA blocks are governed by the
 * authorization-snapshot intersection in the invoker (S0-26), not by this
 * detector: an unauthorized category never leaves the host regardless of the
 * terms flag.</p>
 */
public final class GenerationEgressSensitiveGate {

    private final SensitiveDataDetector detector;
    private final boolean generationProviderTermsVerified;

    public GenerationEgressSensitiveGate(boolean generationProviderTermsVerified) {
        this(new SensitiveDataDetector(), generationProviderTermsVerified);
    }

    public GenerationEgressSensitiveGate(
            SensitiveDataDetector detector, boolean generationProviderTermsVerified) {
        this.detector = Objects.requireNonNull(detector, "detector must not be null");
        this.generationProviderTermsVerified = generationProviderTermsVerified;
    }

    /**
     * Review the outbound request. No-op when the provider terms are verified
     * or the request declares no composition (non-external requests can never
     * reach a provider). Throws {@link IllegalStateException} with category
     * names only on the first sensitive MESSAGE_TEXT hit.
     */
    public void review(LiveInvocationRequest request) {
        review(request, null);
    }

    /**
     * DOGFOOD-STABILIZATION-04 (audit defect C): review with the assembler's
     * parallel id list. {@code messageTextMessageIds} is aligned with the
     * MESSAGE_TEXT positions of the composition (null entries for synthesized
     * placeholder messages); a hit throws
     * {@link GenerationEgressBlockedException} carrying the offending rows'
     * positions AND persisted ids (null ids stay index-only — e.g. a
     * synthesized placeholder) plus the matched category names, never
     * content. The worker uses the ids to durably mark the rows
     * model-ineligible in the rejection transaction.
     */
    public void review(LiveInvocationRequest request, List<Long> messageTextMessageIds) {
        Objects.requireNonNull(request, "request must not be null");
        if (generationProviderTermsVerified) {
            return;
        }
        PayloadComposition composition = request.payloadComposition();
        if (composition == null) {
            return;
        }
        List<com.virtualcompanion.modelruntime.contract.ProtocolMessage> messages =
                request.messages();
        // Collect EVERY offending position (not just the first): the worker
        // marks all of them model-ineligible in one rejection transaction, so
        // a single poisoned turn cannot re-trigger on the next clean turn.
        List<Integer> hitIndices = new ArrayList<>();
        Set<String> hitCategories = new LinkedHashSet<>();
        for (int index : composition.indicesOf(DataCategory.MESSAGE_TEXT)) {
            List<String> categories = detector.detect(messages.get(index).content());
            if (!categories.isEmpty()) {
                hitIndices.add(index);
                hitCategories.addAll(categories);
            }
        }
        if (hitIndices.isEmpty()) {
            return;
        }
        // Resolve the offending positions to persisted ids through the
        // assembler's parallel list (null entries — synthesized placeholder
        // messages — resolve to nothing; they are platform-authored ".").
        List<Long> offendingIds = new ArrayList<>();
        if (messageTextMessageIds != null) {
            List<Integer> textPositions = composition.indicesOf(DataCategory.MESSAGE_TEXT);
            for (int hit : hitIndices) {
                int ordinal = textPositions.indexOf(hit);
                if (ordinal >= 0 && ordinal < messageTextMessageIds.size()) {
                    Long id = messageTextMessageIds.get(ordinal);
                    if (id != null && !offendingIds.contains(id)) {
                        offendingIds.add(id);
                    }
                }
            }
        }
        // Category names and ids only — message text never enters the exception.
        throw new GenerationEgressBlockedException(
                hitIndices, offendingIds, new ArrayList<>(hitCategories));
    }
}
