import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { DRAWER_PAGES } from '../extension/vc-model-settings/drawers.js';

const read = (name) => readFile(new URL(`../extension/vc-model-settings/desktop/${name}`, import.meta.url), 'utf8');
const SECTION = '/* UX-22 R4：九个酒馆抽屉在设置内容区原位打开';

async function drawerSection() {
    const css = await read('settings.css');
    const start = css.indexOf(SECTION);
    assert.ok(start > 0, '缺少 R4 抽屉样式段');
    return css.slice(start);
}

test('R4 抽屉样式只按九个内容根 id 选择，且只在设置壳标记抽屉时生效', async () => {
    const section = await drawerSection();
    assert.equal(section.replace(/\/\*[\s\S]*?\*\//g, '').includes('.drawer-content'), false);
    const ids = DRAWER_PAGES.map((page) => `#${page.id}`);
    const roots = section.match(/:is\(([^)]*)\)\.vc-drawer-page/g) || [];
    assert.ok(roots.length >= 1);
    for (const root of roots) for (const id of ids) assert.ok(root.includes(id), `${id} 不在抽屉根选择器中`);
    assert.match(section, /body\.vc-ui:has\(\.vc-settings-shell\[data-drawer\]\)/);
    const selectors = section.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => /\{\s*$/.test(line) && !line.trim().startsWith('@media'));
    for (const line of selectors) {
        if (!line.startsWith('html[')) continue;
        assert.match(line, /html\[data-vc-layout="desktop"\] body\.vc-ui/, line);
    }
});

test('R4 抽屉样式不写字面颜色，!important 同行注明原因', async () => {
    const section = await drawerSection();
    for (const line of section.split('\n')) {
        const code = line.replace(/\/\*[\s\S]*?\*\//g, '');
        assert.equal(/#[0-9a-fA-F]{3,8}\b(?![\w-])/.test(code.replace(/#(left-nav-panel|rm_api_block|AdvancedFormatting|WorldInfo|user-settings-block|Backgrounds|rm_extensions_block|PersonaManagement|right-nav-panel|bg-header-fixed|bg_tabs)\b/g, '')), false, `字面色值：${line}`);
        assert.equal(/rgba?\(\s*\d/.test(code), false, `字面颜色：${line}`);
        if (code.includes('!important')) assert.ok(line.includes('/*'), `!important 缺少同行原因：${line.trim().slice(0, 80)}`);
    }
});

test('桌面设置壳在内容区打开抽屉，离开分类与返回时关闭，账户页显示头像行', async () => {
    const shell = await read('settings-shell.js');
    assert.match(shell, /import \{ openDrawerPage, closeDrawerPage \} from '\.\.\/drawers\.js'/);
    assert.match(shell, /root\.dataset\.drawer = key/);
    assert.match(shell, /function leaveDrawer\(\)[\s\S]{0,260}closeDrawerPage\(node\)/);
    assert.match(shell, /leaveDrawer\(\);\s*\n\s*voice = null/);
    assert.match(shell, /\[data-vc-drawer-back\]/);
    assert.equal(shell.includes('delete shell.dataset.settings'), false, '打开抽屉不再退出设置页');
    assert.match(shell, /row\('password','密码'\)[\s\S]{0,40}row\('auth','身份验证器'\)/);
    const account = shell.slice(shell.indexOf("else if (key === 'account')"), shell.indexOf("else if (key === 'data')"));
    assert.equal(account.includes('账户与数据'), false, '账户页不再重复分类列的入口行');
});
