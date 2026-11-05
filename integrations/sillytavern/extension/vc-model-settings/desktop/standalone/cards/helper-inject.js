// PolyForm-Noncommercial-1.0.0. JS-Slash-Runner 0af42106 / src/function/inject.ts
import { eventSource, extension_prompts, registerInjectedPrompt, retireInjectedPrompt, retireInjectedPromptsById } from '../engine/ports.js';
import { setExtensionPrompt } from '../engine/st/script.js';
import { uuidv4 } from '../engine/st/scripts/utils.js';
import { getCardHost } from './ejs-host.js';
import { iframe_events, tavern_events } from './helper-event.js';
import * as helperHost from './helper-host.js';

const GLOBAL_INSTANCE_TOKEN = helperHost.GLOBAL_INSTANCE_TOKEN;
const getFrameOwner = (...args) => helperHost.getFrameOwner?.(...args) ?? null;
const getInstanceToken = (...args) =>
    typeof helperHost.getInstanceToken === 'function' ? helperHost.getInstanceToken(...args) : GLOBAL_INSTANCE_TOKEN;
const registerInstanceCleanup = (...args) => helperHost.registerInstanceCleanup?.(...args) ?? null;

export function injectPrompts(prompts, { once = false } = {}) {
    const frameOwner = getFrameOwner(this);
    if (frameOwner && (frameOwner.destroyed || getCardHost() !== frameOwner)) {
        return { uninject: () => {} };
    }
    const host = getCardHost();
    const targetPrompts = host?.context?.extensionPrompts ?? extension_prompts;
    const targetEmitter = host?.context?.eventSource ?? eventSource;
    const ownedEntries = new Map();
    prompts.forEach(prompt => {
        const id = prompt.id ?? uuidv4();
        retireInjectedPromptsById(targetPrompts, id);
        setExtensionPrompt(
            id,
            prompt.content ?? '',
            prompt.position === 'none' ? -1 : 1,
            prompt.depth ?? 0,
            prompt.should_scan ?? false,
            { system: 0, user: 1, assistant: 2 }[prompt.role ?? 'system'],
            prompt.filter ?? null,
        );
        if (targetPrompts && Object.hasOwn(targetPrompts, id)) {
            const promptRef = targetPrompts[id];
            ownedEntries.set(id, promptRef);
            registerInjectedPrompt(targetPrompts, id, promptRef);
        }
    });

    let deleted = false;
    let disposeCleanup = null;
    const win = (this && this !== globalThis.TavernHelper ? (this.window ?? this) : null) ?? globalThis.window;
    const jq = win?.jQuery ?? globalThis.jQuery ?? globalThis.$;
    const uninject = () => {
        if (deleted) {
            return;
        }
        deleted = true;
        disposeCleanup?.();
        jq?.(win)?.off?.('pagehide', uninject);
        win?.removeEventListener?.('pagehide', uninject);
        if (once) {
            targetEmitter?.removeListener?.(iframe_events.GENERATION_ENDED, uninject);
            targetEmitter?.removeListener?.(tavern_events.GENERATION_ENDED, uninject);
            targetEmitter?.removeListener?.(tavern_events.GENERATION_STOPPED, uninject);
        }
        for (const [id, expectedRef] of ownedEntries.entries()) {
            retireInjectedPrompt(targetPrompts, id, expectedRef);
            if (targetPrompts && targetPrompts[id] === expectedRef) {
                delete targetPrompts[id];
            }
        }
    };

    if (once) {
        targetEmitter?.on?.(iframe_events.GENERATION_ENDED, uninject);
        targetEmitter?.on?.(tavern_events.GENERATION_ENDED, uninject);
        targetEmitter?.on?.(tavern_events.GENERATION_STOPPED, uninject);
    }

    const rawToken = getInstanceToken(this);
    const token = rawToken === GLOBAL_INSTANCE_TOKEN && host ? getInstanceToken(host) : rawToken;
    disposeCleanup = registerInstanceCleanup(token, uninject);
    jq?.(win)?.on?.('pagehide', uninject);
    win?.addEventListener?.('pagehide', uninject, { once: true });

    return {
        uninject,
    };
}

export const _injectPrompts = injectPrompts;

export function uninjectPrompts(ids) {
    const frameOwner = getFrameOwner(this);
    if (frameOwner && (frameOwner.destroyed || getCardHost() !== frameOwner)) {
        return;
    }
    const targetPrompts = getCardHost()?.context?.extensionPrompts ?? extension_prompts;
    ids.forEach(k => {
        retireInjectedPromptsById(targetPrompts, k);
        if (targetPrompts) {
            delete targetPrompts[k];
        }
    });
}
