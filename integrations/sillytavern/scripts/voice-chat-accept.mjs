import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import { openVoiceChat, sendVoiceTurn, voiceControl, voiceExtension, voiceShots } from './voice-accept-lib.mjs';

export async function sceneVoiceChat(ctx) {
    const { browser, page, file } = await openVoiceChat(ctx);
    let stage='native voice bars';
    try {
        await voiceControl('kokoro', { delayMs: 1500 });
        await sendVoiceTurn(page, ctx, { text: '晚安呀', reply: '晚安，做个好梦<voice/>' });
        await page.locator('#chat .vc-voice-pending').waitFor({ state: 'visible' });
        await page.locator('#chat .vc-voice-bar').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => SillyTavern.getContext().chat.at(-1).mes.endsWith('<voice/>')), true, 'marker stays persisted');
        const bar = page.locator('#chat .vc-voice-bar').last();
        await bar.focus(); await page.keyboard.press('Space');
        await page.waitForFunction(() => document.querySelector('#chat .vc-voice-bar')?.getAttribute('aria-pressed') === 'true');
        await page.locator('#chat .vc-voice-transcribe').last().click();
        await page.locator('#chat .vc-voice-text').last().waitFor({ state: 'visible' });
        await voiceShots(page, ctx, 'VO-3', 'voice-chat');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const reduced = await page.evaluate(() => [...document.querySelectorAll('.vc-voice-wave i')].every((node) => getComputedStyle(node).animationName === 'none'));
        assert.equal(reduced, true, 'reduced motion static');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await voiceControl('kokoro');
        await sendVoiceTurn(page, ctx, { text: '接着聊', reply: '还没睡呀<voice/>' });
        await page.waitForFunction(() => SillyTavern.getContext().chat.at(-1).extra?.vc_voice_attempt?.sent === false);
        assert.equal(await page.locator('#chat .vc-voice-bar').count(), 1, 'frequency gate');
        await sendVoiceTurn(page, ctx, { text: '说句话给我听', reply: '好呀，我陪着你<voice/>' });
        await page.waitForFunction(() => SillyTavern.getContext().chat.at(-1).extra?.vc_voice?.status === 'ready');
        assert.equal(await page.locator('#chat .vc-voice-bar').count(), 2, 'explicit request bypasses frequency');
        await page.locator('#chat .vc-voice-bar').first().click();
        await page.locator('#chat .vc-voice-bar').last().click();
        assert.ok(await page.locator('#chat .vc-voice-bar[aria-pressed="true"]').count() <= 1, 'singleton player');
        await voiceShots(page, ctx, 'VO-4', 'voice-reply');
        await voiceControl('kokoro', { status: 500, failures: -1 });
        await sendVoiceTurn(page, ctx, { reply: '失败时留下这条合成文字<voice/>' });
        await page.waitForFunction(() => SillyTavern.getContext().chat.at(-1).extra?.vc_voice?.status === 'failed');
        assert.equal(await page.locator('#chat > .mes').last().locator('.vc-voice').count(), 0, 'failure uses text');
        await voiceControl('kokoro', { delayMs: 18000 });
        stage='native 15 second voice deadline';
        await sendVoiceTurn(page, ctx, { reply: '超时后保留合成文字<voice/>' });
        await page.waitForFunction(() => SillyTavern.getContext().chat.at(-1).extra?.vc_voice?.status === 'failed', null, { timeout: 18000 });
        await voiceControl('kokoro'); // Waits for the real late response before asserting.
        assert.equal(await page.evaluate(() => SillyTavern.getContext().chat.at(-1).extra.vc_voice.status), 'failed', 'late audio never replaces text');
        stage='native read aloud';await sendVoiceTurn(page,ctx,{text:'讲一段合成示例文字',reply:'这是一段用于朗读验收的合成文字。'.repeat(7)});
        const read=page.locator('#chat > .mes').last().locator('[data-vc-act="read"]');await read.waitFor({state:'visible'});
        const original=await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).mes);
        await page.locator('#chat > .mes').last().dispatchEvent('contextmenu');await page.getByRole('menuitem',{name:'朗读',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#chat > .mes:last-child [data-vc-act="read"]')?.getAttribute('aria-pressed')==='true');
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).mes),original,'read aloud retains original');
        assert.equal(await page.locator('#chat > .mes').last().locator('.vc-voice').count(),0,'text reply stays text');
        await voiceShots(page,ctx,'VO-11','read-aloud');
        await page.evaluate(async (base) => (await import(`${base}/voice.js`)).voicePlayer.stop(), voiceExtension);
        stage='MB-7 H5 voice bars';await page.goto(`${ctx.w05.stBase}/m/?vcdebug=1`);await page.locator(`[data-chat-file="${file}"]`).click();await page.locator('.vc-connection').waitFor({state:'hidden'});
        const mobileBar=page.locator('.vc-mobile-voice button.vc-voice-bar').first();await mobileBar.waitFor();await mobileBar.click();await page.locator('.vc-mobile-voice .vc-voice-bar[aria-pressed="true"]').waitFor();
        await page.locator('.vc-mobile-voice .vc-voice-transcribe').first().click();await page.locator('.vc-mobile-voice .vc-voice-text').first().waitFor();
        assert.equal(await mobileBar.locator('.vc-voice-wave i').count(),12);
        const last=page.locator('.vc-message-group:not(.is-user) .vc-bubble').last();await last.dispatchEvent('contextmenu');await page.getByRole('menuitem',{name:'朗读',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('#vc-engine').contentDocument.querySelector('#chat > .mes:last-child [data-vc-act="read"]')?.getAttribute('aria-pressed')==='true');
        assert.equal(await page.evaluate(()=>globalThis.__vcEngine.messages().at(-1).text),original);assert.ok(await page.locator('.vc-mobile-voice .vc-voice-bar[aria-pressed="true"]').count()<=1);
        await voiceShots(page,ctx,'MB-7','voice-chat');console.log('[MB-7] PASS H5 语音播放、12 波形、转文字与原文朗读');
    } catch(error) {
        const state=await page.evaluate(()=>{const c=globalThis.SillyTavern?.getContext?.()||document.querySelector('#vc-engine')?.contentWindow?.SillyTavern?.getContext?.();const m=c?.chat?.at(-1);return {length:c?.chat?.length,voice:m?.extra?.vc_voice?.status,attempt:m?.extra?.vc_voice_attempt?.sent,source:!!m?.extra?.vc_source?.id,generating:document.body.getAttribute('data-generating')};});
        const dir=path.resolve('.review-queue/MB-7');fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,'voice-chat-failure.png')});
        throw Error(`voice-chat ${stage}: ${JSON.stringify(state)}; ${error.message}`);
    } finally { await browser.close(); await ctx.fixtureHttp.setOverride('vc03m-chat', null); }
}
export const voiceChatScene = { id: 'voice-chat', title: 'VO-3/4 语音条、频率、点名、失败与 15 秒文字回落', needs: ['catalog', 'stack', 'browser', 'fixture'], default: false, run: sceneVoiceChat };
