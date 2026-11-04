import {
    VOICE_REPLY_WAIT_MS,
    VOICE_PROMPT,
    VOICE_REQUEST_PROMPT,
    explicitVoiceRequest,
    spokenText,
    planChatVoice,
    invalidateVoicePolicy,
    loadVoicePolicy,
    chatVoiceGuidance,
    waitForVoiceClip,
    chatVoiceAvailable,
    readReplyAloud,
    requestChatVoice,
    installChatVoice,
    setDefaultVoiceRefresh,
} from './voice-logic.js';

setDefaultVoiceRefresh(() => {
    globalThis.document?.dispatchEvent(new Event('vc-chat-retry'));
});

export {
    VOICE_REPLY_WAIT_MS,
    VOICE_PROMPT,
    VOICE_REQUEST_PROMPT,
    explicitVoiceRequest,
    spokenText,
    planChatVoice,
    invalidateVoicePolicy,
    loadVoicePolicy,
    chatVoiceGuidance,
    waitForVoiceClip,
    chatVoiceAvailable,
    readReplyAloud,
    requestChatVoice,
    installChatVoice,
};
