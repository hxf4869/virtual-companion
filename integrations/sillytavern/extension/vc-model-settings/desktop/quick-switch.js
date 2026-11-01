// ⌘K / Ctrl+K 会话快速切换：读取侧栏已渲染的会话行，选中即点击该行（沿用外壳现有的切换入口）。
const ROW = '.vc-convo[data-relationship-id]';

/** 按名称或预览筛选，大小写不敏感。 */
export function filterRows(rows, query) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => `${row.name} ${row.preview}`.toLowerCase().includes(q));
}

export function mountQuickSwitch({ doc = document } = {}) {
    let root = null;
    let opener = null;
    let rows = [];
    let shown = [];
    let index = 0;

    const text = (node, selector) => node.querySelector(selector)?.textContent?.trim() || '';
    function collect() {
        return [...doc.querySelectorAll(ROW)].map((node) => ({
            node,
            name: text(node, '.vc-convo-name'),
            preview: text(node, '.vc-convo-preview'),
            avatar: node.querySelector('.vc-convo-avatar')?.getAttribute('src') || '',
            letter: text(node, 'span.vc-convo-avatar'),
        }));
    }

    function paint(list, query) {
        list.textContent = '';
        shown = filterRows(rows, query);
        index = Math.min(index, Math.max(0, shown.length - 1));
        if (!shown.length) {
            const empty = doc.createElement('p');
            empty.className = 'vc-quick-empty';
            empty.textContent = '没有找到';
            list.append(empty);
            return;
        }
        shown.forEach((row, i) => {
            const item = doc.createElement('button');
            item.type = 'button';
            item.className = 'vc-quick-row';
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(i === index));
            const avatar = row.avatar ? doc.createElement('img') : doc.createElement('span');
            avatar.className = 'vc-quick-avatar';
            if (row.avatar) { avatar.alt = ''; avatar.src = row.avatar; } else avatar.textContent = row.letter || [...row.name][0] || '';
            const name = doc.createElement('span');
            name.className = 'vc-quick-name';
            name.textContent = row.name;
            const preview = doc.createElement('span');
            preview.className = 'vc-quick-preview';
            preview.textContent = row.preview;
            item.append(avatar, name, preview);
            item.addEventListener('click', () => pick(row));
            list.append(item);
        });
    }

    function pick(row) {
        close(false);
        row.node.click();
    }

    function open() {
        if (root) return;
        opener = doc.activeElement;
        rows = collect();
        index = 0;
        root = doc.createElement('div');
        root.id = 'vc-quick-switch';
        const scrim = doc.createElement('div');
        scrim.className = 'vc-quick-scrim';
        scrim.addEventListener('click', () => close(true));
        const panel = doc.createElement('div');
        panel.className = 'vc-quick-panel vc-glass';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', '搜索会话');
        const input = doc.createElement('input');
        input.type = 'text';
        input.className = 'vc-quick-input';
        input.autocomplete = 'off';
        input.placeholder = '搜索会话';
        input.setAttribute('aria-label', '搜索会话');
        const list = doc.createElement('div');
        list.className = 'vc-quick-list';
        list.setAttribute('role', 'listbox');
        panel.append(input, list);
        root.append(scrim, panel);
        doc.body.append(root);
        paint(list, '');
        input.addEventListener('input', () => { index = 0; paint(list, input.value); });
        input.addEventListener('keydown', (event) => {
            if (event.isComposing) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!shown.length) return;
                index = (index + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
                paint(list, input.value);
                list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
                return;
            }
            if (event.key === 'Enter' && shown[index]) { event.preventDefault(); pick(shown[index]); }
        });
        input.focus();
    }

    function close(restore) {
        if (!root) return;
        root.remove();
        root = null;
        if (restore) opener?.focus?.();
    }

    return { open, close: () => close(true), toggle: () => (root ? close(true) : open()), isOpen: () => Boolean(root) };
}
