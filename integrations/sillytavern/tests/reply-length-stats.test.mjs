import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replyLengthStats } from '../../../scripts/reply-length-stats.mjs';
import { lengthTierFor, placeGuidance, noteTurn } from '../extension/vc-model-settings/reply-pipeline.js';
test('实际档位统计不猜旧记录，不泄漏正文，按 Unicode 字符去掉控制标记',()=>{
    const result=replyLengthStats([
        {is_user:false,mes:'好呀😀 <voice/><sticker tag="开心"/>',extra:{vc_reply_length_tier:'简短'}},
        {is_user:false,mes:'abcdefghi',extra:{vc_reply_length_tier:'简短'}},
        {is_user:false,mes:'untagged'},
        {is_user:true,mes:'user',extra:{vc_reply_length_tier:'长'}},
        {is_user:false,is_system:true,mes:'system',extra:{vc_reply_length_tier:'长'}},
    ]);
    assert.deepEqual(result.tiers['简短'],{count:2,min:3,p50:3,p90:9,max:9,mean:6});
    assert.equal(result.untagged,1);assert.equal(result.tiers['长'].count,0);assert.ok(!JSON.stringify(result).includes('abcdefghi'));
});
test('只记录实际前台请求使用的篇幅档，不借给其他聊天或 quiet',()=>{
    const c={chat:[{is_user:true,mes:'在吗'}],chatMetadata:{vc_binding:{mode:'COMPANION'}}};
    noteTurn('normal');assert.equal(lengthTierFor(c.chat),null);
    const data={messages:[]};placeGuidance(data,c,{random:()=>.5});
    assert.equal(lengthTierFor(c.chat),'简短');assert.match(data.messages[0].content,/篇幅：简短/);
    assert.equal(lengthTierFor([]),null);noteTurn('normal');assert.equal(lengthTierFor(c.chat),null);
    placeGuidance({messages:[]},c,{type:'quiet'});assert.equal(lengthTierFor(c.chat),null);
});
