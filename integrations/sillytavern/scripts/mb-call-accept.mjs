// MB-8：前台 H5 通话。仅合成音频与模型，原音不进上传目录。
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {openVoiceChat,voiceControl} from './voice-accept-lib.mjs';
import aurora from '../../../mobile/src/themes/aurora.mjs';
const SHOTS=path.resolve('.review-queue/MB-8');
export async function sceneMbCall(ctx){
 fs.mkdirSync(SHOTS,{recursive:true});await voiceControl('asr');await voiceControl('kokoro');
 const {browser,page,st,card,file,identity}=await openVoiceChat(ctx,'通话验收',{fakeAudio:true});
 let stage='open H5';
 try {
  await page.context().addInitScript(()=>{const original=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){if(this instanceof HTMLAudioElement)this.loop=true;return original.apply(this,args);};});
  await page.setViewportSize({width:390,height:844});await page.goto(`${ctx.w05.stBase}/m/?vcdebug=1`);await page.locator(`[data-chat-file="${file}"]`).click();await page.locator('.vc-connection').waitFor({state:'hidden'});
  await page.locator('.vc-chat-input textarea').fill('通话前保留的草稿');
  const since=(await ctx.fixtureHttp.captures()).at(-1)?.seq||0;
  await ctx.fixtureHttp.setOverride('vc03m-chat',{text:'嗯，我在听呀，你慢慢说<voice/>',chunks:3,delay:{firstMs:30,perChunkMs:30}});
  await page.evaluate(()=>{window.__mbCallMetrics=null;window.addEventListener('vc-call-metrics',e=>{window.__mbCallMetrics=e.detail;});});
  await page.getByRole('button',{name:'语音通话',exact:true}).click();const call=page.getByRole('dialog',{name:'语音通话',exact:true});await call.waitFor();
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement.closest('.vc-call'))),true);
  const voiced=()=>page.waitForFunction(()=>{const s=document.querySelector('.vc-call-ring')?.style.transform;return s&&Number(s.match(/scale\(([^)]+)/)?.[1])>1.005;},null,{timeout:10000});
  stage='first speech and reply';await voiced();await page.waitForTimeout(1100);await call.getByRole('button',{name:'静音',exact:true}).click();
  await call.locator('.vc-call-status',{hasText:'正在说话'}).waitFor({timeout:30000});await call.locator('.vc-call-current',{hasText:'我在听呀'}).waitFor();
  console.log('[mb-call] PASS 分段收音 → ASR → 同一 ST 聊天短回复 → TTS');

  stage='interrupt playback';await ctx.fixtureHttp.setOverride('vc03m-chat',{text:'我还有很多话想慢慢告诉你，'.repeat(30),chunks:60,delay:{firstMs:30,perChunkMs:150}});
  await call.getByRole('button',{name:'取消静音',exact:true}).click();await voiced();await call.locator('.vc-call-status',{hasText:'正在听'}).waitFor();await page.waitForTimeout(1100);await call.getByRole('button',{name:'静音',exact:true}).click();
  stage='interrupt generation';await page.waitForFunction(()=>{const engine=globalThis.__vcEngine,m=engine.messages().at(-1);return engine.generating()&&!m?.user&&m?.text.includes('我还有很多话');},null,{timeout:30000});
  await call.getByRole('button',{name:'取消静音',exact:true}).click();await voiced();await page.waitForFunction(()=>!globalThis.__vcEngine.generating(),null,{timeout:5000});
  await ctx.fixtureHttp.setOverride('vc03m-chat',{text:'好呀，我继续听你说<voice/>',chunks:2,delay:{firstMs:30,perChunkMs:30}});await page.waitForTimeout(1100);await call.getByRole('button',{name:'静音',exact:true}).click();
  await call.locator('.vc-call-current',{hasText:'我继续听你说'}).waitFor({timeout:30000});await call.locator('.vc-call-status',{hasText:'正在说话'}).waitFor({timeout:30000});
  console.log('[mb-call] PASS 再次开口同时验证播放打断与生成打断');

  stage='screenshots and close';
  // 使用主题真源的模式 token 切换截图；保持当前通话，不因 reload 重建会话。
  for(const mode of ['light','dark']){
   await page.evaluate(({mode,tokens})=>{for(const [key,value] of Object.entries(tokens))document.documentElement.style.setProperty(`--vc-${key}`,value);document.documentElement.dataset.vcTheme=mode;},{mode,tokens:aurora.modes[mode]});
   for(const width of [390,1440]){await page.setViewportSize({width,height:width===390?844:1000});await page.screenshot({path:path.join(SHOTS,`call-${width}-${mode}.png`)});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  }
  await call.getByRole('button',{name:'挂断',exact:true}).click();await call.waitFor({state:'detached'});assert.equal(await page.locator('.vc-chat-input textarea').inputValue(),'通话前保留的草稿');
  const stats=await page.evaluate(()=>window.__mbCallMetrics);assert.ok(stats.interruptions>=2);assert.ok(stats.latencies.length>=2);assert.ok(stats.latencies.every(x=>x.endToPlayMs>0));
  const voice=(await(await fetch(`http://127.0.0.1:${process.env.VC_W03_FIXTURE_PORT}/__voice/state`)).json());assert.equal(voice.asr.maxActive,1);assert.equal(voice.kokoro.maxActive,1);
  const saved=await st.call('POST','/api/chats/get',{avatar_url:card.avatar,file_name:file});assert.equal(saved.status,200);assert.equal(saved.json[0].chat_metadata.vc_f2.id,identity);assert.ok(saved.json.slice(1).filter(m=>m.is_user&&m.extra?.vc_voice_input?.call===true).length>=3);await page.getByLabel('语音通话',{exact:true}).last().waitFor();
  assert.equal(await page.evaluate(()=>Boolean(document.querySelector('#vc-engine').contentWindow.SillyTavern.getContext().extensionPrompts.vc_mobile_call?.value)),false);
  const requests=await ctx.fixtureHttp.captures({protocol:'chat',since});const turns=requests.filter(r=>r.body?.model==='vc03m-chat');assert.ok(turns.length>=3);assert.ok(turns.every(r=>r.body.messages.some(m=>typeof m.content==='string'&&m.content.includes('本轮篇幅：简短'))));
  fs.writeFileSync(path.join(SHOTS,'NOTES.md'),`# MB-8\n\n合成音频与模型：三轮通话、播放与生成打断、静音、字幕和挂断；同一聊天及原草稿保留；ASR / TTS 最大并发均为 1。\n390 / 1440 浅深截图使用 aurora 主题真源 token，保持正在进行的通话。\n\n时延（ms；fixture，不代表真实模型/设备）：\n${stats.latencies.map(x=>`- ASR（含解码） ${x.asrMs}；文本生成 ${x.replyMs}；音频就绪 ${x.voiceMs}；收音结束至开始播放 ${x.endToPlayMs}`).join('\n')}\n\nOwner 已选定 H5 仅静音/字幕、输出随系统；App 壳与系统通知仍搁置。\n`);
  console.log('[mb-call] PASS 挂断清理、草稿与同一聊天、每引擎并发 1；fixture 时延已记录');
 }catch(e){await page.screenshot({path:path.join(SHOTS,'failure.png')});const info=await page.evaluate(async()=>{const engine=globalThis.__vcEngine,policy=await engine?.voicePolicy();return {status:document.querySelector('.vc-call-status')?.textContent,generating:engine?.generating(),length:engine?.messages().length,bound:!!engine?.binding().relationshipId,mode:engine?.binding().mode,tts:!!policy?.available,asr:!!policy?.engines.asr?.enabled,healthy:!!policy?.engines.asr?.healthy};});throw Error(`mb-call ${stage}: ${JSON.stringify(info)}; ${e.message}`);}
 finally{await browser.close();await ctx.fixtureHttp.setOverride('vc03m-chat',null);}
}
export const mbCallScene={id:'mb-call',title:'MB-8 H5 前台分段通话、打断、同一聊天与时延',needs:['catalog','stack','browser','fixture'],default:false,run:sceneMbCall};
