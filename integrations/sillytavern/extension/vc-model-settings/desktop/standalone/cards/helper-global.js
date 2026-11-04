// AGPL-3.0-only. JS-Slash-Runner 0af421068 / src/iframe/exported/global.ts
// 保留本地预编译拷贝：上游为 TypeScript 源码，此处绑定 ../engine/ports.js 的 chat/eventSource 与 helper-host/helper-event 显式端口。
import { _eventEmit, _eventOnce } from './helper-event.js';
import { chat, eventSource } from '../engine/ports.js';
import { waitUntil } from './helper-host.js';
function hasMvuData(chat_message) {
    return _.has(chat_message?.variables?.[chat_message.swipe_id ?? 0], 'stat_data');
}
async function waitMvu() {
    try {
        await waitUntil(() => hasMvuData(chat[0]) || _.takeRight(chat, 10).some(hasMvuData));
    }
    catch (error) {
        /** waitUntil 只是作为 MVU 加载的保险, 忽略超时时的报错 */
    }
}
export function initializeGlobal(global, value) {
    _.set(window, global, value);
    eventSource.emit(`global_${global}_initialized`);
}
export function _initializeGlobal(global, value) {
    _.set(window, global, value);
    _eventEmit.call(this, `global_${global}_initialized`);
}
export async function waitGlobalInitialized(global) {
    if (_.has(window, global)) {
        return;
    }
    return new Promise(resolve => {
        eventSource.once(`global_${global}_initialized`, () => {
            resolve();
        });
    });
}
export async function _waitGlobalInitialized(global) {
    if (_.has(window, global)) {
        Object.defineProperty(this, global, {
            get: () => _.get(window, global),
            configurable: true,
        });
        if (global === 'Mvu') {
            await waitMvu();
        }
        return;
    }
    return new Promise(resolve => {
        _eventOnce.call(this, `global_${global}_initialized`, async () => {
            Object.defineProperty(this, global, {
                get: () => _.get(window, global),
                configurable: true,
            });
            if (global === 'Mvu') {
                await waitMvu();
            }
            resolve();
        });
    });
}
