// AGPL-3.0-only. JS-Slash-Runner 0af421068 / src/iframe/exported/message.ts
// 保留本地预编译拷贝：上游为 TypeScript 源码且依赖原生消息 DOM，此处绑定 ../engine/ports.js 与 helper-host.js 的 normalizeMessageId/refreshMessages 显式端口。
import { chat, chat_metadata, characters, this_chid, name1, name2, extension_settings, eventSource, event_types } from '../engine/ports.js';
import { substituteParamsExtended } from '../engine/st/script.js';
import { klona } from './klona.js';
import { system_message_types } from '../engine/st/constants.js';
import { normalizeMessageId, refreshMessages } from './helper-host.js';
import { getCardHost } from './ejs-host.js';
import { messageFormatting } from './format.js';
import { replaceMacroLike } from './helper-util.js';
import { string_to_range } from '../../locked-source/helper/function/chat_message.js';

function resolveAssertActive(options, internal) {
    if (typeof internal?.assertActive === 'function') return internal.assertActive;
    if (typeof options?.assertActive === 'function') return options.assertActive;
    return undefined;
}
const SWIPE_INFO_META_KEYS = new Set(['send_date', 'gen_started', 'gen_finished', 'extra']);

function isSwipeInfoWrapper(value) {
    if (!_.isPlainObject(value)) return false;
    if (_.isPlainObject(value.extra)) return true;
    const keys = Object.keys(value);
    return keys.length > 0 && keys.every(k => SWIPE_INFO_META_KEYS.has(k));
}

function extractSwipeExtra(info, fallbackExtra) {
    if (_.isPlainObject(info)) {
        if (_.isPlainObject(info.extra)) {
            return klona(info.extra);
        }
        if (isSwipeInfoWrapper(info)) {
            return klona(_.isPlainObject(fallbackExtra) ? fallbackExtra : {});
        }
        return klona(info);
    }
    return klona(_.isPlainObject(fallbackExtra) ? fallbackExtra : {});
}

function projectCandidateInfo(message, index) {
    const activeSwipeId = message?.swipe_id ?? 0;
    const existingInfo = Array.isArray(message?.swipe_info) ? message.swipe_info[index] : undefined;
    const existingWrapper = isSwipeInfoWrapper(existingInfo) ? existingInfo : null;
    if (index === activeSwipeId) {
        const extra = _.isPlainObject(message?.extra)
            ? klona(message.extra)
            : extractSwipeExtra(existingInfo, {});
        const send_date = message?.send_date !== undefined ? message.send_date : existingWrapper?.send_date;
        const gen_started = message?.gen_started !== undefined ? message.gen_started : existingWrapper?.gen_started;
        const gen_finished = message?.gen_finished !== undefined ? message.gen_finished : existingWrapper?.gen_finished;
        const entry = { extra };
        if (send_date !== undefined) entry.send_date = send_date;
        if (gen_started !== undefined) entry.gen_started = gen_started;
        if (gen_finished !== undefined) entry.gen_finished = gen_finished;
        return entry;
    }
    const extra = extractSwipeExtra(existingInfo, {});
    const entry = { extra };
    if (existingWrapper?.send_date !== undefined) entry.send_date = existingWrapper.send_date;
    if (existingWrapper?.gen_started !== undefined) entry.gen_started = existingWrapper.gen_started;
    if (existingWrapper?.gen_finished !== undefined) entry.gen_finished = existingWrapper.gen_finished;
    return entry;
}

function applyCandidateInfoInput(input, baseEntry) {
    const base = baseEntry ? klona(baseEntry) : { extra: {} };
    if (input === undefined) {
        return base;
    }
    let nextExtra;
    let send_date = base.send_date;
    let gen_started = base.gen_started;
    let gen_finished = base.gen_finished;

    if (isSwipeInfoWrapper(input)) {
        nextExtra = _.isPlainObject(input.extra) ? klona(input.extra) : klona(base.extra ?? {});
        if (input.send_date !== undefined) send_date = input.send_date;
        if (input.gen_started !== undefined) gen_started = input.gen_started;
        if (input.gen_finished !== undefined) gen_finished = input.gen_finished;
    } else if (_.isPlainObject(input)) {
        nextExtra = klona(input);
    } else {
        nextExtra = klona(base.extra ?? {});
    }

    if (nextExtra.vc_source === undefined && base.extra?.vc_source !== undefined) {
        nextExtra.vc_source = klona(base.extra.vc_source);
    }

    const entry = { extra: nextExtra };
    if (send_date !== undefined) entry.send_date = send_date;
    if (gen_started !== undefined) entry.gen_started = gen_started;
    if (gen_finished !== undefined) entry.gen_finished = gen_finished;
    return entry;
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
        const raw_swipes = Array.isArray(message?.swipes) && message.swipes.length > 0 ? message.swipes : [message.mes ?? ''];
        const raw_variables = Array.isArray(message?.variables)
            ? message.variables
            : _.isPlainObject(message?.variables)
              ? [message.variables]
              : [];
        const raw_swipe_info = Array.isArray(message?.swipe_info) ? message.swipe_info : [];
        const swipe_length = Math.max(raw_swipes.length, raw_swipe_info.length, swipe_id + 1, 1);
        const swipes = _.range(0, swipe_length).map(i =>
            i === swipe_id ? (message.mes ?? raw_swipes[i] ?? '') : (raw_swipes[i] ?? ''),
        );
        const swipes_data = _.range(0, swipe_length).map(i => klona(_.isPlainObject(raw_variables[i]) ? raw_variables[i] : {}));
        const swipes_info = _.range(0, swipe_length).map(i => projectCandidateInfo(message, i));
        const extra = klona(swipes_info[swipe_id]?.extra ?? {});
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
export async function setChatMessages(chat_messages, options = {}, internal = {}) {
    const refresh = options?.refresh ?? 'affected';
    const assertActive = resolveAssertActive(options, internal);
    const onApplied = typeof internal?.onApplied === 'function' ? internal.onApplied : undefined;
    const deferChatSave = internal?.deferChatSave === true;
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
        return _.has(chat_message, 'message') || _.has(chat_message, 'data') || _.has(chat_message, 'extra');
    };
    let affectedIds = [];
    await runChatMessagesMutation(
        refresh,
        (messages, refreshIndices) => {
            const modify = (chat_message) => {
                const data = messages[chat_message.message_id];
                if (data === undefined) {
                    return;
                }
                const current_swipe_id = data.swipe_id ?? 0;
                const base_length = Math.max(
                    Array.isArray(data.swipes) ? data.swipes.length : 0,
                    Array.isArray(data.variables) ? data.variables.length : 0,
                    Array.isArray(data.swipe_info) ? data.swipe_info.length : 0,
                    current_swipe_id + 1,
                    1,
                );
                // 与提示词模板的兼容性
                if (_.isPlainObject(data?.variables)) {
                    _.set(data, 'variables', _.range(0, base_length).map(i => klona(_.isPlainObject(data.variables[i]) ? data.variables[i] : {})));
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
                        const nextSwipes = _.range(0, base_length).map(i =>
                            i === current_swipe_id ? (data.mes ?? data.swipes?.[i] ?? '') : (data.swipes?.[i] ?? ''),
                        );
                        nextSwipes[current_swipe_id] = chat_message.message;
                        _.set(data, 'mes', chat_message.message);
                        _.set(data, 'swipes', nextSwipes);
                    }
                    if (chat_message?.data !== undefined) {
                        const nextVariables = _.range(0, base_length).map(i =>
                            klona(_.isPlainObject(data.variables?.[i]) ? data.variables[i] : {}),
                        );
                        nextVariables[current_swipe_id] = klona(chat_message.data);
                        _.set(data, 'variables', nextVariables);
                    }
                    if (chat_message?.extra !== undefined) {
                        const nextSwipeInfo = _.range(0, base_length).map(i => projectCandidateInfo(data, i));
                        const updatedEntry = applyCandidateInfoInput(
                            chat_message.extra,
                            nextSwipeInfo[current_swipe_id],
                        );
                        nextSwipeInfo[current_swipe_id] = updatedEntry;
                        delete data.swipes_info;
                        _.set(data, 'swipe_info', nextSwipeInfo);
                        _.set(data, 'extra', klona(updatedEntry.extra));
                        if (updatedEntry.send_date !== undefined) _.set(data, 'send_date', updatedEntry.send_date);
                        if (updatedEntry.gen_started !== undefined) _.set(data, 'gen_started', updatedEntry.gen_started);
                        if (updatedEntry.gen_finished !== undefined) _.set(data, 'gen_finished', updatedEntry.gen_finished);
                    }
                }
                else if (chat_message?.swipe_id !== undefined ||
                    chat_message?.swipes !== undefined ||
                    chat_message?.swipes_data !== undefined ||
                    chat_message?.swipes_info !== undefined) {
                    const explicitLengths = [
                        chat_message.swipes?.length,
                        chat_message.swipes_data?.length,
                        chat_message.swipes_info?.length,
                        chat_message.swipe_id !== undefined ? chat_message.swipe_id + 1 : undefined,
                    ].filter(n => typeof n === 'number' && n > 0);
                    const max_length = Math.max(
                        ...(chat_message.swipes !== undefined ? explicitLengths : [...explicitLengths, base_length]),
                        1,
                    );
                    const next_swipe_id = _.clamp(chat_message.swipe_id ?? current_swipe_id, 0, max_length - 1);
                    const baseSwipes = _.range(0, max_length).map(i =>
                        i === current_swipe_id ? (data.mes ?? data.swipes?.[i] ?? '') : (data.swipes?.[i] ?? ''),
                    );
                    const baseSwipeInfo = _.range(0, max_length).map(i => projectCandidateInfo(data, i));
                    const nextSwipes = _.range(0, max_length).map(i =>
                        chat_message.swipes?.[i] !== undefined
                            ? chat_message.swipes[i]
                            : baseSwipes[i],
                    );
                    const nextVariables = _.range(0, max_length).map(i =>
                        chat_message.swipes_data?.[i] !== undefined
                            ? klona(chat_message.swipes_data[i])
                            : klona(_.isPlainObject(data.variables?.[i]) ? data.variables[i] : {}),
                    );
                    const nextSwipeInfo = _.range(0, max_length).map(i =>
                        applyCandidateInfoInput(chat_message.swipes_info?.[i], baseSwipeInfo[i]),
                    );
                    delete data.swipes_info;
                    _.set(data, 'swipes', nextSwipes);
                    _.set(data, 'variables', nextVariables);
                    _.set(data, 'swipe_info', nextSwipeInfo);
                    _.set(data, 'swipe_id', next_swipe_id);
                    if (next_swipe_id !== current_swipe_id) {
                        _.set(data, 'mes', nextSwipes[next_swipe_id]);
                        const activeInfo = nextSwipeInfo[next_swipe_id];
                        _.set(data, 'extra', klona(activeInfo?.extra ?? {}));
                        if (activeInfo?.send_date !== undefined) _.set(data, 'send_date', activeInfo.send_date);
                        _.set(data, 'gen_started', activeInfo?.gen_started);
                        _.set(data, 'gen_finished', activeInfo?.gen_finished);
                    } else {
                        if (chat_message.swipes?.[current_swipe_id] !== undefined) {
                            _.set(data, 'mes', nextSwipes[current_swipe_id]);
                        }
                        if (chat_message.swipes_info?.[current_swipe_id] !== undefined) {
                            const activeInfo = nextSwipeInfo[current_swipe_id];
                            _.set(data, 'extra', klona(activeInfo?.extra ?? {}));
                            if (activeInfo?.send_date !== undefined) _.set(data, 'send_date', activeInfo.send_date);
                            if (activeInfo?.gen_started !== undefined) _.set(data, 'gen_started', activeInfo.gen_started);
                            if (activeInfo?.gen_finished !== undefined) _.set(data, 'gen_finished', activeInfo.gen_finished);
                        }
                    }
                }
            };
            const merged = convert_and_merge_messages(chat_messages);
            for (const item of merged) {
                modify(item);
            }
            affectedIds = merged
                .map(message => message.message_id)
                .filter(id => Number.isInteger(id) && id >= 0 && id < messages.length);
            if (refresh === 'affected') {
                refreshIndices.push(...affectedIds);
            }
            onApplied?.();
        },
        refresh === 'none'
            ? undefined
            : async messages => {
                  for (const index of affectedIds) {
                      const message = messages[index];
                      if (!message) continue;
                      await eventSource?.emit?.(
                          message.is_user
                              ? event_types.USER_MESSAGE_RENDERED
                              : event_types.CHARACTER_MESSAGE_RENDERED,
                          index,
                      );
                  }
              },
        { structural: false, assertActive, deferChatSave },
    );
}

function runChatMessagesMutation(
    refresh,
    change,
    afterRefresh,
    { structural = true, refreshOptions, assertActive, deferChatSave = false } = {},
) {
    const host = getCardHost();
    const context = host?.context;
    const expectedMetadata = context?.chatMetadata;
    if (typeof context?.mutateChatMessages !== 'function') {
        return Promise.reject(new Error('VC_CHAT_MUTATION_REJECTED'));
    }
    const refreshIndices = [];
    const refreshOption = refresh === 'none' ? [] : refresh === 'all' ? 'all' : refreshIndices;
    const verifyHostAndOwner = () => {
        const activeHost = getCardHost();
        const activeSt = globalThis.SillyTavern;
        const ownsContext = !activeSt || typeof activeSt.getContext !== 'function' || activeSt.getContext() === context;
        return Boolean(activeHost && activeHost === host && ownsContext && context?.chatMetadata === expectedMetadata);
    };
    const beforeMutation = () => {
        if (!verifyHostAndOwner()) {
            return false;
        }
        if (typeof assertActive === 'function') {
            const active = assertActive();
            if (active && typeof active.then === 'function') {
                return active.then(resolved => Boolean(resolved !== false && verifyHostAndOwner()));
            }
            if (active === false || !verifyHostAndOwner()) {
                return false;
            }
        }
        return true;
    };
    return context
        .mutateChatMessages(
            expectedMetadata,
            messages => change(messages, refreshIndices),
            { refresh: refreshOption, afterRefresh, refreshOptions, structural, beforeMutation, deferChatSave },
        )
        .then(ok => {
            if (!ok) throw new Error('VC_CHAT_MUTATION_REJECTED');
        });
}

export async function createChatMessages(chat_messages, options = {}, internal = {}) {
    const { insert_at, insert_before = 'end', refresh = 'affected' } = options ?? {};
    const assertActive = resolveAssertActive(options, internal);
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
        { assertActive },
    );
    return insertedMessages;
}

export async function deleteChatMessages(message_ids, options = {}, internal = {}) {
    const refresh = options?.refresh ?? 'affected';
    const assertActive = resolveAssertActive(options, internal);
    const hasValidId = Array.isArray(message_ids)
        && message_ids.some(id => Number.isInteger(id) && id >= -chat.length && id < chat.length);
    if (!hasValidId && !assertActive) {
        return;
    }
    await runChatMessagesMutation(
        refresh,
        async (messages, refreshIndices) => {
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
        },
        undefined,
        { assertActive },
    );
}

export async function rotateChatMessages(begin, middle, end, options = {}, internal = {}) {
    const refresh = options?.refresh ?? 'affected';
    const assertActive = resolveAssertActive(options, internal);
    await runChatMessagesMutation(
        refresh,
        (messages, refreshIndices) => {
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
        },
        undefined,
        { assertActive },
    );
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

export async function setChatMessage(field_values, message_id, options = {}, internal = {}) {
    const { swipe_id = 'current', refresh = 'display_and_render_current' } = options ?? {};
    const assertActive = resolveAssertActive(options, internal);
    field_values = typeof field_values === 'string' ? { message: field_values } : field_values;
    if (typeof swipe_id !== 'number' && swipe_id !== 'current') {
        throw Error(`提供的 swipe_id 无效, 请提供 'current' 或序号, 你提供的是: ${swipe_id} `);
    }
    if (!['none', 'display_current', 'display_and_render_current', 'all'].includes(refresh)) {
        throw Error(`提供的 refresh 无效, 请提供 'none', 'display_current', 'display_and_render_current' 或 'all', 你提供的是: ${refresh} `);
    }
    if (!chat.at(message_id) && !assertActive) {
        return;
    }
    const refreshMode = refresh === 'none' ? 'none' : refresh === 'all' ? 'all' : 'affected';
    const evaluate = refresh !== 'display_current';
    let targetIndex = -1;
    await runChatMessagesMutation(
        refreshMode,
        (messages, refreshIndices) => {
            targetIndex = message_id < 0 ? messages.length + message_id : message_id;
            const chat_message = messages[targetIndex];
            if (!chat_message) {
                return;
            }
            const swipe_id_previous_index = chat_message.swipe_id ?? 0;
            const swipe_id_to_set_index = swipe_id === 'current' ? swipe_id_previous_index : swipe_id;
            const swipe_id_to_use_index = refresh !== 'none' ? swipe_id_to_set_index : swipe_id_previous_index;
            const target_len = Math.max(
                chat_message.swipes?.length ?? 1,
                Array.isArray(chat_message.variables) ? chat_message.variables.length : 1,
                Array.isArray(chat_message.swipe_info) ? chat_message.swipe_info.length : 1,
                swipe_id_previous_index + 1,
                swipe_id_to_set_index + 1,
            );
            const nextSwipes = _.range(0, target_len).map(i =>
                i === swipe_id_previous_index
                    ? (chat_message.mes ?? chat_message.swipes?.[i] ?? '')
                    : (chat_message.swipes?.[i] ?? ''),
            );
            const rawVariables = Array.isArray(chat_message.variables)
                ? chat_message.variables
                : _.isPlainObject(chat_message.variables)
                  ? [chat_message.variables]
                  : [];
            const nextVariables = _.range(0, target_len).map(i =>
                klona(_.isPlainObject(rawVariables[i]) ? rawVariables[i] : {}),
            );
            const nextSwipeInfo = _.range(0, target_len).map(i => projectCandidateInfo(chat_message, i));

            if (field_values.data !== undefined) {
                nextVariables[swipe_id_to_set_index] = klona(field_values.data);
            }
            if (field_values.extra !== undefined) {
                nextSwipeInfo[swipe_id_to_set_index] = applyCandidateInfoInput(
                    field_values.extra,
                    nextSwipeInfo[swipe_id_to_set_index],
                );
            }
            if (field_values.message !== undefined) {
                nextSwipes[swipe_id_to_set_index] = substituteParamsExtended(field_values.message);
            }

            delete chat_message.swipes_info;
            chat_message.swipes = nextSwipes;
            chat_message.variables = nextVariables;
            chat_message.swipe_info = nextSwipeInfo;
            chat_message.swipe_id = swipe_id_to_use_index;

            if (swipe_id_to_use_index !== swipe_id_previous_index) {
                chat_message.mes = nextSwipes[swipe_id_to_use_index] ?? '';
                const activeInfo = nextSwipeInfo[swipe_id_to_use_index];
                chat_message.extra = klona(activeInfo?.extra ?? {});
                if (activeInfo?.send_date !== undefined) chat_message.send_date = activeInfo.send_date;
                chat_message.gen_started = activeInfo?.gen_started;
                chat_message.gen_finished = activeInfo?.gen_finished;
            } else if (swipe_id_to_set_index === swipe_id_previous_index) {
                if (field_values.message !== undefined) {
                    chat_message.mes = nextSwipes[swipe_id_previous_index] ?? '';
                }
                if (field_values.extra !== undefined) {
                    const activeInfo = nextSwipeInfo[swipe_id_previous_index];
                    chat_message.extra = klona(activeInfo?.extra ?? {});
                    if (activeInfo?.send_date !== undefined) chat_message.send_date = activeInfo.send_date;
                    if (activeInfo?.gen_started !== undefined) chat_message.gen_started = activeInfo.gen_started;
                    if (activeInfo?.gen_finished !== undefined) chat_message.gen_finished = activeInfo.gen_finished;
                }
            }

            if (refreshMode === 'affected' && targetIndex >= 0 && targetIndex < messages.length) {
                refreshIndices.push(targetIndex);
            }
        },
        refreshMode === 'none' || !evaluate
            ? undefined
            : async messages => {
                  if (targetIndex < 0 || targetIndex >= messages.length) return;
                  const message = messages[targetIndex];
                  if (!message) return;
                  await eventSource?.emit?.(
                      message.is_user
                          ? event_types.USER_MESSAGE_RENDERED
                          : event_types.CHARACTER_MESSAGE_RENDERED,
                      targetIndex,
                  );
              },
        { structural: false, refreshOptions: { evaluate }, assertActive },
    );
}
