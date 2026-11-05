// PolyForm-Noncommercial-1.0.0. JS-Slash-Runner 0af421068 / src/function/preset.ts
import { getCardHost } from './ejs-host.js';
import { klona } from './klona.js';
import {
    isPresetNormalPrompt,
    isPresetSystemPrompt,
    isPresetPlaceholderPrompt,
    default_preset,
    toPreset,
} from '../../locked-source/helper/function/preset.js';

export {
    isPresetNormalPrompt,
    isPresetSystemPrompt,
    isPresetPlaceholderPrompt,
    default_preset,
};

export const getPresetNames = () => klona(['in_use', ...Object.keys(getCardHost().presets)]);
export const getLoadedPresetName = () => getCardHost().settings.oai_settings.preset_settings_openai;

export function getPreset(preset_name = 'in_use') {
    const { settings, presets } = getCardHost();
    const original_preset = preset_name === 'in_use' ? settings.oai_settings : presets[preset_name];
    if (!original_preset) {
        throw Error(`预设 '${preset_name}' 不存在`);
    }
    const source = original_preset.extensions === undefined
        ? { ...original_preset, extensions: {} }
        : original_preset;
    return klona(toPreset(source, { in_use: preset_name === 'in_use' }));
}
