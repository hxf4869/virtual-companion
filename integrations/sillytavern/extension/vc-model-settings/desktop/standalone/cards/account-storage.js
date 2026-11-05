// 桌面账户存储薄端口：绑定当前会话 saveSettingsDebounced/persistSettings/syncState，复用 locked-source 上游实现。
import { AccountStorage, accountStorage } from '../../locked-source/st/scripts/util/AccountStorage.js';

let save;
let persist;
let sync;

export const saveSettingsDebounced = () => save?.();
export const persistSettings = () => (persist ?? save)?.();
export const syncAccountStorageState = state => sync?.(state);

export const configureAccountStorage = (callbackOrOptions, persistCallback) => {
    if (callbackOrOptions && typeof callbackOrOptions === 'object') {
        save = callbackOrOptions.saveSettingsDebounced;
        persist = callbackOrOptions.persistSettings;
        sync = callbackOrOptions.syncState;
    } else {
        save = callbackOrOptions;
        persist = persistCallback;
        sync = undefined;
    }
};

export { AccountStorage, accountStorage };
