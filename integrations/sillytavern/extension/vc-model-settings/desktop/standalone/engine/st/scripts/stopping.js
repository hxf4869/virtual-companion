// AGPL-3.0-only. SillyTavern 7e8663cd9 / scripts/power-user.js
// 保留本地裁剪拷贝：仅从上游 power-user.js 摘取自定义与临时停止词计算函数，剥离整页设置 DOM 并绑定 ../../ports.js 与 quietConsole。
import { power_user } from '../../ports.js';
import { substituteParams } from '../script.js';
import { quietConsole as console } from '../../diagnostics.js';
export const EPHEMERAL_STOPPING_STRINGS = [];
export function addEphemeralStoppingString(value) {
    if (!EPHEMERAL_STOPPING_STRINGS.includes(value)) {
        console.debug('Adding ephemeral stopping string:', value);
        EPHEMERAL_STOPPING_STRINGS.push(value);
    }
}
export function flushEphemeralStoppingStrings() {
    if (EPHEMERAL_STOPPING_STRINGS.length === 0) {
        return;
    }

    console.debug('Flushing ephemeral stopping strings:', EPHEMERAL_STOPPING_STRINGS);
    EPHEMERAL_STOPPING_STRINGS.splice(0, EPHEMERAL_STOPPING_STRINGS.length);
}
export function getCustomStoppingStrings(limit = undefined) {
    function getPermanent() {
        try {
            // If there's no custom stopping strings, return an empty array
            if (!power_user.custom_stopping_strings) {
                return [];
            }

            // Parse the JSON string
            let strings = JSON.parse(power_user.custom_stopping_strings);

            // Make sure it's an array
            if (!Array.isArray(strings)) {
                return [];
            }

            // Make sure all the elements are strings and non-empty.
            strings = strings.filter(s => typeof s === 'string' && s.length > 0);

            // Substitute params if necessary
            if (power_user.custom_stopping_strings_macro) {
                strings = strings.map(x => substituteParams(x));
            }

            return strings;
        } catch (error) {
            // If there's an error, return an empty array
            console.warn('Error parsing custom stopping strings:', error);
            return [];
        }
    }

    const permanent = getPermanent();
    const ephemeral = EPHEMERAL_STOPPING_STRINGS;
    const strings = [...permanent, ...ephemeral];

    // Apply the limit. If limit is 0, return all strings.
    if (limit > 0) {
        return strings.slice(0, limit);
    }

    return strings;
}
