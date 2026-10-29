// W14-T5：雨夜客栈的真实模型叙事。只在 --filter story-real 时运行。
// 产物只留结构、判定、用量和缺陷编号，不留对白、视图或凭据。
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { waitFor } from './managed-lib.mjs';
import { REPO_ROOT } from './lib/paths.mjs';
import {
    decodeAgentFile, parseAgentLines, publicModelConfig, storyCanonicalView,
    forbiddenForActor, sealStoryReport, startStoryCapture,
} from './lib/story-real-capture.mjs';

const MODEL_ID = 'cline-pass/deepseek-v4.1-flash-1017';
const WORLD = 'VCW14_REAL_WORLD_BOOK_HARMLESS';
const CARD = 'VCW14_REAL_CARD_NOT_FOR_UPSTREAM';
const GREETING = 'VCW14_REAL_GREETING_NOT_FOR_UPSTREAM';
const LINES = {
    lin: ['林岚，今晚你一直在厨房吗？', '林岚，怀表不见的时候你在哪里？'],
    zhou: ['周澈，这份借用记录你怎么看？', '周澈，修灯的时候大堂还有别人吗？'],
};
function otherActor(actor) {
    return actor === 'lin' ? 'zhou' : 'lin';
}

function showedLoan(view) {
    return (view?.events ?? []).some((event) => event?.body?.action === 'show_clue' && event?.body?.clueId === 'loan_note');
}

function usageOf(call) {
    const usage = call?.usage ?? {};
    return {
        promptTokens: usage.promptTokens ?? null,
        completionTokens: usage.completionTokens ?? null,
        totalTokens: usage.totalTokens ?? null,
        cost: usage.cost ?? null,
        present: usage.present === true,
    };
}

function summarizeUsage(rounds) {
    const totals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
    const seen = { promptTokens: false, completionTokens: false, totalTokens: false, cost: false };
    const complete = { promptTokens: true, completionTokens: true, totalTokens: true, cost: true };
    for (const round of rounds) {
        const usage = round.usage ?? {};
        for (const key of Object.keys(totals)) {
            if (typeof usage[key] === 'number') {
                totals[key] += usage[key];
                seen[key] = true;
            } else complete[key] = false;
        }
    }
    const any = Object.values(seen).some(Boolean);
    const tokenComplete = complete.promptTokens && complete.completionTokens && complete.totalTokens && rounds.length > 0;
    const costComplete = complete.cost && rounds.length > 0;
    return {
        promptTokens: seen.promptTokens ? totals.promptTokens : null,
        completionTokens: seen.completionTokens ? totals.completionTokens : null,
        totalTokens: seen.totalTokens ? totals.totalTokens : null,
        cost: seen.cost ? totals.cost : null,
        roundsWithUsage: rounds.filter((round) => round.usage?.present).length,
        rounds: rounds.length,
        tokenComplete,
        costComplete,
        status: !any ? 'NOT_RUN' : (tokenComplete && costComplete ? 'COMPLETE' : 'PARTIAL'),
    };
}

async function redactLogs(files, banned) {
    const secrets = (banned ?? []).filter((item) => typeof item === 'string' && [...item].length >= 8);
    let redacted = 0;
    for (const file of files) {
        let text;
        try { text = await fs.readFile(file, 'utf8'); } catch { continue; }
        let changed = false;
        const next = text.split('\n').map((line) => {
            if (!secrets.some((secret) => line.includes(secret))) return line;
            redacted += 1;
            changed = true;
            return '[redacted]';
        });
        if (changed) await fs.writeFile(file, next.join('\n'), { mode: 0o600 });
    }
    return redacted;
}

export async function sceneStoryReal(ctx) {
    const parsed = parseAgentLines(decodeAgentFile(await fs.readFile(path.join(REPO_ROOT, 'agents.txt'))));
    const pub = publicModelConfig(parsed);
    if (!pub.chatCompletions) throw new Error('私有配置不是 Chat Completions');
    if (!pub.basePresent || !pub.keyPresent || !pub.modelMatched || !pub.reasoningMax) throw new Error('私有模型配置不完整');
    const credential = parsed.apiKey;
    const upstreamBase = parsed.baseUrl;
    const replies = [];
    const defects = new Set();
    const report = {
        modelMatched: pub.modelMatched,
        reasoningEffort: null,
        calls: 0,
        rounds: [],
        continuity: [],
        showClue: null,
        defects: [],
        usage: null,
        logRedactions: 0,
    };
    let capture;
    let browser;
    let providerRevision = null;
    let failure = null;
    const spec = {
        displayName: 'W14 真实叙事',
        protocol: 'OPENAI_CHAT_COMPLETIONS',
        baseUrl: '',
        state: 'ENABLED',
        models: [{
            profileKey: 'story',
            modelId: MODEL_ID,
            displayName: 'W14 真实叙事',
            contextWindowTokens: 32768,
            maxOutputTokens: 4096,
            state: 'ENABLED',
            capabilities: { systemMessage: 'DECLARED' },
            // ST custom 源会把 max 收成 high，钉住 max 会在出站前被 VC_NATIVE_DRIFT 拒绝。
            // 不钉采样参数，让供应商账户默认思考等级生效，并在报告里核对实际上游字段。
            reasoningLevels: ['max'],
        }],
    };
    const note = (id) => defects.add(id);
    const finishReport = () => {
        report.defects = [...defects];
        report.calls = capture ? capture.snapshot().length : 0;
        report.usage = summarizeUsage(report.rounds);
        const efforts = report.rounds.map((round) => round.upstream?.reasoningEffort).filter((item) => item != null);
        report.reasoningEffort = efforts[0] ?? null;
        if (report.rounds.some((round) => round.upstream?.reasoningEffort !== 'max')) note('reasoning_effort_not_forwarded');
        if (report.rounds.some((round) => !round.usage?.present)) note('usage_missing');
        report.defects = [...defects];
    };
    try {
        capture = await startStoryCapture(upstreamBase, { maxCalls: 8 });
        spec.baseUrl = capture.baseUrl;
        const saved = await ctx.admin.saveProvider('vc14-real', { ...spec, credential, expectedRevision: 0 });
        const savedCode = typeof saved.json?.code === 'string' ? saved.json.code : '';
        if (saved.status !== 200 || !Number.isInteger(saved.json?.revision)) throw new Error(`注入真实模型失败：HTTP ${saved.status}${savedCode ? ` ${savedCode}` : ''}`);
        providerRevision = saved.json.revision;
        const purposes = await ctx.admin.listPurposes();
        const purpose = purposes.status === 200 && Array.isArray(purposes.json) ? purposes.json.find((item) => item.purpose === 'FOREGROUND_CHAT') : null;
        if (!purpose) throw new Error('FOREGROUND_CHAT 不在用途列表');
        const bound = await ctx.admin.savePurpose('FOREGROUND_CHAT', { providerId: 'vc14-real', profileKey: 'story', state: 'ENABLED', expectedRevision: purpose.revision });
        const boundCode = typeof bound.json?.code === 'string' ? bound.json.code : '';
        if (bound.status !== 200 || bound.json?.status !== 'READY') throw new Error(`绑定真实模型未就绪：HTTP ${bound.status}${boundCode ? ` ${boundCode}` : ''}`);
        const cardName = `W14 真实 ${crypto.randomUUID().slice(0, 8)}`;
        const form = new FormData();
        form.append('file_type', 'json');
        form.append('avatar', new Blob([JSON.stringify({ name: cardName, description: CARD, first_mes: GREETING, personality: '', scenario: '', mes_example: '' })], { type: 'application/json' }), 'synthetic.json');
        const imported = await ctx.st.call('POST', '/api/characters/import', form);
        if (imported.status !== 200 || !imported.json?.file_name) throw new Error(`导入合成卡失败：HTTP ${imported.status}`);
        const avatar = `${imported.json.file_name.replace(/\.png$/, '')}.png`;
        const chatFile = `W14-real-${crypto.randomUUID()}`;
        const chatSaved = await ctx.st.call('POST', '/api/chats/save', {
            avatar_url: avatar,
            file_name: chatFile,
            chat: [
                { user_name: 'unused', character_name: cardName, chat_metadata: { vc_f2: { id: crypto.randomUUID(), revision: 0 }, vc_binding: { mode: 'STORY' } } },
                { name: cardName, is_user: false, mes: GREETING, swipe_id: 0, swipes: [GREETING] },
            ],
        });
        if (chatSaved.status !== 200) throw new Error(`保存聊天失败：HTTP ${chatSaved.status}`);
        const { chromium } = await import('playwright-core');
        browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await context.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase },
        ]);
        const page = await context.newPage();
        page.setDefaultTimeout(120000);
        const storyRef = {};
        const genStatus = { value: 0, code: '' };
        page.on('request', (req) => {
            const match = req.url().match(/\/story\/runs\/([1-9][0-9]*)\/actors\/player\/view\?([^#\s]*)/);
            if (!match) return;
            const params = new URLSearchParams(match[2]);
            storyRef.runId = match[1];
            storyRef.branchId = params.get('branchId') || storyRef.branchId;
        });
        page.on('response', async (res) => {
            if (!res.url().includes('/api/backends/chat-completions/generate')) return;
            genStatus.value = res.status();
            if (res.status() < 400) {
                genStatus.code = '';
                return;
            }
            try {
                const json = await res.json();
                genStatus.code = typeof json?.error?.code === 'string' ? json.error.code : '';
            } catch {
                genStatus.code = '';
            }
        });
        await page.goto(ctx.w05.stBase, { waitUntil: 'domcontentloaded' });
        await waitFor(async () => page.evaluate(async () => (await import('/script.js')).settingsReady || Boolean(document.querySelector('dialog[open] .onboarding'))), { timeoutMs: 60000, label: 'ST 设置或欢迎页' });
        const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
        if (await onboarding.count()) {
            await onboarding.locator('textarea').fill('w14-real');
            await onboarding.locator('.popup-button-ok').click();
            await onboarding.waitFor({ state: 'hidden' });
        }
        await waitFor(async () => page.evaluate(() => document.querySelector('#send_textarea') && document.querySelector('#vc_story_menu_button')), { timeoutMs: 60000, label: '剧情菜单' });
        await waitFor(async () => page.evaluate((name) => window.SillyTavern.getContext().characters.some((item) => item.avatar === name), avatar), { timeoutMs: 30000, label: '合成角色出现' });
        await page.evaluate(async ({ name, file }) => {
            const native = await import('/script.js');
            const index = native.characters.findIndex((item) => item.avatar === name);
            if (index < 0) throw new Error('合成角色未加载');
            await native.selectCharacterById(index);
            await native.openCharacterChat(file);
        }, { name: avatar, file: chatFile });
        await waitFor(async () => page.evaluate(() => {
            const binding = window.SillyTavern.getContext().chatMetadata?.vc_binding;
            return binding?.mode === 'STORY' && /^[1-9][0-9]{0,18}$/.test(binding.conversationId || '');
        }), { timeoutMs: 30000, label: 'STORY 会话绑定' });
        await waitFor(async () => page.evaluate((modelId) => {
            const settings = window.SillyTavern.getContext().chatCompletionSettings ?? {};
            const url = String(settings.custom_url ?? '');
            return settings.chat_completion_source === 'custom' && settings.custom_model === modelId && url.includes('provider=vc14-real');
        }, MODEL_ID), { timeoutMs: 30000, label: '真实模型投影' });
        note('st_custom_maps_max_to_high');
        const bookName = `w14-real-${crypto.randomUUID().slice(0, 8)}`;
        await page.evaluate(async ({ name, content }) => {
            const wi = await import('/scripts/world-info.js');
            const data = { entries: {} };
            const entry = wi.createWorldInfoEntry(name, data);
            if (!entry) throw new Error('无法创建世界书条目');
            entry.content = content;
            entry.constant = true;
            entry.disable = false;
            entry.selective = false;
            entry.position = 0;
            await wi.saveWorldInfo(name, data, true);
            await wi.updateWorldInfoList();
            if (!wi.world_names.includes(name)) throw new Error('世界书未进入客户端名单');
            if (typeof globalThis.TavernHelper?.setCurrentCharLorebooks !== 'function') throw new Error('TavernHelper 未就绪');
            await globalThis.TavernHelper.setCurrentCharLorebooks({ primary: name, additional: [] });
        }, { name: bookName, content: WORLD });
        const openStory = async () => {
            if (await page.locator('.vc-story-dialog[open]').count()) return;
            if (!(await page.locator('#vc_story_menu_button').isVisible())) await page.click('#extensionsMenuButton');
            await page.click('#vc_story_menu_button');
            await page.locator('.vc-story-dialog[open]').waitFor();
        };
        const closeStory = async () => {
            if (!(await page.locator('.vc-story-dialog[open]').count())) return;
            await page.locator('.vc-story-dialog [data-action="close"]').click();
            await waitFor(async () => page.evaluate(() => !document.querySelector('.vc-story-dialog[open]')), { timeoutMs: 10000, label: '关闭剧情页' });
        };
        const dismissPopup = async () => {
            const dialog = page.locator('dialog[open].popup').first();
            try {
                await dialog.waitFor({ timeout: 3000 });
            } catch { return; }
            await dialog.locator('.popup-button-ok').click();
            await dialog.waitFor({ state: 'hidden', timeout: 10000 });
        };
        const ensureSend = async () => {
            if (!(await page.locator('#send_but.displayNone').count())) return;
            if (!(await page.locator('#api_button_openai').isVisible())) await page.click('#API-status-top');
            await page.locator('#api_button_openai').click();
            await dismissPopup();
            try {
                await waitFor(async () => page.evaluate(() => {
                    const button = document.querySelector('#send_but');
                    return Boolean(button && !button.classList.contains('displayNone') && button.offsetParent !== null);
                }), { timeoutMs: 8000, label: '发送按钮可见' });
            } catch {
                note('connect_check_not_ready');
                await page.evaluate(() => document.querySelector('#send_but')?.classList.remove('displayNone'));
            }
        };
        const disableTools = async () => {
            await page.evaluate(async () => {
                const { oai_settings } = await import('/scripts/openai.js');
                oai_settings.function_calling = false;
                const box = document.querySelector('#openai_function_calling');
                if (box instanceof HTMLInputElement) box.checked = false;
            });
        };
        const actorView = async (actorId) => {
            await openStory();
            const root = page.locator('.vc-story');
            await root.waitFor({ timeout: 15000 });
            const worldVersion = await root.getAttribute('data-world-version', { timeout: 15000 });
            if (!storyRef.runId || !storyRef.branchId || worldVersion == null) throw new Error('剧情身份不完整');
            const loaded = await ctx.admin.call('GET', `/api/v1/story/runs/${storyRef.runId}/actors/${actorId}/view?branchId=${encodeURIComponent(storyRef.branchId)}&worldVersion=${encodeURIComponent(worldVersion)}`);
            if (loaded.status !== 200 || !loaded.json) throw new Error(`读取视图失败：HTTP ${loaded.status}`);
            return loaded.json;
        };
        const waitVersion = async (before, label) => {
            await waitFor(async () => {
                const version = await page.locator('.vc-story').getAttribute('data-world-version', { timeout: 5000 });
                const pending = await page.locator('.vc-story').evaluate((root) => root.innerText.includes('行动已生效，聊天记录待同步'));
                const alert = await page.locator('.vc-story [role="alert"]').count() ? await page.locator('.vc-story [role="alert"]').innerText() : '';
                if (alert) throw new Error('剧情页拒绝了这一步');
                return Boolean(version && version !== before && !pending);
            }, { timeoutMs: 45000, label });
        };
        await openStory();
        await page.locator('.vc-story-dialog [data-action="start"]').click();
        await waitFor(async () => page.evaluate(() => document.querySelector('.vc-story')?.getAttribute('data-state') === 'playing'), { timeoutMs: 60000, label: '剧情开局' });
        await waitFor(async () => Boolean(storyRef.runId && storyRef.branchId), { timeoutMs: 30000, label: '剧情身份' });
        const selectActor = async (actorId) => {
            await openStory();
            await page.locator(`.vc-story-dialog [data-action="select-actor"][data-actor="${actorId}"]`).click();
            await waitFor(async () => page.evaluate((id) => document.querySelector(`.vc-story-dialog [data-action="select-actor"][data-actor="${id}"]`)?.getAttribute('aria-pressed') === 'true', actorId), { timeoutMs: 10000, label: `选中 ${actorId}` });
        };
        const commitLine = async (actor, playerLine) => {
            await openStory();
            const before = await page.locator('.vc-story').getAttribute('data-world-version', { timeout: 15000 });
            const calls = capture.snapshot().length;
            await page.locator('.vc-story-dialog [data-field="say"]').fill(playerLine);
            await page.locator('.vc-story-dialog [data-action="say"]').click();
            await waitVersion(before, `${actor} 对白提交`);
            if (capture.snapshot().length !== calls) throw new Error(`${actor} 对白提交期间出现上游请求`);
        };
        const act = async (step) => {
            await openStory();
            const before = await page.locator('.vc-story').getAttribute('data-world-version', { timeout: 15000 });
            const calls = capture.snapshot().length;
            await page.locator(`.vc-story-dialog [data-action="act"][data-step="${step}"]`).click();
            await waitVersion(before, `${step} 提交`);
            if (capture.snapshot().length !== calls) throw new Error(`${step} 期间出现上游请求`);
        };
        const playRound = async (actor, index, playerLine, afterShowClue) => {
            if (capture.snapshot().length >= 8) throw new Error('已达本场调用上限');
            await selectActor(actor);
            const view = await actorView(actor);
            await closeStory();
            await ensureSend();
            await disableTools();
            const viewText = storyCanonicalView(view);
            const extras = [
                { label: 'WORLD_BOOK', text: WORLD },
                { label: 'CARD', text: CARD },
                { label: 'GREETING', text: GREETING },
            ];
            if (actor === 'zhou') LINES.lin.forEach((text, lineIndex) => extras.push({ label: `OTHER_LINE_${lineIndex + 1}`, text }));
            const previous = replies.at(-1);
            if (previous && [...previous].length >= 12 && !viewText.includes(previous)) extras.push({ label: 'UNCOMMITTED_REPLY', text: previous });
            const before = capture.snapshot().length;
            capture.arm({ viewText, playerLine, toolRecords: [], forbidden: forbiddenForActor(actor, extras), modelId: MODEL_ID, actorId: actor });
            genStatus.value = 0;
            genStatus.code = '';
            const projected = await page.evaluate((modelId) => {
                const settings = window.SillyTavern.getContext().chatCompletionSettings ?? {};
                return settings.chat_completion_source === 'custom'
                    && settings.custom_model === modelId
                    && String(settings.custom_url ?? '').includes('provider=vc14-real');
            }, MODEL_ID);
            if (!projected) throw new Error(`${actor} 第 ${index} 轮发送前真实模型投影丢失`);
            await page.locator('#send_textarea').fill(playerLine);
            await page.locator('#send_but').click();
            await dismissPopup();
            let generated = false;
            try {
                generated = await waitFor(async () => {
                    if (genStatus.value >= 400) return 'http';
                    const ready = await page.evaluate(() => {
                        const chat = window.SillyTavern.getContext()?.chat ?? [];
                        const stop = document.querySelector('#mes_stop');
                        const idle = !stop || getComputedStyle(stop).display === 'none';
                        const last = chat[chat.length - 1];
                        return idle && !last?.is_user && typeof last?.mes === 'string' && last.mes.trim().length > 0;
                    });
                    return ready ? 'ok' : false;
                }, { timeoutMs: 240000, label: `${actor} 第 ${index} 轮生成` });
            } catch {
                generated = false;
            }
            if (generated !== 'ok') {
                const added = capture.snapshot().slice(before);
                if (added[0]) report.rounds.push(roundOf(actor, index, afterShowClue, added[0], 0));
                const status = genStatus.value >= 400 ? ` HTTP ${genStatus.value}${genStatus.code ? ` ${genStatus.code}` : ''}` : '';
                throw new Error(`${actor} 第 ${index} 轮生成未完成${status}`);
            }
            const added = capture.snapshot().slice(before);
            const reply = await page.evaluate(() => {
                const chat = window.SillyTavern.getContext()?.chat ?? [];
                const last = chat[chat.length - 1];
                return !last?.is_user && typeof last?.mes === 'string' ? last.mes : '';
            });
            replies.push(reply);
            const call = added[0];
            report.rounds.push(roundOf(actor, index, afterShowClue, call, [...reply].length));
            if (added.length !== 1) throw new Error(`${actor} 第 ${index} 轮出站请求数为 ${added.length}`);
            if (!call?.modelMatched) throw new Error(`${actor} 第 ${index} 轮出站模型不符`);
            if (call.forbiddenHits?.length) throw new Error(`${actor} 第 ${index} 轮出站含 ${call.forbiddenHits.join(',')}`);
            if (!call.onlyCurrentSlots) throw new Error(`${actor} 第 ${index} 轮出站槽位不符`);
            if (call.status !== 200) throw new Error(`${actor} 第 ${index} 轮上游状态 ${call.status}`);
            await commitLine(actor, playerLine);
            const own = await actorView(actor);
            const other = await actorView(otherActor(actor));
            const ownEvents = JSON.stringify(own.events ?? []);
            const otherEvents = JSON.stringify(other.events ?? []);
            const continuity = {
                from: `${actor}-${index}`,
                playerLineInOwnView: ownEvents.includes(playerLine),
                playerLineInOtherView: otherEvents.includes(playerLine),
                npcReplyInOwnView: Boolean(reply) && ownEvents.includes(reply),
                npcReplyInOtherView: Boolean(reply) && otherEvents.includes(reply),
            };
            report.continuity.push(continuity);
            if (!continuity.playerLineInOwnView || continuity.playerLineInOtherView) throw new Error(`${actor} 第 ${index} 轮对白隔离不符`);
            if (reply && !continuity.npcReplyInOwnView) note('npc_reply_not_auto_committed');
            if (continuity.npcReplyInOtherView) note('npc_reply_visible_to_other');
        };
        if (capture.snapshot().length !== 0) throw new Error('开局前出现上游请求');
        await selectActor('lin');
        for (let index = 0; index < LINES.lin.length; index += 1) await playRound('lin', index + 1, LINES.lin[index], false);
        await act('a1');
        await act('a3');
        const zhou = await actorView('zhou');
        const lin = await actorView('lin');
        report.showClue = { inZhou: showedLoan(zhou), inLin: showedLoan(lin) };
        if (!report.showClue.inZhou || report.showClue.inLin) throw new Error('出示线索后的可见性不符');
        await selectActor('zhou');
        for (let index = 0; index < LINES.zhou.length; index += 1) await playRound('zhou', index + 1, LINES.zhou[index], true);
        finishReport();
    } catch (error) {
        failure = error instanceof Error ? error : new Error('真实叙事场景失败');
        finishReport();
    } finally {
        if (browser) await browser.close().catch(() => {});
        try {
            const purposes = await ctx.admin.listPurposes();
            const row = purposes.status === 200 && Array.isArray(purposes.json) ? purposes.json.find((item) => item.purpose === 'FOREGROUND_CHAT' && item.providerId === 'vc14-real') : null;
            if (row) await ctx.admin.savePurpose('FOREGROUND_CHAT', { providerId: 'vc14-real', profileKey: 'story', state: 'DISABLED', expectedRevision: row.revision });
            if (providerRevision != null) {
                const clear = { ...spec, state: 'DISABLED', clearCredential: true, expectedRevision: providerRevision };
                delete clear.credential;
                await ctx.admin.saveProvider('vc14-real', clear);
            }
        } catch { /* 清理失败不覆盖场景结论 */ }
        finishReport();
        const dev = process.env.VC_W03_DEV_DIR || path.join(REPO_ROOT, 'integrations/sillytavern/dev-managed');
        const banned = [credential, upstreamBase, WORLD, CARD, GREETING, ...LINES.lin, ...LINES.zhou, ...replies];
        report.logRedactions = await redactLogs([
            path.join(dev, 'run/st.log'),
            path.join(ctx.artifactsDir, 'go.log'),
            path.join(ctx.artifactsDir, 'fixture.log'),
        ], banned).catch(() => 0);
        const sealed = sealStoryReport(report, banned);
        if (!sealed.ok) failure = new Error('验收产物含对话或凭据，已丢弃');
        else {
            await fs.writeFile(path.join(ctx.artifactsDir, 'story-real-summary.json'), `${JSON.stringify(sealed.report, null, 2)}\n`, { mode: 0o600 });
            console.log(`[story-real] ${JSON.stringify(sealed.report)}`);
        }
        if (capture) await capture.stop();
    }
    if (failure) throw failure;
    return { calls: report.calls, defects: report.defects };
}

function roundOf(actor, round, afterShowClue, call, stChars) {
    return {
        actor,
        round,
        afterShowClue,
        upstream: {
            status: call?.status ?? null,
            stream: call?.stream === true,
            onlyCurrentSlots: call?.onlyCurrentSlots === true,
            systemMatchesView: call?.systemMatchesView === true,
            userIsCurrentPlayerLine: call?.userIsCurrentPlayerLine === true,
            toolRecordsMatch: call?.toolRecordsMatch === true,
            forbiddenHits: [...(call?.forbiddenHits ?? [])],
            roles: [...(call?.roles ?? [])],
            reasoningEffort: call?.reasoningEffort ?? null,
            modelMatched: call?.modelMatched === true,
        },
        character: {
            inCharacter: call?.character?.inCharacter === true,
            reason: typeof call?.character?.reason === 'string' ? call.character.reason : '',
            leakedLabels: [...(call?.character?.leakedLabels ?? [])],
            chars: call?.character?.chars ?? 0,
            reasoningChars: call?.character?.reasoningChars ?? 0,
        },
        stChars,
        usage: usageOf(call),
    };
}
