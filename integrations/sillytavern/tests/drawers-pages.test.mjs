import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { renderAccountShell } from '../extension/vc-model-settings/data-rights.js';
import {
    DRAWER_PAGES,
    closeDrawerPage,
    openDrawerPage,
    syncDrawerPage,
    vcUiEnabled,
} from '../extension/vc-model-settings/drawers.js';
import { localHealthView, localModelsFromPayload } from '../extension/vc-model-settings/model-logic.js';
import { installMiniDom } from './mini-dom.mjs';

function stripCssComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function ruleSelectors(css) {
    const out = [];
    const text = stripCssComments(css);
    const re = /([^{}]+)\{/g;
    let match;
    while ((match = re.exec(text))) {
        const selector = match[1].replace(/\s+/g, ' ').trim();
        if (!selector || selector.startsWith('@')) continue;
        out.push(selector);
    }
    return out;
}

test('九个抽屉页有稳定标题，样式只作用于 body.vc-ui', async () => {
    assert.deepEqual(DRAWER_PAGES.map((page) => page.id), [
        'left-nav-panel',
        'rm_api_block',
        'AdvancedFormatting',
        'WorldInfo',
        'user-settings-block',
        'Backgrounds',
        'rm_extensions_block',
        'PersonaManagement',
        'right-nav-panel',
    ]);
    assert.deepEqual(DRAWER_PAGES.map((page) => page.title), [
        'AI 回复配置',
        'API 连接',
        '提示词格式',
        '世界书',
        '界面',
        '背景',
        '扩展',
        '人设',
        '角色卡',
    ]);
    const drawersCss = stripCssComments(await readFile(new URL('../extension/vc-model-settings/drawers.css', import.meta.url), 'utf8'));
    const settingsCss = stripCssComments(await readFile(new URL('../extension/vc-model-settings/settings-pages.css', import.meta.url), 'utf8'));
    assert.equal(drawersCss.includes('.drawer-content'), false);
    for (const id of ['floatingPrompt', 'cfgConfig', 'logprobsViewer', 'movingDivs', 'completion_prompt_manager_popup']) {
        assert.equal(drawersCss.includes(id), false, id);
    }
    for (const selector of [...ruleSelectors(drawersCss), ...ruleSelectors(settingsCss)]) {
        assert.equal(selector.includes('body.vc-ui'), true, selector);
    }
    assert.equal(renderAccountShell().includes('data-vc-account-nav'), false);
    assert.equal(renderAccountShell().includes('aria-label="修改密码"'), true);
});

test('打开抽屉只点原开关，导航留在内容根内', () => {
    const document = installMiniDom();
    document.body.innerHTML = `
        <div id="top-settings-holder">
            <div id="sys-settings-button" class="drawer">
                <div class="drawer-toggle"></div>
                <div id="rm_api_block" class="drawer-content closedDrawer">
                    <select id="main_api"><option value="openai">Chat</option></select>
                </div>
            </div>
        </div>`;
    const root = document.querySelector('#rm_api_block');
    const toggle = document.querySelector('.drawer-toggle');
    let clicks = 0;
    toggle.addEventListener('click', () => { clicks += 1; });
    assert.equal(vcUiEnabled(document), false);
    assert.equal(openDrawerPage('rm_api_block', document), true);
    assert.equal(clicks, 1);
    assert.equal(document.querySelector('#main_api').parent.id, 'rm_api_block');
    assert.equal(root.parent.id, 'sys-settings-button');
    root.classList.add('openDrawer');
    syncDrawerPage(root, document);
    assert.equal(root.querySelector('[data-vc-drawer-nav]'), null);

    document.body.classList.add('vc-ui');
    syncDrawerPage(root, document);
    const nav = root.querySelector('[data-vc-drawer-nav]');
    assert.ok(nav);
    assert.match(nav.textContent, /API 连接/);
    assert.match(nav.textContent, /设置/);
    assert.equal(document.querySelector('#top-settings-holder').querySelector('#main_api').id, 'main_api');
    assert.equal(openDrawerPage('rm_api_block', document), true);
    assert.equal(clicks, 1);

    let stopped = false;
    const back = root.querySelector('[data-vc-drawer-back]');
    back.dispatch('click', { stopPropagation() { stopped = true; } });
    assert.equal(stopped, true);
    assert.equal(clicks, 2);
    assert.equal(closeDrawerPage(root), true);
    assert.equal(clicks, 3);
    assert.equal(openDrawerPage('missing-drawer', document), false);
});

test('本机模型按真实状态展示，未知负载收成行内不可用', () => {
    assert.equal(localHealthView({ healthy: true }).label, '运行中');
    assert.equal(localHealthView({ healthy: false }).label, '不可用');
    assert.equal(localHealthView({ healthy: true, deploymentEnabled: false }).label, '已在部署中关闭');
    assert.equal(localHealthView({ deploymentEnabled: false }).switchDisabled, true);
    const missing = localModelsFromPayload(null);
    assert.equal(missing.phase, 'ready');
    assert.equal(missing.embedding.name, 'qwen3-embedding:0.6b');
    assert.equal(missing.embedding.label, '不可用');
    assert.equal(missing.rerank.name, 'bge-reranker-v2-m3');
    assert.equal(missing.rerank.label, '不可用');
    assert.equal(missing.rerank.switchDisabled, true);
    const ready = localModelsFromPayload({
        embedding: { model: 'qwen3-embedding:0.6b', dimensions: 1024, healthy: true, state: 'ENABLED' },
        rerank: { model: 'bge-reranker-v2-m3', deploymentEnabled: true, healthy: true, enabled: true, revision: 3 },
    });
    assert.equal(ready.embedding.label, '运行中');
    assert.equal(ready.embedding.tone, 'ok');
    assert.equal(ready.rerank.enabled, true);
    assert.equal(ready.rerank.revision, 3);
    assert.equal(ready.rerank.switchDisabled, false);
    const off = localModelsFromPayload({
        embedding: { model: '', dimensions: 1024, healthy: false },
        rerank: { model: 'bge-reranker-v2-m3', deploymentEnabled: false, healthy: false, enabled: true, revision: 1 },
    });
    assert.equal(off.embedding.name, 'qwen3-embedding:0.6b');
    assert.equal(off.embedding.label, '不可用');
    assert.equal(off.rerank.label, '已在部署中关闭');
    assert.equal(off.rerank.switchDisabled, true);
});
