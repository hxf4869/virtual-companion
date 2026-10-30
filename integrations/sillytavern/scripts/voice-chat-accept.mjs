import assert from 'node:assert/strict';
import { openVoiceChat, sendVoiceTurn, voiceControl, voiceExtension, voiceShots } from './voice-accept-lib.mjs';

export async function sceneVoiceChat(ctx) {
    const { browser, page } = await openVoiceChat(ctx);
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
        await sendVoiceTurn(page, ctx, { reply: '超时后保留合成文字<voice/>' });
        await page.waitForFunction(() => SillyTavern.getContext().chat.at(-1).extra?.vc_voice?.status === 'failed', null, { timeout: 18000 });
        await voiceControl('kokoro'); // Waits for the real late response before asserting.
        assert.equal(await page.evaluate(() => SillyTavern.getContext().chat.at(-1).extra.vc_voice.status), 'failed', 'late audio never replaces text');
        await page.evaluate(async (base) => (await import(`${base}/voice.js`)).voicePlayer.stop(), voiceExtension);
    } finally { await browser.close(); await ctx.fixtureHttp.setOverride('vc03m-chat', null); }
}
export const voiceChatScene = { id: 'voice-chat', title: 'VO-3/4 语音条、频率、点名、失败与 15 秒文字回落', needs: ['catalog', 'stack', 'browser', 'fixture'], default: false, run: sceneVoiceChat };
