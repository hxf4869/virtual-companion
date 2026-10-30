// 无同意账号进入外壳后出现同意页，同意后一轮聊天写入记忆，撤回一项后再次进入仍出现同意页。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStClient, waitFor } from './managed-lib.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import { pinVcUi } from './vc-ui-pin.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';
import { REQUIRED_CONSENTS } from '../extension/vc-model-settings/consent.js';

const fact = '我计划于2026年12月03日去大连看灯塔。';
const providerId = 'vc-consent-extract';
const modelId = 'consent-extract-model';
const INTEG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = path.join(INTEG, 'dev-managed', 'artifacts', 'consent-ui');

const expect = (result, status, label) => {
    assert.equal(result.status, status, `${label}: HTTP ${result.status} (${result.json?.code || 'native'})`);
    return result.json;
};

async function nativeReady(page) {
    await page.waitForFunction(() => Boolean(window.SillyTavern?.getContext?.()?.eventSource));
    await waitFor(() => page.evaluate(async () => Boolean((await import('/script.js')).settingsReady)
        || Boolean(document.querySelector('dialog[open] .onboarding'))), { timeoutMs: 30000, label: '原生设置或欢迎页就绪' });
    const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
    if (await onboarding.count()) {
        await onboarding.locator('textarea').fill('同意验收用户');
        await onboarding.locator('.popup-button-ok').click();
        await onboarding.waitFor({ state: 'hidden' });
    }
    await waitFor(() => page.evaluate(async () => Boolean((await import('/script.js')).settingsReady)),
        { timeoutMs: 30000, label: '原生设置完成' });
    await page.waitForSelector('#preloader', { state: 'hidden' });
}

async function shoot(page, name) {
    const files = [];
    for (const theme of ['light', 'dark']) {
        for (const [width, height] of [[390, 844], [1440, 900]]) {
            await page.setViewportSize({ width, height });
            await page.emulateMedia({ colorScheme: theme });
            await page.evaluate((mode) => {
                document.documentElement.setAttribute('data-vc-theme', mode);
                try { localStorage.setItem('vc-theme', mode); } catch { /* 截图仍写在属性上 */ }
            }, theme);
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const file = path.join(SHOT_DIR, `${name}-${width}-${theme}.png`);
            await page.screenshot({ path: file });
            files.push(file);
        }
    }
    return files;
}

async function openPrivacy(page) {
    if (await page.evaluate(() => window.innerWidth < 744 && document.querySelector('#vc-shell')?.dataset.chat === 'open')) {
        await page.locator('#vc-shell [data-back]').first().click();
        await page.waitForFunction(() => document.querySelector('#vc-shell')?.dataset.chat !== 'open');
    }
    await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('#vc-shell [data-settings]')];
        const visible = buttons.find((el) => el.getClientRects().length > 0);
        (visible || buttons[0])?.click();
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.vc-settings-form [data-action="data"]')].some((el) => el.getClientRects().length > 0));
    await page.evaluate(() => {
        const button = [...document.querySelectorAll('.vc-settings-form [data-action="data"]')].find((el) => el.getClientRects().length > 0);
        button?.click();
    });
    await page.waitForSelector('.vc-data-dialog[open] [data-vc-account-go="consent"]');
    await page.locator('[data-vc-account-go="consent"]').click();
    await page.waitForFunction(() => document.querySelector('.vc-data-dialog[open]')?.getAttribute('data-vc-screen') === 'consent');
    await page.waitForSelector('[data-consent-type="SERVICE_TERMS"]');
}

export async function sceneConsentUi(ctx) {
    const before = new Set(ctx.w08.extractJobs().map((job) => String(job.id)));
    const listed = expect(await ctx.admin.call('GET', '/api/v1/consents'), 200, '读取同意');
    await reauthForWrite(ctx);
    for (const row of Array.isArray(listed) ? listed : []) {
        if (row?.granted !== true) continue;
        if (!REQUIRED_CONSENTS.some((item) => item.type === row.consentType)) continue;
        expect(await ctx.admin.call('PUT', '/api/v1/consents', {
            consentType: row.consentType,
            version: row.version || '2026-10-30',
            granted: false,
            currentPassword: ctx.secrets.password,
        }), 200, '撤回已有同意');
    }
    const purposes = expect(await ctx.admin.listPurposes(), 200, '读取用途绑定');
    const embeddingModel = (await (await fetch('http://127.0.0.1:11438/api/tags')).json()).models.find((item) => item.name === 'qwen3-embedding:0.6b');
    assert.ok(embeddingModel, '本机 embedding 模型必须已就绪');
    const existingEmbedding = await ctx.admin.call('GET', '/api/v1/admin/embedding-config');
    expect(await ctx.admin.call('PUT', '/api/v1/admin/embedding-config', {
        model: embeddingModel.name,
        artifactVersion: embeddingModel.digest,
        dimensions: 1024,
        queryPreprocessingVersion: 'qwen3-retrieval-v1',
        documentPreprocessingVersion: 'identity-v1',
        normalization: 'l2',
        state: 'ENABLED',
        expectedRevision: existingEmbedding.status === 200 ? existingEmbedding.json.revision : 0,
    }), 200, '配置本机 embedding');
    const unknown = 'UNKNOWN';
    const providers = await ctx.admin.listProviders();
    const existingProvider = Array.isArray(providers.json) ? providers.json.find((item) => item.providerId === providerId) : null;
    expect(await ctx.admin.saveProvider(providerId, {
        displayName: '同意验收提取',
        protocol: 'OPENAI_CHAT_COMPLETIONS',
        baseUrl: `http://127.0.0.1:${process.env.VC_W03_FIXTURE_PORT || 8753}/v1`,
        credential: ctx.secrets.fixtureKey,
        state: 'ENABLED',
        expectedRevision: existingProvider?.revision || 0,
        models: [{
            profileKey: 'memory',
            modelId,
            displayName: '同意验收提取模型',
            contextWindowTokens: 1000000,
            maxOutputTokens: 262144,
            state: 'ENABLED',
            reasoningLevels: ['max'],
            capabilities: {
                imageInput: unknown, videoInput: unknown, pdfInput: unknown, structuredOutput: unknown,
                toolCalls: unknown, nativeWebSearch: unknown, systemMessage: 'DECLARED', temperature: unknown, topP: unknown,
            },
            generationParams: { temperature: null, topP: null, reasoningEffort: 'max' },
        }],
    }), 200, '登记提取模型');
    ctx.w10.psql(`INSERT INTO vc.model_unit_price(provider_id,model_id,price_version,input_usd_per_1k,output_usd_per_1k) VALUES ('${providerId}','${modelId}',1,0.001,0.002) ON CONFLICT DO NOTHING;`);
    await ctx.fixtureHttp.setOverride(modelId, { memorycoreDocuments: [{ content: fact, eventDate: '2026-12-03' }] });
    const extraction = purposes.find((row) => row.purpose === 'MEMORY_EXTRACTION_DEDUP_SUMMARY');
    assert.ok(extraction, '提取用途应已登记');
    expect(await ctx.admin.savePurpose('MEMORY_EXTRACTION_DEDUP_SUMMARY', {
        providerId,
        profileKey: 'memory',
        state: 'ENABLED',
        expectedRevision: extraction.revision,
    }), 200, '绑定提取用途');

    const st = createStClient({
        baseUrl: ctx.w05.stBase,
        expectedIdentity: ctx.secrets.session,
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}`,
    });
    const card = await importSyntheticCard(st, '同意验收');
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const shots = [];
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}),
    });
    let page;
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' });
        await pinVcUi(context, 'on');
        page = await context.newPage();
        const code = ctx.secrets.recoveryCodes.shift();
        assert.equal(typeof code, 'string');
        assert.equal(code.length > 0, true);
        await page.goto(`${ctx.w05.stBase}/auth/`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#login-form:not([hidden])');
        await page.fill('#account', 'w03-accept-owner');
        await page.fill('#password', ctx.secrets.password);
        await page.click('#login-form button[type=submit]');
        await page.waitForSelector('#use-recovery:not([hidden])');
        await page.click('#use-recovery');
        await page.fill('#code', code);
        await page.click('#verify-submit');
        await page.waitForURL(`${ctx.w05.stBase}/`);
        await nativeReady(page);
        await page.waitForSelector('#vc-shell');
        await page.waitForSelector('#vc-consent[open]');
        shots.push(...await shoot(page, 'consent-collapsed'));
        await page.locator('[data-consent-toggle="SERVICE_TERMS"]').click();
        await page.waitForFunction(() => document.querySelector('[data-consent-toggle="SERVICE_TERMS"]')?.getAttribute('aria-expanded') === 'true');
        shots.push(...await shoot(page, 'consent-expanded'));
        await page.locator('[data-consent-accept]').click();
        await page.waitForFunction(() => !document.querySelector('#vc-consent[open]'));

        const sourceFile = `consent-ui-${crypto.randomUUID()}`;
        const sourceToken = { id: crypto.randomUUID(), revision: 0 };
        const sourceRows = [
            { chat_metadata: { vc_f2: sourceToken } },
            { name: '合成用户', is_user: true, mes: fact, send_date: '2026-12-03T20:00:00+08:00', extra: {} },
        ];
        prepareSourceIdentities(sourceRows, { settled: true, sourceTimezone: 'Asia/Shanghai' });
        expect(await st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: sourceFile, chat: sourceRows }), 200, '保存会写记忆的聊天');
        await page.waitForFunction((avatar) => window.SillyTavern.getContext().characters.some((item) => item.avatar === avatar), card.avatar);
        await page.evaluate(async ({ avatar, file }) => {
            const native = await import('/script.js');
            const index = native.characters.findIndex((item) => item.avatar === avatar);
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
                throw new Error(`提取任务失败 ${JSON.stringify(jobs.map((job) => ({ id: String(job.id), status: job.status })))}`);
            }
            if (!jobs.length || jobs.some((job) => job.status !== 'DONE')) return false;
            const rows = expect(await ctx.admin.call('GET', `/api/v1/relationships/${binding.relationshipId}/memories?q=${encodeURIComponent('灯塔')}`), 200, '读取提取记忆');
            memory = rows.find((row) => row.summary.includes('灯塔') && row.lifecycle === 'ACTIVE' && row.recallEligible);
            return Boolean(memory);
        }, { timeoutMs: 180000, label: '同意后的提取完成并入库' });
        const fresh = ctx.w08.extractJobs().filter((job) => !before.has(String(job.id)));
        assert.equal(fresh.length >= 1 && fresh.every((job) => job.status === 'DONE'), true);

        await page.setViewportSize({ width: 390, height: 844 });
        await openPrivacy(page);
        shots.push(...await shoot(page, 'privacy'));
        await page.locator('[data-consent-revoke="SERVICE_TERMS"]').click();
        await page.locator('.vc-alert [data-vc-ok]').click();
        await page.locator('[data-reauth-password]').fill(ctx.secrets.password);
        await page.locator('[data-reauth] button[type="submit"]').click();
        await page.waitForFunction(() => {
            const row = document.querySelector('[data-consent-type="SERVICE_TERMS"]');
            return Boolean(row && row.textContent.includes('未同意'));
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await nativeReady(page);
        await page.waitForSelector('#vc-consent[open]');
        assert.equal(await page.locator('#vc-consent-title').textContent(), '开始之前');
        if (Array.isArray(ctx.screenshots)) ctx.screenshots.push(...shots);
        console.log(`CONSENT_UI ${SHOT_DIR}`);
    } catch (error) {
        if (page) await page.screenshot({ path: path.join(SHOT_DIR, 'consent-ui-failed.png') }).catch(() => {});
        throw error;
    } finally {
        await browser.close();
    }
}

export const consentUiScene = {
    id: 'consent-ui',
    title: '无同意账号登录后同意，一轮聊天写入记忆，撤回后再次出现同意页',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneConsentUi,
};
