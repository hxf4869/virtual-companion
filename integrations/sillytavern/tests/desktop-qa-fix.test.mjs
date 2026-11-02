import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const ext = (name) => readFile(new URL(`../extension/vc-model-settings/${name}`, import.meta.url), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('UX-22 QA P1-7 陪伴页离开守卫：与设置页相同的捕获阶段拦截，默认焦点来自 confirmDiscard', async () => {
    const source = await ext('inbox-page.js');
    assert.match(source, /import \{ confirmAlert, confirmDiscard \} from '\.\/ui\/alert\.js'/);
    assert.match(source, /shell\?\.addEventListener\('click', async \(event\) => \{[\s\S]*?\[data-nav\],\[data-settings\][\s\S]*?inboxPolicyDirty\(page\.state\)[\s\S]*?stopImmediatePropagation\(\)[\s\S]*?confirmDiscard\(\{ opener: target \}\)[\s\S]*?\{ capture: true, signal \}/);
});

test('UX-22 QA P1-9 陪伴模式分段：有底色轨道 + 白色滑块，且只在桌面', async () => {
    const css = strip(await ext('desktop/inbox.css'));
    assert.match(css, /\.vc-proactive-modes \.vc-cell\[aria-pressed\] \{[^}]*background: var\(--vc-segment-fill\)/);
    assert.match(css, /\.vc-proactive-modes \.vc-cell\[aria-pressed="true"\]::before \{[^}]*background: var\(--vc-thumb\)[^}]*box-shadow: var\(--vc-shadow-segment\)/);
    const theme = await ext('desktop/themes/aurora.css');
    assert.match(theme, /--vc-segment-fill: rgba\(118,118,128,\.12\)/);
    assert.match(theme, /--vc-shadow-segment: 0 2px 6px rgba\(0,0,0,\.12\)/);
    for (const line of css.split('\n')) if (/^\S.*\{/.test(line) && !line.startsWith('@') && !line.startsWith('}')) assert.match(line, /^html\[data-vc-layout="desktop"\]/, line.slice(0, 90));
});

test('UX-22 QA P2-16 窄桌面陪伴：标题栏固定，工作区自己滚动', async () => {
    const css = strip(await ext('desktop/inbox.css'));
    assert.match(css, /@media\(max-width:1179px\) \{[^}]*\.vc-desktop-inbox \{ overflow:hidden;[\s\S]*?\.vc-inbox-workspace \{ flex:1; min-height:0; overflow-x:hidden; overflow-y:auto;/);
});

test('UX-22 QA P2-17 记忆 / 陪伴 / 剧情共用 1052 盒左缘；剧情舞台改回玻璃', async () => {
    const memory = strip(await ext('desktop/memory.css'));
    assert.match(memory, /\.vc-desktop-memory > \.vc-column \{ margin:0 auto 0 max\(0px, calc\(\(100% - 1052px\) \/ 2\)\); \}/);
    const story = strip(await ext('desktop/story.css'));
    assert.match(story, /--vc-story-left: max\(24px, calc\(\(100% - 1052px\) \/ 2\)\)/);
    assert.match(story, /#vc-shell\[data-cover="story"\] \.vc-story-tab\[data-view="stage"\] \{ background:transparent; \}/);
});

test('UX-22 QA P2-15 记忆：桌面无筛选的空状态不放「清除筛选」，纠正时操作区常驻', async () => {
    const source = await ext('memory-page.js');
    assert.match(source, /filtered \|\| !desktopLayout\(\) \? tabBtn\('clear-filters'/);
    assert.match(source, /desktopLayout\(\)\) detailEl\?\.querySelector\('\[data-form="edit"\]'\)\?\.scrollIntoView/);
    const css = strip(await ext('desktop/memory.css'));
    assert.match(css, /form\[data-form="edit"\] \.vc-memory-actions \{ position:sticky; bottom:/);
    assert.match(css, /\.vc-group-title \+ \.vc-group \{ margin-bottom:var\(--vc-space-sm\); \}/);
});

test('UX-22 QA P2-9 / P2-14 模型页用途表：分栏对齐、16.4 控件、内卡不再是实色', async () => {
    const css = strip(await ext('desktop/settings.css'));
    assert.match(css, /\.vcms-layout \{ height: auto; \}/);
    assert.match(css, /\.vcms-bindings-table tr \{ display: grid; grid-template-columns: 200px minmax\(0, 1fr\) 96px; align-items: center;/);
    assert.match(css, /\.vcms-table-wrap \{ background: transparent;/);
    assert.match(css, /:is\(\.vcms-local \.vc-group, \.vcms-usage-cards\.vc-group\) \{ background: var\(--vc-raised\);/);
});

test('UX-22 QA P2-10 / P2-11 / P2-12 酒馆抽屉：滑杆统一、标题栏不压首行、返回钮为圆形图标钮', async () => {
    const css = strip(await ext('desktop/settings.css'));
    assert.match(css, /input\[type="range"\] \{ filter: none !important;/);
    assert.match(css, /\[data-vc-drawer-back\] \{ min-width: 40px; width: 40px; padding: 0;/);
    assert.match(css, /\[data-vc-drawer-back\] > span \{ display: none; \}/);
    assert.match(css, /> \[data-vc-drawer-nav\] \{ margin-bottom: var\(--vc-space-md\); \}/);
    const base = strip(await ext('desktop/base.css'));
    assert.match(base, /input\[type="checkbox"\]::before \{ content: none; \}/);
});

test('UX-22 QA P2-17 角色详情：文字型控件与分组正文同缩进', async () => {
    const css = strip(await ext('desktop/characters.css'));
    assert.match(css, /\.vc-card-description \.vc-btn-text \{ min-width:0; padding-inline:0; \}/);
    assert.match(css, /\.vc-instance-create \{ min-width:0; padding-inline:0; margin-left:var\(--vc-space-md\); \}/);
});
