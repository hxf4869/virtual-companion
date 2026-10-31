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
        await page.waitForFunction(()=>document.querySelector('[data-voice-settings="relationship"]') || document.querySelector('.vc-menu[role="menu"]'));
        if(await page.locator('.vc-menu[role="menu"]').count()){
            const rows=await voiceCall(ctx,'GET','/api/v1/relationships');
            const current=rows.find((row)=>String(row.relationshipId)===relationship);
            const choices=rows.filter((row)=>row.characterRef===current.characterRef);
            const index=choices.findIndex((row)=>String(row.relationshipId)===relationship);
            assert.ok(index>=0,'声音菜单包含当前实例');
            const names=await page.locator('.vc-menu [role="menuitem"]').allTextContents();
            assert.equal(new Set(names).size,names.length,'同名实例在声音菜单中能区分');
            await page.locator(`.vc-menu [data-i="${index}"]`).click();
        }
        form=page.locator('[data-voice-settings="relationship"]');
        await form.locator('[data-voice-field="kokoroVoice"]').selectOption('zm_010');
        const speed=form.locator('[data-voice-field="speed"]');await speed.focus();await speed.press('ArrowRight');await speed.press('ArrowRight');
        assert.equal(await speed.inputValue(),'1.1','keyboard adjusts speed slider');
        await form.locator('[data-voice-field="voiceFrequency"]').selectOption('HIGH');await form.locator('[data-voice-field="proactiveEngine"]').selectOption('kokoro');
        await form.locator('button[type="submit"]').click();await form.getByText('已保存',{exact:true}).waitFor();
        const rel=(await voiceCall(ctx,'GET','/api/v1/relationships')).find((row)=>String(row.relationshipId)===relationship);
        assert.equal(rel.kokoroVoice,'zm_010');assert.equal(rel.speed,1.1);assert.equal(rel.voiceFrequency,'HIGH');assert.equal(rel.proactiveEngine,'kokoro');
        await form.locator('[data-preview-engine="kokoro"]').click();await page.waitForFunction(()=>document.querySelector('[data-preview-engine="kokoro"]')?.disabled===false);
        await voiceShots(page,ctx,'VO-8','relationship');
        await page.evaluate(async(base)=>(await import(`${base}/voice.js`)).voicePlayer.stop(),voiceExtension);
        await page.evaluate(()=>{document.querySelectorAll('.vc-sheet-done').forEach((node)=>node.click());[...document.querySelectorAll('#vc-shell [data-settings]')].find((node)=>node.getClientRects().length)?.click();});
        await page.locator('.vc-settings-form [data-action="data"]').click();
        await page.waitForFunction(()=>/\d/.test(document.querySelector('[data-vc-voice-usage]')?.textContent||''));
        await voiceShots(page,ctx,'VO-10','voice-storage');
    }finally{await browser.close();}
}
export const voiceSettingsScene={id:'voice-settings',title:'VO-8 设置读回、revision 冲突、角色音色与试听',needs:['catalog','stack','fixture','browser'],default:false,run:sceneVoiceSettings};
