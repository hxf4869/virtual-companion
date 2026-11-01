import { BRIDGE_PREFIX } from './api.js';
import { icon } from './ui/icons.js';

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
    const desk = doc.documentElement?.dataset?.vcLayout === 'desktop';
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
    const heights = desk ? voiceWaveHeights(voice?.clipId ?? input?.clipId ?? seconds) : null;
    for (let i = 0; i < (desk ? VOICE_WAVE_BARS : 5); i += 1) {
        const barEl = doc.createElement('i');
        if (desk) barEl.style.setProperty('--h', `${heights[i]}%`);
        wave.append(barEl);
    }
    if (desk) {
        root.classList.add('vc-voice-desk');
        root.style.setProperty('--vc-voice-w', `${voiceDeskWidth(seconds)}px`);
    }
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
    const setOpen = (open) => {
        transcript.hidden = !open;
        toggle.textContent = open ? VOICE_COPY.collapse : VOICE_COPY.transcript;
        toggle.setAttribute('aria-expanded', String(open));
    };
    // 桌面：展开 / 收起高度过渡（时长与曲线读 CSS 变量）；减少动效或无 Web Animations 时直接切换。
    const expand = (open) => {
        const motionOff = !desk || typeof transcript.animate !== 'function' || transcript.hidden === !open
            || doc.documentElement.dataset.vcReducedMotion === 'true'
            || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        if (motionOff) { setOpen(open); return; }
        transcript.getAnimations?.().forEach((a) => a.cancel());
        let full = 0;
        if (open) { setOpen(true); full = transcript.offsetHeight; } else { full = transcript.offsetHeight; setOpen(false); transcript.hidden = false; }
        const shut = { height: '0px', paddingBlock: '0px', opacity: 0 };
        const wide = { height: `${full}px`, opacity: 1 };
        const css = globalThis.getComputedStyle?.(transcript);
        const time = css?.getPropertyValue('--vc-dur-shared').trim() || '';
        const duration = (parseFloat(time) || 0) * (time.endsWith('ms') ? 1 : 1000);
        const easing = css?.getPropertyValue('--vc-spring').trim() || 'ease';
        if (!duration) { setOpen(open); return; }
        const anim = transcript.animate(open ? [shut, wide] : [wide, shut], { duration, easing });
        transcript.style.overflow = 'hidden';
        anim.onfinish = anim.oncancel = () => { transcript.style.overflow = ''; if (!open) transcript.hidden = true; };
    };
    setOpen(Boolean(input));
    toggle.addEventListener('click', () => expand(transcript.hidden));
    const clipId = voice?.clipId;
    const bars = [...wave.children];
    let shown = -1;
    let frame = 0;
    const paint = (fraction) => {
        if (!desk) return;
        const n = Math.round(Math.min(1, Math.max(0, fraction)) * VOICE_WAVE_BARS);
        if (n === shown) return;
        shown = n;
        bars.forEach((el, i) => el.classList.toggle('on', i < n));
    };
    const fractionNow = () => {
        const info = player.peek?.(clipId);
        if (!info) return 0;
        if (info.ended) return 0;
        const total = info.duration || seconds;
        return total ? info.currentTime / total : 0;
    };
    const stopLoop = () => { if (frame) globalThis.cancelAnimationFrame?.(frame); frame = 0; };
    const loop = () => {
        paint(fractionNow());
        frame = globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(loop) : 0;
    };
    let speed;
    if (desk && !input) {
        player.setRate?.(readVoiceRate());
        speed = doc.createElement('button');
        speed.className = 'vc-voice-speed';
        speed.type = 'button';
        speed.setAttribute('aria-label', VOICE_COPY.speed);
        const showRate = () => { speed.textContent = formatVoiceRate(readVoiceRate()); };
        showRate();
        speed.addEventListener('click', () => {
            const next = nextVoiceRate(readVoiceRate());
            writeVoiceRate(next);
            player.setRate?.(next);
            globalThis.dispatchEvent?.(new Event('vc-voice-rate'));
        });
        const onRate = () => {
            if (!speed.isConnected) { globalThis.removeEventListener?.('vc-voice-rate', onRate); return; }
            showRate();
        };
        globalThis.addEventListener?.('vc-voice-rate', onRate);
    }
    let dragged = false;
    const seekTo = (time) => { if (player.seek?.(clipId, time)) paint(fractionNow()); };
    const ratioAt = (event) => {
        const box = wave.getBoundingClientRect?.();
        return box?.width ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : 0;
    };
    if (desk && !input) {
        wave.addEventListener('pointerdown', (event) => {
            if (!player.isCurrent?.(clipId)) return;
            const info = player.peek(clipId);
            const total = info?.duration || seconds;
            dragged = true;
            wave.setPointerCapture?.(event.pointerId);
            seekTo(ratioAt(event) * total);
            const move = (e) => seekTo(ratioAt(e) * total);
            const up = () => {
                wave.removeEventListener('pointermove', move);
                wave.removeEventListener('pointerup', up);
                wave.removeEventListener('pointercancel', up);
                setTimeout(() => { dragged = false; }, 0);
            };
            wave.addEventListener('pointermove', move);
            wave.addEventListener('pointerup', up);
            wave.addEventListener('pointercancel', up);
        });
        bar.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            const info = player.peek(clipId);
            if (!info || !player.isCurrent(clipId)) return;
            event.preventDefault();
            seekTo(info.currentTime + (event.key === 'ArrowRight' ? 1 : -1));
        });
    }
    if (!input) bar.addEventListener('click', () => {
        if (dragged) return;
        void player.toggle(voice?.clipId, {
            onState(playing) {
                root.classList.toggle('vc-voice-playing', playing);
                glyph.innerHTML = icon(playing ? 'pause' : 'play');
                bar.setAttribute('aria-label', playing ? VOICE_COPY.pause : VOICE_COPY.play);
                bar.setAttribute('aria-pressed', String(playing));
                if (!desk) return;
                stopLoop();
                if (playing) loop(); else paint(fractionNow());
            },
            onPlayed() { unread?.remove(); onPlayed?.(); },
            onError() { expand(true); },
        });
    });
    root.append(...(speed ? [bar, speed, toggle, transcript] : [bar, toggle, transcript]));
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
