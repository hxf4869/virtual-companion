// 线上提取模型形状：OpenAI Chat Completions、reasoningEffort=max、
// 除 systemMessage 外能力 UNKNOWN、temperature/topP 为 null、超大上下文与输出上限。
// 一轮会写记忆的聊天必须让 ST_MEMORY_EXTRACT 变为 DONE，且记忆入库。
// 已死信的历史任务不在这里重放。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { createStClient, waitFor } from './managed-lib.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import { pinVcUi } from './vc-ui-pin.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';

const fact = '我计划于2026年11月02日去青岛参观海带博物馆。';
const providerId = 'vc-extract-prod';
const modelId = 'deepseek-v4.1-flash';

const expect = (r, status, label) => {
    assert.equal(r.status, status, `${label}: HTTP ${r.status} (${r.json?.code || 'native'})`);
    return r.json;
};

async function nativeReady(page) {
    await page.waitForFunction(() => Boolean(window.SillyTavern?.getContext?.()?.eventSource));
    await waitFor(() => page.evaluate(async () => Boolean((await import('/script.js')).settingsReady)
        || Boolean(document.querySelector('dialog[open] .onboarding'))), { timeoutMs: 30000, label: '原生设置或欢迎页就绪' });
    const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
    if (await onboarding.count()) {
        await onboarding.locator('textarea').fill('提取形状验收用户');
        await onboarding.locator('.popup-button-ok').click();
        await onboarding.waitFor({ state: 'hidden' });
    }
    await waitFor(() => page.evaluate(async () => Boolean((await import('/script.js')).settingsReady)),
        { timeoutMs: 30000, label: '原生设置完成' });
    await page.waitForSelector('#preloader', { state: 'hidden' });
    await page.waitForSelector('#vc-memory-controls', { state: 'attached' });
}

export async function sceneMemoryExtractProd(ctx) {
    const before = new Set(ctx.w08.extractJobs().map((job) => String(job.id)));
    const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: ctx.secrets.session,
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}` });
    const purposes = expect(await ctx.admin.listPurposes(), 200, '读取用途绑定');
    await reauthForWrite(ctx);
    for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
        expect(await ctx.admin.call('PUT', '/api/v1/consents', { consentType, version: 'mem-extract-synthetic', granted: true }), 200, '合成账号授权');
    }
    const embeddingModel = (await (await fetch('http://127.0.0.1:11438/api/tags')).json()).models.find((m) => m.name === 'qwen3-embedding:0.6b');
    assert.ok(embeddingModel, '本机 embedding 模型必须已就绪');
    const existingEmbedding = await ctx.admin.call('GET', '/api/v1/admin/embedding-config');
    expect(await ctx.admin.call('PUT', '/api/v1/admin/embedding-config', { model: embeddingModel.name, artifactVersion: embeddingModel.digest,
        dimensions: 1024, queryPreprocessingVersion: 'qwen3-retrieval-v1', documentPreprocessingVersion: 'identity-v1', normalization: 'l2',
        state: 'ENABLED', expectedRevision: existingEmbedding.status === 200 ? existingEmbedding.json.revision : 0 }), 200, '配置本机 embedding');
    const unknown = 'UNKNOWN';
    expect(await ctx.admin.saveProvider(providerId, { displayName: '线上形状提取', protocol: 'OPENAI_CHAT_COMPLETIONS',
        baseUrl: `http://127.0.0.1:${process.env.VC_W03_FIXTURE_PORT || 8753}/v1`, credential: ctx.secrets.fixtureKey, state: 'ENABLED', expectedRevision: 0,
        models: [{ profileKey: 'memory', modelId, displayName: '线上形状提取模型', contextWindowTokens: 1000000,
            maxOutputTokens: 262144, state: 'ENABLED', reasoningLevels: ['max'],
            capabilities: { imageInput: unknown, videoInput: unknown, pdfInput: unknown, structuredOutput: unknown,
                toolCalls: unknown, nativeWebSearch: unknown, systemMessage: 'DECLARED', temperature: unknown, topP: unknown },
            generationParams: { temperature: null, topP: null, reasoningEffort: 'max' } }] }), 200, '登记线上形状提取模型');
    ctx.w10.psql(`INSERT INTO vc.model_unit_price(provider_id,model_id,price_version,input_usd_per_1k,output_usd_per_1k) VALUES ('${providerId}','${modelId}',1,0.001,0.002) ON CONFLICT DO NOTHING;`);
    await ctx.fixtureHttp.setOverride(modelId, { memorycoreDocuments: [{ content: fact, eventDate: '2026-11-02' }] });
    const extraction = purposes.find((row) => row.purpose === 'MEMORY_EXTRACTION_DEDUP_SUMMARY');
    assert.ok(extraction, '提取用途应已登记');
    expect(await ctx.admin.savePurpose('MEMORY_EXTRACTION_DEDUP_SUMMARY', { providerId, profileKey: 'memory',
        state: 'ENABLED', expectedRevision: extraction.revision }), 200, '绑定线上形状提取用途');

    const card = await importSyntheticCard(st, '线上形状长期记忆');
    const sourceFile = `mem-extract-${crypto.randomUUID()}`;
    const sourceToken = { id: crypto.randomUUID(), revision: 0 };
    const sourceRows = [{ chat_metadata: { vc_f2: sourceToken } },
        { name: '合成用户', is_user: true, mes: fact, send_date: '2026-11-02T20:00:00+08:00', extra: {} }];
    prepareSourceIdentities(sourceRows, { settled: true, sourceTimezone: 'Asia/Shanghai' });
    expect(await st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: sourceFile, chat: sourceRows }), 200, '保存会写记忆的聊天');

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    let page;
    try {
        const bc = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' });
        await pinVcUi(bc, 'off');
        await bc.addCookies([{ name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase }]);
        page = await bc.newPage();
        await page.goto(ctx.w05.stBase, { waitUntil: 'domcontentloaded' });
        await nativeReady(page);
        await page.waitForFunction((avatar) => window.SillyTavern.getContext().characters.some((c) => c.avatar === avatar), card.avatar);
        await page.evaluate(async ({ avatar, file }) => {
            const native = await import('/script.js');
            const index = native.characters.findIndex((c) => c.avatar === avatar);
            if (index < 0) throw new Error('合成角色未加载');
            await native.selectCharacterById(index);
            await native.openCharacterChat(file);
        }, { avatar: card.avatar, file: sourceFile });
        await page.waitForFunction(() => typeof window.SillyTavern.getContext().chatMetadata?.vc_binding?.conversationId === 'string');
        await page.evaluate(() => window.SillyTavern.getContext().saveChat());
        const binding = await page.evaluate(() => window.SillyTavern.getContext().chatMetadata.vc_binding);
        expect(await ctx.admin.call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [sourceToken.id] }), 200, '核对聊天来源');

        let memory;
        await waitFor(async () => {
            const jobs = ctx.w08.extractJobs().filter((job) => !before.has(String(job.id)));
            if (jobs.some((job) => job.status === 'DEAD_LETTERED' || job.status === 'FAILED')) {
                throw new Error(`提取任务失败 ${JSON.stringify(jobs)}`);
            }
            if (!jobs.length || jobs.some((job) => job.status !== 'DONE')) return false;
            const rows = expect(await ctx.admin.call('GET', `/api/v1/relationships/${binding.relationshipId}/memories?q=${encodeURIComponent('海带博物馆')}`), 200, '读取提取记忆');
            memory = rows.find((row) => row.summary.includes('海带博物馆') && row.lifecycle === 'ACTIVE' && row.recallEligible);
            return Boolean(memory);
        }, { timeoutMs: 180000, label: '线上形状模型提取完成并入库' });
        assert.equal(memory.time?.eventDate, '2026-11-02', '事件日期应来自原文');
        const fresh = ctx.w08.extractJobs().filter((job) => !before.has(String(job.id)));
        assert.ok(fresh.length >= 1 && fresh.every((job) => job.status === 'DONE'), `提取任务应全部 DONE：${JSON.stringify(fresh)}`);
        const idList = fresh.map((job) => BigInt(job.id)).join(',');
        const models = ctx.w10.psql(`SELECT COALESCE(string_agg(DISTINCT model_id, ','), '') FROM vc.memory_extract_attempt WHERE work_item_id IN (${idList});`).trim();
        assert.equal(models, modelId, '提取尝试必须走线上形状模型');
        assert.match(String(binding.relationshipId), /^[1-9][0-9]*$/);
        const profiles = ctx.w10.psql(`SELECT count(*) FROM vc.memory_profile WHERE relationship_id = ${binding.relationshipId} AND valid AND btrim(persona) <> '';`).trim();
        assert.ok(Number(profiles) >= 1, '画像应写入当前关系且 persona 非空');
        const calls = (await ctx.fixtureHttp.captures({ protocol: 'chat' })).filter((row) => row.body?.model === modelId);
        assert.ok(calls.length >= 1, '提取请求应到达模型，而不是在回调里 4ms 被拒');
        for (const row of calls) {
            assert.equal(row.body.reasoning_effort, 'max');
            assert.equal(row.body.temperature, undefined);
            assert.equal(row.body.top_p, undefined);
            assert.equal(row.body.max_tokens, 4096, '超大 maxOutputTokens 必须在回调里封顶，不能原样送出');
            assert.ok(row.body.messages.some((message) => message.role === 'system'), '已声明的 systemMessage 应保留 system 角色');
        }
    } catch (error) {
        if (page) await page.screenshot({ path: path.join(ctx.artifactsDir, 'memory-extract-prod-failed.png') }).catch(() => {});
        throw error;
    } finally {
        await browser.close();
    }
}

export const memoryExtractProdScene = {
    id: 'memory-extract-prod',
    title: '线上形状提取模型：reasoning max、未声明采样、超大窗口，一轮聊天入库',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneMemoryExtractProd,
};
