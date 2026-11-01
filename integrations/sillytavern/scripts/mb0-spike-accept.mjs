// MB-0 可行性验证（ADR-0011「MB-0 必须验证」中可在浏览器完成的部分）。
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README；ADR-0009 §3）。
// 同源验证页 fixtures/mb0/index.html 复制到受管 st-run/public/mb0/，场景结束删除；不改生产代码。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { complexCard, complexReply } from './lib/complex-card.mjs';
import { createStClient } from './managed-lib.mjs';
import { ownerBudgetResetSql } from './lib/owner-budget.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEV = process.env.VC_W03_DEV_DIR || path.resolve(HERE, '../dev-managed');
const OUT = path.join(DEV, 'artifacts', 'mb0');
const PAGE_DIR = path.join(DEV, 'st-run', 'public', 'mb0');
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const CPU_SLOWDOWN = 4;

function stClient(ctx) {
    const s = ctx.secrets.session;
    return createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: s, extraCookies: `vc_session=${s.vcSession}; vc_csrf=${s.vcCsrf}` });
}

function importJson(st, card) {
    const form = new FormData();
    form.append('file_type', 'json');
    form.append('avatar', new Blob([JSON.stringify(card)], { type: 'application/json' }), 'synthetic.json');
    return st.call('POST', '/api/characters/import', form);
}

async function bindForeground(ctx) {
    await reauthForWrite(ctx);
    const purposes = await ctx.admin.listPurposes();
    const row = purposes.json?.find((item) => item.purpose === 'FOREGROUND_CHAT');
    if (!row) throw new Error('FOREGROUND_CHAT 缺失');
    const bound = await ctx.admin.savePurpose('FOREGROUND_CHAT', { providerId: 'vc03m-chat', profileKey: 'chat', state: 'ENABLED', expectedRevision: row.revision });
    if (bound.status !== 200) throw new Error(`前台绑定 HTTP ${bound.status}`);
}

async function phoneContext(browser, ctx) {
    const bc = await browser.newContext(PHONE);
    await bc.addCookies([
        { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
        { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase },
    ]);
    await bc.addInitScript(() => { localStorage.setItem('vc-ui', 'on'); localStorage.setItem('vc-theme', 'light'); });
    return bc;
}

async function heap(cdp) {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const get = (n) => metrics.find((m) => m.name === n)?.value || 0;
    return { jsHeapMB: +(get('JSHeapUsedSize') / 1048576).toFixed(1), nodes: get('Nodes'), frames: get('Frames') };
}

async function until(fn, ms, label) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await fn()) return;
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`等待超时：${label}`);
}

async function serverChat(page, name, avatar, file) {
    return page.evaluate(async ({ name: n, avatar: a, file: f }) => {
        const token = (await (await fetch('/csrf-token')).json()).token;
        const r = await fetch('/api/chats/get', { method: 'POST', headers: { 'Content-Type': 'application/json', ...window.mb0.headers, 'X-CSRF-Token': token }, body: JSON.stringify({ ch_name: n, file_name: f, avatar_url: a }) });
        return (await r.json()).slice(1).map((m) => ({ u: !!m.is_user, mes: m.mes }));
    }, { name, avatar, file });
}

export async function sceneMb0Spike(ctx) {
    fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
    fs.mkdirSync(PAGE_DIR, { recursive: true });
    fs.copyFileSync(path.join(HERE, 'fixtures', 'mb0', 'index.html'), path.join(PAGE_DIR, 'index.html'));
    const report = { cpuSlowdown: CPU_SLOWDOWN, viewport: '390x844@3x', timings: {}, memory: {}, api: {}, card: {} };
    const step = (group, key, ok, detail = '') => { report[group][key] = { ok, detail }; console.log(`[mb0] ${group}.${key} ${ok ? 'PASS' : 'FAIL'} ${detail}`); };

    await bindForeground(ctx);
    ctx.w10.psql(ownerBudgetResetSql(ctx.w05.ownerId));
    const st = stClient(ctx);
    const name = `MB0 ${crypto.randomUUID().slice(0, 6)}`;
    const imported = await importJson(st, { name, description: '合成卡，只供 MB-0。', first_mes: '你好。', personality: '', scenario: '', mes_example: '' });
    if (imported.status !== 200) throw new Error(`导入合成卡 HTTP ${imported.status}`);
    const avatar = `${imported.json.file_name.replace(/\.png$/, '')}.png`;
    const file = `MB0-${crypto.randomUUID()}`;
    const rows = Array.from({ length: 40 }, (_, i) => ({ name: i % 2 ? name : 'owner', is_user: i % 2 === 0, mes: `合成历史 ${i + 1}。`, send_date: new Date(Date.now() - (40 - i) * 60000).toISOString() }));
    const saved = await st.call('POST', '/api/chats/save', {
        avatar_url: avatar, file_name: file,
        chat: [{ user_name: 'unused', character_name: name, chat_metadata: { vc_f2: { id: crypto.randomUUID(), revision: 0 }, vc_binding: { mode: 'COMPANION', displayName: '合成实例' } } }, ...rows],
    });
    if (saved.status !== 200) throw new Error(`保存聊天 HTTP ${saved.status}`);
    const complexName = `澄夏MB0${crypto.randomUUID().slice(0, 6)}`;
    const bookName = `蓝窗MB0${crypto.randomUUID().slice(0, 6)}`;
    const complex = await importJson(st, complexCard(complexName, bookName));
    if (complex.status !== 200) throw new Error(`导入复杂卡 HTTP ${complex.status}`);
    const complexAvatar = `${complex.json.file_name.replace(/\.png$/, '')}.png`;

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    const url = `${ctx.w05.stBase}/mb0/index.html?name=${encodeURIComponent(name)}&avatar=${encodeURIComponent(avatar)}&file=${encodeURIComponent(file)}`;
    try {
        // 基线：同一手机条件下直接打开现有 ST 网页，取引擎单独的内存与就绪时间。
        {
            const bc = await phoneContext(browser, ctx);
            const page = await bc.newPage();
            const cdp = await bc.newCDPSession(page);
            await cdp.send('Performance.enable');
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
            const t = Date.now();
            await page.goto(ctx.w05.stBase);
            await page.waitForFunction(async () => (await import('/script.js')).settingsReady || document.querySelector('dialog[open] .onboarding'), null, { timeout: 180000 });
            report.timings.stAloneReadyMs = Date.now() - t;
            await page.waitForTimeout(3000);
            report.memory.stAlone = await heap(cdp);
            await bc.close();
        }

        const bc = await phoneContext(browser, ctx);
        const page = await bc.newPage();
        page.setDefaultTimeout(180000);
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));
        const consoleLog = new Set();
        page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && consoleLog.size < 40) consoleLog.add(`${m.type()}: ${m.text().slice(0, 160)}`); });
        const cdp = await bc.newCDPSession(page);
        await cdp.send('Performance.enable');
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });

        // 冷启动（新浏览器上下文，无缓存）与热启动（HTTP 缓存已在）。
        for (const phase of ['cold', 'warm']) {
            // 服务端插件只在 / 与 /auth/access 绑定 ST 会话；正式 /m/ 入口需在自有插件白名单中登记（MB-2）。
            if (phase === 'cold') await page.goto(`${ctx.w05.stBase}/auth/access`);
            const resp = phase === 'cold' ? await page.goto(url) : await page.reload();
            try {
                await page.waitForFunction(() => window.mb0?.metrics?.historyMs || window.mb0?.errors?.length, null, { timeout: 60000 });
            } catch (e) {
                const diag = await page.evaluate(() => ({ url: location.href, title: document.title, errors: window.mb0?.errors, body: document.body?.innerText?.slice(0, 200) })).catch(() => ({}));
                throw new Error(`验证页未就绪 status=${resp?.status()} ${JSON.stringify(diag)} pageErrors=${errors.slice(0, 3).join(' | ')}`);
            }
            const early = await page.evaluate(() => window.mb0.errors);
            if (early.length) throw new Error(`验证页错误 ${early.join(' | ')}`);
            if (phase === 'cold') await page.screenshot({ path: path.join(OUT, 'history-first.png') });
            await page.evaluate(() => window.mb0.ready);
            const opened = await page.evaluate(({ a, f }) => window.mb0.api.open(a, f), { a: avatar, f: file });
            const m = await page.evaluate(() => window.mb0.metrics);
            report.timings[phase] = { historyMs: m.historyMs, contextMs: m.contextMs, engineReadyMs: m.engineReadyMs, chatOpenMs: m.chatOpenMs, chatLength: opened.length };
            console.log(`[mb0] ${phase} ${JSON.stringify(report.timings[phase])}`);
        }
        await page.waitForTimeout(3000);
        report.memory.spike = await heap(cdp);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

        // 适配接口覆盖：只经同源 iframe 中 ST 的公开上下文、原生模块与原生 DOM。
        const api = (fn, arg) => page.evaluate(fn, arg);
        const reply = (text, chunks = 6, perChunkMs = 40) => ctx.fixtureHttp.setOverride('vc03m-chat', { text, chunks, delay: { firstMs: 50, perChunkMs } });

        await reply('测试回复：第一条流式回答。');
        let before = await api((t) => window.mb0.api.send(t), '测试：你好');
        await api(([b]) => window.mb0.api.waitEnded(b), [before]);
        let s = await api(() => ({ tokens: window.mb0.tokens, firstMs: Math.round(window.mb0.firstTokenAt - window.mb0.sentAt), chat: window.mb0.api.chat().slice(-2) }));
        step('api', 'send+stream', s.tokens > 1 && s.chat[1]?.mes.includes('第一条流式回答') && s.chat[0].u, `tokens=${s.tokens} firstTokenMs=${s.firstMs}`);

        const long = '测试回复：' + '这是一段很长的流式内容。'.repeat(30);
        await reply(long, 40, 150);
        before = await api((t) => window.mb0.api.send(t), '测试：讲个长的');
        await until(() => api(() => window.mb0.tokens >= 3), 30000, '长回复开始');
        await api(() => window.mb0.api.stop());
        await until(() => api(() => !window.mb0.script.isGenerating?.() && !window.mb0.script.isChatSaving), 20000, '停止完成').catch(() => {});
        await page.waitForTimeout(1500);
        s = await api(() => window.mb0.api.chat().slice(-1)[0]);
        step('api', 'stop', s && !s.u && s.mes.length > 0 && s.mes.length < long.length, `kept=${s?.mes.length}/${long.length}`);

        await reply('测试回复：重新生成的回答。');
        before = await api(() => window.mb0.api.regenerate());
        await api(([b]) => window.mb0.api.waitEnded(b), [before]);
        s = await api(() => window.mb0.api.chat().slice(-1)[0]);
        step('api', 'regenerate', !s.u && s.mes.includes('重新生成的回答'), `swipes=${s.swipes}`);

        await reply('测试回复：新的候选。');
        before = await api(() => window.mb0.api.swipe('right'));
        await api(([b]) => window.mb0.api.waitEnded(b), [before]);
        s = await api(() => window.mb0.api.chat().slice(-1)[0]);
        const made = s.swipes >= 2 && s.mes.includes('新的候选');
        await api(() => window.mb0.api.swipe('left'));
        await until(() => api(() => window.mb0.api.chat().slice(-1)[0].swipe === 0), 10000, '切回候选').catch(() => {});
        const back = await api(() => window.mb0.api.chat().slice(-1)[0]);
        step('api', 'swipe', made && back.swipe === 0 && back.mes.includes('重新生成的回答'), `swipes=${s.swipes} back=${back.swipe}`);

        const chat = await api(() => window.mb0.api.chat());
        const userIdx = chat.map((m) => m.u).lastIndexOf(true);
        await api(([i, t]) => window.mb0.api.edit(i, t), [userIdx, '测试：改过的话']);
        const chatId = await api(() => window.mb0.api.chatId());
        let srv = await serverChat(page, name, avatar, chatId);
        step('api', 'edit', srv[userIdx]?.mes === '测试：改过的话', `server[${userIdx}]`);

        const lenBefore = (await api(() => window.mb0.api.chat())).length;
        await api((i) => window.mb0.api.remove(i), lenBefore - 1);
        let autoSaved = false;
        for (let k = 0; k < 25 && !autoSaved; k += 1) {
            srv = await serverChat(page, name, avatar, chatId);
            autoSaved = srv.length === lenBefore - 1;
            if (!autoSaved) await page.waitForTimeout(200);
        }
        if (!autoSaved) { await api(() => window.mb0.api.save()); srv = await serverChat(page, name, avatar, chatId); }
        report.deleteAutoSaved = autoSaved;
        const after = await api(() => window.mb0.api.chat());
        step('api', 'delete', after.length === lenBefore - 1 && srv.length === after.length, `${lenBefore}→${after.length} server=${srv.length}`);
        step('api', 'one-file', JSON.stringify(srv.map((m) => m.mes)) === JSON.stringify(after.map((m) => m.mes)), `engine=${after.length} server=${srv.length}`);

        // 复杂卡：隐藏状态下 Helper / EJS / MVU 正常；切到 ST 视图后同一状态可见。
        await api((a) => window.mb0.api.allowCard(a), complexAvatar);
        const t = Date.now();
        await api(() => window.mb0.api.reloadEngine());
        report.timings.engineReloadMs = Date.now() - t;
        report.card.allowedAfterReload = await api((a) => window.mb0.api.thAllowed(a), complexAvatar);
        report.card.popups = await api((a) => window.mb0.api.openWithPopups(a), complexAvatar);
        console.log(`[mb0] engine popups ${JSON.stringify(report.card.popups)} allowed=${JSON.stringify(report.card.allowedAfterReload)}`);
        // 卡片一次性准备：内嵌世界书导入后绑定到角色（与在 ST 里导入卡片时相同）。
        await api((b2) => window.mb0.api.bindBook(b2), bookName);
        // 世界书刚导入：重载引擎、重开聊天后再看（真实使用中导入只发生一次）。
        await api(() => window.mb0.api.reloadEngine());
        await api((a) => window.mb0.api.openWithPopups(a), complexAvatar);
        await until(() => api(() => window.mb0.api.mvu(0)?.trust === 10), 30000, 'MVU 初始化').catch(() => {});
        await until(() => api(() => (window.mb0.api.panel(0)?.trust || '') === '10'), 20000, '状态栏读数').catch(() => {});
        let p = await api(() => ({ mvu: window.mb0.api.mvu(0), panel: window.mb0.api.panel(0) }));
        report.card.hiddenProbe = p;
        if (!(p.mvu?.trust === 10)) {
            // 区分原因：可见状态下同样不行则与隐藏无关。
            await api(() => window.mb0.api.showSt(true));
            await until(() => api(() => (window.mb0.api.panel(0)?.trust || '') === '10'), 20000, '可见状态栏').catch(() => {});
            report.card.visibleProbe = await api(() => ({ mvu: window.mb0.api.mvu(0), panel: window.mb0.api.panel(0), msgs: window.mb0.api.chat().length,
                html: (document.querySelector('#engine').contentDocument.querySelector('#chat .mes[mesid="0"] .mes_text')?.innerHTML || '').slice(0, 300) }));
            await api(() => window.mb0.api.showSt(false));
            console.log(`[mb0] probes ${JSON.stringify({ hidden: report.card.hiddenProbe, visible: report.card.visibleProbe })}`);
        }
        report.card.initProbe = p; // InitVar 初始值由原生 C04 覆盖；顶层对照同样未初始化，与嵌套无关，此处只记录。
        const initOk = p.mvu?.trust === 10;
        if (initOk) report.card.topLevelProbe = 'skipped';
        report.card.console = [...consoleLog].filter((l) => /TavernHelper|Mvu|MVU|iframe|top|parent|Helper|tavern/i.test(l)).slice(0, 15);
        await reply(complexReply(42), 1, 20);
        before = await api((t2) => window.mb0.api.send(t2), '测试：聊聊旅行笔记');
        await api(([b]) => window.mb0.api.waitEnded(b), [before]);
        await until(() => api(() => window.mb0.api.mvu(-1)?.trust === 42), 30000, 'MVU 更新').catch(() => {});
        p = await api(() => window.mb0.api.mvu(-1));
        const cid = await api(() => window.mb0.api.chatId());
        const persisted = await page.evaluate(async ({ a, f, n }) => {
            const token = (await (await fetch('/csrf-token')).json()).token;
            const r = await fetch('/api/chats/get', { method: 'POST', headers: { 'Content-Type': 'application/json', ...window.mb0.headers, 'X-CSRF-Token': token }, body: JSON.stringify({ ch_name: n, file_name: f, avatar_url: a }) });
            const rows = await r.json(); const m = rows[rows.length - 1];
            const v = m?.variables?.[m.swipe_id ?? 0]?.stat_data?.trust;
            return { trust: Array.isArray(v) ? v[0] : v, raw: String(m?.mes || '').includes("_.set('trust', 42)") };
        }, { a: complexAvatar, f: cid, n: complexName });
        step('card', 'hidden-update', p?.trust === 42 && persisted.trust === 42, JSON.stringify({ engine: p, persisted }));
        await api(() => window.mb0.api.showSt(true));
        await api(() => window.mb0.api.reveal());
        await until(() => api(() => (window.mb0.api.panel(0)?.h || 0) > 24), 20000, 'ST 视图状态栏').catch(() => {});
        p = await api(() => window.mb0.api.panel(0));
        await page.screenshot({ path: path.join(OUT, 'st-view.png') });
        step('card', 'st-view', p && p.h > 24 && p.w > 24 && p.trust !== '读取中' && p.trust !== '', JSON.stringify(p));
        await api(() => window.mb0.api.showSt(false));

        report.pageErrors = errors.slice(0, 5);
        await ctx.fixtureHttp.setOverride('vc03m-chat', null);
        await bc.close();
    } finally {
        await browser.close();
        fs.rmSync(PAGE_DIR, { recursive: true, force: true });
        fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
        console.log(`[mb0] report ${path.join(OUT, 'report.json')}`);
    }
    // VC_MB0_HOLD=1：保留受管栈给模拟器验证；会话 Cookie 写入 0600 文件（受管目录，Git 忽略），
    // 创建 release 文件或 2 小时后继续，随后照常清理。
    if (process.env.VC_MB0_HOLD === '1') {
        const hold = path.join(OUT, 'hold.json');
        const release = path.join(OUT, 'release');
        fs.rmSync(release, { force: true });
        fs.writeFileSync(hold, JSON.stringify({ stBase: ctx.w05.stBase, name, avatar, file, complexAvatar,
            cookies: { vc_session: ctx.secrets.session.vcSession, vc_csrf: ctx.secrets.session.vcCsrf } }) + '\n', { mode: 0o600 });
        fs.mkdirSync(PAGE_DIR, { recursive: true });
        fs.copyFileSync(path.join(HERE, 'fixtures', 'mb0', 'index.html'), path.join(PAGE_DIR, 'index.html'));
        console.log(`[mb0] hold ${hold}`);
        const end = Date.now() + 2 * 3600 * 1000;
        while (!fs.existsSync(release) && Date.now() < end) await new Promise((r) => setTimeout(r, 2000));
        fs.rmSync(hold, { force: true });
        fs.rmSync(PAGE_DIR, { recursive: true, force: true });
    }
    const failed = [...Object.entries(report.api), ...Object.entries(report.card)].filter(([k, v]) => !['popups', 'hiddenProbe', 'visibleProbe', 'allowedAfterReload', 'console', 'topLevelProbe', 'initProbe'].includes(k) && !v.ok).map(([k]) => k);
    if (failed.length) throw new Error(`MB-0 未通过：${failed.join(', ')}`);
}

export const mb0SpikeScene = {
    id: 'mb0-spike',
    title: 'MB-0 移动端可行性：同源隐藏 ST 引擎的启动、内存、接口覆盖与复杂卡',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneMb0Spike,
};
