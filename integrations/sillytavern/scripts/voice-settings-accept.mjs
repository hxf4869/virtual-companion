import assert from 'node:assert/strict';
import { openVoiceChat, voiceCall, voiceExtension, voiceShots } from './voice-accept-lib.mjs';

export async function sceneVoiceSettings(ctx){
    const {browser,page,card}=await openVoiceChat(ctx,'声音设置');
    try{
        const relationship=await page.evaluate(()=>String(SillyTavern.getContext().chatMetadata.vc_binding.relationshipId));
        await page.evaluate(()=>[...document.querySelectorAll('#vc-shell [data-settings]')].find((node)=>node.getClientRects().length)?.click());
        await page.locator('.vc-settings-form [data-action="voice"]').click();
        const openGlobal=async()=>{await page.locator('.vc-settings-form [data-action="voice"]').click();await page.locator('[data-voice-settings="global"] [data-voice-field="dailyChatLimit"]').waitFor();};
        const done=()=>page.locator('.vc-sheet').last().locator('.vc-sheet-done');
        const submitDone=async()=>{
            const response=page.waitForResponse(r=>r.url().includes('/voice/settings') && r.request().method()==='PUT' || r.url().includes('/relationships/') && r.request().method()==='PATCH');
            await page.route('**/api/plugins/virtual-companion/go/api/v1/**',async route=>{const method=route.request().method();if(method==='PUT'||method==='PATCH'){const result=await route.fetch();await new Promise(resolve=>setTimeout(resolve,200));await route.fulfill({response:result});}else await route.continue();});
            await done().click();
            assert.equal(await done().textContent(),'保存中…');assert.equal(await done().isDisabled(),true);
            await response;await page.unroute('**/api/plugins/virtual-companion/go/api/v1/**');
        };
        let form=page.locator('[data-voice-settings="global"]');await form.locator('[data-voice-field="dailyChatLimit"]').waitFor();
        await page.setViewportSize({width:1440,height:900});
        const sheet=page.locator('.vc-sheet').last();
        await page.waitForFunction(()=>{
            const sheet=[...document.querySelectorAll('.vc-sheet')].at(-1);const r=sheet?.getBoundingClientRect();
            return r && r.width<=721 && r.left>=31 && r.right<=innerWidth-31 && r.top>=31 && r.bottom<=innerHeight-31;
        });
        assert.equal(await sheet.locator('.vc-sheet-grab').isVisible(),false,'desktop dialog has no mobile drag handle');
        await page.setViewportSize({width:390,height:844});
        await form.locator('[data-voice-field="dailyChatLimit"]').fill('61');
        await page.keyboard.press('Escape');await page.getByRole('alertdialog',{name:'放弃更改？'}).waitFor();
        assert.equal(await page.evaluate(()=>document.activeElement.textContent),'继续编辑');await page.keyboard.press('Escape');await page.locator('.vc-alert').waitFor({state:'detached'});
        assert.equal(await form.locator('[data-voice-field="dailyChatLimit"]').inputValue(),'61');
        await submitDone();await form.waitFor({state:'detached'});await page.locator('.vc-toast').getByText('已保存',{exact:true}).waitFor();
        await openGlobal();
        const saved=await voiceCall(ctx,'GET','/api/v1/voice/settings');assert.equal(saved.dailyChatLimit,61);
        const {revision,updatedAt,...values}=saved;
        await voiceCall(ctx,'PUT','/api/v1/voice/settings',{...values,expectedRevision:revision,dailyChatLimit:62});
        await form.locator('[data-voice-field="dailyChatLimit"]').fill('63');await submitDone();
        await form.getByText('设置已在另一处更新。你的输入已保留。',{exact:true}).waitFor();assert.equal(await form.locator('[data-voice-field="dailyChatLimit"]').inputValue(),'63');
        await form.getByText('加载最新',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-voice-field="dailyChatLimit"]')?.value==='62');
        await voiceShots(page,ctx,'VO-8','global');
        await page.setViewportSize({width:390,height:844});
        await done().click();await page.locator('[data-voice-settings="global"]').waitFor({state:'detached'});
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
        await submitDone();await page.locator('[data-voice-settings="relationship"]').waitFor({state:'detached'});await page.locator('.vc-toast').getByText('已保存',{exact:true}).waitFor();
        await page.evaluate(async(id)=>{const mod=await import('/scripts/extensions/third-party/vc-model-settings/voice-settings.js');await mod.openRelationshipVoiceSettings(id);},relationship);
        await form.locator('[data-voice-field="kokoroVoice"]').waitFor();
        const rel=(await voiceCall(ctx,'GET','/api/v1/relationships')).find((row)=>String(row.relationshipId)===relationship);
        assert.equal(rel.kokoroVoice,'zm_010');assert.equal(rel.speed,1.1);assert.equal(rel.voiceFrequency,'HIGH');assert.equal(rel.proactiveEngine,'kokoro');
        await form.locator('[data-preview-engine="kokoro"]').click();await page.waitForFunction(()=>document.querySelector('[data-preview-engine="kokoro"]')?.disabled===false);
        const previewButton=form.locator('[data-preview-engine="kokoro"]');
        assert.equal(await previewButton.evaluate(node=>getComputedStyle(node).whiteSpace),'nowrap','试听与暂停文案不换行');
        await voiceShots(page,ctx,'VO-8','relationship');
        await page.evaluate(async(base)=>(await import(`${base}/voice.js`)).voicePlayer.stop(),voiceExtension);
        await page.setViewportSize({width:390,height:844});await done().click();await form.waitFor({state:'detached'});
        await page.evaluate(()=>window.dispatchEvent(new CustomEvent('vc-shell-navigate',{detail:{destination:'settings'}})));
        await page.locator('.vc-settings-form').waitFor();
        await page.locator('.vc-settings-form [data-action="data"]').click();
        await page.waitForFunction(()=>/\d/.test(document.querySelector('[data-vc-voice-usage]')?.textContent||''));
        await voiceShots(page,ctx,'VO-10','voice-storage');
    }finally{await browser.close();}
}
export const voiceSettingsScene={id:'voice-settings',title:'VO-8 设置读回、revision 冲突、角色音色与试听',needs:['catalog','stack','fixture','browser'],default:false,run:sceneVoiceSettings};
