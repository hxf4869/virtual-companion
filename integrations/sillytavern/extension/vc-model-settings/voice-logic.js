// 语音合成、识别、播放与策略纯逻辑（无 DOM 依赖）。
import {
    BRIDGE_PREFIX,
    createVoiceClip,
    fetchRelationships,
    fetchVoiceClip,
    fetchVoiceEngines,
    fetchVoiceSettings,
    reconcileSTSources,
} from './api.js';
import { isSerious } from './stickers-logic.js';

export const VOICE_COPY = Object.freeze({
    recording: '正在录音…',
    play: '播放语音',
    pause: '暂停语音',
    transcript: '转文字',
    collapse: '收起文字',
    unread: '未播放',
    input: '语音消息',
    speed: '播放速度',
});

export const INPUT_COPY = {
    hold: '按住说话',
    start: '开始录音',
    stop: '结束录音',
    recording: '松开发送，上滑取消',
    cancel: '松开取消',
    listening: '正在听…',
    failed: '没听清，再说一次？',
};

export const voiceText = (text) =>
    String(text ?? '')
        .replace(/<voice\s*\/>/gi, '')
        .replace(/<sticker\s+tag="[^"]*"\s*\/>/g, '')
        .trim();
export const voiceSeconds = (durationMs) => Math.max(1, Math.ceil((Number(durationMs) || 0) / 1000));
export const voiceWidth = (durationMs) => Math.min(70, 24 + voiceSeconds(durationMs) * 1.5);

export const VOICE_RATES = Object.freeze([1, 1.5, 2, 0.5]);
export const VOICE_WAVE_BARS = 24;
const RATE_KEY = 'vc-voice-rate';

export const voiceDeskWidth = (seconds) => Math.min(224, Math.max(96, 56 + (Number(seconds) || 0) * 14));
export const nextVoiceRate = (rate) => VOICE_RATES[(VOICE_RATES.indexOf(Number(rate)) + 1) % VOICE_RATES.length];
export const formatVoiceRate = (rate) => `${rate}x`;

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
    try {
        const rate = Number(storage?.getItem(RATE_KEY));
        return VOICE_RATES.includes(rate) ? rate : 1;
    } catch {
        return 1;
    }
}

export function writeVoiceRate(rate, storage = globalThis.localStorage) {
    try {
        storage?.setItem(RATE_KEY, String(rate));
    } catch {
        /* 本机存储不可用时仅当前页面生效 */
    }
}

export function voiceAudioUrl(clipId) {
    if (typeof clipId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(clipId)) return '';
    return `${BRIDGE_PREFIX}/api/v1/voice-clips/${clipId}/audio`;
}

export function createVoicePlayer({ createAudio = () => new Audio() } = {}) {
    let audio;
    let current = null;
    let loaded = '';
    let rate = 1;
    let epoch = 0;
    const listeners = new Set();
    const notify = () => {
        for (const cb of listeners) {
            try {
                cb();
            } catch {
                /* ignore listener errors */
            }
        }
    };
    const reset = () => {
        current?.onState?.(false);
        current = null;
        notify();
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
                notify();
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
                audio.addEventListener('error', () => {
                    const fail = current?.onError;
                    reset();
                    fail?.();
                });
            }
            current = { clipId, onState, onError };
            if (!resuming) {
                audio.src = url;
                loaded = clipId;
            }
            audio.playbackRate = rate;
            try {
                await audio.play();
                if (ticket !== epoch || current?.clipId !== clipId) return false;
                onState?.(true);
                onPlayed?.();
                notify();
                return true;
            } catch {
                if (ticket === epoch) {
                    reset();
                    onError?.();
                }
                return false;
            }
        },
        stop,
        peek(clipId) {
            if (!audio || loaded !== clipId) return null;
            return {
                currentTime: audio.currentTime || 0,
                duration: Number.isFinite(audio.duration) ? audio.duration : 0,
                ended: Boolean(audio.ended),
                paused: Boolean(audio.paused),
            };
        },
        isCurrent: (clipId) => Boolean(audio && current?.clipId === clipId),
        seek(clipId, time) {
            if (!audio || current?.clipId !== clipId) return false;
            const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
            audio.currentTime = duration ? clampTime(time, duration) : Math.max(0, Number(time) || 0);
            notify();
            return true;
        },
        setRate(next) {
            rate = next;
            if (audio) audio.playbackRate = next;
            notify();
        },
        subscribe(cb) {
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
    };
}

const VOICE_PLAYER_KEY = Symbol.for('virtual-companion.voice-player');
export const voicePlayer = globalThis[VOICE_PLAYER_KEY] || (globalThis[VOICE_PLAYER_KEY] = createVoicePlayer());

// ---- voice-chat pure logic ----
export const VOICE_REPLY_WAIT_MS = 15000;
export const VOICE_PROMPT = '想用语音说时，在回复末尾加 <voice/>。适合撒娇、安慰、晚安、开心激动的短句，长解释不要用。';
export const VOICE_REQUEST_PROMPT = '对方这次想听你的声音，本轮请用语音，在回复末尾加 <voice/>。';
const VOICE_REQUEST = /发(?:条|一条|个)?语音|说句话(?:给我)?听|想听你(?:的)?声音|用语音/;

let integration = null;
let policyCache = null;
let defaultOnRefresh = () => {};

export function setDefaultVoiceRefresh(fn) {
    defaultOnRefresh = typeof fn === 'function' ? fn : () => {};
}

export function getVoiceIntegration() {
    return integration;
}

export function setVoiceIntegration(next) {
    integration = next;
}

export const explicitVoiceRequest = (message) =>
    Boolean(message?.extra?.vc_voice_input || VOICE_REQUEST.test(String(message?.mes || '')));

export function spokenText(text) {
    return String(text ?? '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]*>/g, '')
        .replace(/\*\*([^*\n]+)\*\*/g, '$1')
        .replace(/（[^（）]*）|\([^()]*\)|\*[^*\n]+\*|＊[^＊\n]+＊/g, '')
        .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3]/gu, '')
        .replace(/[TQ][_.][TQ]|[︿﹀╥╯╰┬┴┻┳┸ಥಠʕʔωДд▽∀益≧≦･ﾟ｡╭╮¯ツノヽヮ﹏]+/gu, '')
        .replace(/^[ \t]*(?:#{1,6}\s+|[-+>]\s+|\d+[.)]\s+)/gm, '')
        .replace(/[~～]/g, '，')
        .replace(/[`_#*]/g, '')
        .replace(/([\p{P}])[\p{P}]+/gu, '$1')
        .trim();
}

export function planChatVoice({ chat = [], index = chat.length - 1, relationship = {}, settings = {}, available = false } = {}) {
    const message = chat[index];
    if (!available || relationship.voiceFrequency === 'OFF' || !message || message.is_user || message.is_system) {
        return { send: false, reason: 'off' };
    }
    let userIndex = index - 1;
    while (userIndex >= 0 && !chat[userIndex]?.is_user) userIndex -= 1;
    const user = chat[userIndex];
    if (isSerious(user?.mes)) return { send: false, reason: 'serious' };
    if (chat.slice(userIndex + 1, index).some((item) => item?.extra?.vc_voice_attempt?.sent)) {
        return { send: false, reason: 'turn' };
    }
    if (!spokenText(message.mes)) return { send: false, reason: 'empty' };
    if (explicitVoiceRequest(user)) return { send: true, reason: 'requested' };
    if (!/<voice\s*\/>/i.test(message.mes || '')) return { send: false, reason: 'unmarked' };
    if ([...spokenText(message.mes)].length > 80) return { send: false, reason: 'long' };
    const gap = { LOW: 10, STANDARD: 6, HIGH: 3 }[relationship.voiceFrequency || settings.voiceFrequency] || 6;
    let turns = 0;
    for (let i = index - 1; i >= 0; i -= 1) {
        const row = chat[i];
        if (row?.is_user || row?.is_system) continue;
        if (row?.extra?.vc_voice_attempt?.sent || row?.extra?.vc_voice) {
            if (turns < gap - 1) return { send: false, reason: 'frequency' };
            break;
        }
        turns += 1;
    }
    return { send: true, reason: 'marked' };
}

export function invalidateVoicePolicy() {
    policyCache = null;
}

export async function loadVoicePolicy(context, onRefresh = defaultOnRefresh) {
    const id = String(context?.chatMetadata?.vc_binding?.relationshipId || '');
    if (!id) return null;
    if (policyCache?.id === id && policyCache.until > Date.now()) return policyCache.promise;
    const entry = { id, until: Date.now() + 30000 };
    const promise = Promise.all([fetchVoiceEngines(), fetchVoiceSettings(), fetchRelationships()])
        .then(([engines, settings, relationships]) => {
            const relationship = relationships.find((row) => String(row.relationshipId) === id);
            const value = {
                engines,
                settings,
                relationship,
                available:
                    Boolean(relationship) &&
                    engines.tts.some((row) => row.engine === 'kokoro' && row.configured && row.enabled && row.healthy),
            };
            if (policyCache === entry) {
                entry.value = value;
                onRefresh?.();
            }
            return value;
        })
        .catch(() => null);
    entry.promise = promise;
    policyCache = entry;
    return promise;
}

export async function chatVoiceGuidance(context, load = loadVoicePolicy) {
    const policy = await load(context);
    if (!policy?.available || policy.relationship?.voiceFrequency === 'OFF') return '';
    const user = [...(context.chat || [])].reverse().find((message) => message?.is_user);
    if (isSerious(user?.mes)) return '';
    return explicitVoiceRequest(user) ? VOICE_REQUEST_PROMPT : VOICE_PROMPT;
}

export async function waitForVoiceClip(id, { timeoutMs = VOICE_REPLY_WAIT_MS, fetchClip = fetchVoiceClip, intervalMs = 400, onStatus } = {}) {
    let finished = false;
    let deadline;
    let wake;
    const timeout = new Promise((resolve) => {
        deadline = setTimeout(() => {
            finished = true;
            wake?.();
            resolve(null);
        }, timeoutMs);
    });
    const poll = (async () => {
        while (!finished) {
            let clip;
            try {
                clip = await fetchClip(id);
            } catch {
                return null;
            }
            if (finished) return null;
            if (clip.status === 'ready') return clip;
            if (['failed', 'expired'].includes(clip.status)) return null;
            onStatus?.(clip.status);
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, intervalMs);
                wake = () => {
                    clearTimeout(timer);
                    resolve();
                };
            });
        }
        return null;
    })();
    try {
        return await Promise.race([poll, timeout]);
    } finally {
        finished = true;
        clearTimeout(deadline);
        wake?.();
    }
}

export function chatVoiceAvailable(context) {
    return (
        policyCache?.id === String(context?.chatMetadata?.vc_binding?.relationshipId || '') &&
        policyCache?.value?.available &&
        policyCache.value.relationship.voiceFrequency !== 'OFF'
    );
}

export async function readReplyAloud(index, state, onChange) {
    if (!integration || state.busy) return;
    const owner = integration,
        context = owner.getContext(),
        message = context.chat?.[index],
        text = message?.mes;
    if (!message || message.is_user || message.is_system || context.chatMetadata?.vc_binding?.mode !== 'COMPANION') return;
    const relationshipId = String(context.chatMetadata.vc_binding.relationshipId || ''),
        chat = context.chat,
        identity = context.chatMetadata.vc_f2?.id,
        candidate = message.swipe_id ?? 0;
    let sourceId = message.extra?.vc_source?.id;
    const active = () => {
        if (integration !== owner) return false;
        const current = owner.getContext();
        return (
            current.chat === chat &&
            current.chatMetadata.vc_f2?.id === identity &&
            current.chat[index] === message &&
            (message.swipe_id ?? 0) === candidate &&
            (!sourceId || message.extra?.vc_source?.id === sourceId) &&
            message.mes === text &&
            String(current.chatMetadata?.vc_binding?.relationshipId || '') === relationshipId
        );
    };
    const paint = (patch) => {
        Object.assign(state, patch);
        if (active()) onChange();
    };
    const playing = (value) => paint({ playing: value });
    const failure = () => paint({ playing: false, failed: true, clip: null });
    if (state.clip?.message === message && state.clip.text === text) {
        if (active()) await voicePlayer.toggle(state.clip.clipId, { onState: playing, onError: failure });
        return;
    }
    paint({ busy: true, failed: false });
    try {
        if (!active()) return;
        const policy = await loadVoicePolicy(context);
        if (!active() || !policy?.available) return;
        await owner.saveChat();
        if (!active()) return;
        const identity = context.chatMetadata.vc_f2?.id,
            source = message.extra?.vc_source;
        if (!identity || !source?.id || !message.vc_message_id) return;
        await reconcileSTSources([identity]);
        if (!active()) return;
        const queued = await createVoiceClip(String(policy.relationship.relationshipId), {
            messageRef: `stmsg:${identity}:${message.vc_message_id}:${source.id}`,
            text,
            purpose: 'chat',
        });
        const clip = await waitForVoiceClip(queued.clipId, {
            timeoutMs: policy.settings.kokoroTimeoutSeconds * 1000 + 5000,
        });
        if (!active()) return;
        if (!clip) throw new Error('voice');
        state.clip = { clipId: clip.clipId, message, text };
        await voicePlayer.toggle(clip.clipId, { onState: playing, onError: failure });
    } catch {
        failure();
    } finally {
        paint({ busy: false });
    }
}

export async function requestChatVoice(index, onRefresh = defaultOnRefresh) {
    if (!integration) return;
    const owner = integration,
        context = owner.getContext();
    if (context?.chatMetadata?.vc_binding?.mode !== 'COMPANION') return;
    const message = context.chat?.[index];
    if (!message || message.is_user || message.is_system) return;
    const text = message.mes;
    const identity = context.chatMetadata?.vc_f2?.id,
        chat = context.chat,
        candidate = message.swipe_id ?? 0;
    let sourceId = message.extra?.vc_source?.id;
    const active = () =>
        integration === owner &&
        owner.getContext()?.chat === chat &&
        owner.getContext()?.chatMetadata.vc_f2?.id === identity &&
        chat[index] === message &&
        (message.swipe_id ?? 0) === candidate &&
        (!sourceId || message.extra?.vc_source?.id === sourceId) &&
        message.mes === text;
    const refresh = () => {
        owner.onRefresh?.();
        onRefresh?.();
    };
    let attempted = false;
    try {
        const policy = await loadVoicePolicy(context, onRefresh);
        if (!active() || !policy) return;
        await owner.saveChat();
        if (!active()) return;
        const source = message.extra?.vc_source;
        sourceId = source?.id;
        if (!identity || !source?.id || !message.vc_message_id) return;
        if (message.extra?.vc_voice_attempt?.sourceId === source.id) return;
        const plan = planChatVoice({ chat: context.chat, index, ...policy });
        message.extra ||= {};
        message.extra.vc_voice_attempt = { sourceId: source.id, sent: plan.send };
        if (!plan.send) {
            await owner.saveChat();
            return;
        }
        attempted = true;
        await reconcileSTSources([identity]);
        if (!active()) return;
        const queued = await createVoiceClip(String(policy.relationship.relationshipId), {
            purpose: 'chat',
            text,
            messageRef: `stmsg:${identity}:${message.vc_message_id}:${source.id}`,
        });
        if (!active()) return;
        message.extra.vc_voice = { clipId: queued.clipId, status: queued.status, durationMs: 0 };
        refresh();
        const clip = await waitForVoiceClip(queued.clipId);
        if (!active()) return;
        message.extra.vc_voice = clip
            ? { clipId: clip.clipId, status: 'ready', durationMs: clip.durationMs }
            : { clipId: queued.clipId, status: 'failed', durationMs: 0 };
    } catch {
        if (active() && message.extra?.vc_voice) message.extra.vc_voice.status = 'failed';
    } finally {
        if (attempted && active()) {
            refresh();
            try {
                await owner.saveChat();
            } catch {
                /* Native save already surfaces a revision conflict. */
            }
        }
    }
}

export function installChatVoice(options) {
    setVoiceIntegration(options);
    const refresh = async () => {
        try {
            if (dead) return;
            await options.ready;
            if (dead) return;
            await loadVoicePolicy(options.getContext());
        } catch {
            /* Capability remains hidden while unavailable. */
        }
    };
    let dead = false;
    const changed = () => {
        if (!dead) void refresh();
    };
    const settingsChanged = () => {
        invalidateVoicePolicy();
        changed();
    };
    void refresh();
    const context = options.getContext();
    context.eventSource?.on(context.eventTypes.CHAT_CHANGED, changed);
    globalThis.addEventListener?.('vc-voice-settings-changed', settingsChanged);
    return {
        destroy() {
            dead = true;
            if (getVoiceIntegration() === options) {
                setVoiceIntegration(null);
                invalidateVoicePolicy();
            }
            context.eventSource?.removeListener(context.eventTypes.CHAT_CHANGED, changed);
            globalThis.removeEventListener?.('vc-voice-settings-changed', settingsChanged);
        },
    };
}

// ---- voice-input pure logic ----
export function encodeMonoWAV(samples, sampleRate = 16000) {
    const data = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(data);
    const word = (offset, text) => [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
    word(0, 'RIFF');
    view.setUint32(4, data.byteLength - 8, true);
    word(8, 'WAVE');
    word(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    word(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
    }
    return new Blob([data], { type: 'audio/wav' });
}

export async function recordingWAV(
    blob,
    {
        maxSeconds = 60,
        AudioContext: Context = globalThis.AudioContext || globalThis.webkitAudioContext,
        OfflineAudioContext: Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext,
    } = {},
) {
    const decoder = new Context();
    try {
        const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
        const frames = Math.min(maxSeconds * 16000, Math.ceil(decoded.duration * 16000));
        if (!frames || frames > 60 * 16000) throw new Error('duration');
        const mono = decoder.createBuffer(1, decoded.length, decoded.sampleRate);
        const target = mono.getChannelData(0);
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
            const values = decoded.getChannelData(channel);
            for (let i = 0; i < values.length; i++) target[i] += values[i] / decoded.numberOfChannels;
        }
        const offline = new Offline(1, frames, 16000);
        const source = offline.createBufferSource();
        source.buffer = mono;
        source.connect(offline.destination);
        source.start();
        const result = await offline.startRendering();
        return { wav: encodeMonoWAV(result.getChannelData(0)), durationMs: Math.ceil(result.duration * 1000) };
    } finally {
        await decoder.close();
    }
}

// ---- voice-settings pure logic ----
let available = false;
export const voiceSettingsAvailable = () => available;

export async function refreshVoiceAvailability() {
    try {
        const caps = await fetchVoiceEngines();
        available = caps.tts.some((engine) => engine.configured) || caps.asr.configured;
    } catch {
        available = false;
    }
    return available;
}

const RELATIONSHIP_VOICE_BASE_KEYS = Object.freeze([
    'companionName',
    'userAddressAs',
    'replyLength',
    'initiative',
    'humor',
    'advicePref',
    'remindersAllowed',
    'memoryShareScope',
    'avoidTopics',
    'gender',
    'avatarRef',
]);

export function buildRelationshipVoicePayload(values = {}, relationship = {}) {
    const body = Object.fromEntries(
        RELATIONSHIP_VOICE_BASE_KEYS.map((key) => [key, relationship?.[key]]),
    );
    body.kokoroVoice = String(values.kokoroVoice || '') || null;
    body.cosyVoice = String(values.cosyVoice || '') || null;
    body.speed = Number(values.speed ?? relationship?.speed ?? 1);
    body.voiceFrequency = String(values.voiceFrequency || '') || null;
    body.proactiveVoice =
        'proactiveVoice' in values
            ? Boolean(values.proactiveVoice)
            : relationship?.proactiveVoice !== false;
    body.proactiveEngine = String(values.proactiveEngine || '') || null;
    return body;
}

export function resolvePreviewVoice(engine, values = {}, relationship = {}, engines = {}) {
    const key = engine === 'kokoro' ? 'kokoroVoice' : 'cosyVoice';
    const choice = String(values?.[key] || '');
    let voice =
        choice ||
        (engine === 'kokoro'
            ? relationship?.gender === 'MALE'
                ? 'zm_010'
                : 'zf_001'
            : 'default');
    if (engine === 'cosyvoice' && !choice && relationship?.gender === 'MALE') {
        const ttsList = Array.isArray(engines?.tts) ? engines.tts : [];
        voice =
            ttsList
                .find((item) => item?.engine === engine)
                ?.voices?.find((item) => item?.gender === 'MALE')?.id || 'default';
    }
    return voice;
}
