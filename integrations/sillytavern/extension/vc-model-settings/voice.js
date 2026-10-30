import { BRIDGE_PREFIX } from './api.js';
import { icon } from './ui/icons.js';

export const VOICE_COPY = Object.freeze({
    recording: '正在录音…', play: '播放语音', pause: '暂停语音',
    transcript: '转文字', collapse: '收起文字', unread: '未播放', input: '语音消息',
});

export const voiceText = (text) => String(text ?? '').replace(/<voice\s*\/>/gi, '').replace(/<sticker\s+tag="[^"]*"\s*\/>/g, '').trim();
export const voiceSeconds = (durationMs) => Math.max(1, Math.ceil((Number(durationMs) || 0) / 1000));
export const voiceWidth = (durationMs) => Math.min(70, 24 + voiceSeconds(durationMs) * 1.5);

export function voiceAudioUrl(clipId) {
    if (typeof clipId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(clipId)) return '';
    return `${BRIDGE_PREFIX}/api/v1/voice-clips/${clipId}/audio`;
}

/** 一个 Audio 实例覆盖聊天、收件箱和试听；URL 只能由受控 clipId 生成。 */
export function createVoicePlayer({ createAudio = () => new Audio() } = {}) {
    let audio;
    let current = null;
    let epoch = 0;
    const reset = () => {
        current?.onState?.(false);
        current = null;
    };
    const stop = () => {
        epoch += 1;
        audio?.pause();
        reset();
        if (audio) {
            audio.removeAttribute('src');
            audio.load();
        }
    };
    return {
        async toggle(clipId, { onState, onPlayed, onError } = {}) {
            const url = voiceAudioUrl(clipId);
            if (!url) return false;
            if (current?.clipId === clipId && audio && !audio.paused) {
                audio.pause();
                onState?.(false);
                return false;
            }
            const resuming = current?.clipId === clipId;
            const ticket = ++epoch;
            audio?.pause();
            reset();
            if (!audio) {
                audio = createAudio();
                audio.preload = 'none';
                audio.addEventListener('ended', reset);
                audio.addEventListener('error', () => { const fail = current?.onError; reset(); fail?.(); });
            }
            current = { clipId, onState, onError };
            if (!resuming) audio.src = url;
            try {
                await audio.play();
                if (ticket !== epoch || current?.clipId !== clipId) return false;
                onState?.(true);
                onPlayed?.();
                return true;
            } catch {
                if (ticket === epoch) { reset(); onError?.(); }
                return false;
            }
        },
        stop,
    };
}

export const voicePlayer = createVoicePlayer();

export function createVoiceBubble({ document: doc = globalThis.document, text = '', voice, input,
    player = voicePlayer, onPlayed } = {}) {
    const root = doc.createElement('div');
    root.className = 'vc-voice';
    const pending = voice && ['queued', 'running'].includes(voice.status);
    if (pending) {
        root.classList.add('vc-voice-pending');
        root.setAttribute('role', 'status');
        root.textContent = VOICE_COPY.recording;
        return root;
    }
    const seconds = voiceSeconds(voice?.durationMs ?? input?.durationMs);
    const bar = doc.createElement(input ? 'div' : 'button');
    bar.className = 'vc-voice-bar';
    bar.style.setProperty('--vc-voice-width', `${voiceWidth(seconds * 1000)}%`);
    if (!input) {
        bar.type = 'button';
        bar.setAttribute('aria-label', VOICE_COPY.play);
        bar.setAttribute('aria-pressed', 'false');
    } else bar.setAttribute('aria-label', VOICE_COPY.input);
    const glyph = doc.createElement('span');
    glyph.className = 'vc-voice-glyph';
    glyph.innerHTML = icon(input ? 'mic' : 'play');
    const wave = doc.createElement('span');
    wave.className = 'vc-voice-wave';
    wave.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 5; i += 1) wave.append(doc.createElement('i'));
    const duration = doc.createElement('span');
    duration.className = 'vc-voice-duration';
    duration.textContent = `${seconds}″`;
    bar.append(glyph, wave, duration);
    let unread;
    if (!input && !voice?.played) {
        unread = doc.createElement('span');
        unread.className = 'vc-voice-unread';
        unread.setAttribute('role', 'img');
        unread.setAttribute('aria-label', VOICE_COPY.unread);
        bar.append(unread);
    }
    const toggle = doc.createElement('button');
    toggle.className = 'vc-voice-transcribe';
    toggle.type = 'button';
    const transcript = doc.createElement('p');
    transcript.className = 'vc-voice-text';
    transcript.textContent = voiceText(text);
    const expand = (open) => {
        transcript.hidden = !open;
        toggle.textContent = open ? VOICE_COPY.collapse : VOICE_COPY.transcript;
        toggle.setAttribute('aria-expanded', String(open));
    };
    expand(Boolean(input));
    toggle.addEventListener('click', () => expand(transcript.hidden));
    if (!input) bar.addEventListener('click', () => {
        void player.toggle(voice?.clipId, {
            onState(playing) {
                root.classList.toggle('vc-voice-playing', playing);
                glyph.innerHTML = icon(playing ? 'pause' : 'play');
                bar.setAttribute('aria-label', playing ? VOICE_COPY.pause : VOICE_COPY.play);
                bar.setAttribute('aria-pressed', String(playing));
            },
            onPlayed() { unread?.remove(); onPlayed?.(); },
            onError() { expand(true); },
        });
    });
    root.append(bar, toggle, transcript);
    return root;
}

export function clearMessageVoice(mes) {
    mes?.querySelector?.('.vc-voice')?.remove();
    mes?.classList?.remove('vc-voice-message');
    mes?.removeAttribute?.('data-vc-voice');
    mes?.querySelector?.('.mes_text')?.removeAttribute?.('aria-hidden');
}

export function renderMessageVoice(mes, message, { onPlayed } = {}) {
    const voice = message?.extra?.vc_voice;
    const input = message?.is_user ? message?.extra?.vc_voice_input : null;
    const valid = voice && voiceAudioUrl(voice.clipId) && ['queued', 'running', 'ready'].includes(voice.status);
    if (!input && !valid) { clearMessageVoice(mes); return false; }
    const key = JSON.stringify([voice?.clipId, voice?.status, voice?.durationMs, input?.durationMs, message.mes]);
    if (mes.getAttribute?.('data-vc-voice') === key && mes.querySelector?.('.vc-voice')) return true;
    clearMessageVoice(mes);
    mes.setAttribute('data-vc-voice', key);
    mes.classList.add('vc-voice-message');
    const text = mes.querySelector('.mes_text');
    text?.setAttribute('aria-hidden', 'true');
    const node = createVoiceBubble({ text: message.mes, voice, input, onPlayed: () => {
        if (voice) voice.played = true;
        onPlayed?.();
    } });
    (text?.parentElement || text?.parent || mes).append(node);
    return true;
}
