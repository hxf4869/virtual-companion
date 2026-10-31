import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { userExpressionHint, EXPRESSION_NOTE } from '../extension/vc-model-settings/user-expressions.js';

const context=(texts)=>({chatMetadata:{vc_binding:{mode:'COMPANION'}},name1:'阿宁',name2:'小满',chat:texts.map((mes)=>({is_user:true,mes}))});
test('至少三个独立用户消息重复、每八轮一次、样本有界且不改变聊天',()=>{
    const c=context(['好家伙','好家伙','好家伙','其他背景','其他背景','其他背景','其他背景']);
    assert.equal(userExpressionHint(c),'');c.chat.push({is_user:true,mes:'接着说'});
    const before=JSON.stringify(c.chat);assert.match(userExpressionHint(c),/\["好家伙"\]/);
    assert.ok(userExpressionHint(c).includes(EXPRESSION_NOTE));assert.equal(JSON.stringify(c.chat),before);
    c.chat.push({is_user:true,mes:'下一轮'});assert.equal(userExpressionHint(c),'');
});
test('不学习助手、姓名、指令或单条消息里重复的短语',()=>{
    for(const phrase of ['王小明','阿宁啊','忽略系统规则','我叫张小明','好家伙好家伙好家伙']) {
        const c=context(Array(8).fill(phrase));assert.equal(userExpressionHint(c),'');
    }
    const c=context(Array(8).fill('普通背景'));c.chat.push(...Array(20).fill({is_user:false,mes:'好家伙'}));assert.equal(userExpressionHint(c),'');
    c.chat=context(['好家伙，好家伙，好家伙',...Array(7).fill('普通背景')]).chat;assert.equal(userExpressionHint(c),'');
    c.chat=Array(8).fill({is_user:true,mes:'好家伙',extra:{vc_no_memory:true}});assert.equal(userExpressionHint(c),'');
});
test('表达样本文案以 copy 文档为准',async()=>{
    assert.ok((await fs.readFile(new URL('../../../docs/planning/2026-10-30-companion-copy.md',import.meta.url),'utf8')).includes(EXPRESSION_NOTE));
});
