// 原字符串合同改为生产 React 挂载；HTML 只在测试中读取，不保留生产旧 renderer。
import { bootstrapDocument } from './react-dom-bootstrap.mjs';
import { mountCharactersView, mountInstanceContentsView } from '../extension/vc-model-settings/desktop/build/index.js';
import { characterViewProps } from '../extension/vc-model-settings/instance-page.js';
const events = { action() {}, name() {}, save() {} };
function render(state, options, legacy) {
    const host = bootstrapDocument.createElement('div');
    const props = characterViewProps(state, { events, detailRef: options.detailRef || state.selectedCharacterRef || '', ...options });
    const view = legacy ? mountInstanceContentsView(host, props) : mountCharactersView(host, props);
    try { return host.innerHTML + (legacy ? bootstrapDocument.querySelector('.vc-instance-unsaved')?.outerHTML || '' : ''); }
    finally { view.unmount(); }
}
export const renderCharactersTab = (state, options = {}) => render(state, options, false);
export const renderInstancePage = state => render(state, {}, true);
