// W15 汇合页受管验收。默认不进入场景集，只在 --filter w15-ui 时运行。
// 合成数据与本地固定 provider；不发真实邮件或飞书，不记录凭据。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { waitFor } from './managed-lib.mjs';

const F01_SHOTS = '/private/tmp/claude-501/-Users-hxf-projects-virtual-companion/67c91cf9-5973-42e2-bbc0-514b65af332e/scratchpad/f01-shots';
const SHOTS = process.env.VC_W15_SHOTS
    || '/private/tmp/claude-501/-Users-hxf-projects-virtual-companion/67c91cf9-5973-42e2-bbc0-514b65af332e/scratchpad/w15-shots/w15-4c';
const GREETING = '这是一次合成测试对话。';
const REPLY = '收到。这是受管验收的合成回复，内容固定可断言。';
const VIEWPORTS = [
    { name: '1440', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
    { name: '360', width: 360, height: 780 },
];

const NAV = [
    ['chat', '聊天'],
    ['characters', '角色'],
    ['memory', '记忆'],
    ['inbox', '主动陪伴'],
    ['story', '剧情'],
    ['models', '模型'],
    ['account', '账户'],
];

function fixtureBase() {
    const port = process.env.VC_W03_FIXTURE_PORT || '8753';
    return `http://127.0.0.1:${port}`;
}

function ledgerModel(profileKey, displayName, pricing) {
    const model = {
        profileKey,
        modelId: profileKey,
        displayName,
        contextWindowTokens: 8192,
        maxOutputTokens: 1024,
        state: 'ENABLED',
    };
    if (pricing) model.pricing = pricing;
    return model;
}

/** 用管理 API 造出三种 ledgerPrice。空价显式提交 pricing:{}，重复运行也会清回 MISSING。 */
async function ensureLedgerProfiles(ctx) {
    const reauth = await ctx.admin.reauth(ctx.secrets.password);
    if (!reauth.ok) throw new Error(`计价样本重新验证失败 HTTP ${reauth.status}`);
    const listed = await ctx.admin.listProviders();
    if (listed.status !== 200 || !Array.isArray(listed.json)) throw new Error(`供应商列表 HTTP ${listed.status}`);
    const existing = listed.json.find((item) => item.providerId === 'w15-ledger');
    const body = {
        displayName: '计价样本',
        protocol: 'OPENAI_CHAT_COMPLETIONS',
        baseUrl: `${fixtureBase()}/v1`,
        credential: ctx.secrets.fixtureKey,
        state: 'ENABLED',
        models: [
            ledgerModel('usd', '美元价', { currency: 'USD', inputPerMillionTokens: 1.5, outputPerMillionTokens: 3 }),
            ledgerModel('empty', '空价', {}),
            ledgerModel('cny', '人民币价', { currency: 'CNY', inputPerMillionTokens: 1, outputPerMillionTokens: 1 }),
        ],
    };
    if (existing) body.expectedRevision = existing.revision;
    const saved = await ctx.admin.saveProvider('w15-ledger', body);
    if (!saved.ok) {
        const detail = String(saved.text || '').replaceAll(ctx.secrets.fixtureKey, '[redacted]').slice(0, 180);
        throw new Error(`计价样本保存 HTTP ${saved.status} ${detail}`);
    }
    const again = await ctx.admin.listProviders();
    const provider = Array.isArray(again.json) ? again.json.find((item) => item.providerId === 'w15-ledger') : null;
    const byKey = Object.fromEntries((provider?.models || []).map((model) => [model.profileKey, model.ledgerPrice]));
    if (byKey.usd !== 'ACTIVE' || byKey.empty !== 'MISSING' || byKey.cny !== 'UNSUPPORTED_CURRENCY') {
        throw new Error(`ledgerPrice 不符合预期 ${JSON.stringify(byKey)}`);
    }
}

export async function sceneW15Ui(ctx) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const purposes = await ctx.admin.listPurposes();
    if (purposes.status !== 200) throw new Error(`用途列表 HTTP ${purposes.status}`);
    const row = purposes.json.find((item) => item.purpose === 'FOREGROUND_CHAT');
    if (!row) throw new Error('FOREGROUND_CHAT 缺失');
    const bound = await ctx.admin.savePurpose('FOREGROUND_CHAT', {
        providerId: 'vc03m-chat', profileKey: 'chat', state: 'ENABLED', expectedRevision: row.revision,
    });
    if (bound.status !== 200) throw new Error(`前台绑定 HTTP ${bound.status}`);
    for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
        const granted = await ctx.admin.call('PUT', '/api/v1/consents', { consentType, version: 'w15-ui', granted: true });
        if (granted.status !== 200) throw new Error(`授权 ${consentType} HTTP ${granted.status}`);
    }
    const cardName = `W15 汇合 ${crypto.randomUUID().slice(0, 8)}`;
    const form = new FormData();
    form.append('file_type', 'json');
    form.append('avatar', new Blob([JSON.stringify({
        name: cardName, description: '合成汇合卡，只供本场验收。', first_mes: GREETING, personality: '', scenario: '', mes_example: '',
    })], { type: 'application/json' }), 'synthetic.json');
    const imported = await ctx.st.call('POST', '/api/characters/import', form);
    if (imported.status !== 200 || !imported.json?.file_name) throw new Error(`导入合成卡 HTTP ${imported.status}`);
    const avatar = `${imported.json.file_name.replace(/\.png$/, '')}.png`;
    const saveChatFile = async (file, mode) => {
        const saved = await ctx.st.call('POST', '/api/chats/save', {
            avatar_url: avatar,
            file_name: file,
            chat: [
                { user_name: 'unused', character_name: cardName, chat_metadata: { vc_f2: { id: crypto.randomUUID(), revision: 0 }, vc_binding: { mode } } },
                { name: cardName, is_user: false, mes: GREETING, swipe_id: 0, swipes: [GREETING] },
            ],
        });
        if (saved.status !== 200) throw new Error(`保存聊天 HTTP ${saved.status}`);
    };
    const files = {};
    for (const viewport of VIEWPORTS) {
        files[viewport.name] = `W15-${viewport.name}-${crypto.randomUUID()}`;
        await saveChatFile(files[viewport.name], 'STORY');
    }
    const perfFile = `W15-perf-${crypto.randomUUID()}`;
    await saveChatFile(perfFile, 'COMPANION');

    await ensureLedgerProfiles(ctx);
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}),
    });
    const shots = [];
    try {
        const bc = await browser.newContext({ viewport: VIEWPORTS[0] });
        await bc.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase },
        ]);
        const page = await bc.newPage();
        page.setDefaultTimeout(120000);
        const consoleLines = [];
        page.on('pageerror', (error) => consoleLines.push(error.message.slice(0, 180)));
        page.on('console', (msg) => { if (msg.type() === 'error') consoleLines.push(msg.text().slice(0, 180)); });
        const shot = async (name) => {
            const file = path.join(SHOTS, name);
            await page.screenshot({ path: file });
            shots.push(file);
            ctx.screenshots.push(file);
        };
        const fail = async (error) => {
            try { await shot('failure.png'); } catch { /* 截图失败不掩盖原错误 */ }
            const text = await page.locator('body').innerText({ timeout: 2000 }).then((value) => value.replace(/\s+/g, ' ').slice(0, 240)).catch(() => '');
            throw new Error(`${error.message} body=${text} console=${consoleLines.slice(-3).join(' | ')}`);
        };
        const secrets = [ctx.secrets.password, ctx.secrets.fixtureKey, ctx.secrets.session.vcSession, ctx.secrets.session.vcCsrf, ctx.w10?.capture?.smtpPassword, ctx.w10?.capture?.signSecret]
            .filter((item) => typeof item === 'string' && item.length > 0);
        const assertSurface = async (label) => {
            const found = await page.evaluate((needles) => {
                const values = [...document.querySelectorAll('input, textarea')].map((el) => el.value || '').join('\n');
                const stored = [];
                for (let i = 0; i < localStorage.length; i += 1) stored.push(localStorage.getItem(localStorage.key(i)) || '');
                const surface = `${document.body.innerText}\n${values}\n${stored.join('\n')}`;
                return needles.filter((item) => surface.includes(item)).map((_, index) => index);
            }, secrets);
            if (found.length) throw new Error(`${label} 的页面或 localStorage 含凭据`);
            const text = await page.locator('body').innerText();
            if (text.includes('手机已收到') || text.includes('otpauth') || text.includes('GM_ONLY') || text.includes('PRIVATE_')) {
                throw new Error(`${label} 写出了未提供的能力或私密标记`);
            }
        };
        const assertLayout = async (width) => {
            const problems = await page.evaluate((viewportWidth) => {
                const issues = [];
                const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
                if (doc > 1) issues.push(`文档横向溢出 ${doc}px`);
                if (viewportWidth > 480) return issues;
                const selectors = [
                    '#vc-chat-nav button', '#vc-chat-more button',
                    '.vcms-overlay button', '.vcms-overlay input:not([type="checkbox"]):not([type="radio"])', '.vcms-overlay select', '.vcms-overlay textarea',
                    '.vc-data-dialog button', '.vc-data-dialog input:not([type="checkbox"])',
                    '.vc-instance-dialog button', '.vc-instance-dialog input:not([type="checkbox"])',
                    '.vc-memory-dialog button', '.vc-memory-dialog input:not([type="checkbox"])', '.vc-memory-dialog select',
                    '.vc-inbox-dialog button', '.vc-inbox-dialog input:not([type="checkbox"]):not([type="radio"])', '.vc-inbox-dialog select',
                    '.vc-story-dialog button', '.vc-story-dialog input:not([type="checkbox"])',
                    '#send_textarea', '#send_but',
                ];
                const small = [];
                for (const sel of selectors) {
                    for (const el of document.querySelectorAll(sel)) {
                        const style = getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden' || el.hidden || el.closest('[hidden]')) continue;
                        const rect = el.getBoundingClientRect();
                        if (rect.width < 1 || rect.height < 1) continue;
                        if (rect.width < 44 || rect.height < 44) small.push(`${sel} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
                    }
                }
                if (small.length) issues.push(`触控目标小于 44px：${small.slice(0, 6).join('；')}`);
                return issues;
            }, width);
            if (problems.length) throw new Error(problems.join(' | '));
        };
        try {
            await page.goto(ctx.w05.stBase, { waitUntil: 'domcontentloaded' });
            await waitFor(async () => page.evaluate(async () => (await import('/script.js')).settingsReady || Boolean(document.querySelector('dialog[open] .onboarding'))), { timeoutMs: 60000, label: 'ST 设置或欢迎页' });
            const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
            if (await onboarding.count()) {
                await onboarding.locator('textarea').fill('w15-owner');
                await onboarding.locator('.popup-button-ok').click();
                await onboarding.waitFor({ state: 'hidden' });
            }
            await waitFor(async () => page.evaluate(() => document.querySelector('#vc-chat-nav') && document.querySelector('#send_textarea')), { timeoutMs: 60000, label: '七页导航' });
            const openChat = async (file) => {
                await waitFor(async () => page.evaluate((name) => window.SillyTavern.getContext().characters.some((item) => item.avatar === name), avatar), { timeoutMs: 30000, label: '合成角色出现' });
                await page.evaluate(async (name) => {
                    const native = await import('/script.js');
                    const index = native.characters.findIndex((item) => item.avatar === name);
                    if (index < 0) throw new Error('合成角色未加载');
                    await native.selectCharacterById(index);
                }, avatar);
                // 选中角色会先绑定当前聊天，紧接着打开目标文件会在同一秒再绑一条。
                // 外壳只把创建时间精确到秒，未打开的会话又没有最后消息，两条会显示成同一个标签。
                const selectedHasIdentity = await page.evaluate(() => Boolean(window.SillyTavern.getContext().chatMetadata?.vc_f2?.id));
                if (selectedHasIdentity) {
                    await waitFor(async () => page.evaluate(() => {
                        const id = window.SillyTavern.getContext().chatMetadata?.vc_binding?.relationshipId;
                        return id != null && String(id) !== '';
                    }), { timeoutMs: 30000, label: '当前会话绑定' });
                    const now = await page.evaluate(() => Date.now());
                    await new Promise((resolve) => setTimeout(resolve, 1100 - (now % 1000) + 50));
                }
                await page.evaluate(async (chatFile) => {
                    const native = await import('/script.js');
                    await native.openCharacterChat(chatFile);
                }, file);
            };
            const closeIf = async (selector, action) => {
                const open = page.locator(selector);
                if (!(await open.count())) return;
                const button = open.locator(action).first();
                await button.waitFor({ state: 'visible' });
                await button.click();
                await open.waitFor({ state: 'hidden' });
            };
            const openNav = async (name, label, width) => {
                if (width <= 900 && ['memory', 'inbox', 'story', 'account'].includes(name)) {
                    await page.locator('#vc-chat-nav [data-nav="more"]').click();
                    await page.locator('#vc-chat-more[open]').waitFor();
                    await page.locator('#vc-chat-more button', { hasText: label }).click();
                } else {
                    await page.locator(`#vc-chat-nav [data-nav="${name}"]`).click();
                }
            };
            for (const viewport of VIEWPORTS) {
                console.log(`[w15-ui] ${viewport.name}`);
                await page.setViewportSize({ width: viewport.width, height: viewport.height });
                await openChat(files[viewport.name]);
                await waitFor(async () => page.evaluate(() => {
                    const binding = window.SillyTavern.getContext().chatMetadata?.vc_binding;
                    return binding?.mode === 'STORY' && /^[1-9][0-9]{0,18}$/.test(binding.conversationId || '');
                }), { timeoutMs: 30000, label: `${viewport.name} 剧情绑定` });
                if (viewport.width <= 900) {
                    await page.locator('#vc-chat-nav [data-nav="more"]').click();
                    await page.locator('#vc-chat-more[open]').waitFor();
                    await shot(`${viewport.name}-more.png`);
                    await assertLayout(viewport.width);
                    await page.keyboard.press('Escape');
                    await waitFor(async () => page.evaluate(() => document.querySelector('#vc-chat-more')?.open !== true && document.activeElement?.getAttribute('data-nav') === 'more'), { timeoutMs: 5000, label: '更多 Escape 回到入口' });
                }
                for (const [name, label] of NAV) {
                    await openNav(name, label, viewport.width);
                    if (name === 'chat') {
                        await waitFor(async () => page.evaluate(() => document.activeElement?.id === 'send_textarea'), { timeoutMs: 5000, label: '聊天焦点' });
                    } else if (name === 'characters') {
                        await page.locator('.vc-instance-dialog[open] h1').waitFor();
                    } else if (name === 'memory') {
                        await page.locator('.vc-memory-dialog[open] h1').waitFor();
                    } else if (name === 'inbox') {
                        await page.locator('.vc-inbox-dialog[open] h1', { hasText: '主动陪伴' }).waitFor();
                    } else if (name === 'story') {
                        await page.locator('.vc-story-dialog[open]').waitFor();
                        await page.locator('.vc-story-dialog [data-action="start"]').waitFor();
                    } else if (name === 'models') {
                        await page.locator('#vcms-f-display').waitFor();
                        const budgetText = await page.locator('.vcms-overlay').innerText();
                        if (budgetText.includes('当月可用额度不足')) throw new Error('用量接口不能判断预算不足，页面不应先显示');
                    } else if (name === 'account') {
                        await page.locator('.vc-data-dialog[open]').waitFor();
                        await waitFor(async () => page.evaluate(() => {
                            const text = document.querySelector('.vc-data-dialog')?.innerText || '';
                            const sessions = document.querySelector('[data-sessions]')?.textContent || '';
                            const listed = sessions.includes('当前会话') || sessions.includes('没有进行中的会话');
                            return listed && text.includes('修改密码') && text.includes('重置验证器') && text.includes('登出其他会话') && text.includes('备份状态独立，策略在 W16');
                        }), { timeoutMs: 20000, label: '账户页' });
                        const accountProbe = await page.evaluate(async () => {
                            const body = document.querySelector('.vc-data-body')?.innerText || '';
                            const listed = await (await fetch('/api/plugins/virtual-companion/go/api/v1/auth/sessions')).json();
                            const current = (Array.isArray(listed) ? listed : []).find((item) => item?.current === true);
                            let expected = '当前会话';
                            if (typeof current?.createdAt === 'string' && current.createdAt) {
                                const date = new Date(current.createdAt);
                                if (!Number.isNaN(date.getTime())) {
                                    expected = `当前会话 · ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date)}`;
                                }
                            }
                            const node = document.querySelector('[data-sessions]');
                            const norm = (value) => String(value || '').replace(/[\u00a0\u202f]/g, ' ');
                            const text = norm(node?.textContent || '');
                            const html = node?.innerHTML || '';
                            const leaked = [];
                            if (current?.accountId && (text.includes(String(current.accountId)) || html.includes(String(current.accountId)))) leaked.push('account');
                            if (current?.role && (text.includes(String(current.role)) || html.includes(String(current.role)))) leaked.push('role');
                            const labels = ['修改密码', '验证器', '当前会话', '导出数据', '删除账号及在线数据'].filter((label) => !document.querySelector(`[aria-label="${label}"]`));
                            return {
                                cards: Boolean(document.querySelector('.vc-account-cards')),
                                passwordInBody: body.includes('当前密码'),
                                labels,
                                sessionOk: text.includes(norm(expected)),
                                row: text.slice(0, 80),
                                empty: text.includes('没有进行中的会话'),
                                leaked,
                            };
                        });
                        if (!accountProbe.cards || accountProbe.passwordInBody || accountProbe.labels.length || !accountProbe.sessionOk || accountProbe.empty || accountProbe.leaked.length) {
                            throw new Error(`账户结构异常 ${JSON.stringify(accountProbe)}`);
                        }
                        if (!/验证器已启用|验证器未启用/.test(await page.locator('.vc-data-dialog').innerText())) throw new Error('账户页没有验证器状态');
                    }
                    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                    await shot(`${viewport.name}-${name}.png`);
                    await assertSurface(name);
                    await assertLayout(viewport.width);
                    if (name === 'characters') await closeIf('.vc-instance-dialog[open]', '[data-action="close"]');
                    if (name === 'memory') await closeIf('.vc-memory-dialog[open]', '[data-action="close"]');
                    if (name === 'inbox') await closeIf('.vc-inbox-dialog[open]', '[data-action="close"]');
                    if (name === 'story') await closeIf('.vc-story-dialog[open]', '[data-action="close"]');
                    if (name === 'models') await closeIf('.vcms-overlay:not([hidden])', '[data-action="close"]');
                    if (name === 'account') {
                        await page.locator('[data-reset]').click();
                        await page.locator('.vc-account-reauth:not([hidden])').waitFor();
                        const secretState = await page.evaluate(() => {
                            const input = document.querySelector('[data-reauth-password]');
                            return {
                                value: input?.value || '',
                                named: input?.getAttribute('name') || '',
                                valued: input?.hasAttribute('value') === true,
                                focused: document.activeElement === input,
                            };
                        });
                        if (secretState.value || secretState.named || secretState.valued || !secretState.focused) {
                            throw new Error(`重新验证层不符合焦点或密码规则 ${JSON.stringify(secretState)}`);
                        }
                        if (viewport.width === 390) {
                            await page.setViewportSize({ width: 390, height: 450 });
                            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                            const shortFit = await page.evaluate(() => {
                                const input = document.querySelector('[data-reauth-password]');
                                const rect = input?.getBoundingClientRect();
                                return {
                                    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                                    top: rect?.top ?? -1,
                                    bottom: rect?.bottom ?? 9999,
                                    height: window.innerHeight,
                                };
                            });
                            if (shortFit.overflow > 1 || shortFit.top < 0 || shortFit.bottom > shortFit.height + 1) {
                                throw new Error(`短视口重新验证不可用 ${JSON.stringify(shortFit)}`);
                            }
                            await shot('390x450-account-reauth.png');
                            await assertLayout(390);
                            await page.setViewportSize({ width: 390, height: 844 });
                        }
                        await shot(`${viewport.name}-account-reauth.png`);
                        await assertSurface('account-reauth');
                        await page.keyboard.press('Escape');
                        await waitFor(async () => page.evaluate(() => {
                            const hidden = document.querySelector('.vc-account-reauth')?.hidden === true;
                            const open = document.querySelector('.vc-data-dialog')?.open === true;
                            const focused = (document.activeElement?.textContent || '').includes('重置验证器');
                            const value = document.querySelector('[data-reauth-password]')?.value || '';
                            return hidden && open && focused && value === '';
                        }), { timeoutMs: 5000, label: '重新验证 Escape 回到重置验证器' });
                        await closeIf('.vc-data-dialog[open]', '[data-close]');
                    }
                }
                if (await page.locator('#vc-chat-more[open]').count()) {
                    await page.keyboard.press('Escape');
                    await page.locator('#vc-chat-more[open]').waitFor({ state: 'hidden' });
                }
                const silentDraft = `w15-静默草稿-${viewport.name}`;
                await page.locator('#send_textarea').fill(silentDraft);
                await openNav('story', '剧情', viewport.width);
                await page.locator('.vc-story-dialog[open] [data-action="start"]').click();
                await waitFor(async () => page.evaluate(() => document.querySelector('.vc-story')?.getAttribute('data-state') === 'playing'), { timeoutMs: 30000, label: '开局' });
                await page.evaluate(() => {
                    const orig = Array.prototype.slice;
                    window.__vcSliceOrig = orig;
                    window.__vcSliceHits = 0;
                    Array.prototype.slice = function sliceHook(...args) {
                        const copied = orig.apply(this, args);
                        let live = null;
                        try { live = window.SillyTavern.getContext().chat; } catch { live = null; }
                        if (live && this === live) {
                            window.__vcSliceHits += 1;
                            this.push({ name: '宿主', is_user: true, mes: `宿主在读写之间新增 ${window.__vcSliceHits}`, extra: {} });
                        }
                        return copied;
                    };
                });
                try {
                    await page.locator('.vc-story-dialog [data-action="act"][data-step="a1"]').click();
                    await page.waitForFunction((draft) => {
                        const text = document.querySelector('.vc-story')?.innerText || '';
                        const value = document.querySelector('#send_textarea')?.value || '';
                        const conflict = document.querySelector('#vc-f2-conflict')?.open === true;
                        const hits = window.__vcSliceHits || 0;
                        return hits >= 3 && text.includes('行动已生效，聊天记录待同步') && value.includes(draft) && !conflict;
                    }, silentDraft, { timeout: 60000 });
                } finally {
                    await page.evaluate(() => { if (typeof window.__vcSliceOrig === 'function') Array.prototype.slice = window.__vcSliceOrig; });
                }
                const hits = await page.evaluate(() => window.__vcSliceHits || 0);
                if (hits < 3) throw new Error(`静默冲突没有在三次读取上触发，slice=${hits}`);
                await shot(`${viewport.name}-f2-silent.png`);
                await page.locator('.vc-story-dialog [data-action="ask-rewind"][data-version="0"]').click();
                await page.locator('.vc-story-rewind-dialog[open]').waitFor();
                const rewindText = await page.locator('.vc-story-rewind-dialog').innerText();
                if (!rewindText.includes('确认回档')) throw new Error('回档确认层未出现');
                await shot(`${viewport.name}-rewind.png`);
                await page.locator('.vc-story-rewind-dialog [data-action="cancel-rewind"]').click();
                await page.locator('.vc-story-rewind-dialog[open]').waitFor({ state: 'hidden' });
                await closeIf('.vc-story-dialog[open]', '[data-action="close"]');
                const token = await page.evaluate(() => window.SillyTavern.getContext().chatMetadata?.vc_f2);
                const current = await ctx.st.call('POST', '/api/chats/get', { avatar_url: avatar, file_name: files[viewport.name] });
                if (current.status !== 200 || !Array.isArray(current.json)) throw new Error(`读聊天 HTTP ${current.status}`);
                const next = current.json.map((item, index) => (index === 0 && item?.chat_metadata
                    ? { ...item, chat_metadata: { ...item.chat_metadata, vc_f2: token } }
                    : { ...item }));
                next.push({ name: '合成用户', is_user: true, mes: `外部新增 ${viewport.name}`, extra: {} });
                const external = await ctx.st.call('POST', '/api/chats/save', { avatar_url: avatar, file_name: files[viewport.name], chat: next });
                if (external.status !== 200) throw new Error(`外部保存 HTTP ${external.status} ${external.json?.code || ''}`);
                const userDraft = `w15-用户草稿-${viewport.name}`;
                await page.locator('#send_textarea').fill(userDraft);
                const saveCode = await page.evaluate(async () => {
                    try { await window.SillyTavern.getContext().saveChat(); return 'saved'; }
                    catch (error) { return error?.code || error?.name || 'error'; }
                });
                await page.locator('#vc-f2-conflict[open]').waitFor();
                await shot(`${viewport.name}-f2-user.png`);
                await page.locator('#vc-f2-conflict [data-action="keep-draft"]').click();
                await page.locator('#vc-f2-conflict[open]').waitFor({ state: 'hidden' });
                const kept = await page.locator('#send_textarea').inputValue();
                if (!kept.includes(userDraft)) throw new Error(`保留草稿后输入框没有草稿（${saveCode}）`);
                await assertSurface('f2');
                await openNav('models', '模型', viewport.width);
                await page.locator('#vcms-f-display').waitFor();
                const beforeBudget = await page.locator('.vcms-overlay').innerText();
                if (beforeBudget.includes('当月可用额度不足')) throw new Error('进入模型页时不应显示预算不足');
                await page.evaluate(() => window.dispatchEvent(new CustomEvent('vc-apply-budget', { detail: { budgetInsufficient: true } })));
                await page.locator('#vcms-budget').waitFor();
                const gated = await page.evaluate(() => ({
                    discover: document.querySelector('[data-action="discover"]')?.disabled === true,
                    check: document.querySelector('[data-action="check-connection"]')?.disabled === true,
                    save: document.querySelector('#vcms-save')?.disabled === true,
                    send: document.querySelector('#send_but')?.disabled === true,
                }));
                if (!gated.discover || !gated.check || !gated.send || gated.save) throw new Error(`预算不足门禁异常 ${JSON.stringify(gated)}`);
                await shot(`${viewport.name}-model-budget.png`);
                await assertLayout(viewport.width);
                await page.evaluate(() => window.dispatchEvent(new CustomEvent('vc-apply-budget', { detail: {} })));
                await waitFor(async () => page.evaluate(() => document.querySelector('#send_but')?.disabled !== true), { timeoutMs: 5000, label: '预算门禁解除' });
                if (await page.locator('#vcms-discard').isVisible()) await page.locator('#vcms-discard').click();
                const showLedger = async (key, includes, excludes) => {
                    await page.locator(`[data-action="select-model"][data-key="${key}"]`).click();
                    await waitFor(async () => page.evaluate(({ profile, want, block }) => {
                        const pressed = document.querySelector(`[data-action="select-model"][data-key="${profile}"]`)?.getAttribute('aria-pressed') === 'true';
                        const text = `${document.querySelector('.vcms-model-form')?.innerText || ''}\n${document.querySelector('#vcms-m-display')?.value || ''}`;
                        return pressed && want.every((item) => text.includes(item)) && block.every((item) => !text.includes(item));
                    }, { profile: key, want: includes, block: excludes }), { timeoutMs: 10000, label: `ledger ${key}` });
                };
                await page.locator('[data-action="select-provider"][data-id="w15-ledger"]').click();
                await showLedger('usd', ['美元价'], ['未配置单价：照常发送，费用记为未知', '非美元单价：照常发送，费用记为未知']);
                await shot(`${viewport.name}-model-ledger-active.png`);
                await showLedger('empty', ['未配置单价：照常发送，费用记为未知'], ['非美元单价：照常发送，费用记为未知']);
                if (await page.locator('#vcms-currency-price').count()) throw new Error('空价模型显示了币种提示');
                await shot(`${viewport.name}-model-ledger-missing.png`);
                await showLedger('cny', ['非美元单价：照常发送，费用记为未知'], ['未配置单价：照常发送，费用记为未知']);
                await shot(`${viewport.name}-model-ledger-currency.png`);
                await assertLayout(viewport.width);
                await assertSurface(`ledger-${viewport.name}`);
                await closeIf('.vcms-overlay:not([hidden])', '[data-action="close"]');
                await assertSurface(viewport.name);
            }
            await page.setViewportSize({ width: 1440, height: 900 });
            await openNav('models', '模型', 1440);
            await page.locator('#vcms-f-display').waitFor();
            await page.locator('[data-action="select-provider"][data-id="w15-ledger"]').click();
            await page.locator('[data-action="select-model"][data-key="empty"]').click();
            await page.locator('#vcms-no-price').waitFor();
            await page.locator('details.vcms-advanced').evaluate((el) => { el.open = true; });
            await page.locator('#vcms-m-currency').selectOption('USD');
            await page.locator('#vcms-m-pin').fill('1.5');
            await page.locator('#vcms-m-pout').fill('3');
            if (!(await page.locator('#vcms-no-price').count())) throw new Error('填写表单价格后不应撤掉服务端未配置提示');
            if (await page.locator('#vcms-save').isDisabled()) throw new Error('补上美元价后保存不可用');
            const fresh = await ctx.admin.reauth(ctx.secrets.password);
            if (!fresh.ok) throw new Error(`保存前重新验证失败 HTTP ${fresh.status}`);
            await page.locator('#vcms-save').click();
            const reauthBox = page.locator('#vcms-reauth-password');
            if (await reauthBox.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)) {
                await reauthBox.fill(ctx.secrets.password);
                await page.locator('[data-action="reauth-submit"]').click();
                await reauthBox.waitFor({ state: 'hidden', timeout: 20000 });
            }
            await page.locator('[data-action="select-model"][data-key="empty"]').click();
            await waitFor(async () => page.evaluate(() => {
                const pressed = document.querySelector('[data-action="select-model"][data-key="empty"]')?.getAttribute('aria-pressed') === 'true';
                const text = document.querySelector('.vcms-model-form')?.innerText || '';
                return pressed && !document.querySelector('#vcms-no-price') && !text.includes('未配置单价：照常发送，费用记为未知') && !text.includes('非美元单价：照常发送，费用记为未知');
            }), { timeoutMs: 20000, label: '保存后空价变为可发送' });
            const savedList = await ctx.admin.listProviders();
            const savedEmpty = savedList.json?.find((item) => item.providerId === 'w15-ledger')?.models?.find((model) => model.profileKey === 'empty');
            if (savedEmpty?.ledgerPrice !== 'ACTIVE') throw new Error(`保存后 ledgerPrice=${savedEmpty?.ledgerPrice || '缺失'}`);
            const passwordLeft = await page.locator('#vcms-reauth-password').inputValue().catch(() => '');
            if (passwordLeft) throw new Error('模型重新验证后密码仍留在输入框');
            await shot('1440-model-ledger-resave.png');
            await assertSurface('ledger-resave');
            await closeIf('.vcms-overlay:not([hidden])', '[data-action="close"]');
            if (typeof ctx.w10?.psql !== 'function') throw new Error('受管数据库入口不可用');
            await page.setViewportSize({ width: 1440, height: 900 });
            await openChat(perfFile);
            await waitFor(async () => page.evaluate(() => String(window.SillyTavern.getContext().chatCompletionSettings?.custom_url ?? '').includes('profile=chat')), { timeoutMs: 30000, label: 'chat 投影' });
            if (await page.locator('#send_but.displayNone').count()) {
                if (!(await page.locator('#api_button_openai').isVisible())) await page.click('#API-status-top');
                await page.locator('#api_button_openai').click();
                const popup = page.locator('dialog[open].popup').first();
                if (await popup.count()) {
                    await popup.locator('.popup-button-ok').click();
                    await popup.waitFor({ state: 'hidden' });
                }
            }
            const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
            const prompt = `w15-perf-${crypto.randomUUID().slice(0, 8)}`;
            await page.evaluate((text) => {
                window.__vcPerf = { first: 0, before: document.querySelectorAll('#chat .mes').length, prompt: text };
                const root = document.querySelector('#chat');
                const obs = new MutationObserver(() => {
                    if (!window.__vcPerf || window.__vcPerf.first) return;
                    const nodes = [...root.querySelectorAll('.mes')];
                    if (nodes.length <= window.__vcPerf.before) return;
                    const last = nodes.at(-1);
                    const value = last?.querySelector('.mes_text')?.textContent || '';
                    if (!value.trim() || value.includes(window.__vcPerf.prompt)) return;
                    window.__vcPerf.first = Date.now();
                });
                obs.observe(root, { childList: true, subtree: true, characterData: true });
            }, prompt);
            const sendAt = Date.now();
            await page.locator('#send_textarea').fill(prompt);
            await page.locator('#send_but').click();
            const popup = page.locator('dialog[open].popup').first();
            try {
                await popup.waitFor({ timeout: 4000 });
                await popup.locator('.popup-button-ok').click();
                await popup.waitFor({ state: 'hidden', timeout: 10000 });
            } catch { /* 这一档没有代理确认 */ }
            await page.waitForFunction((reply) => {
                const nodes = [...document.querySelectorAll('#chat .mes')];
                const text = nodes.at(-1)?.querySelector('.mes_text')?.textContent || '';
                const stop = document.querySelector('#mes_stop');
                const idle = !stop || getComputedStyle(stop).display === 'none';
                return idle && text.includes(reply);
            }, REPLY, { timeout: 90000 });
            const doneAt = Date.now();
            const first = await page.evaluate(() => window.__vcPerf?.first || 0);
            if (!first) throw new Error('没有观察到首个可见 token');
            const rows = await ctx.fixtureHttp.captures({ since });
            const upstream = rows.find((item) => item.protocol === 'chat' && item.model === 'vc03m-chat') || rows[0];
            if (!upstream?.receivedAt) throw new Error('性能样本没有上游请求');
            const byProtocol = {};
            const byModel = {};
            for (const item of rows) {
                const protocol = item.protocol || 'unknown';
                const model = item.model || 'unknown';
                byProtocol[protocol] = (byProtocol[protocol] || 0) + 1;
                byModel[model] = (byModel[model] || 0) + 1;
            }
            const sample = {
                n: 1,
                model: 'vc03m-chat',
                profileKey: 'chat',
                providerId: 'vc03m-chat',
                environment: {
                    worktree: 'w15d',
                    st: ctx.w05.stBase,
                    goPort: process.env.VC_W03_GO_PORT || '',
                    fixturePort: process.env.VC_W03_FIXTURE_PORT || '8753',
                    browser: 'headless chromium',
                    node: process.version,
                    platform: process.platform,
                },
                sendToUpstreamRequestMs: upstream.receivedAt - sendAt,
                requestToFirstVisibleTokenMs: first - upstream.receivedAt,
                firstTokenToCompleteMs: doneAt - first,
                calls: rows.length,
                byProtocol,
                byModel,
                note: '单次样本，只记录不优化，不能当作 p95。',
            };
            const samplePath = path.join(SHOTS, 'perf-sample.json');
            fs.writeFileSync(samplePath, `${JSON.stringify(sample, null, 2)}\n`, { mode: 0o600 });
            await shot('1440-perf.png');
            console.log(`[w15-ui] perf ${JSON.stringify(sample)}`);
            const pricedVersions = ctx.w10.psql(`SELECT price_version::text FROM vc.model_unit_price
                WHERE provider_id = 'vc03m-chat' AND active;`)
                .split('\n').map((line) => line.trim()).filter((line) => /^[0-9]+$/.test(line));
            if (pricedVersions.length) {
                ctx.w10.psql(`UPDATE vc.model_unit_price SET active = false
                    WHERE provider_id = 'vc03m-chat' AND price_version IN (${pricedVersions.join(',')});`);
            }
            try {
                const unpricedSince = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
                const unpricedPrompt = `w15-unpriced-${crypto.randomUUID().slice(0, 8)}`;
                await page.locator('#send_textarea').fill(unpricedPrompt);
                await page.locator('#send_but').click();
                const unpricedPopup = page.locator('dialog[open].popup').first();
                try {
                    await unpricedPopup.waitFor({ timeout: 4000 });
                    await unpricedPopup.locator('.popup-button-ok').click();
                    await unpricedPopup.waitFor({ state: 'hidden', timeout: 10000 });
                } catch { /* 这一档没有代理确认 */ }
                await page.waitForFunction((reply) => {
                    const nodes = [...document.querySelectorAll('#chat .mes')];
                    const text = nodes.at(-1)?.querySelector('.mes_text')?.textContent || '';
                    const stop = document.querySelector('#mes_stop');
                    const idle = !stop || getComputedStyle(stop).display === 'none';
                    return idle && text.includes(reply);
                }, REPLY, { timeout: 90000 });
                const unpricedRows = await ctx.fixtureHttp.captures({ since: unpricedSince });
                if (!unpricedRows.some((item) => item.protocol === 'chat')) throw new Error('未定价模型没有发到固定 provider');
                await openNav('models', '模型', 1440);
                await page.locator('.vcms-usage').waitFor();
                const usageMonth = async () => page.locator('[data-usage-month-label]').innerText();
                const shownMonth = (await usageMonth()).trim();
                await page.locator('[data-action="usage-month"][data-delta="-1"]').click();
                await waitFor(async () => {
                    const text = await page.locator('.vcms-usage').innerText();
                    return (await usageMonth()).trim() !== shownMonth && !text.includes('正在读取用量');
                }, { timeoutMs: 20000, label: '用量切到上个月' });
                await page.locator('[data-action="usage-month"][data-delta="1"]').click();
                await waitFor(async () => page.evaluate((month) => {
                    const root = document.querySelector('.vcms-usage');
                    const text = root?.innerText || '';
                    const label = root?.querySelector('[data-usage-month-label]')?.textContent?.trim();
                    return label === month && !text.includes('正在读取用量')
                        && text.includes('未知') && text.includes('前台聊天') && /\d/.test(text) && text.includes('%');
                }, shownMonth), { timeoutMs: 20000, label: '用量区未定价费用' });
                fs.mkdirSync(F01_SHOTS, { recursive: true });
                const usageShot = path.join(F01_SHOTS, 'usage-unpriced.png');
                await page.locator('.vcms-usage').screenshot({ path: usageShot });
                await page.screenshot({ path: path.join(F01_SHOTS, 'model-page-usage.png') });
                console.log(`[w15-ui] unpriced usage ${usageShot}`);
                await closeIf('.vcms-overlay:not([hidden])', '[data-action="close"]');
            } finally {
                if (pricedVersions.length) {
                    ctx.w10.psql(`UPDATE vc.model_unit_price SET active = true
                        WHERE provider_id = 'vc03m-chat' AND price_version IN (${pricedVersions.join(',')});`);
                }
            }
            const exhausted = ctx.w10.psql(`INSERT INTO vc.month_cost_budget(month_start, settled_usd)
                VALUES (date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date, 11)
                ON CONFLICT (month_start) DO UPDATE
                SET settled_usd = GREATEST(vc.month_cost_budget.settled_usd, 11)
                RETURNING settled_usd::text;`).trim();
            if (Number(exhausted) < 11) throw new Error(`当月预算没有耗尽（${exhausted}）`);
            const budgetSince = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
            const budgetPrompt = `w15-budget-${crypto.randomUUID().slice(0, 8)}`;
            await page.locator('#send_textarea').fill(budgetPrompt);
            await page.locator('#send_but').click();
            const budgetPopup = page.locator('dialog[open].popup').first();
            try {
                await budgetPopup.waitFor({ timeout: 4000 });
                await budgetPopup.locator('.popup-button-ok').click();
                await budgetPopup.waitFor({ state: 'hidden', timeout: 10000 });
            } catch { /* 预算拒绝不一定弹确认框 */ }
            await waitFor(async () => page.evaluate(() => {
                const status = document.querySelector('#vc-chat-budget')?.textContent || '';
                return status.includes('当月可用额度不足') && document.querySelector('#send_but')?.disabled === true;
            }), { timeoutMs: 45000, label: '聊天预算不足' });
            const budgetRows = await ctx.fixtureHttp.captures({ since: budgetSince });
            const budgetUpstream = budgetRows.filter((item) => item.protocol === 'chat' || item.model === 'vc03m-chat');
            if (budgetUpstream.length !== 0) throw new Error(`预算拒绝后上游请求 ${budgetUpstream.length} 次`);
            const latePopup = page.locator('dialog[open].popup').first();
            if (await latePopup.count()) {
                await latePopup.locator('.popup-button-ok').click();
                await latePopup.waitFor({ state: 'hidden' });
            }
            await openNav('models', '模型', 1440);
            await page.locator('#vcms-budget').waitFor();
            const modelBudget = await page.locator('#vcms-budget').innerText();
            if (!modelBudget.includes('当月可用额度不足')) throw new Error('模型页没有预算不足');
            if (await page.locator('#send_but').isEnabled()) throw new Error('模型页打开后发送未门禁');
            await shot('1440-budget-refused.png');
            await closeIf('.vcms-overlay:not([hidden])', '[data-action="close"]');
            const importName = `W15合成导入${crypto.randomUUID().slice(0, 8)}`;
            await openNav('characters', '角色', 1440);
            await page.locator('.vc-instance-dialog[open] h1').waitFor();
            const beforeNames = await page.locator('.vc-instance-template strong').allTextContents();
            await page.locator('.vc-instance-root input[type="file"]').setInputFiles({
                name: 'synthetic-import.json',
                mimeType: 'application/json',
                buffer: Buffer.from(JSON.stringify({
                    name: importName, description: '合成导入卡，只供本场验收。', first_mes: '你好。', personality: '', scenario: '', mes_example: '',
                })),
            });
            await waitFor(async () => {
                const state = await page.evaluate((name) => ({
                    alert: document.querySelector('.vc-instance-alert')?.textContent || '',
                    names: [...document.querySelectorAll('.vc-instance-template strong')].map((el) => el.textContent),
                }), importName);
                if (state.alert.includes('不是受支持的角色卡格式')) throw new Error(`导入失败：${state.alert}`);
                return state.names.includes(importName);
            }, { timeoutMs: 30000, label: '合成角色卡出现在模板列表' });
            const importedRef = await page.evaluate((name) => {
                const found = (window.SillyTavern.getContext().characters || []).find((item) => item.name === name);
                return found?.data?.extensions?.vc_character_ref || '';
            }, importName);
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(importedRef)) {
                throw new Error('导入后没有写回 vc_character_ref');
            }
            const afterNames = await page.locator('.vc-instance-template strong').allTextContents();
            if (beforeNames.some((name) => !afterNames.includes(name))) throw new Error('导入改动了原有模板');
            await shot('1440-import-card.png');
            await closeIf('.vc-instance-dialog[open]', '[data-action="close"]');
            console.log(`[w15-ui] shots ${shots.length}`);
        } catch (error) {
            await fail(error);
        }
    } finally {
        await browser.close();
    }
}
