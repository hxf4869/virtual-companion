import assert from 'node:assert/strict';
import { waitFor } from './managed-lib.mjs';
import { openVoiceChat, voiceCall, voiceControl, voiceExtension, voiceShots } from './voice-accept-lib.mjs';

export async function sceneVoiceProactive(ctx) {
    const { browser, page } = await openVoiceChat(ctx, '主动语音');
    try {
        const owner=String(ctx.w05.ownerId);
        const relationship=await page.evaluate(()=>String(SillyTavern.getContext().chatMetadata.vc_binding.relationshipId));
        assert.match(owner,/^[1-9][0-9]*$/); assert.match(relationship,/^[1-9][0-9]*$/);
        const now=new Date(); const early=new Date(now.getTime()+600000);
        const insert = (planned, text='合成主动语音') => ctx.w10.psql(`INSERT INTO vc.proactive_message(owner_user_id,relationship_id,trigger_key,kind,cluster_key,status,body,planned_at,armed_at,voice_selected)
            VALUES(${owner},${relationship},'good_morning','check_in','greeting','READY','${text}','${planned.toISOString()}','${now.toISOString()}',true) RETURNING id;`).trim();
        const run=(at)=>voiceCall(ctx,'POST',`/api/v1/relationships/${relationship}/proactive-run`,{now:at.toISOString()});
        await voiceControl('cosyvoice');
        const id=insert(early);
        await run(now);
        await waitFor(()=>ctx.w10.psql(`SELECT count(*) FROM vc.voice_clip WHERE owner_user_id=${owner} AND message_ref='proactive:${id}' AND status='ready';`).trim()==='1',{label:'proactive voice ready',timeoutMs:10000});
        await run(early);
        const inbox=(await voiceCall(ctx,'GET','/api/v1/inbox')).filter((row)=>row.relationshipId===relationship);
        assert.ok(inbox.some((row)=>row.voice?.status==='ready'),'ready voice attached at delivery');
        await page.evaluate(()=>window.dispatchEvent(new CustomEvent('vc-view-inbox')));
        await page.waitForSelector('[data-vc-inbox-voice] .vc-voice-bar',{state:'visible',timeout:10000});
        await voiceShots(page,ctx,'VO-5','proactive');
        const short=insert(new Date(now.getTime()+120000),'合成短提前量文字');
        await run(now);
        assert.equal(ctx.w10.psql(`SELECT count(*) FROM vc.voice_clip WHERE owner_user_id=${owner} AND message_ref='proactive:${short}';`).trim(),'0','CosyVoice needs five minute lead');
        await run(new Date(now.getTime()+120000));
        const delivered=(await voiceCall(ctx,'GET','/api/v1/inbox')).find((row)=>row.body==='合成短提前量文字');
        assert.ok(delivered && !delivered.voice,'text delivery without late attachment');
        const cancelled=insert(new Date(now.getTime()+1800000),'合成取消语音');
        await voiceControl('cosyvoice',{delayMs:2000}); await run(now);
        ctx.w10.psql(`UPDATE vc.proactive_message SET status='CANCELLED' WHERE owner_user_id=${owner} AND id=${cancelled};`);
        assert.equal(ctx.w10.psql(`SELECT count(*) FROM vc.voice_clip WHERE owner_user_id=${owner} AND message_ref='proactive:${cancelled}';`).trim(),'0','cancel removes queued/running audio');
        await voiceControl('cosyvoice');
    } finally { await browser.close(); }
}
export const voiceProactiveScene={id:'voice-proactive',title:'VO-5 主动语音预生成、提前量、投递快照和取消',needs:['catalog','stack','fixture','browser'],default:false,run:sceneVoiceProactive};
