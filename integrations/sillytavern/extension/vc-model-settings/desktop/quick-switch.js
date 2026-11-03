// ⌘K / Ctrl+K 会话快速切换：读取侧栏已渲染的会话行，选中即点击该行（沿用外壳现有的切换入口）。
import { mountQuickSwitchView } from '../desktop/build/index.js';

const ROW = '.vc-convo[data-relationship-id]';

/** 按名称或预览筛选，大小写不敏感。 */
export function filterRows(rows, query) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => `${row.name} ${row.preview}`.toLowerCase().includes(q));
}

export function mountQuickSwitch({ doc = document } = {}) {
    let active = null;
    const text = (node, selector) => node.querySelector(selector)?.textContent?.trim() || '';
    function collect() {
        return [...doc.querySelectorAll(ROW)].map((node, index) => ({
            id: String(index), node, name: text(node, '.vc-convo-name'), preview: text(node, '.vc-convo-preview'),
            avatar: node.querySelector('.vc-convo-avatar')?.getAttribute('src') || '', letter: text(node, 'span.vc-convo-avatar'),
        }));
    }
    function close(restore) {
        const entry = active;
        if (!entry) return;
        active = null; entry.restore = restore;
        entry.view?.unmount(); entry.root.remove();
    }
    function open() {
        if (active) return;
        const root = doc.createElement('div'); root.id = 'vc-quick-switch'; doc.body.append(root);
        const entry = { root, opener: doc.activeElement, rows: collect(), restore: true, view: null };
        active = entry;
        entry.view = mountQuickSwitchView(root, {
            rows: entry.rows.map(({ node: _node, ...row }) => row), opener: entry.opener, filter: filterRows,
            returnFocus: () => entry.restore && entry.opener?.isConnected ? entry.opener : null,
            close: () => { if (active === entry) close(true); },
            dispose() { root.remove(); if (active === entry) active = null; },
            pick(id) {
                if (active !== entry) return;
                const row = entry.rows.find(item => item.id === id);
                if (!row?.node.isConnected) return;
                close(false); row.node.click();
            },
        });
    }
    return { open, close: () => close(true), toggle: () => active ? close(true) : open(), isOpen: () => Boolean(active) };
}
