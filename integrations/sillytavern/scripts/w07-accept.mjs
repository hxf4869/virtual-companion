// W07 uses accept-managed's disposable ST/Go/PG and local fixed provider.
// Fixtures may use native storage APIs; every asserted model request is sent
// by the real browser's native textarea/send button, never by a mocked payload.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { createStClient, waitFor } from './managed-lib.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';

const expect = (r, status, label) => {
    assert.equal(r.status, status, `${label}: HTTP ${r.status} (${r.json?.code || 'native'})`);
    return r.json;
};
const fixedReply = '收到。这是受管验收的合成回复，内容固定可断言。';
const wedding = '我计划于2026年10月30日去厦门参加朋友婚礼。';
const reading = '我们正在讨论一份蓝窗书店的读书计划，下一步还没决定读哪一本。';
const revisedReading = '我们决定暂停读书计划，等下次再选书。';

async function nativeReady(page) {
    await page.waitForFunction(() => Boolean(window.SillyTavern?.getContext?.()?.eventSource));
    // Node polls resolved values: an async browser wait predicate may be
    // interpreted as truthy before its Promise resolves by the pinned runtime.
    await waitFor(() => page.evaluate(async () => Boolean((await import('/script.js')).settingsReady)
        || Boolean(document.querySelector('dialog[open] .onboarding'))), { timeoutMs: 30000, label: '原生设置或欢迎页就绪' });
    const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
    if (await onboarding.count()) {
        await onboarding.locator('textarea').fill('W07 合成验收用户');
        await onboarding.locator('.popup-button-ok').click();
        await onboarding.waitFor({ state: 'hidden' });
    }
    await waitFor(() => page.evaluate(async () => Boolean((await import('/script.js')).settingsReady)),
        { timeoutMs: 30000, label: '原生设置完成' });
    await page.waitForSelector('#preloader', { state: 'hidden' });
    await page.waitForSelector('#vc-memory-controls', { state: 'attached' });
}

function finalText(capture) {
    return capture.body.messages.map((m) => typeof m.content === 'string' ? m.content
        : (m.content || []).map((part) => part.text || '').join('\n')).join('\n');
}
function historyBlock(text) {
    const blocks = [...text.matchAll(/<vc-long-term-memory>\n([\s\S]*?)\n<\/vc-long-term-memory>/g)];
    assert.equal(blocks.length, 1, '最终请求应恰有一个专用长期记忆块');
    return blocks[0][1];
}

export async function sceneMemoryBrowser(ctx) {
    const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: ctx.secrets.session,
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}` });
    const purposes = expect(await ctx.admin.listPurposes(), 200, '读取用途绑定');
    const current = purposes.find((row) => row.purpose === 'FOREGROUND_CHAT');
    assert.ok(current, '前台用途应已登记');
    expect(await ctx.admin.savePurpose('FOREGROUND_CHAT', { providerId: 'vc03m-chat', profileKey: 'chat',
        state: 'ENABLED', expectedRevision: current.revision }), 200, '绑定本地合成前台模型');
    const card = await importSyntheticCard(st, 'W07 长期记忆');
    const sourceFile = `W07-source-${crypto.randomUUID()}`;
    const queryFile = `W07-query-${crypto.randomUUID()}`;
    const sourceToken = { id: crypto.randomUUID(), revision: 0 };
    const sourceRows = [{ chat_metadata: { vc_f2: sourceToken } },
        { name: '合成用户', is_user: true, mes: wedding, send_date: '2026-10-20T20:00:00+08:00', extra: {} },
        { name: '合成用户', is_user: true, mes: reading, send_date: '2026-10-21T20:00:00+08:00', extra: {} }];
    prepareSourceIdentities(sourceRows, { settled: true, sourceTimezone: 'Asia/Shanghai' });
    const readChat = async (file) => expect(await st.call('POST', '/api/chats/get', { avatar_url: card.avatar, file_name: file }), 200, '读取已保存聊天');
    const saveChat = async (file, chat) => expect(await st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file, chat }), 200, '保存合成聊天');
    await saveChat(sourceFile, sourceRows);

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    let page;
    let phase = '打开原生宿主';
    const step = (name) => { phase = name; console.log(`[memory-browser] ${name}`); };
    try {
        const bc = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' });
        await bc.addCookies([{ name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase }]);
        page = await bc.newPage();
        const pageErrors = [];
        page.on('pageerror', () => pageErrors.push('pageerror'));
        await page.goto(ctx.w05.stBase, { waitUntil: 'domcontentloaded' });
        await nativeReady(page);
        const openChat = async (file) => {
            step(file === sourceFile ? '打开并绑定来源聊天' : '打开并绑定新查询聊天');
            await page.waitForFunction((avatar) => window.SillyTavern.getContext().characters.some((c) => c.avatar === avatar), card.avatar);
            await page.evaluate(async ({ avatar, file }) => {
                const native = await import('/script.js');
                const index = native.characters.findIndex((c) => c.avatar === avatar);
                if (index < 0) throw new Error('合成角色未加载');
                await native.selectCharacterById(index);
                await native.openCharacterChat(file);
            }, { avatar: card.avatar, file });
            await page.waitForFunction(() => typeof window.SillyTavern.getContext().chatMetadata?.vc_binding?.conversationId === 'string');
            await page.evaluate(() => window.SillyTavern.getContext().saveChat());
            return page.evaluate(() => window.SillyTavern.getContext().chatMetadata.vc_binding);
        };
        const binding = await openChat(sourceFile);
        expect(await ctx.admin.call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [sourceToken.id] }), 200, '核对旧聊天来源');
        const persistedSource = await readChat(sourceFile);
        const message = persistedSource[1];
        const source = message.extra.vc_source;
        const evidence = `st:${sourceToken.id}:${message.vc_message_id}:${source.id}:${source.revision}:1`;
        const createConfirmed = async (summary, refs = []) => {
            const created = expect(await ctx.admin.call('POST', `/api/v1/relationships/${binding.relationshipId}/memories/candidates`, {
                scope: 'RELATIONSHIP', conversationId: binding.conversationId, summary, evidence: refs,
            }), 200, '建立合成记忆候选');
            return expect(await ctx.admin.call('POST', `/api/v1/memories/${created.memoryId}/confirm`, {}), 200, '确认合成记忆');
        };
        // More than the old candidate window precedes the only relevant fact.
        step('建立 101 条无关记忆与婚礼事实');
        for (let n = 1; n <= 101; n++) await createConfirmed(`用户收藏了编号${n}的几何书签。`);
        const memory = await createConfirmed('用户计划于2026年10月30日去厦门参加朋友婚礼。', [evidence]);
        assert.equal(memory.time?.eventDate, '2026-10-30', '持久事件日期应来自原文，不能成为提取日期');
        assert.equal(memory.time?.reminderAt, null, '仅日期不得生成提醒时刻');

        const queryToken = { id: crypto.randomUUID(), revision: 0 };
        const queryRows = [{ chat_metadata: { vc_f2: queryToken,
            vc_binding: { relationshipId: binding.relationshipId, mode: 'COMPANION' } } },
        { name: card.name, is_user: false, mes: '这是一个全新的合成会话。', extra: {} }];
        prepareSourceIdentities(queryRows, { settled: true, sourceTimezone: 'Asia/Shanghai' });
        await saveChat(queryFile, queryRows);
        const queryBinding = await openChat(queryFile);
        assert.equal(queryBinding.relationshipId, binding.relationshipId);
        assert.notEqual(queryBinding.conversationId, binding.conversationId);
        assert.equal(JSON.stringify(await readChat(queryFile)).includes('厦门'), false, '新聊天不能已含目标事实');
        step('等待前台模型投影');
        await page.waitForFunction(() => {
            const c = window.SillyTavern.getContext();
            return c.mainApi === 'openai' && String(c.chatCompletionSettings?.custom_url || '').includes('provider=vc03m-chat&profile=chat');
        });
        const setMemory = async (enabled) => {
            step(enabled ? '通过原生控件开启长期记忆' : '通过原生控件关闭长期记忆');
            if (!(await page.locator('[data-memory-enabled]').isVisible())) await page.locator('#extensions-settings-button .drawer-toggle').click();
            await page.locator('[data-memory-enabled]').setChecked(enabled);
            await page.locator('[data-memory-budget]').fill('1024');
            await page.locator('[data-memory-budget]').press('Tab');
            // The first visit may use the enabled-by-default setting without
            // creating a vc_memory object. Checking an already checked input
            // correctly emits no change; do not wait for a redundant write.
            await page.waitForFunction((value) => (window.SillyTavern.getContext().extensionSettings.vc_memory?.enabled !== false) === value, enabled);
            await page.locator('#extensions-settings-button .drawer-toggle').click();
            await page.locator('[data-memory-enabled]').waitFor({ state: 'hidden' });
        };
        await setMemory(true);
        if (await page.locator('#send_but.displayNone').count()) {
            step('原生连接本地固定 provider');
            if (!(await page.locator('#api_button_openai').isVisible())) await page.locator('#API-status-top').click();
            await page.locator('#api_button_openai').click();
            await page.waitForFunction(() => !document.querySelector('#send_but')?.classList.contains('displayNone'));
            if (await page.locator('#api_button_openai').isVisible()) await page.locator('#API-status-top').click();
        }
        const send = async (suffix) => {
            step(`原生发送 ${suffix}`);
            const text = `我在2026年10月30日准备去哪里，为什么？我们上次读书计划谈到哪一步了？${suffix}`;
            const since = (await ctx.fixtureHttp.captures()).at(-1)?.seq ?? 0;
            await page.locator('#send_textarea').fill(text);
            await page.locator('#send_but').click();
            await page.waitForFunction(({ text, fixedReply }) => {
                const chat = window.SillyTavern.getContext().chat;
                const stop = document.querySelector('#mes_stop');
                return (!stop || getComputedStyle(stop).display === 'none')
                    && chat.at(-2)?.is_user && chat.at(-2)?.mes === text && chat.at(-1)?.mes === fixedReply;
            }, { text, fixedReply }, { timeout: 45000 });
            await waitFor(async () => {
                const rows = await readChat(queryFile);
                return rows.at(-2)?.mes === text && rows.at(-1)?.mes === fixedReply;
            }, { timeoutMs: 15000, label: '本轮原生回复持久化' });
            const captures = (await ctx.fixtureHttp.captures({ protocol: 'chat', since })).filter((row) => Array.isArray(row.body?.messages));
            assert.equal(captures.length, 1, '一次原生输入只触发一条前台生成链');
            assert.equal(captures[0].body.model, 'vc03m-chat');
            return finalText(captures[0]);
        };
        const first = historyBlock(await send('（第一轮合成验证）'));
        for (const fact of ['厦门', '朋友婚礼', '2026-10-30']) assert.ok(first.includes(fact), `M01 最终记忆块缺少 ${fact}`);
        assert.ok(first.includes('会话摘要（来源摘录）：') && first.includes('蓝窗书店') && first.includes('下一步还没决定读哪一本'),
            'M09 来源可追溯摘要必须真正进入新聊天最终请求');
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'M01-M09-memory-browser.png') });
        ctx.screenshots.push('M01-M09-memory-browser.png');

        await setMemory(false);
        assert.equal((await send('（关闭记忆合成验证）')).includes('<vc-long-term-memory>'), false, '关闭开关后实际出站不能保留旧块');
        step('遗忘婚礼并编辑旧聊天来源');
        expect(await ctx.admin.call('DELETE', `/api/v1/memories/${memory.memoryId}`), 200, '遗忘婚礼记忆');
        const edited = await readChat(sourceFile);
        edited[2].mes = revisedReading;
        await saveChat(sourceFile, edited); // Deliberately omit browser reconciliation notification.
        await setMemory(true);
        const third = historyBlock(await send('（来源变更合成验证）'));
        assert.equal(third.includes('厦门'), false, '遗忘来源不能通过旧摘要复活');
        assert.equal(third.includes('朋友婚礼'), false, '被遗忘记忆不能留在最终请求');
        assert.equal(third.includes('蓝窗书店'), false, '旧聊天漏报编辑仍须失效旧摘要');
        assert.ok(third.includes(revisedReading), '新摘要必须来自编辑后真实持久来源');
        assert.equal(pageErrors.length, 0, '原生记忆流程不得有未捕获页面异常');
        ctx.results.memoryBrowser = { cases: ['M01', 'M09', 'M05-current-request'], precedingNoiseRecords: 101,
            nativeGenerations: 3, summaryFromOtherChat: true, disabledBlockAbsent: true,
            forgottenSourceAbsent: true, unreportedEditReconciled: true, realModelCalls: false };
    } catch (error) {
        if (page && !page.isClosed()) {
            // Only structural state enters diagnostics. Source text, cookies,
            // credentials and model request bodies stay out of logs/artifacts.
            const state = await page.evaluate(() => {
                const c = window.SillyTavern?.getContext?.();
                return { path: location.pathname, mainApi: c?.mainApi,
                    managedChat: String(c?.chatCompletionSettings?.custom_url || '').includes('provider=vc03m-chat&profile=chat'),
                    chatLength: c?.chat?.length, bound: Boolean(c?.chatMetadata?.vc_binding?.conversationId),
                    memoryEnabled: c?.extensionSettings?.vc_memory?.enabled ?? null,
                    memoryBudget: c?.extensionSettings?.vc_memory?.budgetTokens ?? null,
                    toggleChecked: document.querySelector('[data-memory-enabled]')?.checked,
                    stopVisible: Boolean(document.querySelector('#mes_stop') && getComputedStyle(document.querySelector('#mes_stop')).display !== 'none') };
            }).catch(() => ({ pageStateUnavailable: true }));
            console.error(`[memory-browser] failure ${JSON.stringify({ phase, ...state })}`);
            await page.screenshot({ path: path.join(ctx.artifactsDir, 'memory-browser-failed.png') }).catch(() => {});
        }
        throw new Error(`${phase}: ${error.message}`, { cause: error });
    } finally {
        await browser.close();
    }
}
