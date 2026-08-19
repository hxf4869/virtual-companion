package com.virtualcompanion.runtime.memory;

import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * MEM-AUTO-SAVE (§7.4): the deterministic low-sensitivity auto-save rule.
 *
 * <p>A user statement is auto-saved (PROPOSED→ACCEPTED, §11.10 低敏自动规则)
 * only when it is a SHORT statement matching one of the FIXED whitelist
 * categories — a nickname/address preference, a food/drink preference or a
 * sleep-schedule preference — and it carries NO sensitive lexicon hit
 * (§7.3 不自动保存健康、家庭、财务、创伤等敏感记忆). There is no model
 * judgement anywhere on this path (§11.8): a whitelist hit IS the
 * high-confidence signal, and every miss falls back to the ordinary
 * PENDING_CONFIRMATION candidate.
 *
 * <p>The categories and screens are deliberately narrow; when a real
 * extraction model arrives, its candidates keep flowing through the
 * confirmation queue and this rule stays the only auto path.
 */
public final class DeterministicMemoryAutoSaveRule {

    /** Auto-save only short factual statements (高置信短句). */
    static final int MAX_MESSAGE_CHARS = 60;

    /**
     * Sensitive screen (健康/家庭/财务/创伤 lexicon, plus identity/credential
     * terms). Any hit disables auto-save for the whole statement.
     */
    private static final List<String> SENSITIVE_LEXICON = List.of(
            "爸", "妈", "爹", "娘", "哥", "姐", "弟", "妹", "老公", "老婆", "丈夫",
            "妻子", "孩子", "儿子", "女儿", "家人", "家庭", "家暴",
            "病", "医院", "医生", "药", "诊断", "症", "抑郁", "焦虑", "自杀",
            "自残", "伤", "死", "创伤", "暴力",
            "钱", "工资", "薪", "奖金", "债", "贷款", "存款", "穷", "富",
            "密码", "身份证", "银行卡");

    /** 称呼偏好: 叫我/喊我/称呼我 + a short name. */
    private static final Pattern NICKNAME =
            Pattern.compile("(以后)?(请)?(就)?(叫我|喊我|称呼我)([^，。！？!?,.\\s]{1,16})");

    /** 口味偏好: (喜欢|爱|偏好)(吃|喝)X 或 (不|不爱)(吃|喝)X. */
    private static final Pattern FOOD_DRINK = Pattern.compile(
            "((?:喜欢|爱|偏好)(?:吃|喝)|(?:不爱|不|别)(?:吃|喝))([^，。！？!?,.\\s]{1,20})");

    /** 作息偏好: explicit schedule verbs. */
    private static final Pattern SLEEP_SCHEDULE =
            Pattern.compile("(早睡|晚睡|早起|晚起|习惯熬夜)");

    /** One rule hit: the fixed category and the normalized canonical summary. */
    public record AutoSavedMemory(String category, String summary) {
    }

    private DeterministicMemoryAutoSaveRule() {
    }

    /**
     * Evaluate one user statement. Empty means: not auto-savable — route to
     * the ordinary PENDING_CONFIRMATION candidate.
     */
    public static Optional<AutoSavedMemory> evaluate(String message) {
        if (message == null) {
            return Optional.empty();
        }
        String trimmed = message.trim();
        if (trimmed.isEmpty() || trimmed.length() > MAX_MESSAGE_CHARS) {
            return Optional.empty();
        }
        for (String sensitive : SENSITIVE_LEXICON) {
            if (trimmed.contains(sensitive)) {
                return Optional.empty();
            }
        }
        Matcher nickname = NICKNAME.matcher(trimmed);
        if (nickname.find()) {
            return Optional.of(new AutoSavedMemory(
                    "NICKNAME", "称呼偏好：" + nickname.group(5)));
        }
        Matcher food = FOOD_DRINK.matcher(trimmed);
        if (food.find()) {
            return Optional.of(new AutoSavedMemory(
                    "FOOD_DRINK", "口味偏好：" + food.group(1) + food.group(2)));
        }
        Matcher sleep = SLEEP_SCHEDULE.matcher(trimmed);
        if (sleep.find()) {
            return Optional.of(new AutoSavedMemory(
                    "SLEEP_SCHEDULE", "作息偏好：" + sleep.group(1)));
        }
        return Optional.empty();
    }
}
