import { createVoiceClip, fetchRelationships, fetchVoiceClip, fetchVoiceEngines, fetchVoiceSettings, reconcileSTSources } from './api.js';
import { isSerious } from './stickers.js';

export const VOICE_REPLY_WAIT_MS = 15000;
export const VOICE_PROMPT = '想用语音说时，在回复末尾加 <voice/>。适合撒娇、安慰、晚安、开心激动的短句，长解释不要用。';
export const VOICE_REQUEST_PROMPT = '对方这次想听你的声音，本轮请用语音，在回复末尾加 <voice/>。';
const VOICE_REQUEST = /发(?:条|一条|个)?语音|说句话(?:给我)?听|想听你(?:的)?声音|用语音/;
let integration;
let policyCache;

export const explicitVoiceRequest = (message) => Boolean(message?.extra?.vc_voice_input || VOICE_REQUEST.test(String(message?.mes || '')));
export function spokenText(text) {
    return String(text ?? '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]*>/g, '').replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/（[^（）]*）|\([^()]*\)|\*[^*\n]+\*|＊[^＊\n]+＊/g, '')
        .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3]/gu, '')
        .replace(/[TQ][_.][TQ]|[︿﹀╥╯╰┬┴┻┳┸ಥಠʕʔωДд▽∀益≧≦･ﾟ｡╭╮¯ツノヽヮ﹏]+/gu, '')
        .replace(/^[ \t]*(?:#{1,6}\s+|[-+>]\s+|\d+[.)]\s+)/gm, '')
        .replace(/[~～]/g, '，').replace(/[`_#*]/g, '').replace(/([\p{P}])[\p{P}]+/gu, '$1').trim();
}

export function planChatVoice({ chat = [], index = chat.length - 1, relationship = {}, settings = {}, available = false } = {}) {
    const message = chat[index];
    if (!available || relationship.voiceFrequency === 'OFF' || !message || message.is_user || message.is_system) return { send: false, reason: 'off' };
    let userIndex = index - 1;
    while (userIndex >= 0 && !chat[userIndex]?.is_user) userIndex -= 1;
    const user = chat[userIndex];
    if (isSerious(user?.mes)) return { send: false, reason: 'serious' };
    if (chat.slice(userIndex + 1, index).some((item) => item?.extra?.vc_voice_attempt?.sent)) return { send: false, reason: 'turn' };
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

export function invalidateVoicePolicy() { policyCache = null; }
export async function loadVoicePolicy(context) {
    const id = String(context?.chatMetadata?.vc_binding?.relationshipId || '');
    if (!id) return null;
    if (policyCache?.id === id && policyCache.until > Date.now()) return policyCache.promise;
    const entry={id,until:Date.now()+30000};
    const promise = Promise.all([fetchVoiceEngines(), fetchVoiceSettings(), fetchRelationships()]).then(([engines, settings, relationships]) => {
        const relationship = relationships.find((row) => String(row.relationshipId) === id);
        const value={ engines, settings, relationship, available: Boolean(relationship) && engines.tts.some((row) => row.engine === 'kokoro' && row.configured && row.enabled && row.healthy) };
        if(policyCache===entry){entry.value=value;globalThis.document?.dispatchEvent(new Event('vc-chat-retry'));}
        return value;
    }).catch(() => null);
    entry.promise=promise;policyCache=entry;
    return promise;
}

export async function chatVoiceGuidance(context, load = loadVoicePolicy) {
    const policy = await load(context);
    if (!policy?.available || policy.relationship?.voiceFrequency === 'OFF') return '';
    const user = [...(context.chat || [])].reverse().find((message) => message?.is_user);
    if (isSerious(user?.mes)) return '';
    return explicitVoiceRequest(user) ? VOICE_REQUEST_PROMPT : VOICE_PROMPT;
}

/** The deadline runs independently of a slow status HTTP request. */
export async function waitForVoiceClip(id, { timeoutMs = VOICE_REPLY_WAIT_MS, fetchClip = fetchVoiceClip, intervalMs = 400, onStatus } = {}) {
    let finished = false;
    let deadline;
    let wake;
    const timeout = new Promise((resolve) => { deadline = setTimeout(() => { finished = true; wake?.(); resolve(null); }, timeoutMs); });
    const poll = (async () => {
        while (!finished) {
            let clip;
            try { clip = await fetchClip(id); } catch { return null; }
            if (finished) return null;
            if (clip.status === 'ready') return clip;
            if (['failed', 'expired'].includes(clip.status)) return null;
            onStatus?.(clip.status);
            await new Promise((resolve) => { const timer = setTimeout(resolve, intervalMs); wake = () => { clearTimeout(timer); resolve(); }; });
        }
        return null;
    })();
    try { return await Promise.race([poll, timeout]); }
    finally { finished = true; clearTimeout(deadline); wake?.(); }
}

export function chatVoiceAvailable(context){return policyCache?.id===String(context?.chatMetadata?.vc_binding?.relationshipId||'') && policyCache?.value?.available && policyCache.value.relationship.voiceFrequency!=='OFF';}
export function installChatVoice(options) {
    integration = options;
    const refresh=async()=>{try{await options.ready;await loadVoicePolicy(options.getContext());}catch{ /* Capability remains hidden while unavailable. */ }};
    void refresh();const context=options.getContext();context.eventSource?.on(context.eventTypes.CHAT_CHANGED,()=>void refresh());
    globalThis.addEventListener?.('vc-voice-settings-changed',()=>{invalidateVoicePolicy();void refresh();});
}

export async function readReplyAloud(index,button){
    if(!integration || button.disabled)return;
    const context=integration.getContext();const message=context.chat?.[index];const text=message?.mes;
    if(!message || message.is_user || message.is_system || context.chatMetadata?.vc_binding?.mode!=='COMPANION')return;
    const active=()=>integration.getContext().chat===context.chat && context.chat[index]===message && message.mes===text;
    const {voicePlayer}=await import('./voice.js');const {icon}=await import('./ui/icons.js');
    const state=(playing)=>{button.setAttribute('aria-label',playing?'暂停语音':'朗读');button.setAttribute('aria-pressed',String(playing));button.innerHTML=icon(playing?'pause':'volume-2',{size:18});};
    const failure=()=>{state(false);button.title='没有完成，请重试。';button.vcRead=null;};
    if(button.vcRead?.message===message && button.vcRead.text===text){await voicePlayer.toggle(button.vcRead.clipId,{onState:state,onError:failure});return;}
    button.disabled=true;button.setAttribute('aria-busy','true');button.setAttribute('aria-label','正在录音…');
    try{
        const policy=await loadVoicePolicy(context);if(!active() || !policy?.available)return;
        await integration.saveChat();if(!active())return;
        const identity=context.chatMetadata.vc_f2?.id,source=message.extra?.vc_source;
        if(!identity || !source?.id || !message.vc_message_id)return;
        await reconcileSTSources([identity]);if(!active())return;
        const queued=await createVoiceClip(String(policy.relationship.relationshipId),{messageRef:`stmsg:${identity}:${message.vc_message_id}:${source.id}`,text,purpose:'chat'});
        const clip=await waitForVoiceClip(queued.clipId,{timeoutMs:policy.settings.kokoroTimeoutSeconds*1000+5000});
        if(!active())return;if(!clip)throw new Error('voice');
        button.vcRead={clipId:clip.clipId,message,text};await voicePlayer.toggle(clip.clipId,{onState:state,onError:failure});
    }catch{failure();}
    finally{button.disabled=false;button.removeAttribute('aria-busy');if(button.getAttribute('aria-pressed')!=='true')state(false);}
}

export async function requestChatVoice(index) {
    if (!integration) return;
    const context = integration.getContext();
    if (context?.chatMetadata?.vc_binding?.mode !== 'COMPANION') return;
    const message = context.chat?.[index];
    if (!message || message.is_user || message.is_system) return;
    const text = message.mes;
    const identity = context.chatMetadata?.vc_f2?.id;
    const active = () => integration.getContext()?.chat === context.chat && context.chat[index] === message && message.mes === text;
    const refresh = () => globalThis.document?.dispatchEvent(new Event('vc-chat-retry'));
    let attempted = false;
    try {
        const policy = await loadVoicePolicy(context);
        if (!active() || !policy) return;
        // Save first: native F2 assigns stable message/candidate identities and
        // the backend will read this same persisted source, never browser text.
        await integration.saveChat();
        if (!active()) return;
        const source = message.extra?.vc_source;
        if (!identity || !source?.id || !message.vc_message_id) return;
        if (message.extra?.vc_voice_attempt?.sourceId === source.id) return;
        const plan = planChatVoice({ chat: context.chat, index, ...policy });
        message.extra ||= {};
        message.extra.vc_voice_attempt = { sourceId: source.id, sent: plan.send };
        if (!plan.send) { await integration.saveChat(); return; }
        attempted = true;
        await reconcileSTSources([identity]);
        if (!active()) return;
        const queued = await createVoiceClip(String(policy.relationship.relationshipId), {
            purpose: 'chat', text, messageRef: `stmsg:${identity}:${message.vc_message_id}:${source.id}`,
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
            try { await integration.saveChat(); } catch { /* Native save already surfaces a revision conflict. */ }
        }
    }
}
