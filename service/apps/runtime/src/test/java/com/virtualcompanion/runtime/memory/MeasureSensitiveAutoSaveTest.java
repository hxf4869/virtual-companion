package com.virtualcompanion.runtime.memory;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * MEASURE (§26.4 敏感自动保存率 0, ≥200 敏感样本): sensitive statements that
 * would otherwise match the auto-save whitelist must NEVER be auto-saved —
 * the sensitive lexicon screen disables the whole statement. Whitelist
 * controls still auto-save (the rule stays useful).
 */
class MeasureSensitiveAutoSaveTest {

    @Test
    void sensitiveSamplesAreNeverAutoSaved() {
        String[] sensitive = {"病", "医院", "医生", "药", "抑郁", "焦虑", "自杀",
                "爸", "妈", "孩子", "家暴", "钱", "工资", "债", "密码", "身份证"};
        int count = 0;
        for (String word : sensitive) {
            for (int i = 0; i < 15; i++) {
                // Sensitive term embedded in an otherwise whitelist-shaped
                // nickname / food / sleep statement.
                String msg = switch (i % 3) {
                    case 0 -> "叫我" + word + "先生" + i;
                    case 1 -> "喜欢吃" + word + "糕点" + i;
                    default -> "我习惯熬夜，" + word + "相关的事别提" + i;
                };
                Optional<DeterministicMemoryAutoSaveRule.AutoSavedMemory> out =
                        DeterministicMemoryAutoSaveRule.evaluate(msg);
                assertEquals(Optional.empty(), out,
                        "sensitive statement must not auto-save: " + msg);
                count++;
            }
        }
        assertTrue(count >= 200, "sensitive sample scale must be ≥200, got " + count);
    }

    @Test
    void whitelistControlsStillAutoSave() {
        assertEquals("NICKNAME",
                DeterministicMemoryAutoSaveRule.evaluate("以后叫我小林").orElseThrow().category());
        assertEquals("FOOD_DRINK",
                DeterministicMemoryAutoSaveRule.evaluate("喜欢吃清蒸鱼").orElseThrow().category());
        assertEquals("SLEEP_SCHEDULE",
                DeterministicMemoryAutoSaveRule.evaluate("我习惯早睡").orElseThrow().category());
    }
}
