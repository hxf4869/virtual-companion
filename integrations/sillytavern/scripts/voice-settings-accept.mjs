import assert from 'node:assert/strict';
import { openVoiceChat, voiceCall, voiceExtension, voiceShots } from './voice-accept-lib.mjs';

export async function sceneVoiceSettings(ctx){
    const {browser,page,card}=await openVoiceChat(ctx,'声音设置');
    try{
        const relationship=await page.evaluate(()=>String(SillyTavern.getContext().chatMetadata.vc_binding.relationshipId));
        await page.evaluate(()=>[...document.querySelectorAll('#vc-shell [data-settings]')].find((node)=>node.getClientRects().length)?.click());
        await page.locator('.vc-settings-form [data-action="voice"]').click();
        let form=page.locator('[data-voice-settings="global"]');await form.locator('[data-voice-field="dailyChatLimit"]').waitFor();
        await form.locator('[data-voice-field="dailyChatLimit"]').fill('61');await form.locator('button[type="submit"]').click();
        await form.getByText('已保存',{exact:true}).waitFor();
        const saved=await voiceCall(ctx,'GET','/api/v1/voice/settings');assert.equal(saved.dailyChatLimit,61);
        const {revision,updatedAt,...values}=saved;
        await voiceCall(ctx,'PUT','/api/v1/voice/settings',{...values,expectedRevision:revision,dailyChatLimit:62});
        await form.locator('[data-voice-field="dailyChatLimit"]').fill('63');await form.locator('button[type="submit"]').click();
        await form.getByText('设置已在另一处更新。你的输入已保留。',{exact:true}).waitFor();assert.equal(await form.locator('[data-voice-field="dailyChatLimit"]').inputValue(),'63');
        await form.getByText('加载最新',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-voice-field="dailyChatLimit"]')?.value==='62');
        await voiceShots(page,ctx,'VO-8','global');
        await page.locator('.vc-sheet').last().locator('.vc-sheet-done').click();
        await page.evaluate(()=>{[...document.querySelectorAll('.vc-sheet-done,[data-settings-done]')].filter((el)=>el.getClientRects().length).forEach((el)=>el.click());window.dispatchEvent(new CustomEvent('vc-open-characters'));});
        await page.locator('[data-action="select-template"]').filter({hasText:card.name}).click();
        await page.locator('[data-action="edit-voice"]').click();
        form=page.locator('[data-voice-settings="relationship"]');
        await form.locator('[data-voice-field="kokoroVoice"]').selectOption('zm_010');
        await form.locator('[data-voice-field="speed"]').fill('1.1');await form.locator('[data-voice-field="voiceFrequency"]').selectOption('HIGH');await form.locator('[data-voice-field="proactiveEngine"]').selectOption('kokoro');
        await form.locator('button[type="submit"]').click();await form.getByText('已保存',{exact:true}).waitFor();
        const rel=(await voiceCall(ctx,'GET','/api/v1/relationships')).find((row)=>String(row.relationshipId)===relationship);
        assert.equal(rel.kokoroVoice,'zm_010');assert.equal(rel.speed,1.1);assert.equal(rel.voiceFrequency,'HIGH');assert.equal(rel.proactiveEngine,'kokoro');
        await form.locator('[data-preview-engine="kokoro"]').click();await page.waitForFunction(()=>document.querySelector('[data-preview-engine="kokoro"]')?.disabled===false);
        await voiceShots(page,ctx,'VO-8','relationship');
        await page.evaluate(async(base)=>(await import(`${base}/voice.js`)).voicePlayer.stop(),voiceExtension);
    }finally{await browser.close();}
}
export const voiceSettingsScene={id:'voice-settings',title:'VO-8 设置读回、revision 冲突、角色音色与试听',needs:['catalog','stack','fixture','browser'],default:false,run:sceneVoiceSettings};
