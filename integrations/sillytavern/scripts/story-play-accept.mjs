import path from 'node:path';
import crypto from 'node:crypto';
import {
    waitFor,
} from './managed-lib.mjs';
import { pinVcUi } from './vc-ui-pin.mjs';
import { log, psql, rt } from './lib/accept-runtime.mjs';
import { bindForeground } from './lib/accept-scene-helpers.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import {
    STORY_GREETING, STORY_ZHOU_FACT, storyCanonicalView, storySystemText,
} from './lib/story-accept-shared.mjs';

export async function sceneStoryPlay(ctx) {
    const line = `林岚，钥匙是你借出的吗？${ctx.scope}`;
    const oldHistory = `上一轮不该出站的旧聊天历史VCW14 ${ctx.scope}`;
    const currentUtterance = `现在只问这一句 ${ctx.scope}`;
    const providerLine = '合成台词。';
    await ctx.fixtureHttp.setOverride('vc03m-tools', { text: providerLine, tool: null, reasoning: null, toolOnce: false });
    await bindForeground(ctx, 'vc03m-chat', 'chat-tools', 'vc03m-tools');
    const cardName = `W14 剧情 ${crypto.randomUUID().slice(0, 8)}`;
    const card = {
        name: cardName,
        description: '合成剧情卡，只供本场验收。',
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
    const firstFile = `W14-story-a-${crypto.randomUUID()}`;
    const secondFile = `W14-story-b-${crypto.randomUUID()}`;
    const saveChatFile = async (file, token) => {
        const saved = await ctx.st.call('POST', '/api/chats/save', {
            avatar_url: avatar,
            file_name: file,
            chat: [
                { user_name: 'unused', character_name: cardName, chat_metadata: { vc_f2: token, vc_binding: { mode: 'STORY' } } },
                { name: cardName, is_user: false, mes: STORY_GREETING, swipe_id: 0, swipes: [STORY_GREETING] },
            ],
        });
        if (saved.status !== 200) throw new Error(`保存聊天失败：HTTP ${saved.status}`);
    };
    await saveChatFile(firstFile, { id: crypto.randomUUID(), revision: 0 });
    await saveChatFile(secondFile, { id: crypto.randomUUID(), revision: 0 });
    const storyRow = (conversationId) => {
        if (!/^[1-9][0-9]{0,18}$/.test(String(conversationId || ''))) throw new Error('会话编号不能用来查询剧情');
        const raw = psql(`SELECT coalesce(json_build_object(
            'worldVersion', r.world_version,
            'stage', r.stage,
            'clues', r.world_state->'clues',
            'items', r.world_state->'items',
            'events', (SELECT count(*) FROM vc.story_event e WHERE e.run_id = r.id),
            'branches', (SELECT count(*) FROM vc.story_branch b WHERE b.run_id = r.id),
            'root', (SELECT b.id::text FROM vc.story_branch b WHERE b.run_id = r.id AND b.parent_branch_id IS NULL),
            'head', r.current_branch_id::text,
            'runId', r.id::text,
            'participants', (SELECT count(*) FROM vc.story_participant p WHERE p.run_id = r.id),
            'linRel', (SELECT p.relationship_id::text FROM vc.story_participant p WHERE p.run_id = r.id AND p.actor_id = 'lin'),
            'epilogue', (SELECT e.decision FROM vc.story_epilogue e WHERE e.run_id = r.id),
            'memory', (SELECT m.status FROM vc.story_epilogue e JOIN vc.memory_item m ON m.id = e.memory_id AND m.owner_user_id = e.owner_user_id WHERE e.run_id = r.id),
            'accepted', (SELECT count(*) FROM vc.memory_item m WHERE m.owner_user_id = r.owner_user_id AND m.status = 'ACCEPTED'),
            'a1State', (SELECT e.projection_state FROM vc.story_event e WHERE e.run_id = r.id AND e.action_id = 'a1')
        )::text, '') FROM vc.story_run r WHERE r.conversation_id = ${conversationId};`).trim();
        if (!raw) throw new Error('没有查到这一局');
        return JSON.parse(raw);
    };
    let browser;
    const memoryConfirms = [];
    const actorHits = [];
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
        const consoleLines = [];
        page.on('pageerror', (error) => consoleLines.push(error.message.slice(0, 240)));
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleLines.push(msg.text().slice(0, 240));
        });
        page.on('request', (req) => {
            const url = req.url();
            if (/\/api\/v1\/memories\/[1-9][0-9]*\/confirm(?:\?|$)/.test(url)) memoryConfirms.push(url);
            if (/\/actors\/(?:lin|zhou|su|gm)\//.test(url)) actorHits.push(url);
        });
        const shot = async (name) => {
            const file = path.join(ctx.artifactsDir, name);
            try {
                await page.screenshot({ path: file });
                ctx.screenshots.push(file);
            } catch { /* 截图失败不掩盖原错误 */ }
        };
        const failShot = async (error) => {
            await shot('story-play-failure.png');
            const text = await page.locator('body').innerText({ timeout: 2000 }).then((value) => value.replace(/\s+/g, ' ').slice(0, 300)).catch(() => '');
            throw new Error(`${error.message} body=${text} console=${consoleLines.slice(-4).join(' | ')}`);
        };
        try {
            await page.goto(rt.ST_BASE, { waitUntil: 'domcontentloaded' });
            await waitFor(async () => page.evaluate(async () => (await import('/script.js')).settingsReady || Boolean(document.querySelector('dialog[open] .onboarding'))), { timeoutMs: 60000, label: 'ST 设置或欢迎页' });
            const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
            if (await onboarding.count()) {
                await onboarding.locator('textarea').fill('w14-owner');
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
            const conversationId = async () => page.evaluate(() => {
                const binding = window.SillyTavern.getContext().chatMetadata?.vc_binding;
                return binding?.mode === 'STORY' && /^[1-9][0-9]{0,18}$/.test(binding.conversationId || '') ? binding.conversationId : '';
            });
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
            const confirmProxy = async () => {
                const dialog = page.locator('dialog[open].popup').first();
                if (!(await dialog.count())) return;
                await dialog.locator('.popup-button-ok').click();
                await dialog.waitFor({ state: 'hidden', timeout: 10000 });
            };
            const ensureSend = async () => {
                if (!(await page.locator('#send_but.displayNone').count())) return;
                if (!(await page.locator('#api_button_openai').isVisible())) await page.click('#API-status-top');
                await page.locator('#api_button_openai').click();
                await confirmProxy();
                await waitFor(async () => page.evaluate(() => {
                    const button = document.querySelector('#send_but');
                    return Boolean(button && !button.classList.contains('displayNone') && button.offsetParent !== null);
                }), { timeoutMs: 30000, label: '发送按钮可见' });
            };
            const scanSurface = async (label) => {
                const dom = await page.evaluate(() => document.documentElement.outerHTML);
                const stored = await page.evaluate(() => {
                    const entries = [];
                    for (let i = 0; i < localStorage.length; i += 1) entries.push(localStorage.getItem(localStorage.key(i)) || '');
                    return entries.join('\n');
                });
                for (const marker of [...STORY_MARKERS, STORY_ZHOU_FACT]) {
                    if (dom.includes(marker) || stored.includes(marker)) throw new Error(`${label} 的页面或 localStorage 含私密标记`);
                }
            };
            const waitStory = async (check, label) => waitFor(async () => page.evaluate(check), { timeoutMs: 30000, label });
            const dismissConflict = async () => {
                await page.evaluate(() => {
                    const panel = document.querySelector('#vc-f2-conflict');
                    if (panel?.open) panel.close();
                });
            };
            const act = async (step, version) => {
                await dismissConflict();
                await page.locator(`.vc-story-dialog [data-action="act"][data-step="${step}"]`).click();
                await waitFor(async () => page.evaluate((expected) => {
                    const root = document.querySelector('.vc-story');
                    return root?.getAttribute('data-world-version') === expected
                        && !root.innerText.includes('行动已生效，聊天记录待同步');
                }, version), { timeoutMs: 45000, label: `${step} 到版本 ${version}` });
                await dismissConflict();
            };
            await openChat(firstFile);
            const firstConversation = await waitFor(async () => {
                const id = await conversationId();
                return id || false;
            }, { timeoutMs: 30000, label: '第一局 STORY 绑定' });
            await waitFor(async () => page.evaluate(() => String(window.SillyTavern.getContext().chatCompletionSettings?.custom_url ?? '').includes('profile=chat-tools')), { timeoutMs: 30000, label: 'chat-tools 投影' });
            await openStory();
            await page.locator('.vc-story-dialog [data-action="start"]').click();
            await waitStory(() => document.querySelector('.vc-story')?.getAttribute('data-state') === 'playing', '第一局开局');
            const opened = await page.locator('.vc-story').innerText();
            if (opened.includes('结局') || opened.includes('确认回档') || opened.includes('workshop_cabinet')) throw new Error('调查中的页面写出了结局或内部目标');
            await scanSurface('开局后');
            const beforeCabinet = await ctx.fixtureHttp.count();
            await page.locator('.vc-story-dialog [data-action="act"][data-step="a6"]').click();
            await waitStory(() => document.querySelector('.vc-story [role="alert"]')?.textContent === '条件还不足，世界没有变化。', '无钥匙开柜');
            if ((await ctx.fixtureHttp.count()) !== beforeCabinet) throw new Error('规则拒绝联系了上游');
            const denied = await page.locator('.vc-story').innerText();
            for (const word of ['在维修柜找回怀表', '发现证据：', providerLine, '拿到钥匙']) {
                if (denied.includes(word)) throw new Error('规则拒绝写出了成功正文');
            }
            const deniedRow = storyRow(firstConversation);
            if (deniedRow.worldVersion !== 0 || deniedRow.events !== 0 || JSON.stringify(deniedRow.clues) !== '[]' || JSON.stringify(deniedRow.items) !== '[]' || deniedRow.branches !== 1) {
                throw new Error('无钥匙开柜改变了世界');
            }
            await page.evaluate(() => {
                const real = window.fetch.bind(window);
                window.__vcAck = { thrown: false, saves: 0 };
                window.fetch = async (input, init) => {
                    const url = typeof input === 'string' ? input : input?.url || String(input ?? '');
                    const body = typeof init?.body === 'string' ? init.body : '';
                    if (url.includes('/api/chats/save') && body.includes('world_event_id')) {
                        window.__vcAck.saves += 1;
                        if (!window.__vcAck.thrown) {
                            await real(input, init);
                            window.__vcAck.thrown = true;
                            const error = new Error('ack lost');
                            error.code = 'ACK_LOST';
                            error.name = 'F2ConflictError';
                            throw error;
                        }
                    }
                    return real(input, init);
                };
            });
            await act('a1', '1');
            const ack = await page.evaluate(() => window.__vcAck);
            if (!ack?.thrown) throw new Error('没有模拟到保存回执丢失');
            const projected = await page.evaluate(() => {
                const chat = window.SillyTavern.getContext().chat ?? [];
                return chat.filter((message) => message?.extra?.type === 'vc_story_projection').map((message) => message.extra.world_event_id);
            });
            if (projected.length !== 1) throw new Error(`投影消息数为 ${projected.length}`);
            const afterA1 = storyRow(firstConversation);
            if (afterA1.worldVersion !== 1 || afterA1.events !== 1 || JSON.stringify(afterA1.clues) !== '["loan_note"]' || JSON.stringify(afterA1.items) !== '[]' || afterA1.a1State !== 'CONFIRMED') {
                throw new Error('投影恢复后世界版本或线索不只变化一次');
            }
            const evidence = await page.locator('.vc-story').innerText();
            if (!evidence.includes('发现证据：钥匙借用记录')) throw new Error('页面没有显示玩家可见的证据名');
            await dismissConflict();
            await page.locator('.vc-story-dialog [data-action="select-actor"][data-actor="lin"]').click();
            await page.locator('.vc-story-dialog [data-field="say"]').fill(line);
            await page.locator('.vc-story-dialog [data-action="say"]').click();
            await waitStory(() => {
                const root = document.querySelector('.vc-story');
                return root?.getAttribute('data-world-version') === '2' && !root.innerText.includes('行动已生效，聊天记录待同步');
            }, '对白到版本 2');
            await dismissConflict();
            await closeStory();
            await ensureSend();
            await page.evaluate((text) => {
                window.SillyTavern.getContext().chat.push({ name: 'User', is_user: true, mes: text, extra: {} });
            }, oldHistory);
            const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
            let generateBody = null;
            const onGenerate = (req) => {
                if (!req.url().includes('/api/backends/chat-completions/generate')) return;
                try { generateBody = req.postDataJSON(); } catch { generateBody = null; }
            };
            page.on('request', onGenerate);
            await page.locator('#send_textarea').fill(currentUtterance);
            await page.locator('#send_but').click();
            const popup = page.locator('dialog[open].popup').first();
            try {
                await popup.waitFor({ timeout: 4000 });
                await popup.locator('.popup-button-ok').click();
                await popup.waitFor({ state: 'hidden', timeout: 10000 });
            } catch { /* 这一档没有代理确认 */ }
            await waitFor(async () => page.evaluate((reply) => {
                const chat = window.SillyTavern.getContext()?.chat ?? [];
                const stop = document.querySelector('#mes_stop');
                const idle = !stop || getComputedStyle(stop).display === 'none';
                const last = chat[chat.length - 1];
                return idle && !last?.is_user && String(last?.mes ?? '').includes(reply);
            }, providerLine), { timeoutMs: 90000, label: '合成台词' });
            page.off('request', onGenerate);
            const rows = (await ctx.fixtureHttp.captures({ protocol: 'chat', since })).filter((row) => JSON.stringify(row.body ?? {}).includes(currentUtterance));
            if (rows.length !== 1) throw new Error(`出站回合数为 ${rows.length}`);
            const upstream = JSON.stringify(rows[0].body ?? {});
            const system = storySystemText('chat', rows[0].body);
            if (rows[0].finalUrl !== '/v1/chat/completions' || rows[0].body?.model !== 'vc03m-tools') throw new Error('出站协议或模型不对');
            if (!system.includes(line) || upstream.includes(oldHistory) || upstream.includes(STORY_GREETING)) throw new Error('上游缺少对白，或仍含旧聊天历史');
            for (const marker of [STORY_ZHOU_FACT, 'PRIVATE_ZHOU_WATCH_44', 'PRIVATE_SU_WITNESS_57', 'GM_ONLY_WATCH_TRUTH_92']) {
                if (upstream.includes(marker)) throw new Error('上游含其他角色或 GM 的私密');
            }
            const story = generateBody?.vc_story;
            if (!story || story.actorId !== 'lin' || Number(story.worldVersion) !== 2) throw new Error('这一回合的剧情身份不是林岚的当前版本');
            const linView = await ctx.admin.call('GET', `/api/v1/story/runs/${encodeURIComponent(story.runId)}/actors/lin/view?branchId=${encodeURIComponent(story.branchId)}&worldVersion=2`);
            const zhouView = await ctx.admin.call('GET', `/api/v1/story/runs/${encodeURIComponent(story.runId)}/actors/zhou/view?branchId=${encodeURIComponent(story.branchId)}&worldVersion=2`);
            if (linView.status !== 200 || zhouView.status !== 200) throw new Error('读取角色视图失败');
            const linEvents = JSON.stringify(linView.json?.events ?? []);
            const zhouEvents = JSON.stringify(zhouView.json?.events ?? []);
            if (!linEvents.includes(line) || zhouEvents.includes(line) || zhouEvents.includes('loan_note')) throw new Error('对白没有只出现在林岚视图');
            if (system !== storyCanonicalView(linView.json, story)) throw new Error('上游系统正文不是林岚的规范视图');
            await openStory();
            const steps = [['a2', '3'], ['a3', '4'], ['a4', '5'], ['a5', '6'], ['a6', '7'], ['a7', '8']];
            for (const [step, version] of steps) await act(step, version);
            await waitStory(() => {
                const root = document.querySelector('.vc-story');
                return root?.getAttribute('data-state') === 'ended' && root.querySelector('.vc-story-ending h2')?.textContent === '结局';
            }, '第一局结局');
            const rootBefore = storyRow(firstConversation);
            if (rootBefore.worldVersion !== 8 || rootBefore.stage !== 'resolved' || rootBefore.events !== 8 || rootBefore.branches !== 1) {
                throw new Error('七步之后的世界进度不对');
            }
            await reauthForWrite(ctx);
            const created = await ctx.admin.call('POST', '/api/v1/relationships', { personaRef: 'gentle-listener' });
            const relationshipId = String(created.json?.relationshipId ?? '');
            if (created.status !== 200 || !/^[1-9][0-9]{0,18}$/.test(relationshipId)) throw new Error('创建陪伴失败');
            await page.locator('.vc-story-dialog [data-action="show-companions"]').click();
            await page.locator(`.vc-story-dialog [data-action="map-companion"][data-actor="lin"][data-relationship="${relationshipId}"]`).click();
            await waitFor(async () => storyRow(firstConversation).linRel === relationshipId, { timeoutMs: 15000, label: '林岚入局' });
            const removed = await ctx.admin.call('DELETE', `/api/v1/relationships/${relationshipId}`);
            if (removed.status !== 200) throw new Error('删除陪伴失败');
            const afterDelete = storyRow(firstConversation);
            const names = await page.locator('.vc-story').innerText();
            if (afterDelete.participants !== 4 || afterDelete.linRel !== null || !names.includes('林岚') || !names.includes('周澈') || !names.includes('苏禾')) {
                throw new Error('删除陪伴后这一局不完整');
            }
            const beforeDiscard = storyRow(firstConversation);
            await page.locator('.vc-story-dialog [data-action="discard-epilogue"]').click();
            await waitStory(() => document.querySelector('.vc-story')?.innerText.includes('已放弃共同游玩摘要，不会写入日常记忆。'), '放弃结局');
            const discarded = storyRow(firstConversation);
            if (discarded.epilogue !== 'discard' || discarded.memory !== null || discarded.accepted !== beforeDiscard.accepted) {
                throw new Error(`放弃结局写入了记忆：epilogue=${discarded.epilogue} memory=${discarded.memory} accepted=${beforeDiscard.accepted}->${discarded.accepted}`);
            }
            let rewindPosts = 0;
            const onRewind = (req) => {
                if (req.method() === 'POST' && req.url().includes('/rewind')) rewindPosts += 1;
            };
            page.on('request', onRewind);
            await page.locator('.vc-story-dialog [data-action="ask-rewind"][data-version="1"]').click();
            const rewindText = await page.locator('.vc-story-rewind-dialog').innerText();
            if (!rewindText.includes('回到世界版本 1，阶段为调查中。此版本之后的行动不会留在当前分支，需要重新提交才会再次发生。该阶段之后形成的分支记忆会失效，不会并入当前进度。')) {
                throw new Error('回档确认没有写明阶段和影响');
            }
            if (rewindPosts !== 0) throw new Error('确认前就提交了回档');
            await page.locator('.vc-story-rewind-dialog [data-action="confirm-rewind"]').click();
            await waitStory(() => document.querySelector('.vc-story')?.getAttribute('data-world-version') === '1', '回档到版本 1');
            page.off('request', onRewind);
            const rewound = storyRow(firstConversation);
            if (rewound.worldVersion !== 1 || rewound.head === rootBefore.root || rewound.branches !== 2 || JSON.stringify(rewound.clues) !== '["loan_note"]') {
                throw new Error('回档没有停在当前头');
            }
            await reauthForWrite(ctx);
            const late = await ctx.admin.call('POST', `/api/v1/story/runs/${rewound.runId}/actions`, {
                branchId: rootBefore.root,
                expectedWorldVersion: 1,
                actionId: 'late-after-rewind',
                actorId: 'player',
                action: 'request_evidence',
                target: 'su',
            });
            const lateRow = storyRow(firstConversation);
            if (late.status !== 409 || late.json?.code !== 'REVISION_CONFLICT' || lateRow.branches !== rewound.branches) {
                throw new Error('回档后的迟到提交另开了分支');
            }
            await closeStory();
            await openChat(secondFile);
            const secondConversation = await waitFor(async () => {
                const id = await conversationId();
                return id && id !== firstConversation ? id : false;
            }, { timeoutMs: 30000, label: '第二局 STORY 绑定' });
            await openStory();
            await page.locator('.vc-story-dialog [data-action="start"]').click();
            await waitStory(() => {
                const root = document.querySelector('.vc-story');
                return root?.getAttribute('data-state') === 'playing' && root.getAttribute('data-world-version') === '0';
            }, '第二局开局');
            const clean = [['a1', '1'], ['a2', '2'], ['a3', '3'], ['a4', '4'], ['a5', '5'], ['a6', '6'], ['a7', '7']];
            for (const [step, version] of clean) await act(step, version);
            await waitStory(() => document.querySelector('.vc-story')?.getAttribute('data-state') === 'ended', '第二局结局');
            await reauthForWrite(ctx);
            const again = await ctx.admin.call('POST', '/api/v1/relationships', { personaRef: 'gentle-listener' });
            const secondRelationship = String(again.json?.relationshipId ?? '');
            if (again.status !== 200 || !/^[1-9][0-9]{0,18}$/.test(secondRelationship)) throw new Error('第二位陪伴创建失败');
            await page.locator('.vc-story-dialog [data-action="show-companions"]').click();
            await page.locator(`.vc-story-dialog [data-action="map-companion"][data-actor="lin"][data-relationship="${secondRelationship}"]`).click();
            await waitFor(async () => storyRow(secondConversation).linRel === secondRelationship, { timeoutMs: 15000, label: '第二局林岚入局' });
            await page.locator('.vc-story-dialog [data-field="summary"]').fill('一起查过怀表');
            const beforeSave = storyRow(secondConversation);
            await page.locator('.vc-story-dialog [data-action="save-epilogue"]').click();
            await waitStory(() => document.querySelector('.vc-story')?.innerText.includes('已保存共同游玩摘要，请到记忆页确认后才会写入日常记忆。'), '保存结局');
            const saved = storyRow(secondConversation);
            if (saved.worldVersion !== 7 || saved.epilogue !== 'save' || saved.memory !== 'PENDING_CONFIRMATION' || saved.accepted !== beforeSave.accepted || memoryConfirms.length !== 0) {
                throw new Error(`保存结局没有停在待确认记忆：version=${saved.worldVersion} epilogue=${saved.epilogue} memory=${saved.memory} accepted=${beforeSave.accepted}->${saved.accepted} confirms=${memoryConfirms.length}`);
            }
            if (actorHits.length) throw new Error('页面请求了其他角色视图');
            await scanSurface('结束后');
            await shot('story-play-save.png');
            log.ok('story-play 七步、回档、投影、陪伴与两种结局通过');
            return { first: firstConversation, second: secondConversation, upstream: rows.length };
        } catch (error) {
            await failShot(error);
        }
    } finally {
        await ctx.fixtureHttp.setOverride('vc03m-tools', null);
        if (browser) await browser.close();
    }
}

export const storyPlayScene = {
    id: 'story-play',
    title: 'W14 剧情行动、回档、投影补写、陪伴入局与结局',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneStoryPlay,
};
export const scenes = [storyPlayScene];
