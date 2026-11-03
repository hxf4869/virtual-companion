// 显式选择的真实 TTS / ASR 验收。地址由私有环境注入，产物不保留音频或转写。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createStClient, waitFor } from './managed-lib.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import { pinVcUi } from './vc-ui-pin.mjs';

export async function prepareVoiceRealArtifacts(root, stamp) {
    const current = path.join(root, `voice-real-${stamp}`);
    await fs.mkdir(current, { recursive: true, mode: 0o700 });
    const runs = (await fs.readdir(root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && /^voice-real-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(entry.name))
        .map(entry => entry.name).sort();
    for (const old of runs.slice(0, -5)) await fs.rm(path.join(root, old), { recursive: true });
    return current;
}

export async function sceneVoiceReal(ctx) {
    await reauthForWrite(ctx);
    const call = async (method, route, body, expected = 200) => {
        const result = await ctx.admin.call(method, route, body);
        assert.equal(result.status, expected, `real voice API ${method} HTTP status`);
        return result.json;
    };
    const engines = await call('GET', '/api/v1/voice/engines');
    assert.ok(engines.asr.configured && engines.asr.enabled && engines.asr.healthy, 'real ASR is available through Go');
    assert.ok(['kokoro', 'cosyvoice'].every(name => engines.tts.some(engine => engine.engine === name && engine.configured && engine.enabled && engine.healthy && engine.voices.length)), 'both real TTS engines are available through Go');
    const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: ctx.secrets.session,
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}` });
    const card = await importSyntheticCard(st, '真实语音验收');
    const identity = crypto.randomUUID();
    const binding = await call('POST', '/api/v1/st/bindings', {
        chatIdentity: identity, characterRef: card.avatar, mode: 'COMPANION', displayName: '真实语音验收',
    });
    const settings = await call('GET', '/api/v1/voice/settings');
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
        ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await pinVcUi(context, 'on');
        await context.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase },
        ]);
        const page = await context.newPage();
        await page.goto(ctx.w05.stBase + '/native/');
        await page.waitForFunction(() => window.SillyTavern?.getContext?.()?.eventSource);
        const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
        if (await onboarding.count()) {
            await onboarding.locator('textarea').fill('语音验收用户');
            await onboarding.locator('.popup-button-ok').click();
        }
        await page.locator('#preloader').waitFor({ state: 'hidden' });
        await page.locator('#vc-shell').waitFor();
        ctx.results.voiceReal = { engines: [], audioRetained: false, transcriptRetained: false };
        for (const name of ['kokoro', 'cosyvoice']) {
            const engine = engines.tts.find(item => item.engine === name);
            const voice = (name === 'kokoro' ? engine.voices.find(item => /^z[fm]_/.test(item.id)) : null) || engine.voices[0];
            const queued = await call('POST', '/api/v1/voice/preview', { relationshipId: binding.relationshipId, engine: name, voice: voice.id }, 202);
            console.log(`[voice-real] ${name} 真实试听已入队`);
            let clip;
            await waitFor(async () => {
                clip = await call('GET', `/api/v1/voice-clips/${queued.clipId}`);
                if (['failed', 'expired'].includes(clip.status)) throw new Error(`real ${name} ${clip.status}: ${clip.errorKind || 'unclassified'}`);
                return clip.status === 'ready';
            }, { timeoutMs: (name === 'kokoro' ? settings.kokoroTimeoutSeconds : settings.cosyVoiceTimeoutSeconds) * 1000 + 15000, intervalMs: 200, label: `${name} real synthesis` });
            const audio = await page.evaluate(async id => {
                const { voiceAudioUrl, voicePlayer } = await import('/scripts/extensions/third-party/vc-model-settings/voice.js');
                const { recordingWAV } = await import('/scripts/extensions/third-party/vc-model-settings/voice-input.js');
                const api = await import('/scripts/extensions/third-party/vc-model-settings/api.js');
                const response = await fetch(voiceAudioUrl(id));
                if (!response.ok) throw Error('Real audio download failed');
                const bytes = await response.arrayBuffer();
                const decoder = new AudioContext();
                let decoded;
                try { decoded = await decoder.decodeAudioData(bytes.slice(0)); } finally { await decoder.close(); }
                const samples = decoded.getChannelData(0);
                const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
                const played = await voicePlayer.toggle(id);
                const deadline = performance.now() + 5000;
                while (performance.now() < deadline && !(voicePlayer.peek(id)?.currentTime > .1)) await new Promise(resolve => setTimeout(resolve, 25));
                const playback = voicePlayer.peek(id);
                const seek = voicePlayer.seek(id, decoded.duration * .6);
                voicePlayer.stop();
                const converted = await recordingWAV(new Blob([bytes], { type: 'audio/wav' }));
                const result = await api.transcribeVoice(converted.wav);
                const text = String(result.text || '');
                const matched = ['你好', '高兴', '认识', '今天', '陪', '说话'].filter(word => text.includes(word)).length;
                return { bytes: bytes.byteLength, durationMs: Math.round(decoded.duration * 1000), rms,
                    playback: played && playback?.currentTime > .1, seek, recordingMs: converted.durationMs,
                    recognizedChars: [...text].length, matchedPreviewKeywords: matched };
            }, queued.clipId);
            assert.ok(audio.bytes > 1000 && audio.durationMs > 800 && audio.rms > .001, 'real speech contains decodable non-silent audio');
            assert.ok(audio.playback && audio.seek, 'real speech plays and seeks through the production player');
            assert.ok(audio.matchedPreviewKeywords >= 3, 'real ASR recognizes the fixed preview speech');
            assert.ok(Math.abs(audio.durationMs - clip.durationMs) < 100, 'persisted voice duration matches decoded audio');
            ctx.results.voiceReal.engines.push({ engine: name, voices: engine.voices.length, generationMs: clip.generationMs, ...audio });
            console.log(`[voice-real] ${name} 合成、播放、拖动与真实 ASR 回环通过`);
        }
    } finally { await browser.close(); }
}

export const voiceRealScene = { id: 'voice-real', title: 'Owner 显式授权真实 Kokoro / CosyVoice / ASR 回环',
    needs: ['go', 'stack', 'browser'], default: false, run: sceneVoiceReal };
