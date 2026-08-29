package com.virtualcompanion.runtime.safety;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.RiskLevel;
import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import com.virtualcompanion.safety.ClassifierReport;
import com.virtualcompanion.safety.SafetyClassification;
import com.virtualcompanion.safety.SafetyClassifierPort;
import com.virtualcompanion.safety.SafetyStage;
import com.virtualcompanion.safety.SafetyVerdict;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/**
 * Java runtime until Go safety/generation cutover (ADR-0006 §5): every gate
 * condition must pass BEFORE the remote leg is reached; each deny path is
 * proven by a counting delegate — zero remote calls on every deny or read
 * failure.
 *
 * <p>Go v1 (ADR-0007 / safety-fail-closed-contract goV1): remote classifier is
 * DEFER. Input, rolling and final review use one local LocalSafetyPolicy and
 * must not make network calls. These assertions document current Java behaviour.
 *
 * <p>DOGFOOD-STABILIZATION-02: the consent/deletion/admission probe phase
 * runs inside one short owner-bound transaction (the worker's FINAL call is
 * outside any owner transaction); the HTTP phase must stay outside it.</p>
 */
class OwnerGatedSafetyClassifierTest {

    private static final SafetyClassification CLEAN = new SafetyClassification(
            RiskLevel.R0_NORMAL,
            List.of(),
            new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.99),
            SafetyVerdict.ALLOW);

    private final AtomicInteger delegateCalls = new AtomicInteger();

    /** All-pass probes by default; individual tests flip one to deny. */
    private boolean consentGranted = true;
    private boolean deletionActive = false;
    private boolean admitted = true;

    /**
     * Mirrors the real GUC-enforced SD functions: a probe called outside the
     * owner-bound transaction throws (V17/V27 "must match server-trusted
     * context"), so a gate that forgets the executor fails these tests.
     */
    private static final ThreadLocal<Boolean> IN_OWNER_CONTEXT =
            ThreadLocal.withInitial(() -> Boolean.FALSE);

    private OwnerGatedSafetyClassifier.ConsentProbe plainConsent() {
        return (ownerUserId, consentType) -> consentGranted;
    }

    private OwnerGatedSafetyClassifier.DeletionIntentProbe plainDeletion() {
        return ownerUserId -> deletionActive;
    }

    private OwnerGatedSafetyClassifier.AdmissionProbe plainAdmission() {
        return providerRef -> admitted;
    }

    private OwnerGatedSafetyClassifier.ConsentProbe strictConsent() {
        return (ownerUserId, consentType) -> {
            assertTrue(IN_OWNER_CONTEXT.get(),
                    "consent must be read inside the owner-bound transaction");
            return consentGranted;
        };
    }

    private OwnerGatedSafetyClassifier.DeletionIntentProbe strictDeletion() {
        return ownerUserId -> {
            assertTrue(IN_OWNER_CONTEXT.get(),
                    "deletion intent must be read inside the owner-bound transaction");
            return deletionActive;
        };
    }

    private OwnerGatedSafetyClassifier.AdmissionProbe strictAdmission() {
        return providerRef -> {
            assertTrue(IN_OWNER_CONTEXT.get(),
                    "admission must be read inside the owner-bound transaction");
            return admitted;
        };
    }

    private SafetyClassifierPort delegatePort() {
        return (stage, text) -> {
            delegateCalls.incrementAndGet();
            assertFalse(IN_OWNER_CONTEXT.get(),
                    "the HTTP phase must run outside the owner-bound transaction");
            return CLEAN;
        };
    }

    private SafetyClassifierPort gate(boolean termsVerified) {
        return new OwnerGatedSafetyClassifier(
                delegatePort(),
                plainConsent(),
                plainDeletion(),
                plainAdmission(),
                "weixin-channel",
                termsVerified);
    }

    /** Gate whose probe phase runs inside the worker-style executor. */
    private SafetyClassifierPort gateWithOwnerExecutor(boolean termsVerified) {
        return new OwnerGatedSafetyClassifier(
                delegatePort(),
                strictConsent(),
                strictDeletion(),
                strictAdmission(),
                "weixin-channel",
                termsVerified,
                (ownerUserId, work) -> {
                    assertTrue(ownerUserId > 0);
                    IN_OWNER_CONTEXT.set(Boolean.TRUE);
                    try {
                        work.run();
                    } finally {
                        IN_OWNER_CONTEXT.set(Boolean.FALSE);
                    }
                });
    }

    @Test
    void allChecksPassDelegatesExactlyOnce() {
        SafetyClassification result = gate(false)
                .classify(9L, SafetyStage.INPUT, "今天天气不错");
        assertEquals(SafetyVerdict.ALLOW, result.verdict());
        assertEquals(1, delegateCalls.get());
    }

    @Test
    void ownerlessEntryIsUnusable() {
        assertThrows(IllegalStateException.class,
                () -> gate(false).classify(SafetyStage.INPUT, "今天天气不错"));
        assertEquals(0, delegateCalls.get());
    }

    @Test
    void nonPositiveOwnerFailsClosed() {
        assertThrows(IllegalArgumentException.class,
                () -> gate(false).classify(0L, SafetyStage.INPUT, "今天天气不错"));
        assertEquals(0, delegateCalls.get());
    }

    @Test
    void activeDeletionIntentBlocksTheRemoteLeg() {
        deletionActive = true;
        assertThrows(IllegalStateException.class,
                () -> gateWithOwnerExecutor(false)
                        .classify(9L, SafetyStage.INPUT, "今天天气不错"));
        assertEquals(0, delegateCalls.get());
    }

    @Test
    void missingNecessaryConsentBlocksTheRemoteLeg() {
        // The five-type set is checked per call; one missing type denies with
        // zero remote calls (a read failure propagates the same way because
        // the probe throws).
        consentGranted = false;
        assertThrows(IllegalStateException.class,
                () -> gateWithOwnerExecutor(false)
                        .classify(9L, SafetyStage.INPUT, "今天天气不错"));
        assertEquals(0, delegateCalls.get());
    }

    @Test
    void nonAdmittedProviderBlocksTheRemoteLeg() {
        admitted = false;
        assertThrows(IllegalStateException.class,
                () -> gateWithOwnerExecutor(false)
                        .classify(9L, SafetyStage.INPUT, "今天天气不错"));
        assertEquals(0, delegateCalls.get());
    }

    @Test
    void probePhaseRunsInsideTheOwnerBoundTransactionOutsideWorkerTx() {
        // The worker calls the FINAL classification with NO owner context
        // installed; the gate must open its own short owner-bound transaction
        // for the probes and only then run the DB-free HTTP phase.
        assertFalse(IN_OWNER_CONTEXT.get());
        SafetyClassification result = gateWithOwnerExecutor(false)
                .classify(9L, SafetyStage.OUTPUT, "这是一段干净的输出");
        assertEquals(SafetyVerdict.ALLOW, result.verdict());
        assertEquals(1, delegateCalls.get());
        assertFalse(IN_OWNER_CONTEXT.get());
    }

    @Test
    void unverifiedTermsBlockSensitiveDataFromLeavingTheHost() {
        // DOGFOOD-STABILIZATION-02: the local sensitive gate is the PII
        // detector, NOT the deterministic safety classifier — ordinary
        // personal data has no hard rule yet must not egress while the
        // provider terms are unverified.
        for (String sensitive : new String[] {
                "我的手机号 13800138000，有事打给我",
                "身份证号 11010519491231002X，核对一下",
                "卡号 6222 0202 0000 1234 562，明天扣款",
                "发到 someone@example.com 就行",
                "我家在北京市海淀区中关村大街27号",
                "api_key: sk-abc123def456ghi789jkl012"}) {
            IllegalStateException denied = assertThrows(IllegalStateException.class,
                    () -> gate(false).classify(9L, SafetyStage.INPUT, sensitive),
                    "must deny: " + redact(sensitive));
            assertFalse(denied.getMessage().contains("13800138000"));
            assertFalse(denied.getMessage().contains("someone@example.com"));
            assertEquals(0, delegateCalls.get());
        }
    }

    @Test
    void verifiedTermsDelegateSensitiveText() {
        // With verified terms (plus the SENSITIVE_DATA_PROCESSING consent the
        // five-type set already requires) the detector no longer applies.
        SafetyClassification result = gate(true)
                .classify(9L, SafetyStage.INPUT, "我的手机号 13800138000");
        assertEquals(SafetyVerdict.ALLOW, result.verdict());
        assertEquals(1, delegateCalls.get());
    }

    @Test
    void ordinaryNonSensitiveTextFlowsWhileTermsAreUnverified() {
        for (String plain : new String[] {
                "今天天气不错",
                "我现在11岁", // hard-rule text: the composite blocks it, not this gate
                "帮我写一首关于春天的诗",
                "订单号 20260824-001 已经发货了吗"}) {
            assertDoesNotThrow(
                    () -> gate(false).classify(9L, SafetyStage.INPUT, plain),
                    "must not deny: " + plain);
            assertEquals(1, delegateCalls.get());
            delegateCalls.set(0);
        }
    }

    @Test
    void gateReadFailureFailsClosedWithZeroRemoteCalls() {
        OwnerGatedSafetyClassifier failingReads = new OwnerGatedSafetyClassifier(
                (stage, text) -> {
                    delegateCalls.incrementAndGet();
                    return CLEAN;
                },
                (ownerUserId, consentType) -> {
                    throw new IllegalStateException("consent store unreadable");
                },
                ownerUserId -> false,
                providerRef -> true,
                "weixin-channel",
                true);
        assertThrows(IllegalStateException.class,
                () -> failingReads.classify(9L, SafetyStage.INPUT, "今天天气不错"));
        assertEquals(0, delegateCalls.get());
    }

    @Test
    void requiredConsentSetMatchesTheAdrFiveTypes() {
        assertEquals(
                List.of(
                        "SERVICE_TERMS",
                        "PRIVACY_POLICY",
                        "AI_CONTENT_NOTICE",
                        "THIRD_PARTY_MODEL_PROCESSING",
                        "SENSITIVE_DATA_PROCESSING"),
                OwnerGatedSafetyClassifier.REQUIRED_CONSENTS);
    }

    /** Category-level redaction for assertion messages (never the sample). */
    private static String redact(String sample) {
        return sample.replaceAll("[0-9a-zA-Z@.]{4,}", "…");
    }
}
