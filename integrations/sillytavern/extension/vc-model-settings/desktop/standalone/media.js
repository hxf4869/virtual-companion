// 媒体由实际空leaf承载；服务、播放器、策略和渲染叶沿用现有实现。
import { createVoiceBubble, clearMessageVoice, voicePlayer } from '../../voice.js';
import { installChatVoice, requestChatVoice } from '../../voice-chat.js';
import { installVoiceInput } from '../../voice-input.js';
import { mountLightbox } from '../../lightbox.js';
import { planSticker, readSettings, listStickerPicks, stripStickerTags } from '../../stickers.js';
import { injectNudges } from '../../chat-react.js';

export function installDesktopMedia({ context, session, paint }) {
    const getContext = () => ({ ...context });
    const voice = installChatVoice({ getContext, saveChat: () => context.saveChatConditional(), ready: Promise.resolve() });
    const lightbox = mountLightbox({ getContext });
    const changed = () => { voicePlayer.stop(); paint(); };
    const refreshed = () => paint();
    const generated = async () => {
        context.setExtensionPrompt?.('vc_react_nudge', '', 1, 0);
        const message = context.chat.at(-1);
        if (message && !message.is_user && !message.is_system && !message.extra?.no_memory) await requestChatVoice(context.chat.length - 1);
        paint();
    };
    const before = () => injectNudges(getContext());
    const settle = index => {
        if (context.chatMetadata.vc_binding?.mode !== 'COMPANION') return;
        const message = context.chat[index];
        if (!message || message.is_user || message.is_system) return;
        const settings = readSettings(), user = context.chat.slice(0, index).findLast(row => row.is_user);
        const result = planSticker({ segments: [message.mes], metadata: context.chatMetadata, userText: user?.mes || '',
            turnId: String(index), live: true, enabled: settings.enabled, frequency: settings.frequency, assets: listStickerPicks() });
        if (/<sticker\b/i.test(message.mes)) {
            message.mes = stripStickerTags(message.mes); message.extra ||= {};
            message.extra.vc_sticker = result.sticker; message.extra.vc_sticker_settled = true;
        }
    };
    const bindings = [[context.eventTypes.CHAT_CHANGED, changed], [context.eventTypes.MESSAGE_SWIPED, changed], [context.eventTypes.MESSAGE_EDITED, changed],
        [context.eventTypes.CHARACTER_MESSAGE_RENDERED, settle], [context.eventTypes.GENERATION_ENDED, generated],
        [context.eventTypes.GENERATION_STARTED, before]];
    for (const [type, handler] of bindings) context.eventSource.on(type, handler);
    document.addEventListener('vc-chat-retry', refreshed);
    return { mountVoiceInput(host) { return installVoiceInput({ getContext, host, sendText: (text, voiceInput) => session.send(text, { voiceInput, draftInput: null }) }); },
        renderMedia(node, index, message) {
            node.replaceChildren();
            const voice = message.extra?.vc_voice, input = message.is_user && message.extra?.vc_voice_input;
            if (input || voice && ['queued', 'running', 'ready'].includes(voice.status)) {
                const chat = context.chat;
                node.append(createVoiceBubble({ text: message.mes, voice, input, onPlayed() {
                    if (context.chat !== chat || chat[index] !== message) return;
                    if (voice) voice.played = true;
                    void context.saveChatConditional();
                } }));
            }
            const sticker = message.extra?.vc_sticker;
            if (sticker) {
                const bubble = document.createElement('div'); bubble.className = 'vc-sticker-bubble'; bubble.dataset.vcSticker = sticker.tag || '';
                if (sticker.kind === 'kaomoji') { const text = document.createElement('span'); text.className = 'vc-sticker-kaomoji'; text.textContent = sticker.text; bubble.append(text); }
                else { const image = document.createElement('img'); image.src = sticker.src; image.alt = sticker.tag; bubble.append(image); }
                node.append(bubble);
            }
            for (const item of message.extra?.media || []) {
                const media = document.createElement(item.type === 'video' ? 'video' : item.type === 'audio' ? 'audio' : 'img');
                media.src = item.url; if (media.tagName === 'IMG') media.alt = item.title || ''; else media.controls = true;
                node.append(media);
            }
            if (message.extra?.image && !message.extra?.media?.length) {
                const image = document.createElement('img'); image.src = message.extra.image; image.alt = message.extra.title || ''; node.append(image);
            }
            return () => { clearMessageVoice(node); node.replaceChildren(); };
        }, destroy() {
            voicePlayer.stop(); voice.destroy(); lightbox?.destroy(); document.removeEventListener('vc-chat-retry', refreshed);
            for (const [type, handler] of bindings) context.eventSource.removeListener(type, handler);
        },
    };
}
