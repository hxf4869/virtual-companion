import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { installReactDom } from './react-dom.mjs';
import { DRAWER_PAGES } from '../extension/vc-model-settings/drawers.js';

const read = (name) => readFile(new URL(`../extension/vc-model-settings/desktop/${name}`, import.meta.url), 'utf8');
test('桌面设置样式不再接管九个原生抽屉，手机原生抽屉清单仍保留', async () => {
    const css = await read('settings.css');
    assert.equal(DRAWER_PAGES.length, 9);
    assert.doesNotMatch(css, /vc-drawer-page|data-drawer|data-vc-drawer|--vc-drawer-/);
    for (const { id } of DRAWER_PAGES) assert.equal(css.includes(`#${id}`), false);
});

test('自有酒馆表单沿用语义颜色和可见焦点，不使用原生抽屉选择器', async () => {
    const css = await read('tavern.css');
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
    assert.doesNotMatch(css, /openDrawer|vc-drawer-page/);
    assert.match(css, /focus-visible[^}]+outline: 2px solid var\(--vc-accent\)/);
    assert.match(css, /min-height: 44px/);
});

test('桌面设置直接挂载九个数据编辑器并释放上一页，账户头像行保留', async (t) => {
    const shell = await read('settings-shell.js');
    assert.doesNotMatch(shell, /openDrawerPage|closeDrawerPage|dataset\.drawer|data-vc-drawer-back/);
    assert.equal(shell.includes('delete shell.dataset.settings'), false);
    const doc = installReactDom(t);
    doc.body.classList.add('vc-ui');
    const container = doc.createElement('div');doc.body.append(container);
    const { mountSettingsShell } = await import('../extension/vc-model-settings/desktop/settings-shell.js');
    const mounted = [], disposed = [];
    const controller = mountSettingsShell(container, { getContext: () => ({ name1: '合成用户' }),
        async mountTavernSettings(_body, { key, signal }) {
            mounted.push({ key, signal });
            return { requestLeave: () => true, destroy() { disposed.push(key); } };
        } });
    try {
        await controller.select('account', { initial: true });
        const account = controller.root.querySelector('.vc-settings-profile');
        assert.equal(account.querySelector('[data-who-avatar]').textContent, '合');
        assert.equal(account.querySelector('strong').textContent, '合成用户');
        assert.deepEqual([...account.querySelectorAll('[data-account-go]')].map(node => [node.dataset.accountGo, node.textContent]), [['password', '密码'], ['auth', '身份验证器']]);
        assert.equal(account.textContent.includes('账户与数据'), false, '账户页不再重复分类列的入口行');
        for (const { id } of DRAWER_PAGES) await controller.select(id);
        assert.deepEqual(mounted.map(row => row.key), DRAWER_PAGES.map(row => row.id));
        assert.deepEqual(disposed, DRAWER_PAGES.slice(0, -1).map(row => row.id));
        assert.ok(mounted.slice(0, -1).every(row => row.signal.aborted));
        assert.equal(controller.root.dataset.drawer, undefined);
    } finally { controller.destroy(); }
});
