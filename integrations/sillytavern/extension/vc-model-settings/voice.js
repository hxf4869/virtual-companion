import { iconSpriteUrl } from './ui/icons.js';
import { mountVoiceBubbleView } from './desktop/build/index.js';
import {
    VOICE_COPY,
    voiceText,
    voiceSeconds,
    voiceWidth,
    VOICE_RATES,
    VOICE_WAVE_BARS,
    voiceDeskWidth,
    nextVoiceRate,
    formatVoiceRate,
    voiceWaveHeights,
    clampTime,
    readVoiceRate,
    writeVoiceRate,
    voiceAudioUrl,
    createVoicePlayer,
    voicePlayer,
} from './voice-logic.js';

export {
    VOICE_COPY,
    voiceText,
    voiceSeconds,
    voiceWidth,
    VOICE_RATES,
    VOICE_WAVE_BARS,
    voiceDeskWidth,
    nextVoiceRate,
    formatVoiceRate,
    voiceWaveHeights,
    clampTime,
    readVoiceRate,
    writeVoiceRate,
    voiceAudioUrl,
    createVoicePlayer,
    voicePlayer,
};

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
