package com.virtualcompanion.safety;

import com.virtualcompanion.catalog.RiskLevel;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * Deterministic safety classifier (SAFETY-WIRE, Technical Alpha).
 *
 * <p>A small, fixed, high-precision rule set runs locally — no provider, no
 * I/O, no config drift (§21.3.5: 模型故障时仍可触发的本地安全规则). Hits are
 * hard rules for {@link SafetyGate}: a hit always blocks, and a miss yields a
 * CLASSIFIED report at full confidence, which the gate allows. Every rule is
 * grounded in the requirements: input rules detect user-expressed imminent
 * self-harm (§20.2 R4/R3), output rules detect the assistant claiming to be a
 * real human (§21.3.1, AI 身份透明). The rule set is deliberately tiny —
 * recall is the real provider classifier's job (later round); these rules
 * only guarantee the deterministic floor never depends on a model.
 *
 * <p>Matching is case-insensitive (ASCII fold); Chinese phrases match as
 * exact substrings. False positives block a turn with a fixed notice, never
 * endanger anyone; false negatives fall through to the (future) model
 * classifier and the final review backstop.
 */
public final class DeterministicSafetyClassifier implements SafetyClassifierPort {

    /** One deterministic rule: id, applicable stage, risk level, phrases. */
    private record Rule(String id, SafetyStage stage, RiskLevel risk, List<String> phrases) {
    }

    private static final List<Rule> RULES = List.of(
            // §20.2 R4_IMMINENT — explicit imminent self-harm in the caller's message.
            new Rule("input-imminent-self-harm", SafetyStage.INPUT, RiskLevel.R4_IMMINENT,
                    List.of("自杀", "轻生", "不想活", "结束自己的生命", "结束我自己的生命",
                            "kill myself", "commit suicide", "end my life")),
            // §20.2 R3_HIGH — self-harm intent without an explicit imminent act.
            new Rule("input-self-harm", SafetyStage.INPUT, RiskLevel.R3_HIGH,
                    List.of("自残", "伤害自己", "想死", "self-harm", "hurt myself")),
            // §21.3.1 — the assistant must never claim to be a real human.
            new Rule("output-ai-identity-human-claim", SafetyStage.OUTPUT, RiskLevel.R3_HIGH,
                    List.of("我是真人", "我不是ai", "我不是人工智能", "我是一个真实的人",
                            "i am a human", "i am not an ai", "i'm not an ai")));

    /** Deterministic classification is always CLASSIFIED at full confidence. */
    private static final ClassifierReport DETERMINISTIC_REPORT =
            new ClassifierReport(
                    com.virtualcompanion.catalog.SafetyClassifierOutcome.CLASSIFIED, 1.0);

    @Override
    public SafetyClassification classify(SafetyStage stage, String text) {
        Objects.requireNonNull(stage, "stage must not be null");
        Objects.requireNonNull(text, "text must not be null");
        String haystack = text.toLowerCase(Locale.ROOT);
        List<String> violations = new ArrayList<>();
        RiskLevel risk = RiskLevel.R0_NORMAL;
        for (Rule rule : RULES) {
            if (rule.stage() != stage) {
                continue;
            }
            for (String phrase : rule.phrases()) {
                if (haystack.contains(phrase.toLowerCase(Locale.ROOT))) {
                    violations.add(rule.id());
                    if (rule.risk().ordinal() > risk.ordinal()) {
                        risk = rule.risk();
                    }
                    break;
                }
            }
        }
        // SafetyGate: a hard-rule hit blocks; a clean deterministic pass allows.
        SafetyVerdict verdict = SafetyGate.evaluate(violations, DETERMINISTIC_REPORT);
        return new SafetyClassification(risk, List.copyOf(violations), DETERMINISTIC_REPORT, verdict);
    }
}
