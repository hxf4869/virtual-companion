// AGPL-3.0-only. SillyTavern 7e8663cd9c184a550b37238218bdd32c6efc68e9 / scripts/utils.js
// 原计算模块；只适配显式状态、输入/首显消息与无正文诊断端口。
import { moment } from '../lib.js';
import { getCurrentLocale } from '../../ports.js';
export function getStringHash(str, seed = 0) {
    if (typeof str !== 'string') {
        return 0;
    }

    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function escapeRegex(string) {
    return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

export function isTrueBoolean(arg) {
    return ['on', 'true', '1'].includes(arg?.trim()?.toLowerCase());
}

export function isFalseBoolean(arg) {
    return ['off', 'false', '0'].includes(arg?.trim()?.toLowerCase());
}

export function isDigitsOnly(str) {
    return /^\d+$/.test(str);
}

export function uuidv4() {
    if ('randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function stringFormat(format) {
    const args = Array.prototype.slice.call(arguments, 1);
    return format.replace(/{(\d+)}/g, function (match, number) {
        return typeof args[number] != 'undefined'
            ? args[number]
            : match;
    });
}

export const dateCache = new Map();

export function timestampToMoment(timestamp) {
    if (dateCache.has(timestamp)) {
        return dateCache.get(timestamp);
    }

    const iso8601 = parseTimestamp(timestamp);
    const objMoment = iso8601 ? moment(iso8601).locale(getCurrentLocale()) : moment.invalid();

    dateCache.set(timestamp, objMoment);
    return objMoment;
}

export function parseTimestamp(timestamp) {
    if (!timestamp) return;

    // Date object
    if (timestamp instanceof Date) {
        return timestamp.toISOString();
    }

    // Unix time (legacy TAI / tags)
    if (typeof timestamp === 'number' || /^\d+$/.test(timestamp)) {
        const unixTime = Number(timestamp);
        const isValid = Number.isFinite(unixTime) && !Number.isNaN(unixTime) && unixTime >= 0;
        if (!isValid) return;
        return new Date(unixTime).toISOString();
    }

    // ISO 8601
    if (moment(timestamp, moment.ISO_8601, true).isValid()) {
        return timestamp;
    }

    let dtFmt = [];

    // meridiem-based format
    const convertFromMeridiemBased = (_, month, day, year, hour, minute, meridiem) => {
        const monthNum = moment().month(month).format('MM');
        const hour24 = meridiem.toLowerCase() === 'pm' ? (parseInt(hour, 10) % 12) + 12 : parseInt(hour, 10) % 12;
        return `${year}-${monthNum}-${day.padStart(2, '0')}T${hour24.toString().padStart(2, '0')}:${minute.padStart(2, '0')}:00`;
    };
    // June 19, 2023 2:20pm
    dtFmt.push({ callback: convertFromMeridiemBased, pattern: /(\w+)\s(\d{1,2}),\s(\d{4})\s(\d{1,2}):(\d{1,2})(am|pm)/i });

    // ST "humanized" format patterns
    const convertFromHumanized = (_, year, month, day, hour, min, sec, ms) => {
        ms = typeof ms !== 'undefined' ? `.${ms.padStart(3, '0')}` : '';
        return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${min.padStart(2, '0')}:${sec.padStart(2, '0')}${ms}Z`;
    };
    // 2024-07-12@01h31m37s123ms
    dtFmt.push({ callback: convertFromHumanized, pattern: /(\d{4})-(\d{1,2})-(\d{1,2})@(\d{1,2})h(\d{1,2})m(\d{1,2})s(\d{1,3})ms/ });
    // 2024-7-12@01h31m37s
    dtFmt.push({ callback: convertFromHumanized, pattern: /(\d{4})-(\d{1,2})-(\d{1,2})@(\d{1,2})h(\d{1,2})m(\d{1,2})s/ });
    // 2024-6-5 @14h 56m 50s 682ms
    dtFmt.push({ callback: convertFromHumanized, pattern: /(\d{4})-(\d{1,2})-(\d{1,2}) @(\d{1,2})h (\d{1,2})m (\d{1,2})s (\d{1,3})ms/ });

    for (const x of dtFmt) {
        let rgxMatch = timestamp.match(x.pattern);
        if (!rgxMatch) continue;
        return x.callback(...rgxMatch);
    }

    return;
}

export function convertValueType(value, type) {
    if (typeof type !== 'string') {
        return value;
    }

    switch (type.trim().toLowerCase()) {
        case 'string':
        case 'str':
            return String(value);

        case 'null':
            return null;

        case 'undefined':
        case 'none':
            return undefined;

        case 'number':
            return Number(value);

        case 'int':
            return parseInt(value, 10);

        case 'float':
            return parseFloat(value);

        case 'boolean':
        case 'bool':
            return isTrueBoolean(value);

        case 'list':
        case 'array':
            try {
                const parsedArray = JSON.parse(value);
                if (Array.isArray(parsedArray)) {
                    return parsedArray;
                }
                // The value is not an array
                return [];
            } catch {
                return [];
            }

        case 'object':
        case 'dict':
        case 'dictionary':
            try {
                const parsedObject = JSON.parse(value);
                if (typeof parsedObject === 'object') {
                    return parsedObject;
                }
                // The value is not an object
                return {};
            } catch {
                return {};
            }

        default:
            return value;
    }
}
export function collapseNewlines(x) {
    return x.replaceAll(/\n+/g, '\n');
}

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

import {getContext} from "../../ports.js";
export function getCharaFilename(chid = null, { manualAvatarKey = null } = {}) {
    const context = getContext();
    const fileName = manualAvatarKey ?? context.characters[chid ?? context.characterId]?.avatar;

    return fileName?.replace(/\.[^/.]+$/, '') ?? null;
}

export function trimToEndSentence(input) {
    if (!input) {
        return '';
    }

    const isEmoji = x => /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu.test(x);
    const punctuation = new Set(['.', '!', '?', '*', '"', ')', '}', '`', ']', '$', '。', '！', '？', '”', '）', '】', '’', '」', '_']); // extend this as you see fit
    let last = -1;

    const characters = Array.from(input);
    for (let i = characters.length - 1; i >= 0; i--) {
        const char = characters[i];
        const emoji = isEmoji(char);

        if (punctuation.has(char) || emoji) {
            if (!emoji && i > 0 && /[\s\n]/.test(characters[i - 1])) {
                last = i - 1;
            } else {
                last = i;
            }
            break;
        }
    }

    if (last === -1) {
        return input.trimEnd();
    }

    return characters.slice(0, last + 1).join('').trimEnd();
}
export function isOdd(number) {
    return number % 2 !== 0;
}
export function countOccurrences(string, character) {
    let count = 0;

    for (let i = 0; i < string.length; i++) {
        if (string.substring(i, i + character.length) === character) {
            count++;
        }
    }

    return count;
}
