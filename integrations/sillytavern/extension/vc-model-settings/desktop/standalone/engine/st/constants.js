// AGPL-3.0-only. SillyTavern 7e8663cd9c184a550b37238218bdd32c6efc68e9 / scripts/constants.js
// 原计算模块；只适配显式状态、输入/首显消息与无正文诊断端口。
export const inject_ids = {
    STORY_STRING: '__STORY_STRING__',
    QUIET_PROMPT: 'QUIET_PROMPT',
    DEPTH_PROMPT: 'DEPTH_PROMPT',
    DEPTH_PROMPT_INDEX: (index) => `DEPTH_PROMPT_${index}`,
    CUSTOM_WI_DEPTH: 'customDepthWI',
    CUSTOM_WI_DEPTH_ROLE: (depth, role) => `customDepthWI_${depth}_${role}`,
    CUSTOM_WI_OUTLET: (key) => `customWIOutlet_${key}`,
};

export const IGNORE_SYMBOL = Symbol.for('ignore');
export const MEDIA_TYPE = {
    getFromMime: (/** @type {string} */ mimeType) => {
        if (mimeType.startsWith('image/')) {
            return MEDIA_TYPE.IMAGE;
        }
        if (mimeType.startsWith('video/')) {
            return MEDIA_TYPE.VIDEO;
        }
        if (mimeType.startsWith('audio/')) {
            return MEDIA_TYPE.AUDIO;
        }
        return null;
    },
    IMAGE: 'image',
    VIDEO: 'video',
    AUDIO: 'audio',
};
export const MEDIA_DISPLAY = {
    LIST: 'list',
    GALLERY: 'gallery',
};
export const system_message_types = {
    HELP: 'help',
    WELCOME: 'welcome',
    EMPTY: 'empty',
    GENERIC: 'generic',
    NARRATOR: 'narrator',
    COMMENT: 'comment',
    SLASH_COMMANDS: 'slash_commands',
    FORMATTING: 'formatting',
    HOTKEYS: 'hotkeys',
    MACROS: 'macros',
    WELCOME_PROMPT: 'welcome_prompt',
    ASSISTANT_NOTE: 'assistant_note',
    ASSISTANT_MESSAGE: 'assistant_message',
};
export const persona_description_positions = {
    IN_PROMPT: 0,
    /**
     * @deprecated Use persona_description_positions.IN_PROMPT instead.
     */
    AFTER_CHAR: 1,
    TOP_AN: 2,
    BOTTOM_AN: 3,
    AT_DEPTH: 4,
    NONE: 9,
};

export const GENERATION_TYPE_TRIGGERS = [
    'normal',
    'continue',
    'impersonate',
    'swipe',
    'regenerate',
    'quiet',
];
