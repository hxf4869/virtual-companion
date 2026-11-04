// AGPL-3.0-only. JS-Slash-Runner 0af421068 / src/iframe/exported/variables.ts
// 保留本地预编译拷贝：上游为 TypeScript 源码且依赖 Pinia stores，此处绑定 ../engine/ports.js 与 helper-host.js 的轻量 store/持久化端口。
import { chat, chat_metadata, characters, this_chid, name1, name2, extension_settings, oai_settings } from '../engine/ports.js';
import { substituteParamsExtended } from '../engine/st/script.js';
import { klona } from './klona.js';
import { _getCurrentMessageId, _getIframeName, _getScriptId } from './helper-util.js';
import { useScriptIframeRuntimesStore, useCharacterSettingsStore, usePresetSettingsStore, useVariableSchemasStore, saveChatConditionalDebounced, saveMetadataDebounced, saveSettingsDebounced, toRef } from './helper-host.js';
const isPromise=value=>value!=null&&typeof value.then==='function';
export function registerVariableSchema(schema, { type }) {
    const store = useVariableSchemasStore();
    switch (type) {
        case 'global': {
            store.global = schema;
            break;
        }
        case 'preset': {
            store.preset = schema;
            break;
        }
        case 'character': {
            store.character = schema;
            break;
        }
        case 'chat': {
            store.chat = schema;
            break;
        }
        case 'message': {
            store.message = schema;
            break;
        }
    }
}
export function get_variables_without_clone(option) {
    switch (option.type) {
        case 'message': {
            const normalized_message_id = option.message_id === undefined || option.message_id === 'latest' ? -1 : option.message_id;
            if (!_.inRange(normalized_message_id, -chat.length, chat.length)) {
                throw Error(`提供的消息楼层号 '${option.message_id}' 超出了范围 [${-chat.length}, ${chat.length})`);
            }
            let chat_message;
            if (option.message_id === undefined || option.message_id === 'latest') {
                chat_message = chat.filter(chat_message => !chat_message.is_system).at(normalized_message_id);
            }
            else {
                chat_message = chat.at(normalized_message_id);
            }
            return chat_message?.variables?.[chat_message?.swipe_id ?? 0] ?? {};
        }
        case 'chat': {
            return _.get(chat_metadata, 'variables', {});
        }
        case 'character': {
            return useCharacterSettingsStore().settings.variables;
        }
        case 'preset': {
            return usePresetSettingsStore().settings.variables;
        }
        case 'global': {
            return extension_settings.variables.global;
        }
        case 'script': {
            if (!option.script_id) {
                throw Error('获取变量失败, 未指定 script_id');
            }
            return useScriptIframeRuntimesStore().get(option.script_id)?.data ?? {};
        }
        case 'extension': {
            return _.get(extension_settings, option.extension_id, {});
        }
    }
}
export function getVariables(option = { type: 'chat' }) {
    return klona(get_variables_without_clone(option));
}
export function _getVariables(option = { type: 'chat' }) {
    return option.type === 'script'
        ? getVariables({ type: 'script', script_id: _getScriptId.call(this) })
        : getVariables(option);
}
export function _getAllVariables() {
    const is_message_iframe = _getIframeName.call(this).startsWith('TH-message');
    let result = _({});
    result = result.assign(get_variables_without_clone({ type: 'global' }), get_variables_without_clone({ type: 'character' }));
    if (!is_message_iframe) {
        result = result.assign(get_variables_without_clone({ type: 'script', script_id: _getScriptId.call(this) }));
    }
    result = result.assign(get_variables_without_clone({ type: 'chat' }));
    if (is_message_iframe) {
        result = result.assign(...chat
            .slice(0, _getCurrentMessageId.call(this) + 1)
            .map((chat_message) => chat_message?.variables?.[chat_message?.swipe_id ?? 0]));
    }
    return klona(result.value());
}
export function replaceVariables(variables, option = { type: 'chat' }) {
    switch (option.type) {
        case 'message': {
            option.message_id = option.message_id === undefined || option.message_id === 'latest' ? -1 : option.message_id;
            if (!_.inRange(option.message_id, -chat.length, chat.length)) {
                throw Error(`提供的消息楼层号 '${option.message_id}' 超出了范围 (${-chat.length}, ${chat.length})`);
            }
            const chat_message = chat.at(option.message_id);
            if (!_.has(chat_message, 'variables')) {
                _.set(chat_message, 'variables', _.times(chat_message.swipes?.length ?? 1, _.constant({})));
            }
            // 与提示词模板的兼容性
            if (_.isPlainObject(_.get(chat_message, 'variables'))) {
                _.set(chat_message, 'variables', _.range(0, chat_message.swipes?.length ?? 1).map(i => chat_message.variables[i] ?? {}));
            }
            _.set(chat_message, ['variables', _.get(chat_message, 'swipe_id', 0)], variables);
            saveChatConditionalDebounced();
            break;
        }
        case 'chat': {
            _.set(chat_metadata, 'variables', variables);
            saveMetadataDebounced();
            break;
        }
        case 'character': {
            const store = useCharacterSettingsStore();
            if (store.avatar === undefined) {
                throw new Error('当前没有打开角色卡，保存角色卡变量失败');
            }
            toRef(store.settings, 'variables').value = variables;
            break;
        }
        case 'preset': {
            const store = usePresetSettingsStore();
            toRef(store.settings, 'variables').value = variables;
            break;
        }
        case 'global': {
            _.set(extension_settings.variables, 'global', variables);
            saveSettingsDebounced();
            break;
        }
        case 'script': {
            if (!option.script_id) {
                throw Error('保存变量失败, 未指定 script_id');
            }
            const script = useScriptIframeRuntimesStore().get(option.script_id);
            if (!script) {
                return;
            }
            script.data = variables;
            break;
        }
        case 'extension': {
            _.set(extension_settings, option.extension_id, variables);
            saveSettingsDebounced();
            break;
        }
    }
}
export function _replaceVariables(variables, option = { type: 'chat' }) {
    return option.type === 'script'
        ? replaceVariables(variables, { type: 'script', script_id: _getScriptId.call(this) })
        : replaceVariables(variables, option);
}
export function updateVariablesWith(updater, option = { type: 'chat' }) {
    option={...option};
    // 聊天/消息沿用F2；持久配置作用域在await后核对实体与读取值，防止覆盖页面刚保存的变量。
    const guard = globalThis[Symbol.for('virtual-companion.f2-source')];
    const snapshot = guard && ['chat', 'message'].includes(option.type) ? guard.capture(option.message_id) : null;
    const finish = snapshot ? guard.begin(option.message_id) : null;
    const target=()=>option.type==='character'?characters[this_chid]?.avatar:option.type==='preset'?oai_settings.preset_settings_openai:option.type==='script'?useScriptIframeRuntimesStore().get(option.script_id):extension_settings;
    const originalTarget=snapshot?null:target(),originalValue=snapshot?null:klona(get_variables_without_clone(option));
    let result;
    try { result = updater(getVariables(option)); } catch (error) { finish?.(false); throw error; }
    const write = value => {
        try {
            if (snapshot) guard.assert(snapshot, value);
            else if(isPromise(result)&&(target()!==originalTarget||!_.isEqual(get_variables_without_clone(option),originalValue))){const error=new Error('变量已经变化，请重新执行。');error.status=409;throw error;}
            replaceVariables(value, option); finish?.(true); return value;
        }
        catch (error) { finish?.(false); throw error; }
    };
    return isPromise(result) ? result.then(write, error => { finish?.(false); throw error; }) : write(result);
}
export function _updateVariablesWith(updater, option = { type: 'chat' }) {
    return option.type === 'script'
        ? updateVariablesWith(updater, { type: 'script', script_id: _getScriptId.call(this) })
        : updateVariablesWith(updater, option);
}
export function insertOrAssignVariables(variables, option = { type: 'chat' }) {
    return updateVariablesWith(old_variables => _.mergeWith(old_variables, variables, (_lhs, rhs) => (_.isArray(rhs) ? rhs : undefined)), option);
}
export function _insertOrAssignVariables(variables, option = { type: 'chat' }) {
    return option.type === 'script'
        ? insertOrAssignVariables(variables, { type: 'script', script_id: _getScriptId.call(this) })
        : insertOrAssignVariables(variables, option);
}
export function insertVariables(variables, option = { type: 'chat' }) {
    return updateVariablesWith(old_variables => _.mergeWith({}, variables, old_variables, (_lhs, rhs) => (_.isArray(rhs) ? rhs : undefined)), option);
}
export function _insertVariables(variables, option = { type: 'chat' }) {
    return option.type === 'script'
        ? insertVariables(variables, { type: 'script', script_id: _getScriptId.call(this) })
        : insertVariables(variables, option);
}
export function deleteVariable(variable_path, option = { type: 'chat' }) {
    let delete_occurred = false;
    const variables = updateVariablesWith(old_variables => {
        delete_occurred = _.unset(old_variables, variable_path);
        return old_variables;
    }, option);
    return { variables, delete_occurred };
}
export function _deleteVariable(variable_path, option = { type: 'chat' }) {
    return option.type === 'script'
        ? deleteVariable(variable_path, { type: 'script', script_id: _getScriptId.call(this) })
        : deleteVariable(variable_path, option);
}
