// Thin local port adapter for locked ST slash command parser/runtime integration.
import { chat, chat_metadata, power_user } from './ports.js';
import { getCardHost } from '../cards/ejs-host.js';
import { PARSER_FLAG } from '../../locked-source/st/scripts/slash-commands/SlashCommandParser.js';
import { SlashCommandAbortController } from '../../locked-source/st/scripts/slash-commands/SlashCommandAbortController.js';

export const PARSER_FLAG_KEYS = Object.freeze({
    STRICT_ESCAPING: PARSER_FLAG.STRICT_ESCAPING,
    REPLACE_GETVAR: PARSER_FLAG.REPLACE_GETVAR,
});

const VALID_BOOLEAN_FLAG_STRINGS = new Set(['true', 'false', 'on', 'off', '1', '0']);

export function getActiveSlashContext() {
    return getCardHost()?.context ?? null;
}

export function createSlashAbortController(rawAbortController = null, fullOptions = null) {
    if (fullOptions?.debugController !== undefined && fullOptions?.debugController !== null) {
        throw new Error('Slash command debugger (debugController) is not supported');
    }
    if (fullOptions?.signal !== undefined && fullOptions?.signal !== null) {
        throw new Error('Native AbortSignal is not supported; pass SlashCommandAbortController');
    }
    if (rawAbortController === undefined || rawAbortController === null) {
        return new SlashCommandAbortController();
    }
    if (!(rawAbortController instanceof SlashCommandAbortController)) {
        throw new Error('Invalid abortController: expected SlashCommandAbortController (native AbortSignal is not supported)');
    }
    return rawAbortController;
}

export function emitSanitizedSlashEvent(eventName, detail = {}) {
    const host = getCardHost();
    if (typeof host?.emit === 'function') {
        host.emit(eventName, { ...detail });
    }
}

function parseStrictFlagBoolean(rawVal) {
    if (typeof rawVal === 'boolean') return rawVal;
    if (typeof rawVal === 'number' && (rawVal === 1 || rawVal === 0)) return Boolean(rawVal);
    if (typeof rawVal === 'string') {
        const norm = rawVal.trim().toLowerCase();
        if (VALID_BOOLEAN_FLAG_STRINGS.has(norm)) {
            return norm === 'true' || norm === 'on' || norm === '1';
        }
    }
    throw new Error('VC_SLASH_INVALID_PARSER_FLAG_VALUE');
}

export function resolveParserFlags(overrideFlags = null) {
    if (overrideFlags !== null && overrideFlags !== undefined) {
        if (typeof overrideFlags !== 'object' || Array.isArray(overrideFlags)) {
            throw new Error('VC_SLASH_UNSUPPORTED_PARSER_FLAG');
        }
    }
    const merged = {};
    const applySource = (source, isStrictOverride) => {
        if (!source || typeof source !== 'object') return;
        for (const [rawKey, rawVal] of Object.entries(source)) {
            if (rawVal === undefined || rawVal === null) continue;
            const enabled = isStrictOverride ? parseStrictFlagBoolean(rawVal) : Boolean(rawVal);
            if (rawKey === 'STRICT_ESCAPING' || String(rawKey) === String(PARSER_FLAG.STRICT_ESCAPING)) {
                merged[PARSER_FLAG.STRICT_ESCAPING] = enabled;
            } else if (rawKey === 'REPLACE_GETVAR' || String(rawKey) === String(PARSER_FLAG.REPLACE_GETVAR)) {
                merged[PARSER_FLAG.REPLACE_GETVAR] = enabled;
            } else {
                throw new Error('VC_SLASH_UNSUPPORTED_PARSER_FLAG');
            }
        }
    };
    applySource(power_user?.stscript?.parser?.flags, false);
    applySource(overrideFlags, true);
    return merged;
}

export function captureSlashExecutionSnapshot() {
    const context = getActiveSlashContext();
    return {
        context,
        chatId: context?.chatId,
        chatRef: chat,
        metadataRef: chat_metadata,
    };
}

export function assertSlashSnapshotOwnership(snapshot) {
    const currentContext = getActiveSlashContext();
    if (
        !snapshot?.context ||
        !currentContext ||
        currentContext !== snapshot.context ||
        (snapshot.chatId !== undefined && currentContext.chatId !== snapshot.chatId) ||
        !snapshot.metadataRef ||
        chat_metadata !== snapshot.metadataRef ||
        currentContext.chatMetadata !== snapshot.metadataRef ||
        (snapshot.chatRef && chat !== snapshot.chatRef)
    ) {
        throw new Error('VC_SLASH_SESSION_STALE');
    }
    return currentContext;
}

export function assertSlashExecutionActive(snapshot, abortController = null) {
    if (abortController?.isAborted || abortController?.signal?.aborted) {
        throw new Error('VC_SLASH_ABORTED');
    }
    return assertSlashSnapshotOwnership(snapshot);
}

export async function settleSlashExecutionPersistence(
    snapshot,
    abortController = null,
    { allowAborted = false } = {},
) {
    const currentContext = allowAborted
        ? assertSlashSnapshotOwnership(snapshot)
        : assertSlashExecutionActive(snapshot, abortController);

    if (!currentContext.metadataDirty && !currentContext.settingsDirty) {
        return;
    }

    if (typeof currentContext.commitHelperChanges !== 'function') {
        throw new Error('VC_SLASH_COMMIT_PORT_MISSING');
    }

    const ok = await currentContext.commitHelperChanges(snapshot.metadataRef);
    if (ok === false) {
        throw new Error('VC_SLASH_COMMIT_REJECTED');
    }
}
