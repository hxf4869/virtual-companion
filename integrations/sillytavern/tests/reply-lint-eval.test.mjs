import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLint } from '../../../scripts/eval-reply-lint.mjs';
test('RQ-7 带标注的正常聊天、引用和自称负例不触发强制重写',()=>{
    const result=evaluateLint();assert.equal(result.falsePositive,0);assert.equal(result.negative,16);assert.equal(result.truePositive,result.positive);
});
