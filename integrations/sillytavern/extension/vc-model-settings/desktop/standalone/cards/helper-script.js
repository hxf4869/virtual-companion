// AGPL-3.0-only. Locked upstream algorithms, adapted 2026-11-03 for explicit desktop ports.
import { _getScriptId } from './helper-util.js';
import { useScriptIframeRuntimesStore, getButtonId } from './helper-host.js';
import { klona } from './klona.js';
const isPromise=value=>value!=null&&typeof value.then==='function';
export function _getButtonEvent(button_name) {
    return getButtonId(String(_getScriptId.call(this)), button_name);
}
export function _getScriptButtons() {
    const script = useScriptIframeRuntimesStore().get(_getScriptId.call(this));
    // TODO: 对于预设脚本、角色脚本, $(window).on('pagehide') 时已经切换了角色卡, get 会失败
    if (!script) {
        return [];
    }
    return klona(script.button.buttons);
}
export function getAllEnabledScriptButtons() {
    return klona(useScriptIframeRuntimesStore().button_map);
}
export function _replaceScriptButtons(param1, param2) {
    const script = useScriptIframeRuntimesStore().get(_getScriptId.call(this));
    // TODO: 对于预设脚本、角色脚本, $(window).on('pagehide') 时已经切换了角色卡, get 会失败
    if (!script) {
        return;
    }
    const new_buttons = typeof param1 === 'string' ? param2 : param1;
    if (!_.isEqual(script.button.buttons, new_buttons)) {
        script.button.buttons = new_buttons;
    }
}
export function _updateScriptButtonsWith(updater) {
    const buttons = _getScriptButtons.call(this);
    let result = updater(buttons);
    if (isPromise(result)) {
        result = result.then((result) => {
            _replaceScriptButtons.call(this, result);
            return result;
        });
    }
    else {
        _replaceScriptButtons.call(this, result);
    }
    return result;
}
export function _appendInexistentScriptButtons(param1, param2) {
    const new_buttons = typeof param1 === 'string' ? param2 : param1;
    // @ts-expect-error 类型正确
    return _updateScriptButtonsWith.call(this, buttons => {
        const inexistent_buttons = new_buttons.filter(button => !buttons.some(b => b.name === button.name));
        return [...buttons, ...inexistent_buttons];
    });
}
export function _getScriptName() {
    // TODO: 对于预设脚本、角色脚本, $(window).on('pagehide') 时已经切换了角色卡, get 会失败
    const script = useScriptIframeRuntimesStore().get(_getScriptId.call(this));
    if (!script) {
        return '';
    }
    return script.name;
}
export function _getScriptInfo() {
    // TODO: 对于预设脚本、角色脚本, $(window).on('pagehide') 时已经切换了角色卡, get 会失败
    const script = useScriptIframeRuntimesStore().get(_getScriptId.call(this));
    if (!script) {
        return '';
    }
    return script.info;
}
export function _replaceScriptInfo(info) {
    const script = useScriptIframeRuntimesStore().get(_getScriptId.call(this));
    if (!script) {
        return;
    }
    script.info = info;
}
