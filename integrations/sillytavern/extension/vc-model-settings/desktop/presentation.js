// 仅调整已渲染页面的桌面排版；事件和数据继续由原页面控制器负责。
export const desktopLayout = () => globalThis.document?.documentElement?.dataset.vcLayout === 'desktop';

export function presentMemory(screen, state) {
    screen.querySelector('.vc-scroll')?.classList.add('vc-desktop-memory');
    const column = screen.querySelector('.vc-column');
    const form = column?.querySelector('form[data-form="filters"]');
    const results = column?.querySelector('.vc-memory-results');
    const search = form?.querySelector('.vc-search');
    if (!form || !results || !search) return;
    const aside = document.createElement('aside');
    aside.className = 'vc-memory-sidebar';
    const main = document.createElement('div');
    main.className = 'vc-memory-main';
    for (const child of [...form.children]) if (child !== search) aside.append(child);
    main.append(search, results);
    form.append(aside, main);
    for (const row of screen.querySelectorAll('.vc-memory-row[data-memory-id]')) {
        const item = state.items.find(item => String(item.memoryId) === row.dataset.memoryId);
        if (!item) continue;
        const actions = document.createElement('div');
        actions.className = 'vc-memory-row-actions';
        for (const [action, label] of [['edit', '纠正'], ['confirm-forget', '删除']]) {
            if (action === 'edit' && item.lifecycle !== 'ACTIVE'
                || action === 'confirm-forget' && ['FORGETTING', 'FORGOTTEN'].includes(item.lifecycle)) continue;
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'vc-btn vc-btn-text'; button.textContent = label;
            button.dataset.action = action; button.dataset.memoryId = row.dataset.memoryId; button.disabled = state.busy;
            actions.append(button);
        }
        row.parentElement.append(actions);
    }
}

export function presentInbox(screen) {
    screen.querySelector('.vc-scroll')?.classList.add('vc-desktop-inbox');
    const column = screen.querySelector('.vc-column');
    const title = column?.querySelector('h1');
    const bar = screen.querySelector('.vc-navbar');
    if (!column || !title || !bar) return;
    bar.classList.add('vc-inbox-heading');
    bar.prepend(title);
    column.prepend(bar);
    const save = bar.querySelector('[data-action="save-policy"]');
    if (save) {
        save.className = 'vc-btn vc-btn-fill';
        save.setAttribute('data-save-policy', '');
    }
    const follows = column.querySelector('[aria-label="跟进"]');
    const preferences = column.querySelector('.vc-inbox-preferences');
    if (follows && preferences) preferences.prepend(follows);
    for (const heading of column.querySelectorAll('.vc-group-title')) {
        const group = heading.nextElementSibling;
        if (!group?.classList.contains('vc-group')) continue;
        if (heading.textContent === '静默时段') group.classList.add('vc-inbox-quiet');
        group.prepend(heading);
    }
}

export function presentStory(body) {
    const header = body.querySelector('.vc-navbar');
    const title = header?.querySelector('.vc-nav-title');
    if (!header || !title) return;
    title.setAttribute('role', 'heading');
    title.setAttribute('aria-level', '1');
    title.tabIndex = -1;
    body.querySelector('.vc-large-title')?.remove();
    const start = body.querySelector('[data-action="start"]');
    if (start) header.append(start);
}
