// Virtual Companion · MB2-5 手机壳层与全设备矩阵受管验收（mb2-shell / mb2-layout + 可选 4× CPU 壳层切换采样）
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README.md；ADR-0009 §3 / ADR-0012）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindForeground } from './lib/accept-scene-helpers.mjs';
import { trackPageErrors } from './lib/page-errors.mjs';
import { completeStOnboarding } from './lib/st-onboarding.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INTEG_ROOT = path.resolve(HERE, '..');

export const MOBILE_SHELL_TABS = [
    { key: 'chat', path: '/m/chat', label: '聊天' },
    { key: 'characters', path: '/m/characters', label: '角色' },
    { key: 'memory', path: '/m/memory', label: '记忆' },
    { key: 'inbox', path: '/m/inbox', label: '陪伴' },
    { key: 'story', path: '/m/story', label: '剧情' },
];

export const MOBILE_THEME_OPTIONS = [
    { mode: 'auto', label: '跟随系统' },
    { mode: 'light', label: '浅色' },
    { mode: 'dark', label: '深色' },
];

export const PHONE_PORTRAIT_VIEWPORTS = [
    { width: 320, height: 568, category: 'small-phone' },
    { width: 360, height: 780, category: 'small-phone' },
    { width: 390, height: 844, category: 'mainstream-phone' },
    { width: 393, height: 852, category: 'mainstream-phone' },
    { width: 412, height: 915, category: 'mainstream-phone' },
    { width: 430, height: 932, category: 'large-phone' },
];

export const FOLDABLE_PHONE_SHELL_VIEWPORTS = [
    { width: 673, height: 841, category: 'foldable-phone-shell-only' },
    { width: 768, height: 1024, category: 'tablet-phone-shell-only' },
];

export const REPRESENTATIVE_SHOT_VIEWPORTS = [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
];

function resolveArtifactDir(ctx) {
    const dir = ctx?.artifactsDir || ctx?.artifactDir || path.join(INTEG_ROOT, 'dev-managed', 'artifacts', 'mb2-shell-manual');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}

function resolveStBase(ctx) {
    return ctx?.w05?.stBase || `http://127.0.0.1:${process.env.VC_W03_ST_PORT || 8752}`;
}

async function createMobileBrowserContext(browser, ctx, options = {}) {
    const stBase = resolveStBase(ctx);
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        reducedMotion: 'no-preference',
        timezoneId: 'Asia/Shanghai',
        ...options,
    });
    if (ctx?.secrets?.session) {
        await context.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: stBase },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: stBase },
        ]);
    }
    await completeStOnboarding(context, stBase);
    return context;
}

export async function settleMobilePage(page) {
    await page.evaluate(async () => {
        if (document.fonts?.ready) {
            await Promise.race([
                document.fonts.ready,
                new Promise((resolve) => setTimeout(resolve, 2000)),
            ]);
        }
    });
    await page.waitForFunction(
        () => {
            const isIdle = (anim) => {
                if (anim.playState !== 'running') return true;
                const timing = anim.effect?.getComputedTiming?.();
                return timing?.iterations === Infinity;
            };
            if (!document.getAnimations().every(isIdle)) return false;
            const shadowHosts = document.querySelectorAll(
                'ion-modal, ion-tab-bar, ion-tab-button, ion-back-button',
            );
            for (const host of shadowHosts) {
                const shadowAnims = host.shadowRoot?.getAnimations?.() || [];
                if (!shadowAnims.every(isIdle)) return false;
            }
            return true;
        },
        null,
        { timeout: 5000 },
    );
    await page.evaluate(
        () =>
            new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
    );
}

export async function waitForSettingsSheetState(page, expectedOpen) {
    await page.waitForFunction(
        (openTarget) => {
            const sheet = document.querySelector('[data-vc-settings-sheet]');
            const modal = document.querySelector('ion-modal.vc-mobile-settings-modal, ion-modal');
            if (openTarget) {
                if (!sheet || sheet.hidden || sheet.getAttribute('data-open') === 'false') return false;
                const cs = getComputedStyle(sheet);
                if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) {
                    return false;
                }
                if (
                    modal &&
                    (modal.getAttribute('aria-hidden') === 'true' ||
                        !modal.classList.contains('show-modal'))
                ) {
                    return false;
                }
                const r = sheet.getBoundingClientRect();
                return r.width > 80 && r.height > 80 && r.top < window.innerHeight && r.bottom > 0;
            }
            const sheetClosed =
                !sheet ||
                sheet.hidden ||
                sheet.getAttribute('data-open') === 'false' ||
                getComputedStyle(sheet).display === 'none';
            const modalDismissed =
                !modal ||
                (!modal.classList.contains('show-modal') &&
                    getComputedStyle(modal).display === 'none');
            return sheetClosed && modalDismissed;
        },
        expectedOpen,
        { timeout: 10000 },
    );
    await settleMobilePage(page);
}

export async function closeSettingsSheetAndWaitDidDismiss(page, triggerCloseAction) {
    const waiterHandle = await page.evaluateHandle(() => {
        const modal = document.querySelector('ion-modal.vc-mobile-settings-modal, ion-modal');
        if (!modal || !modal.classList.contains('show-modal')) {
            return { wait: () => Promise.resolve(false) };
        }
        const promise = new Promise((resolve) => {
            modal.addEventListener('ionModalDidDismiss', () => resolve(true), { once: true });
        });
        return { wait: () => promise };
    });
    try {
        await Promise.all([waiterHandle.evaluate((w) => w.wait()), triggerCloseAction()]);
    } finally {
        await waiterHandle.dispose().catch(() => {});
    }
    await waitForSettingsSheetState(page, false);
}

async function clickThemeOption(page, mode, label) {
    const targetMode = await page.evaluate((m) => {
        const node = document.querySelector(`[data-vc-settings-sheet] [data-vc-theme-option="${m}"]`);
        if (!node) return { exists: false };
        const rect = node.getBoundingClientRect();
        const cs = getComputedStyle(node);
        const directlyClickable =
            rect.width >= 8 &&
            rect.height >= 8 &&
            cs.visibility !== 'hidden' &&
            cs.display !== 'none' &&
            Number(cs.opacity) > 0.01 &&
            cs.pointerEvents !== 'none';
        const hasParentLabel = Boolean(node.closest('label'));
        return {
            exists: true,
            tagName: node.tagName.toLowerCase(),
            directlyClickable,
            hasParentLabel,
        };
    }, mode);
    assert.equal(targetMode.exists, true, `设置 Sheet 必须存在 [data-vc-theme-option="${mode}"]`);

    if (targetMode.directlyClickable) {
        await page.locator(`[data-vc-settings-sheet] [data-vc-theme-option="${mode}"]`).first().click();
    } else if (targetMode.hasParentLabel) {
        await page
            .locator(`[data-vc-settings-sheet] label:has([data-vc-theme-option="${mode}"])`)
            .first()
            .click();
    } else {
        await page
            .locator('[data-vc-settings-sheet]')
            .getByRole('radio', { name: label })
            .first()
            .click();
    }
    await settleMobilePage(page);
}

async function assertThemeOptionSemanticsAndState(page, expectedMode) {
    const state = await page.evaluate((modes) => {
        const sheet = document.querySelector('[data-vc-settings-sheet]');
        if (!sheet) return { hasSheet: false };
        const group = sheet.querySelector(
            'ion-radio-group, [role="radiogroup"], [data-vc-theme-segment]',
        );
        const options = modes.map((m) => {
            const el = sheet.querySelector(`[data-vc-theme-option="${m}"]`);
            if (!el) return { mode: m, found: false };
            const input =
                el.tagName === 'INPUT'
                    ? el
                    : el.querySelector('input[type="radio"]') ||
                      el.closest('label')?.querySelector('input[type="radio"]');
            const ionRadio =
                el.tagName === 'ION-RADIO'
                    ? el
                    : el.querySelector('ion-radio') || el.closest('ion-radio');
            const roleRadio =
                el.getAttribute('role') === 'radio' ? el : el.closest('[role="radio"]');
            const isRadioControl = Boolean(
                (input && input.getAttribute('type') === 'radio') || ionRadio || roleRadio,
            );
            const checked = Boolean(
                (input && input.checked) ||
                    (ionRadio &&
                        (ionRadio.classList.contains('radio-checked') ||
                            ionRadio.getAttribute('aria-checked') === 'true')) ||
                    (roleRadio && roleRadio.getAttribute('aria-checked') === 'true') ||
                    el.getAttribute('aria-checked') === 'true' ||
                    el.dataset.active === 'true',
            );
            return {
                mode: m,
                found: true,
                tagName: el.tagName.toLowerCase(),
                isRadioControl,
                checked,
                radioName: input?.getAttribute('name') || null,
            };
        });
        return {
            hasSheet: true,
            hasGroup: Boolean(group),
            domTheme: document.documentElement.dataset.vcTheme,
            domDevice: document.documentElement.dataset.vcDevice,
            storedTheme: localStorage.getItem('vc-theme'),
            canvasBg: getComputedStyle(document.documentElement)
                .getPropertyValue('--vc-canvas')
                .trim()
                .toLowerCase(),
            options,
        };
    }, MOBILE_THEME_OPTIONS.map((o) => o.mode));

    assert.equal(state.hasSheet, true, '设置 Sheet 必须在 DOM 中');
    assert.equal(state.hasGroup, true, '主题模式必须包含 radiogroup / IonRadioGroup 容器');
    assert.equal(state.domDevice, 'mobile', '根元素必须保持 data-vc-device="mobile"');
    assert.equal(
        state.domTheme,
        expectedMode,
        `html[data-vc-theme] 应为 ${expectedMode}，实际 ${state.domTheme}`,
    );
    assert.equal(
        state.storedTheme,
        expectedMode,
        `localStorage vc-theme 应为 ${expectedMode}，实际 ${state.storedTheme}`,
    );
    for (const opt of state.options) {
        assert.equal(opt.found, true, `缺少主题项 ${opt.mode}`);
        assert.equal(
            opt.isRadioControl,
            true,
            `主题项 ${opt.mode} 必须使用库 radio 或原生 radio 语义`,
        );
        assert.equal(
            opt.checked,
            opt.mode === expectedMode,
            `主题项 ${opt.mode} 选中态不符（期望 ${opt.mode === expectedMode}，实际 ${opt.checked}）`,
        );
    }
    return state;
}

export async function collectMobileShellGeometry(page, { sheetOpen = false } = {}) {
    return page.evaluate(
        ({ expectSheetOpen, tabKeys }) => {
            const rectOf = (el) => {
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return {
                    x: r.x,
                    y: r.y,
                    left: r.left,
                    top: r.top,
                    right: r.right,
                    bottom: r.bottom,
                    width: r.width,
                    height: r.height,
                    cx: r.left + r.width / 2,
                    cy: r.top + r.height / 2,
                };
            };
            const isReachable = (el) => {
                if (!el) return false;
                const r = el.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) return false;
                const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
                const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
                const hit = document.elementFromPoint(cx, cy);
                return Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el)));
            };
            const parsePx = (val) => {
                const n = Number.parseFloat(String(val || '0'));
                return Number.isFinite(n) ? n : 0;
            };

            const rootCs = getComputedStyle(document.documentElement);
            const safeTop = parsePx(rootCs.getPropertyValue('--ion-safe-area-top'));
            const safeRight = parsePx(rootCs.getPropertyValue('--ion-safe-area-right'));
            const safeBottom = parsePx(rootCs.getPropertyValue('--ion-safe-area-bottom'));
            const safeLeft = parsePx(rootCs.getPropertyValue('--ion-safe-area-left'));

            const appRoot = document.querySelector('[data-vc-mobile-app]');
            const titles = [...document.querySelectorAll('[data-vc-large-title]')].filter((el) => {
                const cs = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
            });
            const activeTitle = titles[0] || null;
            const titleCs = activeTitle ? getComputedStyle(activeTitle) : null;

            const triggers = [...document.querySelectorAll('[data-vc-settings-trigger]')].filter((el) => {
                const cs = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
            });
            const activeTrigger = triggers[0] || null;

            const tabbar = document.querySelector('[data-vc-mobile-tabbar]');
            const tabbarCs = tabbar ? getComputedStyle(tabbar) : null;
            const tabbarHidden =
                !tabbar ||
                tabbar.hidden ||
                tabbar.getAttribute('data-hidden') === 'true' ||
                tabbarCs?.display === 'none' ||
                tabbarCs?.visibility === 'hidden';

            const tabs = tabKeys.map((key) => {
                const btn = document.querySelector(`[data-vc-mobile-tabbar] [data-vc-tab="${key}"]`);
                const labelEl = btn?.querySelector('.vc-mobile-tab-label') || btn;
                const labelCs = labelEl ? getComputedStyle(labelEl) : null;
                return {
                    key,
                    rect: rectOf(btn),
                    reachable: tabbarHidden ? false : isReachable(btn),
                    active: Boolean(
                        btn &&
                            (btn.dataset.active === 'true' ||
                                btn.classList.contains('tab-selected') ||
                                btn.getAttribute('aria-selected') === 'true'),
                    ),
                    fontSize: parsePx(labelCs?.fontSize),
                    clippedX: labelEl ? labelEl.scrollWidth > labelEl.clientWidth + 1 : false,
                };
            });

            let sheetInfo = null;
            if (expectSheetOpen) {
                const sheet = document.querySelector('[data-vc-settings-sheet]');
                const doneBtn = sheet?.querySelector('[data-vc-settings-done]');
                const sheetBody = sheet?.querySelector('.vc-mobile-sheet-body');
                const themeOpts = ['auto', 'light', 'dark'].map((m) => {
                    const el = sheet?.querySelector(`[data-vc-theme-option="${m}"]`);
                    const candidates = [
                        el?.closest('label'),
                        el?.id ? sheet?.querySelector(`label[for="${el.id}"]`) : null,
                        el?.closest('ion-radio'),
                        el?.closest('[role="radio"]'),
                        el,
                    ].filter(Boolean);
                    let hitEl = candidates[0] || null;
                    let bestArea = -1;
                    for (const cand of candidates) {
                        const r = cand.getBoundingClientRect();
                        const area = r.width * r.height;
                        if (area > bestArea) {
                            bestArea = area;
                            hitEl = cand;
                        }
                    }
                    return {
                        mode: m,
                        rect: rectOf(hitEl),
                    };
                });
                sheetInfo = {
                    rect: rectOf(sheet),
                    doneRect: rectOf(doneBtn),
                    doneReachable: isReachable(doneBtn),
                    bodyScrollHeight: sheetBody?.scrollHeight ?? 0,
                    bodyClientHeight: sheetBody?.clientHeight ?? 0,
                    bodyOverflowX: sheetBody ? sheetBody.scrollWidth > sheetBody.clientWidth + 1 : false,
                    themeOpts,
                };
            }

            return {
                viewport: { width: window.innerWidth, height: window.innerHeight },
                safeArea: { top: safeTop, right: safeRight, bottom: safeBottom, left: safeLeft },
                docOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
                appRect: rectOf(appRoot),
                activeTitleCount: titles.length,
                titleRect: rectOf(activeTitle),
                titleFontSize: parsePx(titleCs?.fontSize),
                titleFontWeight: titleCs?.fontWeight || '',
                titleClippedY: activeTitle
                    ? activeTitle.scrollHeight > activeTitle.clientHeight + 2
                    : false,
                triggerCount: triggers.length,
                triggerRect: rectOf(activeTrigger),
                triggerReachable: expectSheetOpen ? true : isReachable(activeTrigger),
                tabbarHidden,
                tabbarRect: tabbarHidden ? null : rectOf(tabbar),
                tabs,
                sheet: sheetInfo,
            };
        },
        { expectSheetOpen: sheetOpen, tabKeys: MOBILE_SHELL_TABS.map((t) => t.key) },
    );
}

export function assertMobileShellGeometry(g, contextLabel) {
    const failures = [];
    const { width, height } = g.viewport;

    if (g.docOverflowX) {
        failures.push(`文档横向溢出 (scrollWidth > ${width})`);
    }
    if (!g.appRect || g.appRect.width > width + 1 || g.appRect.left < -0.5) {
        failures.push(`根容器 [data-vc-mobile-app] 尺寸异常: ${JSON.stringify(g.appRect)}`);
    }

    if (!g.sheet) {
        if (g.activeTitleCount !== 1 || !g.titleRect) {
            failures.push(`活动页大标题数量应为 1，实际 ${g.activeTitleCount}`);
        }
        if (g.triggerCount !== 1 || !g.triggerRect) {
            failures.push(`活动页设置入口按钮数量应为 1，实际 ${g.triggerCount}`);
        }
        if (g.triggerRect) {
            if (g.triggerRect.width < 43.5 || g.triggerRect.height < 43.5) {
                failures.push(
                    `设置头像触控目标小于 44×44: ${g.triggerRect.width.toFixed(1)}×${g.triggerRect.height.toFixed(1)}`,
                );
            }
            if (
                g.triggerRect.left < 0 ||
                g.triggerRect.top < 0 ||
                g.triggerRect.right > width + 1 ||
                g.triggerRect.bottom > height + 1
            ) {
                failures.push(`设置头像越出视口: ${JSON.stringify(g.triggerRect)}`);
            }
            if (!g.triggerReachable) {
                failures.push('设置头像被遮挡不可达 (elementFromPoint 未命中)');
            }
        }
        if (g.titleRect && g.triggerRect) {
            if (g.titleRect.right > g.triggerRect.left + 1) {
                failures.push(
                    `大标题与右侧头像重叠: title.right=${g.titleRect.right.toFixed(1)} > trigger.left=${g.triggerRect.left.toFixed(1)}`,
                );
            }
            if (g.titleRect.left < 0) {
                failures.push(`大标题左侧裁切: left=${g.titleRect.left.toFixed(1)}`);
            }
            if (g.titleClippedY) {
                failures.push('大标题纵向发生内部裁切');
            }
        }

        if (g.tabbarHidden || !g.tabbarRect) {
            failures.push('一级页面未打开 Sheet 时标签栏必须可见');
        } else {
            const tb = g.tabbarRect;
            const expectedLeft = 16 + g.safeArea.left;
            const expectedRightGap = 16 + g.safeArea.right;
            const expectedBottomGap = 8 + g.safeArea.bottom;
            if (Math.abs(tb.height - 64) > 1.5) {
                failures.push(`标签栏高度应为 64px，实际 ${tb.height.toFixed(2)}px`);
            }
            if (Math.abs(tb.left - expectedLeft) > 1.5) {
                failures.push(
                    `标签栏左边距应为 ${expectedLeft}px，实际 ${tb.left.toFixed(2)}px`,
                );
            }
            if (Math.abs(width - tb.right - expectedRightGap) > 1.5) {
                failures.push(
                    `标签栏右边距应为 ${expectedRightGap}px，实际 ${(width - tb.right).toFixed(2)}px`,
                );
            }
            if (Math.abs(height - tb.bottom - expectedBottomGap) > 1.5) {
                failures.push(
                    `标签栏底距应为 ${expectedBottomGap}px，实际 ${(height - tb.bottom).toFixed(2)}px`,
                );
            }
            for (let i = 0; i < g.tabs.length; i += 1) {
                const t = g.tabs[i];
                if (!t.rect) {
                    failures.push(`标签项 ${t.key} 缺失`);
                    continue;
                }
                if (t.rect.width < 43.5 || t.rect.height < 43.5) {
                    failures.push(
                        `标签项 ${t.key} 触控尺寸小于 44×44: ${t.rect.width.toFixed(1)}×${t.rect.height.toFixed(1)}`,
                    );
                }
                if (!t.reachable) {
                    failures.push(`标签项 ${t.key} 被遮挡不可达`);
                }
                if (i > 0 && g.tabs[i - 1].rect && t.rect.left < g.tabs[i - 1].rect.right - 1) {
                    failures.push(`标签项 ${g.tabs[i - 1].key} 与 ${t.key} 横向重叠`);
                }
            }
        }
    } else {
        const s = g.sheet;
        if (!s.rect || s.rect.width < 100 || s.rect.height < 100) {
            failures.push(`设置 Sheet 几何尺寸异常: ${JSON.stringify(s.rect)}`);
        } else if (
            s.rect.left < -1 ||
            s.rect.right > width + 1 ||
            s.rect.bottom > height + 1 ||
            s.rect.top < -1
        ) {
            failures.push(`设置 Sheet 越出视口边界: ${JSON.stringify(s.rect)}`);
        }
        if (!s.doneRect || s.doneRect.width < 43.5 || s.doneRect.height < 43.5) {
            failures.push(`设置 Sheet 完成按钮触控小于 44×44: ${JSON.stringify(s.doneRect)}`);
        }
        if (!s.doneReachable) {
            failures.push('设置 Sheet 完成按钮被遮挡或不可点击');
        }
        if (s.bodyOverflowX) {
            failures.push('设置 Sheet 内容区发生横向溢出');
        }
        for (let i = 0; i < s.themeOpts.length; i += 1) {
            const opt = s.themeOpts[i];
            if (!opt.rect || opt.rect.width < 43.5 || opt.rect.height < 43.5) {
                failures.push(
                    `主题选项 ${opt.mode} 触控尺寸小于 44×44: ${JSON.stringify(opt.rect)}`,
                );
            }
            if (
                i > 0 &&
                s.themeOpts[i - 1].rect &&
                opt.rect &&
                opt.rect.left < s.themeOpts[i - 1].rect.right - 1
            ) {
                failures.push(`主题选项 ${s.themeOpts[i - 1].mode} 与 ${opt.mode} 重叠`);
            }
        }
    }

    assert.deepEqual(failures, [], `${contextLabel} 几何断言失败: ${failures.join('；')}`);
}

function percentileNearestRank(sortedValues, p) {
    if (!sortedValues.length) return 0;
    const idx = Math.min(
        sortedValues.length - 1,
        Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1),
    );
    return Number(sortedValues[idx].toFixed(2));
}

/**
 * 4× CPU 壳层切换与设置 Sheet 开关交互采样（仅在显式开启 VC_MB2_SHELL_PERF=1 时由主代理单独执行）。
 * 严禁关闭动画、关闭极光背景或放宽 longtask > 50ms 门槛。
 * 真实导航到 /m/chat 新文档就绪后，按 cold-document-first-transition 与 warm-repeat 两阶段采样交互。
 */
export async function measureMb2ShellPerf(page, { artifactDir } = {}) {
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await page.context().newCDPSession(page);
    try {
        await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
        await cdp.send('Emulation.setEmulatedMedia', {
            features: [
                { name: 'prefers-reduced-motion', value: 'no-preference' },
                { name: 'prefers-reduced-transparency', value: 'no-preference' },
            ],
        });
        await page.evaluate(() => {
            localStorage.removeItem('vc-reduced-motion');
        });

        const currentUrl = page.url();
        const targetOrigin =
            currentUrl && currentUrl.startsWith('http')
                ? new URL(currentUrl).origin
                : new URL(resolveStBase()).origin;
        await page.goto(`${targetOrigin}/m/chat`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
            () =>
                document.documentElement.dataset.vcApp === 'ready' &&
                document.documentElement.dataset.vcDevice === 'mobile' &&
                Boolean(document.querySelector('[data-vc-mobile-app]')),
        );
        await settleMobilePage(page);

        const precheck = await page.evaluate(() => ({
            pathname: window.location.pathname,
            normalMotion: window.matchMedia('(prefers-reduced-motion: no-preference)').matches,
            normalTransparency: window.matchMedia('(prefers-reduced-transparency: no-preference)').matches,
            auroraPresent: Boolean(document.querySelector('.vc-aurora')),
            lowPerfAttr: document.documentElement.getAttribute('data-vc-low-perf'),
        }));
        assert.equal(precheck.pathname, '/m/chat', '4× CPU 采样必须从 /m/chat 新文档开始');
        assert.equal(precheck.normalMotion, true, '4× CPU 采样必须在 Normal-motion 下执行');
        assert.equal(precheck.normalTransparency, true, '4× CPU 采样不得启用 reduced-transparency 降级');
        assert.equal(precheck.auroraPresent, true, '4× CPU 采样必须保留真实极光背景');
        assert.notEqual(precheck.lowPerfAttr, 'true', '4× CPU 采样不得挂 data-vc-low-perf 降级属性');

        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

        const summarizeSamples = (deltas, longtasks) => {
            const sorted = [...deltas].sort((a, b) => a - b);
            const totalFrameMs = deltas.reduce((acc, v) => acc + v, 0);
            const over50Longtasks = longtasks.filter((lt) => lt.duration > 50);
            const maxLongtaskMs = longtasks.reduce((m, lt) => Math.max(m, lt.duration), 0);
            return {
                frameCount: deltas.length,
                rafP50Ms: percentileNearestRank(sorted, 50),
                rafP95Ms: percentileNearestRank(sorted, 95),
                rafMaxMs: sorted.length ? Number(sorted[sorted.length - 1].toFixed(2)) : 0,
                over16_7msCount: deltas.filter((d) => d > 16.7).length,
                over33_3msCount: deltas.filter((d) => d > 33.3).length,
                approxFps: totalFrameMs > 0 ? Number(((deltas.length * 1000) / totalFrameMs).toFixed(2)) : 0,
                longtaskOver50msCount: over50Longtasks.length,
                maxLongtaskMs: Number(maxLongtaskMs.toFixed(2)),
                longtasks,
            };
        };

        const startWindow = async (phase, windowLabel, operation) => {
            await page.evaluate(
                ({ phaseName, label, op }) => {
                    const state = {
                        phase: phaseName,
                        windowLabel: label,
                        operation: op,
                        startedAtPerfNow: performance.now(),
                        endedAtPerfNow: 0,
                        deltas: [],
                        longtasks: [],
                        running: true,
                        rafId: 0,
                        observer: null,
                    };
                    if (typeof PerformanceObserver !== 'undefined') {
                        try {
                            const obs = new PerformanceObserver((list) => {
                                if (!state.running) return;
                                for (const entry of list.getEntries()) {
                                    state.longtasks.push({
                                        name: entry.name || 'longtask',
                                        startTime: Number(entry.startTime.toFixed(2)),
                                        duration: Number(entry.duration.toFixed(2)),
                                    });
                                }
                            });
                            obs.observe({ type: 'longtask', buffered: false });
                            state.observer = obs;
                        } catch {
                            // 浏览器不支持 longtask observer 时后续做校验
                        }
                    }
                    let prev = performance.now();
                    const tick = (now) => {
                        if (!state.running) return;
                        const dt = now - prev;
                        prev = now;
                        if (dt > 0) state.deltas.push(dt);
                        state.rafId = requestAnimationFrame(tick);
                    };
                    state.rafId = requestAnimationFrame(tick);
                    window.__vcMb2PerfWindow = state;
                },
                { phaseName: phase, label: windowLabel, op: operation },
            );
        };

        const stopWindow = async () => {
            const raw = await page.evaluate(() => {
                const state = window.__vcMb2PerfWindow;
                if (!state) return null;
                state.running = false;
                state.endedAtPerfNow = performance.now();
                if (state.rafId) cancelAnimationFrame(state.rafId);
                if (state.observer) {
                    const rest = state.observer.takeRecords?.() || [];
                    for (const entry of rest) {
                        state.longtasks.push({
                            name: entry.name || 'longtask',
                            startTime: Number(entry.startTime.toFixed(2)),
                            duration: Number(entry.duration.toFixed(2)),
                        });
                    }
                    state.observer.disconnect();
                }
                delete window.__vcMb2PerfWindow;
                return {
                    phase: state.phase,
                    windowLabel: state.windowLabel,
                    operation: state.operation,
                    startedAtPerfNow: Number(state.startedAtPerfNow.toFixed(2)),
                    endedAtPerfNow: Number(state.endedAtPerfNow.toFixed(2)),
                    durationMs: Number((state.endedAtPerfNow - state.startedAtPerfNow).toFixed(2)),
                    deltas: state.deltas,
                    longtasks: state.longtasks,
                };
            });
            assert.ok(raw && raw.deltas.length > 0, `采样窗口未采集到有效 rAF 帧: ${raw?.windowLabel}`);
            return {
                rawDeltas: raw.deltas,
                windowReport: {
                    phase: raw.phase,
                    windowLabel: raw.windowLabel,
                    operation: raw.operation,
                    startedAtPerfNow: raw.startedAtPerfNow,
                    endedAtPerfNow: raw.endedAtPerfNow,
                    durationMs: raw.durationMs,
                    ...summarizeSamples(raw.deltas, raw.longtasks),
                },
            };
        };

        const sampleInteractionPhase = async (phase) => {
            // 窗口 1：真实点击切换五个一级标签往返
            await startWindow(
                phase,
                `${phase}:mb2-shell-tab-switch`,
                `[${phase}] 真实点击切换五个一级标签 (chat → characters → memory → inbox → story → chat)`,
            );
            for (const tab of [...MOBILE_SHELL_TABS.slice(1), MOBILE_SHELL_TABS[0]]) {
                await page.locator(`[data-vc-mobile-tabbar] [data-vc-tab="${tab.key}"]`).click();
                await page.waitForFunction(
                    ({ expectedPath, expectedLabel }) => {
                        if (window.location.pathname !== expectedPath) return false;
                        const h1 = document.querySelector('[data-vc-large-title]');
                        return Boolean(h1 && h1.textContent?.trim() === expectedLabel);
                    },
                    { expectedPath: tab.path, expectedLabel: tab.label },
                );
                await settleMobilePage(page);
            }
            const tabSwitchRes = await stopWindow();

            // 窗口 2：真实点击打开设置大 Sheet、切换浅/深主题并点击完成关闭
            await startWindow(
                phase,
                `${phase}:mb2-shell-settings-sheet`,
                `[${phase}] 真实点击右上头像打开设置 IonModal Sheet、切换深/浅色单选项并点击完成关闭`,
            );
            await page.locator('[data-vc-settings-trigger]').first().click();
            await waitForSettingsSheetState(page, true);
            await clickThemeOption(page, 'dark', '深色');
            await clickThemeOption(page, 'light', '浅色');
            await closeSettingsSheetAndWaitDidDismiss(page, () =>
                page.locator('[data-vc-settings-sheet] [data-vc-settings-done]').first().click(),
            );
            const sheetRes = await stopWindow();

            const phaseDeltas = [...tabSwitchRes.rawDeltas, ...sheetRes.rawDeltas];
            const phaseLongtasks = [
                ...tabSwitchRes.windowReport.longtasks,
                ...sheetRes.windowReport.longtasks,
            ];
            const phaseWindows = [tabSwitchRes.windowReport, sheetRes.windowReport];
            return {
                phase,
                ...summarizeSamples(phaseDeltas, phaseLongtasks),
                windows: phaseWindows,
            };
        };

        const coldPhase = await sampleInteractionPhase('cold-document-first-transition');
        const warmPhase = await sampleInteractionPhase('warm-repeat');

        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

        const phases = [coldPhase, warmPhase];
        const windows = phases.flatMap((p) => p.windows);
        const perfReport = {
            surface: 'mb2-shell-4x-cpu',
            scope: 'mobile-shell-interaction-only（仅测量 /m/chat 新文档就绪后的壳层标签切换与设置 Sheet 开关交互，不宣称覆盖冷首屏加载、聊天历史或消息滚动）',
            cpuThrottlingRate: 4,
            motionMode: 'no-preference',
            viewport: '390x844@2',
            phases,
            windows,
            notRunBoundaries: {
                coldFirstScreen: 'NOT_RUN（本采样在新文档 data-vc-app="ready" 且字体/初始动画静止后开始，仅测壳层交互，不宣称覆盖冷首屏加载）',
                chatHistory: 'NOT_RUN（真实聊天历史加载属于 MB2-6 接入后验收，本轮仅壳层交互）',
                messageScroll: 'NOT_RUN（真实消息滚动属于 MB2-6 对话虚拟列表接入后验收，本轮仅壳层交互）',
                conversationListScroll: 'NOT_RUN（真实会话列表滚动属于 MB2-6 接入后验收，本轮仅壳层交互）',
                engineRuntimeHeap: 'NOT_RUN（本批首屏不启动引擎，净堆预算属于 MB2-6 / MB2-15）',
            },
        };

        if (artifactDir) {
            const perfPath = path.join(artifactDir, 'mb2-shell-perf.json');
            fs.writeFileSync(perfPath, JSON.stringify(perfReport, null, 2) + '\n', { mode: 0o600 });
        }

        for (const phaseReport of phases) {
            const failedPhaseWindows = phaseReport.windows.filter((w) => w.longtaskOver50msCount > 0);
            assert.equal(
                phaseReport.longtaskOver50msCount,
                0,
                `4× CPU 阶段 ${phaseReport.phase} 壳层交互存在 >50ms 长任务: ${JSON.stringify(failedPhaseWindows)}`,
            );
        }

        return perfReport;
    } finally {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
        await cdp.detach().catch(() => {});
    }
}

/**
 * 场景 1：mb2-shell
 * - 真实受管登录访问 /m/，验证首屏不启动引擎/不请求完整 ST 宿主或模型生成
 * - 五个一级标签（chat/characters/memory/inbox/story）真实点击切换、URL、唯一活动页 [data-vc-large-title]、选中态、剧情极光场景
 * - 真实浏览器 page.goBack / page.goForward 验证标签历史与设置 Sheet 同 URL location.state 历史往返（无合成 popstate）
 * - 设置 Sheet 主题单选（浅色 / 深色 / 跟随系统）真实点击、DOM data-vc-theme 与 localStorage vc-theme 同步、完成关闭
 * - 390×844 与 1440×900 浅/深色代表性壳层与设置截图输出到 ctx.artifactsDir（mb2-shell-*.png）
 */
export async function sceneMb2Shell(ctx) {
    await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    const artifactDir = resolveArtifactDir(ctx);
    const stBase = resolveStBase(ctx);
    const origin = new URL(stBase).origin;

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH
            ? { executablePath: process.env.VC_W03_CHROMIUM_PATH }
            : {}),
    });

    try {
        const context = await createMobileBrowserContext(browser, ctx);
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        const pageErrors = trackPageErrors(page);

        const mainFramePaths = [];
        const forbiddenRequests = [];
        const modelRequests = [];

        page.on('request', (req) => {
            const u = new URL(req.url());
            if (u.origin !== origin) return;
            const p = u.pathname;
            if (req.frame() === page.mainFrame()) {
                mainFramePaths.push(p);
            }
            if (
                p.endsWith('/generate') ||
                p.endsWith('/v1/chat/completions') ||
                p.endsWith('/v1/responses') ||
                p.endsWith('/v1/messages')
            ) {
                modelRequests.push(p);
            }
            if (
                ['/script.js', '/scripts/extensions.js', '/scripts/st-context.js', '/native/'].includes(p) ||
                p.endsWith('/desktop/standalone/runtime.js') ||
                /^\/(?:m|desktop)\/assets\/runtime-[A-Za-z0-9_-]+\.js$/.test(p) ||
                /\/(?:JS-Slash-Runner|ST-Prompt-Template)\/dist\//.test(p)
            ) {
                forbiddenRequests.push(p);
            }
        });

        await page.goto(`${stBase}/m/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
            () =>
                document.documentElement.dataset.vcApp === 'ready' &&
                document.documentElement.dataset.vcDevice === 'mobile' &&
                Boolean(document.querySelector('[data-vc-mobile-app]')),
        );
        await settleMobilePage(page);

        // 1. 首屏空闲与宿主隔离验证（不写任何 debug window 全局）
        const initialRuntimeState = await page.evaluate(() => ({
            pathname: window.location.pathname,
            vcDevice: document.documentElement.dataset.vcDevice,
            vcApp: document.documentElement.dataset.vcApp,
            vcRuntime: document.documentElement.dataset.vcRuntime ?? null,
            vcEngine: document.documentElement.dataset.vcEngine ?? null,
            engineIframes: document.querySelectorAll('iframe#vc-engine, iframe[src*="/native"]').length,
            hasAccountMeta: Boolean(
                document.querySelector('meta[name="vc-account-id"]')?.getAttribute('content'),
            ),
            hasSessionMeta: Boolean(
                document.querySelector('meta[name="vc-session-id"]')?.getAttribute('content'),
            ),
        }));
        assert.equal(initialRuntimeState.pathname, '/m/chat', '/m/ 默认路由应归一化到 /m/chat');
        assert.equal(initialRuntimeState.vcDevice, 'mobile', 'html 必须带 data-vc-device="mobile"');
        assert.equal(initialRuntimeState.vcApp, 'ready', 'html 必须进入 data-vc-app="ready"');
        assert.equal(initialRuntimeState.vcRuntime, null, '首屏不得自动准备独立聊天引擎');
        assert.equal(initialRuntimeState.vcEngine, null, '首屏不得挂载旧隐藏 ST 引擎标记');
        assert.equal(initialRuntimeState.engineIframes, 0, '首屏不得存在隐藏 ST iframe');
        assert.equal(initialRuntimeState.hasAccountMeta, true, '/m/ 入口必须注入同源 vc-account-id meta');
        assert.equal(initialRuntimeState.hasSessionMeta, true, '/m/ 入口必须注入同源 vc-session-id meta');
        assert.deepEqual(forbiddenRequests, [], '首屏不得请求完整 ST 宿主或提前加载引擎运行模块');
        assert.deepEqual(modelRequests, [], '壳层导航不得发起模型生成请求');

        // 2. 五个一级标签真实点击、URL、活动页唯一大标题与选中态
        for (const tab of MOBILE_SHELL_TABS) {
            await page.locator(`[data-vc-mobile-tabbar] [data-vc-tab="${tab.key}"]`).click();
            await page.waitForFunction(
                ({ expectedPath, expectedLabel }) => {
                    const h1s = [...document.querySelectorAll('[data-vc-large-title]')];
                    return (
                        window.location.pathname === expectedPath &&
                        h1s.length === 1 &&
                        h1s[0].textContent?.trim() === expectedLabel
                    );
                },
                { expectedPath: tab.path, expectedLabel: tab.label },
            );
            await settleMobilePage(page);

            const tabSnap = await page.evaluate((activeKey) => {
                const app = document.querySelector('[data-vc-mobile-app]');
                const titles = [...document.querySelectorAll('[data-vc-large-title]')];
                const activeTabs = [...document.querySelectorAll('[data-vc-mobile-tabbar] [data-vc-tab]')]
                    .filter(
                        (el) =>
                            el.dataset.active === 'true' ||
                            el.classList.contains('tab-selected') ||
                            el.getAttribute('aria-selected') === 'true',
                    )
                    .map((el) => el.getAttribute('data-vc-tab'));
                return {
                    pathname: window.location.pathname,
                    scene: app?.getAttribute('data-vc-mobile-scene'),
                    titleCount: titles.length,
                    titleText: titles[0]?.textContent?.trim() || '',
                    activeTabs,
                };
            }, tab.key);

            assert.equal(tabSnap.pathname, tab.path);
            assert.equal(tabSnap.titleCount, 1, `${tab.key} 页必须且仅有一个活动 [data-vc-large-title]`);
            assert.equal(tabSnap.titleText, tab.label);
            assert.deepEqual(tabSnap.activeTabs, [tab.key], `${tab.key} 页必须仅选中当前标签`);
            assert.equal(
                tabSnap.scene,
                tab.key === 'story' ? 'story' : 'default',
                `${tab.key} 页极光场景属性不符`,
            );
        }

        // 3. 一级标签真实浏览器 Back / Forward 历史核验
        await page.goBack();
        await page.waitForFunction(() => window.location.pathname === '/m/inbox');
        await settleMobilePage(page);
        assert.equal(
            (await page.locator('[data-vc-large-title]').textContent())?.trim(),
            '陪伴',
            'page.goBack() 应回到 /m/inbox 且活动标题为陪伴',
        );

        await page.goForward();
        await page.waitForFunction(() => window.location.pathname === '/m/story');
        await settleMobilePage(page);
        assert.equal(
            (await page.locator('[data-vc-large-title]').textContent())?.trim(),
            '剧情',
            'page.goForward() 应前进回 /m/story 且活动标题为剧情',
        );

        await page.locator('[data-vc-mobile-tabbar] [data-vc-tab="chat"]').click();
        await page.waitForFunction(() => window.location.pathname === '/m/chat');
        await settleMobilePage(page);

        // 4. 点击右上头像打开设置 IonModal Sheet + 主题浅/深/自动单选 + 完成关闭 + 真实 Back/Forward
        await page.locator('[data-vc-settings-trigger]').first().click();
        await waitForSettingsSheetState(page, true);

        const sheetInitial = await page.evaluate(() => {
            const rawState = window.history.state;
            const usrState =
                rawState && typeof rawState === 'object' && 'usr' in rawState
                    ? rawState.usr
                    : rawState;
            const tabbar = document.querySelector('[data-vc-mobile-tabbar]');
            const tabbarHidden =
                !tabbar ||
                tabbar.hidden ||
                tabbar.getAttribute('data-hidden') === 'true' ||
                getComputedStyle(tabbar).display === 'none';
            const disabledRows = [
                ...document.querySelectorAll(
                    '[data-vc-settings-sheet] [data-vc-settings-item], [data-vc-settings-sheet] [data-vc-tavern-item]',
                ),
            ].every((btn) => btn.disabled || btn.getAttribute('aria-disabled') === 'true');
            return {
                pathname: window.location.pathname,
                hasSettingsStateEntry: Boolean(
                    usrState?.settingsOpen || rawState?.settingsOpen || rawState?.vcMobileSettingsModal,
                ),
                tabbarHidden,
                disabledRows,
            };
        });
        assert.equal(sheetInitial.pathname, '/m/chat', '打开设置 Sheet 应保持当前同 URL /m/chat');
        assert.equal(
            sheetInitial.hasSettingsStateEntry,
            true,
            '打开设置 Sheet 必须在当前 URL 写入真实 history state entry',
        );
        assert.equal(sheetInitial.tabbarHidden, true, '设置 Sheet 打开期间底部标签栏必须隐藏');
        assert.equal(
            sheetInitial.disabledRows,
            true,
            '未实现子页的设置项在无业务消费者时必须保持 disabled，不伪造占位页',
        );

        // 主题切换：light -> dark -> auto（验证真实 radio 选中态、html[data-vc-theme] 与 localStorage）
        await clickThemeOption(page, 'light', '浅色');
        const lightState = await assertThemeOptionSemanticsAndState(page, 'light');
        assert.equal(lightState.canvasBg, '#eef0f6', '浅色模式 --vc-canvas 应为 #eef0f6');

        await clickThemeOption(page, 'dark', '深色');
        const darkState = await assertThemeOptionSemanticsAndState(page, 'dark');
        assert.equal(darkState.canvasBg, '#07070a', '深色模式 --vc-canvas 应为 #07070a');

        await page.emulateMedia({ colorScheme: 'dark' });
        await clickThemeOption(page, 'auto', '跟随系统');
        const autoDarkState = await assertThemeOptionSemanticsAndState(page, 'auto');
        assert.equal(
            autoDarkState.canvasBg,
            '#07070a',
            '跟随系统在 prefers-color-scheme: dark 下应解析为深色 canvas',
        );

        await page.emulateMedia({ colorScheme: 'light' });
        await settleMobilePage(page);
        const autoLightState = await assertThemeOptionSemanticsAndState(page, 'auto');
        assert.equal(
            autoLightState.canvasBg,
            '#eef0f6',
            '跟随系统在 prefers-color-scheme: light 下应解析为浅色 canvas',
        );

        // 点击「完成」关闭设置 Sheet
        await closeSettingsSheetAndWaitDidDismiss(page, () =>
            page.locator('[data-vc-settings-sheet] [data-vc-settings-done]').first().click(),
        );
        assert.equal(new URL(page.url()).pathname, '/m/chat', '点击完成关闭后应停留在 /m/chat');

        // 真实 page.goBack() / page.goForward() 核对设置 Sheet 历史（不派发合成 popstate）
        await page.locator('[data-vc-settings-trigger]').first().click();
        await waitForSettingsSheetState(page, true);

        await closeSettingsSheetAndWaitDidDismiss(page, () => page.goBack());
        assert.equal(new URL(page.url()).pathname, '/m/chat', '设置 Sheet 经 page.goBack() 关闭后路径保持 /m/chat');
        assert.equal(
            (await page.locator('[data-vc-large-title]').textContent())?.trim(),
            '聊天',
            'page.goBack() 关闭设置 Sheet 后活动页仍为聊天',
        );

        await page.goForward();
        await waitForSettingsSheetState(page, true);
        assert.equal(new URL(page.url()).pathname, '/m/chat', 'page.goForward() 应重新打开同 URL 设置 Sheet');

        await closeSettingsSheetAndWaitDidDismiss(page, () => page.goBack());

        // 5. 生成 390 与 1440 浅/深代表性截图（chat 壳与 settings Sheet）
        const writtenFiles = [];
        for (const vp of REPRESENTATIVE_SHOT_VIEWPORTS) {
            await page.setViewportSize(vp);
            for (const scheme of ['light', 'dark']) {
                await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
                await page.locator('[data-vc-settings-trigger]').first().click();
                await waitForSettingsSheetState(page, true);
                await clickThemeOption(page, scheme, scheme === 'light' ? '浅色' : '深色');
                await assertThemeOptionSemanticsAndState(page, scheme);

                const settingsShotName = `mb2-shell-settings-${vp.width}-${scheme}.png`;
                const settingsShotPath = path.join(artifactDir, settingsShotName);
                await page.screenshot({ path: settingsShotPath });
                writtenFiles.push(settingsShotName);
                ctx?.screenshots?.push(settingsShotPath);

                await closeSettingsSheetAndWaitDidDismiss(page, () =>
                    page.locator('[data-vc-settings-sheet] [data-vc-settings-done]').first().click(),
                );

                const chatShotName = `mb2-shell-chat-${vp.width}-${scheme}.png`;
                const chatShotPath = path.join(artifactDir, chatShotName);
                await page.screenshot({ path: chatShotPath });
                writtenFiles.push(chatShotName);
                ctx?.screenshots?.push(chatShotPath);
            }
        }

        // 恢复默认 390×844 浅色
        await page.setViewportSize({ width: 390, height: 844 });
        await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
        await settleMobilePage(page);

        // 6. 可选 4× CPU 性能采样（仅 VC_MB2_SHELL_PERF=1 开启）
        let perfResult = {
            status: 'NOT_RUN',
            reason: '未设置 VC_MB2_SHELL_PERF=1；4× CPU 壳层切换采样由主代理在无并行负载时单独开启执行',
        };
        if (process.env.VC_MB2_SHELL_PERF === '1' || ctx?.mb2ShellPerf === true) {
            perfResult = await measureMb2ShellPerf(page, { artifactDir });
        }

        assert.deepEqual(forbiddenRequests, [], '全程不得请求完整 ST 宿主或提前加载引擎运行模块');
        assert.deepEqual(modelRequests, [], '全程不得触发模型生成');
        pageErrors.assertNone();

        const summary = {
            scene: 'mb2-shell',
            entry: '/m/chat',
            tabsVerified: MOBILE_SHELL_TABS.map((t) => t.path),
            historyVerified: ['tabs-back-forward', 'settings-sheet-location-state-back-forward', 'settings-done-close'],
            themeVerified: ['light', 'dark', 'auto-dark', 'auto-light'],
            initialIdle: initialRuntimeState,
            screenshots: writtenFiles,
            perf: perfResult,
            notRunBoundaries: {
                secondaryBusinessRoutes:
                    'NOT_RUN（二级页面当前无真实业务消费者，仅在组件测试经公开 route slots 验证；受管不伪造假路由或假业务页）',
                messageAndListScrollPerf:
                    'NOT_RUN（真实会话列表与消息列表滚动属于 MB2-6 接入后验收）',
            },
        };
        const reportName = 'mb2-shell-report.json';
        fs.writeFileSync(path.join(artifactDir, reportName), JSON.stringify(summary, null, 2) + '\n', {
            mode: 0o600,
        });
        writtenFiles.push(reportName);
        return summary;
    } finally {
        await browser.close();
    }
}

/**
 * 场景 2：mb2-layout
 * - 全设备视口矩阵：320×568、360×780、390×844、393×852、412×915、430×932 竖屏与横屏
 * - 673×841、768×1024 竖屏与横屏仅测同一手机壳不溢出（明确不外推未选图的 foldable 双栏）
 * - 浅色 / 深色、1.3× 字体缩放（基于用户真实字体基础 scale：--fontScale=1.3 + Chromium Page.setFontSizes，不注入改变布局的 CSS）、reduced-motion 与 reduced-transparency
 * - 几何断言：无横向溢出、触控 ≥44×44、标签栏高 64 / 左右 16+safe / 底 8+safe、内部不裁切、短横屏设置 Sheet 可滚动且关闭按钮可达
 */
export async function sceneMb2Layout(ctx) {
    await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    const artifactDir = resolveArtifactDir(ctx);
    const stBase = resolveStBase(ctx);

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH
            ? { executablePath: process.env.VC_W03_CHROMIUM_PATH }
            : {}),
    });

    try {
        const context = await createMobileBrowserContext(browser, ctx);
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        const pageErrors = trackPageErrors(page);
        const cdp = await context.newCDPSession(page);

        await page.goto(`${stBase}/m/chat`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
            () =>
                document.documentElement.dataset.vcApp === 'ready' &&
                document.documentElement.dataset.vcDevice === 'mobile' &&
                Boolean(document.querySelector('[data-vc-mobile-app]')),
        );
        await settleMobilePage(page);

        const allBaseViewports = [...PHONE_PORTRAIT_VIEWPORTS, ...FOLDABLE_PHONE_SHELL_VIEWPORTS];
        const expandedViewports = [];
        for (const vp of allBaseViewports) {
            expandedViewports.push({
                width: vp.width,
                height: vp.height,
                orientation: 'portrait',
                category: vp.category,
            });
            expandedViewports.push({
                width: vp.height,
                height: vp.width,
                orientation: 'landscape',
                category: vp.category,
            });
        }

        const checkedMatrix = [];

        // 1. 全视口 × 竖横屏 × 浅/深色 几何与短横屏 Sheet 滚动/关闭可达性核验
        for (const theme of ['light', 'dark']) {
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            await page.locator('[data-vc-settings-trigger]').first().click();
            await waitForSettingsSheetState(page, true);
            await clickThemeOption(page, theme, theme === 'light' ? '浅色' : '深色');
            await assertThemeOptionSemanticsAndState(page, theme);
            await closeSettingsSheetAndWaitDidDismiss(page, () =>
                page.locator('[data-vc-settings-sheet] [data-vc-settings-done]').first().click(),
            );

            for (const vp of expandedViewports) {
                await page.setViewportSize({ width: vp.width, height: vp.height });
                await settleMobilePage(page);

                const shellGeo = await collectMobileShellGeometry(page, { sheetOpen: false });
                assertMobileShellGeometry(
                    shellGeo,
                    `[${vp.category} ${vp.orientation} ${vp.width}×${vp.height} ${theme} shell]`,
                );

                // 在所有横屏及代表性竖屏（320×568、390×844、673×841）打开设置 Sheet 校验短横屏滚动与关闭可达
                if (vp.orientation === 'landscape' || [320, 390, 673].includes(vp.width)) {
                    await page.locator('[data-vc-settings-trigger]').first().click();
                    await waitForSettingsSheetState(page, true);

                    const sheetGeo = await collectMobileShellGeometry(page, { sheetOpen: true });
                    assertMobileShellGeometry(
                        sheetGeo,
                        `[${vp.category} ${vp.orientation} ${vp.width}×${vp.height} ${theme} settings-sheet]`,
                    );

                    // 短横屏（高度 <= 430）验证 Sheet 内容区实际可纵向滚动到底且头部「完成」仍可达
                    if (vp.height <= 430) {
                        const scrollCheck = await page.evaluate(() => {
                            const body = document.querySelector('[data-vc-settings-sheet] .vc-mobile-sheet-body');
                            if (!body) return { hasBody: false };
                            const scrollable = body.scrollHeight > body.clientHeight;
                            const beforeTop = body.scrollTop;
                            body.scrollTop = body.scrollHeight;
                            const afterTop = body.scrollTop;
                            const rows = body.querySelectorAll('.vc-mobile-settings-row');
                            const lastRow = rows[rows.length - 1] || null;
                            const lastRowRect = lastRow?.getBoundingClientRect();
                            const bodyRect = body.getBoundingClientRect();
                            const lastRowVisible = Boolean(
                                lastRowRect &&
                                    lastRowRect.bottom <= bodyRect.bottom + 2 &&
                                    lastRowRect.top >= bodyRect.top - 2,
                            );
                            body.scrollTop = beforeTop;
                            return {
                                hasBody: true,
                                scrollable,
                                scrolledDelta: afterTop - beforeTop,
                                lastRowVisible,
                            };
                        });
                        assert.equal(scrollCheck.hasBody, true);
                        assert.equal(
                            scrollCheck.scrollable && scrollCheck.scrolledDelta > 0,
                            true,
                            `${vp.width}×${vp.height} 短横屏下设置 Sheet 内容区必须可滚动 (${JSON.stringify(scrollCheck)})`,
                        );
                        assert.equal(
                            scrollCheck.lastRowVisible,
                            true,
                            `${vp.width}×${vp.height} 短横屏滚动到底后末行设置项必须进入可视区`,
                        );
                    }

                    await closeSettingsSheetAndWaitDidDismiss(page, () =>
                        page.locator('[data-vc-settings-sheet] [data-vc-settings-done]').first().click(),
                    );
                }

                checkedMatrix.push({
                    width: vp.width,
                    height: vp.height,
                    orientation: vp.orientation,
                    category: vp.category,
                    theme,
                    fontScale: 1,
                });
            }
        }

        // 2. 1.3× 字体缩放核验（使用用户真实字体基础 scale：--fontScale=1.3 与 Chromium Page.setFontSizes，不注入改变布局的 CSS）
        const fontScaleViewports = [
            { width: 320, height: 568, orientation: 'portrait' },
            { width: 568, height: 320, orientation: 'landscape' },
            { width: 390, height: 844, orientation: 'portrait' },
            { width: 844, height: 390, orientation: 'landscape' },
            { width: 430, height: 932, orientation: 'portrait' },
        ];
        await cdp.send('Page.enable');
        await cdp.send('Page.setFontSizes', {
            fontSizes: {
                standard: Math.round(16 * 1.3),
                fixed: Math.round(13 * 1.3),
            },
        });
        await page.evaluate(() => {
            document.documentElement.style.setProperty('--fontScale', '1.3');
        });
        await settleMobilePage(page);

        for (const vp of fontScaleViewports) {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await settleMobilePage(page);

            const scaledGeo = await collectMobileShellGeometry(page, { sheetOpen: false });
            assertMobileShellGeometry(
                scaledGeo,
                `[fontScale=1.3 ${vp.orientation} ${vp.width}×${vp.height} shell]`,
            );
            assert.ok(
                Math.abs(scaledGeo.titleFontSize - 34 * 1.3) <= 1,
                `1.3× 字体缩放下大标题字号应约为 ${(34 * 1.3).toFixed(1)}px，实际 ${scaledGeo.titleFontSize}px`,
            );

            await page.locator('[data-vc-settings-trigger]').first().click();
            await waitForSettingsSheetState(page, true);
            const scaledSheetGeo = await collectMobileShellGeometry(page, { sheetOpen: true });
            assertMobileShellGeometry(
                scaledSheetGeo,
                `[fontScale=1.3 ${vp.orientation} ${vp.width}×${vp.height} settings-sheet]`,
            );
            await closeSettingsSheetAndWaitDidDismiss(page, () =>
                page.locator('[data-vc-settings-sheet] [data-vc-settings-done]').first().click(),
            );
        }

        // 恢复 1.0× 字体基础 scale
        await cdp.send('Page.setFontSizes', {
            fontSizes: { standard: 16, fixed: 13 },
        });
        await page.evaluate(() => {
            document.documentElement.style.removeProperty('--fontScale');
        });

        // 3. prefers-reduced-motion 与 prefers-reduced-transparency 媒体特性核验
        await page.setViewportSize({ width: 390, height: 844 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await cdp.send('Emulation.setEmulatedMedia', {
            features: [
                { name: 'prefers-reduced-motion', value: 'reduce' },
                { name: 'prefers-reduced-transparency', value: 'reduce' },
            ],
        });
        await settleMobilePage(page);

        const reducedCheck = await page.evaluate(() => {
            const rootCs = getComputedStyle(document.documentElement);
            const tabbar = document.querySelector('[data-vc-mobile-tabbar]');
            const tabbarCs = tabbar ? getComputedStyle(tabbar) : null;
            return {
                matchesReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
                matchesReducedTransparency: window.matchMedia('(prefers-reduced-transparency: reduce)').matches,
                durQuick: rootCs.getPropertyValue('--vc-dur-quick').trim(),
                mobGlassBlur: rootCs.getPropertyValue('--mob-glass-blur').trim(),
                mobSheetBlur: rootCs.getPropertyValue('--mob-sheet-blur').trim(),
                tabbarBackdrop:
                    tabbarCs?.backdropFilter || tabbarCs?.webkitBackdropFilter || 'none',
            };
        });
        assert.equal(reducedCheck.matchesReducedMotion, true);
        assert.equal(reducedCheck.matchesReducedTransparency, true);
        assert.equal(reducedCheck.mobGlassBlur, 'none', 'reduced-transparency 下 --mob-glass-blur 必须降级为 none');
        assert.equal(reducedCheck.mobSheetBlur, 'none', 'reduced-transparency 下 --mob-sheet-blur 必须降级为 none');

        await cdp.detach().catch(() => {});
        pageErrors.assertNone();

        const report = {
            scene: 'mb2-layout',
            matrixCount: checkedMatrix.length,
            phonePortraitViewports: PHONE_PORTRAIT_VIEWPORTS.map((v) => `${v.width}x${v.height}`),
            phoneLandscapeViewports: PHONE_PORTRAIT_VIEWPORTS.map((v) => `${v.height}x${v.width}`),
            foldablePhoneShellOnlyViewports: FOLDABLE_PHONE_SHELL_VIEWPORTS.flatMap((v) => [
                `${v.width}x${v.height}`,
                `${v.height}x${v.width}`,
            ]),
            themesVerified: ['light', 'dark'],
            fontScaleVerified: {
                method: '通过用户真实字体基础 scale (--fontScale=1.3 与 Chromium Page.setFontSizes 1.3×) 模拟，未注入任何改变生产 layout 的 CSS 覆盖规则',
                viewports: fontScaleViewports.map((v) => `${v.width}x${v.height}`),
            },
            reducedMediaVerified: reducedCheck,
            notRunBoundaries: {
                foldableDualPane:
                    'NOT_RUN（673×841 与 768×1024 本批仅验证同一手机壳不溢出与控件可达，折叠屏双栏待 MB2-0 选图与后续业务页条目实现）',
                nativeSafeAreaInsets:
                    'NOT_RUN（桌面 Chromium 无非 CSS 原生 env(safe-area-inset-*) 注入接口，浏览器仅核对 0px 下公式与边界不裁切；刘海/灵动岛/手势条/三键导航真实非零 inset 属 MB2-13 原生壳验收）',
                nativeKeyboardAndOsFont:
                    'NOT_RUN（原生软键盘避让与 Android/iOS 系统级字体缩放在 MB2-13 原生壳真机/模拟器矩阵验收）',
            },
        };
        const reportName = 'mb2-layout-report.json';
        fs.writeFileSync(path.join(artifactDir, reportName), JSON.stringify(report, null, 2) + '\n', {
            mode: 0o600,
        });
        return report;
    } finally {
        await browser.close();
    }
}

export const mb2ShellScene = {
    id: 'mb2-shell',
    title: 'MB2-5 手机壳层：五项标签导航、设置大 Sheet、真实历史往返、主题与首屏空闲（可选 4× CPU 切换性能）',
    needs: ['catalog', 'stack', 'browser'],
    deps: ['catalog-admin'],
    default: false,
    run: sceneMb2Shell,
};

export const mb2LayoutScene = {
    id: 'mb2-layout',
    title: 'MB2-5 手机适配矩阵：全设备视口横竖屏、触控目标、标签栏几何、浅深色、1.3× 字体与减弱动态',
    needs: ['catalog', 'stack', 'browser'],
    deps: ['catalog-admin'],
    default: false,
    run: sceneMb2Layout,
};
