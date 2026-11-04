// NF-05复用原语音受管fixture、Go API和生产媒体叶，不使用真实引擎或通知。
import assert from 'node:assert/strict';
import { openVoiceChat, sendVoiceTurn, voiceControl } from './voice-accept-lib.mjs';
import { captureWindows } from './desktop-chat-accept.mjs';

export async function sceneDesktopMedia(ctx) {
    await voiceControl('asr');
    const { browser, page, st, card, file, nativeRequests } = await openVoiceChat(ctx, 'NF05 合成媒体', { fakeAudio: true, standalone: true });
    const errors = [], failures = []; page.on('pageerror', error => errors.push(error.name + ': ' + error.message));
    page.on('response', async response => { if (response.url().endsWith('/generate') && response.status() >= 400) { const body = await response.json().catch(() => ({})); failures.push({ status: response.status(), code: body.code || body.error?.code || body.error?.type, fields: Object.keys(body) }); } });
    const read = async () => (await st.call('POST', '/api/chats/get', { avatar_url: card.avatar, file_name: file })).json;
    let stage = 'voice-reply';
    try {
        await voiceControl('kokoro', { delayMs: 400 });
        await sendVoiceTurn(page, ctx, { text: '想听你的声音', reply: '我在呀<voice/>' });
        stage = 'voice-ready'; await page.waitForFunction(() => SillyTavern.getContext().chat.at(-1).extra?.vc_voice?.status === 'ready');
        const bar = page.locator('#chat>.mes:last-child .vc-voice-bar'); await bar.waitFor({ state: 'visible' });
        stage = 'voice-play'; await bar.click(); await page.waitForFunction(() => document.querySelector('#chat>.mes:last-child .vc-voice-bar')?.getAttribute('aria-pressed') === 'true');
        await page.locator('#chat>.mes:last-child .vc-voice-transcribe').click(); await page.locator('#chat>.mes:last-child .vc-voice-text').waitFor({ state: 'visible' });
        assert.ok((await read()).at(-1).mes.endsWith('<voice/>'), '原始语音标记仍由ST保存');
        await page.locator('#chat>.mes:last-child .vc-voice-speed').click();
        await bar.click(); await page.waitForFunction(() => document.querySelector('#chat>.mes:last-child .vc-voice-bar')?.getAttribute('aria-pressed') === 'false');
        await voiceControl('kokoro');
        stage = 'voice-input';
        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: '合成语音输入回复。', chunks: 1, tool: null });
        const mic = page.locator('#vc-voice-input'); await mic.waitFor({ state: 'visible' }); await mic.click();
        await page.waitForFunction(() => document.querySelector('#vc-voice-input-note')?.textContent.startsWith('1″'));
        await mic.click();
        await page.waitForFunction(() => !document.querySelector('#mes_stop') && SillyTavern.getContext().chat.some(row => row.extra?.vc_voice_input?.durationMs > 0));
        assert.equal(await page.evaluate(() => SillyTavern.getContext().chat.findLast(row => row.is_user).extra.vc_voice_input.emotion), 'HAPPY');
        assert.ok(await page.locator('#chat .mes[is_user="true"] .vc-voice-text').last().isVisible());
        const state = await (await fetch(`http://127.0.0.1:${process.env.VC_W03_FIXTURE_PORT}/__voice/state`)).json();
        assert.equal(state.asr.calls, 1); assert.deepEqual(state.asr.requests[0], { sampleRate: 16000, channels: 1, bits: 16 });
        stage = 'read-aloud/image/sticker';
        await sendVoiceTurn(page, ctx, { text: '合成普通文字', reply: '这是用于朗读和图片查看的合成内容。' });
        const original = (await read()).at(-1).mes;
        await page.locator('#chat>.mes').last().hover(); await page.locator('#chat>.mes:last-child [data-vc-act="read"]').click();
        await page.waitForFunction(() => document.querySelector('#chat>.mes:last-child [data-vc-act="read"]')?.getAttribute('aria-pressed') === 'true');
        assert.equal((await read()).at(-1).mes, original, '朗读不改原消息文字');
        await page.locator('#chat>.mes').last().hover(); await page.locator('#chat>.mes:last-child [data-vc-act="read"]').click();
        await page.waitForFunction(() => document.querySelector('#chat>.mes:last-child [data-vc-act="read"]')?.getAttribute('aria-pressed') === 'false');
        await page.evaluate(async () => {
            const context = SillyTavern.getContext(), message = context.chat.at(-1);
            const image = document.createElement('canvas'); image.width = 320; image.height = 240; const paint = image.getContext('2d'); paint.fillStyle = '#90a8c0'; paint.fillRect(0, 0, 320, 240);
            message.extra.media = [{ type: 'image', url: image.toDataURL('image/png'), title: '合成图片' }]; await context.saveChat();
        });
        const image = page.locator('#chat>.mes:last-child .vc-mes-media img'); await image.waitFor({ state: 'visible' }); await image.click();
        await page.getByRole('button', { name: '关闭', exact: true }).click();
        await page.locator('#vc-emoji-btn').click(); await page.locator('#vc-emoji-panel').getByText('贴纸', { exact: true }).click();
        const sticker = page.locator('#vc-emoji-panel [data-k="s"]').first(); await sticker.click();
        await page.waitForFunction(() => document.body.dataset.generating !== 'true' && !document.querySelector('#mes_stop') && !SillyTavern.getContext().chat.at(-1).is_user && SillyTavern.getContext().chat.findLast(row => row.is_user).mes.startsWith('<sticker'));
        assert.equal(await page.locator('#vc-chat-gen').count(), 0, '贴纸发送不得失败');
        assert.ok((await read()).at(-2).mes.startsWith('<sticker'), '贴纸通过唯一Session正常发送');
        await captureWindows(page, ctx, 'nf-media');
        assert.deepEqual(errors, []); assert.deepEqual(nativeRequests, []);
        return { voiceReply: true, playback: true, rate: true, transcript: true, voiceInput: true, pcm16: true, readAloud: true, image: true, lightbox: true, stickers: true, nativeRequests: 0 };
    } catch (error) { const state = await page.evaluate(() => { const c = SillyTavern.getContext(), m = c.chat.at(-1); return { busy: document.body.dataset.generating, status: m.extra?.vc_voice?.status, attempt: m.extra?.vc_voice_attempt?.sent, marker: m.mes.endsWith('<voice/>'), hasSource: Boolean(m.extra?.vc_source?.id), notice: document.querySelector('#vc-chat-gen')?.textContent }; }); throw new Error(`NF05 media/${stage}: ${error.message}; ${JSON.stringify({ state, errors, nativeRequests, failures })}`); }
    finally { await browser.close(); await ctx.fixtureHttp.setOverride('vc03m-chat', null); await voiceControl('kokoro'); await voiceControl('asr'); }
}
export const desktopMediaScene = { id: 'nf-media', title: 'NF-05 独立桌面实际语音/录音、图片灯箱与贴纸', needs: ['catalog', 'stack', 'fixture', 'browser'], default: false, run: sceneDesktopMedia };
