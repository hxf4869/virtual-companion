// AGPL-3.0-only. SillyTavern 7e8663cd9c184a550b37238218bdd32c6efc68e9 / scripts/macros/engine/MacroDiagnostics.js
// 原计算模块；只适配显式状态、输入/首显消息与无正文诊断端口。
export function inferMacroName(call, def, explicit) {
    if (typeof explicit === 'string' && explicit.trim()) {
        return explicit.trim();
    }
    if (call && typeof call.name === 'string' && call.name.trim()) {
        return call.name.trim();
    }
    if (def && typeof def.name === 'string' && def.name.trim()) {
        return def.name.trim();
    }
    return 'unknown';
}

export function createMacroRuntimeError({ message, call, def, macroName }) {
    const inferredName = inferMacroName(call, def, macroName);

    const error = new Error(message);
    error.name = 'MacroRuntimeError';
    // @ts-ignore - custom tagging for downstream classification
    error.isMacroRuntimeError = true;
    // @ts-ignore - helpful metadata for debugging
    error.macroName = inferredName;
    // @ts-ignore - best-effort location information
    error.macroRange = call && call.range ? call.range : null;
    // @ts-ignore - attach raw call/definition for convenience
    if (call) error.macroCall = call;
    // @ts-ignore
    if (def) error.macroDefinition = def;

    return error;
}
export function logMacroGeneralError() {}
export function logMacroInternalError() {}
export function logMacroRuntimeWarning() {}
export function logMacroSyntaxWarning() {}
export function logMacroRegisterError() {}
export function logMacroRegisterWarning() {}
