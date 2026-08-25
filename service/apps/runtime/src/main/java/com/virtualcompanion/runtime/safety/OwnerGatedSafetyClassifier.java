package com.virtualcompanion.runtime.safety;

import com.virtualcompanion.safety.SafetyClassification;
import com.virtualcompanion.safety.SafetyClassifierPort;
import com.virtualcompanion.safety.SafetyStage;
import java.util.List;
import java.util.Objects;

/**
 * DOGFOOD-STABILIZATION audit (ADR-0006 §4): owner-bound egress gate for the
 * remote safety-classifier leg. Every check below must pass BEFORE any HTTP
 * leaves the host; a failing or unreadable probe throws, which the composite
 * classifier turns into the fail-closed UNAVAILABLE block — zero remote
 * calls in every deny or read-failure path.
 *
 * <ul>
 *   <li>an active account-deletion intent blocks remote classification;</li>
 *   <li>the ADR-0006 §4.1 five-type necessary-consent set must be fully
 *       granted — the set is fixed here, never guessed from the (default
 *       empty) {@code admission.required-consent-types} config;</li>
 *   <li>the moderation channel's provider deployment must be currently
 *       ADMITTED (re-read per call, unreadable means deny);</li>
 *   <li>while the provider terms are not verified, only text the local
 *       {@link SensitiveDataDetector} finds clean of personal data
 *       (id/bank/mobile/email/address/secret/otp) may leave the host.</li>
 * </ul>
 *
 * <p>DOGFOOD-STABILIZATION-02 audit: the consent/deletion/admission probes
 * read SECURITY DEFINER functions that require the server-trusted owner
 * context (V17/V27 GUC), but the worker's FINAL classification runs OUTSIDE
 * any owner transaction. The gate therefore splits each call into a SHORT
 * owner-bound authorization read (all DB probes inside one
 * {@link OwnerBoundExecutor} transaction — nested/joining when the caller
 * already established the context, fresh otherwise) and a DB-free HTTP
 * phase; the remote call itself is never wrapped in a database transaction.
 * Without an executor the probes run on the caller's context and fail closed
 * when none is established, exactly like before.</p>
 *
 * <p>The owner-less {@link #classify(SafetyStage, String)} is deliberately
 * unusable (same pattern as the consent-gated embedding port) so no future
 * caller can bypass the gate by dropping the owner id.</p>
 */
public final class OwnerGatedSafetyClassifier implements SafetyClassifierPort {

    /** ADR-0006 §4.1 necessary-consent set — fixed, not configuration. */
    static final List<String> REQUIRED_CONSENTS = List.of(
            "SERVICE_TERMS",
            "PRIVACY_POLICY",
            "AI_CONTENT_NOTICE",
            "THIRD_PARTY_MODEL_PROCESSING",
            "SENSITIVE_DATA_PROCESSING");

    /** @return true when the owner currently holds a granted record of the type. */
    public interface ConsentProbe {
        boolean granted(long ownerUserId, String consentType);
    }

    /** @return true when an account-deletion intent is currently active. */
    public interface DeletionIntentProbe {
        boolean active(long ownerUserId);
    }

    /** @return true when the providerRef's deployment is currently ADMITTED. */
    public interface AdmissionProbe {
        boolean admitted(String providerRef);
    }

    /**
     * Runs the DB probe phase inside the server-trusted owner context, and
     * lets the HTTP phase run OUTSIDE every database transaction.
     *
     * <p>DOGFOOD-STABILIZATION-03 (audit defect C): the web INPUT path
     * executes inside the OwnerInjectionFilter's request-scoped transaction,
     * so a plain {@link #asOwner} (REQUIRED propagation) would JOIN that
     * request transaction — the probes would run in the long outer
     * transaction and a failing probe would poison it, un-committing the
     * INPUT_BLOCKED terminal that follows. The production wiring therefore
     * overrides both defaults:
     * {@link #asOwnerIndependent} opens a short REQUIRES_NEW owner
     * transaction (isolating any probe failure to that transaction), and
     * {@link #withoutTransaction} suspends the outer transaction around the
     * remote HTTP call. The plain {@link #asOwner} default keeps worker-side
     * (no outer transaction) and test callers compiling: without an outer
     * transaction REQUIRED opens a fresh short transaction anyway.</p>
     */
    @FunctionalInterface
    public interface OwnerBoundExecutor {
        void asOwner(long ownerUserId, Runnable work);

        /** Short INDEPENDENT owner transaction (REQUIRES_NEW). */
        default void asOwnerIndependent(long ownerUserId, Runnable work) {
            asOwner(ownerUserId, work);
        }

        /** Run work with every database transaction suspended (HTTP phase). */
        default void withoutTransaction(Runnable work) {
            work.run();
        }
    }

    /** Authorization snapshot read in one short owner-bound transaction. */
    private record EgressPermit(boolean deletionIntentActive, boolean admitted) {
    }

    private final SafetyClassifierPort delegate;
    private final ConsentProbe consents;
    private final DeletionIntentProbe deletionIntents;
    private final AdmissionProbe admission;
    private final String providerRef;
    private final boolean providerTermsVerified;
    private final OwnerBoundExecutor ownerBound;
    private final SensitiveDataDetector sensitiveDataDetector;

    public OwnerGatedSafetyClassifier(
            SafetyClassifierPort delegate,
            ConsentProbe consents,
            DeletionIntentProbe deletionIntents,
            AdmissionProbe admission,
            String providerRef,
            boolean providerTermsVerified) {
        this(delegate, consents, deletionIntents, admission, providerRef,
                providerTermsVerified, null, new SensitiveDataDetector());
    }

    public OwnerGatedSafetyClassifier(
            SafetyClassifierPort delegate,
            ConsentProbe consents,
            DeletionIntentProbe deletionIntents,
            AdmissionProbe admission,
            String providerRef,
            boolean providerTermsVerified,
            OwnerBoundExecutor ownerBound) {
        this(delegate, consents, deletionIntents, admission, providerRef,
                providerTermsVerified, ownerBound, new SensitiveDataDetector());
    }

    public OwnerGatedSafetyClassifier(
            SafetyClassifierPort delegate,
            ConsentProbe consents,
            DeletionIntentProbe deletionIntents,
            AdmissionProbe admission,
            String providerRef,
            boolean providerTermsVerified,
            OwnerBoundExecutor ownerBound,
            SensitiveDataDetector sensitiveDataDetector) {
        this.delegate = Objects.requireNonNull(delegate, "delegate must not be null");
        this.consents = Objects.requireNonNull(consents, "consents must not be null");
        this.deletionIntents = Objects.requireNonNull(
                deletionIntents, "deletionIntents must not be null");
        this.admission = Objects.requireNonNull(admission, "admission must not be null");
        this.providerRef = Objects.requireNonNull(providerRef, "providerRef must not be null");
        this.providerTermsVerified = providerTermsVerified;
        this.ownerBound = ownerBound;
        this.sensitiveDataDetector = Objects.requireNonNull(
                sensitiveDataDetector, "sensitiveDataDetector must not be null");
    }

    @Override
    public SafetyClassification classify(SafetyStage stage, String text) {
        throw new IllegalStateException(
                "remote safety classification requires an owner-bound egress gate");
    }

    @Override
    public SafetyClassification classify(long ownerUserId, SafetyStage stage, String text) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        // Phase 1 — short INDEPENDENT owner-bound authorization read (DB
        // only, no HTTP): one REQUIRES_NEW transaction covering the deletion
        // intent, every required consent and the provider admission. Any read
        // failure throws — and rolls back — INSIDE that short transaction,
        // never the caller's outer one, so the composite fails closed with
        // zero remote calls and the caller's terminal write still commits.
        readEgressPermit(ownerUserId);
        // Phase 2 — DB-free HTTP phase with every database transaction
        // suspended: the remote call never extends the request transaction
        // (defect C) and all remaining gates below are pure.
        if (!providerTermsVerified) {
            List<String> sensitiveCategories = sensitiveDataDetector.detect(text);
            if (!sensitiveCategories.isEmpty()) {
                // Categories only — matched content never reaches the message.
                throw new IllegalStateException(
                        "unverified provider terms allow only text free of sensitive data "
                                + "(matched categories: " + sensitiveCategories + ")");
            }
        }
        if (ownerBound == null) {
            // No executor wired (plain web/test construction): run directly.
            return delegate.classify(stage, text);
        }
        final SafetyClassification[] result = new SafetyClassification[1];
        ownerBound.withoutTransaction(() -> result[0] = delegate.classify(stage, text));
        return result[0];
    }

    private void readEgressPermit(long ownerUserId) {
        if (ownerBound != null) {
            ownerBound.asOwnerIndependent(ownerUserId, () -> checkProbes(ownerUserId));
        } else {
            checkProbes(ownerUserId);
        }
    }

    private void checkProbes(long ownerUserId) {
        if (deletionIntents.active(ownerUserId)) {
            throw new IllegalStateException("owner deletion intent blocks remote classification");
        }
        for (String consentType : REQUIRED_CONSENTS) {
            if (!consents.granted(ownerUserId, consentType)) {
                throw new IllegalStateException(
                        "remote classification consent is not granted: " + consentType);
            }
        }
        if (!admission.admitted(providerRef)) {
            throw new IllegalStateException(
                    "moderation provider is not currently admitted");
        }
    }
}
