package com.virtualcompanion.runtime.memory;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * MEM-AUTO-SAVE (§7.4): the deterministic whitelist rule — only the fixed
 * low-sensitivity categories auto-save, the sensitive lexicon vetoes
 * everything (不自动保存健康、家庭、财务、创伤等敏感记忆), and long or
 * unmatched statements fall back to the confirmation queue.
 */
class DeterministicMemoryAutoSaveRuleTest {

    @Test
    void nicknameHitNormalizesThePreferredName() {
        Optional<DeterministicMemoryAutoSaveRule.AutoSavedMemory> hit =
                DeterministicMemoryAutoSaveRule.evaluate("以后请叫我小雪");
        assertTrue(hit.isPresent());
        assertEquals("NICKNAME", hit.get().category());
        assertEquals("称呼偏好：小雪", hit.get().summary());
    }

    @Test
    void foodAndSleepHitsNormalizeTheirCategories() {
        assertEquals("口味偏好：喜欢吃辣",
                DeterministicMemoryAutoSaveRule.evaluate("我喜欢吃辣").orElseThrow().summary());
        assertEquals("口味偏好：不喝咖啡",
                DeterministicMemoryAutoSaveRule.evaluate("我不喝咖啡").orElseThrow().summary());
        assertEquals("作息偏好：早睡",
                DeterministicMemoryAutoSaveRule.evaluate("我平时早睡").orElseThrow().summary());
    }

    @Test
    void sensitiveLexiconVetoesEvenAWhitelistShape() {
        // 家人/健康/财务/创伤类词命中即永不自动保存（退回确认队列）。
        assertTrue(DeterministicMemoryAutoSaveRule
                .evaluate("请叫我姐姐").isEmpty());
        assertTrue(DeterministicMemoryAutoSaveRule
                .evaluate("我爱吃妈妈做的菜").isEmpty());
        assertTrue(DeterministicMemoryAutoSaveRule
                .evaluate("我不吃药").isEmpty());
        assertTrue(DeterministicMemoryAutoSaveRule
                .evaluate("我喜欢吃辣但最近工资不高").isEmpty());
    }

    @Test
    void longOrUnmatchedStatementsFallBackToTheQueue() {
        assertTrue(DeterministicMemoryAutoSaveRule
                .evaluate("叫我" + "雪".repeat(60)).isEmpty());
        assertTrue(DeterministicMemoryAutoSaveRule
                .evaluate("今天开会聊了很多事情，进展不错").isEmpty());
        assertTrue(DeterministicMemoryAutoSaveRule.evaluate("  ").isEmpty());
        assertTrue(DeterministicMemoryAutoSaveRule.evaluate(null).isEmpty());
    }
}
