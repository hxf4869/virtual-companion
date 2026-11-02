// MB-9: real owner-isolated jobs/API/H5; all model, speech and chat data are synthetic.
import assert from 'node:assert/strict';import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';
import {openVoiceChat,voiceCall,voiceControl} from './voice-accept-lib.mjs';
import {prepareSourceIdentities} from '../server-plugin/virtual-companion/lib/source-identity.js';
import {waitFor} from './managed-lib.mjs';import aurora from '../../../mobile/src/themes/aurora.mjs';
const SHOTS=path.resolve('.review-queue/MB-9');const sql=v=>`'${String(v).replace(/'/g,"''")}'`;
export async function sceneMbIncoming(ctx){
 fs.mkdirSync(SHOTS,{recursive:true});await voiceControl('asr');await voiceControl('kokoro');
 const {browser,page,st,card,file,identity}=await openVoiceChat(ctx,'来电验收',{fakeAudio:true});let stage='setup';
 try {
  await page.context().addInitScript(()=>{const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{const stream=await get(...args);stream.getAudioTracks().forEach(t=>{t.enabled=false;});return stream;};});
  const owner=String(ctx.w05.ownerId),relationship=await page.evaluate(()=>String(SillyTavern.getContext().chatMetadata.vc_binding.relationshipId));assert.match(relationship,/^[1-9][0-9]*$/);
  const base=new Date();base.setUTCDate(base.getUTCDate()+7);base.setUTCHours(12,0,0,0);const userAt=new Date(+base-4*3600000);
  const rows=(await st.call('POST','/api/chats/get',{avatar_url:card.avatar,file_name:file})).json;
  rows.push({name:'合成用户',is_user:true,mes:'这本书还没聊完，回头接着聊',send_date:userAt.toISOString(),extra:{}});prepareSourceIdentities(rows,{settled:true,sourceTimezone:'UTC'});
  assert.equal((await st.call('POST','/api/chats/save',{avatar_url:card.avatar,file_name:file,chat:rows})).status,200);
  const source=await voiceCall(ctx,'POST','/api/v1/st/sources/reconcile',{chatIdentities:[identity]});
  await voiceCall(ctx,'POST','/api/v1/st/memory/recall',{chatIdentity:identity,revision:source[0].revision,enabled:true,budgetTokens:1024});
  const scene='landscape autumn great tree.jpg';assert.ok((await st.call('POST','/api/backgrounds/all',{})).json.images.some(i=>i.filename===scene));assert.equal((await st.call('POST','/api/characters/merge-attributes',{avatar:card.avatar,data:{extensions:{vc_mobile_background:scene}}})).status,200);
  const policy=await voiceCall(ctx,'GET',`/api/v1/relationships/${relationship}/proactive-policy`);
  // Four distinct call dispositions need four fixture slots; the product default stays three.
  await voiceCall(ctx,'PUT',`/api/v1/relationships/${relationship}/proactive-policy`,{...policy,enabled:true,mode:'CLOSE_FRIEND',offlineCapable:true,dailyLimit:6,quietHoursStart:'23:00',quietHoursEnd:'08:00',quietHoursTimezone:'UTC',checkInAfterMinutes:120});
  await voiceCall(ctx,'PUT','/api/v1/consents',{consentType:'PUSH_NOTIFICATION',version:'mb9-fixture',granted:true});
  ctx.w10.psql(`INSERT INTO vc.notification_channel(owner_user_id,id,channel,enabled,configured_target,relationship_ids) VALUES(${owner},nextval('vc.notification_channel_id_seq'),'EMAIL',true,'mb9@example.test',ARRAY[${relationship}]::bigint[]);`);
  const purposes=await ctx.admin.listPurposes(),purpose=purposes.json.find(p=>p.purpose==='BACKGROUND_GREETINGS');assert.equal((await ctx.admin.savePurpose('BACKGROUND_GREETINGS',{providerId:'vc03m-chat',profileKey:'chat',state:'ENABLED',expectedRevision:purpose.revision})).status,200);
  await ctx.fixtureHttp.setOverride('vc03m-chat',{proactiveCall:true});
  stage='judge call';const ready=await voiceCall(ctx,'POST',`/api/v1/relationships/${relationship}/proactive-run`,{now:base.toISOString()});assert.equal(ready.outcome,'READY',`call trigger ${ready.outcome}/${ready.reason}`);assert.equal(ready.reason,'call');
  const planned=ctx.w10.psql(`SELECT planned_at FROM vc.proactive_message WHERE owner_user_id=${owner} AND relationship_id=${relationship} AND kind='call' AND status='READY' ORDER BY id DESC LIMIT 1;`).trim();
  await voiceCall(ctx,'POST',`/api/v1/relationships/${relationship}/proactive-run`,{now:new Date(+base-6*3600000).toISOString()});
  assert.equal(ctx.w10.psql(`SELECT status FROM vc.proactive_message WHERE owner_user_id=${owner} AND relationship_id=${relationship} AND kind='call' ORDER BY id DESC LIMIT 1;`).trim(),'READY','a future call survives an earlier quiet-hours pass');
  await page.goto(`${ctx.w05.stBase}/m/?vcdebug=1`);await page.waitForFunction(()=>!!globalThis.__vcIncoming);await page.locator(`[data-chat-file="${file}"]`).click();await page.locator('.vc-connection').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'开始录音',exact:true}).click();await page.getByRole('button',{name:'结束录音',exact:true}).waitFor();
  const firstResult=await voiceCall(ctx,'POST',`/api/v1/relationships/${relationship}/proactive-run`,{now:new Date(planned).toISOString()});assert.equal(firstResult.outcome,'INBOX');
  const mine=async()=> (await voiceCall(ctx,'GET','/api/v1/inbox')).filter(e=>e.relationshipId===relationship);
  const first=(await mine()).find(e=>e.eventId===firstResult.eventId);assert.equal(first.call.state,'RINGING');assert.equal(first.voice?.status,'ready');
  const incoming=()=>page.getByRole('dialog',{name:'来电',exact:true});await page.evaluate(()=>globalThis.__vcIncoming.poll());assert.equal(await incoming().count(),0,'recording is not interrupted by another microphone view');await page.getByRole('button',{name:'结束录音',exact:true}).focus();await page.keyboard.press('Escape');await page.getByRole('button',{name:'开始录音',exact:true}).waitFor();await page.evaluate(()=>globalThis.__vcIncoming.poll());await incoming().waitFor({timeout:15000});
  stage='ring screenshots';await incoming().locator('.vc-scene.is-ready').waitFor();
  const shots=async prefix=>{for(const mode of ['light','dark']){await page.evaluate(({mode,tokens})=>{for(const [key,value]of Object.entries(tokens))document.documentElement.style.setProperty(`--vc-${key}`,value);document.documentElement.dataset.vcTheme=mode;},{mode,tokens:aurora.modes[mode]});for(const width of [390,1440]){await page.setViewportSize({width,height:width===390?844:1000});await page.screenshot({path:path.join(SHOTS,`${prefix}-${width}-${mode}.png`)});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}}};
  await shots('incoming');await incoming().getByRole('button',{name:'拒绝',exact:true}).click();await incoming().waitFor({state:'detached'});assert.equal((await mine()).find(e=>e.eventId===first.eventId).call.state,'DECLINED');
  await page.getByRole('button',{name:'返回',exact:true}).first().click();await page.locator('.vc-main').waitFor();
  console.log('[mb-incoming] PASS 主动判断 → 安全审查 → 30秒来电；H5 拒绝落库');
  const seed=async(label='合成来电开场',expectInbox=true)=>{
   ctx.w10.psql(`UPDATE vc.companion_affect SET unanswered=0,busy_until=NULL WHERE owner_user_id=${owner} AND relationship_id=${relationship};
    INSERT INTO vc.proactive_message(owner_user_id,relationship_id,trigger_key,kind,cluster_key,status,body,topic,planned_at,armed_at,voice_selected)
    SELECT ${owner},${relationship},'call','call','topic','READY',${sql(label)},open_topic_source_ref,${sql(base.toISOString())},last_user_message_at,true FROM vc.companion_affect WHERE owner_user_id=${owner} AND relationship_id=${relationship};`);
   const result=await voiceCall(ctx,'POST',`/api/v1/relationships/${relationship}/proactive-run`,{now:base.toISOString()});if(!expectInbox){assert.notEqual(result.outcome,'INBOX');return null;}assert.equal(result.outcome,'INBOX');return (await mine()).find(e=>e.eventId===result.eventId);
  };
  stage='answer retry';const second=await seed();await page.evaluate(()=>globalThis.__vcIncoming.poll());await incoming().waitFor({timeout:10000});
  const requests=[];const route='**/api/plugins/virtual-companion/go/api/v1/inbox/*/call';await page.route(route,r=>{requests.push(r.request().postDataJSON());return r.abort('failed');});
  await incoming().getByRole('button',{name:'接听',exact:true}).click();await incoming().getByRole('alert').waitFor();await page.unroute(route);
  page.on('request',r=>{if(r.url().endsWith(`/inbox/${second.eventId}/call`))requests.push(r.postDataJSON());});
  await incoming().getByRole('button',{name:'接听',exact:true}).click();const call=page.getByRole('dialog',{name:'语音通话',exact:true});await call.waitFor();await call.locator('.vc-call-current',{hasText:second.body}).waitFor({timeout:10000});
  assert.equal(requests[0].requestId,requests[1].requestId);assert.equal((await mine()).find(e=>e.eventId===second.eventId).call.state,'ANSWERED');
  await call.getByRole('button',{name:'挂断',exact:true}).click();await call.waitFor({state:'detached'});
  await waitFor(async()=>{const saved=await st.call('POST','/api/chats/get',{avatar_url:card.avatar,file_name:file});return saved.json.filter(m=>m.mes===second.body).length===1;},{label:'one call opening in same chat',timeoutMs:15000});
  console.log('[mb-incoming] PASS 接听失败可重试且 UUID 稳定；开场语音与同一份聊天');
  stage='missed voicemail';await page.getByRole('button',{name:'返回',exact:true}).first().click();
  const missed=await seed('合成未接留言');ctx.w10.psql(`UPDATE vc.inbox_event SET call_expires_at=clock_timestamp()-interval '1 second' WHERE owner_user_id=${owner} AND event_id=${sql(missed.eventId)};`);
  assert.equal((await mine()).find(e=>e.eventId===missed.eventId).call.state,'MISSED');const expired=await voiceCall(ctx,'POST',`/api/v1/inbox/${missed.eventId}/call`,{action:'ANSWER',requestId:crypto.randomUUID()});assert.equal(expired.applied,false);
  await page.getByRole('tab',{name:'陪伴',exact:true}).click();const cardRow=page.locator(`[data-inbox-event="${missed.eventId}"]`);await cardRow.getByText('未接来电',{exact:true}).waitFor();assert.equal(await cardRow.locator('.vc-voice-bar').count(),1);await cardRow.locator('.vc-voice-bar').click();await shots('voicemail');await page.evaluate(()=>globalThis.__vcEngine.stopVoice());
  await cardRow.getByRole('button',{name:'回电',exact:true}).click();await call.waitFor();await call.getByRole('button',{name:'挂断',exact:true}).click();await call.waitFor({state:'detached'});
  stage='competing clients';const race=await seed('合成竞争接听');const ids=[crypto.randomUUID(),crypto.randomUUID()];const replies=await Promise.all(ids.map(requestId=>voiceCall(ctx,'POST',`/api/v1/inbox/${race.eventId}/call`,{action:'ANSWER',requestId})));assert.equal(replies.filter(r=>r.applied).length,1);const winner=ids[replies.findIndex(r=>r.applied)];assert.equal((await voiceCall(ctx,'POST',`/api/v1/inbox/${race.eventId}/call`,{action:'ANSWER',requestId:winner})).applied,true);
  assert.equal(ctx.w10.psql(`SELECT count(*) FROM vc.notification_delivery WHERE owner_user_id=${owner} AND event_id IN (SELECT event_id FROM vc.inbox_event WHERE owner_user_id=${owner} AND call_state IS NOT NULL);`).trim(),'0');
  stage='disable voice before delivery';const settings=await voiceCall(ctx,'GET','/api/v1/voice/settings');const {revision,updatedAt,...values}=settings;await voiceCall(ctx,'PUT','/api/v1/voice/settings',{...values,asrEnabled:false,expectedRevision:revision});await seed('合成语音关闭后取消',false);assert.equal(ctx.w10.psql(`SELECT status FROM vc.proactive_message WHERE owner_user_id=${owner} AND relationship_id=${relationship} AND body='合成语音关闭后取消' ORDER BY id DESC LIMIT 1;`).trim(),'CANCELLED');
  fs.writeFileSync(path.join(SHOTS,'NOTES.md'),'# MB-9\n\n合成模型、语音与账号：主动来电、安全与语音可用性门卫，未来来电不被此前静默时段取消，关闭语音后待发来电取消；拒绝、接听重试、同一聊天开场只保存一次、未接语音留言与回电、过期操作、两个客户端竞争接听全部验证。390 / 1440 浅深截图，卡片宽度含内边距；已启用合成通知渠道仍不为来电创建渠道投递。系统通知继续搁置；原音不保存。\n');
  console.log('[mb-incoming] PASS 未接留言与回电、过期拒绝、竞争接听；无系统或渠道通知');
 }catch(e){await page.screenshot({path:path.join(SHOTS,'failure.png')});throw Error(`mb-incoming ${stage}: ${e.message}`);}
 finally{await browser.close();await ctx.fixtureHttp.setOverride('vc03m-chat',null);}
}
export const mbIncomingScene={id:'mb-incoming',title:'MB-9 H5 主动来电、接听拒绝、未接留言与回电',needs:['catalog','stack','browser','fixture'],default:false,run:sceneMbIncoming};
