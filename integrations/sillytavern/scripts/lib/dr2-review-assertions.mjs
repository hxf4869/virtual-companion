// Virtual Companion · DR2-12-R5 桌面重建真实浏览器回归断言辅助
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README.md）
import assert from 'node:assert/strict';

function parseRgbaAlpha(colorStr) {
    if (!colorStr || colorStr === 'transparent') return 0;
    const rgba = colorStr.match(/rgba\s*\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/i);
    if (rgba) return Number(rgba[1]);
    const slash = colorStr.match(/\/\s*([\d.]+)(%?)\s*\)/);
    if (slash) return slash[2] === '%' ? Number(slash[1]) / 100 : Number(slash[1]);
    if (/^rgb\s*\(/i.test(colorStr)) return 1;
    return 1;
}

/**
 * 区分长文档交集可见（assertInViewport）与操作控件完整命中区可达。
 */
export async function assertControlReachable(page, selector, label, { minWidth = 24, minHeight = 24 } = {}) {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: 'visible' });
    await loc.scrollIntoViewIfNeeded();
    const info = await page.evaluate(
        ({ sel, minW, minH }) => {
            const el = document.querySelector(sel);
            if (!el) return { exists: false };
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            let clipViolation = null;
            let cur = el.parentElement;
            while (cur && cur !== document.body && cur !== document.documentElement) {
                const cs = getComputedStyle(cur);
                const ox = cs.overflowX;
                const oy = cs.overflowY;
                if (ox === 'hidden' || ox === 'clip' || oy === 'hidden' || oy === 'clip') {
                    const cr = cur.getBoundingClientRect();
                    if (
                        cr.width > 0 &&
                        cr.height > 0 &&
                        (rect.left < cr.left - 1.5 ||
                            rect.right > cr.right + 1.5 ||
                            rect.top < cr.top - 1.5 ||
                            rect.bottom > cr.bottom + 1.5)
                    ) {
                        clipViolation = {
                            ancestor: cur.tagName.toLowerCase() + (cur.className ? `.${String(cur.className).trim().split(/\s+/).join('.')}` : ''),
                            ancestorRect: { left: Math.round(cr.left), top: Math.round(cr.top), right: Math.round(cr.right), bottom: Math.round(cr.bottom) },
                        };
                        break;
                    }
                }
                cur = cur.parentElement;
            }
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const hit =
                cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight
                    ? document.elementFromPoint(cx, cy)
                    : null;
            const labelEl = el.closest('label') || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
            const reachable = Boolean(
                hit &&
                    (el === hit ||
                        el.contains(hit) ||
                        hit.contains(el) ||
                        (labelEl && (hit === labelEl || labelEl.contains(hit)))),
            );
            return {
                exists: true,
                visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0,
                rect: {
                    left: Math.round(rect.left * 10) / 10,
                    top: Math.round(rect.top * 10) / 10,
                    right: Math.round(rect.right * 10) / 10,
                    bottom: Math.round(rect.bottom * 10) / 10,
                    width: Math.round(rect.width * 10) / 10,
                    height: Math.round(rect.height * 10) / 10,
                },
                sizeOk: rect.width >= minW - 0.5 && rect.height >= minH - 0.5,
                fullyInViewport:
                    rect.left >= -1.5 &&
                    rect.top >= -1.5 &&
                    rect.right <= window.innerWidth + 1.5 &&
                    rect.bottom <= window.innerHeight + 1.5,
                clipViolation,
                reachable,
            };
        },
        { sel: selector, minW: minWidth, minH: minHeight },
    );
    assert.ok(info.exists && info.visible, `${label} (${selector}) 必须存在且可见: ${JSON.stringify(info)}`);
    assert.ok(info.sizeOk, `${label} (${selector}) 命中尺寸不足 (${minWidth}x${minHeight}): ${JSON.stringify(info.rect)}`);
    assert.ok(info.fullyInViewport, `${label} (${selector}) 必须完整处于视口内: ${JSON.stringify(info)}`);
    assert.equal(info.clipViolation, null, `${label} (${selector}) 不得被祖先容器裁切: ${JSON.stringify(info)}`);
    assert.ok(info.reachable, `${label} (${selector}) 中心点必须可命中: ${JSON.stringify(info)}`);
}

/**
 * 1a. 指定图标按钮消费者的尺寸/圆角/非原生 2px outset 皮肤与内部 SVG <use> getBBox 非零。
 */
export async function assertIconButtonConsumer(page, selector, label) {
    const info = await page.evaluate(sel => {
        const isVisible = el => {
            if (!el || el.hidden) return false;
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 && r.width > 0 && r.height > 0;
        };
        const btn = [...document.querySelectorAll(sel)].find(isVisible);
        if (!btn) return { exists: false };
        const s = getComputedStyle(btn);
        const r = btn.getBoundingClientRect();
        const useEl = btn.querySelector('svg use');
        let bbox = { width: 0, height: 0 };
        let useRect = { width: 0, height: 0 };
        if (useEl) {
            const ur = useEl.getBoundingClientRect();
            useRect = { width: Math.round(ur.width * 10) / 10, height: Math.round(ur.height * 10) / 10 };
            try {
                const b = useEl.getBBox();
                bbox = { width: Math.round(b.width * 100) / 100, height: Math.round(b.height * 100) / 100 };
            } catch {
                bbox = { width: 0, height: 0 };
            }
        }
        return {
            exists: true,
            width: Math.round(r.width * 10) / 10,
            height: Math.round(r.height * 10) / 10,
            borderStyle: s.borderTopStyle,
            borderWidth: parseFloat(s.borderTopWidth) || 0,
            borderRadius: parseFloat(s.borderTopLeftRadius) || 0,
            backgroundColor: s.backgroundColor,
            href: useEl?.getAttribute('href') || useEl?.getAttribute('xlink:href') || null,
            useRect,
            bbox,
        };
    }, selector);

    assert.ok(info.exists, `${label} (${selector}) 必须可见`);
    assert.ok(
        info.borderStyle !== 'outset' &&
            info.borderStyle !== 'inset' &&
            !(info.backgroundColor === 'rgb(239, 239, 239)' && info.borderWidth >= 1.5) &&
            info.width >= 31.5 &&
            info.height >= 31.5 &&
            info.borderRadius >= 6,
        `${label} (${selector}) 公共图标按钮皮肤缺失（不得为原生 2px outset 或 0 圆角）: ${JSON.stringify(info)}`,
    );
    assert.ok(
        info.bbox.width > 0 && info.bbox.height > 0 && info.useRect.width > 0 && info.useRect.height > 0,
        `${label} (${selector}) 内部 SVG <use> getBBox/渲染尺寸不得为 0: ${JSON.stringify(info)}`,
    );
}

/**
 * 1b. 指定动态图标消费者（如设置分类导航图标）的 SVG <use> getBBox 非零。
 */
export async function assertSvgUseConsumer(page, selector, label) {
    const info = await page.evaluate(sel => {
        const svgs = [...document.querySelectorAll(sel)].filter(svg => {
            const r = svg.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
        const items = svgs.map(svg => {
            const useEl = svg.querySelector('use');
            const ur = useEl?.getBoundingClientRect();
            let bbox = { width: 0, height: 0 };
            if (useEl) {
                try {
                    const b = useEl.getBBox();
                    bbox = { width: Math.round(b.width * 100) / 100, height: Math.round(b.height * 100) / 100 };
                } catch {
                    bbox = { width: 0, height: 0 };
                }
            }
            return {
                href: useEl?.getAttribute('href') || useEl?.getAttribute('xlink:href') || null,
                useWidth: ur ? Math.round(ur.width * 10) / 10 : 0,
                useHeight: ur ? Math.round(ur.height * 10) / 10 : 0,
                bbox,
            };
        });
        return { count: items.length, invalid: items.filter(i => i.bbox.width <= 0 || i.bbox.height <= 0 || i.useWidth <= 0 || i.useHeight <= 0) };
    }, selector);

    assert.ok(info.count > 0, `${label} (${selector}) 必须存在可见 SVG 节点`);
    assert.equal(info.invalid.length, 0, `${label} (${selector}) 存在 SVG <use> getBBox 为 0 的缺失符号: ${JSON.stringify(info.invalid)}`);
}

/**
 * 2. 剧情页 .vc-sr 视觉隐藏且语义保留，不得用 display:none / visibility:hidden 代替。
 */
export async function assertStorySrOnly(page, label) {
    const nodes = await page.evaluate(() =>
        [...document.querySelectorAll('.vc-story .vc-sr')].map(el => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return {
                textLength: (el.textContent || '').trim().length,
                ariaHidden: el.getAttribute('aria-hidden'),
                hidden: Boolean(el.hidden || el.closest('[hidden], [aria-hidden="true"]')),
                display: s.display,
                visibility: s.visibility,
                position: s.position,
                overflow: s.overflow,
                width: Math.round(r.width * 100) / 100,
                height: Math.round(r.height * 100) / 100,
            };
        }),
    );
    assert.ok(nodes.length >= 1, `${label} 剧情页必须存在 .vc-sr 节点`);
    for (const item of nodes) {
        assert.ok(item.textLength > 0 && item.ariaHidden !== 'true' && !item.hidden, `${label} .vc-sr 必须保留可访问文本语义: ${JSON.stringify(item)}`);
        assert.ok(item.display !== 'none' && item.visibility !== 'hidden', `${label} .vc-sr 不得用 display:none/visibility:hidden 代替: ${JSON.stringify(item)}`);
        assert.ok(
            (item.position === 'absolute' || item.position === 'fixed') && item.width <= 1 && item.height <= 1 && item.overflow === 'hidden',
            `${label} .vc-sr 必须脱离文档流并收敛至 <=1x1px overflow:hidden: ${JSON.stringify(item)}`,
        );
    }
}

/**
 * 3. 角色详情在 1440/1920 为真正右侧列（与主内容网格不相交且在面板范围内），
 *    在 390/1024 为窄容器覆盖层且操作可达。
 */
export async function assertCharactersDetailLayout(page, viewport) {
    const info = await page.evaluate(() => {
        const route = document.querySelector('.vc-characters-route');
        const panel = document.querySelector('#vc-shell [data-shell-main]') || route;
        const main = document.querySelector('.vc-characters-main');
        const detail = document.querySelector('.vc-character-detail');
        if (!route || !panel || !main || !detail) return { exists: false };
        const pr = panel.getBoundingClientRect();
        const rr = route.getBoundingClientRect();
        const mr = main.getBoundingClientRect();
        const dr = detail.getBoundingClientRect();
        return {
            exists: true,
            detailPosition: getComputedStyle(detail).position,
            panel: { left: Math.round(pr.left), top: Math.round(pr.top), right: Math.round(pr.right), bottom: Math.round(pr.bottom) },
            route: { left: Math.round(rr.left), top: Math.round(rr.top), right: Math.round(rr.right), bottom: Math.round(rr.bottom) },
            main: { left: Math.round(mr.left), top: Math.round(mr.top), right: Math.round(mr.right), bottom: Math.round(mr.bottom) },
            detail: { left: Math.round(dr.left), top: Math.round(dr.top), right: Math.round(dr.right), bottom: Math.round(dr.bottom), width: Math.round(dr.width) },
        };
    });

    assert.ok(info.exists, `06-characters@${viewport.width} 角色页与详情面板必须存在`);

    if (viewport.width >= 1440) {
        assert.ok(
            info.detailPosition !== 'absolute' &&
                info.detailPosition !== 'fixed' &&
                info.detail.width >= 360 &&
                info.detail.width <= 420 &&
                info.main.right <= info.detail.left + 2 &&
                Math.abs(info.detail.top - info.main.top) <= 4 &&
                info.detail.right <= info.panel.right + 2 &&
                info.detail.bottom <= info.panel.bottom + 2,
            `06-characters@${viewport.width} 角色详情必须为右侧独立列、与主内容网格不相交且在面板范围内: ${JSON.stringify(info)}`,
        );
    } else {
        assert.ok(
            info.detail.left >= info.route.left - 2 &&
                info.detail.right <= info.route.right + 2 &&
                info.detail.top >= info.route.top - 2 &&
                info.detail.bottom <= info.route.bottom + 2,
            `06-characters@${viewport.width} 窄容器角色详情覆盖层必须在路由范围内: ${JSON.stringify(info)}`,
        );
    }

    await assertControlReachable(page, '.vc-character-detail .vc-character-detail-top button', `06-characters@${viewport.width} 详情关闭按钮`);
    await assertControlReachable(page, '.vc-character-detail .vc-character-detail-actions button:first-child', `06-characters@${viewport.width} 新建实例按钮`);
    await assertSvgUseConsumer(page, '.vc-character-detail .vc-character-detail-actions button:first-child svg', `06-characters@${viewport.width} 新建实例图标`);
}

/**
 * 4. 桌面语音三个引擎 Switch 非零宽度、track/thumb 结构与 label 焦点正确（未配置时 disabled 为正确行为）。
 */
export async function assertVoiceSwitches(page, label) {
    for (const field of ['kokoroEnabled', 'cosyVoiceEnabled', 'asrEnabled']) {
        await page.locator(`[data-vc-voice-section] [data-voice-field="${field}"]`).waitFor({ state: 'attached' });
    }
    const items = await page.evaluate(() => {
        const switches = [...document.querySelectorAll('[data-vc-voice-section] [role="switch"][data-voice-field]')];
        return switches.map(sw => {
            const r = sw.getBoundingClientRect();
            const track = sw.querySelector('.vc-switch__track') || sw;
            const thumb = sw.querySelector('.vc-switch__thumb, span');
            const tr = track?.getBoundingClientRect();
            const thr = thumb?.getBoundingClientRect();
            const labelledBy = sw.getAttribute('aria-labelledby');
            const labelEl =
                (labelledBy ? document.getElementById(labelledBy) : null) ||
                sw.closest('label') ||
                (sw.id ? document.querySelector(`label[for="${CSS.escape(sw.id)}"]`) : null);
            const ariaLabel = (sw.getAttribute('aria-label') || '').trim();
            const row = sw.closest('.vc-cell, .vc-field, .vc-voice-engine-row, .vc-form-row') || sw.parentElement;
            const unconfigured = ((row?.textContent || '').replace(/\s+/g, ' ').trim()).includes('未配置');
            const isDisabled = Boolean(sw.disabled || sw.getAttribute('aria-disabled') === 'true' || sw.hasAttribute('data-disabled'));
            return {
                field: sw.getAttribute('data-voice-field') || ariaLabel || (labelEl?.textContent || '').trim(),
                width: Math.round(r.width * 10) / 10,
                height: Math.round(r.height * 10) / 10,
                trackWidth: tr ? Math.round(tr.width * 10) / 10 : 0,
                trackHeight: tr ? Math.round(tr.height * 10) / 10 : 0,
                thumbWidth: thr ? Math.round(thr.width * 10) / 10 : 0,
                thumbHeight: thr ? Math.round(thr.height * 10) / 10 : 0,
                hasLabel: Boolean(ariaLabel.length > 0 || (labelEl && (labelEl.textContent || '').trim().length > 0)),
                unconfigured,
                isDisabled,
            };
        });
    });

    assert.equal(items.length, 3, `${label} 桌面语音页必须存在 3 个引擎 Switch: ${JSON.stringify(items)}`);
    for (const sw of items) {
        assert.ok(
            sw.width >= 40 && sw.height >= 20 && sw.trackWidth >= 40 && sw.trackHeight >= 20 && sw.thumbWidth >= 16 && sw.thumbHeight >= 16,
            `${label} 语音引擎 Switch (${sw.field}) 必须具备非零宽度及 track/thumb 结构: ${JSON.stringify(sw)}`,
        );
        assert.ok(sw.hasLabel, `${label} 语音引擎 Switch (${sw.field}) 必须关联有效 label: ${JSON.stringify(sw)}`);
        assert.equal(sw.isDisabled, sw.unconfigured, `${label} 语音引擎 Switch (${sw.field}) disabled 状态应与未配置状态一致: ${JSON.stringify(sw)}`);
    }
}

/**
 * 5. 真实分段回复 .mes_text 视觉隐藏、.vc-seg 分段气泡可见且不重复显示。
 */
export async function assertSegmentedReply(page, label, marker = '') {
    const info = await page.evaluate(expectedMarker => {
        const nodes = [
            ...document.querySelectorAll('#chat :is(.mes.vc-segmented, .vc-desktop-message-content.vc-segmented)'),
        ].filter(node => !expectedMarker || (node.textContent || '').includes(expectedMarker));
        return nodes.map(node => {
            const mes = node.closest('.mes') || node;
            const mesText = node.querySelector('.mes_text') || mes.querySelector('.mes_text');
            const segsBox = node.querySelector('.vc-segs') || mes.querySelector('.vc-segs');
            const segs = [...(segsBox ? segsBox.querySelectorAll('.vc-seg') : [])];
            const mtStyle = mesText ? getComputedStyle(mesText) : null;
            const mtRect = mesText ? mesText.getBoundingClientRect() : null;
            const mesTextVisuallyHidden = Boolean(
                mesText &&
                    mtStyle &&
                    (mtStyle.display === 'none' ||
                        mtStyle.visibility === 'hidden' ||
                        ((mtStyle.position === 'absolute' || mtStyle.position === 'fixed') &&
                            mtRect.width <= 1 &&
                            mtRect.height <= 1 &&
                            mtStyle.overflow === 'hidden')),
            );
            return {
                mesTextAriaHidden: mesText?.getAttribute('aria-hidden') || null,
                mesTextVisuallyHidden,
                mesTextDisplay: mtStyle?.display || null,
                mesTextRect: mtRect ? { width: Math.round(mtRect.width), height: Math.round(mtRect.height) } : null,
                segs: segs.map(seg => {
                    const sr = seg.getBoundingClientRect();
                    const ss = getComputedStyle(seg);
                    return {
                        top: Math.round(sr.top * 10) / 10,
                        bottom: Math.round(sr.bottom * 10) / 10,
                        width: Math.round(sr.width * 10) / 10,
                        height: Math.round(sr.height * 10) / 10,
                        bg: ss.backgroundColor,
                        paddingTop: parseFloat(ss.paddingTop) || 0,
                        borderRadius: parseFloat(ss.borderTopLeftRadius) || 0,
                    };
                }),
            };
        });
    }, marker);

    assert.ok(info.length >= 1, `${label} 必须存在真实 runtime 生成的 .vc-segmented 消息`);
    for (const item of info) {
        assert.equal(item.mesTextAriaHidden, 'true', `${label} .mes_text 必须标记 aria-hidden=true: ${JSON.stringify(item)}`);
        assert.equal(item.mesTextVisuallyHidden, true, `${label} .mes_text 必须视觉隐藏，不得与分段气泡重复显示: ${JSON.stringify(item)}`);
        assert.ok(item.segs.length >= 2, `${label} 必须至少包含 2 个 .vc-seg 分段气泡: ${JSON.stringify(item)}`);
        for (let i = 0; i < item.segs.length; i += 1) {
            const seg = item.segs[i];
            assert.ok(
                seg.width > 20 && seg.height >= 24 && seg.bg !== 'rgba(0, 0, 0, 0)' && seg.paddingTop >= 6 && seg.borderRadius >= 6,
                `${label} .vc-seg[${i}] 气泡尺寸或背景/圆角皮肤缺失: ${JSON.stringify(seg)}`,
            );
            if (i > 0) {
                assert.ok(seg.top >= item.segs[i - 1].bottom - 1, `${label} 分段气泡垂直位置不得重叠: ${JSON.stringify(item.segs)}`);
            }
        }
    }
}

/**
 * 6a. 窄窗 390 的日记工具栏与手写体/月份切换完整可读可达。
 */
export async function assertNarrow390Diary(page) {
    const info = await page.evaluate(() => {
        const diary = document.querySelector('.vc-memory-diary');
        const month = document.querySelector('.vc-memory-diary__month-label');
        const handBtn = [...document.querySelectorAll('.vc-memory-diary button')].find(b => (b.textContent || '').includes('手写体'));
        if (!diary || !month || !handBtn) return { exists: false };
        const dr = diary.getBoundingClientRect();
        const mr = month.getBoundingClientRect();
        const hr = handBtn.getBoundingClientRect();
        return {
            exists: true,
            monthSingleLine: mr.height <= 32 && mr.width >= 28,
            handInsideDiary: hr.left >= dr.left - 1.5 && hr.right <= dr.right + 1.5,
        };
    });
    assert.ok(info.exists && info.monthSingleLine && info.handInsideDiary, `10-memory-diary@390 日记月份与手写体按钮不得折行或溢出: ${JSON.stringify(info)}`);
    await assertControlReachable(page, '.vc-memory-diary__month-nav button:first-of-type', '10-memory-diary@390 上一月按钮');
    await assertControlReachable(page, '.vc-memory-diary__month-nav button:last-of-type', '10-memory-diary@390 下一月按钮');
}

/**
 * 6b. 窄窗 390 的收件箱静默时间/时区与筛选分段选项（含水平滚动 scrollIntoView 后）完整可读可达。
 */
export async function assertNarrow390Inbox(page) {
    const info = await page.evaluate(() => {
        const inbox = document.querySelector('.vc-inbox-route, .vc-inbox');
        const quietGrid = document.querySelector('.vc-policy-form__quiet-grid');
        const segment = document.querySelector('[aria-label="收件箱筛选"]');
        if (!inbox || !quietGrid || !segment) return { exists: false };
        const fields = [...quietGrid.querySelectorAll('.vc-field')].map(f => {
            const labelEl = f.querySelector('.vc-field__label, label');
            const inputEl = f.querySelector('input, select');
            inputEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            const ir = inbox.getBoundingClientRect();
            const lr = labelEl?.getBoundingClientRect();
            const inr = inputEl?.getBoundingClientRect();
            const cx = inr ? inr.left + inr.width / 2 : -1;
            const cy = inr ? inr.top + inr.height / 2 : -1;
            const hit = cx >= 0 && cy >= 0 ? document.elementFromPoint(cx, cy) : null;
            return {
                label: (labelEl?.textContent || '').trim(),
                labelHeight: lr ? Math.round(lr.height * 10) / 10 : 0,
                inputWidth: inr ? Math.round(inr.width * 10) / 10 : 0,
                inBounds: Boolean(inr && inr.left >= ir.left - 1.5 && inr.right <= ir.right + 1.5),
                scrollWidth: inputEl?.scrollWidth || 0,
                clientWidth: inputEl?.clientWidth || 0,
                reachable: Boolean(inputEl && hit && (inputEl === hit || inputEl.contains(hit))),
            };
        });
        const segItems = [...segment.querySelectorAll('[role="radio"], button')].map(btn => {
            btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            const ir = inbox.getBoundingClientRect();
            const br = btn.getBoundingClientRect();
            const cx = br.left + br.width / 2;
            const cy = br.top + br.height / 2;
            const hit = cx >= 0 && cy >= 0 ? document.elementFromPoint(cx, cy) : null;
            return {
                text: (btn.textContent || '').trim(),
                inBounds: br.left >= ir.left - 1.5 && br.right <= ir.right + 1.5,
                height: Math.round(br.height * 10) / 10,
                scrollWidth: btn.scrollWidth,
                clientWidth: btn.clientWidth,
                reachable: Boolean(hit && (btn === hit || btn.contains(hit))),
            };
        });
        segment.scrollLeft = 0;
        return { exists: true, fields, segItems };
    });

    assert.ok(info.exists && info.fields.length === 3, `11-inbox@390 静默时间/时区 3 个字段必须存在: ${JSON.stringify(info)}`);
    for (const f of info.fields) {
        const minW = f.label.includes('时区') ? 140 : 96;
        assert.ok(
            f.labelHeight <= 28 && f.inputWidth >= minW && f.scrollWidth <= f.clientWidth + 2 && f.inBounds && f.reachable,
            `11-inbox@390 字段「${f.label}」标签折行、输入框过窄被裁切或不可达: ${JSON.stringify(f)}`,
        );
    }
    assert.ok(info.segItems.length >= 4, `11-inbox@390 收件箱筛选必须包含 4 个分段项: ${JSON.stringify(info.segItems)}`);
    for (const item of info.segItems) {
        assert.ok(
            item.height <= 40 && item.scrollWidth <= item.clientWidth + 2 && item.inBounds && item.reachable,
            `11-inbox@390 收件箱筛选分段「${item.text}」scrollIntoView 后仍折行、文本截断或不可达: ${JSON.stringify(item)}`,
        );
    }
}

/**
 * 6c. 设置与酒馆导航复用后标题和条目位置连续。
 */
export async function captureSettingsNavGeometry(page) {
    return page.evaluate(() => {
        const nav = document.querySelector('.vc-settings-categories');
        if (!nav) return null;
        const heading = nav.querySelector('h1, h2, .vc-settings-categories-title');
        const hr = heading?.getBoundingClientRect();
        const hs = heading ? getComputedStyle(heading) : null;
        const items = {};
        for (const key of ['account', 'appearance', 'left-nav-panel', 'WorldInfo']) {
            const el = nav.querySelector(`[data-category="${key}"]`);
            if (el) {
                const r = el.getBoundingClientRect();
                items[key] = { top: Math.round(r.top * 10) / 10, left: Math.round(r.left * 10) / 10, height: Math.round(r.height * 10) / 10 };
            }
        }
        return {
            heading: heading
                ? { text: (heading.textContent || '').trim(), fontSize: hs?.fontSize || '', top: Math.round(hr.top * 10) / 10, left: Math.round(hr.left * 10) / 10 }
                : null,
            items,
        };
    });
}

export function assertSettingsTavernNavContinuity(settingsNav, tavernNav, label) {
    assert.ok(settingsNav?.heading && tavernNav?.heading, `${label} 设置与酒馆导航标题必须存在`);
    assert.ok(
        settingsNav.heading.text === tavernNav.heading.text &&
            settingsNav.heading.fontSize === tavernNav.heading.fontSize &&
            Math.abs(settingsNav.heading.top - tavernNav.heading.top) <= 1.5 &&
            Math.abs(settingsNav.heading.left - tavernNav.heading.left) <= 1.5,
        `${label} 设置与酒馆导航标题字号或位置不连续: ${JSON.stringify({ settings: settingsNav.heading, tavern: tavernNav.heading })}`,
    );
    for (const key of ['account', 'appearance', 'left-nav-panel', 'WorldInfo']) {
        const a = settingsNav.items[key];
        const b = tavernNav.items[key];
        assert.ok(
            a && b && Math.abs(a.top - b.top) <= 1.5 && Math.abs(a.left - b.left) <= 1.5 && Math.abs(a.height - b.height) <= 1.5,
            `${label} 导航条目 [${key}] 位置跳动: ${JSON.stringify({ settings: a, tavern: b })}`,
        );
    }
}

/**
 * 7. 真实已稳定菜单/Dialog 的 opacity=1、无残留 starting-style、标准 computed backdrop-filter 不为 none。
 *    （仅作工程计算属性合同检查，不替代视觉终审。）
 */
export async function assertOverlayBackdropBlur(page, selector, label) {
    const info = await page.evaluate(sel => {
        const popup = document.querySelector(sel);
        if (!popup) return { exists: false };
        const ps = getComputedStyle(popup);
        return {
            exists: true,
            opacity: ps.opacity,
            hasStartingStyle: popup.hasAttribute('data-starting-style'),
            hasEndingStyle: popup.hasAttribute('data-ending-style'),
            backgroundColor: ps.backgroundColor,
            backdropFilter: ps.backdropFilter || 'none',
            webkitBackdropFilter: ps.webkitBackdropFilter || 'none',
        };
    }, selector);

    assert.ok(info.exists, `${label} (${selector}) 弹层必须存在`);
    assert.equal(info.hasStartingStyle, false, `${label} 弹层不得残留 data-starting-style: ${JSON.stringify(info)}`);
    assert.equal(info.hasEndingStyle, false, `${label} 弹层不得残留 data-ending-style: ${JSON.stringify(info)}`);
    assert.equal(info.opacity, '1', `${label} 弹层稳定态 opacity 必须为 1: ${JSON.stringify(info)}`);
    const alpha = parseRgbaAlpha(info.backgroundColor);
    assert.ok(alpha >= 0.65 && alpha <= 0.95, `${label} 弹层背景须保持玻璃半透明而非实色掩盖: ${JSON.stringify(info)}`);
    assert.ok(
        info.backdropFilter !== 'none' && info.backdropFilter.includes('blur('),
        `${label} 弹层标准 computed backdropFilter 不得为 none（需包含 blur）: ${JSON.stringify(info)}`,
    );
}
