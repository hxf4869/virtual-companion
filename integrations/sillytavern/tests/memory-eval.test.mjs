import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { evaluateMemory, compareBaseline } from '../../../scripts/eval-memory.mjs';

test('RQ-3 真实离线提取 / SQLite 召回逐类别及逐基线用例不得退步', async()=>{
    const baseline=JSON.parse(await fs.readFile(new URL('../../../scripts/fixtures/memory-eval-baseline.json',import.meta.url),'utf8'));
    const report=await evaluateMemory();
    assert.deepEqual(Object.keys(report.categories).sort(),['event','fact','preference','relationship','replacement']);
    assert.deepEqual(compareBaseline(report,baseline),[]);
    const degraded=structuredClone(report);degraded.cases.find((row)=>row.id==='fact-city').recall=false;
    assert.ok(compareBaseline(degraded,baseline).includes('fact-city'),'单例退步不能被其他类别或新增用例掩盖');
});
