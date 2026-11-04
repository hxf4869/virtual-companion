// PolyForm-Noncommercial-1.0.0. JS-Slash-Runner 0af42106 / src/function/inject.ts
import { eventSource, extension_prompts } from '../engine/ports.js';
import { setExtensionPrompt } from '../engine/st/script.js';
import { uuidv4 } from '../engine/st/scripts/utils.js';
import { iframe_events, tavern_events } from './helper-event.js';

export function injectPrompts(prompts, { once = false } = {}) {
    const ids = [];
    prompts.forEach(prompt => {
        const id = prompt.id ?? uuidv4();
        ids.push(id);
        setExtensionPrompt(
            id,
            prompt.content ?? '',
            prompt.position === 'none' ? -1 : 1,
            prompt.depth ?? 0,
            prompt.should_scan ?? false,
            { system: 0, user: 1, assistant: 2 }[prompt.role ?? 'system'],
            prompt.filter ?? null,
        );
    });

    let deleted = false;
    const uninject = () => {
        if (deleted) {
            return;
        }
        uninjectPrompts(ids);
        deleted = true;
    };

    if (once) {
        eventSource?.once?.(iframe_events.GENERATION_ENDED, uninject);
        eventSource?.once?.(tavern_events.GENERATION_ENDED, uninject);
        eventSource?.once?.(tavern_events.GENERATION_STOPPED, uninject);
    }

    const win = (this && this !== globalThis.TavernHelper ? (this.window ?? this) : null) ?? globalThis.window;
    const jq = win?.jQuery ?? globalThis.jQuery ?? globalThis.$;
    jq?.(win)?.on?.('pagehide', uninject);
    win?.addEventListener?.('pagehide', uninject, { once: true });

    return {
        uninject,
    };
}

export const _injectPrompts = injectPrompts;

export function uninjectPrompts(ids) {
    ids.forEach(k => {
        if (extension_prompts) {
            delete extension_prompts[k];
        }
    });
}
