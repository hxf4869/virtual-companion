// AGPL-3.0-only. JS-Slash-Runner 0af421068 / src/iframe/exported/event.ts
// 保留本地预编译拷贝：上游为 TypeScript 源码且依赖 Pinia/原生页面 store，此处绑定 ../engine/ports.js 的 eventSource 与 helper-script/helper-util 显式端口。
import { eventSource } from '../engine/ports.js';
import { _getButtonEvent } from './helper-script.js';
import { _getIframeName } from './helper-util.js';
export function getOrSet(map, key, defaulter) {
    const existing_value = map.get(key);
    if (existing_value) {
        return existing_value;
    }
    const default_value = defaulter();
    map.set(key, default_value);
    return default_value;
}
const iframe_event_listener_wrapper_map = new Map();
function get_event_listener_wrapper_map() {
    return getOrSet(iframe_event_listener_wrapper_map, _getIframeName.call(this), () => new Map());
}
function get_listener_wrapper_map(event_type) {
    const event_listener_wrapper_map = get_event_listener_wrapper_map.call(this);
    return getOrSet(event_listener_wrapper_map, event_type, () => new Map());
}
function register_listener_wrapper(event_type, listener, options = {}) {
    const listener_wrapper_map = get_listener_wrapper_map.call(this, event_type);
    return getOrSet(listener_wrapper_map, listener, () => {
        const wrapper = (...args) => {
            const listener_wrapper_map = get_listener_wrapper_map.call(this, event_type);
            if (!listener_wrapper_map?.has(listener)) {
                eventSource.removeListener(event_type, wrapper);
                return;
            }
            if ([
                tavern_events.MESSAGE_SWIPED,
                tavern_events.MESSAGE_SENT,
                tavern_events.MESSAGE_RECEIVED,
                tavern_events.MESSAGE_EDITED,
                tavern_events.MESSAGE_UPDATED,
                tavern_events.USER_MESSAGE_RENDERED,
                tavern_events.CHARACTER_MESSAGE_RENDERED,
            ].some(event => event === event_type)) {
                args[0] = parseInt(args[0]);
                if (isNaN(args[0])) {
                    return;
                }
            }
            const result = listener(...args);
            if (options.once) {
                _eventRemoveListener.call(this, event_type, listener);
            }
            return result;
        };
        return wrapper;
    });
}
function make_event_on_return(event_type, listener) {
    return {
        stop: () => _eventRemoveListener.call(this, event_type, listener),
    };
}
export function _eventOn(event_type, listener) {
    const wrapped = register_listener_wrapper.call(this, event_type, listener);
    eventSource.on(event_type, wrapped);
    return make_event_on_return.call(this, event_type, wrapped);
}
export function _eventOnButton(event_type, listener) {
    _eventOn.call(this, _getButtonEvent.call(this, event_type), listener);
}
export function _eventMakeLast(event_type, listener) {
    const wrapped = register_listener_wrapper.call(this, event_type, listener);
    eventSource.makeLast(event_type, wrapped);
    return make_event_on_return.call(this, event_type, wrapped);
}
export function _eventMakeFirst(event_type, listener) {
    const wrapped = register_listener_wrapper.call(this, event_type, listener);
    eventSource.makeFirst(event_type, wrapped);
    return make_event_on_return.call(this, event_type, wrapped);
}
export function _eventOnce(event_type, listener) {
    const wrapped = register_listener_wrapper.call(this, event_type, listener, { once: true });
    eventSource.once(event_type, wrapped);
    return make_event_on_return.call(this, event_type, wrapped);
}
export async function _eventEmit(event_type, ...data) {
    await eventSource.emit(event_type, ...data);
}
export function _eventEmitAndWait(event_type, ...data) {
    eventSource.emitAndWait(event_type, ...data);
}
export function _eventRemoveListener(event_type, listener) {
    const listener_wrapper_map = get_listener_wrapper_map.call(this, event_type);
    if (listener_wrapper_map) {
        const wrapper = listener_wrapper_map.get(listener);
        if (wrapper) {
            listener_wrapper_map.delete(listener);
            eventSource.removeListener(event_type, wrapper);
        }
    }
}
export function _eventClearEvent(event_type) {
    get_listener_wrapper_map.call(this, event_type)?.forEach((_wrapper, listener) => {
        _eventRemoveListener.call(this, event_type, listener);
    });
}
export function _eventClearListener(listener) {
    get_event_listener_wrapper_map.call(this).forEach((_listeners, event_type) => {
        _eventRemoveListener.call(this, event_type, listener);
    });
}
export function _eventClearAll() {
    get_event_listener_wrapper_map.call(this).forEach((listeners, event_type) => {
        listeners.forEach((_wrapper, listener) => {
            _eventRemoveListener.call(this, event_type, listener);
        });
    });
    iframe_event_listener_wrapper_map.delete(_getIframeName.call(this));
}
export const iframe_events = {
    MESSAGE_IFRAME_RENDER_STARTED: 'message_iframe_render_started',
    MESSAGE_IFRAME_RENDER_ENDED: 'message_iframe_render_ended',
    GENERATION_REQUESTED: 'js_generation_requested',
    GENERATION_STARTED: 'js_generation_started',
    STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully',
    STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'js_stream_token_received_incrementally',
    REASONING_TOKEN_RECEIVED_FULLY: 'js_reasoning_token_received_fully',
    REASONING_TOKEN_RECEIVED_INCREMENTALLY: 'js_reasoning_token_received_incrementally',
    GENERATION_ENDED: 'js_generation_ended',
};
export const tavern_events = {
    APP_READY: 'app_ready',
    EXTRAS_CONNECTED: 'extras_connected',
    MESSAGE_SWIPED: 'message_swiped',
    MESSAGE_SENT: 'message_sent',
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_DELETED: 'message_deleted',
    MESSAGE_UPDATED: 'message_updated',
    MESSAGE_FILE_EMBEDDED: 'message_file_embedded',
    MESSAGE_REASONING_EDITED: 'message_reasoning_edited',
    MESSAGE_REASONING_DELETED: 'message_reasoning_deleted',
    MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
    MORE_MESSAGES_LOADED: 'more_messages_loaded',
    IMPERSONATE_READY: 'impersonate_ready',
    CHAT_CHANGED: 'chat_id_changed',
    GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
    GENERATION_STARTED: 'generation_started',
    GENERATION_STOPPED: 'generation_stopped',
    GENERATION_ENDED: 'generation_ended',
    SD_PROMPT_PROCESSING: 'sd_prompt_processing',
    EXTENSIONS_FIRST_LOAD: 'extensions_first_load',
    EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded',
    SETTINGS_LOADED: 'settings_loaded',
    SETTINGS_UPDATED: 'settings_updated',
    MOVABLE_PANELS_RESET: 'movable_panels_reset',
    SETTINGS_LOADED_BEFORE: 'settings_loaded_before',
    SETTINGS_LOADED_AFTER: 'settings_loaded_after',
    CHATCOMPLETION_SOURCE_CHANGED: 'chatcompletion_source_changed',
    CHATCOMPLETION_MODEL_CHANGED: 'chatcompletion_model_changed',
    OAI_PRESET_CHANGED_BEFORE: 'oai_preset_changed_before',
    OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after',
    OAI_PRESET_EXPORT_READY: 'oai_preset_export_ready',
    OAI_PRESET_IMPORT_READY: 'oai_preset_import_ready',
    WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
    WORLDINFO_UPDATED: 'worldinfo_updated',
    CHARACTER_EDITOR_OPENED: 'character_editor_opened',
    CHARACTER_EDITED: 'character_edited',
    CHARACTER_PAGE_LOADED: 'character_page_loaded',
    USER_MESSAGE_RENDERED: 'user_message_rendered',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    FORCE_SET_BACKGROUND: 'force_set_background',
    CHAT_DELETED: 'chat_deleted',
    CHAT_CREATED: 'chat_created',
    GENERATE_BEFORE_COMBINE_PROMPTS: 'generate_before_combine_prompts',
    GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
    GENERATE_AFTER_DATA: 'generate_after_data',
    WORLD_INFO_ACTIVATED: 'world_info_activated',
    TEXT_COMPLETION_SETTINGS_READY: 'text_completion_settings_ready',
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
    CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
    CHARACTER_FIRST_MESSAGE_SELECTED: 'character_first_message_selected',
    CHARACTER_DELETED: 'characterDeleted',
    CHARACTER_DUPLICATED: 'character_duplicated',
    CHARACTER_RENAMED: 'character_renamed',
    CHARACTER_RENAMED_IN_PAST_CHAT: 'character_renamed_in_past_chat',
    SMOOTH_STREAM_TOKEN_RECEIVED: 'stream_token_received',
    STREAM_TOKEN_RECEIVED: 'stream_token_received',
    STREAM_REASONING_DONE: 'stream_reasoning_done',
    FILE_ATTACHMENT_DELETED: 'file_attachment_deleted',
    WORLDINFO_FORCE_ACTIVATE: 'worldinfo_force_activate',
    OPEN_CHARACTER_LIBRARY: 'open_character_library',
    ONLINE_STATUS_CHANGED: 'online_status_changed',
    IMAGE_SWIPED: 'image_swiped',
    CONNECTION_PROFILE_LOADED: 'connection_profile_loaded',
    CONNECTION_PROFILE_CREATED: 'connection_profile_created',
    CONNECTION_PROFILE_DELETED: 'connection_profile_deleted',
    CONNECTION_PROFILE_UPDATED: 'connection_profile_updated',
    TOOL_CALLS_PERFORMED: 'tool_calls_performed',
    TOOL_CALLS_RENDERED: 'tool_calls_rendered',
    CHARACTER_MANAGEMENT_DROPDOWN: 'charManagementDropdown',
    SECRET_WRITTEN: 'secret_written',
    SECRET_DELETED: 'secret_deleted',
    SECRET_ROTATED: 'secret_rotated',
    SECRET_EDITED: 'secret_edited',
    PRESET_CHANGED: 'preset_changed',
    PRESET_DELETED: 'preset_deleted',
    PRESET_RENAMED: 'preset_renamed',
    PRESET_RENAMED_BEFORE: 'preset_renamed_before',
    MAIN_API_CHANGED: 'main_api_changed',
    WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded',
    WORLDINFO_SCAN_DONE: 'worldinfo_scan_done',
    MEDIA_ATTACHMENT_DELETED: 'media_attachment_deleted',
};
