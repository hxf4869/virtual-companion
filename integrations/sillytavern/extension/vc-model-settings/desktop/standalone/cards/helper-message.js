// AGPL-3.0-only. Locked upstream algorithms, adapted 2026-11-03 for explicit desktop ports.
import { chat, chat_metadata, characters, this_chid, name1, name2, extension_settings } from '../engine/ports.js';
import { substituteParamsExtended } from '../engine/st/script.js';
import { klona } from './klona.js';
import { system_message_types } from '../engine/st/constants.js';
import { normalizeMessageId, refreshMessages } from './helper-host.js';
function string_to_range(input, min, max) {
    let start, end;
    const clamp = (value) => _.clamp(value < 0 ? max + value + 1 : value, min, max);
    if (input.match(/^(-?\d+)$/)) {
        start = end = clamp(Number(input));
    }
    else {
        const match = input.match(/^(-?\d+)-(-?\d+)$/);
        if (!match) {
            return null;
        }
        [start, end] = _.sortBy([match[1], match[2]].map(Number).map(clamp));
    }
    if (isNaN(start) || isNaN(end)) {
        return null;
    }
    return { start, end };
}
export function getChatMessages(range, { role = 'all', hide_state = 'all', include_swipes = false } = {}) {
    const range_demacroed = substituteParamsExtended(range.toString());
    const range_number = string_to_range(range_demacroed, 0, chat.length - 1);
    if (!range_number) {
        return [];
    }
    const { start, end } = range_number;
    const get_role = (chat_message) => {
        const is_narrator = chat_message.extra?.type === system_message_types.NARRATOR;
        if (is_narrator) {
            if (chat_message.is_user) {
                return 'unknown';
            }
            return 'system';
        }
        if (chat_message.is_user) {
            return 'user';
        }
        return 'assistant';
    };
    const process_message = (message_id) => {
        const message = chat[message_id];
        if (!message) {
            return null;
        }
        const message_role = get_role(message);
        if (role !== 'all' && message_role !== role) {
            return null;
        }
        if (hide_state !== 'all' && (hide_state === 'hidden') !== message.is_system) {
            return null;
        }
        const swipe_id = message?.swipe_id ?? 0;
        let swipes = message?.swipes ?? [message.mes];
        let swipes_data = message?.variables ?? [{}];
        let swipes_info = message?.swipe_info ?? [message?.extra ?? {}];
        const swipe_length = swipes.length;
        swipes = _.range(0, swipe_length).map(i => swipes[i] ?? '');
        swipes_data = _.range(0, swipe_length).map(i => swipes_data[i] ?? {});
        swipes_info = _.range(0, swipe_length).map(i => swipes_info[i] ?? {});
        const extra = swipes_info[swipe_id];
        const data = swipes_data[swipe_id];
        if (include_swipes) {
            return {
                message_id: message_id,
                name: message.name,
                role: message_role,
                is_hidden: message.is_system,
                swipe_id: swipe_id,
                swipes: swipes,
                swipes_data: swipes_data,
                swipes_info: swipes_info,
            };
        }
        return {
            message_id: message_id,
            name: message.name,
            role: message_role,
            is_hidden: message.is_system,
            message: message.mes ?? '',
            data: data,
            extra: extra,
            // for compatibility
            swipe_id: swipe_id,
            swipes: swipes,
            swipes_data: swipes_data,
        };
    };
    const chat_messages = _.range(start, end + 1)
        .map(i => process_message(i))
        .filter(chat_message => chat_message !== null);
    return klona(chat_messages);
}
export async function setChatMessages(chat_messages, { refresh = 'affected' } = {}) {
    const convert_and_merge_messages = (data) => {
        return _(data)
            .map(chat_message => ({
            ...chat_message,
            message_id: normalizeMessageId(chat_message.message_id),
        }))
            .sortBy('message_id')
            .groupBy('message_id')
            .map(messages => {
            return messages.reduce((result, current) => ({ ...result, ...current }), {});
        })
            .value();
    };
    const is_chat_message = (chat_message) => {
        return _.has(chat_message, 'message') || _.has(chat_message, 'data');
    };
    const modify = async (chat_message) => {
        const data = chat[chat_message.message_id];
        if (data === undefined) {
            return;
        }
        // 与提示词模板的兼容性
        if (_.isPlainObject(data?.variables)) {
            _.set(data, 'variables', _.range(0, data.swipes?.length ?? 1).map(i => data.variables[i] ?? {}));
        }
        if (chat_message?.name !== undefined) {
            _.set(data, 'name', chat_message.name);
        }
        if (chat_message?.role !== undefined) {
            _.set(data, 'is_user', chat_message.role === 'user');
            if (chat_message.role === 'system') {
                _.set(data, 'extra.type', system_message_types.NARRATOR);
            }
            else {
                _.unset(data, 'extra.type');
            }
        }
        if (chat_message?.is_hidden !== undefined) {
            _.set(data, 'is_system', chat_message.is_hidden);
        }
        if (is_chat_message(chat_message)) {
            if (chat_message?.message !== undefined) {
                _.set(data, 'mes', chat_message.message);
                if (data?.swipes !== undefined) {
                    _.set(data, ['swipes', data.swipe_id], chat_message.message);
                }
            }
            if (chat_message?.data !== undefined) {
                if (data?.variables === undefined) {
                    _.set(data, 'variables', _.times(data.swipes?.length ?? 1, _.constant({})));
                }
                _.set(data, ['variables', data.swipe_id ?? 0], chat_message.data);
            }
            if (chat_message?.extra !== undefined) {
                if (data?.swipes_info === undefined) {
                    _.set(data, 'swipe_info', _.times(data.swipes?.length ?? 1, _.constant({})));
                }
                _.set(data, 'extra', chat_message?.extra);
                _.set(data, ['swipe_info', data.swipe_id ?? 0], chat_message?.extra);
            }
        }
        else if (chat_message?.swipe_id !== undefined ||
            chat_message?.swipes !== undefined ||
            chat_message?.swipes_data !== undefined ||
            chat_message?.swipes_info !== undefined) {
            const max_length = _.max([chat_message.swipes?.length, chat_message.swipes_data?.length, chat_message.swipes_info?.length]) ??
                data.swipes?.length ??
                1;
            _.set(chat_message, 'swipe_id', _.clamp(chat_message.swipe_id ?? data.swipe_id ?? 0, 0, max_length - 1));
            _.set(chat_message, 'swipes', chat_message.swipes ?? data.swipes ?? [data.mes]);
            _.set(chat_message, 'swipes_data', chat_message.swipes_data ?? data.variables ?? [{}]);
            _.set(chat_message, 'swipes_info', chat_message.swipes_info ?? data.swipe_info ?? [{}]);
            chat_message.swipes = _.range(0, max_length).map(i => chat_message.swipes?.[i] ?? '');
            chat_message.swipes_data = _.range(0, max_length).map(i => chat_message.swipes_data?.[i] ?? {});
            chat_message.swipes_info = _.range(0, max_length).map(i => chat_message.swipes_info?.[i] ?? {});
            _.set(data, 'swipes', chat_message.swipes);
            _.set(data, 'variables', chat_message.swipes_data);
            _.set(data, 'swipe_info', chat_message.swipes_info);
            _.set(data, 'swipe_id', chat_message.swipe_id);
            _.set(data, 'mes', chat_message.swipes[chat_message.swipe_id]);
            _.set(data, 'extra', chat_message.swipes_info[chat_message.swipe_id]);
        }
    };
    chat_messages = convert_and_merge_messages(chat_messages);
    await Promise.all(chat_messages.map(modify));
    await refreshMessages(refresh, chat_messages.map(message => message.message_id));
}

import { saveChatConditional } from './ejs-host.js';
export async function setChatMessage(field_values, message_id, { swipe_id = 'current', refresh = 'display_and_render_current', } = {}) {
    field_values = typeof field_values === 'string' ? { message: field_values } : field_values;
    if (typeof swipe_id !== 'number' && swipe_id !== 'current') {
        throw Error(`提供的 swipe_id 无效, 请提供 'current' 或序号, 你提供的是: ${swipe_id} `);
    }
    if (!['none', 'display_current', 'display_and_render_current', 'all'].includes(refresh)) {
        throw Error(`提供的 refresh 无效, 请提供 'none', 'display_current', 'display_and_render_current' 或 'all', 你提供的是: ${refresh} `);
    }
    const chat_message = chat.at(message_id);
    if (!chat_message) {
        return;
    }
    const add_swipes_if_required = () => {
        if (swipe_id === 'current') {
            return false;
        }
        // swipe_id 对应的消息页存在
        if (swipe_id == 0 || (chat_message.swipes && swipe_id < chat_message.swipes.length)) {
            return true;
        }
        if (!chat_message.swipes) {
            chat_message.swipe_id = 0;
            chat_message.swipes = [chat_message.mes];
            chat_message.variables = [{}];
        }
        for (let i = chat_message.swipes.length; i <= swipe_id; ++i) {
            chat_message.swipes.push('');
            chat_message.variables.push({});
        }
        return true;
    };
    const swipe_id_previous_index = chat_message.swipe_id ?? 0;
    const swipe_id_to_set_index = swipe_id == 'current' ? swipe_id_previous_index : swipe_id;
    const swipe_id_to_use_index = refresh != 'none' ? swipe_id_to_set_index : swipe_id_previous_index;
    const message = field_values.message ??
        (chat_message.swipes ? chat_message.swipes[swipe_id_to_set_index] : undefined) ??
        chat_message.mes;
    const update_chat_message = () => {
        const message_demacroed = substituteParamsExtended(message);
        if (field_values.data) {
            if (!chat_message.variables) {
                chat_message.variables = [];
            }
            chat_message.variables[swipe_id_to_set_index] = field_values.data;
        }
        if (chat_message.swipes) {
            chat_message.swipes[swipe_id_to_set_index] = message_demacroed;
            chat_message.swipe_id = swipe_id_to_use_index;
        }
        if (swipe_id_to_use_index === swipe_id_to_set_index) {
            chat_message.mes = message_demacroed;
        }
    };
    const should_update_swipe = add_swipes_if_required();
    update_chat_message();
    await saveChatConditional();
    if (refresh !== 'none') await refreshMessages(refresh === 'all' ? 'all' : 'affected', [normalizeMessageId(message_id)], { evaluate: refresh !== 'display_current' });
}
