package com.virtualcompanion.safety;

import com.virtualcompanion.catalog.RiskLevel;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Deterministic safety classifier (SAFETY-WIRE + SAFETY-RULES-2, Technical Alpha).
 *
 * <p>A small, fixed, high-precision rule set runs locally — no provider, no
 * I/O, no config drift (§21.3.5: 模型故障时仍可触发的本地安全规则). Hits are
 * hard rules for {@link SafetyGate}: a hit always blocks, and a miss yields a
 * CLASSIFIED report at full confidence, which the gate allows. Every rule is
 * grounded in the requirements:
 *
 * <ul>
 * <li>input — user-expressed imminent self-harm (§20.2 R4/R3);
 * <li>input — minor self-claim (§20.9: identified minors must not proceed);
 * <li>input — active-fraud markers and pasted verification codes
 *     (§20.10 诈骗和重大财产损失);
 * <li>input — third-party privacy doxxing requests (§20.10 隐私套取);
 * <li>output — the assistant claiming to be a real human (§21.3.1);
 * <li>output — exclusivity / dependency-inducing talk and exit obstruction
 *     (§21.3.2, §21.3.4);
 * <li>output — medical-treatment override (§20.10 高风险建议, R3);
 * <li>output — all-in / leveraged financial directives (§20.10);
 * <li>output — soliciting identifiers, passwords or verification codes
 *     (§20.11 隐私套取, R3).
 * </ul>
 *
 * <p>The rule set is deliberately tiny and precision-first (宁缺毋滥):
 * recall-oriented categories (色情、暴力、仇恨、Prompt Injection、语义冲突…)
 * stay with the future provider classifier; these rules only guarantee the
 * deterministic floor never depends on a model. False positives block a turn
 * with a fixed notice, never endanger anyone; false negatives fall through to
 * the (future) model classifier and the final-review backstop. Regex rules
 * carry negation guards so safety-positive refusals ("不要把身份证号发给我")
 * never trip.
 *
 * <p>Matching is case-insensitive (ASCII fold); Chinese phrases match as
 * exact substrings. One violation is recorded per rule even if several of its
 * phrases match; the highest tripping risk level wins.
 */
public final class DeterministicSafetyClassifier implements SafetyClassifierPort {

    /**
     * One deterministic rule: id, applicable stage, risk level, phrase list
     * and an optional compiled regex (both matched case-insensitively against
     * the lowercased text).
     */
    private record Rule(String id, SafetyStage stage, RiskLevel risk, List<String> phrases, Pattern regex) {
        Rule(String id, SafetyStage stage, RiskLevel risk, List<String> phrases) {
            this(id, stage, risk, phrases, null);
        }
    }

    /**
     * Minor self-claim (§20.9): 我 + optional time/adverb + age 1..17 in digits
     * or Chinese numerals + 岁 closing at a sentence boundary. The lookahead
     * keeps possessive and remembrance forms out ("我9岁的女儿",
     * "我9岁开始学琴"); 18+ never matches.
     */
    private static final Pattern MINOR_AGE = Pattern.compile(
            "我(今年|现在|才|只有)?(1[0-7]|[1-9]|十[一二三四五六七]?|[一两二三四五六七八九])岁"
                    + "(?=了|[，。,.!！?？;；]|$)");

    /** A verification code pasted into the chat (live account-takeover risk). */
    private static final Pattern PASTED_CODE = Pattern.compile("验证码[是为:：]?\\d{3,8}");

    /**
     * Output-side solicitation of credentials with negation guards: refusing
     * forms ("不要把…发给我", "请别告诉我你的密码", "don't send me your
     * password") are correct assistant behaviour and must never trip.
     */
    private static final Pattern SOLICIT = Pattern.compile(
            "(?<!(不要|别|请别|请勿|千万别|请不要|不应|不能))"
                    + "((把|将)(你的)?(身份证号|银行卡号|信用卡号|验证码|密码)发给我"
                    + "|告诉我你的?(身份证号|银行卡号|信用卡号|验证码|密码))"
                    + "|(?<!(don't |dont |do not |never ))"
                    + "(send me your (password|id number)"
                    + "|tell me your (password|verification code)"
                    + "|send me the verification code)");

    private static final List<Rule> RULES = List.of(
            // §20.2 R4_IMMINENT — explicit imminent self-harm in the caller's message.
            new Rule("input-imminent-self-harm", SafetyStage.INPUT, RiskLevel.R4_IMMINENT,
                    List.of("自杀", "轻生", "不想活", "结束自己的生命", "结束我自己的生命",
                            "kill myself", "commit suicide", "end my life")),
            // §20.2 R3_HIGH — self-harm intent without an explicit imminent act.
            new Rule("input-self-harm", SafetyStage.INPUT, RiskLevel.R3_HIGH,
                    List.of("自残", "伤害自己", "想死", "self-harm", "hurt myself")),
            // §20.9 — a self-declared minor must not proceed to companion chat.
            new Rule("input-minor-self-claim", SafetyStage.INPUT, RiskLevel.R3_HIGH,
                    List.of("我未成年", "我是未成年人", "我还没成年", "我未满18", "我未满十八",
                            "我不满18", "我不满十八", "我不到18", "我不到十八"),
                    MINOR_AGE),
            // §20.10 — classic live-fraud markers and a pasted verification code.
            new Rule("input-active-fraud-risk", SafetyStage.INPUT, RiskLevel.R2_ELEVATED,
                    List.of("安全账户", "解冻费", "保证金才能提现", "先交税才能提现",
                            "带单老师", "跟着内幕消息买"),
                    PASTED_CODE),
            // §20.10 — doxxing / third-party identifier lookups.
            new Rule("input-privacy-doxxing", SafetyStage.INPUT, RiskLevel.R2_ELEVATED,
                    List.of("人肉搜索", "帮我人肉", "人肉他", "人肉她", "查开房记录",
                            "帮我查身份证号", "查他的身份证号", "查她的身份证号")),
            // §21.3.1 — the assistant must never claim to be a real human.
            new Rule("output-ai-identity-human-claim", SafetyStage.OUTPUT, RiskLevel.R3_HIGH,
                    List.of("我是真人", "我不是ai", "我不是人工智能", "我是一个真实的人",
                            "i am a human", "i am not an ai", "i'm not an ai")),
            // §21.3.2 — exclusivity / dependency-inducing talk is forbidden.
            new Rule("output-dependency-exclusivity", SafetyStage.OUTPUT, RiskLevel.R2_ELEVATED,
                    List.of("有我就够了", "有我一个人就够了", "你只需要我一个", "只需要我陪你就够了",
                            "只有我才懂你", "我是你唯一", "别人都不会懂你", "没有人会懂你",
                            "别和别人说", "不要联系别人", "把我当成你的全世界",
                            "you only need me", "i'm the only one who understands you",
                            "no one else will ever understand you", "don't tell anyone else about us")),
            // §21.3.4 — the assistant must never obstruct the user's exit.
            new Rule("output-exit-obstruction", SafetyStage.OUTPUT, RiskLevel.R2_ELEVATED,
                    List.of("我不让你走", "我不许你走", "你不准走", "别丢下我", "你走了我就消失",
                            "没有你我会崩溃", "没有你我活不下去", "求求你别走", "不要离开我好不好",
                            "i won't let you go", "i can't live without you")),
            // §20.10 — overriding medical treatment is high-risk advice (R3).
            new Rule("output-medical-override", SafetyStage.OUTPUT, RiskLevel.R3_HIGH,
                    List.of("别听医生的", "医生都是骗人的", "医生都在骗你", "医院就是骗钱",
                            "把药都停了吧", "把药扔了吧", "药别吃了", "停药吧",
                            "不需要任何治疗", "不用接受治疗")),
            // §20.10 — all-in / leveraged financial directives (directive-form
            // suffixes keep negated advice "别把存款都投进去" from tripping).
            new Rule("output-financial-overreach", SafetyStage.OUTPUT, RiskLevel.R2_ELEVATED,
                    List.of("借钱来投资吧", "借钱炒股吧", "借钱炒币吧", "放心加杠杆",
                            "闭着眼睛买入吧", "梭哈全部积蓄", "把积蓄都拿去炒")),
            // §20.11 — soliciting identifiers, passwords or verification codes.
            new Rule("output-privacy-solicitation", SafetyStage.OUTPUT, RiskLevel.R3_HIGH,
                    List.of("你的密码是多少", "你的验证码是多少", "身份证号是多少", "银行卡号是多少"),
                    SOLICIT));

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
            boolean hit = false;
            for (String phrase : rule.phrases()) {
                if (haystack.contains(phrase.toLowerCase(Locale.ROOT))) {
                    hit = true;
                    break;
                }
            }
            if (!hit && rule.regex() != null && rule.regex().matcher(haystack).find()) {
                hit = true;
            }
            if (hit) {
                violations.add(rule.id());
                if (rule.risk().ordinal() > risk.ordinal()) {
                    risk = rule.risk();
                }
            }
        }
        // SafetyGate: a hard-rule hit blocks; a clean deterministic pass allows.
        SafetyVerdict verdict = SafetyGate.evaluate(violations, DETERMINISTIC_REPORT);
        return new SafetyClassification(risk, List.copyOf(violations), DETERMINISTIC_REPORT, verdict);
    }
}
