// UI-SETTINGS 视觉验收：用量文案、模型导航与分组行、抽屉对比度与控件。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { usagePurposeLabel } from '../extension/vc-model-settings/model-logic.js';

const root = new URL('../extension/vc-model-settings/', import.meta.url);

async function text(name) {
    return readFile(new URL(name, root), 'utf8');
}

function stripCssComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

test('用量三行改成用户能懂的名字', () => {
    assert.equal(usagePurposeLabel('LEGACY_CHAT'), '更早的对话');
    assert.equal(usagePurposeLabel('LEGACY_GENERATION'), '更早的生成');
    assert.equal(usagePurposeLabel('EMBEDDING'), '本机记忆');
    assert.equal(usagePurposeLabel('FOREGROUND_CHAT'), '前台聊天');
    assert.equal(usagePurposeLabel('TOOL_TURN'), '工具回合');
});

test('模型首页供应商是分组行，新建在列表末行', async () => {
    const page = await text('page.js');
    const css = stripCssComments(await text('settings-pages.css'));
    assert.match(page, /data-action="new-provider"[^>]*>[\s\S]{0,80}新建供应商/);
    assert.match(page, /未配置单价时仍会发送，费用显示为未知/);
    assert.doesNotMatch(page, /默认当月（UTC）/);
    assert.match(page, /vcms-state-row/);
    assert.match(page, /class="vc-circle vc-glass" data-action="vc-back"/);
    assert.match(page, /id="vcms-save" data-action="save"/);
    assert.match(css, /\.vcms-provider-card\s*\{[^}]*flex-direction:\s*row\s*!important/);
    assert.match(css, /\.vcms-header\s*\{[^}]*border-bottom:\s*0\s*!important/);
    assert.match(css, /#vcms-save\s*\{[^}]*border-radius:\s*var\(--vc-radius-pill\)/);
    assert.match(css, /\.vcms-btn-ghost\s*\{[^}]*background:\s*var\(--vc-fill\)/);
    assert.match(css, /\.vcms-btn-danger-ghost\s*\{[^}]*color:\s*var\(--vc-danger\)/);
    assert.match(css, /\.vcms-body\s*\{[^}]*padding-left:\s*16px/);
    assert.match(css, /\.vcms-usage,\s*[\s\S]{0,240}margin-left:\s*0/);
});

test('设置与账户导航、外观两行、chevron 用 ink-3', async () => {
    const css = stripCssComments(await text('settings-pages.css'));
    const account = stripCssComments(await text('account.css'));
    assert.match(css, /\[data-settings-done\][\s\S]{0,220}border-radius:\s*var\(--vc-radius-pill\)/);
    assert.match(css, /\[data-vc-account-back\][\s\S]{0,220}border-radius:\s*var\(--vc-radius-pill\)/);
    assert.match(css, /\.vc-settings-form > \.vc-segment::before[\s\S]{0,160}attr\(aria-label\)/);
    assert.match(css, /\.vc-shell-settings \.vc-large-title[\s\S]{0,180}var\(--vc-read\)/);
    assert.match(css, /\[data-vc-account-home\][\s\S]{0,240}color:\s*var\(--vc-ink-3\)/);
    assert.match(account, /\[data-vc-account-home\][\s\S]{0,240}color:\s*var\(--vc-ink-3\)/);
});

test('浅色抽屉：对比度、数值胶囊、通栏导航、世界书与扩展行', async () => {
    const css = stripCssComments(await text('drawers.css'));
    assert.match(css, /html\[data-vc-theme="light"\] body\.vc-ui \.vc-drawer-page[\s\S]{0,500}color:\s*var\(--vc-ink-2\)/);
    assert.match(css, /html\[data-vc-theme="light"\] body\.vc-ui \.vc-drawer-page[\s\S]{0,700}opacity:\s*1\s*!important/);
    assert.match(css, /#left-nav-panel\.vc-drawer-page :is\(input\[type="number"\], \.neo-range-input\)[\s\S]{0,280}background:\s*var\(--vc-fill\)/);
    assert.match(css, /#left-nav-panel\.vc-drawer-page :is\(input\[type="number"\], \.neo-range-input\)[\s\S]{0,360}border-radius:\s*var\(--vc-radius-pill\)/);
    assert.match(css, /input\[type="checkbox"\]::after[\s\S]{0,80}content:\s*none\s*!important/);
    assert.match(css, /#left-nav-panel\.vc-drawer-page[\s\S]{0,200}gap:\s*8px\s*!important/);
    assert.match(css, /\[data-vc-drawer-nav\][\s\S]{0,220}margin-left:\s*-16px/);
    assert.match(css, /#user-settings-block\.vc-drawer-page[\s\S]{0,200}margin-top:\s*12px/);
    assert.match(css, /#WorldInfo\.vc-drawer-page \.select2-selection__rendered[\s\S]{0,220}text-overflow:\s*ellipsis/);
    assert.match(css, /#WorldInfo\.vc-drawer-page \.select2-selection[\s\S]{0,240}0\.5px solid var\(--vc-separator\)/);
    assert.match(css, /\.BGSampleTitle[\s\S]{0,220}color:\s*var\(--vc-ink\)/);
    assert.match(css, /\.BGSampleTitle[\s\S]{0,340}background:\s*var\(--vc-glass-strong\)/);
    assert.match(css, /#rm_extensions_block\.vc-drawer-page \.inline-drawer \+ \.inline-drawer[\s\S]{0,180}var\(--vc-separator\)/);
    assert.doesNotMatch(css, /#Backgrounds[\s\S]{0,400}\.bg_example[\s\S]{0,80}background/);
    for (const selector of css.match(/([^{}]+)\{/g) || []) {
        const body = selector.replace(/\s+/g, ' ').trim();
        if (!body || body.startsWith('@')) continue;
        assert.equal(body.includes('body.vc-ui'), true, body);
    }
});

test('1440 设置栈导航同一行，深色背景名称条与数值框可读', async () => {
    const css = stripCssComments(await text('settings-pages.css'));
    const drawers = stripCssComments(await text('drawers.css'));
    const memory = stripCssComments(await text('memory.css'));
    const shell = stripCssComments(await text('shell.css'));
    const chat = stripCssComments(await text('chat-view.css'));
    assert.match(css, /@media \(min-width: 744px\)[\s\S]*\.vcms-header > \*[\s\S]{0,80}grid-row:\s*1/);
    assert.match(css, /\.vcms-provider-card\.is-disabled \.vcms-provider-name[\s\S]{0,160}color:\s*var\(--vc-ink-2\)/);
    assert.match(shell, /\.vc-shell-settings \.vc-large-title[\s\S]{0,160}opacity:\s*calc\(1 - var\(--vc-nav-p/);
    assert.match(shell, /\.vc-convo-avatar-slot[\s\S]{0,280}background:\s*var\(--vc-fill-2\)/);
    assert.match(shell, /\.vc-convo-avatar-slot[\s\S]{0,320}isolation:\s*isolate/);
    const tokens = stripCssComments(await text('vc-ui.css'));
    assert.match(tokens, /html\[data-vc-theme="dark"\] body\.vc-ui[\s\S]{0,500}--vc-avatar-blend:\s*lighten/);
    assert.match(shell, /body\.vc-ui img\.vc-convo-avatar[\s\S]{0,220}mix-blend-mode:\s*var\(--vc-avatar-blend/);
    assert.match(shell, /#chat \.avatar[\s\S]{0,180}background:\s*var\(--vc-fill-2\)/);
    assert.match(chat, /\.vc-poster-avatar-slot[\s\S]{0,220}background:\s*var\(--vc-fill-2\)/);
    assert.match(drawers, /:is\(#PersonaManagement, #right-nav-panel\)\.vc-drawer-page \.avatar[\s\S]{0,420}background:\s*var\(--vc-fill-2\)/);
    assert.match(drawers, /:is\(#PersonaManagement, #right-nav-panel\)\.vc-drawer-page \.avatar[\s\S]{0,220}flex:\s*none/);
    assert.match(drawers, /body\.vc-ui #Backgrounds\.vc-drawer-page \.BGSampleTitle[\s\S]{0,280}background:/);
    assert.doesNotMatch(drawers, /html\[data-vc-theme="light"\] body\.vc-ui #Backgrounds\.vc-drawer-page \.BGSampleTitle/);
    assert.match(drawers, /html\[data-vc-theme="dark"\] body\.vc-ui #Backgrounds\.vc-drawer-page \.thumbnail-clipper[\s\S]{0,160}background-color:\s*var\(--vc-fill\)/);
    assert.match(drawers, /html\[data-vc-theme="dark"\] body\.vc-ui #Backgrounds\.vc-drawer-page \.thumbnail-clipper[\s\S]{0,240}box-shadow:\s*inset 0 0 0 8px var\(--vc-fill\)/);
    assert.match(drawers, /body\.vc-ui :is\(#PersonaManagement, #right-nav-panel\)\.vc-drawer-page \.avatar img[\s\S]{0,120}mix-blend-mode:\s*var\(--vc-avatar-blend/);
    assert.match(drawers, /\.range-block-counter input[\s\S]{0,240}min-width:\s*9ch/);
    assert.match(drawers, /\[data-memory-budget\][\s\S]{0,280}background:\s*var\(--vc-fill\)/);
    assert.match(drawers, /\[data-memory-budget\][\s\S]{0,360}border-radius:\s*var\(--vc-radius-pill\)/);
    assert.match(drawers, /\[data-memory-budget\][\s\S]{0,280}color:\s*var\(--vc-ink\)/);
    assert.match(memory, /\.vc-memory-facts dt[\s\S]{0,180}white-space:\s*nowrap/);
    assert.match(memory, /\.vc-memory-facts dd[\s\S]{0,220}text-align:\s*right/);
});
