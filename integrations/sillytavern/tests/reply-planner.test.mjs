import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { planReply, PLANNER_COPY, PLAN_NOTE, PLAN_PROMPT } from '../extension/vc-model-settings/reply-planner.js';
import { placeGuidance } from '../extension/vc-model-settings/reply-pipeline.js';

function fixture(text='我应该怎么做？') {
    const prompts={};const context={extensionSettings:{vc_reply_planner:true},chatMetadata:{vc_binding:{mode:'COMPANION'},vc_f2:{revision:1}},chat:[{is_user:true,mes:text}],
        eventSource:new EventEmitter(),eventTypes:{GENERATION_STOPPED:'stop'},setExtensionPrompt(key,value){prompts[key]=value;}};
    return {context,prompts,getContext:()=>context};
}
test('默认关闭及非陪伴、辅助生成不调用 planner',async()=>{
    for(const mutate of [c=>{c.extensionSettings={};},c=>{c.chatMetadata.vc_binding.mode='STORY';},c=>{c.groupId=1;}]) {
        const f=fixture();mutate(f.context);assert.equal(await planReply({...f,generate:()=>assert.fail('unexpected model call')}),null);
    }
    assert.equal(await planReply({...fixture(),type:'quiet',generate:()=>assert.fail('unexpected model call')}),null);
});
test('helper 不带常规尾部，方向只注入本轮，计划不写聊天',async()=>{
    const f=fixture();const original=JSON.stringify(f.context.chat);let discarded=0,calls=0;
    assert.deepEqual(await planReply({...f,discardPending:()=>discarded++,generate:async(args)=>{
        calls++;assert.equal(args.systemPrompt,PLANNER_COPY);assert.deepEqual(JSON.parse(args.prompt).history,[{role:'user',text:'我应该怎么做？'}]);
        assert.equal(placeGuidance({messages:[]},f.context),false);
        return '{"kind":"reply","direction":"先回应担心"}';
    }}),{planned:true});
    assert.equal(calls,1);assert.equal(discarded,1);assert.match(f.prompts[PLAN_PROMPT],/先回应担心/);assert.equal(JSON.stringify(f.context.chat),original);
    assert.equal(placeGuidance({messages:[]},f.context),true);assert.equal(f.context.eventSource.listenerCount('stop'),0);
});
test('只允许明确结束语沉默，提问和求助直接继续回复',async()=>{
    for(const text of ['晚安','好的！','先这样','你能帮我吗？','我今天很难过','晚安但你觉得我明天该去吗']) {
        const f=fixture(text);const result=await planReply({...f,generate:async()=>'{"kind":"stay_silent","direction":""}'});
        assert.deepEqual(result,['晚安','好的！','先这样'].includes(text)?{silent:true}:null);
    }
});
test('非法结果或异常只回退一次直接生成，停止或换聊天丢弃晚到结果',async()=>{
    for(const raw of ['not-json','{}',JSON.stringify({kind:'reply',direction:'长'.repeat(81)})]) {
        let calls=0;assert.equal(await planReply({...fixture(),generate:async()=>{calls++;return raw;}}),null);assert.equal(calls,1);
    }
    assert.equal(await planReply({...fixture(),generate:async()=>{throw Error('fixture');}}),null);
    for(const stop of [f=>f.context.eventSource.emit('stop'),f=>{f.context.chat=[];},f=>{f.context.chatMetadata.vc_f2.revision++;}]) {
        const f=fixture();assert.deepEqual(await planReply({...f,generate:async()=>{stop(f);return '{"kind":"reply","direction":"继续"}';}}),{cancelled:true});
        assert.equal(f.prompts[PLAN_PROMPT],'');
    }
});
test('规划文案与 copy 真源一致',async()=>{
    const copy=await readFile(new URL('../../../docs/planning/2026-10-30-companion-copy.md',import.meta.url),'utf8');
    assert.ok(copy.includes(PLANNER_COPY));assert.ok(copy.includes(PLAN_NOTE));
});
