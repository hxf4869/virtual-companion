import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { prepareMemoryFact, EXTRACTION_RULES, extractionRunner } from '../memorycore-service/memory-policy.mjs';

test('只丢弃纯临时状态，长期健康、习惯与混合持久事实保留',()=>{
    for(const content of ['用户今天感觉很累很困。','用户现在有点饿。','用户今晚想睡觉，很疲倦。'])assert.equal(prepareMemoryFact({content}),null);
    for(const content of ['用户长期失眠，已看医生。','用户饿的时候习惯喝牛奶。','用户今天很累，但已经搬到了上海。'])assert.equal(prepareMemoryFact({content}).content,content);
});
test('相对日期只用 Go 权威换算；不改原文和不明确的日期',()=>{
    const memory={content:'用户明天去苏州参加婚礼。',metadata:{}};
    const source={sourceExpression:'明天',eventDate:'2026-11-01',normalizationStatus:'normalized'};
    const result=prepareMemoryFact(memory,source);
    assert.equal(result.content,'用户2026-11-01去苏州参加婚礼。');assert.equal(result.metadata.eventDate,'2026-11-01');
    assert.equal(memory.content,'用户明天去苏州参加婚礼。');
    assert.equal(prepareMemoryFact(memory,{...source,normalizationStatus:'needs_clarification'}),memory);
    assert.equal(prepareMemoryFact(memory),memory);
});
test('提取规则与文案真源一致；只增强 L1 提取，不改冲突工具协议',async()=>{
    const copy=await fs.readFile(new URL('../../../docs/planning/2026-10-30-companion-copy.md',import.meta.url),'utf8');
    assert.ok(copy.includes(EXTRACTION_RULES));
    let sent;const runner=extractionRunner({run:async(params)=>{sent=params;return '[]';}},null);
    await runner.run({taskId:'l1-extraction',systemPrompt:'base'});assert.ok(sent.systemPrompt.includes(EXTRACTION_RULES));
    await runner.run({taskId:'l1-conflict-detection',systemPrompt:'dedup'});assert.equal(sent.systemPrompt,'dedup');
});
