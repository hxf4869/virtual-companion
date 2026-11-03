import './react-dom-bootstrap.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceBubble, createVoicePlayer, nextVoiceRate, voiceDeskWidth, voiceWaveHeights, clampTime, formatVoiceRate, readVoiceRate, writeVoiceRate } from '../extension/vc-model-settings/voice.js';
import { installReactDom } from './react-dom.mjs';

test('波形高度稳定、24 根、范围合法，不同 clipId 不同', () => {
    const a = voiceWaveHeights('123');
    assert.equal(a.length, 24);
    assert.deepEqual(a, voiceWaveHeights('123'));
    assert.notDeepEqual(a, voiceWaveHeights('124'));
    assert.ok(a.every((v) => v >= 28 && v <= 100));
});

test('宽度 clamp、倍速循环与持久化', () => {
    assert.equal(voiceDeskWidth(1), 96);
    assert.equal(voiceDeskWidth(5), 126);
    assert.equal(voiceDeskWidth(60), 224);
    assert.deepEqual([1, 1.5, 2, 0.5].map(nextVoiceRate), [1.5, 2, 0.5, 1]);
    assert.equal(formatVoiceRate(1.5), '1.5x');
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    assert.equal(readVoiceRate(storage), 1);
    writeVoiceRate(2, storage);
    assert.equal(readVoiceRate(storage), 2);
    assert.equal(clampTime(-3, 10), 0);
    assert.equal(clampTime(30, 10), 10);
});

test('播放器 seek 只作用于当前语音并限制在时长内', async () => {
    const audio = { paused: true, currentTime: 0, duration: 8, playbackRate: 1, addEventListener() {}, async play() { this.paused = false; }, pause() { this.paused = true; }, removeAttribute() {}, load() {} };
    const player = createVoicePlayer({ createAudio: () => audio });
    assert.equal(player.seek('1', 2), false);
    await player.toggle('1');
    player.setRate(1.5);
    assert.equal(audio.playbackRate, 1.5);
    assert.equal(player.seek('1', 20), true);
    assert.equal(audio.currentTime, 8);
    assert.equal(player.seek('2', 1), false);
    assert.equal(player.peek('1').duration, 8);
});

test('桌面语音条有 24 根柱与倍速按钮，手机保持 5 根且无倍速', (t) => {
    const document = installReactDom(t);
    const phone = createVoiceBubble({ document, text: 'hi', voice: { clipId: '7', status: 'ready', durationMs: 4000 } });
    assert.equal(phone.querySelectorAll('i').length, 5);
    assert.equal(phone.querySelector('.vc-voice-speed'), null);
    document.documentElement.dataset.vcLayout = 'desktop';
    const desk = createVoiceBubble({ document, text: 'hi', voice: { clipId: '7', status: 'ready', durationMs: 4000 } });
    assert.equal(desk.querySelectorAll('i').length, 24);
    assert.ok(desk.classList.contains('vc-voice-desk'));
    assert.equal(desk.style.getPropertyValue('--vc-voice-w'), '112px');
    assert.equal(desk.querySelector('.vc-voice-speed').getAttribute('aria-label'), '播放速度');
});
