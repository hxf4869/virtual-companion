import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
    waitFor,
} from './managed-lib.mjs';
import { pinVcUi } from './vc-ui-pin.mjs';
import { log, psql, rt } from './lib/accept-runtime.mjs';
import { bindForeground } from './lib/accept-scene-helpers.mjs';
import {
    STORY_PROBE, STORY_PUBLIC, STORY_CARD, STORY_GREETING, STORY_FOLLOW, STORY_TOOL_RESULT, STORY_LIN_FACT, STORY_ZHOU_FACT, STORY_FORBIDDEN, STORY_DOM_FORBIDDEN, storyCanonicalView, storySystemText,
} from './lib/story-accept-shared.mjs';

export async function sceneStoryOutbound(ctx) {
    const report = {
        protocols: {
            OPENAI_CHAT_COMPLETIONS: { requests: 0, assertions: 0 },
            ANTHROPIC_MESSAGES: { requests: 0, assertions: 0 },
            OPENAI_RESPONSES: { requests: 0, assertions: 0 },
        },
        companion: { requests: 0, assertions: 0 },
        negativeSecret: { requests: 0, assertions: 0, rejected: false },
        missingIdentity: { requests: 0, assertions: 0, rejected: false },
        dom: { assertions: 0 },
        reasoningIsolated: false,
    };
    const pass = (bucket, n = 1) => { bucket.assertions += n; };
    const directive = {
        toolOnce: true,
        tool: { name: 'note_clue', argumentsPieces: ['{}'] },
        reasoning: { text: '核对当前问句的字面。', encrypted: true },
        followUpText: STORY_FOLLOW,
    };
    await ctx.fixtureHttp.setOverride('vc03m-tools', directive);
    await ctx.fixtureHttp.setOverride('vc03m-reasoning', directive);
    await bindForeground(ctx, 'vc03m-chat', 'chat-tools', 'vc03m-tools');
    const cardName = `W13 剧情 ${crypto.randomUUID().slice(0, 8)}`;
    const card = {
        name: cardName,
        description: `${STORY_CARD} 合成角色卡说明。`,
        first_mes: STORY_GREETING,
        personality: '',
        scenario: '',
        mes_example: '',
    };
    const form = new FormData();
    form.append('file_type', 'json');
    form.append('avatar', new Blob([JSON.stringify(card)], { type: 'application/json' }), 'synthetic.json');
    const imported = await ctx.st.call('POST', '/api/characters/import', form);
    if (imported.status !== 200 || !imported.json?.file_name) throw new Error(`导入合成卡失败：HTTP ${imported.status}`);
    const avatar = `${imported.json.file_name.replace(/\.png$/, '')}.png`;
    const storyFile = `W13-story-${crypto.randomUUID()}`;
    const companionFile = `W13-companion-${crypto.randomUUID()}`;
    const storyToken = { id: crypto.randomUUID(), revision: 0 };
    const companionToken = { id: crypto.randomUUID(), revision: 0 };
    const saveChat = async (file, chat) => {
        const saved = await ctx.st.call('POST', '/api/chats/save', { avatar_url: avatar, file_name: file, chat });
        if (saved.status !== 200) throw new Error(`保存聊天失败：HTTP ${saved.status}`);
    };
    await saveChat(storyFile, [
        { user_name: 'unused', character_name: cardName, chat_metadata: { vc_f2: storyToken, vc_binding: { mode: 'STORY' } } },
        { name: cardName, is_user: false, mes: STORY_GREETING, swipe_id: 0, swipes: [STORY_GREETING] },
    ]);
    await saveChat(companionFile, [
        { user_name: 'unused', character_name: cardName, chat_metadata: { vc_f2: companionToken } },
        { name: cardName, is_user: false, mes: '这是一个合成陪伴会话。', swipe_id: 0, swipes: ['这是一个合成陪伴会话。'] },
    ]);
    const bookName = `w13-${crypto.randomUUID().slice(0, 8)}`;
    let browser;
    const generates = [];
    const genResponses = [];
    try {
        const { chromium } = await import('playwright-core');
        browser = await chromium.launch({
            headless: true,
            ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}),
        });
        const bc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await pinVcUi(bc, 'off');
        await bc.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: rt.ST_BASE },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: rt.ST_BASE },
        ]);
        const page = await bc.newPage();
        page.setDefaultTimeout(120000);
        page.on('request', (req) => {
            if (!req.url().includes('/api/backends/chat-completions/generate')) return;
            let body = null;
            try { body = req.postDataJSON(); } catch { body = null; }
            const raw = JSON.stringify(body ?? {});
            generates.push({
                vc_story: body?.vc_story && typeof body.vc_story === 'object' ? {
                    actorId: body.vc_story.actorId ?? null,
                    keys: Object.keys(body.vc_story).sort(),
                    actorIds: Object.prototype.hasOwnProperty.call(body.vc_story, 'actorIds'),
                    chatIdentity: typeof body.vc_story.chatIdentity === 'string' ? body.vc_story.chatIdentity : '',
                    runId: body.vc_story.runId ?? '',
                    branchId: body.vc_story.branchId ?? '',
                    worldVersion: body.vc_story.worldVersion ?? null,
                } : null,
                mode: body?.vc_session_mode ?? '',
                hasProbe: raw.includes(STORY_PROBE),
                hasPublic: raw.includes('VCW13_PUBLIC_LORE_HARMLESS'),
                hasCard: raw.includes(STORY_CARD),
                hasSecret: raw.includes(STORY_ZHOU_FACT),
            });
        });
        page.on('response', (res) => {
            if (!res.url().includes('/api/backends/chat-completions/generate')) return;
            const entry = {
                status: res.status(),
                memory: res.headers()['x-vc-memory-status'] || '',
                errorCode: '',
                fixedReject: false,
                echoedSecret: false,
            };
            genResponses.push(entry);
            res.json().then((json) => {
                const message = typeof json?.error?.message === 'string' ? json.error.message : '';
                entry.errorCode = json?.error?.code || json?.code || '';
                entry.fixedReject = message === '剧情出站核对未通过，已拒绝联系上游';
                entry.echoedSecret = message.includes(STORY_ZHOU_FACT);
            }).catch(() => { /* 成功的流式响应不是 JSON */ });
        });
        const shot = async (name) => {
            const file = path.join(ctx.artifactsDir, name);
            await page.screenshot({ path: file });
            ctx.screenshots.push(file);
        };
        await page.goto(rt.ST_BASE, { waitUntil: 'domcontentloaded' });
        await waitFor(async () => page.evaluate(async () => (await import('/script.js')).settingsReady || Boolean(document.querySelector('dialog[open] .onboarding'))), { timeoutMs: 60000, label: 'ST 设置或欢迎页' });
        const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
        if (await onboarding.count()) {
            await onboarding.locator('textarea').fill('w13-owner');
            await onboarding.locator('.popup-button-ok').click();
            await onboarding.waitFor({ state: 'hidden' });
        }
        await waitFor(async () => page.evaluate(() => document.querySelector('#send_textarea') && document.querySelector('#vc_story_menu_button')), { timeoutMs: 60000, label: '剧情菜单' });
        const openChat = async (file) => {
            await waitFor(async () => page.evaluate((name) => window.SillyTavern.getContext().characters.some((c) => c.avatar === name), avatar), { timeoutMs: 30000, label: '合成角色出现' });
            await page.evaluate(async ({ name, chatFile }) => {
                const native = await import('/script.js');
                const index = native.characters.findIndex((c) => c.avatar === name);
                if (index < 0) throw new Error('合成角色未加载');
                await native.selectCharacterById(index);
                await native.openCharacterChat(chatFile);
            }, { name: avatar, chatFile: file });
        };
        await openChat(storyFile);
        await waitFor(async () => page.evaluate(() => {
            const binding = window.SillyTavern.getContext().chatMetadata?.vc_binding;
            return binding?.mode === 'STORY' && /^[1-9][0-9]{0,18}$/.test(binding.conversationId || '');
        }), { timeoutMs: 30000, label: 'STORY 会话绑定' });
        await waitFor(async () => page.evaluate(() => {
            const oai = window.SillyTavern.getContext().chatCompletionSettings ?? {};
            return String(oai.custom_url ?? '').includes('profile=chat-tools') && Number(oai.openai_max_context) === 8192;
        }), { timeoutMs: 30000, label: 'chat-tools 8192 投影' });
        await page.evaluate(async ({ name, entries }) => {
            const wi = await import('/scripts/world-info.js');
            const data = { entries: {} };
            for (const content of entries) {
                const entry = wi.createWorldInfoEntry(name, data);
                if (!entry) throw new Error('无法创建世界书条目');
                entry.content = content;
                entry.constant = true;
                entry.disable = false;
                entry.selective = false;
                entry.position = 0;
                entry.comment = 'w13';
            }
            await wi.saveWorldInfo(name, data, true);
            await wi.updateWorldInfoList();
            if (!wi.world_names.includes(name)) throw new Error('世界书未进入客户端名单');
            if (typeof globalThis.TavernHelper?.setCurrentCharLorebooks !== 'function') throw new Error('TavernHelper 未就绪');
            await globalThis.TavernHelper.setCurrentCharLorebooks({ primary: name, additional: [] });
            const primary = globalThis.TavernHelper.getCharLorebooks?.().primary;
            const world = window.SillyTavern.getContext().characters[window.SillyTavern.getContext().characterId]?.data?.extensions?.world;
            if (primary !== name || world !== name) throw new Error(`主世界书未绑定：${primary || ''} ${world || ''}`);
        }, { name: bookName, entries: [STORY_PUBLIC, STORY_PROBE] });
        await page.evaluate(async () => {
            const { ToolManager } = await import('/scripts/tool-calling.js');
            ToolManager.registerFunctionTool({
                name: 'note_clue',
                displayName: '记下线索',
                description: '记下一条公开线索',
                parameters: { type: 'object', properties: {}, additionalProperties: false },
                action: async () => '已记下公开线索。',
            });
        });
        const scanSurface = async (label) => {
            const dom = await page.evaluate(() => document.documentElement.outerHTML);
            const stored = await page.evaluate(() => {
                const entries = [];
                for (let i = 0; i < localStorage.length; i += 1) entries.push(localStorage.getItem(localStorage.key(i)) || '');
                return entries.join('\n');
            });
            for (const [name, text] of STORY_DOM_FORBIDDEN) {
                if (dom.includes(text) || stored.includes(text)) throw new Error(`${label} 的页面或 localStorage 含 ${name}`);
                pass(report.dom);
            }
        };
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
        const selectActor = async (actorId) => {
            await openStory();
            await page.locator(`.vc-story-dialog [data-action="select-actor"][data-actor="${actorId}"]`).click();
            await waitFor(async () => page.evaluate((id) => document.querySelector(`.vc-story-dialog [data-action="select-actor"][data-actor="${id}"]`)?.getAttribute('aria-pressed') === 'true', actorId), { timeoutMs: 10000, label: `选中 ${actorId}` });
            await closeStory();
        };
        const closePanel = async () => {
            const overlay = page.locator('.vcms-overlay');
            if (!(await overlay.isVisible())) return;
            // 保存用途绑定后的 render 会拆掉按钮。脏标记还亮着就去点放弃，按钮会在点击期间被藏起来，默认 120s 一直重试。
            try {
                await waitFor(async () => page.evaluate(() => {
                    const dirty = document.querySelector('#vcms-dirty');
                    return !dirty || dirty.hidden;
                }), { timeoutMs: 8000, label: '模型页无未保存修改' });
            } catch {
                const discard = page.locator('#vcms-discard');
                if (await discard.isVisible()) {
                    await discard.click({ timeout: 5000 });
                    await page.waitForSelector('#vcms-dirty', { state: 'hidden', timeout: 5000 });
                }
            }
            if (!(await overlay.isVisible())) return;
            await page.locator('.vcms-overlay [aria-label="关闭模型设置"]').click();
            await page.waitForSelector('.vcms-overlay', { state: 'hidden', timeout: 10000 });
        };
        const bindProfile = async (optionValue, markerPred) => {
            // 记忆提取会继续打 vc08-memory。绑定本身不应再打目录模型或 /models。
            const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
            if (!(await page.locator('.vcms-overlay').isVisible())) {
                if (!(await page.locator('#vc_models_menu_button').isVisible())) await page.click('#extensionsMenuButton');
                await page.click('#vc_models_menu_button');
                await page.waitForSelector('.vcms-overlay', { state: 'visible', timeout: 10000 });
            }
            await page.click('[data-action="tab"][data-tab="bindings"]');
            await page.selectOption('select[data-bind="binding.FOREGROUND_CHAT"]', optionValue);
            await page.click('[data-action="save-bindings"]');
            await waitFor(async () => {
                const purposes = await ctx.admin.listPurposes();
                const row = purposes.json.find((item) => item.purpose === 'FOREGROUND_CHAT');
                const [providerId, profileKey] = optionValue.split('::');
                return row && row.providerId === providerId && row.profileKey === profileKey && row.status === 'READY';
            }, { timeoutMs: 20000, label: `绑定 ${optionValue}` });
            await waitFor(async () => page.evaluate((pred) => {
                const oai = window.SillyTavern?.getContext?.()?.chatCompletionSettings ?? {};
                return pred.startsWith('reverse:')
                    ? String(oai.reverse_proxy ?? '').includes(pred.slice('reverse:'.length))
                    : String(oai.custom_url ?? '').includes(pred);
            }, markerPred), { timeoutMs: 20000, label: `投影 ${optionValue}` });
            const leaked = (await ctx.fixtureHttp.captures({ since })).filter((row) => row.model !== 'vc08-memory');
            if (leaked.length) throw new Error(`绑定 ${optionValue} 期间出现上游请求`);
            await closePanel();
        };
        const confirmProxy = async (marker) => {
            const dialog = page.locator('dialog[open].popup').first();
            if (!(await dialog.count())) return false;
            const text = (await dialog.innerText()).replace(/\s+/g, ' ');
            if (marker && !text.includes(marker)) throw new Error('代理确认弹窗目标异常');
            await dialog.locator('.popup-button-ok').click();
            await dialog.waitFor({ state: 'hidden', timeout: 10000 });
            return true;
        };
        const ensureSend = async (proxyMarker) => {
            if (!(await page.locator('#send_but.displayNone').count())) return;
            if (!(await page.locator('#api_button_openai').isVisible())) await page.click('#API-status-top');
            await page.locator('#api_button_openai').click();
            await confirmProxy(proxyMarker);
            await waitFor(async () => page.evaluate(() => {
                const button = document.querySelector('#send_but');
                return Boolean(button && !button.classList.contains('displayNone') && button.offsetParent !== null);
            }), { timeoutMs: 30000, label: '发送按钮可见' });
        };
        // ST 默认关闭 function_calling。不打开时，流式工具增量会被忽略，空文本被当成完成回复。
        const enableFunctionTools = async () => {
            await page.evaluate(async () => {
                const { oai_settings } = await import('/scripts/openai.js');
                oai_settings.function_calling = true;
                const box = document.querySelector('#openai_function_calling');
                if (box instanceof HTMLInputElement) box.checked = true;
            });
        };
        await openStory();
        await page.locator('[data-action="start"]').click();
        await waitFor(async () => page.evaluate(() => {
            const root = document.querySelector('.vc-story');
            return root?.getAttribute('data-state') === 'playing' || Boolean(root?.querySelector('[role="alert"]'));
        }), { timeoutMs: 60000, label: '剧情开局' });
        const storyState = await page.locator('.vc-story').getAttribute('data-state');
        if (storyState !== 'playing') throw new Error('开局未进入玩家视图');
        await scanSurface('开局后');
        await shot('story-outbound-start.png');
        const actors = [
            { id: 'lin', fact: STORY_LIN_FACT, marker: 'PRIVATE_LIN_LOAN_31', otherFact: STORY_ZHOU_FACT, otherMarker: 'PRIVATE_ZHOU_WATCH_44', line: (id) => `林岚，走廊的灯还亮着吗 ${id} ${ctx.scope}` },
            { id: 'zhou', fact: STORY_ZHOU_FACT, marker: 'PRIVATE_ZHOU_WATCH_44', otherFact: STORY_LIN_FACT, otherMarker: 'PRIVATE_LIN_LOAN_31', line: (id) => `周澈，今晚大堂安静吗 ${id} ${ctx.scope}` },
        ];
        const protocols = [
            { id: 'OPENAI_CHAT_COMPLETIONS', option: 'vc03m-chat::chat-tools', marker: 'profile=chat-tools', protocol: 'chat', model: 'vc03m-tools', finalUrl: '/v1/chat/completions' },
            { id: 'OPENAI_RESPONSES', option: 'vc03m-resp::reasoning', marker: 'profile=reasoning', protocol: 'responses', model: 'vc03m-reasoning', finalUrl: '/v1/responses' },
            { id: 'ANTHROPIC_MESSAGES', option: 'vc03m-claude::tools', marker: 'reverse:provider=vc03m-claude', protocol: 'anthropic', model: 'vc03m-tools', finalUrl: '/v1/messages', proxy: 'vc-go://model-purposes/FOREGROUND_CHAT?provider=vc03m-claude' },
        ];
        let linEncrypted = '';
        let proxyArmed = true;
        for (const spec of protocols) {
            await closeStory();
            await bindProfile(spec.option, spec.marker);
            for (const actor of actors) {
                await selectActor(actor.id);
                await ensureSend(proxyArmed ? spec.proxy : undefined);
                await enableFunctionTools();
                const player = actor.line(spec.id);
                const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
                const genAt = generates.length;
                const respAt = genResponses.length;
                await page.locator('#send_textarea').fill(player);
                await page.locator('#send_but').click();
                // Claude 的「正在连接代理」在点击发送后才出现。立刻 count() 会漏掉，弹窗挡住后续生成。
                if (proxyArmed && spec.proxy) {
                    const dialog = page.locator('dialog[open].popup').first();
                    await dialog.waitFor({ timeout: 15000 });
                    const text = (await dialog.innerText()).replace(/\s+/g, ' ');
                    if (!text.includes(spec.proxy)) throw new Error('代理确认弹窗目标异常');
                    await dialog.locator('.popup-button-ok').click();
                    await dialog.waitFor({ state: 'hidden', timeout: 10000 });
                    proxyArmed = false;
                }
                try {
                    await waitFor(async () => page.evaluate(({ text, reply }) => {
                        const chat = window.SillyTavern.getContext()?.chat ?? [];
                        const stop = document.querySelector('#mes_stop');
                        const idle = !stop || getComputedStyle(stop).display === 'none';
                        const last = chat[chat.length - 1];
                        return idle && chat.some((message) => message.is_user && message.mes === text) && !last?.is_user && String(last?.mes ?? '').includes(reply);
                    }, { text: player, reply: STORY_FOLLOW }), { timeoutMs: 90000, label: `${spec.id} ${actor.id} 工具后续` });
                } catch (error) {
                    await shot('story-outbound-send-stuck.png');
                    const statuses = genResponses.slice(respAt).map((item) => item.status).join(',');
                    throw new Error(`${spec.id} ${actor.id} 未完成工具后续（generate HTTP ${statuses || '无'}）`);
                }
                const seen = generates.slice(genAt);
                const responses = genResponses.slice(respAt);
                const bucket = report.protocols[spec.id];
                if (seen.length < 2) throw new Error(`${spec.id} ${actor.id} 的 ST 生成请求少于 2`);
                for (const item of seen) {
                    if (!item.hasProbe || !item.hasPublic || !item.hasCard) throw new Error(`${spec.id} ${actor.id} 的生成请求未注入世界书或角色卡`);
                    if (!item.vc_story || item.vc_story.actorIds || item.vc_story.actorId !== actor.id) throw new Error(`${spec.id} ${actor.id} 的 vc_story 不是单个当前 actor`);
                    if (item.vc_story.keys.join(',') !== 'actorId,branchId,chatIdentity,runId,worldVersion') throw new Error(`${spec.id} ${actor.id} 的 vc_story 字段异常`);
                    pass(bucket, 4);
                }
                if (responses.some((item) => item.memory)) throw new Error(`${spec.id} 剧情响应带了记忆槽头`);
                pass(bucket);
                const rows = (await ctx.fixtureHttp.captures({ protocol: spec.protocol, since })).filter((row) => {
                    const raw = JSON.stringify(row.body ?? {});
                    return raw.includes(player) || raw.includes(STORY_TOOL_RESULT);
                });
                if (rows.length !== 2) throw new Error(`${spec.id} ${actor.id} 上游请求数为 ${rows.length}`);
                bucket.requests += rows.length;
                const story = seen[0].vc_story;
                const view = await ctx.admin.call('GET', `/api/v1/story/runs/${encodeURIComponent(story.runId)}/actors/${encodeURIComponent(actor.id)}/view?branchId=${encodeURIComponent(story.branchId)}&worldVersion=${encodeURIComponent(String(story.worldVersion))}`);
                if (view.status !== 200) throw new Error(`${spec.id} ActorView HTTP ${view.status}`);
                const viewText = storyCanonicalView(view.json, { ...story, actorId: actor.id });
                rows.forEach((row, index) => {
                    const raw = JSON.stringify(row.body ?? {});
                    const follow = raw.includes(STORY_TOOL_RESULT);
                    if (Boolean(follow) !== (index === 1)) throw new Error(`${spec.id} ${actor.id} 第 ${index + 1} 个请求的工具记录位置异常`);
                    if (row.finalUrl !== spec.finalUrl || row.body?.model !== spec.model || row.auth?.matched !== true) throw new Error(`${spec.id} 最终 URL、模型或 auth 异常`);
                    if (storySystemText(spec.protocol, row.body) !== viewText) throw new Error(`${spec.id} ${actor.id} 规范视图不一致`);
                    if (!raw.includes(player) || !raw.includes(actor.fact) || !raw.includes(actor.marker)) throw new Error(`${spec.id} ${actor.id} 缺少玩家话语或当前视图`);
                    if (raw.includes(actor.otherFact) || raw.includes(actor.otherMarker) || raw.includes(story.chatIdentity) || raw.includes('vc_story')) throw new Error(`${spec.id} ${actor.id} 混入了其他身份或聊天身份`);
                    for (const [name] of STORY_FORBIDDEN) {
                        if (raw.includes(STORY_FORBIDDEN.find((item) => item[0] === name)[1])) throw new Error(`${spec.id} ${actor.id} 上游含 ${name}`);
                    }
                    if (follow) {
                        if (!raw.includes('note_clue') || !raw.includes(STORY_TOOL_RESULT)) throw new Error(`${spec.id} ${actor.id} 后续轮缺少工具记录`);
                    } else if (raw.includes(STORY_TOOL_RESULT)) throw new Error(`${spec.id} ${actor.id} 首轮含工具结果`);
                    if (spec.protocol === 'responses') {
                        const reasoning = (row.body.input ?? []).filter((item) => item?.type === 'reasoning');
                        if (!follow && reasoning.length !== 0) throw new Error(`${spec.id} ${actor.id} 首轮含 reasoning`);
                        if (follow) {
                            if (reasoning.length !== 1 || typeof reasoning[0].encrypted_content !== 'string' || !reasoning[0].encrypted_content.startsWith('enc-vc03m-')) throw new Error(`${spec.id} ${actor.id} 后续轮 reasoning 异常`);
                            if (actor.id === 'lin') linEncrypted = reasoning[0].encrypted_content;
                            if (actor.id === 'zhou' && (!linEncrypted || reasoning[0].encrypted_content === linEncrypted)) throw new Error('周澈后续轮复用了林岚的 reasoning');
                        }
                    } else if (raw.includes('enc-vc03m-')) throw new Error(`${spec.id} 注入了 Responses reasoning`);
                    if (spec.protocol === 'responses' && row.body.store !== false) throw new Error('Responses store 未关闭');
                    pass(bucket, 8);
                });
                if (spec.id === 'OPENAI_RESPONSES' && actor.id === 'zhou') report.reasoningIsolated = true;
            }
        }
        await scanSurface('三协议发送后');
        await shot('story-outbound-protocols.png');
        await openChat(companionFile);
        await waitFor(async () => page.evaluate(() => {
            const binding = window.SillyTavern.getContext().chatMetadata?.vc_binding;
            return binding?.mode === 'COMPANION' && /^[1-9][0-9]{0,18}$/.test(binding.conversationId || '');
        }), { timeoutMs: 30000, label: 'COMPANION 绑定' });
        await bindProfile('vc03m-chat::chat', 'profile=chat');
        await ensureSend();
        const companionText = `今天只是问一句公开的话 ${ctx.scope}`;
        const companionSince = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
        const companionGen = generates.length;
        const companionResp = genResponses.length;
        await page.locator('#send_textarea').fill(companionText);
        await page.locator('#send_but').click();
        await waitFor(async () => page.evaluate(({ text, reply }) => {
            const chat = window.SillyTavern.getContext()?.chat ?? [];
            const stop = document.querySelector('#mes_stop');
            const idle = !stop || getComputedStyle(stop).display === 'none';
            const last = chat[chat.length - 1];
            return idle && chat.some((message) => message.is_user && message.mes === text) && String(last?.mes ?? '').includes(reply);
        }, { text: companionText, reply: '受管验收的合成回复' }), { timeoutMs: 60000, label: 'COMPANION 回复' });
        const companionRows = (await ctx.fixtureHttp.captures({ protocol: 'chat', since: companionSince })).filter((row) => JSON.stringify(row.body ?? {}).includes(companionText));
        if (companionRows.length !== 1) throw new Error(`COMPANION 上游请求数为 ${companionRows.length}`);
        report.companion.requests = 1;
        const companionRaw = JSON.stringify(companionRows[0].body ?? {});
        if (!companionRaw.includes(STORY_PROBE) || !companionRaw.includes('VCW13_PUBLIC_LORE_HARMLESS') || !companionRaw.includes(STORY_CARD)) throw new Error('COMPANION 未保留世界书或角色卡');
        if (companionRaw.includes('"publicLore"') || companionRaw.includes('PRIVATE_') || companionRaw.includes('GM_ONLY_') || companionRaw.includes(STORY_ZHOU_FACT)) throw new Error('COMPANION 被剧情重写或含私密');
        const companionSeen = generates.slice(companionGen);
        if (companionSeen.length !== 1 || companionSeen[0].vc_story || companionSeen[0].mode === 'STORY') throw new Error('COMPANION 生成请求带了剧情身份');
        const memory = genResponses.slice(companionResp).map((item) => item.memory).find(Boolean);
        if (!['ok', 'skipped', 'disabled'].includes(memory)) throw new Error('COMPANION 未重核记忆槽');
        pass(report.companion, 5);
        await openChat(storyFile);
        await waitFor(async () => page.evaluate(() => window.SillyTavern.getContext().chatMetadata?.vc_binding?.mode === 'STORY'), { timeoutMs: 30000, label: '回到 STORY 聊天' });
        await bindProfile('vc03m-chat::chat-tools', 'profile=chat-tools');
        await page.evaluate(async ({ name, content }) => {
            const wi = await import('/scripts/world-info.js');
            const data = await wi.loadWorldInfo(name);
            const entry = wi.createWorldInfoEntry(name, data);
            if (!entry) throw new Error('无法追加世界书条目');
            entry.content = content;
            entry.constant = true;
            entry.disable = false;
            entry.selective = false;
            entry.position = 0;
            entry.comment = 'w13-negative';
            await wi.saveWorldInfo(name, data, true);
            const editor = document.querySelector('#world_editor_select');
            if (editor) editor.value = '';
        }, { name: bookName, content: STORY_ZHOU_FACT });
        await selectActor('lin');
        await ensureSend();
        const rejectedText = `林岚，这条不该出站 ${ctx.scope}`;
        const rejectedSince = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
        const rejectedGen = generates.length;
        const rejectedResp = genResponses.length;
        await page.locator('#send_textarea').fill(rejectedText);
        await page.locator('#send_but').click();
        await waitFor(async () => genResponses.slice(rejectedResp).some((item) => item.errorCode || item.status < 400) && await page.evaluate(() => {
            const stop = document.querySelector('#mes_stop');
            return !stop || getComputedStyle(stop).display === 'none';
        }), { timeoutMs: 30000, label: '负向回合结束' });
        const rejectedRows = await ctx.fixtureHttp.captures({ since: rejectedSince });
        const rejectedStatus = genResponses.slice(rejectedResp);
        const rejectedError = rejectedStatus.find((item) => item.fixedReject) || rejectedStatus.at(-1);
        if (rejectedRows.length !== 0 || rejectedStatus.some((item) => item.status < 400) || !rejectedError?.fixedReject || rejectedError.errorCode !== 'VC_STORY_OUTBOUND_REJECTED' || rejectedError.echoedSecret) {
            throw new Error(`负向回合上游请求数为 ${rejectedRows.length}，HTTP ${rejectedError?.status || '无'}，错误码 ${rejectedError?.errorCode || '无'}`);
        }
        const rejectedRequest = generates[rejectedGen];
        if (!rejectedRequest?.hasSecret || rejectedRequest.vc_story?.actorId !== 'lin') throw new Error('负向回合没有把世界书私密送进被拒绝的生成请求');
        report.negativeSecret.requests = 0;
        report.negativeSecret.rejected = true;
        pass(report.negativeSecret, 3);
        await scanSurface('负向拒绝后');
        await shot('story-outbound-rejected.png');
        const identitySnap = await bindForeground(ctx, 'vc03m-chat', 'chat-tools', 'vc03m-tools');
        const identitySince = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
        const identity = await ctx.st.generate({
            chat_completion_source: 'custom',
            model: 'vc03m-tools',
            custom_url: identitySnap.marker,
            vc_session_mode: 'STORY',
            messages: [{ role: 'user', content: `缺身份的合成请求 ${ctx.scope}` }],
            max_tokens: 256,
            stream: false,
        });
        const identityRows = await ctx.fixtureHttp.captures({ since: identitySince });
        if (identity.status === 200 || identityRows.length !== 0) throw new Error(`缺 vc_story 的请求未被拒绝或已出站：HTTP ${identity.status} 请求 ${identityRows.length}`);
        const identityCode = identity.json?.error?.code || identity.json?.code;
        if (identityCode !== 'VC_STORY_IDENTITY_REQUIRED') throw new Error(`缺 vc_story 的错误码为 ${identityCode || '无'}`);
        if (String(identity.json?.error?.message || '').includes(STORY_ZHOU_FACT)) throw new Error('缺身份拒绝回显了私密');
        report.missingIdentity.requests = 0;
        report.missingIdentity.rejected = true;
        pass(report.missingIdentity, 3);
        await scanSurface('结束后');
        // 原生出站的结算在响应返回后异步入账。Go 不回收 HELD，场景结束时本 owner 不能留下。
        const heldDeadline = Date.now() + 5000;
        let foregroundLedger = '';
        let heldForeground = '1';
        do {
            foregroundLedger = psql(`SELECT status || '=' || count(*)::text
                FROM vc.model_cost_reservation
                WHERE owner_user_id = ${BigInt(rt.OWNER_ACCOUNT_ID)} AND purpose = 'FOREGROUND_CHAT'
                GROUP BY status ORDER BY status;`).trim();
            const heldRow = foregroundLedger.split('\n').map((line) => line.trim()).find((line) => line.startsWith('HELD='));
            heldForeground = heldRow ? heldRow.slice('HELD='.length) : '0';
            if (heldForeground === '0') break;
            await new Promise((resolve) => setTimeout(resolve, 200));
        } while (Date.now() < heldDeadline);
        report.foregroundReservation = foregroundLedger;
        report.heldForeground = Number(heldForeground);
        if (heldForeground !== '0') throw new Error(`本 owner 的 FOREGROUND_CHAT 仍有 HELD 预留 ${heldForeground}：${foregroundLedger}`);
        log.ok(`本 owner FOREGROUND_CHAT 预留 ${foregroundLedger || '无'}；HELD 残留 ${heldForeground}`);
        fs.writeFileSync(path.join(ctx.artifactsDir, 'story-outbound-summary.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
        log.ok(`story-outbound 计数 ${JSON.stringify(report)}`);
        return report;
    } finally {
        await ctx.fixtureHttp.setOverride('vc03m-tools', null);
        await ctx.fixtureHttp.setOverride('vc03m-reasoning', null);
        if (browser) await browser.close();
    }
}

export const storyOutboundScene = {
    id: 'story-outbound',
    title: 'W13 三协议剧情出站：规范视图、工具后续与续接不跨角色',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneStoryOutbound,
};
export const scenes = [storyOutboundScene];
