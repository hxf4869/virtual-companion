// Virtual Companion · DR2-11 电脑端重建受管验收场景（dr2-layout / dr2-settings / dr2-pages / dr2-mvu-new）与 168 张复核截图
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README.md）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStClient, waitFor } from './managed-lib.mjs';
import { seedDesktopBenchmark, desktopBenchmarkContext } from './desktop-startup-accept.mjs';
import { openDesktopFixture } from './desktop-chat-accept.mjs';
import { bindForeground } from './lib/accept-scene-helpers.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import { complexCard } from './lib/complex-card.mjs';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';

const LAYOUT_VIEWPORTS = [
    { width: 390, height: 844 },
    { width: 744, height: 900 },
    { width: 1024, height: 768 },
    { width: 1179, height: 800 },
    { width: 1180, height: 800 },
    { width: 1440, height: 900 },
    { width: 1599, height: 900 },
    { width: 1600, height: 1000 },
    { width: 1920, height: 1080 },
];

const REVIEW_VIEWPORTS = [
    { width: 390, height: 844 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
];

function expectedChromeForWidth(width) {
    if (width >= 1600) return 'wide';
    if (width >= 1180) return 'regular';
    if (width >= 744) return 'compact';
    return 'narrow';
}

async function settlePage(page) {
    await page.evaluate(async () => {
        await document.fonts.ready;
    });
    await page.waitForFunction(() =>
        document
            .getAnimations()
            .every(
                animation =>
                    animation.playState !== 'running' ||
                    animation.effect?.getComputedTiming().iterations === Infinity,
            ),
    );
    await page.evaluate(
        () =>
            new Promise(resolve =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
    );
}

const SETTINGS_CATEGORY_LABELS = {
    account: '账户',
    model: '模型',
    voice: '语音',
    notifications: '通知',
    appearance: '外观',
    companion: '陪伴风格',
    stickers: '表情包',
    data: '账户与数据',
    'left-nav-panel': 'AI 回复配置',
    AdvancedFormatting: '提示词格式',
    WorldInfo: '世界书',
    rm_extensions_block: '扩展',
    PersonaManagement: '人设',
    Backgrounds: '背景',
    'user-settings-block': '界面',
    rm_api_block: 'API 连接',
    'right-nav-panel': '角色卡',
};

const TAVERN_SETTINGS_CATEGORIES = new Set([
    'left-nav-panel',
    'AdvancedFormatting',
    'WorldInfo',
    'rm_extensions_block',
    'PersonaManagement',
    'Backgrounds',
    'user-settings-block',
    'rm_api_block',
    'right-nav-panel',
]);

async function navigatePrimary(page, nav) {
    try {
    if (nav === 'settings') {
        const shell = page.locator('#vc-shell');
        if ((await shell.getAttribute('data-settings')) !== 'open') {
            await page.locator('#vc-shell .vc-sidebar [data-settings]').click();
            await page.waitForFunction(
                () => document.querySelector('#vc-shell')?.dataset.settings === 'open',
            );
        }
    } else {
        await page.locator(`#vc-shell .vc-sidebar [data-nav="${nav}"]`).click();
        await page.waitForFunction(
            target =>
                document.querySelector('#vc-shell')?.dataset.destination === target &&
                document.querySelector('#vc-shell')?.dataset.settings !== 'open',
            nav,
        );
    }
    await settlePage(page);
    } catch (error) {
        const state = await page.evaluate(() => {
            const shell = document.querySelector('#vc-shell');
            return {
                destination: shell?.dataset.destination ?? null,
                settings: shell?.dataset.settings ?? null,
                chrome: document.documentElement.dataset.chrome ?? null,
                route: location.hash.split('/')[1] ?? '',
                leaveConfirmation: [...document.querySelectorAll('[role="alertdialog"]')]
                    .some(dialog => dialog.textContent.includes('放弃更改')),
            };
        });
        throw new Error(`导航到 ${nav} 未完成：${error.message}; ${JSON.stringify(state)}`);
    }
}

async function openSettingsCategory(page, category) {
    await navigatePrimary(page, 'settings');
    const current = await page.locator('.vc-settings-shell').getAttribute('data-category');
    if (current !== category) {
        const navBtn = page.locator(`.vc-settings-categories [data-category="${category}"]`);
        if (await navBtn.isVisible()) {
            await navBtn.click();
        } else {
            const label = SETTINGS_CATEGORY_LABELS[category];
            assert.ok(label, `未知设置分类: ${category}`);
            const menuBtn = page.locator('[data-settings-categories]');
            await menuBtn.waitFor({ state: 'visible' });
            await menuBtn.click();
            const menu = page.locator('[role="menu"][data-open]');
            await menu.waitFor({ state: 'visible' });
            await menu.getByRole('menuitem', { name: label, exact: true }).click();
            await page.locator('[role="menu"]').waitFor({ state: 'hidden' });
        }
    }
    await page.waitForFunction(
        cat => document.querySelector('.vc-settings-shell')?.dataset.category === cat,
        category,
    );
    if (category === 'notifications') {
        await page
            .locator('[data-vc-notification-section] [data-open-inbox]')
            .waitFor({ state: 'visible' });
    } else if (TAVERN_SETTINGS_CATEGORIES.has(category)) {
        await page.locator('.vc-tavern-form').waitFor({ state: 'visible' });
    } else {
        await page
            .locator(
                '.vc-settings-shell :is(.vc-settings-detail-body, .vc-settings-content) :is(button:not([hidden]), input:not([type="hidden"]), select, [role="radiogroup"], [role="switch"])',
            )
            .first()
            .waitFor({ state: 'visible' });
    }
    await settlePage(page);
}

async function setTheme(page, mode) {
    const label = mode === 'dark' ? '深色' : '浅色';
    await openSettingsCategory(page, 'appearance');
    const radio = page
        .getByRole('radiogroup', { name: '外观', exact: true })
        .getByRole('radio', { name: label, exact: true });
    await radio.waitFor({ state: 'visible' });
    await radio.click();
    await page.waitForFunction(
        expected =>
            document.documentElement.dataset.vcTheme === expected &&
            localStorage.getItem('vc-theme') === expected,
        mode,
    );
    await settlePage(page);
}

async function assertAnchoredPopup(page, popup, trigger, label) {
    const [box, anchor] = await Promise.all([popup.boundingBox(), trigger.boundingBox()]);
    const viewport = page.viewportSize();
    assert.ok(box && anchor && viewport, `${label}及其锚点必须可见`);
    assert.ok(
        box.x >= 0 && box.y >= 0 &&
        box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
        `${label}必须完全在视口内: ${JSON.stringify({ box, viewport })}`,
    );
    const edgeGap = Math.min(
        Math.abs(box.y + box.height - anchor.y),
        Math.abs(box.y - anchor.y - anchor.height),
    );
    assert.ok(
        edgeGap <= 16 && box.x <= anchor.x + anchor.width && box.x + box.width >= anchor.x,
        `${label}必须跟随当前锚点: ${JSON.stringify({ box, anchor })}`,
    );
}

async function assertLayoutInvariants(page, { width, height, destination }) {
    const report = await page.evaluate(dest => {
        const shell = document.querySelector('#vc-shell');
        const sidebar = document.querySelector('#vc-shell .vc-sidebar');
        const main = document.querySelector('#vc-shell [data-shell-main]');
        const scrollingEl = document.scrollingElement || document.documentElement;
        const navButtons = [
            ...document.querySelectorAll(
                '#vc-shell .vc-sidebar [data-nav], #vc-shell .vc-sidebar [data-settings]',
            ),
        ].filter(el => el.getClientRects().length > 0);
        const iconCenterDiffs = navButtons.map(btn => {
            const b = btn.getBoundingClientRect();
            const icon = (
                btn.querySelector('.vc-sidebar__icon, svg') || btn
            ).getBoundingClientRect();
            return {
                nav: btn.getAttribute('data-nav') || 'settings',
                dy: Math.abs((b.top + b.bottom) / 2 - (icon.top + icon.bottom) / 2),
            };
        });
        const activeTarget =
            document.querySelector('#vc-shell .vc-sidebar [aria-current="page"]') ||
            navButtons[0];
        let navReachable = true;
        if (activeTarget) {
            const r = activeTarget.getBoundingClientRect();
            const hit = document.elementFromPoint(
                r.left + r.width / 2,
                r.top + r.height / 2,
            );
            navReachable = Boolean(
                hit && (activeTarget === hit || activeTarget.contains(hit)),
            );
        }
        const header = document.querySelector('#vc-shell [data-chat-header]');
        const textarea = document.querySelector('#send_textarea');
        const charPanel = document.querySelector(
            '#vc-shell [data-char-panel]:not([hidden])',
        );
        let panelOverlap = false;
        let charPanelVisible = false;
        if (charPanel) {
            const p = charPanel.getBoundingClientRect();
            charPanelVisible = p.width > 0 && p.height > 0;
            if (charPanelVisible && header && !header.hidden) {
                const h = header.getBoundingClientRect();
                const t = textarea?.getBoundingClientRect();
                const intersectsHeader =
                    p.left < h.right - 1 &&
                    p.right > h.left + 1 &&
                    p.top < h.bottom - 2 &&
                    p.bottom > h.top + 2;
                const intersectsTextarea =
                    t && t.width > 0 && t.height > 0
                        ? p.left < t.right - 1 &&
                          p.right > t.left + 1 &&
                          p.top < t.bottom - 2 &&
                          p.bottom > t.top + 2
                        : false;
                panelOverlap = intersectsHeader || intersectsTextarea;
            }
        }
        // Check that visible convo rows / cards do not breach their container's right boundary
        const convoList = document.querySelector('#vc-shell [data-convo-list]:not([hidden])');
        let containerBreach = false;
        if (convoList) {
            const cRect = convoList.getBoundingClientRect();
            for (const el of convoList.querySelectorAll('.vc-convo-name, .vc-convo-preview')) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.right > cRect.right + 2) {
                    containerBreach = true;
                }
            }
        }
        // Check primary interactive control reachability & non-clipping on the active page
        let controlSelector = '#send_textarea';
        if (dest.startsWith('characters')) {
            controlSelector = '.vc-characters-route button, .vc-character-card[data-ref]';
        } else if (dest.startsWith('memory')) {
            controlSelector = '.vc-memory-route [role="tab"], .vc-memory-route [role="switch"]';
        } else if (dest.startsWith('inbox')) {
            controlSelector = '.vc-inbox-route [role="switch"], .vc-inbox-route button';
        } else if (dest.startsWith('story')) {
            controlSelector =
                '.vc-story-tab [data-action="start"], .vc-story-tab [data-action="enter"], .vc-story-tab [data-action="wizard"], .vc-story-tab button';
        } else if (dest.startsWith('settings')) {
            controlSelector =
                '.vc-settings-shell :is(.vc-settings-detail-body, .vc-settings-content) :is(button:not([hidden]), input:not([type="hidden"]), select)';
        }
        let primaryControlReachable = true;
        let primaryControlClipped = false;
        if (!dest.includes('panel-open')) {
            const candidates = [...document.querySelectorAll(controlSelector)].filter(
                el => el.getClientRects().length > 0,
            );
            const control = candidates[0];
            if (!control) {
                primaryControlReachable = false;
            } else {
                control.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                const r = control.getBoundingClientRect();
                const mRect = main?.getBoundingClientRect();
                if (
                    r.width <= 0 ||
                    r.height <= 0 ||
                    r.left < -1 ||
                    r.right > window.innerWidth + 1 ||
                    (mRect && mRect.width > 0 && (r.left < mRect.left - 2 || r.right > mRect.right + 2))
                ) {
                    primaryControlClipped = true;
                }
                const cx = Math.min(window.innerWidth - 2, Math.max(2, r.left + r.width / 2));
                const cy = Math.min(window.innerHeight - 2, Math.max(2, r.top + r.height / 2));
                const hit = document.elementFromPoint(cx, cy);
                primaryControlReachable = Boolean(
                    hit && (control === hit || control.contains(hit) || hit.contains(control)),
                );
            }
        }
        return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            scrollWidth: scrollingEl.scrollWidth,
            chrome: shell?.dataset.chrome,
            htmlChrome: document.documentElement.dataset.chrome,
            sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
            mainWidth: main?.getBoundingClientRect().width ?? 0,
            iconCenterDiffs,
            navReachable,
            charPanelVisible,
            panelOverlap,
            containerBreach,
            primaryControlReachable,
            primaryControlClipped,
        };
    }, destination);

    assert.ok(
        report.scrollWidth <= report.innerWidth,
        `[${destination}@${width}x${height}] 横向溢出: scrollWidth=${report.scrollWidth}, innerWidth=${report.innerWidth}`,
    );
    const expectedChrome = expectedChromeForWidth(width);
    assert.equal(
        report.chrome,
        expectedChrome,
        `[${destination}@${width}x${height}] #vc-shell[data-chrome] 应为 ${expectedChrome}`,
    );
    assert.equal(
        report.htmlChrome,
        expectedChrome,
        `[${destination}@${width}x${height}] html[data-chrome] 应为 ${expectedChrome}`,
    );
    assert.ok(
        report.iconCenterDiffs.every(item => item.dy <= 2),
        `[${destination}@${width}x${height}] 侧栏图标垂直居中偏差过大: ${JSON.stringify(report.iconCenterDiffs)}`,
    );
    assert.equal(
        report.navReachable,
        true,
        `[${destination}@${width}x${height}] 侧栏导航按钮不可达或被遮挡`,
    );
    if (destination.includes('panel-open')) {
        assert.equal(
            report.charPanelVisible,
            true,
            `[${destination}@${width}x${height}] 展开角色面板后 [data-char-panel] 必须可见`,
        );
    }
    assert.equal(
        report.panelOverlap,
        false,
        `[${destination}@${width}x${height}] 角色面板不得遮盖标题栏或 #send_textarea`,
    );
    assert.equal(
        report.containerBreach,
        false,
        `[${destination}@${width}x${height}] 会话列表标题/预览不得越出列表右边界`,
    );
    assert.equal(
        report.primaryControlClipped,
        false,
        `[${destination}@${width}x${height}] 当前页面主操作控件不得被容器横向裁切`,
    );
    assert.equal(
        report.primaryControlReachable,
        true,
        `[${destination}@${width}x${height}] 当前页面主操作控件不可达或被遮挡`,
    );
}

async function assertInViewport(page, locator, label) {
    await locator.waitFor({ state: 'visible' });
    await locator.scrollIntoViewIfNeeded();
    await settlePage(page);
    const box = await locator.boundingBox();
    const vp = page.viewportSize();
    assert.ok(box && vp, `[${label}] 特征节点必须存在 boundingBox`);
    assert.ok(
        box.width > 0 &&
            box.height > 0 &&
            box.x < vp.width &&
            box.x + box.width > 0 &&
            box.y < vp.height &&
            box.y + box.height > 0,
        `[${label}@${vp.width}x${vp.height}] 特征节点必须在视口内可见: ${JSON.stringify({ box, vp })}`,
    );
}

async function captureRebuildReviewScreenshots(
    ctx,
    page,
    fixture,
    {
        longMemorySummary = '',
        longBookName = 'DR2_超长合成世界书',
        longEntryComment = '',
    } = {},
) {
    const outDir = path.resolve(process.cwd(), '.review-queue/DR2');
    fs.mkdirSync(outDir, { recursive: true });
    for (const entry of fs.readdirSync(outDir)) {
        if (entry.endsWith('.png')) {
            fs.rmSync(path.join(outDir, entry), { force: true });
        }
    }

    const st = createStClient({
        baseUrl: ctx.w05.stBase,
        expectedIdentity: ctx.secrets.session,
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}`,
    });
    const relId = fixture.chat[0].chat_metadata.vc_binding.relationshipId;

    // 准备真实 04-chat-card 的复杂角色卡 + MVU 脚本 + HTML 卡片会话（对齐 desktop-card-accept.mjs）
    const cardFixture = await seedDesktopBenchmark(ctx);
    const cardRelId = cardFixture.chat[0].chat_metadata.vc_binding.relationshipId;
    const cardBook = 'DR2 复核合成书店';
    const cardData = complexCard('DR2 复核合成澄夏', cardBook);
    const existingCard = (
        await st.call('POST', '/api/characters/get', { avatar_url: cardFixture.avatar })
    ).json;
    cardData.data.extensions.vc_character_ref =
        existingCard.data.extensions.vc_character_ref;
    cardData.data.extensions.world = cardBook;
    assert.equal(
        (
            await st.call('POST', '/api/characters/merge-attributes', {
                avatar: cardFixture.avatar,
                data: cardData.data,
            })
        ).status,
        200,
    );
    const cardEntries = Object.fromEntries(
        cardData.data.character_book.entries.map((entry, index) => [
            entry.id,
            {
                uid: entry.id,
                key: entry.keys,
                keysecondary: entry.secondary_keys,
                content: entry.content,
                comment: entry.comment,
                constant: entry.constant,
                selective: entry.selective,
                selectiveLogic: 0,
                order: entry.insertion_order,
                position: 0,
                disable: false,
                displayIndex: index,
                useProbability: true,
                probability: 100,
                group: '',
                groupWeight: 100,
                depth: 4,
                role: 0,
                addMemo: true,
            },
        ]),
    );
    assert.equal(
        (
            await st.call('POST', '/api/worldinfo/edit', {
                name: cardBook,
                data: { entries: cardEntries },
            })
        ).status,
        200,
    );
    const cardRecords = (
        await st.call('POST', '/api/chats/get', {
            avatar_url: cardFixture.avatar,
            file_name: cardFixture.file,
        })
    ).json;
    cardRecords.splice(1, cardRecords.length - 1, {
        name: 'DR2 复核合成澄夏',
        is_user: false,
        mes: cardData.data.first_mes,
        send_date: new Date().toISOString(),
        extra: {},
    });
    assert.equal(
        (
            await st.call('POST', '/api/chats/save', {
                avatar_url: cardFixture.avatar,
                file_name: cardFixture.file,
                chat: cardRecords,
            })
        ).status,
        200,
    );

    const stSettings = JSON.parse(
        (await st.call('POST', '/api/settings/get', {})).json.settings,
    );
    stSettings.extension_settings ||= {};
    stSettings.extension_settings.EjsTemplate ||= {};
    Object.assign(stSettings.extension_settings.EjsTemplate, {
        compile_workers: false,
        sandbox: false,
    });
    stSettings.extension_settings.character_allowed_regex = [
        fixture.avatar,
        cardFixture.avatar,
    ];
    stSettings.extension_settings.tavern_helper ||= {};
    stSettings.extension_settings.tavern_helper.script ||= {};
    stSettings.extension_settings.tavern_helper.script.enabled ||= {};
    stSettings.extension_settings.tavern_helper.script.enabled.characters = [
        fixture.avatar,
        cardFixture.avatar,
    ];
    stSettings.extension_settings.vc_reply_planner = false;
    stSettings.oai_settings = {
        ...(stSettings.oai_settings || {}),
        stream_openai: true,
        function_calling: false,
        show_thoughts: true,
    };
    assert.equal(
        (await st.call('POST', '/api/settings/save', stSettings)).status,
        200,
    );
    await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');

    // 168 张主矩阵恢复真实浏览器动态/透明环境（区别于第 169 张 reduced 变体）
    const cdp = await page.context().newCDPSession(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await cdp.send('Emulation.setEmulatedMedia', {
        features: [
            { name: 'prefers-reduced-motion', value: 'no-preference' },
            { name: 'prefers-reduced-transparency', value: 'no-preference' },
        ],
    });
    assert.equal(
        await page.evaluate(
            () => window.matchMedia('(prefers-reduced-motion: no-preference)').matches,
        ),
        true,
        '168 张复核主矩阵必须在 prefers-reduced-motion: no-preference 下采集',
    );

    const selectConversationByRelId = async (targetRelId, { closePanel = true } = {}) => {
        await navigatePrimary(page, 'chat');
        const alreadyActive = await page.evaluate(
            id =>
                document.documentElement.dataset.vcRuntime === 'prepared' &&
                window.SillyTavern?.getContext()?.chatMetadata?.vc_binding
                    ?.relationshipId === id &&
                document.querySelectorAll('#chat > .mes').length > 0,
            targetRelId,
        );
        const vp = page.viewportSize();
        const listOpen =
            (await page.locator('#vc-shell').getAttribute('data-list-open')) === 'true';
        if (!alreadyActive || (vp && vp.width < 1180 && listOpen)) {
            if (!(await page.locator('[data-convo-list]').isVisible())) {
                const listBtn = page.locator('[data-list-toggle]');
                if (await listBtn.isVisible()) {
                    await listBtn.click();
                } else if (
                    (await page.locator('#vc-shell').getAttribute('data-panel-open')) === 'true'
                ) {
                    const panelToggle = page.locator('[data-panel-toggle]');
                    if (await panelToggle.isVisible()) {
                        await panelToggle.click();
                    }
                }
                await page.locator('[data-convo-list]').waitFor({ state: 'visible' });
            }
            const row = page
                .locator(`[data-convo-list] [data-relationship-id="${targetRelId}"]`)
                .first();
            await row.waitFor({ state: 'visible' });
            await row.click();
        }
        await page.waitForFunction(
            id =>
                document.documentElement.dataset.vcRuntime === 'prepared' &&
                window.SillyTavern?.getContext()?.chatMetadata?.vc_binding
                    ?.relationshipId === id &&
                document.querySelectorAll('#chat > .mes').length > 0,
            targetRelId,
        );
        if (
            closePanel &&
            (await page.locator('#vc-shell').getAttribute('data-panel-open')) === 'true'
        ) {
            const toggle = page.locator('[data-panel-toggle]');
            if (await toggle.isVisible()) {
                await toggle.click();
                await page.waitForFunction(
                    () => document.querySelector('#vc-shell')?.dataset.panelOpen === 'false',
                );
            }
        }
        await settlePage(page);
    };

    const ensureRelIdContext = async () => {
        const isCurrent = await page.evaluate(
            id =>
                document.documentElement.dataset.vcRuntime === 'prepared' &&
                window.SillyTavern?.getContext()?.chatMetadata?.vc_binding
                    ?.relationshipId === id,
            relId,
        );
        if (!isCurrent) {
            await selectConversationByRelId(relId, { closePanel: true });
        }
    };

    let streamSeq = 0;
    let conflictSeq = 0;
    let expectedMinRevision = 0;
    let lastCasDraft = '';
    let lastWinnerMarker = '';

    const states = [
        {
            id: '01-chat-empty',
            beforeTheme: async () => {
                await page.goto(ctx.w05.stBase + '/desktop/', {
                    waitUntil: 'domcontentloaded',
                });
                await page.waitForFunction(
                    () => document.documentElement.dataset.vcApp === 'ready',
                );
            },
            setup: async vp => {
                await navigatePrimary(page, 'chat');
                const emptyState = await page.evaluate(() => ({
                    key:
                        document
                            .querySelector('.vc-desktop-chat-root')
                            ?.getAttribute('data-conversation-key') ?? '',
                    mesCount: document.querySelectorAll('#chat > .mes').length,
                    emptyCount: document.querySelectorAll('.vc-chat-empty-state').length,
                    layout: document.querySelector('#vc-shell')?.getAttribute('data-layout'),
                }));
                assert.equal(emptyState.key, '', '01-chat-empty 必须无打开会话');
                assert.equal(emptyState.mesCount, 0, '01-chat-empty 不得渲染已有消息');
                assert.equal(emptyState.emptyCount, 1, '01-chat-empty 必须存在 .vc-chat-empty-state');
                if (vp.width < 744) {
                    assert.equal(
                        emptyState.layout,
                        'list-only',
                        '01-chat-empty 在 390 窄屏下应为 list-only 态',
                    );
                    await assertInViewport(
                        page,
                        page.locator('[data-convo-list]'),
                        '01-chat-empty',
                    );
                } else {
                    await assertInViewport(
                        page,
                        page.locator('.vc-chat-empty-state'),
                        '01-chat-empty',
                    );
                }
            },
        },
        {
            id: '02-chat-active',
            setup: async vp => {
                await selectConversationByRelId(relId, { closePanel: vp.width < 1600 });
                await assertInViewport(
                    page,
                    page.locator('#chat > .mes').last(),
                    '02-chat-active-mes',
                );
                await assertInViewport(
                    page,
                    page.locator('#send_textarea'),
                    '02-chat-active-composer',
                );
            },
        },
        {
            id: '03-chat-streaming',
            setup: async vp => {
                await selectConversationByRelId(relId, { closePanel: vp.width < 1600 });
                streamSeq += 1;
                const streamPrefix = `DR2_REAL_STREAM_${streamSeq}_`;
                const streamText = `${streamPrefix}${'正在流式生成合成回复内容片段。'.repeat(24)}`;
                await ctx.fixtureHttp.setOverride('vc03m-chat', {
                    text: streamText,
                    tool: null,
                    reasoning: null,
                    chunks: 40,
                    delay: { firstMs: 80, perChunkMs: 250 },
                });
                await page.locator('#send_textarea').fill(`DR2 流式验收提问 ${streamSeq}`);
                await page.locator('#send_but').click();
                await page.locator('#mes_stop').waitFor({ state: 'visible' });
                await page.waitForFunction(
                    prefix => {
                        const streaming = document.querySelector(
                            '#chat > .mes.vc-streaming[is_user="false"]:last-child .mes_text',
                        );
                        return (
                            document.body.dataset.generating === 'true' &&
                            Boolean(streaming && (streaming.textContent || '').includes(prefix))
                        );
                    },
                    streamPrefix,
                );
                const cap = (await ctx.fixtureHttp.captures({ protocol: 'chat' })).at(-1);
                assert.equal(cap?.stream, true, '03-chat-streaming 必须捕获真实 SSE 流式请求');
                assert.equal(cap?.auth?.matched, true, '03-chat-streaming 必须通过受管认证');
                await page
                    .locator('#chat > .mes.vc-streaming[is_user="false"]:last-child')
                    .scrollIntoViewIfNeeded();
            },
            verifyBeforeShot: async () => {
                assert.equal(
                    await page.locator('#mes_stop').isVisible(),
                    true,
                    '03-chat-streaming 截图瞬间 #mes_stop 必须可见',
                );
                await assertInViewport(
                    page,
                    page.locator('#chat > .mes.vc-streaming[is_user="false"]:last-child'),
                    '03-chat-streaming',
                );
            },
            cleanup: async () => {
                try {
                    if (await page.locator('#mes_stop').isVisible()) {
                        await page.locator('#mes_stop').click();
                    }
                    await page.waitForFunction(
                        () =>
                            document.body.dataset.generating !== 'true' &&
                            !document.querySelector('#mes_stop'),
                    );
                    await waitFor(
                        async () => {
                            const last = (
                                await ctx.fixtureHttp.captures({ protocol: 'chat' })
                            ).at(-1);
                            return last?.aborted === true ? last : false;
                        },
                        { timeoutMs: 8000, intervalMs: 80, label: '03-chat-streaming SSE 中止落地' },
                    );
                } finally {
                    await ctx.fixtureHttp.setOverride('vc03m-chat', null);
                }
            },
        },
        {
            id: '04-chat-card',
            setup: async vp => {
                await selectConversationByRelId(cardRelId, { closePanel: vp.width < 1600 });
                await page.waitForFunction(
                    () =>
                        globalThis.Mvu?.getMvuData?.({
                            type: 'message',
                            message_id: 0,
                        })?.stat_data?.trust?.[0] === 10,
                );
                const cardIframe = page.locator(
                    'iframe#TH-message--0--0[data-vc-card-kind="html"]',
                );
                await cardIframe.waitFor({ state: 'visible' });
                const handle = await cardIframe.elementHandle();
                const frame = await handle?.contentFrame();
                assert.ok(frame, '04-chat-card HTML 卡片 iframe contentFrame 必须可读');
                await frame.locator('#read-state').click();
                await waitFor(
                    async () =>
                        (await frame.locator('#trust').textContent()) === '10' ? true : false,
                    { timeoutMs: 5000, intervalMs: 50, label: '04-chat-card #trust 渲染为 10' },
                );
                await assertInViewport(page, cardIframe, '04-chat-card');
            },
        },
        {
            id: '05-characters-grid',
            setup: async () => {
                await navigatePrimary(page, 'characters');
                const detail = page.locator('.vc-character-detail');
                if (await detail.isVisible()) {
                    await detail.getByRole('button', { name: '关闭', exact: true }).click();
                    await detail.waitFor({ state: 'hidden' });
                }
                await assertInViewport(
                    page,
                    page.locator('.vc-characters-route .vc-character-card[data-ref]').first(),
                    '05-characters-grid',
                );
            },
        },
        {
            id: '06-characters-detail',
            setup: async () => {
                await navigatePrimary(page, 'characters');
                const card = page
                    .locator('.vc-characters-route .vc-character-card[data-ref]')
                    .first();
                await card.waitFor({ state: 'visible' });
                await card.click();
                await assertInViewport(
                    page,
                    page.locator('.vc-character-detail'),
                    '06-characters-detail',
                );
            },
            cleanup: async () => {
                const detail = page.locator('.vc-character-detail');
                if (await detail.isVisible()) {
                    await detail.getByRole('button', { name: '关闭', exact: true }).click();
                    await detail.waitFor({ state: 'hidden' });
                }
            },
        },
        {
            id: '07-characters-wizard',
            setup: async () => {
                await navigatePrimary(page, 'characters');
                await page
                    .getByRole('button', { name: '新建角色', exact: true })
                    .first()
                    .click();
                const dialog = page.locator('[role="dialog"][data-open]');
                await dialog.waitFor({ state: 'visible' });
                await assertInViewport(
                    page,
                    page.locator('#vc-wizard-name'),
                    '07-characters-wizard',
                );
            },
            cleanup: async () => {
                const dialog = page.locator('[role="dialog"][data-open]');
                if (await dialog.isVisible()) {
                    await dialog.getByRole('button', { name: '取消', exact: true }).click();
                    await page.locator('[role="dialog"]').waitFor({ state: 'hidden' });
                }
            },
        },
        {
            id: '08-memory-timeline',
            setup: async () => {
                await ensureRelIdContext();
                await navigatePrimary(page, 'memory');
                await page.getByRole('tab', { name: '时间线', exact: true }).click();
                const card = longMemorySummary
                    ? page
                          .locator('.vc-memory-card')
                          .filter({ hasText: longMemorySummary.slice(0, 30) })
                          .first()
                    : page.locator('.vc-memory-card').first();
                await assertInViewport(page, card, '08-memory-timeline');
            },
        },
        {
            id: '09-memory-detail',
            setup: async () => {
                await ensureRelIdContext();
                await navigatePrimary(page, 'memory');
                await page.getByRole('tab', { name: '时间线', exact: true }).click();
                const card = longMemorySummary
                    ? page
                          .locator('.vc-memory-card')
                          .filter({ hasText: longMemorySummary.slice(0, 30) })
                          .first()
                    : page.locator('.vc-memory-card').first();
                await card.waitFor({ state: 'visible' });
                await card.click();
                await assertInViewport(
                    page,
                    page.locator('.vc-memory-detail-pane .vc-memory-detail-pane__summary'),
                    '09-memory-detail',
                );
            },
        },
        {
            id: '10-memory-diary',
            setup: async () => {
                await ensureRelIdContext();
                await navigatePrimary(page, 'memory');
                await page.getByRole('tab', { name: '日记', exact: true }).click();
                const diary = page.locator('.vc-memory-diary[aria-label="角色日记"]');
                await diary.waitFor({ state: 'visible' });
                await page.getByText('还没有日记', { exact: true }).waitFor({ state: 'visible' });
                await assertInViewport(page, diary, '10-memory-diary');
            },
            cleanup: async () => {
                const timelineTab = page.getByRole('tab', { name: '时间线', exact: true });
                if (await timelineTab.isVisible()) {
                    await timelineTab.click();
                }
            },
        },
        {
            id: '11-inbox',
            setup: async () => {
                await navigatePrimary(page, 'inbox');
                await page
                    .locator('.vc-inbox-route[data-vc-page="inbox"]')
                    .waitFor({ state: 'visible' });
                await page.getByLabel('每日上限').waitFor({ state: 'visible' });
                await page
                    .getByText('没有符合条件的陪伴消息', { exact: true })
                    .waitFor({ state: 'visible' });
                await assertInViewport(
                    page,
                    page.getByRole('button', { name: '保存策略', exact: true }),
                    '11-inbox',
                );
            },
        },
        {
            id: '12-story-list',
            setup: async () => {
                await navigatePrimary(page, 'story');
                await assertInViewport(
                    page,
                    page.locator('.vc-story-tab[data-view="gate"]'),
                    '12-story-list',
                );
            },
        },
        {
            id: '13-story-stage',
            setup: async () => {
                await navigatePrimary(page, 'story');
                const stagePlaying = page.locator(
                    '.vc-story-tab[data-view="stage"] .vc-story[data-state="playing"]',
                );
                if (!(await stagePlaying.isVisible())) {
                    await page
                        .locator(
                            '.vc-story-tab[data-view="gate"] :is([data-action="enter"], [data-wizard-step="1"])',
                        )
                        .first()
                        .waitFor({ state: 'visible' });
                    const enterBtn = page
                        .locator('.vc-story-tab[data-view="gate"] [data-action="enter"]')
                        .first();
                    if (await enterBtn.isVisible()) {
                        await enterBtn.click();
                    } else {
                        await reauthForWrite(ctx);
                        for (let step = 1; step < 5; step++) {
                            await page
                                .locator(`[data-wizard-step="${step}"]`)
                                .waitFor({ state: 'visible' });
                            await page.locator('[data-action="wizard-next"]').click();
                        }
                        await page
                            .locator('[data-wizard-step="5"]')
                            .waitFor({ state: 'visible' });
                        await page.locator('[data-action="wizard-start"]').click();
                    }
                }
                await assertInViewport(page, stagePlaying, '13-story-stage');
            },
            cleanup: async () => {
                const closeBtn = page
                    .locator('.vc-story-tab[data-view="stage"] [data-action="close"]')
                    .first();
                if (await closeBtn.isVisible()) {
                    await closeBtn.click();
                    await page
                        .locator('.vc-story-tab[data-view="gate"]')
                        .waitFor({ state: 'visible' });
                }
            },
        },
        {
            id: '14-settings-model',
            setup: async () => {
                await openSettingsCategory(page, 'model');
                await page.locator('[data-action="select-provider"][data-id="vc03m-chat"]').click();
                await assertInViewport(
                    page,
                    page.locator('#vcms-f-display'),
                    '14-settings-model',
                );
            },
        },
        {
            id: '15-settings-voice',
            setup: async () => {
                await openSettingsCategory(page, 'voice');
                await assertInViewport(
                    page,
                    page.locator('[data-voice-field="dailyChatLimit"]'),
                    '15-settings-voice',
                );
            },
        },
        {
            id: '16-settings-appearance',
            setup: async () => {
                await openSettingsCategory(page, 'appearance');
                await assertInViewport(
                    page,
                    page.getByRole('radiogroup', { name: '外观', exact: true }),
                    '16-settings-appearance',
                );
            },
        },
        {
            id: '17-tavern-reply',
            setup: async () => {
                await openSettingsCategory(page, 'left-nav-panel');
                await assertInViewport(
                    page,
                    page.getByRole('spinbutton', { name: '频率惩罚', exact: true }),
                    '17-tavern-reply',
                );
            },
        },
        {
            id: '18-tavern-world',
            setup: async () => {
                await openSettingsCategory(page, 'WorldInfo');
                const worldSelect = page.locator('select[data-tavern-resource="world"]');
                await worldSelect.waitFor({ state: 'visible' });
                await worldSelect.selectOption(longBookName);
                const item = longEntryComment
                    ? page
                          .locator('.vc-tavern-list button[data-tavern-action="select-item"]')
                          .filter({ hasText: longEntryComment.slice(0, 30) })
                          .first()
                    : page
                          .locator('.vc-tavern-list button[data-tavern-action="select-item"]')
                          .first();
                await assertInViewport(page, item, '18-tavern-world');
            },
        },
        {
            id: '19-overlay-menu',
            setup: async vp => {
                await selectConversationByRelId(relId, { closePanel: vp.width < 1600 });
                const lastMes = page.locator('#chat > .mes').last();
                await lastMes.scrollIntoViewIfNeeded();
                await lastMes.hover();
                const trigger = lastMes.locator('[data-vc-act="more"]');
                await trigger.waitFor({ state: 'visible' });
                await trigger.click();
                const menu = page.locator('.vc-menu.vc-compose-menu[data-open], [role="menu"][data-open]').first();
                await assertInViewport(page, menu, '19-overlay-menu');
            },
            cleanup: async () => {
                await page.keyboard.press('Escape');
                await page
                    .locator('.vc-menu.vc-compose-menu, [role="menu"]')
                    .waitFor({ state: 'hidden' });
            },
        },
        {
            id: '20-overlay-confirm',
            setup: async () => {
                await openSettingsCategory(page, 'left-nav-panel');
                const freq = page.getByRole('spinbutton', { name: '频率惩罚', exact: true });
                await freq.waitFor({ state: 'visible' });
                const currentVal = Number(await freq.inputValue());
                await freq.fill(currentVal === 1.16 ? '1.15' : '1.16');
                await page.locator('#vc-shell .vc-sidebar [data-nav="memory"]').click();
                const alertDialog = page.locator('[role="alertdialog"][data-open]');
                await alertDialog.waitFor({ state: 'visible' });
                await assertInViewport(
                    page,
                    alertDialog.getByRole('button', { name: '放弃', exact: true }),
                    '20-overlay-confirm',
                );
            },
            cleanup: async () => {
                const alertDialog = page.locator('[role="alertdialog"][data-open]');
                if (await alertDialog.isVisible()) {
                    await alertDialog.getByRole('button', { name: '放弃', exact: true }).click();
                    await page.locator('[role="alertdialog"]').waitFor({ state: 'hidden' });
                    await page.waitForFunction(
                        () => document.querySelector('#vc-shell')?.dataset.destination === 'memory',
                    );
                }
            },
        },
        {
            id: '21-overlay-conflict',
            setup: async vp => {
                await selectConversationByRelId(relId, { closePanel: vp.width < 1600 });
                conflictSeq += 1;
                lastCasDraft = `DR2_CAS_DRAFT_${conflictSeq}`;
                lastWinnerMarker = `DR2_CAS_WINNER_${conflictSeq}`;
                await page.locator('#send_textarea').fill(lastCasDraft);

                const latestRecords = (
                    await st.call('POST', '/api/chats/get', {
                        avatar_url: fixture.avatar,
                        file_name: fixture.file,
                    })
                ).json;
                latestRecords.push({
                    name: 'DR2 并发端',
                    is_user: true,
                    mes: lastWinnerMarker,
                    send_date: new Date().toISOString(),
                });
                const concurrentSave = await st.call('POST', '/api/chats/save', {
                    avatar_url: fixture.avatar,
                    file_name: fixture.file,
                    chat: latestRecords,
                });
                assert.equal(concurrentSave.status, 200);
                expectedMinRevision = concurrentSave.json.vc_f2.revision;

                const conflictSavePromise = page.waitForResponse(
                    resp =>
                        resp.request().method() === 'POST' &&
                        new URL(resp.url()).pathname.endsWith('/api/chats/save'),
                );
                await page.locator('#send_but').click();
                const conflictResp = await conflictSavePromise;
                assert.equal(conflictResp.status(), 409, '21-overlay-conflict 必须触发真实 409');
                const conflictBody = await conflictResp.json();
                assert.equal(conflictBody.code, 'VC_REVISION_CONFLICT');

                const conflictDialog = page.locator('dialog#vc-f2-conflict[open]');
                await conflictDialog.waitFor({ state: 'visible' });
                await conflictDialog
                    .getByText('对话已更新', { exact: true })
                    .waitFor({ state: 'visible' });
                await assertInViewport(
                    page,
                    conflictDialog.locator('[data-action="view-latest"]'),
                    '21-overlay-conflict',
                );
            },
            cleanup: async () => {
                const reloadLatestResp = page.waitForResponse(resp => {
                    if (
                        resp.request().method() !== 'POST' ||
                        !new URL(resp.url()).pathname.endsWith('/api/chats/get')
                    ) {
                        return false;
                    }
                    try {
                        const body = JSON.parse(resp.request().postData() || '{}');
                        return (
                            body.avatar_url === fixture.avatar &&
                            body.file_name === fixture.file
                        );
                    } catch {
                        return false;
                    }
                });
                await page.locator('#vc-f2-conflict [data-action="view-latest"]').click();
                assert.equal((await reloadLatestResp).status(), 200);
                await page.locator('#vc-f2-conflict').waitFor({ state: 'hidden' });
                await page.waitForFunction(
                    ({ minRev, marker, draft }) => {
                        const ctxRef = window.SillyTavern?.getContext?.();
                        const rev = ctxRef?.chatMetadata?.vc_f2?.revision ?? 0;
                        const hasWinner =
                            Array.isArray(ctxRef?.chat) &&
                            ctxRef.chat.some(m => String(m?.mes || '').includes(marker));
                        const sendBtn = document.querySelector('#send_but');
                        const textarea = document.querySelector('#send_textarea');
                        return (
                            rev >= minRev &&
                            hasWinner &&
                            sendBtn &&
                            !sendBtn.disabled &&
                            textarea?.value === draft
                        );
                    },
                    {
                        minRev: expectedMinRevision,
                        marker: lastWinnerMarker,
                        draft: lastCasDraft,
                    },
                );
                await page.locator('#send_textarea').fill('');
            },
        },
    ];

    try {
        for (const stState of states) {
            for (const vp of REVIEW_VIEWPORTS) {
                await page.setViewportSize(vp);
                for (const theme of ['light', 'dark']) {
                    if (stState.beforeTheme) {
                        await stState.beforeTheme(vp, theme);
                    }
                    await setTheme(page, theme);
                    await stState.setup(vp, theme);
                    await settlePage(page);
                    if (stState.verifyBeforeShot) {
                        await stState.verifyBeforeShot(vp, theme);
                    }
                    const themeCheck = await page.evaluate(() => ({
                        domTheme: document.documentElement.dataset.vcTheme,
                        storedTheme: localStorage.getItem('vc-theme'),
                    }));
                    assert.equal(
                        themeCheck.domTheme,
                        theme,
                        `[${stState.id}@${vp.width}x${vp.height}-${theme}] html[data-vc-theme] 必须为 ${theme}`,
                    );
                    assert.equal(
                        themeCheck.storedTheme,
                        theme,
                        `[${stState.id}@${vp.width}x${vp.height}-${theme}] localStorage vc-theme 必须为 ${theme}`,
                    );
                    const file = path.join(
                        outDir,
                        `${stState.id}-${vp.width}x${vp.height}-${theme}.png`,
                    );
                    await page.screenshot({ path: file });
                    ctx.screenshots?.push(file);
                    if (stState.cleanup) {
                        await stState.cleanup(vp, theme);
                        await settlePage(page);
                    }
                }
            }
        }

        // 第 169 张：1440×900 dark + prefers-reduced-motion: reduce + prefers-reduced-transparency: reduce
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await cdp.send('Emulation.setEmulatedMedia', {
            features: [
                { name: 'prefers-reduced-motion', value: 'reduce' },
                { name: 'prefers-reduced-transparency', value: 'reduce' },
            ],
        });
        const mediaCheck = await page.evaluate(() => ({
            reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            reducedTransparency: window.matchMedia('(prefers-reduced-transparency: reduce)')
                .matches,
        }));
        assert.equal(mediaCheck.reducedMotion, true, '第 169 张必须激活 prefers-reduced-motion: reduce');
        assert.equal(
            mediaCheck.reducedTransparency,
            true,
            '第 169 张必须激活 prefers-reduced-transparency: reduce',
        );
        await setTheme(page, 'dark');
        await selectConversationByRelId(relId, { closePanel: true });
        await assertInViewport(
            page,
            page.locator('#chat > .mes').last(),
            '22-chat-reduced-mes',
        );
        await assertInViewport(
            page,
            page.locator('#send_textarea'),
            '22-chat-reduced-composer',
        );
        const reducedThemeCheck = await page.evaluate(() => ({
            domTheme: document.documentElement.dataset.vcTheme,
            storedTheme: localStorage.getItem('vc-theme'),
        }));
        assert.equal(reducedThemeCheck.domTheme, 'dark');
        assert.equal(reducedThemeCheck.storedTheme, 'dark');
        const reducedFile = path.join(
            outDir,
            '22-chat-1440x900-dark-reduced-motion-transparency.png',
        );
        await page.screenshot({ path: reducedFile });
        ctx.screenshots?.push(reducedFile);

        await setTheme(page, 'light');
    } finally {
        await ctx.fixtureHttp.setOverride('vc03m-chat', null);
        await cdp.detach();
    }
}

// ---------------------------------------------------------------------------
// 1. dr2-layout：9 宽度、断点往返、6 个一级页面、普通与超长合成数据、浮层与焦点可见检查
// ---------------------------------------------------------------------------
export async function sceneDr2Layout(ctx) {
    const fixture = await seedDesktopBenchmark(ctx);
    const other = await seedDesktopBenchmark(ctx);
    const st = createStClient({
        baseUrl: ctx.w05.stBase,
        expectedIdentity: ctx.secrets.session,
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}`,
    });
    // 准备一条 80 字超长条目名的世界书供超长合成数据检验
    const longBookName = 'DR2_超长合成世界书';
    const longEntryComment = '超长世界书条目名称用于验证列表与表单不撑破容器边界_'.repeat(4).slice(0, 80);
    assert.equal(longEntryComment.length, 80);
    assert.equal(
        (
            await st.call('POST', '/api/worldinfo/edit', {
                name: longBookName,
                data: {
                    entries: {
                        0: {
                            uid: 0,
                            key: ['合成词条'],
                            keysecondary: [],
                            content: '合成世界书内容',
                            comment: longEntryComment,
                            constant: true,
                            selective: false,
                            selectiveLogic: 0,
                            order: 100,
                            position: 0,
                            disable: false,
                            displayIndex: 0,
                            useProbability: true,
                            probability: 100,
                            group: '',
                            groupWeight: 100,
                            depth: 4,
                            role: 0,
                            addMemo: true,
                        },
                    },
                },
            })
        ).status,
        200,
    );

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH
            ? { executablePath: process.env.VC_W03_CHROMIUM_PATH }
            : {}),
    });
    const context = await desktopBenchmarkContext(browser, ctx);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(`${err.name}: ${err.message}`));
    page.on('console', message => {
        if (message.type() === 'error' && /(?:TypeError|ReferenceError|RangeError|Minified React error)/.test(message.text())) {
            errors.push(message.text().slice(0, 500));
        }
    });

    try {
        await openDesktopFixture(page, ctx.w05.stBase, fixture);
        const relId = fixture.chat[0].chat_metadata.vc_binding.relationshipId;
        await page.locator(`[data-convo-list] [data-relationship-id="${relId}"]`).first().click();
        await page.waitForFunction(
            () =>
                document.documentElement.dataset.vcRuntime === 'prepared' &&
                document.querySelectorAll('#chat > .mes').length > 0,
        );

        const destinations = [
            'chat',
            'characters',
            'memory',
            'inbox',
            'story',
            'settings',
        ];

        // 第一轮：普通合成数据 × 6 个一级页面 × 9 个视口
        for (const dest of destinations) {
            await page.setViewportSize({ width: 1440, height: 900 });
            await navigatePrimary(page, dest);
            for (const vp of LAYOUT_VIEWPORTS) {
                await page.setViewportSize(vp);
                await settlePage(page);
                await assertLayoutInvariants(page, {
                    width: vp.width,
                    height: vp.height,
                    destination: dest,
                });
                if (dest === 'chat') {
                    const panelToggle = page.locator('[data-panel-toggle]');
                    if (
                        (await page.locator('#vc-shell').getAttribute('data-panel-open')) !==
                        'true'
                    ) {
                        await panelToggle.click();
                        await page.waitForFunction(
                            () => document.querySelector('#vc-shell')?.dataset.panelOpen === 'true',
                        );
                        await settlePage(page);
                    }
                    await assertLayoutInvariants(page, {
                        width: vp.width,
                        height: vp.height,
                        destination: 'chat-panel-open',
                    });
                    if (vp.width < 1600) {
                        await panelToggle.click();
                        await page.waitForFunction(
                            () => document.querySelector('#vc-shell')?.dataset.panelOpen === 'false',
                        );
                        await settlePage(page);
                    }
                }
            }
        }

        // 检查聊天页消息菜单 Menu 与表情面板 Popover 在视口内、随窗口缩放保持在视口内，并用 Escape 真实关闭
        await page.setViewportSize({ width: 1440, height: 900 });
        await navigatePrimary(page, 'chat');

        const menuMessage = page.locator('#chat > .mes').first();
        const menuTrigger = menuMessage.locator('[data-vc-act="more"]');
        await menuMessage.scrollIntoViewIfNeeded();
        await menuMessage.hover();
        await menuTrigger.click();
        const menuPopup = page.locator('[role="menu"]').first();
        await menuPopup.waitFor({ state: 'visible' });
        for (const vp of LAYOUT_VIEWPORTS) {
            await page.setViewportSize(vp);
            await settlePage(page);
            if (!(await menuPopup.isVisible())) {
                await menuMessage.scrollIntoViewIfNeeded();
                await menuMessage.hover();
                await menuTrigger.click();
                await menuPopup.waitFor({ state: 'visible' });
            }
            await assertAnchoredPopup(page, menuPopup, menuTrigger, '消息菜单');
        }
        await page.keyboard.press('Escape');
        await menuPopup.waitFor({ state: 'hidden' });

        // 打开表情 Popover (#vc-emoji-btn -> #vc-emoji-panel) 检查视口边界与 Escape 关闭
        await page.setViewportSize({ width: 1440, height: 900 });
        await settlePage(page);
        const emojiTrigger = page.locator('#vc-emoji-btn');
        await emojiTrigger.click();
        const emojiPopup = page.locator('#vc-emoji-panel');
        await emojiPopup.waitFor({ state: 'visible' });
        for (const vp of LAYOUT_VIEWPORTS) {
            await page.setViewportSize(vp);
            await settlePage(page);
            if (!(await emojiPopup.isVisible())) {
                await emojiTrigger.click();
                await emojiPopup.waitFor({ state: 'visible' });
            }
            await assertAnchoredPopup(page, emojiPopup, emojiTrigger, '表情 Popover');
        }
        await page.keyboard.press('Escape');
        await emojiPopup.waitFor({ state: 'hidden' });

        // 检查键盘 Tab 后 :focus-visible 元素具有真实可见 outline
        await page.keyboard.press('Tab');
        const focusInfo = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const style = getComputedStyle(el);
            return {
                matchesFocusVisible: el.matches(':focus-visible'),
                outlineStyle: style.outlineStyle,
                outlineWidth: parseFloat(style.outlineWidth || '0'),
                outlineColor: style.outlineColor,
            };
        });
        assert.ok(focusInfo, 'Tab 后应当有焦点元素');
        assert.equal(focusInfo.matchesFocusVisible, true, 'Tab 后焦点元素应匹配 :focus-visible');
        assert.notEqual(
            focusInfo.outlineStyle,
            'none',
            ':focus-visible 焦点元素必须具有可见 outline（outline-style !== "none"）',
        );
        assert.ok(
            focusInfo.outlineWidth > 0 &&
                focusInfo.outlineColor !== 'transparent' &&
                focusInfo.outlineColor !== 'rgba(0, 0, 0, 0)',
            `:focus-visible 焦点元素 outline 宽度与颜色必须可见: ${JSON.stringify(focusInfo)}`,
        );

        // 拖动 / 断点往返测试：1179 -> 1180 -> 1179，data-chrome 变化次数恰为 2，聊天草稿与 #chat.scrollTop 不变
        await page.setViewportSize({ width: 1179, height: 800 });
        await settlePage(page);
        if ((await page.locator('#vc-shell').getAttribute('data-list-open')) === 'true') {
            const row = page.locator(`[data-convo-list] [data-relationship-id="${relId}"]`).first();
            if (await row.isVisible().catch(() => false)) {
                await row.click();
                await settlePage(page);
            }
        }
        await page.locator('#send_textarea').fill('DR2 断点往返草稿保持不变');
        await settlePage(page);
        const chatLog = page.locator('#chat');
        await chatLog.focus();
        await page.keyboard.press('Home');
        await page.waitForFunction(() => document.querySelector('#chat').scrollTop <= 2);
        const maxScrollTop = await page.evaluate(() => {
            const chat = document.querySelector('#chat');
            return chat.scrollHeight - chat.clientHeight;
        });
        assert.ok(maxScrollTop > 0, '往返测试必须有可滚动的真实聊天历史');
        await chatLog.hover();
        await page.mouse.wheel(0, Math.floor(maxScrollTop / 2));
        await page.waitForFunction(() => document.querySelector('#chat').scrollTop > 2);
        await settlePage(page);
        const initialScrollTop = await chatLog.evaluate(chat => chat.scrollTop);
        assert.ok(initialScrollTop < maxScrollTop - 2, '先通过真实滚轮进入历史阅读位置');
        await page.evaluate(() => {
            window.__dr2ChromeChanges = 0;
            const target = document.documentElement;
            let last = target.dataset.chrome;
            if (window.__dr2ChromeObserver) window.__dr2ChromeObserver.disconnect();
            window.__dr2ChromeObserver = new MutationObserver(() => {
                const next = target.dataset.chrome;
                if (next !== last) {
                    last = next;
                    window.__dr2ChromeChanges += 1;
                }
            });
            window.__dr2ChromeObserver.observe(target, {
                attributes: true,
                attributeFilter: ['data-chrome'],
            });
        });
        await page.setViewportSize({ width: 1180, height: 800 });
        await settlePage(page);
        await page.setViewportSize({ width: 1179, height: 800 });
        await settlePage(page);
        const roundTripState = await page.evaluate(() => {
            window.__dr2ChromeObserver?.disconnect();
            const chat = document.querySelector('#chat');
            const textarea = document.querySelector('#send_textarea');
            return {
                changes: window.__dr2ChromeChanges ?? 0,
                draft: textarea?.value ?? '',
                scrollTop: chat?.scrollTop ?? 0,
            };
        });
        assert.equal(
            roundTripState.changes,
            2,
            `1179 -> 1180 -> 1179 往返时 data-chrome 变化次数应恰为 2，实际为 ${roundTripState.changes}`,
        );
        assert.equal(roundTripState.draft, 'DR2 断点往返草稿保持不变');
        assert.ok(
            Math.abs(roundTripState.scrollTop - initialScrollTop) <= 2,
            `断点往返后 #chat.scrollTop 应保持不变: expected=${initialScrollTop}, actual=${roundTripState.scrollTop}`,
        );
        await page.locator('#send_textarea').fill('');

        // 第二轮：通过真实 ST/Go 数据源注入超长合成数据（角色名 64 字、最新预览 500 字、超长记忆摘要、世界书条目名 80 字），禁止改写 DOM textContent
        const longName64 = '合成超长角色名_'.repeat(8).slice(0, 64);
        assert.equal(longName64.length, 64);
        const longPreview500 =
            '合成超长会话预览用于检验单行省略与列表容器右边界约束不溢出_'.repeat(20).slice(0, 500);
        const longMemorySummary =
            '合成超长记忆摘要用于验证时间线卡片与详情区在多档宽度下自然换行且不撑破容器边界_'.repeat(4).slice(0, 160);

        const longCharRef = crypto.randomUUID();
        const longChatId = crypto.randomUUID();
        await reauthForWrite(ctx);
        const longBound = await ctx.admin.call('POST', '/api/v1/st/bindings', {
            characterRef: longCharRef,
            chatIdentity: longChatId,
            displayName: longName64.slice(0, 32),
            mode: 'COMPANION',
        });
        assert.equal(longBound.status, 200, '超长角色的实例名仍遵守 Go 32 字契约');
        const longCardData = new FormData();
        longCardData.append('file_type', 'json');
        longCardData.append(
            'avatar',
            new Blob(
                [
                    JSON.stringify({
                        spec: 'chara_card_v2',
                        spec_version: '2.0',
                        data: {
                            name: longName64,
                            description: '超长角色名描述',
                            first_mes: longPreview500,
                            personality: '',
                            scenario: '',
                            mes_example: '',
                            extensions: { vc_character_ref: longCharRef },
                        },
                    }),
                ],
                { type: 'application/json' },
            ),
            'long64.json',
        );
        const longImported = await st.call('POST', '/api/characters/import', longCardData);
        assert.equal(longImported.status, 200);
        const longAvatar = longImported.json.file_name.replace(/\.png$/, '') + '.png';
        assert.equal(
            (
                await st.call('POST', '/api/chats/save', {
                    avatar_url: longAvatar,
                    file_name: 'DR2-long-preview',
                    chat: [
                        {
                            user_name: '合成用户',
                            character_name: longName64,
                            chat_metadata: {
                                vc_f2: { id: longChatId, revision: 0 },
                                vc_binding: {
                                    ...longBound.json,
                                    mode: 'COMPANION',
                                    displayName: longName64.slice(0, 32),
                                },
                            },
                        },
                        {
                            name: longName64,
                            is_user: false,
                            mes: longPreview500,
                            send_date: new Date().toISOString(),
                        },
                    ],
                })
            ).status,
            200,
        );

        const chatRecords = (
            await st.call('POST', '/api/chats/get', {
                avatar_url: fixture.avatar,
                file_name: fixture.file,
            })
        ).json;
        prepareSourceIdentities(chatRecords, { settled: true });
        assert.equal(
            (
                await st.call('POST', '/api/chats/save', {
                    avatar_url: fixture.avatar,
                    file_name: fixture.file,
                    chat: chatRecords,
                })
            ).status,
            200,
        );
        const srcMsg = chatRecords[2];
        const srcCand = srcMsg.extra.vc_source;
        const evidence = `st:${chatRecords[0].chat_metadata.vc_f2.id}:${srcMsg.vc_message_id}:${srcCand.id}:${srcCand.revision}:1`;
        assert.equal(
            (
                await ctx.admin.call('POST', '/api/v1/st/sources/reconcile', {
                    chatIdentities: [chatRecords[0].chat_metadata.vc_f2.id],
                })
            ).status,
            200,
        );
        const longMem = await ctx.admin.call(
            'POST',
            `/api/v1/relationships/${relId}/memories/candidates`,
            {
                scope: 'RELATIONSHIP',
                conversationId: fixture.chat[0].chat_metadata.vc_binding.conversationId,
                summary: longMemorySummary,
                evidence: [evidence],
            },
        );
        assert.equal(longMem.status, 200);
        assert.equal(
            (await ctx.admin.call('POST', `/api/v1/memories/${longMem.json.memoryId}/confirm`, {}))
                .status,
            200,
        );

        await page.setViewportSize({ width: 1440, height: 900 });
        await openDesktopFixture(page, ctx.w05.stBase, fixture);
        await page.locator(`[data-convo-list] [data-relationship-id="${relId}"]`).first().click();
        await page.waitForFunction(
            () =>
                document.documentElement.dataset.vcRuntime === 'prepared' &&
                document.querySelectorAll('#chat > .mes').length > 0,
        );
        await page
            .locator('[data-convo-list] .vc-convo-name')
            .filter({ hasText: longName64 })
            .first()
            .waitFor({ state: 'visible' });
        await page
            .locator('[data-convo-list] .vc-convo-preview')
            .filter({ hasText: longPreview500.slice(0, 40) })
            .first()
            .waitFor({ state: 'visible' });

        for (const dest of destinations) {
            await page.setViewportSize({ width: 1440, height: 900 });
            await navigatePrimary(page, dest);
            if (dest === 'memory') {
                await page
                    .locator('.vc-memory-card')
                    .filter({ hasText: longMemorySummary.slice(0, 30) })
                    .first()
                    .waitFor({ state: 'visible' });
            } else if (dest === 'settings') {
                await openSettingsCategory(page, 'WorldInfo');
                const worldSelect = page.locator('select[data-tavern-resource="world"]');
                await worldSelect.waitFor({ state: 'visible' });
                await worldSelect.selectOption(longBookName);
                await page
                    .locator('.vc-tavern-list button[data-tavern-action="select-item"]')
                    .filter({ hasText: longEntryComment.slice(0, 30) })
                    .first()
                    .waitFor({ state: 'visible' });
            }
            for (const vp of LAYOUT_VIEWPORTS) {
                await page.setViewportSize(vp);
                await settlePage(page);
                await assertLayoutInvariants(page, {
                    width: vp.width,
                    height: vp.height,
                    destination: `${dest}-long`,
                });
                if (dest === 'settings') {
                    const entryOverflows = await page.evaluate(prefix => {
                        const list = document.querySelector('.vc-tavern-list');
                        const item = [
                            ...document.querySelectorAll(
                                '.vc-tavern-list button[data-tavern-action="select-item"]',
                            ),
                        ].find(el => (el.textContent || '').includes(prefix));
                        if (!list || !item) return true;
                        const lRect = list.getBoundingClientRect();
                        const iRect = item.getBoundingClientRect();
                        return iRect.width <= 0 || iRect.right > lRect.right + 2;
                    }, longEntryComment.slice(0, 30));
                    assert.equal(
                        entryOverflows,
                        false,
                        `[settings-long@${vp.width}x${vp.height}] 80 字世界书条目不得撑出列表容器右边界`,
                    );
                }
            }
        }

        if (ctx.capture || process.argv.includes('--capture')) {
            await captureRebuildReviewScreenshots(ctx, page, fixture, {
                longMemorySummary,
                longBookName,
                longEntryComment,
            });
        }

        assert.deepEqual(errors, []);
        return {
            widths: LAYOUT_VIEWPORTS.length,
            destinations: destinations.length,
            roundTripChanges: roundTripState.changes,
            longDataVerified: true,
            secondFixture: Boolean(other.avatar),
        };
    } catch (error) {
        throw new Error(`${error.message}; browserErrors=${JSON.stringify(errors)}`, { cause: error });
    } finally {
        await browser.close();
    }
}

// ---------------------------------------------------------------------------
// 2. dr2-settings：同意门禁、8 类产品设置、9 类酒馆设置、409 冲突、脏状态离开保护与敏感操作重验
// ---------------------------------------------------------------------------
export async function sceneDr2Settings(ctx) {
    const fixture = await seedDesktopBenchmark(ctx);
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH
            ? { executablePath: process.env.VC_W03_CHROMIUM_PATH }
            : {}),
    });
    const context = await desktopBenchmarkContext(browser, ctx);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(`${err.name}: ${err.message}`));

    try {
        // 1) 验证 AppConsentGate 阻挡未完成同意的会话，同意后进入桌面
        await reauthForWrite(ctx);
        assert.equal(
            (
                await ctx.admin.call('PUT', '/api/v1/consents', {
                    consentType: 'SERVICE_TERMS',
                    version: '2026-10-30',
                    granted: false,
                    currentPassword: ctx.secrets.password,
                })
            ).status,
            200,
        );

        await page.goto(ctx.w05.stBase + '/desktop/', {
            waitUntil: 'domcontentloaded',
        });
        await page.locator('#vc-consent').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#vc-shell').count(), 0);

        await page.locator('[data-consent-toggle="SERVICE_TERMS"]').click();
        await page.waitForFunction(
            () =>
                document
                    .querySelector('[data-consent-toggle="SERVICE_TERMS"]')
                    ?.getAttribute('aria-expanded') === 'true',
        );
        await page.locator('[data-consent-accept]').click();
        await page.locator('#vc-shell').waitFor({ state: 'visible' });

        // 打开基准会话，使 SillyTavern.getContext() 与角色上下文就绪
        const relId = fixture.chat[0].chat_metadata.vc_binding.relationshipId;
        await page.locator(`[data-convo-list] [data-relationship-id="${relId}"]`).first().click();
        await page.waitForFunction(
            () => document.documentElement.dataset.vcRuntime === 'prepared',
        );

        // 2) 逐一打开 8 个产品设置分类并验证核心读写、离开保护、409 与敏感重验
        for (const cat of [
            'account',
            'model',
            'voice',
            'notifications',
            'appearance',
            'companion',
            'stickers',
            'data',
        ]) {
            await openSettingsCategory(page, cat);
        }

        // 模型设置：编辑 provider 与脏状态离开保护
        await openSettingsCategory(page, 'model');
        await page.locator('[data-action="select-provider"][data-id="vc03m-chat"]').click();
        const displayInput = page.locator('#vcms-f-display');
        await displayInput.waitFor({ state: 'visible' });
        await displayInput.fill('DR2 未保存模型名');
        await page.locator('#vc-shell .vc-sidebar [data-nav="memory"]').click();
        const modelLeaveDialog1 = page.locator('[role="alertdialog"][data-open]');
        await modelLeaveDialog1.waitFor({ state: 'visible' });
        await modelLeaveDialog1.getByRole('button', { name: '继续编辑', exact: true }).click();
        await page.locator('[role="alertdialog"]').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#vc-shell').getAttribute('data-settings'), 'open');
        assert.equal(await displayInput.inputValue(), 'DR2 未保存模型名');

        const switchingToVoice = page
            .locator('.vc-settings-categories [data-category="voice"]')
            .click();
        const modelLeaveDialog2 = page.locator('[role="alertdialog"][data-open]');
        await modelLeaveDialog2.waitFor({ state: 'visible' });
        await modelLeaveDialog2.getByRole('button', { name: '放弃', exact: true }).click();
        await page.locator('[role="alertdialog"]').waitFor({ state: 'hidden' });
        await switchingToVoice;
        await page.waitForFunction(
            () => document.querySelector('.vc-settings-shell')?.dataset.category === 'voice',
        );

        // 语音设置 409 冲突保留草稿 + 加载最新
        const daily = page.locator('[data-voice-field="dailyChatLimit"]');
        await daily.waitFor({ state: 'visible' });
        const origLimit = Number(await daily.inputValue());
        await daily.fill(String(origLimit + 2));

        // 并发端先更新语音设置触发 409
        await reauthForWrite(ctx);
        const latestVoice = (await ctx.admin.call('GET', '/api/v1/voice/settings')).json;
        const { revision: voiceRevision, updatedAt, ...voiceValues } = latestVoice;
        assert.equal(
            (
                await ctx.admin.call('PUT', '/api/v1/voice/settings', {
                    ...voiceValues,
                    expectedRevision: voiceRevision,
                    dailyChatLimit: origLimit + 1,
                })
            ).status,
            200,
        );

        await page.locator('[data-voice-save]').click();
        await page
            .getByText('设置已在另一处更新。你的输入已保留。', { exact: true })
            .waitFor({ state: 'visible' });
        assert.equal(await daily.inputValue(), String(origLimit + 2));
        await page.getByRole('button', { name: '加载最新', exact: true }).click();
        await page.waitForFunction(
            expected =>
                document.querySelector('[data-voice-field="dailyChatLimit"]')?.value ===
                String(expected),
            origLimit + 1,
        );

        // 账户敏感操作弹层与关闭
        await openSettingsCategory(page, 'account');
        await page.locator('[data-open-account="password"]').click();
        await page.locator('[data-vc-screen="password"]').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await page.locator('[data-vc-screen="password"]').waitFor({ state: 'hidden' });

        // B1：数据导出敏感操作 reauth 流（错误密码拒绝不建导出并保留待续动作 -> 正确密码重验并创建导出）
        await openSettingsCategory(page, 'data');
        await page.locator('[data-open-data]').click();
        await page.locator('.vc-data-dialog[data-vc-screen="home"]').waitFor({ state: 'visible' });
        await page.locator('[data-vc-account-go="export"]').click();
        await page.locator('.vc-data-dialog[data-vc-screen="export"]').waitFor({ state: 'visible' });
        let exportPosts = 0;
        const onExportReq = req => {
            if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/api/v1/exports')) {
                exportPosts += 1;
            }
        };
        page.on('request', onExportReq);
        try {
            await page.locator('[data-export]').click();
            await page.locator('.vc-account-reauth').waitFor({ state: 'visible' });

            // 错误密码：提交后失败提示、不发起导出 POST、密码清空、reauth 仍保留打开
            const badReauthResp = page.waitForResponse(
                r => new URL(r.url()).pathname.endsWith('/api/v1/auth/reauth') && r.request().method() === 'POST',
            );
            await page.locator('input[data-reauth-password]').fill('wrong-password-for-dr2-reauth');
            await page.locator('form[data-reauth] button[type="submit"]').click();
            assert.notEqual((await badReauthResp).status(), 200);
            await page.waitForFunction(() => {
                const text = document.querySelector('[data-reauth-status]')?.textContent?.trim() || '';
                return text.length > 0 && text !== '正在验证…';
            });
            assert.equal(exportPosts, 0);
            assert.equal((await page.locator('input[data-reauth-password]').inputValue()).length, 0);
            assert.equal(await page.locator('.vc-account-reauth').isVisible(), true);

            // 正确密码：重验 200 + POST /api/v1/exports 成功创建导出，reauth 关闭且密码已清空
            const okReauthResp = page.waitForResponse(
                r => new URL(r.url()).pathname.endsWith('/api/v1/auth/reauth') && r.request().method() === 'POST',
            );
            const okExportResp = page.waitForResponse(
                r => new URL(r.url()).pathname.endsWith('/api/v1/exports') && r.request().method() === 'POST',
            );
            await page.locator('input[data-reauth-password]').fill(ctx.secrets.password);
            await page.locator('form[data-reauth] button[type="submit"]').click();
            assert.equal((await okReauthResp).status(), 200);
            const exportRes = await okExportResp;
            assert.ok([200, 201, 202].includes(exportRes.status()));
            const exportJson = await exportRes.json().catch(() => ({}));
            assert.ok(Boolean(exportJson?.exportId), '敏感导出应返回 exportId');
            await page.locator('.vc-account-reauth').waitFor({ state: 'hidden' });
            assert.equal(exportPosts, 1);
            assert.equal((await page.locator('input[data-reauth-password]').inputValue()).length, 0);
            await page.waitForFunction(
                () => (document.querySelector('[data-export-status]')?.textContent?.trim() || '').length > 0,
            );
            await page.locator('.vc-data-dialog [data-close]').click();
            await page.locator('.vc-data-dialog').waitFor({ state: 'hidden' });
        } finally {
            page.off('request', onExportReq);
        }

        // 外观设置（含 B11 角色主题与回复样式持久化）
        await openSettingsCategory(page, 'appearance');
        await page
            .getByRole('radiogroup', { name: '外观', exact: true })
            .getByRole('radio', { name: '深色', exact: true })
            .click();
        await page
            .getByRole('radiogroup', { name: '回复样式', exact: true })
            .getByRole('radio', { name: '铺开', exact: true })
            .click();
        assert.equal(await page.evaluate(() => localStorage.getItem('vc-reply-style')), 'spread');
        await page
            .getByRole('radiogroup', { name: '外观', exact: true })
            .getByRole('radio', { name: '浅色', exact: true })
            .click();

        // 9 类酒馆设置分类切换与离开保护
        for (const panel of [
            'left-nav-panel',
            'AdvancedFormatting',
            'WorldInfo',
            'rm_extensions_block',
            'PersonaManagement',
            'Backgrounds',
            'user-settings-block',
            'rm_api_block',
            'right-nav-panel',
        ]) {
            await openSettingsCategory(page, panel);
            await page.locator('.vc-tavern-form').waitFor({ state: 'visible' });
        }

        await openSettingsCategory(page, 'left-nav-panel');
        const frequencyPenalty = page.getByRole('spinbutton', { name: '频率惩罚', exact: true });
        await frequencyPenalty.fill(Number(await frequencyPenalty.inputValue()) === 1.16 ? '1.15' : '1.16');
        await page.locator('#vc-shell .vc-sidebar [data-nav="memory"]').click();
        const tavernLeaveDialog1 = page.locator('[role="alertdialog"][data-open]');
        await tavernLeaveDialog1.waitFor({ state: 'visible' });
        await tavernLeaveDialog1.getByRole('button', { name: '继续编辑', exact: true }).click();
        await page.locator('[role="alertdialog"]').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#vc-shell').getAttribute('data-settings'), 'open');
        await page.locator('#vc-shell .vc-sidebar [data-nav="memory"]').click();
        const tavernLeaveDialog2 = page.locator('[role="alertdialog"][data-open]');
        await tavernLeaveDialog2.waitFor({ state: 'visible' });
        await tavernLeaveDialog2.getByRole('button', { name: '放弃', exact: true }).click();
        await page.locator('[role="alertdialog"]').waitFor({ state: 'hidden' });
        await page.waitForFunction(
            () => document.querySelector('#vc-shell')?.dataset.destination === 'memory',
        );

        assert.deepEqual(errors, []);
        return {
            consentGate: true,
            productCategories: 8,
            tavernCategories: 9,
            voiceConflict409: true,
            leaveGuard: true,
            fixtureAvatar: fixture.avatar,
        };
    } finally {
        await browser.close();
    }
}

// ---------------------------------------------------------------------------
// 3. dr2-pages：角色导入与 7 步向导、记忆置顶/纠正/删除、陪伴策略与渠道校验、剧情开局与行动
// ---------------------------------------------------------------------------
export async function sceneDr2Pages(ctx) {
    await ctx.fixtureHttp.setOverride('vc03m-tools', {
        text: 'DR2 合成剧情回复。',
        tool: null,
        reasoning: null,
        toolOnce: false,
    });
    const fixture = await seedDesktopBenchmark(ctx, { messages: 30 });
    await bindForeground(ctx, 'vc03m-chat', 'chat-tools', 'vc03m-tools');
    const st = createStClient({
        baseUrl: ctx.w05.stBase,
        expectedIdentity: ctx.secrets.session,
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}`,
    });
    const binding = fixture.chat[0].chat_metadata.vc_binding;
    const base = `/api/v1/relationships/${binding.relationshipId}`;
    const memoryFact = 'DR2 合成记忆条目';
    const records = (
        await st.call('POST', '/api/chats/get', {
            avatar_url: fixture.avatar,
            file_name: fixture.file,
        })
    ).json;
    records[1] = { name: '合成用户', is_user: true, mes: memoryFact, send_date: new Date().toISOString(), extra: {} };
    prepareSourceIdentities(records, { settled: true });
    assert.equal(
        (
            await st.call('POST', '/api/chats/save', {
                avatar_url: fixture.avatar,
                file_name: fixture.file,
                chat: records,
            })
        ).status,
        200,
    );
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH
            ? { executablePath: process.env.VC_W03_CHROMIUM_PATH }
            : {}),
    });
    const bc = await desktopBenchmarkContext(browser, ctx, {
        timezoneId: 'Asia/Shanghai',
    });
    const page = await bc.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(`${err.name}: ${err.message}`));

    let originalMemoryPurpose;
    let originalRerank;
    let memoryPurposeChanged = false;
    let rerankChanged = false;

    try {
        // Correction requires a real engine projection, as in the memory-browser scenario.
        await reauthForWrite(ctx);
        const tags = await fetch('http://127.0.0.1:11438/api/tags', { signal: AbortSignal.timeout(5000) });
        assert.ok(tags.ok, '现有本机嵌入服务必须就绪');
        const embedding = (await tags.json()).models?.find(model => model.name === 'qwen3-embedding:0.6b');
        assert.ok(embedding, '现有本机嵌入模型必须就绪');
        const embeddingConfig = await ctx.admin.call('GET', '/api/v1/admin/embedding-config');
        assert.ok([200, 404].includes(embeddingConfig.status));
        assert.equal((await ctx.admin.call('PUT', '/api/v1/admin/embedding-config', {
            model: embedding.name, artifactVersion: embedding.digest, dimensions: 1024,
            queryPreprocessingVersion: 'qwen3-retrieval-v1', documentPreprocessingVersion: 'identity-v1',
            normalization: 'l2', state: 'ENABLED', expectedRevision: embeddingConfig.status === 200 ? embeddingConfig.json.revision : 0,
        })).status, 200);
        originalRerank = (await ctx.admin.call('GET', '/api/v1/admin/local-models')).json.rerank;
        if (originalRerank.enabled) {
            assert.equal((await ctx.admin.call('PUT', '/api/v1/admin/local-models/rerank', { enabled: false, expectedRevision: originalRerank.revision })).status, 200);
            rerankChanged = true;
        }
        assert.equal((await ctx.admin.saveProvider('vc08-memory', {
            displayName: 'DR2 合成提取', protocol: 'OPENAI_CHAT_COMPLETIONS',
            baseUrl: `http://127.0.0.1:${process.env.VC_W03_FIXTURE_PORT || 8753}/v1`, credential: ctx.secrets.fixtureKey,
            state: 'ENABLED', expectedRevision: 0,
            models: [{ profileKey: 'memory', modelId: 'vc08-memory', displayName: 'MemoryCore 合成提取',
                contextWindowTokens: 32768, maxOutputTokens: 4096, state: 'ENABLED',
                capabilities: { systemMessage: 'DECLARED' }, reasoningLevels: [], generationParams: {} }],
        })).status, 200);
        ctx.w08.seedSyntheticPrice();
        await ctx.fixtureHttp.setOverride('vc08-memory', { memorycoreDocuments: [{ content: memoryFact }] });
        originalMemoryPurpose = (await ctx.admin.listPurposes()).json.find(row => row.purpose === 'MEMORY_EXTRACTION_DEDUP_SUMMARY');
        assert.ok(originalMemoryPurpose);
        assert.equal((await ctx.admin.savePurpose('MEMORY_EXTRACTION_DEDUP_SUMMARY', {
            providerId: 'vc08-memory', profileKey: 'memory', state: 'ENABLED', expectedRevision: originalMemoryPurpose.revision,
        })).status, 200);
        memoryPurposeChanged = true;
        assert.equal((await ctx.admin.call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [records[0].chat_metadata.vc_f2.id] })).status, 200);
        const latestToken = (await st.call('POST', '/api/chats/get', { avatar_url: fixture.avatar, file_name: fixture.file })).json[0].chat_metadata.vc_f2;
        assert.equal((await ctx.admin.call('POST', '/api/v1/st/memory/recall', {
            chatIdentity: latestToken.id, revision: latestToken.revision, enabled: true, budgetTokens: 1024,
        })).status, 200);
        await waitFor(async () => {
            const memories = await ctx.admin.call('GET', base + '/memories');
            assert.equal(memories.status, 200);
            return memories.json.some(item => item.summary === memoryFact && item.lifecycle === 'ACTIVE' && item.recallEligible);
        }, { timeoutMs: 90000, label: 'DR2 可纠正记忆的真实提取投影' });
        await openDesktopFixture(page, ctx.w05.stBase, fixture, 30);

        // 1) CharactersRoute：角色卡 JSON 导入 + 7 步新建向导
        await navigatePrimary(page, 'characters');
        const importedName = `DR2 导入角色 ${crypto.randomUUID().slice(0, 6)}`;
        await page.locator('.vc-characters-route input[type="file"]').setInputFiles({
            name: 'dr2-import.json',
            mimeType: 'application/json',
            buffer: Buffer.from(
                JSON.stringify({
                    spec: 'chara_card_v2',
                    spec_version: '2.0',
                    data: {
                        name: importedName,
                        description: 'DR2 导入角色设定',
                        first_mes: '你好，我是导入角色。',
                        personality: '',
                        scenario: '',
                        mes_example: '',
                    },
                }),
            ),
        });
        await page
            .locator('.vc-character-card[data-ref]')
            .filter({ hasText: importedName })
            .waitFor({ state: 'visible' });

        await page.getByRole('button', { name: '新建角色', exact: true }).first().click();
        await page.locator('#vc-wizard-name').fill('DR2 向导合成角色');
        await page.getByRole('button', { name: '下一步', exact: true }).click();
        await page.getByRole('button', { name: '下一步', exact: true }).click();
        await page.locator('#vc-wizard-personality').fill('向导合成角色设定');
        await page.getByRole('button', { name: '下一步', exact: true }).click();
        await page.locator('#vc-wizard-address').fill('你');
        await page.getByRole('button', { name: '下一步', exact: true }).click();
        await page.locator('#vc-wizard-scenario').fill('雨后书店');
        await page.getByRole('button', { name: '下一步', exact: true }).click();
        await page.locator('#vc-wizard-avoid').fill('剧透');
        await page.getByRole('button', { name: '下一步', exact: true }).click();
        await page.locator('#vc-wizard-first-mes').fill('你好，我是向导合成角色。');
        await page.getByRole('button', { name: '开始聊天', exact: true }).click();

        await page.waitForFunction(
            () => document.querySelector('#vc-shell')?.dataset.destination === 'chat',
        );
        await page
            .locator('#chat > .mes .mes_text')
            .filter({ hasText: '你好，我是向导合成角色。' })
            .waitFor({ state: 'visible' });

        // 切回基准会话以测试该关系下的记忆与陪伴策略
        await page
            .locator(`[data-convo-list] [data-relationship-id="${binding.relationshipId}"]`)
            .first()
            .click();
        await page.waitForFunction(
            id =>
                window.SillyTavern?.getContext()?.chatMetadata?.vc_binding?.relationshipId ===
                id,
            binding.relationshipId,
        );

        // 2) MemoryRoute：置顶、纠正与删除（遗忘）
        await navigatePrimary(page, 'memory');
        const memCard = page
            .locator('.vc-memory-card')
            .filter({ hasText: 'DR2 合成记忆条目' });
        await memCard.waitFor({ state: 'visible' });
        await memCard.click();
        await reauthForWrite(ctx);
        await page.getByRole('button', { name: '置顶', exact: true }).click();
        await page
            .getByRole('button', { name: '取消置顶', exact: true })
            .waitFor({ state: 'visible' });
        await page.getByRole('button', { name: '纠正', exact: true }).click();
        await page.getByLabel('记忆内容').fill('DR2 合成记忆条目（已纠正）');
        const correctedResponse = page.waitForResponse(response =>
            response.request().method() === 'PATCH' &&
            /\/api\/v1\/memories\/[^/]+$/.test(new URL(response.url()).pathname),
        );
        await page.getByRole('button', { name: '保存纠正', exact: true }).click();
        const correctedHttp = await correctedResponse;
        const correctionCode = correctedHttp.status() === 200 ? 'OK' : (await correctedHttp.json()).code;
        assert.equal(correctedHttp.status(), 200, `记忆纠正 HTTP ${correctedHttp.status()} (${correctionCode})`);
        await page.locator('.vc-correct-memory').waitFor({ state: 'hidden' });
        await page
            .locator('.vc-memory-detail-pane__summary')
            .filter({ hasText: 'DR2 合成记忆条目（已纠正）' })
            .waitFor({ state: 'visible' });
        await page.getByRole('button', { name: '遗忘', exact: true }).click();
        const forgottenResponse = page.waitForResponse(response =>
            response.request().method() === 'DELETE' &&
            /\/api\/v1\/memories\/[^/]+$/.test(new URL(response.url()).pathname),
        );
        await page.getByRole('button', { name: '确认遗忘', exact: true }).click();
        assert.equal((await forgottenResponse).status(), 202);
        await page
            .locator('.vc-memory-detail-pane__notice')
            .filter({ hasText: '聊天原文仍保留，可能继续用于当前对话。' })
            .waitFor({ state: 'visible' });

        // 3) InboxRoute：主动策略保存与渠道非法 URL 拒绝
        await navigatePrimary(page, 'inbox');
        const capInput = page.getByLabel('每日上限');
        await capInput.waitFor({ state: 'visible' });
        await capInput.fill('3');
        await reauthForWrite(ctx);
        await page.getByRole('button', { name: '保存策略', exact: true }).click();
        await page
            .getByText('已保存主动陪伴策略', { exact: true })
            .waitFor({ state: 'visible' });

        await page.getByRole('button', { name: '配置' }).first().click();
        const targetInput = page.getByLabel('收件地址或标识');
        await targetInput.waitFor({ state: 'visible' });
        await targetInput.fill('https://forbidden.example.com');
        await page.getByRole('button', { name: '保存渠道', exact: true }).click();
        await page
            .getByText('地址不能是链接。', { exact: true })
            .waitFor({ state: 'visible' });
        await page.getByRole('button', { name: '取消', exact: true }).click();

        // 4) StoryRoute：5 步开局向导创建剧情并执行第一步行动
        await navigatePrimary(page, 'story');
        for (let step = 1; step < 5; step++) {
            await page
                .locator(`[data-wizard-step="${step}"]`)
                .waitFor({ state: 'visible' });
            await page.locator('[data-action="wizard-next"]').click();
        }
        await page.locator('[data-wizard-step="5"]').waitFor({ state: 'visible' });
        await page.locator('[data-action="wizard-start"]').click();
        await page
            .locator('.vc-story-tab .vc-story[data-state="playing"]')
            .waitFor({ state: 'visible' });
        await page
            .locator('.vc-story-tab [data-action="select-actor"][data-actor="lin"]')
            .click();
        await page.locator('.vc-story-tab [data-step="a1"]').click();
        await page.waitForFunction(
            () =>
                document.querySelector('.vc-story-tab .vc-story')?.dataset
                    .worldVersion === '1' &&
                !document.querySelector('.vc-story-sync'),
        );

        assert.deepEqual(errors, []);
        return {
            characterImportAndWizard: true,
            memoryPinCorrectForget: true,
            inboxPolicyAndChannel: true,
            storyWizardAndAction: true,
        };
    } finally {
        await browser.close();
        await ctx.fixtureHttp.setOverride('vc03m-tools', null);
        await ctx.fixtureHttp.setOverride('vc08-memory', null);
        if (memoryPurposeChanged) {
            const current = (await ctx.admin.listPurposes()).json.find(row => row.purpose === 'MEMORY_EXTRACTION_DEDUP_SUMMARY');
            assert.equal((await ctx.admin.savePurpose('MEMORY_EXTRACTION_DEDUP_SUMMARY', {
                providerId: originalMemoryPurpose.providerId, profileKey: originalMemoryPurpose.profileKey,
                state: originalMemoryPurpose.state, expectedRevision: current.revision,
            })).status, 200);
        }
        if (rerankChanged) {
            const current = (await ctx.admin.call('GET', '/api/v1/admin/local-models')).json.rerank;
            assert.equal((await ctx.admin.call('PUT', '/api/v1/admin/local-models/rerank', {
                enabled: originalRerank.enabled, expectedRevision: current.revision,
            })).status, 200);
        }
    }
}

// ---------------------------------------------------------------------------
// 4. dr2-mvu-new：新建空 MVU 会话 5 秒内出现开场白且可发送、无 ReferenceError（B1/B2）及单次持久化
// ---------------------------------------------------------------------------
export async function sceneDr2MvuNew(ctx) {
    const st = createStClient({
        baseUrl: ctx.w05.stBase,
        expectedIdentity: ctx.secrets.session,
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}`,
    });
    const fixture = await seedDesktopBenchmark(ctx);
    const other = await seedDesktopBenchmark(ctx);
    const book = 'DR2 合成空会话书店';
    const card = complexCard('DR2 合成空会话角色', book);
    const existing = (
        await st.call('POST', '/api/characters/get', { avatar_url: fixture.avatar })
    ).json;
    card.data.extensions.vc_character_ref =
        existing.data.extensions.vc_character_ref;
    card.data.extensions.world = book;
    assert.equal(
        (
            await st.call('POST', '/api/characters/merge-attributes', {
                avatar: fixture.avatar,
                data: card.data,
            })
        ).status,
        200,
    );
    const entries = Object.fromEntries(
        card.data.character_book.entries.map((entry, index) => [
            entry.id,
            {
                uid: entry.id,
                key: entry.keys,
                keysecondary: entry.secondary_keys,
                content: entry.content,
                comment: entry.comment,
                constant: entry.constant,
                selective: entry.selective,
                selectiveLogic: 0,
                order: entry.insertion_order,
                position: 0,
                disable: false,
                displayIndex: index,
                useProbability: true,
                probability: 100,
                group: '',
                groupWeight: 100,
                depth: 4,
                role: 0,
                addMemo: true,
            },
        ]),
    );
    assert.equal(
        (
            await st.call('POST', '/api/worldinfo/edit', {
                name: book,
                data: { entries },
            })
        ).status,
        200,
    );

    // 真实新空会话种子：仅保留 metadata 头，不预写开场白
    const records = (
        await st.call('POST', '/api/chats/get', {
            avatar_url: fixture.avatar,
            file_name: fixture.file,
        })
    ).json;
    records.splice(1);
    assert.equal(
        (
            await st.call('POST', '/api/chats/save', {
                avatar_url: fixture.avatar,
                file_name: fixture.file,
                chat: records,
            })
        ).status,
        200,
    );
    const before = (
        await st.call('POST', '/api/chats/get', {
            avatar_url: fixture.avatar,
            file_name: fixture.file,
        })
    ).json;
    assert.equal(
        before.length,
        1,
        'dr2-mvu-new 前置条件：持久化的新空会话必须仅有 metadata 头',
    );

    const settings = JSON.parse(
        (await st.call('POST', '/api/settings/get', {})).json.settings,
    );
    settings.extension_settings ||= {};
    settings.extension_settings.EjsTemplate ||= {};
    Object.assign(settings.extension_settings.EjsTemplate, {
        compile_workers: false,
        sandbox: false,
    });
    settings.extension_settings.character_allowed_regex = [fixture.avatar];
    settings.extension_settings.tavern_helper ||= {};
    settings.extension_settings.tavern_helper.script ||= {};
    settings.extension_settings.tavern_helper.script.enabled ||= {};
    settings.extension_settings.tavern_helper.script.enabled.characters = [
        fixture.avatar,
    ];
    settings.extension_settings.vc_reply_planner = false;
    assert.equal(
        (await st.call('POST', '/api/settings/save', settings)).status,
        200,
    );

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH
            ? { executablePath: process.env.VC_W03_CHROMIUM_PATH }
            : {}),
    });

    try {
        const page = await (
            await desktopBenchmarkContext(browser, ctx, {
                viewport: { width: 1440, height: 900 },
            })
        ).newPage();
        const errors = [];
        const scriptFailures = [];
        let consoleReferenceErrors = 0;
        page.on('pageerror', error => errors.push(error.name || 'Error'));
        page.on('console', message => {
            if (message.type() === 'error' && /ReferenceError/.test(message.text())) {
                consoleReferenceErrors += 1;
            }
        });
        page.on('response', response => {
            if (
                response.status() >= 400 &&
                response.request().resourceType() === 'script'
            ) {
                scriptFailures.push({
                    status: response.status(),
                    path: new URL(response.url()).pathname,
                });
            }
        });

        await page.goto(ctx.w05.stBase + '/desktop/', {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForFunction(
            () => document.documentElement.dataset.vcApp === 'ready',
        );

        const relationshipId =
            fixture.chat[0].chat_metadata.vc_binding.relationshipId;
        const otherRelationshipId =
            other.chat[0].chat_metadata.vc_binding.relationshipId;

        // 从应用 ready 后点击打开空 MVU 会话开始 5 秒计时（B1）
        const start = Date.now();
        const remaining = () => Math.max(1, 5000 - (Date.now() - start));
        await page
            .locator(`[data-convo-list] [data-relationship-id="${relationshipId}"]`)
            .first()
            .click({ timeout: remaining() });
        await page
            .locator('#send_textarea')
            .fill('DR2_MVU_READY_PROBE', { timeout: remaining() });
        await page.waitForFunction(
            () =>
                document.documentElement.dataset.vcRuntime === 'prepared' &&
                document.querySelectorAll('#chat > .mes').length > 0 &&
                document.querySelector('#send_but')?.disabled === false &&
                Boolean(globalThis.Mvu),
            null,
            { timeout: remaining() },
        );
        const readyMs = Date.now() - start;
        assert.ok(
            readyMs <= 5000,
            `新建空 MVU 会话必须在 5 秒内出现开场白且可发送，实际耗时 ${readyMs}ms`,
        );

        await page.waitForTimeout(200);
        const final = await page.evaluate(() => ({
            runtime: document.documentElement.dataset.vcRuntime,
            messages: document.querySelectorAll('#chat > .mes').length,
            sendEnabled: document.querySelector('#send_but')?.disabled === false,
            mvu: Boolean(globalThis.Mvu),
            hasSetLorebookSettings:
                typeof globalThis.TavernHelper?.setLorebookSettings === 'function',
            scriptFrames: document.querySelectorAll(
                'iframe[data-vc-card-kind="script"]',
            ).length,
        }));
        assert.ok(final.scriptFrames > 0, 'MVU 脚本 iframe 必须已挂载');
        assert.equal(final.sendEnabled, true);
        assert.equal(
            final.hasSetLorebookSettings,
            true,
            '桌面 TavernHelper 必须提供 setLorebookSettings（B2）',
        );
        assert.deepEqual(errors, [], 'MVU 启动不得产生未捕获异常');
        assert.equal(
            consoleReferenceErrors,
            0,
            'MVU 启动与运行不得产生 ReferenceError',
        );
        assert.deepEqual(scriptFailures, [], 'MVU 所需脚本必须全部加载成功');

        const disk = (
            await st.call('POST', '/api/chats/get', {
                avatar_url: fixture.avatar,
                file_name: fixture.file,
            })
        ).json;
        assert.ok(disk.length > 1, '空 MVU 会话自动开场白必须已持久化');

        // 验证 MVU 式异步 CHARACTER_MESSAGE_RENDERED 回调更新变量后单次保存（先移监听再写变量）
        await page.waitForFunction(
            () => globalThis.SillyTavern.getContext().metadataDirty === false,
        );
        const prior = (
            await st.call('POST', '/api/chats/get', {
                avatar_url: fixture.avatar,
                file_name: fixture.file,
            })
        ).json;
        let saveRequests = 0;
        const onSaveReq = req => {
            if (
                req.method() === 'POST' &&
                new URL(req.url()).pathname.endsWith('/api/chats/save')
            ) {
                saveRequests += 1;
            }
        };
        page.on('request', onSaveReq);
        const iframe = await page
            .locator('iframe#TH-script--character--vc04-mvu')
            .elementHandle();
        const frame = await iframe.contentFrame();
        assert.ok(frame, '真实 MVU 脚本 iframe 必须存在');
        const asyncResult = await frame.evaluate(async () => {
            const api = globalThis.TavernHelper;
            const ctx = parent.SillyTavern.getContext();
            const index = ctx.chat.length;
            let rendered = false;
            let domReady = false;
            const onRendered = async id => {
                if (Number(id) !== index) return;
                api.eventRemoveListener(
                    api.tavern_events.CHARACTER_MESSAGE_RENDERED,
                    onRendered,
                );
                domReady = Boolean(
                    parent.document.querySelector(`#chat > .mes[mesid="${index}"]`),
                );
                await new Promise(r => setTimeout(r, 30));
                await api.updateVariablesWith(
                    vars => ({ ...vars, dr2_render_probe: 1 }),
                    { type: 'chat' },
                );
                rendered = true;
            };
            api.eventOn(api.tavern_events.CHARACTER_MESSAGE_RENDERED, onRendered);
            await api.createChatMessages([
                { role: 'assistant', message: 'DR2_RENDER_PROBE' },
            ]);
            return { rendered, domReady, messageCount: ctx.chat.length };
        });
        assert.equal(asyncResult.rendered, true);
        assert.equal(asyncResult.domReady, true);
        await page.waitForTimeout(1000);
        page.off('request', onSaveReq);
        const saved = (
            await st.call('POST', '/api/chats/get', {
                avatar_url: fixture.avatar,
                file_name: fixture.file,
            })
        ).json;
        assert.equal(
            saveRequests,
            1,
            'Helper 追加消息与异步 rendered 回调写变量只应触发 1 次 POST /api/chats/save',
        );
        assert.equal(saved[0].chat_metadata.variables.dr2_render_probe, 1);
        assert.equal(
            saved[0].chat_metadata.vc_f2.revision,
            prior[0].chat_metadata.vc_f2.revision + 1,
        );

        // B2：切换会话到另一会话再切回，控制台无 ReferenceError
        await page
            .locator(
                `[data-convo-list] [data-relationship-id="${otherRelationshipId}"]`,
            )
            .first()
            .click();
        await page.waitForFunction(
            id =>
                window.SillyTavern?.getContext()?.chatMetadata?.vc_binding
                    ?.relationshipId === id,
            otherRelationshipId,
        );
        await page
            .locator(`[data-convo-list] [data-relationship-id="${relationshipId}"]`)
            .first()
            .click();
        await page.waitForFunction(
            id =>
                window.SillyTavern?.getContext()?.chatMetadata?.vc_binding
                    ?.relationshipId === id,
            relationshipId,
        );
        assert.equal(
            consoleReferenceErrors,
            0,
            '切换 MVU 会话不得触发 setLorebookSettings 等 ReferenceError（B2）',
        );
        assert.deepEqual(errors, []);

        return {
            readyMs,
            firstMessagePersisted: disk.length - 1,
            saveRequests,
            revisionDelta: 1,
            consoleReferenceErrors,
        };
    } finally {
        await browser.close();
    }
}

export const dr2LayoutScene = {
    id: 'dr2-layout',
    title: 'DR2 电脑端 9 宽度、断点往返与六页几何验收',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneDr2Layout,
};

export const dr2SettingsScene = {
    id: 'dr2-settings',
    title: 'DR2 电脑端同意门禁、8 类产品设置与 9 类酒馆设置验收',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneDr2Settings,
};

export const dr2PagesScene = {
    id: 'dr2-pages',
    title: 'DR2 电脑端角色向导、记忆纠正、主动陪伴与剧场向导验收',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneDr2Pages,
};

export const dr2MvuNewScene = {
    id: 'dr2-mvu-new',
    title: 'DR2 电脑端新建复杂卡会话首条消息渲染与 MVU 初始化验收',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneDr2MvuNew,
};

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
    process.argv.includes('--capture')
) {
    const acceptScript = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        'accept-managed.mjs',
    );
    const r = spawnSync(
        process.execPath,
        [acceptScript, '--filter', 'dr2-layout', '--capture'],
        { stdio: 'inherit', env: process.env },
    );
    process.exit(r.status ?? 1);
}
