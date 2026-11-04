// AGPL-3.0-only. JS-Slash-Runner 0af421068 / src/iframe/exported/message.ts
// 保留本地预编译拷贝：上游为 TypeScript 源码且依赖原生消息 DOM，此处绑定 ../engine/ports.js 与 helper-host.js 的 normalizeMessageId/refreshMessages 显式端口。
import { chat, chat_metadata, characters, this_chid, name1, name2, extension_settings, eventSource, event_types } from '../engine/ports.js';
import { substituteParamsExtended } from '../engine/st/script.js';
import { klona } from './klona.js';
import { system_message_types } from '../engine/st/constants.js';
import { normalizeMessageId, refreshMessages } from './helper-host.js';
import { getCardHost, saveChatConditional } from './ejs-host.js';
import { messageFormatting } from './format.js';
import { replaceMacroLike } from './helper-util.js';
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

function runChatMessagesMutation(refresh, change, afterRefresh) {
    const host = getCardHost();
    const context = host?.context;
    const expectedMetadata = context?.chatMetadata;
    if (typeof context?.mutateChatMessages !== 'function') {
        return Promise.reject(new Error('VC_CHAT_MUTATION_REJECTED'));
    }
    const refreshIndices = [];
    const refreshOption = refresh === 'none' ? [] : refresh === 'all' ? 'all' : refreshIndices;
    return context.mutateChatMessages(
        expectedMetadata,
        messages => change(messages, refreshIndices),
        { refresh: refreshOption, afterRefresh },
    ).then(ok => {
        if (!ok) throw new Error('VC_CHAT_MUTATION_REJECTED');
    });
}

export async function createChatMessages(chat_messages, { insert_at, insert_before = 'end', refresh = 'affected' } = {}) {
    const convert = (chat_message) => {
        let result = _({});
        if (chat_message?.name !== undefined) {
            result = result.set('name', chat_message.name);
        } else if (chat_message.role === 'system') {
            result = result.set('name', 'system');
        } else if (chat_message.role === 'user') {
            result = result.set('name', name1);
        } else {
            result = result.set('name', name2);
        }
        result = result.set('is_user', chat_message.role === 'user');
        if (chat_message.role === 'system') {
            result = result.set('extra.type', system_message_types.NARRATOR);
        }
        result = result.set('is_system', chat_message.is_hidden ?? false);
        result = result.set('mes', chat_message.message ?? '');
        result = result.set('swipe_id', 0);
        result = result.set('swipes', [chat_message.message ?? '']);
        result = result.set('variables', [chat_message.data ? klona(chat_message.data) : {}]);
        if (chat_message.extra) {
            result = result.set('extra', klona(chat_message.extra));
        }
        return result.value();
    };
    let insertedStart = 0;
    let insertedMessages = [];
    await runChatMessagesMutation(
        refresh,
        async (messages, refreshIndices) => {
            const targetInsert = insert_at ?? insert_before;
            const raw_index = targetInsert === 'end' ? messages.length : _.clamp(targetInsert, -messages.length, messages.length);
            const actual_insert = raw_index < 0 ? Math.max(0, messages.length + raw_index) : Math.min(messages.length, raw_index);
            const converted = chat_messages.map(convert);
            insertedStart = actual_insert;
            insertedMessages = converted;
            messages.splice(actual_insert, 0, ...converted);
            if (refresh === 'affected') {
                refreshIndices.push(..._.range(actual_insert, messages.length));
            }
            await Promise.all(
                converted.map((message, index) =>
                    eventSource?.emit?.(
                        message.is_user ? event_types.MESSAGE_SENT : event_types.MESSAGE_RECEIVED,
                        actual_insert + index,
                        'extension',
                    ),
                ),
            );
        },
        async () => {
            await Promise.all(
                insertedMessages.map((message, index) =>
                    eventSource?.emit?.(
                        message.is_user ? event_types.USER_MESSAGE_RENDERED : event_types.CHARACTER_MESSAGE_RENDERED,
                        insertedStart + index,
                    ),
                ),
            );
        },
    );
}

export async function deleteChatMessages(message_ids, { refresh = 'affected' } = {}) {
    const hasValidId = Array.isArray(message_ids)
        && message_ids.some(id => Number.isInteger(id) && id >= -chat.length && id < chat.length);
    if (!hasValidId) {
        return;
    }
    await runChatMessagesMutation(refresh, async (messages, refreshIndices) => {
        const normalizeId = id => (id < 0 ? messages.length + id : id);
        const valid_ids = _(message_ids)
            .filter(id => Number.isInteger(id) && id >= -messages.length && id < messages.length)
            .map(normalizeId)
            .sortBy()
            .sortedUniq()
            .value();
        if (valid_ids.length === 0) {
            return;
        }
        for (let i = valid_ids.length - 1; i >= 0; i--) {
            messages.splice(valid_ids[i], 1);
        }
        if (refresh === 'affected') {
            const min_affected = Math.min(...valid_ids);
            refreshIndices.push(..._.range(min_affected, messages.length));
        }
        for (const deleted_id of valid_ids) {
            await eventSource?.emit?.(event_types.MESSAGE_DELETED, deleted_id);
        }
    });
}

export async function rotateChatMessages(begin, middle, end, { refresh = 'affected' } = {}) {
    await runChatMessagesMutation(refresh, (messages, refreshIndices) => {
        const normalizeId = id => (id < 0 ? messages.length + id : id);
        const b = _.clamp(normalizeId(begin), 0, messages.length);
        const e = _.clamp(normalizeId(end), 0, messages.length);
        const m = _.clamp(normalizeId(middle), b, e);
        const right_part = messages.splice(m, e - m);
        messages.splice(b, 0, ...right_part);
        if (refresh === 'affected') {
            const min_affected = Math.min(b, m, e);
            refreshIndices.push(..._.range(min_affected, messages.length));
        }
    });
}

export function formatAsDisplayedMessage(text, { message_id = 'last' } = {}) {
    if (typeof message_id !== 'number' && !['last', 'last_user', 'last_char'].includes(message_id)) {
        throw Error(
            `提供的 message_id 无效, 请提供 'last', 'last_user', 'last_char' 或楼层消息号 (-1 表示倒数第一楼), 你提供的是: ${message_id}`,
        );
    }
    const last_message_id = chat.length > 0 ? chat.length - 1 : null;
    if (last_message_id === null) {
        throw Error(`未找到任何消息楼层`);
    }
    switch (message_id) {
        case 'last':
            message_id = last_message_id;
            break;
        case 'last_user': {
            let found = -1;
            for (let i = chat.length - 1; i >= 0; i--) {
                if (chat[i]?.is_user && !chat[i]?.is_system) {
                    found = i;
                    break;
                }
            }
            if (found === -1) {
                throw Error(`未找到任何 user 消息楼层, 你提供的是: ${message_id}`);
            }
            message_id = found;
            break;
        }
        case 'last_char': {
            let found = -1;
            for (let i = chat.length - 1; i >= 0; i--) {
                if (!chat[i]?.is_user && !chat[i]?.is_system) {
                    found = i;
                    break;
                }
            }
            if (found === -1) {
                throw Error(`未找到任何 char 消息楼层, 你提供的是: ${message_id}`);
            }
            message_id = found;
            break;
        }
    }
    const normalized_message_id = normalizeMessageId(message_id);
    if (normalized_message_id < 0 || normalized_message_id >= chat.length) {
        throw Error(`提供的 message_id 不在 [${-last_message_id - 1}, ${last_message_id}] 内, 你提供的是: ${message_id}`);
    }
    const chat_message = chat[normalized_message_id];
    const role = chat_message.is_user ? 'user' : chat_message.is_system ? 'system' : 'assistant';
    const demacroed = replaceMacroLike(String(text ?? ''), {
        source: 'display',
        message_id: normalized_message_id,
        role,
    });
    return messageFormatting(
        demacroed,
        chat_message.name,
        chat_message.is_system,
        chat_message.is_user,
        normalized_message_id,
    );
}

export function retrieveDisplayedMessage(message_id) {
    const normalized = normalizeMessageId(message_id);
    const selector = `#chat > .mes[mesid="${normalized}"] div.mes_text, #chat .mes[mesid="${normalized}"] div.mes_text`;
    if (typeof globalThis.$ === 'function') {
        const jq = globalThis.$(`#chat > .mes[mesid="${normalized}"] div.mes_text`);
        if (jq && jq.length > 0) return jq;
    }
    const doc = globalThis.window?.parent?.document ?? globalThis.document;
    const nodes = doc ? [...doc.querySelectorAll(selector)] : [];
    return Object.assign(nodes, {
        text: () => nodes.map(n => n.textContent ?? '').join(''),
        html: () => nodes[0]?.innerHTML ?? '',
    });
}

export async function refreshOneMessage(message_id) {
    const normalized = normalizeMessageId(message_id);
    if (normalized < 0 || normalized >= chat.length) return;
    await refreshMessages('affected', [normalized]);
}

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
