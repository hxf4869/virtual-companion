export const scenarios = [{ key: 'characters', params: {} }, { key: 'characters-selected', params: { selected: '1' } }, { key: 'characters-detail', params: { detail: '1' } }, ...['empty', 'loading', 'error', 'long'].map(state => ({ key: `characters-${state}`, params: { state } }))];

function input(node, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
}

async function wait(predicate) {
    for (let i = 0; i < 150; i++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw Error('角色生产组件状态未更新');
}

export async function mount({ container, args = {}, source, params, context }) {
    const mod = await import(`${source}/instance-page.js`);
    if (params.get('loose')) {
        const { previewRelationships: rows } = await import('../fixtures.js');
        if (!rows.some(row => row.relationshipId === '99')) rows.push({ ...rows[0], relationshipId: '99', companionName: '雨夜旅馆', characterRef: '' });
    }
    // 样板只提供数据与宿主边界；渲染、草稿、导航、保存和监听全部调用生产挂载。
    const handle = mod.mountCharactersTab(container, { ...args, getCards: () => mod.cardsFromContext(context), getBindings: () => mod.bindingsFromContext(context) });
    const root = container.querySelector('.vc-characters');
    window.VC_CHARACTERS_PREVIEW = { root, handle };
    if (params.get('state') !== 'loading') await wait(() => !root.querySelector('[aria-busy="true"]'));
    if (params.get('detail') === '1' || params.get('selected') === '1' || params.get('state') === 'long') {
        root.querySelector('.vc-role[data-ref]')?.click();
        await wait(() => root.querySelector('.vc-character-detail'));
    }
    return handle;
}

export async function check({ params }) {
    if (innerWidth < 744 || ['loading', 'empty', 'error'].includes(params.get('state'))) return;
    const { root } = window.VC_CHARACTERS_PREVIEW;
    const search = root.querySelector('.vc-character-search');
    input(search, '林舟');
    const found = [...root.querySelectorAll('.vc-role')].filter(card => !card.hidden);
    if (found.length !== 1 || !found[0].textContent.includes('林舟') || !found[0].textContent.includes('1 个实例')) throw Error('角色名过滤或实例计数错误');
    input(search, '');
    root.querySelector('.vc-role[data-ref]').click();
    await wait(() => root.querySelector('.vc-character-detail'));
    if (Math.abs(root.querySelector('.vc-character-detail').getBoundingClientRect().width - 400) > 1) throw Error('角色详情不是400宽');
    root.querySelector('.vc-character-detail [data-action="create"]').click();
    await wait(() => root.querySelector('[name="displayName"]')?.value === '');
    input(root.querySelector('[name="displayName"]'), '合成草稿');
    root.querySelector('.vc-character-detail [data-action="back"]').click();
    await wait(() => document.querySelector('.vc-alert'));
    if (document.activeElement.textContent !== '继续编辑') throw Error('实例退出默认焦点错误');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(() => !document.querySelector('.vc-alert'));
    if (root.querySelector('[name="displayName"]').value !== '合成草稿') throw Error('实例Esc丢草稿');
    root.querySelector('.vc-character-detail [data-action="back"]').click();
    await wait(() => document.querySelector('.vc-alert'));
    document.querySelector('[data-vc-ok]').click();
    await wait(() => !root.querySelector('.vc-character-detail'));
    root.querySelector('.vc-role[data-ref]').click();
    await wait(() => root.querySelector('.vc-character-detail'));
    root.querySelector('.vc-character-detail [data-action="create"]').click();
    const next = root.querySelector('[name="displayName"]');
    input(next, '合成新增实例');
    window.VC_PREVIEW_DELAY = 200;
    root.querySelector('.vc-character-detail [type="submit"]').click();
    if (!root.querySelector('[name="displayName"]').disabled) throw Error('创建等待时表单未锁定');
    await wait(() => !root.querySelector('[name="displayName"]').disabled && root.querySelector('.vc-role[data-ref] > span:last-child')?.textContent === '2 个实例');
    window.VC_PREVIEW_DELAY = 0;
}
