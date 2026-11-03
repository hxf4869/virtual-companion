// 原字符串断言读取实际生产组件；不保留平行HTML renderer。
import { bootstrapDocument as doc } from './react-dom-bootstrap.mjs';
import { mountStoryView } from '../extension/vc-model-settings/desktop/build/index.js';
import { storyViewProps } from '../extension/vc-model-settings/story-page.js';
function render(state, options, legacy) {
    const root = doc.createElement('div'), host = doc.createElement('div'); root.append(host); doc.body.append(root);
    const props = storyViewProps(state, { ...options, legacy, rewindHost: root });
    const view = mountStoryView(host, props, root);
    try { return (legacy ? host.querySelector('.vc-story-page').innerHTML : host.innerHTML) + (root.querySelector('.vc-story-rewind-dialog')?.outerHTML || ''); }
    finally { view.unmount(); root.remove(); }
}
export const renderStoryPage = state => render(state, {}, true);
export const renderStoryTab = (state, options = {}) => render(state, options, false);
export const storyNode = html => { const node = doc.createElement('div'); node.innerHTML = html; return node; };
