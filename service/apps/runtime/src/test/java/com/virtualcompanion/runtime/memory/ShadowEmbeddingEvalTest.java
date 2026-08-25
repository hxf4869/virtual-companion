package com.virtualcompanion.runtime.memory;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * DOGFOOD-06 / ADR-0006 §6.2 影子评测：本机 Ollama
 * {@code qwen3-embedding:0.6b} 与现有确定性 64 维 floor 的合成样本对比。
 *
 * <p>结构边界（ADR §6.3）：全部样本合成内联、纯内存余弦计算——绝不调用
 * {@code upsertEmbedding}/{@code semantic_recall} 或任何持久化路径；两个
 * 向量空间互不写入，默认 {@link EmbeddingPort} 不变。断言只确认"评测已
 * 执行且指标可计算"，不设通过阈值（ADR 明确本轮不据此外发质量结论）。
 *
 * <p>默认 CI 不跑：需要 {@code VC_SHADOW_EVAL=1}。Ollama 端点与模型可经
 * {@code VC_SHADOW_EVAL_OLLAMA_BASE}（默认 {@code http://localhost:11434/v1}）
 * 与 {@code VC_SHADOW_EVAL_OLLAMA_MODEL}（默认 {@code qwen3-embedding:0.6b}）
 * 注入；api key 用占位符 {@code "ollama"}（Ollama 不校验）。
 */
@EnabledIfEnvironmentVariable(named = "VC_SHADOW_EVAL", matches = "1")
class ShadowEmbeddingEvalTest {

    /** 误召回判定的相似度阈值（敏感性三档）。 */
    private static final double[] THRESHOLDS = {0.60, 0.70, 0.80};

    private static final String OLLAMA_BASE = System.getenv()
            .getOrDefault("VC_SHADOW_EVAL_OLLAMA_BASE", "http://localhost:11434/v1");
    private static final String OLLAMA_MODEL = System.getenv()
            .getOrDefault("VC_SHADOW_EVAL_OLLAMA_MODEL", "qwen3-embedding:0.6b");

    // ------------------------------------------------------------------
    // 合成语料（风格参照 scripts/measure/gen_mem_eval_samples.py：昵称/饮食/
    // 作息/宠物/运动/学习等；全部第一人称合成语句，无真实人名或联系方式）。
    // ------------------------------------------------------------------

    /** a) 同义改写组：事实语句 + 查询改写（同义换词/语序变化/口语化）。 */
    private List<Pair> paraphrasePairs() {
        return List.of(
                new Pair("以后请叫我小夏", "我的称呼是小夏"),
                new Pair("我喜欢吃清蒸鱼，不太能吃辣", "我偏爱清蒸鱼，吃不了太辣的菜"),
                new Pair("我每天晚上十一点前睡觉，早上六点半起床", "十一点前入睡、六点半起床是我的日常作息"),
                new Pair("我养了一只叫团子的橘猫", "家里那只橘猫名字叫团子"),
                new Pair("我周末喜欢去公园慢跑五公里", "周六周日我爱到公园跑五公里"),
                new Pair("我在学吉他，已经练了三个月", "吉他我学了三个月了"),
                new Pair("我最喜欢的乐队是星海漫游者", "星海漫游者是我最喜欢的乐队"),
                new Pair("我最近在戒咖啡，改喝大麦茶", "我正在戒掉咖啡，换成喝大麦茶"),
                new Pair("我住在杭州，公司在滨江区", "我家在杭州，上班地点在滨江区"),
                new Pair("我每个月读两本书，偏爱科幻小说", "我每月会读两本科幻类的书"),
                new Pair("我对海鲜过敏，聚餐时要避开虾和蟹", "我海鲜过敏，吃饭时不能碰虾蟹"),
                new Pair("我下班通常坐地铁回家，大概四十分钟", "我通勤靠地铁，回家要花大约四十分钟"),
                new Pair("我在准备十一月的注册会计师考试", "我正在备考十一月的注会考试"),
                new Pair("我最喜欢的季节是秋天，因为不冷不热", "我偏爱秋季，气候凉爽舒适"),
                new Pair("我每周五晚上会和朋友打线上游戏", "周五晚上我常跟朋友联机打游戏"),
                new Pair("我不会开车，出门主要靠公交", "我没学过开车，平时坐公交车出门"),
                new Pair("我特别喜欢吃甜食，最爱芝士蛋糕", "我嗜甜，最喜欢的是芝士蛋糕"),
                new Pair("我最近在装修新房，风格是原木风", "我正在装修新房子，走原木风格"),
                new Pair("我午休时间习惯散步十五分钟", "中午休息时我一般散步一刻钟"),
                new Pair("我的生日在六月初，喜欢低调地过", "我生日在六月头上，不爱张扬地庆祝"),
                new Pair("我上班的公司做在线教育产品", "我所在的公司做在线教育方向的产品"),
                new Pair("我怕黑，睡觉要留一盏小夜灯", "我有点怕黑，晚上睡觉得开个小夜灯"),
                new Pair("我在攒钱，计划明年春天去云南旅行", "我在存钱，打算明年春天到云南旅游"),
                new Pair("我不喝冰的饮品，肠胃受不了", "冰的饮料我不碰，肠胃受不住"));
    }

    /** b) 干扰组：与 a 组同域但不同事实，进入事实库参与 top-k 竞争。 */
    private List<String> distractorFacts() {
        return List.of(
                "我喜欢吃辣火锅，越辣越过瘾",
                "我习惯熬夜到凌晨一点才睡",
                "我养了一只叫豆豆的柯基犬",
                "我在学钢琴，刚报了兴趣班",
                "我每天早上要喝一杯冰美式",
                "我住在成都，公司在高新区",
                "我每个月读四本推理小说",
                "我对花生过敏，不能吃坚果零食",
                "我下班通常骑车回家，大概三十分钟",
                "我周末喜欢在家看纪录片",
                "我准备明年去考驾照",
                "我喜欢吃酸辣粉这类街边小吃");
    }

    /** c) 无匹配查询：明确库外话题，用于误召回/拒绝判定。 */
    private List<String> noMatchQueries() {
        return List.of(
                "量子计算机的纠错原理是什么",
                "昨晚的足球比赛谁赢了",
                "最近股市行情怎么样",
                "怎么在家烤一炉欧包",
                "单反相机的光圈要怎么调",
                "海水鱼缸需要配什么过滤设备",
                "二手车过户要走哪些流程",
                "下届冬奥会举办地是哪座城市");
    }

    /**
     * d) 跨关系组：两个"关系"各 4 条专属事实，同域不同事实（饮食/作息/
     * 宠物/周末），测试仅靠向量能否区分关系归属（模拟关系隔离）。
     */
    private List<RelFact> relationshipFacts() {
        return List.of(
                new RelFact("A", "我喜欢吃日料，尤其是三文鱼刺身"),
                new RelFact("A", "我习惯早上七点起床去晨跑"),
                new RelFact("A", "我养了一只叫雪球的白猫"),
                new RelFact("A", "我周末喜欢去爬山"),
                new RelFact("B", "我喜欢吃意大利面，偏爱番茄肉酱口味"),
                new RelFact("B", "我习惯睡到中午十二点才起"),
                new RelFact("B", "我养了一只叫墨墨的黑猫"),
                new RelFact("B", "我周末喜欢宅家打游戏"));
    }

    /** 指向单一关系的查询（3 条指 A、3 条指 B，各带正确事实）。 */
    private List<RelQuery> relationshipQueries() {
        return List.of(
                new RelQuery("A", "我说过我喜欢的日本料理是什么",
                        "我喜欢吃日料，尤其是三文鱼刺身"),
                new RelQuery("A", "我早上起床后会去跑步对吧",
                        "我习惯早上七点起床去晨跑"),
                new RelQuery("A", "家里那只白色的猫叫什么名字",
                        "我养了一只叫雪球的白猫"),
                new RelQuery("B", "我提过我最喜欢的意面口味是什么",
                        "我喜欢吃意大利面，偏爱番茄肉酱口味"),
                new RelQuery("B", "我周末是不是喜欢宅在家里打游戏",
                        "我周末喜欢宅家打游戏"),
                new RelQuery("B", "我养的那只黑猫叫什么来着",
                        "我养了一只叫墨墨的黑猫"));
    }

    // ------------------------------------------------------------------
    // 评测
    // ------------------------------------------------------------------

    @Test
    void shadowEmbeddingComparison() {
        List<Pair> paraphrase = paraphrasePairs();
        List<String> distractors = distractorFacts();
        List<String> noMatch = noMatchQueries();
        List<RelFact> relFacts = relationshipFacts();
        List<RelQuery> relQueries = relationshipQueries();

        // 语料结构下限（a≥24 对、b≥12、c≥8、d=2 关系各≥4 事实 + 指向单一关系查询）。
        assertTrue(paraphrase.size() >= 24, "paraphrase pairs >= 24");
        assertTrue(distractors.size() >= 12, "distractors >= 12");
        assertTrue(noMatch.size() >= 8, "no-match queries >= 8");
        long relA = relFacts.stream().filter(f -> f.rel().equals("A")).count();
        long relB = relFacts.stream().filter(f -> f.rel().equals("B")).count();
        assertTrue(relA >= 4 && relB >= 4, "per-relationship facts >= 4");
        assertTrue(relQueries.size() >= 4, "relationship-pointing queries >= 4");

        // 事实库 = a 组事实 + b 组干扰 + d 组关系事实（模拟"全部记忆"库）。
        List<String> facts = new ArrayList<>();
        Map<String, String> factRel = new HashMap<>();
        for (Pair p : paraphrase) {
            facts.add(p.fact());
            factRel.put(p.fact(), "shared");
        }
        for (String d : distractors) {
            facts.add(d);
            factRel.put(d, "shared");
        }
        for (RelFact rf : relFacts) {
            facts.add(rf.text());
            factRel.put(rf.text(), rf.rel());
        }

        DeterministicEmbedder deterministic = new DeterministicEmbedder();
        line("ollama base=%s model=%s", OLLAMA_BASE, OLLAMA_MODEL);
        line("probing ollama /v1/embeddings dimensions=64 support ...");
        OpenAiCompatEmbedder ollama = new OpenAiCompatEmbedder(OLLAMA_BASE, OLLAMA_MODEL, "ollama");
        int probed = ollama.embed("维度探测", 64).length;
        boolean dimsSupported = probed == 64;
        int ollamaDim = dimsSupported ? 64 : ollama.embed("维度探测").length;
        line("dimensions=64 probe -> %d (supported=%b); effective dim=%d",
                probed, dimsSupported, ollamaDim);

        EvalMetrics det = evaluate("deterministic-hash-64", facts, factRel,
                paraphrase, noMatch, relFacts, relQueries,
                text -> deterministic.embed(text), false);
        EvalMetrics qwen = evaluate(OLLAMA_MODEL + "(" + ollamaDim + "d)", facts, factRel,
                paraphrase, noMatch, relFacts, relQueries,
                dimsSupported ? text -> ollama.embed(text, 64) : text -> ollama.embed(text),
                true);

        printComparisonTable(det, qwen);

        // 最小断言：评测已执行且指标可计算（不设质量阈值——ADR §6 本轮不外发结论）。
        assertEquals(64, det.dimension(), "deterministic space is 64-d");
        for (EvalMetrics m : List.of(det, qwen)) {
            assertEquals(facts.size(), m.factCount());
            assertTrue(m.dimension() > 0, "dimension computed");
            assertTrue(m.queriesEmbedded() == paraphrase.size() + noMatch.size()
                    + relQueries.size(), "all queries embedded");
            assertUnitInterval(m.recallAt3(), m.label() + " recall@3");
            for (double fr : m.falseRecallAtThreshold()) {
                assertUnitInterval(fr, m.label() + " false-recall");
            }
            assertUnitInterval(m.crossContamination(), m.label() + " cross-contamination");
            assertTrue(Double.isFinite(m.crossSimGap()), "cross-rel sim gap finite");
        }
        line("done: evaluation executed, metrics computable (no quality gate).");
    }

    /** 对一个 embedder 跑全部指标；打印明细，返回可断言的指标集。 */
    private EvalMetrics evaluate(String label, List<String> facts, Map<String, String> factRel,
            List<Pair> paraphrase, List<String> noMatch, List<RelFact> relFacts,
            List<RelQuery> relQueries, Function<String, float[]> embed, boolean remote) {
        Map<String, float[]> cache = new HashMap<>();
        Function<String, float[]> cached = t -> cache.computeIfAbsent(t, embed);
        float[][] factVecs = new float[facts.size()][];
        int dimension = -1;
        for (int i = 0; i < facts.size(); i++) {
            factVecs[i] = cached.apply(facts.get(i));
            assertTrue(factVecs[i].length > 0, "fact vector non-empty");
            if (dimension < 0) {
                dimension = factVecs[i].length;
            }
            assertEquals(dimension, factVecs[i].length, "consistent dimension");
        }

        // 同义改写 Recall@3：查询在全部事实库中余弦 top3 是否含正确事实。
        int hits = 0;
        for (Pair p : paraphrase) {
            double[] sims = similarities(cached.apply(p.query()), factVecs);
            if (containsIndex(top3(sims), facts.indexOf(p.fact()))) {
                hits++;
            }
        }
        double recallAt3 = (double) hits / paraphrase.size();

        // 误召回率：无匹配查询 top1 相似度 >= 阈值的比例（拒绝率 = 1 - 误召回率）。
        double[] falseRecall = new double[THRESHOLDS.length];
        double[] top1s = new double[noMatch.size()];
        for (String q : noMatch) {
            double[] sims = similarities(cached.apply(q), factVecs);
            double top1 = sims[top3(sims)[0]];
            top1s[noMatch.indexOf(q)] = top1;
            for (int t = 0; t < THRESHOLDS.length; t++) {
                if (top1 >= THRESHOLDS[t]) {
                    falseRecall[t] += 1.0 / noMatch.size();
                }
            }
        }
        line("%s no-match top1 sims: %s", label,
                formatSims(top1s));

        // 跨关系隔离：指向关系 A 的查询 top3 中命中关系 B 事实的比例 +
        // 正确/其他关系平均相似度差（对每条查询取本关系 4 条事实的平均余弦
        // 减另一关系 4 条事实的平均余弦，再跨查询平均）。
        int crossHits = 0;
        int top3Slots = 0;
        double relHit = 0;
        double simGapSum = 0.0;
        for (RelQuery rq : relQueries) {
            float[] qv = cached.apply(rq.query());
            double[] sims = similarities(qv, factVecs);
            int[] top = top3(sims);
            top3Slots += top.length;
            if (containsIndex(top, facts.indexOf(rq.targetFact()))) {
                relHit++;
            }
            double ownSum = 0.0;
            double otherSum = 0.0;
            int own = 0;
            int other = 0;
            for (RelFact rf : relFacts) {
                double sim = sims[facts.indexOf(rf.text())];
                if (rf.rel().equals(rq.rel())) {
                    ownSum += sim;
                    own++;
                } else {
                    otherSum += sim;
                    other++;
                }
            }
            simGapSum += ownSum / own - otherSum / other;
            for (int idx : top) {
                String rel = factRel.get(facts.get(idx));
                if (rel != null && !rel.equals("shared") && !rel.equals(rq.rel())) {
                    crossHits++;
                }
            }
        }
        double crossContamination = top3Slots == 0 ? 0.0 : (double) crossHits / top3Slots;
        double crossSimGap = simGapSum / relQueries.size();

        line("%s: dim=%d facts=%d recall@3=%.3f crossContam=%.3f "
                        + "crossSimGap=%+.3f relRecall@3=%.3f",
                label, dimension, facts.size(), recallAt3, crossContamination,
                crossSimGap, relHit / relQueries.size());
        return new EvalMetrics(label, dimension, facts.size(),
                paraphrase.size() + noMatch.size() + relQueries.size(),
                recallAt3, falseRecall, crossContamination, crossSimGap,
                relHit / relQueries.size(), remote);
    }

    private void printComparisonTable(EvalMetrics det, EvalMetrics qwen) {
        line("================= DOGFOOD-06 shadow embedding 对比（合成样本） =================");
        line("%-42s %-24s %s", "metric", det.label(), qwen.label());
        line("%-42s %-24.3f %.3f", "synonym-paraphrase Recall@3",
                det.recallAt3(), qwen.recallAt3());
        for (int t = 0; t < THRESHOLDS.length; t++) {
            line("%-42s %-24.3f %.3f",
                    "false-recall@" + String.format(Locale.ROOT, "%.2f", THRESHOLDS[t]),
                    det.falseRecallAtThreshold()[t], qwen.falseRecallAtThreshold()[t]);
            line("%-42s %-24.3f %.3f",
                    "no-match reject@" + String.format(Locale.ROOT, "%.2f", THRESHOLDS[t]),
                    1 - det.falseRecallAtThreshold()[t], 1 - qwen.falseRecallAtThreshold()[t]);
        }
        line("%-42s %-24.3f %.3f", "cross-rel contamination (other-rel in top3)",
                det.crossContamination(), qwen.crossContamination());
        line("%-42s %-24.3f %.3f", "cross-rel avg-sim gap (own - other)",
                det.crossSimGap(), qwen.crossSimGap());
        line("%-42s %-24.3f %.3f", "relationship query Recall@3 (context)",
                det.relRecallAt3(), qwen.relRecallAt3());
    }

    private static double[] similarities(float[] query, float[][] factVecs) {
        double[] sims = new double[factVecs.length];
        for (int i = 0; i < factVecs.length; i++) {
            sims[i] = cosine(query, factVecs[i]);
        }
        return sims;
    }

    private static double cosine(float[] a, float[] b) {
        double dot = 0.0;
        double na = 0.0;
        double nb = 0.0;
        for (int i = 0; i < a.length; i++) {
            dot += (double) a[i] * b[i];
            na += (double) a[i] * a[i];
            nb += (double) b[i] * b[i];
        }
        if (na == 0.0 || nb == 0.0) {
            return 0.0;
        }
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }

    /** 余弦最高的前 3 个事实下标（降序）。 */
    private static int[] top3(double[] sims) {
        int first = -1;
        int second = -1;
        int third = -1;
        for (int i = 0; i < sims.length; i++) {
            if (first < 0 || sims[i] > sims[first]) {
                third = second;
                second = first;
                first = i;
            } else if (second < 0 || sims[i] > sims[second]) {
                third = second;
                second = i;
            } else if (third < 0 || sims[i] > sims[third]) {
                third = i;
            }
        }
        return third >= 0 ? new int[]{first, second, third}
                : second >= 0 ? new int[]{first, second} : new int[]{first};
    }

    private static boolean containsIndex(int[] indices, int target) {
        for (int i : indices) {
            if (i == target) {
                return true;
            }
        }
        return false;
    }

    private static String formatSims(double[] sims) {
        String[] parts = new String[sims.length];
        for (int i = 0; i < sims.length; i++) {
            parts[i] = String.format(Locale.ROOT, "%.3f", sims[i]);
        }
        return Arrays.toString(parts);
    }

    private static void assertUnitInterval(double v, String what) {
        assertTrue(v >= 0.0 && v <= 1.0,
                what + " in [0,1] but was " + v);
    }

    private static void line(String format, Object... args) {
        System.out.println("[shadow-eval] " + String.format(Locale.ROOT, format, args));
    }

    /** a 组同义改写对（事实语句，查询改写）。 */
    private record Pair(String fact, String query) {
    }

    /** d 组关系事实（关系标签 + 语句文本）。 */
    private record RelFact(String rel, String text) {
    }

    /** 指向单一关系的查询（关系标签 + 查询 + 正确事实）。 */
    private record RelQuery(String rel, String query, String targetFact) {
    }

    /** 单个 embedder 的全部指标（只用于最小断言与打印，无阈值判断）。 */
    private record EvalMetrics(String label, int dimension, int factCount,
            int queriesEmbedded, double recallAt3, double[] falseRecallAtThreshold,
            double crossContamination, double crossSimGap, double relRecallAt3,
            boolean remote) {
    }
}
