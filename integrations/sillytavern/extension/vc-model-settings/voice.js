import { BRIDGE_PREFIX } from './api.js';
import { iconSpriteUrl } from './ui/icons.js';
import { mountVoiceBubbleView } from './desktop/build/index.js';

export const VOICE_COPY = Object.freeze({
    recording: '正在录音…', play: '播放语音', pause: '暂停语音',
    transcript: '转文字', collapse: '收起文字', unread: '未播放', input: '语音消息', speed: '播放速度',
});

export const voiceText = (text) => String(text ?? '').replace(/<voice\s*\/>/gi, '').replace(/<sticker\s+tag="[^"]*"\s*\/>/g, '').trim();
export const voiceSeconds = (durationMs) => Math.max(1, Math.ceil((Number(durationMs) || 0) / 1000));
export const voiceWidth = (durationMs) => Math.min(70, 24 + voiceSeconds(durationMs) * 1.5);

// ---- UX-27 桌面语音条：纯函数 ----
export const VOICE_RATES = Object.freeze([1, 1.5, 2, 0.5]);
export const VOICE_WAVE_BARS = 24;
const RATE_KEY = 'vc-voice-rate';
/** 波形区宽度：clamp(96px, 56px + 秒×14, 224px)。 */
export const voiceDeskWidth = (seconds) => Math.min(224, Math.max(96, 56 + (Number(seconds) || 0) * 14));
export const nextVoiceRate = (rate) => VOICE_RATES[(VOICE_RATES.indexOf(Number(rate)) + 1) % VOICE_RATES.length];
export const formatVoiceRate = (rate) => `${rate}x`;
/** 拿不到响度时，由 clipId 决定的稳定伪随机高度（百分比 28–100），同一条语音每次渲染一致。 */
export function voiceWaveHeights(clipId, count = VOICE_WAVE_BARS) {
    let seed = 0x9e3779b9;
    for (const ch of String(clipId ?? '')) seed = (Math.imul(seed ^ ch.charCodeAt(0), 0x85ebca6b) + 0x1b873593) >>> 0;
    const out = [];
    for (let i = 0; i < count; i += 1) {
        seed = (seed + 0x6d2b79f5) >>> 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        out.push(28 + Math.round((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 72));
    }
    return out;
}
export const clampTime = (time, duration) => Math.min(Math.max(0, Number(time) || 0), duration > 0 ? duration : 0);
export function readVoiceRate(storage = globalThis.localStorage) {
    try { const rate = Number(storage?.getItem(RATE_KEY)); return VOICE_RATES.includes(rate) ? rate : 1; } catch { return 1; }
}
export function writeVoiceRate(rate, storage = globalThis.localStorage) {
    try { storage?.setItem(RATE_KEY, String(rate)); } catch { /* 本机存储不可用时仅当前页面生效 */ }
}

export function voiceAudioUrl(clipId) {
    if (typeof clipId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(clipId)) return '';
    return `${BRIDGE_PREFIX}/api/v1/voice-clips/${clipId}/audio`;
}

/** 一个 Audio 实例覆盖聊天、收件箱和试听；URL 只能由受控 clipId 生成。 */
export function createVoicePlayer({ createAudio = () => new Audio() } = {}) {
    let audio;
    let current = null;
    let loaded = '';
    let rate = 1;
    let epoch = 0;
    const reset = () => {
        current?.onState?.(false);
        current = null;
    };
    const stop = () => {
        epoch += 1;
        audio?.pause();
        reset();
        loaded = '';
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
            if (!resuming) { audio.src = url; loaded = clipId; }
            audio.playbackRate = rate;
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
        /** 当前或刚结束的这条语音的进度；不是这条时返回 null。 */
        peek(clipId) {
            if (!audio || loaded !== clipId) return null;
            return { currentTime: audio.currentTime || 0, duration: Number.isFinite(audio.duration) ? audio.duration : 0, ended: Boolean(audio.ended) };
        },
        isCurrent: (clipId) => Boolean(audio && current?.clipId === clipId),
        seek(clipId, time) {
            if (!audio || current?.clipId !== clipId) return false;
            const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
            audio.currentTime = duration ? clampTime(time, duration) : Math.max(0, Number(time) || 0);
            return true;
        },
        setRate(next) { rate = next; if (audio) audio.playbackRate = next; },
    };
}

export const voicePlayer = createVoicePlayer();

const voiceViews = new WeakMap(), voiceOwners = new WeakMap();
function ownVoiceView(doc, root, unmount) {
    let owner = voiceOwners.get(doc);
    if (!owner) {
        const roots = new Map();
        const observer = new doc.defaultView.MutationObserver(records => {
            for (const [node, dispose] of roots) {
                if (!node.isConnected && records.some(record => [...record.removedNodes].some(removed => removed === node || removed.contains?.(node)))) dispose();
            }
        });
        observer.observe(doc.body, { childList: true, subtree: true });
        owner = { roots, observer }; voiceOwners.set(doc, owner);
    }
    let dead = false;
    const dispose = () => {
        if (dead) return; dead = true;
        owner.roots.delete(root); voiceViews.delete(root); unmount();
        if (!owner.roots.size) { owner.observer.disconnect(); voiceOwners.delete(doc); }
    };
    owner.roots.set(root, dispose); voiceViews.set(root, dispose);
}

export function createVoiceBubble({ document: doc = globalThis.document, text = '', voice, input, player = voicePlayer, onPlayed } = {}) {
    const root = doc.createElement('div'); root.className = 'vc-voice';
    if (voice && ['queued', 'running'].includes(voice.status)) {
        root.classList.add('vc-voice-pending'); root.setAttribute('role', 'status'); root.textContent = VOICE_COPY.recording; return root;
    }
    const seconds = voiceSeconds(voice?.durationMs ?? input?.durationMs), desktop = doc.documentElement?.dataset?.vcLayout === 'desktop';
    if (desktop) { root.classList.add('vc-voice-desk'); root.style.setProperty('--vc-voice-w', `${voiceDeskWidth(seconds)}px`); }
    const unmount = mountVoiceBubbleView(root, {
        input: Boolean(input), desktop, text: voiceText(text), seconds, width: voiceWidth(seconds * 1000),
        heights: desktop ? voiceWaveHeights(voice?.clipId ?? input?.clipId ?? seconds) : [40, 75, 100, 75, 40],
        clipId: voice?.clipId, played: Boolean(voice?.played), sprite: iconSpriteUrl(), player,
        readRate: readVoiceRate, rateText: formatVoiceRate,
        cycleRate() { const next = nextVoiceRate(readVoiceRate()); writeVoiceRate(next); player.setRate?.(next); globalThis.dispatchEvent?.(new Event('vc-voice-rate')); },
        onPlaying(playing) { root.classList.toggle('vc-voice-playing', playing); }, onPlayed: () => onPlayed?.(),
    });
    ownVoiceView(doc, root, unmount);
    return root;
}

export function clearMessageVoice(mes) {
    const bubble = mes?.querySelector?.('.vc-voice');
    if (bubble) { voiceViews.get(bubble)?.(); bubble.remove(); }
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
