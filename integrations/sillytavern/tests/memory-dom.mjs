// 旧字符串合同读取实际生产 React 视图；不保留生产 HTML renderer。
import { bootstrapDocument } from './react-dom-bootstrap.mjs';
import { mountMemoryListView, mountMemoryDetailView, mountMemoryContentsView } from '../extension/vc-model-settings/desktop/build/index.js';
import { createMemoryPage, memoryViewProps } from '../extension/vc-model-settings/memory-page.js';
const events = { action() {}, draft() {}, filter() {}, submit() {}, status() {}, incognito() {}, favoriteSegment() {} };
function render(state, ui, kind) {
    const host = bootstrapDocument.createElement('div'); bootstrapDocument.body.append(host);
    const props = memoryViewProps({ ...createMemoryPage().state, ...state }, ui, { ...events, desktop: ['desktop', 'diary', 'favorites'].includes(kind) });
    const view = kind === 'classic' ? mountMemoryContentsView(host, props) : kind === 'detail' ? mountMemoryDetailView(host, props) : mountMemoryListView(host, props);
    try {
        if (kind === 'diary') return host.querySelector('.vc-diary').outerHTML;
        if (kind === 'favorites') return host.querySelector('.vc-fav').outerHTML;
        return kind === 'mobile' || kind === 'desktop' ? host.firstElementChild.innerHTML : host.innerHTML;
    } finally { view.unmount(); host.remove(); }
}
export const renderMemoryPage = state => render(state, {}, 'classic');
export const renderMemoryDetailTab = state => render(state, {}, 'detail');
export const renderMemoryTab = state => render(state, {}, 'mobile');
export const renderDesktopMemory = (state, ui = {}) => render(state, ui, 'desktop');
export const renderDiary = (state, { font = 'body' } = {}) => render({}, { section: 'diary', diary: state, font }, 'diary');
export const renderFavorites = (state, { names = {}, now = new Date() } = {}) => render({ relationships: Object.entries(names).map(([relationshipId, companionName]) => ({ relationshipId, companionName })) }, { section: 'favorites', favorites: state, now }, 'favorites');
