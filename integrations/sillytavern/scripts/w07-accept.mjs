// W08 retains W07 source/time/final-exit assertions and uses accept-managed's disposable ST/Go/PG and local fixed provider.
// Fixtures may use native storage APIs; every asserted model request is sent
// by the real browser's native textarea/send button, never by a mocked payload.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { MANAGED_MEMORYCORE_DATA } from './lib/paths.mjs';
import { pinVcUi } from './vc-ui-pin.mjs';
import path from 'node:path';
import { createStClient, waitFor } from './managed-lib.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import { createShotBudget, keepSceneShot } from './lib/scene-shots.mjs';
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
const nativeFact = '我平时喜欢喝龙井绿茶。';

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
    const topic = [...text.matchAll(/<vc-long-term-memory>\n([\s\S]*?)\n<\/vc-long-term-memory>/g)];
    const core = [...text.matchAll(/<vc-core-memory>\n([\s\S]*?)\n<\/vc-core-memory>/g)];
    assert.equal(topic.length, 1, '最终请求应恰有一个专用长期记忆块');
    assert.ok(core.length <= 1, '常驻核心记忆最多一块');
    return [topic[0][1], ...core.map((item) => item[1])].join('\n');
}

export async function sceneMemoryBrowser(ctx) {
    const shotBudget = createShotBudget();
    const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: ctx.secrets.session,
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}` });
    const purposes = expect(await ctx.admin.listPurposes(), 200, '读取用途绑定');
    const current = purposes.find((row) => row.purpose === 'FOREGROUND_CHAT');
    assert.ok(current, '前台用途应已登记');
    await reauthForWrite(ctx);
    expect(await ctx.admin.savePurpose('FOREGROUND_CHAT', { providerId: 'vc03m-chat', profileKey: 'chat',
        state: 'ENABLED', expectedRevision: current.revision }), 200, '绑定本地合成前台模型');
    for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
        expect(await ctx.admin.call('PUT', '/api/v1/consents', { consentType, version: 'w08-synthetic', granted: true }), 200, '合成账号模型处理授权');
    }
    const embeddingModel = (await (await fetch('http://127.0.0.1:11438/api/tags')).json()).models.find(m => m.name === 'qwen3-embedding:0.6b');
    assert.ok(embeddingModel, '本机 embedding 模型必须已就绪');
    const existingEmbedding = await ctx.admin.call('GET', '/api/v1/admin/embedding-config');
    expect(await ctx.admin.call('PUT', '/api/v1/admin/embedding-config', { model: embeddingModel.name, artifactVersion: embeddingModel.digest,
        dimensions: 1024, queryPreprocessingVersion: 'qwen3-retrieval-v1', documentPreprocessingVersion: 'identity-v1', normalization: 'l2',
        state: 'ENABLED', expectedRevision: existingEmbedding.status === 200 ? existingEmbedding.json.revision : 0 }), 200, '配置本机 embedding');
    expect(await ctx.admin.saveProvider('vc08-memory', { displayName: 'W08 合成提取', protocol: 'OPENAI_CHAT_COMPLETIONS',
        baseUrl: `http://127.0.0.1:${process.env.VC_W03_FIXTURE_PORT || 8753}/v1`, credential: ctx.secrets.fixtureKey, state: 'ENABLED', expectedRevision: 0,
        models: [{ profileKey: 'memory', modelId: 'vc08-memory', displayName: 'MemoryCore 合成提取', contextWindowTokens: 32768,
            maxOutputTokens: 4096, state: 'ENABLED', capabilities: { systemMessage: 'DECLARED' }, reasoningLevels: [], generationParams: {} }] }), 200, '登记独立提取用途模型');
    // 该模型不写目录价。保存会停用已有手写单价，所以在保存之后写入测试单价。
    ctx.w08.seedSyntheticPrice();
    await ctx.fixtureHttp.setOverride('vc08-memory', { memorycoreDocuments: [{ content: wedding, eventDate: '2026-10-30' },
        { content: reading }, { content: revisedReading }, { content: nativeFact, type: 'persona' }] });
    const extractionPurpose = purposes.find(row => row.purpose === 'MEMORY_EXTRACTION_DEDUP_SUMMARY');
    assert.ok(extractionPurpose);
    expect(await ctx.admin.savePurpose('MEMORY_EXTRACTION_DEDUP_SUMMARY', { providerId: 'vc08-memory', profileKey: 'memory',
        state: 'ENABLED', expectedRevision: extractionPurpose.revision }), 200, '绑定 MemoryCore 提取用途');
    const card = await importSyntheticCard(st, 'W08 长期记忆');
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
    let restrictedRecords;
    const recallDiagnostics = [], nativeDiagnostics = [];
    let phase = '打开原生宿主';
    const step = (name) => { phase = name; console.log(`[memory-browser] ${name}`); };
    try {
        const bc = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' });
        await pinVcUi(bc, 'off');
        await bc.addCookies([{ name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase }]);
        page = await bc.newPage();
        const pageErrors = [];
        page.on('pageerror', () => pageErrors.push('pageerror'));
        page.on('response', response => {
            if (response.url().includes('/st/memory/recall')) void response.json().then(result => recallDiagnostics.push({
                httpStatus: response.status(), status: result.status, blockLength: result.block?.length || 0,
                memories: result.memoryIds?.length || 0, summaries: result.summaryIds?.length || 0,
                sources: result.sources?.map(s => s.state) || [],
            })).catch(() => {});
        });
        page.on('request', request => {
            if (request.url().includes('/api/backends/chat-completions/generate')) {
                try { const body = request.postDataJSON(); nativeDiagnostics.push({ hasMemory: Boolean(body.vc_memory),
                    enabled: body.vc_memory?.enabled, blockLength: body.vc_memory?.block?.length || 0,
                    nativeSlotPresent: JSON.stringify(body.messages || []).includes('<vc-long-term-memory>') }); } catch {}
            }
        });
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
        let memory;
        await waitFor(async () => {
            const rows = expect(await ctx.admin.call('GET', `/api/v1/relationships/${binding.relationshipId}/memories?q=${encodeURIComponent('厦门')}`), 200, '读取正式提取投影');
            memory = rows.find(row => row.summary.includes('厦门') && row.lifecycle === 'ACTIVE' && row.recallEligible);
            return Boolean(memory);
        }, { timeoutMs: 90000, label: '生产队列 MemoryCore 提取并发布婚礼记忆' });
        assert.equal(memory.time?.eventDate, '2026-10-30', '持久事件日期应来自原文，不能成为提取日期');
        assert.equal(memory.time?.reminderAt, null, '仅日期不得生成提醒时刻');

        await waitFor(async () => {
            const sourceTarget = (await readChat(sourceFile))[0].chat_metadata.vc_f2;
            const result = await ctx.admin.call('POST', '/api/v1/st/memory/recall', { chatIdentity: sourceTarget.id,
                revision: sourceTarget.revision, enabled: true, budgetTokens: 1024 });
            return result.status === 200 && result.json.block.includes('会话摘要（引擎归纳）：') && result.json.block.includes('蓝窗书店');
        }, { timeoutMs: 90000, label: '来源核验后的 MemoryCore 摘要发布' });
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
        let firstCharMs=0;
        const send = async (suffix, exactText) => {
            step(`原生发送 ${suffix}`);
            const text = exactText || `我在2026年10月30日准备去哪里，为什么？我们上次读书计划谈到哪一步了？${suffix}`;
            const since = (await ctx.fixtureHttp.captures()).at(-1)?.seq ?? 0;
            await page.locator('#send_textarea').fill(text);
            const count=await page.locator('#chat > .mes').count();const started=performance.now();
            await page.locator('#send_but').click();
            await page.waitForFunction(({count,first})=>{const nodes=document.querySelectorAll('#chat > .mes');return nodes.length>=count+2 && nodes[nodes.length-1]?.querySelector('.mes_text')?.textContent.includes(first);},{count,first:fixedReply[0]});
            firstCharMs=Math.round(performance.now()-started);
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
            const captures = (await ctx.fixtureHttp.captures({ protocol: 'chat', since })).filter((row) => Array.isArray(row.body?.messages) && row.body.model === 'vc03m-chat');
            assert.equal(captures.length, 1, '一次原生输入只触发一条前台生成链');
            assert.equal(captures[0].body.model, 'vc03m-chat');
            return finalText(captures[0]);
        };
        await send('（原生发送后生产提取）', nativeFact);
        let nativeMemory;
        await waitFor(async () => {
            const rows = expect(await ctx.admin.call('GET', `/api/v1/relationships/${binding.relationshipId}/memories?q=${encodeURIComponent('龙井')}`), 200, '读取原生发送后提取');
            nativeMemory = rows.find(row => row.lifecycle === 'ACTIVE' && row.recallEligible && row.summary.includes('龙井'));
            return Boolean(nativeMemory);
        }, { timeoutMs: 90000, label: '原生发送后 MemoryCore 记忆可见' });
        const searched=async()=>((await fs.readFile(path.join(ctx.artifactsDir,'go.log'),'utf8')).match(/msg="memory recall"|"msg"\s*:\s*"memory recall"/g)||[]).length;
        const gateMeasurements=[];
        for(const [kind,text] of [['greeting','你好'],['emotion','我好难过'],['emoji','😭']]){
            const beforeSearch=await searched();await send('（RQ-4 合成门控测量）',text);
            gateMeasurements.push({kind,searchCalls:(await searched())-beforeSearch,firstCharMs});
        }
        await fs.writeFile(path.join(ctx.artifactsDir,'rq4-recall.json'),JSON.stringify({samples:gateMeasurements})+'\n');
        ctx.results.rq4Recall={samples:gateMeasurements};
        assert.equal(gateMeasurements.reduce((sum,row)=>sum+row.searchCalls,0),0,'RQ-4 纯回应不能触发初次或出站复核检索');
        const first = historyBlock(await send('（第一轮合成验证）'));
        for (const fact of ['厦门', '朋友婚礼', '2026-10-30']) assert.ok(first.includes(fact), `M01 最终记忆块缺少 ${fact}`);
        assert.ok(first.includes('会话摘要（引擎归纳）：') && first.includes('蓝窗书店') && first.includes('下一步还没决定读哪一本'),
            'M09 来源可追溯摘要必须真正进入新聊天最终请求');
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'M01-M09-memory-browser.png') });
        ctx.screenshots.push('M01-M09-memory-browser.png');

        step('记忆页列表、来源、纠正冲突与手机布局');
        const isolatedIdentity = crypto.randomUUID();
        const isolatedFile = `W08-isolated-${crypto.randomUUID()}`;
        await saveChat(isolatedFile, [{ chat_metadata: { vc_f2: { id: isolatedIdentity, revision: 0 } } },
            { name: card.name, is_user: false, mes: '独立实例的合成空会话。', extra: {} }]);
        const isolated = expect(await ctx.admin.call('POST', '/api/v1/st/bindings', { chatIdentity: isolatedIdentity,
            characterRef: crypto.randomUUID(), mode: 'COMPANION', displayName: '独立记忆实例' }), 200, '建立独立实例');
        assert.notEqual(isolated.relationshipId, binding.relationshipId);
        await page.locator('#extensionsMenuButton').click();
        await page.locator('#vc_memory_menu_button').click();
        const dialog = page.locator('.vc-memory-dialog');
        await dialog.waitFor({ state: 'visible' });
        await dialog.locator(`[data-memory-id="${nativeMemory.memoryId}"]`).waitFor();
        await dialog.locator('#vc-memory-instance').selectOption(isolated.relationshipId);
        await dialog.getByText('没有找到记忆。试试其他关键词或筛选条件。').waitFor();
        assert.equal(await dialog.locator('.vc-memory-row').count(), 0, '独立实例列表不能出现原实例记忆');
        await dialog.locator('#vc-memory-instance').selectOption(binding.relationshipId);
        await dialog.locator(`[data-memory-id="${nativeMemory.memoryId}"]`).click();
        await dialog.locator('.vc-memory-detail-body').waitFor();
        assert.ok((await dialog.locator('.vc-memory-detail-body').innerText()).includes('龙井'), '原生提取必须在记忆页可见');
        await dialog.locator('[data-form="filters"] input[name="q"]').fill('厦门');
        await dialog.locator('[data-form="filters"] .vc-memory-search button[type="submit"]').click();
        await dialog.locator(`[data-memory-id="${memory.memoryId}"]`).click();
        await dialog.locator('[data-action="edit"]').click();
        const draft = '用户计划于2026年10月30日去厦门参加朋友婚礼，穿绿色礼服。';
        await dialog.locator('#vc-memory-draft').fill(draft);
        const conflictBody = { summary: draft.replace('绿色礼服', '蓝色礼服'), expectedVersion: memory.version };
        await reauthForWrite(ctx); expect(await ctx.admin.call('PATCH', `/api/v1/memories/${memory.memoryId}`, conflictBody), 200, '第二客户端并发纠正');
        const conflictResponse = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes(`/memories/${memory.memoryId}`));
        await dialog.locator('[data-form="edit"] button[type="submit"]').click();
        assert.equal((await conflictResponse).status(), 409, '陈旧版本必须返回409');
        await dialog.getByText('这条记忆已在另一处更新。你的输入已保留，请刷新详情后继续。').waitFor();
        assert.equal(await dialog.locator('#vc-memory-draft').inputValue(), draft, '冲突不能丢失草稿');
        await dialog.locator('[data-action="refresh-detail"]').click();
        await waitFor(() => dialog.locator('[data-form="edit"] button[type="submit"]').isEnabled(), { label: '刷新后新版本允许保存' });
        const correctedResponse = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes('/memories/'));
        await dialog.locator('[data-form="edit"] button[type="submit"]').click();
        const corrected = await correctedResponse;
        assert.equal(corrected.status(), 200);
        const replacement = await corrected.json();
        assert.notEqual(replacement.memoryId, memory.memoryId, '纠正创建新记录');
        memory = replacement;
        await dialog.getByText('纠正已保存，原记录已被替代。').waitFor();
        for (const width of [1440, 360, 390]) {
            await page.setViewportSize({ width, height: 900 });
            assert.ok(await dialog.locator('.vc-memory-detail-body').isVisible());
            assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${width}px 记忆页不得横向溢出`);
            await dialog.locator('[data-action="edit"]').click();
            assert.equal(await dialog.locator('#vc-memory-draft').evaluate(el => el === document.activeElement), true, '纠正框获得焦点');
            await dialog.locator('[data-action="cancel-edit"]').click();
            await dialog.locator('[data-action="confirm-forget"]').click();
            await dialog.locator('[data-forget-dialog][open]').waitFor();
            await page.keyboard.press('Escape');
            assert.equal(await dialog.locator('[data-forget-dialog]').evaluate(el => el.open), false, 'Escape关闭确认框');
            assert.equal(await dialog.locator('[data-action="confirm-forget"]').evaluate(el => el === document.activeElement), true, '确认框关闭返回原按钮焦点');
            const shotName = `W08-memory-${width}.png`;
            if (keepSceneShot(shotBudget, shotName)) {
                await page.screenshot({ path: path.join(ctx.artifactsDir, shotName) });
                ctx.screenshots.push(shotName);
            }
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await dialog.locator('[data-action="close"]').click();
        assert.equal(await page.locator('#extensionsMenuButton').evaluate(el => el === document.activeElement && el.getClientRects().length > 0), true, '记忆页关闭回到可见扩展菜单入口焦点');
        await setMemory(false);
        const disabled = await send('（关闭记忆合成验证）');
        assert.equal(disabled.includes('<vc-long-term-memory>'), false, '关闭开关后实际出站不能保留旧块');
        assert.equal(disabled.includes('<vc-core-memory>'), false, '关闭开关后不能保留常驻摘要');
        step('遗忘婚礼并编辑旧聊天来源');
                await page.locator('#extensionsMenuButton').click();
        await page.locator('#vc_memory_menu_button').click();
        await dialog.locator(`[data-memory-id="${memory.memoryId}"]`).click();
        await dialog.locator('[data-action="confirm-forget"]').click();
        // A real filesystem write failure exercises PARTIAL without adding a
        // production fault switch. Only this synthetic owner's records directory
        // is made read-only, and finally always restores it before stack cleanup.
        restrictedRecords = path.join(MANAGED_MEMORYCORE_DATA, 'owners', ctx.secrets.session.accountId, 'records');
        await fs.chmod(restrictedRecords, 0o500);
        await reauthForWrite(ctx);
        const forgetResponse = page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().includes(`/memories/${memory.memoryId}`));
        await dialog.locator('[data-forget-dialog] [data-action="forget"]').click();
        assert.equal((await forgetResponse).status(), 202, '遗忘立即进入异步清理');
        let cleanup;
        await waitFor(async () => {
            cleanup = expect(await ctx.admin.call('GET', `/api/v1/memories/${memory.memoryId}`), 200, '读取遗忘清理状态');
            return cleanup.cleanup?.state === 'PARTIAL';
        }, { timeoutMs: 30000, label: '真实文件写失败显示部分清理' });
        await dialog.locator('[data-action="refresh-detail"]').click();
        await dialog.getByText(cleanup.cleanup.state === 'DONE' ? '本次记忆清理已完成。聊天原文和备份不在本次删除范围内。' : '清理部分完成：记忆已停止召回，仍有内容未清理。', { exact: false }).waitFor();
        assert.equal(cleanup.recallEligible, false);
        await fs.chmod(restrictedRecords, 0o700); restrictedRecords = undefined;
        await waitFor(async () => {
            cleanup = expect(await ctx.admin.call('GET', `/api/v1/memories/${memory.memoryId}`), 200, '读取恢复后清理状态');
            return cleanup.cleanup?.state === 'DONE';
        }, { timeoutMs: 30000, label: '同一清理意图恢复完成' });
        await dialog.locator('[data-action="refresh-detail"]').click();
        await dialog.getByText('本次记忆清理已完成。聊天原文和备份不在本次删除范围内。', { exact: false }).waitFor();
        await dialog.locator('[data-action="close"]').click();
        const edited = await readChat(sourceFile);
        edited[2].mes = revisedReading;
        await saveChat(sourceFile, edited); // Deliberately omit browser reconciliation notification.
        await setMemory(true);
        // No source-change notification was sent. Production recall discovers
        // the edit; the existing queue rebuilds MemoryCore summaries asynchronously.
        // Wait for that published current dependency set before the asserted send.
        await waitFor(async () => {
            const target = (await readChat(queryFile))[0].chat_metadata.vc_f2;
            const recalled = await ctx.admin.call('POST', '/api/v1/st/memory/recall', { chatIdentity: target.id, revision: target.revision,
                enabled: true, budgetTokens: 1024 });
            return recalled.status === 200 && recalled.json.block.includes(revisedReading) && !recalled.json.block.includes('蓝窗书店');
        }, { timeoutMs: 90000, label: '漏报编辑经召回发现并异步重建当前来源摘要' });
        const third = historyBlock(await send('（来源变更合成验证）'));
        assert.equal(third.includes('厦门'), false, '遗忘来源不能通过旧摘要复活');
        assert.equal(third.includes('朋友婚礼'), false, '被遗忘记忆不能留在最终请求');
        assert.equal(third.includes('蓝窗书店'), false, '旧聊天漏报编辑仍须失效旧摘要');
        assert.ok(third.includes(revisedReading), '新摘要必须来自编辑后真实持久来源');
        assert.equal(pageErrors.length, 0, '原生记忆流程不得有未捕获页面异常');
        ctx.results.memoryBrowser = { cases: ['M01', 'M09', 'M05-current-request'], precedingNoiseRecords: 101,
            nativeGenerations: 7, nativeExtractionVisible: true, correctionConflict: true, crossInstanceListIsolated: true, cleanupStates: ['PARTIAL', cleanup.cleanup.state], widths: [1440,360,390], summaryFromOtherChat: true, disabledBlockAbsent: true,
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
            console.error(`[memory-browser] failure ${JSON.stringify({ phase, ...state, recallDiagnostics, nativeDiagnostics })}`);
            await page.screenshot({ path: path.join(ctx.artifactsDir, 'memory-browser-failed.png') }).catch(() => {});
        }
        throw new Error(`${phase}: ${error.message}`, { cause: error });
    } finally {
        if (restrictedRecords) await fs.chmod(restrictedRecords, 0o700);
        await browser.close();
    }
}

export const memoryBrowserScene = {
    id: 'memory-browser',
    title: 'W08 正式提取、管理纠正遗忘与W07原生最终请求',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneMemoryBrowser,
};
export const scenes = [memoryBrowserScene];
