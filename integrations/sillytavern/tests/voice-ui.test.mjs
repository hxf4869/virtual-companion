import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceBubble, createVoicePlayer, renderMessageVoice, voiceAudioUrl, voiceWidth } from '../extension/vc-model-settings/voice.js';
import { installMiniDom } from './mini-dom.mjs';

function fakeAudio() {
    const listeners = {};
    return { paused: true, currentTime: 0, src: '',
        addEventListener(event, fn) { listeners[event] = fn; },
        async play() { this.paused = false; }, pause() { this.paused = true; },
        removeAttribute() { this.src = ''; }, load() {}, emit(type) { listeners[type]?.(); },
    };
}

test('单例切换、暂停续播、结束与销毁会同步旧语音条', async () => {
    const audio = fakeAudio();
    let created = 0;
    const player = createVoicePlayer({ createAudio: () => { created += 1; return audio; } });
    const a = []; const b = [];
    assert.equal(await player.toggle('11', { onState: (v) => a.push(v) }), true);
    audio.currentTime = .5;
    assert.equal(await player.toggle('11', { onState: (v) => a.push(v) }), false);
    assert.equal(await player.toggle('11', { onState: (v) => a.push(v) }), true);
    assert.equal(audio.currentTime, .5);
    await player.toggle('22', { onState: (v) => b.push(v) });
    assert.equal(a.at(-1), false);
    assert.equal(audio.src, voiceAudioUrl('22'));
    audio.emit('ended');
    assert.equal(b.at(-1), false);
    player.stop();
    assert.equal(audio.src, '');
    assert.equal(created, 1);
    assert.equal(voiceAudioUrl('https://other/audio'), '');
    assert.equal(voiceAudioUrl('1/../2'), '');
    assert.ok(voiceWidth(60000) <= 70);
});

test('播放被后一个点击取代时，旧 play promise 不会标记已播放', async () => {
    const audio = fakeAudio();
    const resolve = [];
    audio.play = () => new Promise((done) => resolve.push(done));
    const player = createVoicePlayer({ createAudio: () => audio });
    let a = 0; let b = 0;
    const first = player.toggle('1', { onPlayed: () => a++ });
    const second = player.toggle('2', { onPlayed: () => b++ });
    resolve[0](); resolve[1]();
    await Promise.all([first, second]);
    assert.equal(a, 0); assert.equal(b, 1);
});

test('转文字、录音状态和用户转写只用文本节点，不注入消息 HTML', async () => {
    const document = installMiniDom();
    const bubble = createVoiceBubble({ document, text: '<img src=x>你好<voice/>', voice: { clipId: '1', status: 'ready', durationMs: 1800 } });
    const text = bubble.querySelector('.vc-voice-text');
    const toggle = bubble.querySelector('.vc-voice-transcribe');
    assert.equal(text.hidden, true);
    toggle.dispatch('click');
    assert.equal(text.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(text.textContent, '<img src=x>你好');
    assert.equal(text.querySelector('img'), null);
    toggle.dispatch('click');
    assert.equal(text.hidden, true);
    const input = createVoiceBubble({ document, text: '识别结果', input: { durationMs: 1000 } });
    assert.equal(input.querySelector('.vc-voice-text').hidden, false);
    assert.equal(input.querySelector('.vc-voice-bar').tag, 'div');
    const pending = createVoiceBubble({ document, voice: { clipId: '1', status: 'running' } });
    assert.equal(pending.textContent, '正在录音…');
    assert.equal(pending.getAttribute('role'), 'status');
});

test('独立 H5 语音条用 12 根波形并随播放器进度标记已播部分',()=>{
    const document=installMiniDom();
    const player={peek:()=>({currentTime:2,duration:4}),toggle:async(_id,{onState})=>onState(true)};
    const bubble=createVoiceBubble({document,mobile:true,voice:{clipId:'1',status:'ready',durationMs:4000},player});
    assert.equal(bubble.querySelectorAll('i').length,12);bubble.querySelector('.vc-voice-bar').dispatch('click');
    assert.equal(bubble.querySelectorAll('.on').length,6);
});

test('通话输入与普通语音通过图标和可访问名称区分',()=>{
    const document=installMiniDom();
    const call=createVoiceBubble({document,text:'通话文字',input:{durationMs:1000,call:true}});
    assert.equal(call.querySelector('.vc-voice-bar').getAttribute('aria-label'),'语音通话');
    assert.match(call.querySelector('.vc-voice-glyph').innerHTML,/#phone/);
});

test('播放出错展开原文；ready 转 failed 撤销语音 UI', async () => {
    const document = installMiniDom();
    const player = { async toggle(_id, { onError }) { onError(); } };
    const bubble = createVoiceBubble({ document, text: '原文', voice: { clipId: '1', status: 'ready' }, player });
    bubble.querySelector('.vc-voice-bar').dispatch('click');
    assert.equal(bubble.querySelector('.vc-voice-text').hidden, false);
    const mes = document.createElement('div');
    const original = document.createElement('div'); original.className = 'mes_text'; mes.append(original);
    const message = { mes: '原文', extra: { vc_voice: { clipId: '1', status: 'ready', durationMs: 1000 } } };
    assert.equal(renderMessageVoice(mes, message), true);
    assert.equal(original.getAttribute('aria-hidden'), 'true');
    message.extra.vc_voice.status = 'failed';
    assert.equal(renderMessageVoice(mes, message), false);
    assert.equal(mes.querySelector('.vc-voice'), null);
    assert.equal(original.hasAttribute('aria-hidden'), false);
});
