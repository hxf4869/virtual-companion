import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCENES, resolveSceneFilter } from '../scripts/managed-lib.mjs';
import { REPO_ROOT } from '../scripts/lib/paths.mjs';
import {
    RESULT_RELATIVE, SOURCE_SAMPLES, OPTIONAL_SAMPLES, QUERIES,
    callCap, canAddSample, cleanupSettled, classifyMiss, judgeAcross, latencyStats, queryPhaseStop, zipCost, summarizeCost,
    decodeRefusalHint, publicQuery, recallHit, runCap, sealReport,
} from '../scripts/w08-real-eval.mjs';

const healthy = {
    wire: { envelope: false, outerObject: null, object: 'chat.completion', choices: 1, index: 0, content: 'string', usageBalanced: true },
    structure: { finishReason: 'stop', toolCalls: false, usageShapes: { prompt: 'int', completion: 'int', total: 'int' } },
};

test('遗忘清理只在 DONE 时算完成，PARTIAL 仍要等画像重建', () => {
    assert.equal(cleanupSettled('DONE'), true);
    assert.equal(cleanupSettled('PARTIAL'), false);
    assert.equal(cleanupSettled('PENDING'), false);
});

test('预算按已观测峰值保留，默认至少留 6 次才开始下一条', () => {
    assert.equal(callCap({}), 300);
    assert.equal(callCap({ VC_W08_EVAL_CALL_CAP: '120' }), 120);
    assert.equal(callCap({ VC_W08_EVAL_CALL_CAP: '0' }), 300);
    assert.equal(callCap({ VC_W08_EVAL_CALL_CAP: 'nope' }), 300);
    assert.equal(runCap({ VC_W08_EVAL_CALL_CAP: '300', VC_W08_EVAL_REMAINING: '34' }), 34);
    assert.equal(runCap({ VC_W08_EVAL_REMAINING: '900' }), 300);
    assert.equal(canAddSample(0, { cap: 80 }), true);
    assert.equal(canAddSample(74, { cap: 80 }), true);
    assert.equal(canAddSample(75, { cap: 80 }), false);
    assert.equal(canAddSample(70, { cap: 80, peak: 10 }), true);
    assert.equal(canAddSample(71, { cap: 80, peak: 10 }), false);
    assert.equal(canAddSample(Number.NaN, { cap: 80 }), false);
});

test('召回命中看期望词是否都出现，并保留探针返回的记忆 id', () => {
    const includes = (token) => ['厦门', '婚礼'].includes(token);
    assert.equal(recallHit(['厦门', '婚礼'], includes), true);
    assert.equal(recallHit(['厦门', '戒指'], includes), false);
    assert.equal(recallHit([], includes), false);
    const row = publicQuery({ id: 'M01-direct', caseId: 'M01', kind: 'positive', hit: true, memoryIds: ['11'], summaryIds: ['5'] });
    assert.deepEqual(row.memoryIds, ['11']);
    assert.equal(row.hit, true);
});

test('未命中分成四类', () => {
    assert.equal(classifyMiss({ hit: true, extracted: true, dateGated: true, recallEligible: true, inRecall: true }), null);
    assert.equal(classifyMiss({ hit: false, extracted: false, dateGated: false, recallEligible: false, inRecall: false }), '未提取');
    assert.equal(classifyMiss({ hit: false, extracted: true, dateGated: true, recallEligible: true, inRecall: false }), '日期门禁');
    assert.equal(classifyMiss({ hit: false, extracted: true, dateGated: false, recallEligible: true, inRecall: false }), '低相关拒绝');
    assert.equal(classifyMiss({ hit: false, extracted: true, dateGated: false, recallEligible: false, inRecall: false }), '提取未召回');
});

test('画像判定只给结论和一句理由', () => {
    assert.deepEqual(judgeAcross({ caseId: 'M02', layer: 'L2', required: ['上海'], forbidden: ['北京'], texts: ['现居上海，也曾住北京'] }), { caseId: 'M02', layer: 'L2', verdict: '错误', reason: '新事实已覆盖，但仍保留过期事实' });
    assert.equal(judgeAcross({ caseId: 'M06', layer: 'L2', required: [], forbidden: ['钟表'], texts: ['职业是钟表修复'] }).reason, '画像包含已过期或不应进入的事实');
    assert.deepEqual(judgeAcross({ caseId: 'M06', layer: 'L3', required: [], forbidden: ['钟表'], texts: ['日常偏好'], expect: 'absent' }), { caseId: 'M06', layer: 'L3', verdict: '贴切', reason: '未发现不应进入的事实' });
    assert.equal(judgeAcross({ caseId: 'M01', layer: 'L2', required: ['厦门'], texts: [] }).verdict, '错误');
    assert.equal(judgeAcross({ caseId: 'M01', layer: 'L3', required: ['厦门'], texts: [], expect: 'may-omit' }).verdict, '部分');
    assert.equal(judgeAcross({ caseId: 'M12', layer: 'L2', required: [], forbidden: ['2026-10-21'], texts: ['待澄清'] }).verdict, '贴切');
    assert.equal(judgeAcross({ caseId: 'M11', layer: 'L2', required: ['厦门', '2026-10-30'], texts: ['去厦门'] }).verdict, '部分');
    assert.equal(judgeAcross({ caseId: 'M05', layer: 'L2', required: ['帆船', '徽章'], texts: ['帆船'], mode: 'any' }).verdict, '贴切');
    assert.equal(judgeAcross({ caseId: 'M09', layer: 'L3', required: ['蓝窗'], texts: ['其他'], expect: 'may-omit' }).verdict, '部分');
});

test('提问阶段只在新的提取尝试或预算耗尽时停止', () => {
    assert.equal(queryPhaseStop({ callsNow: 42, callsAtQueries: 41, cap: 300, stages: ['l2-scene'] }), null);
    assert.equal(queryPhaseStop({ callsNow: 42, callsAtQueries: 41, cap: 300, stages: [] }), null);
    assert.equal(queryPhaseStop({ callsNow: 42, callsAtQueries: 41, cap: 300, stages: ['l1-extraction'] }), 'query-called-model');
    assert.equal(queryPhaseStop({ callsNow: 42, callsAtQueries: 41, cap: 300, stages: ['l1-conflict-detection'] }), 'query-called-model');
    assert.equal(queryPhaseStop({ callsNow: 300, cap: 300, stages: [] }), 'call-budget');
});

test('延迟取最近秩 P50，并丢掉无法召回的空值', () => {
    assert.deepEqual(latencyStats([30, 10, null, 20]), { p50Ms: 20, maxMs: 30, n: 3 });
    assert.deepEqual(latencyStats([10]), { p50Ms: 10, maxMs: 10, n: 1 });
    assert.deepEqual(latencyStats([null]), { p50Ms: null, maxMs: null, n: 0 });
});

test('阶段成本按调用顺序对齐，币种未声明时原样标记', () => {
    const zipped = zipCost(
        [{ stage: 'l1-extraction', billing: 'USAGE_REPORTED' }, { stage: 'l2-scene', billing: 'UNKNOWN' }],
        [{ promptTokens: 10, completionTokens: 4, cost: 0.5 }, { promptTokens: 8, completionTokens: 2, cost: null }, { promptTokens: 1, completionTokens: 1, cost: 9 }],
    );
    assert.equal(zipped.aligned, false);
    assert.equal(zipped.rows.length, 2);
    const cost = summarizeCost(zipped.rows, 2);
    assert.deepEqual(cost.stages.map((stage) => stage.stage), ['L1', 'L2']);
    assert.equal(cost.stages[1].costMissing, 1);
    assert.equal(cost.costCurrency, 'undeclared');
    assert.equal(cost.perUserMessage.cost, 0.25);
    assert.equal(cost.daily100.messageCount, 100);
    assert.doesNotThrow(() => sealReport(cost));
    assert.equal(cost.daily100.inputTokens, 900);
    assert.equal(cost.daily100.costCurrency, 'undeclared');
    assert.equal(summarizeCost([], 0).perUserMessage, null);
});

test('回调解码只指出结构拒绝点', () => {
    assert.deepEqual(decodeRefusalHint(healthy), []);
    assert.deepEqual(decodeRefusalHint({
        wire: { ...healthy.wire, content: 'empty' },
        structure: { ...healthy.structure, toolCalls: true, contentEmpty: true },
    }), ['content', 'tool-calls-without-content']);
    assert.deepEqual(decodeRefusalHint({
        wire: { ...healthy.wire, usageBalanced: true },
        structure: { ...healthy.structure, usageShapes: { prompt: 'decimal', completion: 'int', total: 'decimal' } },
    }), ['usage']);
    assert.deepEqual(decodeRefusalHint({
        wire: { ...healthy.wire, envelope: true, outerObject: 'chat.completion', index: null },
        structure: healthy.structure,
    }), ['envelope-and-object', 'choice']);
});

test('公开查询去掉正文，封存先剥离字段名再丢掉过长或敏感字符串', () => {
    const query = publicQuery({ id: 'M02-direct', caseId: 'M02', kind: 'positive', text: '我现在住哪儿？', hit: true, empty: false, leaked: false, tokenSeen: true, count: 1, memoryIds: ['9'], summaryIds: [], missReason: null, datedFactsExcluded: null });
    assert.equal(Object.hasOwn(query, 'text'), false);
    assert.equal(JSON.stringify(query).includes('我现在住哪儿'), false);
    assert.equal(query.tokenSeen, true);
    const ok = { model: 'm', contentKind: 'string', note: '短结论' };
    assert.deepEqual(sealReport(ok, ['secret-value']), ok);
    assert.deepEqual(sealReport({ content: 'x', providerCalls: 2 }), { providerCalls: 2 });
    assert.deepEqual(sealReport({ structure: { usageShapes: { prompt: 'int', completion: 'int', total: 'int' } } }), { structure: { usageShapes: { completion: 'int', total: 'int' } } });
    const sealed = sealReport({ note: 'a'.repeat(181), leak: 'prefix secret-value suffix', cost: 1, providerCalls: 2, datedFactsExcluded: null }, ['secret-value']);
    assert.equal(Object.hasOwn(sealed, 'note'), false);
    assert.equal(Object.hasOwn(sealed, 'leak'), false);
    assert.equal(sealed.cost, 1);
    assert.equal(sealed.providerCalls, 2);
    assert.equal(sealed.datedFactsExcluded, null);
});

test('memory-real-eval 只在显式过滤时运行，产物在忽略目录', () => {
    assert.equal(SCENES.find((scene) => scene.id === 'memory-real-eval').default, false);
    assert.equal(resolveSceneFilter().includes('memory-real-eval'), false);
    assert.deepEqual(resolveSceneFilter('memory-real-eval'), ['memory-real-eval']);
    const accept = fs.readFileSync(new URL('../scripts/accept-managed.mjs', import.meta.url), 'utf8');
    assert.equal(accept.includes("'memory-real-eval': sceneMemoryRealEval"), true);
    const check = fs.readFileSync(new URL('../../../scripts/check.sh', import.meta.url), 'utf8');
    assert.equal(check.includes('memory-real-eval'), false);
    const ignore = fs.readFileSync(new URL('../../../.gitignore', import.meta.url), 'utf8');
    assert.equal(ignore.includes('integrations/sillytavern/.local/'), true);
    assert.equal(RESULT_RELATIVE.startsWith('integrations/sillytavern/.local/'), true);
    const fixture = fs.readFileSync(new URL('../../../docs/source/v2-r3/fixtures/memory_cases.json', import.meta.url), 'utf8');
    for (const sample of [...SOURCE_SAMPLES, ...OPTIONAL_SAMPLES]) {
        if (sample.id === 'M11') {
            assert.equal(sample.text, '下周五去杭州看望外婆。');
            assert.equal(sample.at, '2026-10-20T20:00:00+08:00');
            assert.equal(sample.zone, 'Asia/Shanghai');
            assert.equal(fixture.includes(sample.text), false, sample.id);
            continue;
        }
        assert.equal(fixture.includes(sample.text), true, sample.id);
    }
    const direct = QUERIES.find((query) => query.id === 'M11-direct');
    const rewrite = QUERIES.find((query) => query.id === 'M11-rewrite');
    const otherWeek = QUERIES.find((query) => query.id === 'M11-other-week');
    assert.equal(direct.text, '10月30日我要去哪里？');
    assert.deepEqual(direct.tokens, ['杭州']);
    assert.equal(rewrite.text, '去杭州看望外婆是哪一天的安排？');
    assert.deepEqual(rewrite.tokens, ['外婆']);
    for (const token of ['杭州', '外婆', '厦门', '婚礼']) assert.equal(otherWeek.absentTokens.includes(token), true, token);
    const script = fs.readFileSync(new URL('../scripts/w08-real-eval.mjs', import.meta.url), 'utf8');
    assert.equal(script.includes("required: ['杭州', '外婆', '2026-10-30']"), true);
    assert.equal(script.includes('测试环境价格，不是 Owner 价格，也不代表供应商账单'), true);
    assert.equal(script.includes("provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active, effective_from"), true);
    assert.equal(script.includes("'vc08-real'"), true);
    const noiseInFixture = [...fixture.matchAll(/"id": "noise-\d+"/g)].length;
    assert.ok(noiseInFixture > OPTIONAL_SAMPLES.filter((sample) => sample.id.startsWith('noise-')).length);
    assert.equal(fs.existsSync(new URL(`file://${REPO_ROOT}/AGENTS.md`)), true); // 指向仓库根（worktree 目录名可不同）
});
