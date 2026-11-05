// VC lifecycle adapter and re-export facade for generated locked-source ST macros.
import {
    eventSource,
    isMobile,
    power_user,
    getLastGenerationType,
    bindMacroEventSource,
    disposeMacroEventSource,
} from '../../ports.js';
import { initRegisterMacros } from '../../../../locked-source/st/scripts/macros/macro-system.js';
import { MacrosParser } from '../../../../locked-source/st/scripts/macros.js';

export * from '../../../../locked-source/st/scripts/macros.js';

let macrosRegistered = false;

export function disposeMacros(targetEventSource) {
    disposeMacroEventSource(targetEventSource);
}

export function initMacros(targetEventSource = eventSource) {
    if (!macrosRegistered) {
        initRegisterMacros();
        const previousMode = power_user?.experimental_macro_engine;
        try {
            if (power_user && typeof power_user === 'object') {
                power_user.experimental_macro_engine = false;
            }
            MacrosParser.registerMacro(
                'lastGenerationType',
                () => getLastGenerationType(),
                'Returns the type of the last generation (e.g., "normal", "swipe", "continue", "impersonate", "quiet").',
            );
            MacrosParser.registerMacro(
                'isMobile',
                () => String(isMobile()),
                'Returns "true" if the user is on a mobile device, "false" otherwise.',
            );
        } finally {
            if (power_user && typeof power_user === 'object' && previousMode !== undefined) {
                power_user.experimental_macro_engine = previousMode;
            }
        }
        macrosRegistered = true;
    }

    bindMacroEventSource(targetEventSource);
}
