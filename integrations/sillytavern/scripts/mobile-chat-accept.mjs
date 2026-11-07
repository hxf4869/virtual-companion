// Virtual Companion · MB2-6 第 6b-1 批 手机对话页受管验收（mb2-chat）
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README.md；ADR-0009 §3 / ADR-0012）
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStClient } from './managed-lib.mjs';
import { bindForeground } from './lib/accept-scene-helpers.mjs';
import { trackPageErrors } from './lib/page-errors.mjs';
import { completeStOnboarding } from './lib/st-onboarding.mjs';
import {
    REPRESENTATIVE_SHOT_VIEWPORTS,
    closeSettingsSheetAndWaitDidDismiss,
    settleMobilePage,
    waitForSettingsSheetState,
} from './mobile-shell-accept.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INTEG_ROOT = path.resolve(HERE, '..');

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

async function swipeRowHorizontally(page, startX, endX, y, steps = 12) {
    await page.mouse.move(startX, y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i += 1) {
        const x = Math.round(startX + ((endX - startX) * i) / steps);
        await page.mouse.move(x, y);
        await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
        );
    }
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
    );
    await page.mouse.up();
}

async function inspectConvoRowSwipeGeometry(page, conversationKey) {
    return page.evaluate((key) => {
        const card = document.querySelector(`[data-vc-mobile-convo-row=${JSON.stringify(key)}]`);
        if (!card) return null;
        const sliding = card.closest('ion-item-sliding') || card.parentElement;
        const options = sliding?.querySelector('ion-item-options');
        const pinBtn = sliding?.querySelector('[data-vc-swipe-action="pin"]');
        const timeEl = card.querySelector('.vc-mobile-convo-time');

        const cardRect = card.getBoundingClientRect();
        const slidingRect = sliding ? sliding.getBoundingClientRect() : cardRect;
        const pinRect = pinBtn ? pinBtn.getBoundingClientRect() : null;
        const optionsCs = options ? getComputedStyle(options) : null;
        const pinCs = pinBtn ? getComputedStyle(pinBtn) : null;
        const timeRect = timeEl ? timeEl.getBoundingClientRect() : null;
        const timeCs = timeEl ? getComputedStyle(timeEl) : null;

        let timeHitInsideCard = false;
        if (timeRect && timeRect.width > 0 && timeRect.height > 0) {
            const cx = timeRect.left + timeRect.width / 2;
            const cy = timeRect.top + timeRect.height / 2;
            const hitEl = document.elementFromPoint(cx, cy);
            timeHitInsideCard = Boolean(hitEl && card.contains(hitEl));
        }

        let pinHitInsideOption = false;
        if (pinRect && pinRect.width > 0 && pinRect.height > 0 && pinBtn) {
            const px = pinRect.left + pinRect.width / 2;
            const py = pinRect.top + pinRect.height / 2;
            const hitPinEl = document.elementFromPoint(px, py);
            pinHitInsideOption = Boolean(hitPinEl && pinBtn.contains(hitPinEl));
        }

        const pinHidden =
            Boolean(pinBtn && options) &&
            (optionsCs?.display === 'none' ||
                pinCs?.display === 'none' ||
                (pinRect?.width ?? 0) === 0);

        const pinVisible =
            Boolean(pinBtn && options) &&
            Boolean(sliding?.classList.contains('item-sliding-active-slide')) &&
            !sliding?.classList.contains('item-sliding-closing') &&
            optionsCs?.display !== 'none' &&
            optionsCs?.visibility !== 'hidden' &&
            pinCs?.display !== 'none' &&
            pinCs?.visibility !== 'hidden' &&
            (pinRect?.width ?? 0) > 0 &&
            (pinRect?.height ?? 0) > 0 &&
            cardRect.right <= (pinRect?.left ?? 0) + 1 &&
            pinHitInsideOption;

        return {
            pinHidden,
            pinVisible,
            pinHitInsideOption,
            slidingActive: Boolean(sliding?.classList.contains('item-sliding-active-slide')),
            slidingClosing: Boolean(sliding?.classList.contains('item-sliding-closing')),
            optionsDisplay: optionsCs?.display ?? 'none',
            optionsVisibility: optionsCs?.visibility ?? 'hidden',
            pinDisplay: pinCs?.display ?? 'none',
            pinLeft: Math.round((pinRect?.left ?? 0) * 100) / 100,
            pinWidth: Math.round((pinRect?.width ?? 0) * 100) / 100,
            pinHeight: Math.round((pinRect?.height ?? 0) * 100) / 100,
            cardRight: Math.round(cardRect.right * 100) / 100,
            slidingRight: Math.round(slidingRect.right * 100) / 100,
            rightEdgeDelta: Math.round(Math.abs(cardRect.right - slidingRect.right) * 100) / 100,
            timeText: timeEl?.textContent?.trim() ?? '',
            timeWidth: Math.round((timeRect?.width ?? 0) * 100) / 100,
            timeHeight: Math.round((timeRect?.height ?? 0) * 100) / 100,
            timeVisible:
                Boolean(timeEl) &&
                (timeRect?.width ?? 0) > 0 &&
                (timeRect?.height ?? 0) > 0 &&
                timeCs?.display !== 'none' &&
                timeCs?.visibility !== 'hidden' &&
                timeHitInsideCard,
            timeHitInsideCard,
        };
    }, conversationKey);
}

function resolveArtifactDir(ctx) {
    const dir =
        ctx?.artifactsDir ||
        ctx?.artifactDir ||
        path.join(INTEG_ROOT, 'dev-managed', 'artifacts', 'mb2-chat-manual');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}

function resolveStBase(ctx) {
    return ctx?.w05?.stBase || `http://127.0.0.1:${process.env.VC_W03_ST_PORT || 8752}`;
}

async function seedMobileConversationFixture(ctx) {
    for (const consentType of [
        'SERVICE_TERMS',
        'PRIVACY_POLICY',
        'AI_CONTENT_NOTICE',
        'THIRD_PARTY_MODEL_PROCESSING',
        'SENSITIVE_DATA_PROCESSING',
    ]) {
        const result = await ctx.admin.call('PUT', '/api/v1/consents', {
            consentType,
            version: 'mb2-synthetic',
            granted: true,
        });
        assert.equal(result.status, 200, `合成授权失败: ${consentType} HTTP ${result.status}`);
    }

    const s = ctx.secrets.session;
    const st = createStClient({
        baseUrl: ctx.w05.stBase,
        expectedIdentity: s,
        extraCookies: `vc_session=${s.vcSession}; vc_csrf=${s.vcCsrf}`,
    });
    const name = `林夕MB2_${crypto.randomUUID().slice(0, 6)}`;
    const characterRef = crypto.randomUUID();
    const chatIdentity = crypto.randomUUID();
    const bound = await ctx.admin.call('POST', '/api/v1/st/bindings', {
        characterRef,
        chatIdentity,
        displayName: '日常陪伴',
        mode: 'COMPANION',
    });
    assert.equal(bound.status, 200, `合成实例绑定失败: HTTP ${bound.status}`);

    const card = {
        name,
        description: '仅供 MB2-6 手机对话页受管合成验收',
        first_mes: '你今天下班那会儿雨下得很大，到家了吗？',
        personality: '',
        scenario: '',
        mes_example: '',
        extensions: { vc_character_ref: characterRef },
    };
    const form = new FormData();
    form.append('file_type', 'json');
    form.append(
        'avatar',
        new Blob(
            [JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: card })],
            { type: 'application/json' },
        ),
        'card.json',
    );
    const imp = await st.call('POST', '/api/characters/import', form);
    assert.equal(imp.status, 200, `导入合成角色卡失败: HTTP ${imp.status}`);

    const avatar = `${imp.json.file_name.replace(/\.png$/, '')}.png`;
    const file = `MB2-chat-${crypto.randomUUID()}`;
    const nowMs = Date.now();

    // 6 条种子消息：包含跨 >20 分钟间隔（触发日期胶囊）、角色连续消息分组、用户连续消息分组
    const messages = [
        {
            name,
            is_user: false,
            mes: '你今天下班那会儿雨下得很大，到家了吗？',
            send_date: new Date(nowMs - 45 * 60_000).toISOString(),
        },
        {
            name: '你',
            is_user: true,
            mes: '刚进门，鞋都湿透了。',
            send_date: new Date(nowMs - 44 * 60_000).toISOString(),
        },
        // 间隔 34 分钟 (> 20 分钟)，此处应插入日期胶囊
        {
            name,
            is_user: false,
            mes: '快去换双干袜子，我给你记着煮姜茶。',
            send_date: new Date(nowMs - 10 * 60_000).toISOString(),
        },
        {
            name,
            is_user: false,
            mes: '毛巾在浴室右手边第二格，别着凉了。',
            send_date: new Date(nowMs - 9 * 60_000).toISOString(),
        },
        {
            name: '你',
            is_user: true,
            mes: '好，已经换好啦。',
            send_date: new Date(nowMs - 8 * 60_000).toISOString(),
        },
        {
            name: '你',
            is_user: true,
            mes: '今天想听你讲上次那张晚霞照片的故事。',
            send_date: new Date(nowMs - 7 * 60_000).toISOString(),
        },
    ];

    const saved = await st.call('POST', '/api/chats/save', {
        avatar_url: avatar,
        file_name: file,
        chat: [
            {
                user_name: '你',
                character_name: name,
                chat_metadata: {
                    vc_f2: { id: chatIdentity, revision: 0 },
                    vc_binding: {
                        ...bound.json,
                        mode: 'COMPANION',
                        displayName: '日常陪伴',
                    },
                },
            },
            ...messages,
        ],
    });
    assert.equal(saved.status, 200, `保存合成聊天失败: HTTP ${saved.status}`);

    const conversationKey = JSON.stringify([avatar, file]);
    return {
        st,
        name,
        avatar,
        file,
        conversationKey,
        relationshipId: bound.json.relationshipId,
        seedCount: messages.length,
    };
}

export async function sceneMb2Chat(ctx) {
    await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    const artifactDir = resolveArtifactDir(ctx);
    const stBase = resolveStBase(ctx);
    const fixture = await seedMobileConversationFixture(ctx);

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH
            ? { executablePath: process.env.VC_W03_CHROMIUM_PATH }
            : {}),
    });

    const setReplyOverride = (text, chunks = 6, perChunkMs = 45, firstMs = 40) =>
        ctx.fixtureHttp.setOverride('vc03m-chat', {
            text,
            chunks,
            delay: { firstMs, perChunkMs },
        });

    try {
        const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true,
            reducedMotion: 'no-preference',
            timezoneId: 'Asia/Shanghai',
        });
        if (ctx?.secrets?.session) {
            await context.addCookies([
                { name: 'vc_session', value: ctx.secrets.session.vcSession, url: stBase },
                { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: stBase },
            ]);
        }
        await completeStOnboarding(context, stBase);

        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        const pageErrors = trackPageErrors(page);

        // 1. 打开 /m/chat 会话列表并等待刚创建的会话行出现
        await page.goto(`${stBase}/m/chat`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
            () =>
                document.documentElement.dataset.vcApp === 'ready' &&
                document.documentElement.dataset.vcDevice === 'mobile',
        );

        const rowLocator = page.locator(
            `[data-vc-mobile-convo-row=${JSON.stringify(fixture.conversationKey)}]`,
        );
        await rowLocator.waitFor({ state: 'visible', timeout: 20000 });
        await settleMobilePage(page);

        // 1a. 静止状态几何断言：[data-vc-swipe-action="pin"] 不可见，会话卡片右边缘与所在行右边缘对齐，时间文字可见且未被遮盖
        const restGeo = await inspectConvoRowSwipeGeometry(page, fixture.conversationKey);
        assert.ok(restGeo, '必须找到会话行几何信息');
        assert.equal(
            restGeo.pinHidden,
            true,
            `静止状态下 [data-vc-swipe-action="pin"] 必须不可见（display:none 或 width:0），实际 optionsDisplay=${restGeo.optionsDisplay}, pinDisplay=${restGeo.pinDisplay}, pinWidth=${restGeo.pinWidth}`,
        );
        assert.ok(
            restGeo.rightEdgeDelta <= 1,
            `静止状态下 .vc-mobile-convo-card 右边缘须与所在行右边缘对齐（误差 <= 1px），实际 cardRight=${restGeo.cardRight}, slidingRight=${restGeo.slidingRight}, delta=${restGeo.rightEdgeDelta}`,
        );
        assert.equal(
            restGeo.timeVisible,
            true,
            `静止状态下时间文字必须可见且未被遮盖，实际 timeText=${JSON.stringify(restGeo.timeText)}, timeWidth=${restGeo.timeWidth}, timeHitInsideCard=${restGeo.timeHitInsideCard}`,
        );

        // 1b. 用真实鼠标拖动手势在该行上向左滑，断言“置顶”按钮变为可见且宽度约为 88；再向右滑收起，断言恢复隐藏
        const rowBox = await rowLocator.boundingBox();
        assert.ok(rowBox && rowBox.width > 160 && rowBox.height > 40, '会话行 boundingBox 须有效');
        const dragY = Math.round(rowBox.y + rowBox.height / 2);
        const dragStartX = Math.round(rowBox.x + rowBox.width * 0.78);
        const dragEndX = Math.round(rowBox.x + rowBox.width * 0.22);

        await swipeRowHorizontally(page, dragStartX, dragEndX, dragY);
        await page.waitForFunction(
            (key) => {
                const card = document.querySelector(`[data-vc-mobile-convo-row=${JSON.stringify(key)}]`);
                const sliding = card?.closest('ion-item-sliding');
                const pinBtn = sliding?.querySelector('[data-vc-swipe-action="pin"]');
                const options = sliding?.querySelector('ion-item-options');
                if (!card || !sliding || !pinBtn || !options) return false;
                const optionsCs = getComputedStyle(options);
                const cardRect = card.getBoundingClientRect();
                const rect = pinBtn.getBoundingClientRect();
                const hitEl =
                    rect.width > 0 && rect.height > 0
                        ? document.elementFromPoint(
                              rect.left + rect.width / 2,
                              rect.top + rect.height / 2,
                          )
                        : null;
                return (
                    sliding.classList.contains('item-sliding-active-slide') &&
                    !sliding.classList.contains('item-sliding-closing') &&
                    optionsCs.display !== 'none' &&
                    optionsCs.visibility !== 'hidden' &&
                    Math.abs(rect.width - 88) <= 2 &&
                    cardRect.right <= rect.left + 1 &&
                    Boolean(hitEl && pinBtn.contains(hitEl))
                );
            },
            fixture.conversationKey,
            { timeout: 5000 },
        );
        await settleMobilePage(page);

        const swipedGeo = await inspectConvoRowSwipeGeometry(page, fixture.conversationKey);
        assert.ok(swipedGeo, '左滑后必须读取到会话行几何信息');
        assert.equal(
            swipedGeo.pinVisible,
            true,
            `左滑后 [data-vc-swipe-action="pin"] 必须可见且未被卡片遮挡，实际 optionsDisplay=${swipedGeo.optionsDisplay}, optionsVisibility=${swipedGeo.optionsVisibility}, pinWidth=${swipedGeo.pinWidth}, cardRight=${swipedGeo.cardRight}, pinLeft=${swipedGeo.pinLeft}, pinHitInsideOption=${swipedGeo.pinHitInsideOption}`,
        );
        assert.ok(
            Math.abs(swipedGeo.pinWidth - 88) <= 2,
            `左滑后“置顶”按钮宽度须约为 88px，实际 ${swipedGeo.pinWidth}px`,
        );

        // 再次右滑收起，等待 Ionic 600ms 关闭周期结束并断言恢复隐藏
        await swipeRowHorizontally(page, dragEndX, dragStartX, dragY);
        await page.waitForFunction(
            (key) => {
                const card = document.querySelector(`[data-vc-mobile-convo-row=${JSON.stringify(key)}]`);
                const sliding = card?.closest('ion-item-sliding');
                const options = sliding?.querySelector('ion-item-options');
                if (!card || !sliding || !options) return false;
                const optionsCs = getComputedStyle(options);
                const cardRect = card.getBoundingClientRect();
                const slidingRect = sliding.getBoundingClientRect();
                return (
                    !sliding.classList.contains('item-sliding-active-slide') &&
                    !sliding.classList.contains('item-sliding-closing') &&
                    optionsCs.display === 'none' &&
                    Math.abs(cardRect.right - slidingRect.right) <= 1
                );
            },
            fixture.conversationKey,
            { timeout: 5000 },
        );
        await settleMobilePage(page);

        const closedGeo = await inspectConvoRowSwipeGeometry(page, fixture.conversationKey);
        assert.ok(closedGeo, '右滑收起后必须读取到会话行几何信息');
        assert.equal(
            closedGeo.pinHidden,
            true,
            `右滑收起后 [data-vc-swipe-action="pin"] 必须恢复隐藏，实际 optionsDisplay=${closedGeo.optionsDisplay}, pinWidth=${closedGeo.pinWidth}`,
        );
        assert.ok(
            closedGeo.rightEdgeDelta <= 1,
            `右滑收起后 .vc-mobile-convo-card 右边缘须恢复与所在行右边缘对齐，实际 delta=${closedGeo.rightEdgeDelta}`,
        );
        assert.equal(
            closedGeo.timeVisible,
            true,
            `右滑收起后时间文字必须恢复可见且未被遮盖，实际 timeVisible=${closedGeo.timeVisible}`,
        );

        // 2. 通过真实点击从会话列表进入对话页，验证历史消息、气泡分组、日期胶囊、已发送、导航栏与隐藏 TabBar
        await rowLocator.click();
        await page.waitForFunction(
            (expectedCount) => {
                const convo = document.querySelector('[data-vc-mobile-conversation]');
                if (!convo || convo.getAttribute('data-vc-conversation-ready') !== 'true') {
                    return false;
                }
                const msgs = document.querySelectorAll('[data-vc-chat-msg]');
                return msgs.length >= expectedCount;
            },
            fixture.seedCount,
            { timeout: 30000 },
        );
        await settleMobilePage(page);

        const initialDomCheck = await page.evaluate((charName) => {
            const backBtn = document.querySelector('[data-vc-chat-back]');
            const backRect = backBtn?.getBoundingClientRect();
            const capsule = document.querySelector('[data-vc-identity-capsule]');
            const capsuleRect = capsule?.getBoundingClientRect();
            const tabbar = document.querySelector('[data-vc-mobile-tabbar]');
            const tabbarCs = tabbar ? getComputedStyle(tabbar) : null;
            const tabbarHidden =
                !tabbar ||
                tabbar.hidden ||
                tabbar.getAttribute('data-hidden') === 'true' ||
                tabbarCs?.display === 'none' ||
                tabbarCs?.visibility === 'hidden';
            const datePills = document.querySelectorAll('[data-vc-date-pill]');
            const sentReceipts = document.querySelectorAll('[data-vc-sent-receipt]');
            const plusBtn = document.querySelector('[data-vc-composer-plus]');
            const groupPosList = [...document.querySelectorAll('[data-vc-chat-msg]')].map((el) =>
                el.getAttribute('data-vc-group-pos'),
            );
            return {
                backWidth: backRect?.width ?? 0,
                backHeight: backRect?.height ?? 0,
                capsuleHeight: capsuleRect?.height ?? 0,
                capsuleText: capsule?.textContent ?? '',
                hasCharName: (capsule?.textContent ?? '').includes(charName),
                tabbarHidden,
                datePillCount: datePills.length,
                sentReceiptText: sentReceipts[0]?.textContent ?? '',
                sentReceiptCount: sentReceipts.length,
                hasPlusBtn: Boolean(plusBtn),
                groupPosList,
            };
        }, fixture.name);

        assert.equal(initialDomCheck.tabbarHidden, true, '对话页内必须隐藏底部标签栏');
        assert.equal(initialDomCheck.hasCharName, true, '顶部身份胶囊必须展示当前角色名');
        assert.ok(
            initialDomCheck.backWidth >= 44 && initialDomCheck.backHeight >= 44,
            `顶部玻璃返回按钮尺寸须 >= 44×44，实际 ${initialDomCheck.backWidth}×${initialDomCheck.backHeight}`,
        );
        assert.ok(
            Math.abs(initialDomCheck.capsuleHeight - 44) <= 2,
            `顶部身份胶囊高度须为 44px，实际 ${initialDomCheck.capsuleHeight}`,
        );
        assert.ok(initialDomCheck.datePillCount >= 1, '超过 20 分钟间隔的相邻消息间必须插入日期胶囊');
        assert.equal(initialDomCheck.sentReceiptCount, 1, '只应在用户最后一条消息下显示“已发送”');
        assert.equal(initialDomCheck.sentReceiptText, '已发送');
        assert.equal(initialDomCheck.hasPlusBtn, false, '6c/6d 上线前不得显示假“+”入口');

        // 3. 发送消息并观察流式回复与完成后草稿清空
        const composerInput = page.locator('[data-vc-composer-input]');
        await setReplyOverride('测试流式回复：今晚的姜茶已经煮好了，趁热喝一杯吧。', 8, 60, 50);
        await composerInput.fill('测试：我换好衣服啦');
        const sendBtn = page.locator('[data-vc-composer-send]');
        await sendBtn.waitFor({ state: 'visible' });
        await sendBtn.click();

        // 观察流式生成状态（停止按钮或流式内容出现）并等待流式完成
        await page.waitForFunction(
            () =>
                Boolean(document.querySelector('[data-vc-composer-stop]')) ||
                document.body.textContent?.includes('今晚的姜茶已经煮好了'),
            null,
            { timeout: 20000 },
        );
        await page.waitForFunction(
            () =>
                document.body.textContent?.includes('今晚的姜茶已经煮好了，趁热喝一杯吧。') &&
                !document.querySelector('[data-vc-composer-stop]'),
            null,
            { timeout: 30000 },
        );
        assert.equal(await composerInput.inputValue(), '', '发送成功后输入框应清空');

        // 4. 发送并中途点击停止按钮，验证停止生效且保留已流式生成的部分文本
        await setReplyOverride(
            '测试中途停止：' + '窗外的风声渐渐小了，慢慢聊着今天发生的事。'.repeat(25),
            28,
            140,
            60,
        );
        await composerInput.fill('测试：继续讲讲今天的事');
        await sendBtn.waitFor({ state: 'visible' });
        await sendBtn.click();

        const stopBtn = page.locator('[data-vc-composer-stop]');
        await stopBtn.waitFor({ state: 'visible', timeout: 15000 });
        await page.waitForFunction(
            () => document.body.textContent?.includes('窗外的风声渐渐小了'),
            null,
            { timeout: 15000 },
        );
        await stopBtn.click();
        await page.waitForFunction(
            () => !document.querySelector('[data-vc-composer-stop]'),
            null,
            { timeout: 15000 },
        );
        const hasPartialAfterStop = await page.evaluate(() =>
            Boolean(document.body.textContent?.includes('窗外的风声渐渐小了')),
        );
        assert.equal(hasPartialAfterStop, true, '点击停止后应保留已生成的流式文本');

        // 5. 输入草稿 -> 点击返回回到会话列表 -> 验证草稿预览 -> 再次点击进入会话，测量再次进入到历史可见耗时（ms）并验证草稿恢复
        const draftText = '离开对话页后再进入时应自动恢复的草稿';
        await composerInput.fill(draftText);
        await page.locator('[data-vc-chat-back]').click();

        await rowLocator.waitFor({ state: 'visible', timeout: 15000 });
        await page.waitForFunction(
            ({ key, expectedDraft }) => {
                const detailPage = document.querySelector('[data-vc-page="secondary:chat-detail"]');
                if (detailPage && !detailPage.classList.contains('ion-page-hidden')) {
                    return false;
                }
                const row = document.querySelector(
                    `[data-vc-mobile-convo-row=${JSON.stringify(key)}]`,
                );
                return Boolean(row && row.textContent?.includes(`草稿：${expectedDraft}`));
            },
            { key: fixture.conversationKey, expectedDraft: draftText },
            { timeout: 10000 },
        );
        await settleMobilePage(page);

        // 记录再次进入会话到历史可见的耗时（毫秒），通过真实点击触发
        const [reenterTiming] = await Promise.all([
            page.evaluate(
                (key) =>
                    new Promise((resolve, reject) => {
                        const row = document.querySelector(
                            `[data-vc-mobile-convo-row=${JSON.stringify(key)}]`,
                        );
                        if (!row) {
                            reject(new Error('未找到会话行'));
                            return;
                        }
                        row.addEventListener(
                            'click',
                            () => {
                                const t0 = performance.now();
                                const check = () => {
                                    const convo = document.querySelector(
                                        '[data-vc-mobile-conversation]',
                                    );
                                    const msgs = document.querySelectorAll('[data-vc-chat-msg]');
                                    if (convo && msgs.length > 0) {
                                        const lastEl = msgs[msgs.length - 1];
                                        const lastBubble = lastEl?.getBoundingClientRect();
                                        if (
                                            lastBubble &&
                                            lastBubble.height > 0 &&
                                            getComputedStyle(lastEl).visibility !== 'hidden'
                                        ) {
                                            resolve(
                                                Math.round((performance.now() - t0) * 100) / 100,
                                            );
                                            return;
                                        }
                                    }
                                    if (performance.now() - t0 >= 10000) {
                                        reject(new Error('再次进入会话等待历史可见超时'));
                                        return;
                                    }
                                    requestAnimationFrame(check);
                                };
                                requestAnimationFrame(check);
                            },
                            { once: true },
                        );
                    }),
                fixture.conversationKey,
            ),
            rowLocator.click(),
        ]);

        await page.waitForFunction(
            () =>
                document
                    .querySelector('[data-vc-mobile-conversation]')
                    ?.getAttribute('data-vc-conversation-ready') === 'true',
            null,
            { timeout: 15000 },
        );
        await settleMobilePage(page);
        assert.equal(
            await composerInput.inputValue(),
            draftText,
            '离开会话后再进入时草稿必须恢复到输入框',
        );

        // 6. 发送失败时文字保留在输入框，且展示可重试状态
        const failText = '模拟发送失败时必须保留在输入框的文字';
        let failSaveOnce = true;
        const failSaveRoute = async (route) => {
            if (failSaveOnce) {
                failSaveOnce = false;
                await route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'synthetic save failure' }),
                });
                return;
            }
            await route.continue();
        };
        await page.route('**/api/chats/save', failSaveRoute);
        try {
            await composerInput.fill(failText);
            await sendBtn.waitFor({ state: 'visible' });
            await sendBtn.click();

            await page
                .locator('[data-vc-chat-retry]')
                .waitFor({ state: 'visible', timeout: 15000 });
            assert.equal(
                await composerInput.inputValue(),
                failText,
                '发送失败时用户输入文字必须保留在输入框',
            );
        } finally {
            await page.unroute('**/api/chats/save', failSaveRoute);
        }

        // 点击重试恢复会话就绪，未送达文字仍保留在输入框；再验证生成失败与重试恢复正常回复
        await page.locator('[data-vc-chat-retry]').click();
        await page.waitForFunction(
            () =>
                !document.querySelector('[data-vc-chat-error]') &&
                document
                    .querySelector('[data-vc-mobile-conversation]')
                    ?.getAttribute('data-vc-conversation-ready') === 'true',
            null,
            { timeout: 15000 },
        );
        assert.equal(
            await composerInput.inputValue(),
            failText,
            '点击重试刷新会话后未送达草稿仍保留在输入框',
        );

        await ctx.fixtureHttp.setOverride('vc03m-chat', {
            error: { status: 500, message: 'synthetic mobile send failure' },
        });
        await sendBtn.click();
        await page.locator('[data-vc-chat-retry]').waitFor({ state: 'visible', timeout: 15000 });

        await setReplyOverride('重试后成功送达的回复。', 4, 30, 20);
        await page.locator('[data-vc-chat-retry]').click();
        await page.waitForFunction(
            () =>
                document.body.textContent?.includes('重试后成功送达的回复。') &&
                !document.querySelector('[data-vc-composer-stop]'),
            null,
            { timeout: 20000 },
        );
        assert.equal(await composerInput.inputValue(), '', '重试发送成功后输入框应为空');

        // 7. 旋转视口（390×844 竖屏 -> 844×390 横屏 -> 390×844 竖屏），验证阅读位置保持在底部与横屏气泡最大宽度上限
        await page.setViewportSize({ width: 844, height: 390 });
        await settleMobilePage(page);

        const landscapeCheck = await page.evaluate(() => {
            const scroller = document.querySelector('[data-vc-chat-virtuoso]');
            const distanceToBottom = scroller
                ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
                : 999;
            const bubbles = [...document.querySelectorAll('[data-vc-bubble]')];
            const maxBubbleWidth = bubbles.reduce(
                (max, el) => Math.max(max, el.getBoundingClientRect().width),
                0,
            );
            const composerCapsule = document.querySelector('.vc-mobile-composer-capsule');
            const composerRect = composerCapsule?.getBoundingClientRect();
            return {
                distanceToBottom,
                maxBubbleWidth,
                viewportWidth: window.innerWidth,
                composerLeft: composerRect?.left ?? 0,
                composerRightGap: composerRect ? window.innerWidth - composerRect.right : 0,
            };
        });

        assert.ok(
            landscapeCheck.distanceToBottom <= 80,
            `旋转到横屏后阅读位置应保持在底部，实际距底 ${landscapeCheck.distanceToBottom}px`,
        );
        assert.ok(
            landscapeCheck.maxBubbleWidth <= 525,
            `横屏下气泡最大宽度必须受上限约束（<= 520px），不得按 75% 屏宽拉伸，实际 ${landscapeCheck.maxBubbleWidth}px`,
        );
        assert.ok(
            landscapeCheck.composerLeft >= 12 && landscapeCheck.composerRightGap >= 12,
            `横屏下输入区两侧留白正常，实际 left=${landscapeCheck.composerLeft}, rightGap=${landscapeCheck.composerRightGap}`,
        );

        await page.setViewportSize({ width: 390, height: 844 });
        await settleMobilePage(page);

        // 8. 生成 390 与 1440、浅色与深色的截图：全程通过真实用户点击切换设置 Sheet 主题与进出会话
        await page.locator('[data-vc-chat-back]').click();
        await rowLocator.waitFor({ state: 'visible', timeout: 15000 });
        await settleMobilePage(page);

        const writtenFiles = [];
        for (const vp of REPRESENTATIVE_SHOT_VIEWPORTS) {
            await page.setViewportSize(vp);
            for (const scheme of ['light', 'dark']) {
                await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });

                await page.locator('[data-vc-settings-trigger]').first().click();
                await waitForSettingsSheetState(page, true);
                await clickThemeOption(page, scheme, scheme === 'light' ? '浅色' : '深色');
                await closeSettingsSheetAndWaitDidDismiss(page, () =>
                    page.locator('[data-vc-settings-sheet] [data-vc-settings-done]').first().click(),
                );
                await settleMobilePage(page);

                const shotListGeo = await inspectConvoRowSwipeGeometry(
                    page,
                    fixture.conversationKey,
                );
                assert.equal(
                    shotListGeo?.pinHidden,
                    true,
                    `[${vp.width} ${scheme}] 静止截图前 [data-vc-swipe-action="pin"] 必须隐藏`,
                );
                assert.ok(
                    (shotListGeo?.rightEdgeDelta ?? 99) <= 1,
                    `[${vp.width} ${scheme}] 静止截图前 .vc-mobile-convo-card 右边缘须与所在行右边缘对齐，实际 delta=${shotListGeo?.rightEdgeDelta}`,
                );
                assert.equal(
                    shotListGeo?.timeVisible,
                    true,
                    `[${vp.width} ${scheme}] 静止截图前时间文字必须可见且未被遮盖`,
                );

                const listShotName = `mb2-chat-list-${vp.width}-${scheme}.png`;
                const listShotPath = path.join(artifactDir, listShotName);
                await page.screenshot({ path: listShotPath });
                writtenFiles.push(listShotName);
                ctx?.screenshots?.push(listShotPath);

                await rowLocator.click();
                await page.waitForFunction(
                    () => {
                        const convo = document.querySelector('[data-vc-mobile-conversation]');
                        if (convo?.getAttribute('data-vc-conversation-ready') !== 'true') {
                            return false;
                        }
                        const msgs = document.querySelectorAll('[data-vc-chat-msg]');
                        if (msgs.length === 0) return false;
                        const lastEl = msgs[msgs.length - 1];
                        return (
                            lastEl.getBoundingClientRect().height > 0 &&
                            getComputedStyle(lastEl).visibility !== 'hidden'
                        );
                    },
                    null,
                    { timeout: 15000 },
                );
                await settleMobilePage(page);

                const convoShotName = `mb2-chat-conversation-${vp.width}-${scheme}.png`;
                const convoShotPath = path.join(artifactDir, convoShotName);
                await page.screenshot({ path: convoShotPath });
                writtenFiles.push(convoShotName);
                ctx?.screenshots?.push(convoShotPath);

                await page.locator('[data-vc-chat-back]').click();
                await rowLocator.waitFor({ state: 'visible', timeout: 15000 });
                await settleMobilePage(page);
            }
        }

        pageErrors.assertNone();

        const summary = {
            scene: 'mb2-chat',
            conversationKey: fixture.conversationKey,
            reenterHistoryVisibleMs: reenterTiming,
            verifiedSteps: [
                'list-swipe-pin-hidden-at-rest-and-revealed-on-left-swipe',
                'enter-from-chat-list',
                'history-visible-and-grouped',
                'send-and-streaming-reply',
                'stop-streaming-generation',
                'draft-restored-after-leave-and-reenter',
                'failed-send-retains-input-text-and-retries',
                'rotation-preserves-reading-position-and-caps-bubble-width',
            ],
            screenshots: writtenFiles,
        };
        const reportName = 'mb2-chat-report.json';
        fs.writeFileSync(
            path.join(artifactDir, reportName),
            JSON.stringify(summary, null, 2) + '\n',
            { mode: 0o600 },
        );
        writtenFiles.push(reportName);
        return summary;
    } finally {
        await ctx.fixtureHttp?.setOverride?.('vc03m-chat', null);
        await browser.close();
    }
}

export const mb2ChatScene = {
    id: 'mb2-chat',
    title: 'MB2-6 手机对话页：虚拟列表、分组气泡、写穿缓存重进、流式发送/停止、草稿恢复与失败保留',
    needs: ['catalog', 'stack', 'browser'],
    deps: ['catalog-admin'],
    default: false,
    run: sceneMb2Chat,
};
