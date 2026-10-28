#!/usr/bin/env node
// V2-W03-S1 验收：真 headless 浏览器（playwright-core 驱动本机 Chromium 系浏览器）+ 本地固定 provider（scripts/mock-provider.mjs），
// 对锁定 ST 1.19.0 执行 VER §2 的 C01 / C02 / C03 / C06 / C07。只用 lib/fixtures.mjs 生成的原创合成数据；不调用真实模型、不碰真实私人数据。
// 证据层次（VER §1）：本脚本只证明"宿主、脚本、状态和最终请求流程"，不证明真实模型效果；真实 provider / 目标手机均为 NOT_RUN，不与 mock 结果混写。
// 断言原则：取正证据（内存中的角色/聊天状态、服务端持久化文件、mock 捕获的最终请求体），条件等待全部在 Node 侧轮询已解析值，
//   不用 waitForFunction 挂 async 函数（实测会把 Promise 当 truthy 假通过）；/api/settings/get 是 {settings:"<JSON 字符串>"} 信封。
// 产物：dev/artifacts/accept-<run>/{result.json, <case>.png, fixtures/}；失败只记结果与定位，不落盘任何请求正文。
//   result.json 的 pageErrors / consoleErrors 带页面侧栈 / 来源位置与所处步骤，便于区分 ST 自身噪声与真实问题。
// 用法：node scripts/accept.mjs [--only C07[,C02]]（只跑指定用例取证，不重跑其余稳定用例）
// 前置：node scripts/start.mjs 已就绪（ST 与 mock 均运行；本脚本不代为启动，归属以 dev/run/*.pid 为准）。
// 浏览器：VC_ST_BROWSER=<可执行文件> 覆盖；否则按平台常见安装位置探测（找不到即 BLOCKED，不自动下载）。
// 退出码：0 全部 PASS | 1 存在 FAIL | 4 前置 BLOCKED（ST/mock 未就绪或无浏览器）
import fs from 'node:fs';
import path from 'node:path';
import { USER_DIR, ARTIFACTS, ST_URL, MOCK_URL, MOCK_PORT } from './lib/paths.mjs';
import { mkdirp, sha256, waitFor } from './lib/util.mjs';
import { makePng, makePngCard, readCharaChunk, pngSize, makeStoredZip, bookEntry, cardV2, cardV3, worldBook } from './lib/fixtures.mjs';
import { complexCard, complexReply } from './lib/complex-card.mjs';

const RUN = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(4, 14);
const ART = path.join(ARTIFACTS, `accept-${RUN}`);
const FIX = path.join(ART, 'fixtures');
const MOCK_MODEL = 'vc03-fixed-model';
const SLOW_MODEL = 'vc03-slow-model';
const REPLY_MARK = '【固定回复】';
const SYNTHETIC_KEY = process.env.VC_ST_MOCK_EXPECT_KEY || 'vc03-synthetic-key';
const MANAGED = process.argv.includes('--managed');

// ---------- 结果记录 ----------
const T0 = Date.now();
const tms = () => Date.now() - T0;
const cases = [];
const consoleErrors = [];
const pageErrors = [];
let current = null;
function beginCase(id, title) { current = { id, title, status: 'PASS', steps: [], marks: [] }; cases.push(current); console.log(`\n== ${id} ${title}`); }
/** 步骤内的动作时间标记（ms，自运行开始），用于把页面错误对齐到具体触发动作。 */
const mark = (label) => current?.marks.push({ label, t: tms() });
function record(name, status, detail, t0 = null) {
    current.steps.push({ name, status, detail: detail == null ? '' : String(detail).slice(0, 700), t0, t1: tms() });
    console.log(`[${status}] ${name}${detail != null ? ' ' + String(detail).slice(0, 300) : ''}`);
    if (status === 'FAIL' && current.status !== 'FAIL') current.status = 'FAIL';
    if (status === 'NOT_RUN' && current.status === 'PASS') current.status = 'NOT_RUN';
}
/** 执行一个步骤；gate=false 时记 NOT_RUN（依赖链跳过）。返回是否通过。 */
async function step(name, gate, fn) {
    if (gate === false) { record(name, 'NOT_RUN', '前置步骤失败，依赖链跳过'); return false; }
    current.running = name; const t0 = tms();
    try { record(name, 'PASS', await fn(), t0); return true; } catch (e) { record(name, 'FAIL', e?.message || e, t0); return false; } finally { current.running = null; }
}
function note(name, status, detail) { record(name, status, detail); }

// ---------- 浏览器与前置 ----------
function detectBrowser() {
    if (process.env.VC_ST_BROWSER) return fs.existsSync(process.env.VC_ST_BROWSER) ? process.env.VC_ST_BROWSER : null;
    const candidates = process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
    return candidates.find((p) => fs.existsSync(p)) || null;
}
async function preflight() {
    const out = {};
    try { const r = await fetch(`${ST_URL}/version`); out.st = r.ok ? await r.json() : { http: r.status }; } catch (e) { out.st = { error: String(e.cause?.code || e.message) }; }
    try { const r = await fetch(`${MOCK_URL}/__health`); out.mock = r.ok ? await r.json() : { http: r.status }; } catch (e) { out.mock = { error: String(e.cause?.code || e.message) }; }
    out.browser = detectBrowser();
    const blockers = [];
    if (typeof out.st?.pkgVersion !== 'string') blockers.push(`ST 未就绪 ${ST_URL}：${JSON.stringify(out.st)}`);
    if (out.mock?.ok !== true) blockers.push(`mock 未就绪 ${MOCK_URL}：${JSON.stringify(out.mock)}`);
    if (!out.browser) blockers.push('未找到 Chromium 系浏览器（设 VC_ST_BROWSER 指向可执行文件）');
    return { ...out, blockers };
}

// ---------- mock 捕获（仅内存，经本地接口读取） ----------
async function mockClear() { await fetch(`${MOCK_URL}/__captures/clear`, { method: 'POST' }); return Date.now(); }
async function mockChatCaptures(since) {
    const r = await fetch(`${MOCK_URL}/__captures${MANAGED ? '' : `?since=${since - 1000}`}`);
    const data = await r.json();
    return (MANAGED ? data.captures.map((c) => ({ ...c, url: c.finalUrl })) : data).filter((c) => /\/chat\/completions$/.test(c.url));
}
/** 等待自 since 起至少 n 条 chat/completions 捕获；返回捕获数组（正文只在内存中用于断言，不写入结果）。 */
async function waitCaptures(since, n, timeoutMs = 30000) {
    return waitFor(async () => { const c = await mockChatCaptures(since); return c.length >= n ? c : false; }, { timeoutMs, intervalMs: 250, label: `mock 捕获 >=${n}` });
}
const flat = (cap) => JSON.stringify(cap?.body?.messages ?? []);

// ---------- 页面通用 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Node 侧轮询：fn 返回 true 即通过；超时抛错并附最后一次返回值（截断）。 */
async function poll(fn, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { last = await fn(); if (last === true) return; await sleep(250); }
    throw new Error(`等待超时：${label}；last=${JSON.stringify(last)?.slice(0, 200)}`);
}
async function persistedSettings(page) {
    const r = await page.evaluate(async () => {
        const resp = await fetch('/api/settings/get', { method: 'POST', headers: window.SillyTavern.getContext().getRequestHeaders() });
        if (!resp.ok) return { error: `settings/get HTTP ${resp.status}` };
        const env = await resp.json();
        if (typeof env?.settings !== 'string') return { error: `settings 信封类型异常 ${typeof env?.settings}` };
        try { return { settings: JSON.parse(env.settings) }; } catch (e) { return { error: `settings 解析失败 ${e?.message}` }; }
    });
    if (r?.error) throw new Error(r.error);
    return r.settings;
}
/** 点击 ST 通用 dialog.popup 中匹配文本的按钮；返回 {clicked, text}。 */
async function clickPopup(page, re, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const hit = await page.evaluate((src) => {
            const r = new RegExp(src, 'i');
            for (const dlg of document.querySelectorAll('dialog.popup[open]')) {
                for (const b of dlg.querySelectorAll('.popup-button-ok, .popup-button-custom, .popup-button-cancel, .menu_button')) {
                    if (r.test(b.textContent || '')) { b.click(); return (dlg.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160); }
                }
            }
            return null;
        }, re.source);
        if (hit) return { clicked: true, text: hit };
        await sleep(300);
    }
    return { clicked: false, text: null };
}
const ctxEval = (page, fn, arg) => page.evaluate(fn, arg);
// ---------- 页面动作 ----------
async function uiReady(page) {
    await page.waitForSelector('#preloader', { state: 'hidden', timeout: 90000 });
    await poll(() => ctxEval(page, () => typeof window.SillyTavern?.getContext === 'function' && Array.isArray(window.SillyTavern.getContext().chat)), 60000, 'ST context');
    await page.waitForSelector('#send_textarea', { state: 'attached', timeout: 30000 });
    await poll(() => ctxEval(page, () => typeof globalThis.TavernHelper === 'object' && globalThis.TavernHelper !== null), 30000, 'TavernHelper 加载');
    // 生成状态钩子：sendTextareaMessage 在 is_send_press 为真时静默丢弃点击（script.js:1739，无队列），发送前须等生成空闲。
    // 群聊里外层 Generate 先发 GENERATION_STARTED 再委托 generateGroupWrapper 逐成员 Generate（STARTED 比 ENDED 多一次），
    // 因此不用计数相等判定，而用"最后一个非 dryRun 生成事件是 ENDED/STOPPED 且已沉降 300ms"。
    await ctxEval(page, () => {
        if (window.__vcGen) return;
        const c = window.SillyTavern.getContext(); const g = (window.__vcGen = { last: 'none', at: 0, started: 0, ended: 0, stopped: 0 });
        c.eventSource.on(c.eventTypes.GENERATION_STARTED, (_type, _opts, dryRun) => { if (!dryRun) { g.started += 1; g.last = 'started'; g.at = Date.now(); } });
        c.eventSource.on(c.eventTypes.GENERATION_ENDED, () => { g.ended += 1; g.last = 'ended'; g.at = Date.now(); });
        c.eventSource.on(c.eventTypes.GENERATION_STOPPED, () => { g.stopped += 1; g.last = 'stopped'; g.at = Date.now(); });
    });
}
const idleInPage = () => {
    const g = window.__vcGen; const s = document.querySelector('#mes_stop'); const b = document.querySelector('#send_but');
    const stopHidden = !s || getComputedStyle(s).display === 'none'; const sendVisible = !!b && getComputedStyle(b).display !== 'none';
    // 手动策略下用户发送只触发外层 STARTED、无人发言即返回而不发 ENDED，因此 last=started 只在 3s 内视为忙碌
    const settled = !g || g.last === 'none' || (g.last === 'started' ? Date.now() - g.at > 3000 : Date.now() - g.at > 300);
    return (stopHidden && sendVisible && settled) ? true : { stopHidden, sendVisible, gen: g ? { last: g.last, ago: Date.now() - g.at, started: g.started, ended: g.ended, stopped: g.stopped } : null };
};
async function waitIdle(page, label = '生成空闲') { await poll(() => ctxEval(page, idleInPage), 30000, label); }
/** Chat Completion → Custom 指向本地 mock；三层读回（UI / 模块活引用 / 服务端 settings.json）+ onlineStatus 终态。 */
async function connectMock(page) {
    if (MANAGED) {
        await poll(() => page.evaluate(() => {
            const s = SillyTavern.getContext().chatCompletionSettings;
            return s.chat_completion_source === 'custom' && s.custom_model === 'vc03m-chat' && String(s.custom_url).startsWith('vc-go://');
        }), 30000, 'Go 目录前台投影');
        await page.evaluate(() => document.querySelector('#api_button_openai').click());
        await poll(() => page.evaluate(() => ['有效的', 'Valid'].includes(String(SillyTavern.getContext().onlineStatus))), 30000, '受管连接');
        return '真实 Go 目录投影 + server plugin + 本地合成 provider';
    }
    await ctxEval(page, () => { window.SillyTavern.getContext().powerUserSettings.tag_import_setting = 2; $('#main_api').val('openai').trigger('change'); $('#chat_completion_source').val('custom').trigger('change'); });
    await poll(() => ctxEval(page, () => $('#chat_completion_source').val() === 'custom' && $('#custom_api_url_text').length === 1), 10000, 'custom 面板');
    await ctxEval(page, (a) => {
        $('#custom_api_url_text').val(a.url).trigger('input').trigger('change');
        $('#api_key_custom').val(a.key).trigger('input').trigger('change');
        $('#custom_model_id').val(a.model).trigger('input').trigger('change');
        $('#api_button_openai').trigger('click');
    }, { url: `${MOCK_URL}/v1`, key: SYNTHETIC_KEY, model: MOCK_MODEL });
    const live = await ctxEval(page, () => { const s = window.SillyTavern.getContext().chatCompletionSettings; return { url: String(s?.custom_url || ''), model: s?.custom_model, source: s?.chat_completion_source }; });
    if (!live.url.includes(`:${MOCK_PORT}`) || live.model !== MOCK_MODEL || live.source !== 'custom') throw new Error(`模块 oai_settings 不符：${JSON.stringify(live)}`);
    await poll(async () => { const s = await persistedSettings(page).catch((e) => ({ __e: e.message })); if (s.__e) return s.__e; return String(s?.oai_settings?.custom_url || '').includes(`:${MOCK_PORT}`) && s?.oai_settings?.custom_model === MOCK_MODEL; }, 15000, 'custom_url/custom_model 持久化');
    await poll(() => ctxEval(page, () => ['有效的', 'Valid'].includes(String(window.SillyTavern.getContext().onlineStatus))), 30000, 'onlineStatus 终态');
    return `source=custom url=${live.url} model=${live.model} onlineStatus=${await ctxEval(page, () => window.SillyTavern.getContext().onlineStatus)}（key 只比对不记录）`;
}
async function importCharacterFile(page, file, name) {
    await page.setInputFiles('#character_import_file', file);
    await poll(() => ctxEval(page, (n) => window.SillyTavern.getContext().characters.some((c) => c.name === n), name), 30000, `角色 ${name} 出现`);
    return ctxEval(page, (n) => { const c = window.SillyTavern.getContext().characters.find((x) => x.name === n); return { avatar: c.avatar, chid: window.SillyTavern.getContext().characters.indexOf(c) }; }, name);
}
async function selectCharacter(page, name) {
    const idx = await ctxEval(page, (n) => window.SillyTavern.getContext().characters.findIndex((c) => c.name === n), name);
    if (idx < 0) throw new Error(`角色 ${name} 不存在`);
    await page.waitForSelector(`.character_select[data-chid="${idx}"]`, { state: 'attached', timeout: 20000 });
    await ctxEval(page, (i) => document.querySelector(`.character_select[data-chid="${i}"]`).click(), idx);
    await poll(() => ctxEval(page, (n) => { const c = window.SillyTavern.getContext(); return c.characterId !== undefined && c.characters[c.characterId]?.name === n && c.chat.length >= 1 && document.querySelectorAll('#chat .mes').length >= 1; }, name), 30000, `打开角色 ${name}`);
    return idx;
}
/** 处理"导入内嵌世界书"确认弹窗并等待世界书文件落盘；再用 Helper 公开 API 持久绑定主世界书（ST 1.19.0 导入确认不持久化 extensions.world）。 */
async function importEmbeddedBookAndBind(page, bookName, avatar) {
    const confirm = /^确认$|^确定$|^是$|^OK$|Confirm|Import|导入|Yes/;
    const popup = await clickPopup(page, confirm, 10000);
    const file = path.join(USER_DIR, 'worlds', `${bookName}.json`);
    await poll(async () => {
        // 初次导入复杂卡时，原生正则许可弹窗可能排在世界书确认之前。
        await clickPopup(page, confirm, 300);
        return fs.existsSync(file) && await page.evaluate((name) => TavernHelper.getLorebooks().includes(name)
            && !document.querySelector('dialog.popup[open]'), bookName);
    }, 15000, `世界书文件 ${bookName}.json`);
    await ctxEval(page, (b) => globalThis.TavernHelper.setCurrentCharLorebooks({ primary: b, additional: [] }), bookName);
    await poll(() => ctxEval(page, (b) => globalThis.TavernHelper.getCharLorebooks().primary === b, bookName), 10000, 'primary 绑定');
    const pngFile = path.join(USER_DIR, 'characters', avatar);
    await poll(() => { try { return readCharaChunk(fs.readFileSync(pngFile))?.data?.extensions?.world === bookName; } catch { return false; } }, 20000, '角色 PNG 内 extensions.world 持久化');
    const world = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { popup: popup.clicked ? popup.text : '未出现弹窗', entries: Object.keys(world.entries || {}).length, world };
}
/** 等待生成空闲后发送；点击后验证用户消息已入链（被丢弃的点击不会重复发送，最多重试 3 次）。 */
async function typeAndSend(page, text) {
    await waitIdle(page);
    const n0 = await chatLen(page);
    for (let attempt = 1; attempt <= 3; attempt++) {
        await ctxEval(page, (m) => { const ta = document.querySelector('#send_textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, m); ta.dispatchEvent(new Event('input', { bubbles: true })); }, text);
        await ctxEval(page, () => document.querySelector('#send_but').click());
        const landed = await poll(() => ctxEval(page, (n) => { const c = window.SillyTavern.getContext().chat; return c.length >= n + 1 && c[n]?.is_user === true; }, n0), 6000, '用户消息入链').then(() => true).catch(() => false);
        if (landed) return attempt;
        await waitIdle(page, `重试前空闲（第 ${attempt} 次点击被丢弃）`);
    }
    throw new Error('发送 3 次均未入链');
}
const chatLen = (page) => ctxEval(page, () => window.SillyTavern.getContext().chat.length);
/** 单人聊天：发送并等待 mock 固定回复完整落入 chat；返回 { capture, userIdx, replyIdx }。 */
async function sendSolo(page, text) {
    const since = await mockClear();
    const n0 = await chatLen(page);
    await typeAndSend(page, text);
    await poll(() => ctxEval(page, (p) => { const ch = window.SillyTavern.getContext().chat; const last = ch[ch.length - 1]; const s = document.querySelector('#mes_stop'); return ch.length >= p.n + 2 && ch[p.n]?.is_user === true && !last.is_user && last.mes.includes(p.mark) && (!s || getComputedStyle(s).display === 'none'); }, { n: n0, mark: REPLY_MARK }), 60000, '固定回复完整到达');
    const caps = await waitCaptures(since, 1);
    return { capture: caps[caps.length - 1], userIdx: n0, replyIdx: n0 + 1 };
}
const mesText = (page, idx) => ctxEval(page, (i) => document.querySelector(`#chat .mes[mesid="${i}"] .mes_text`)?.textContent ?? null, idx);
const chatMes = (page, idx) => ctxEval(page, (i) => { const m = window.SillyTavern.getContext().chat[i]; return m ? { mes: m.mes, is_user: m.is_user, name: m.name, swipes: m.swipes?.length ?? 0, original_avatar: m.original_avatar ?? null } : null; }, idx);
async function shot(page, name) { const p = path.join(ART, `${name}.png`); await page.screenshot({ path: p, fullPage: false }); return p; }
async function exportCharacter(page, avatar, format) {
    const r = await ctxEval(page, async (a) => {
        const resp = await fetch('/api/characters/export', { method: 'POST', headers: window.SillyTavern.getContext().getRequestHeaders(), body: JSON.stringify({ format: a.format, avatar_url: a.avatar }) });
        if (!resp.ok) return { error: `export HTTP ${resp.status}` };
        if (a.format === 'json') return { json: await resp.json() };
        const buf = new Uint8Array(await resp.arrayBuffer()); let s = ''; for (const b of buf) s += String.fromCharCode(b); return { b64: btoa(s) };
    }, { avatar, format });
    if (r.error) throw new Error(r.error);
    return format === 'json' ? r.json : Buffer.from(r.b64, 'base64');
}
// ---------- C01 基础 JSON / PNG 卡 ----------
async function caseC01(page) {
    beginCase('C01', '基础 JSON / PNG 卡：开场、内嵌世界书、扩展 metadata 和导出字段');
    const J = `VC01J${RUN}`, P = `VC01P${RUN}`, BOOK = `VC01Book${RUN}`;
    const meta = { run: RUN, kind: 'c01-json', nested: { level: 2, list: [1, 2, 3] } };
    const alts = ['VC01_ALT1 备用开场一', 'VC01_ALT2 备用开场二'];
    const jsonCard = cardV2({
        name: J, description: 'VC01_DESC 原创合成角色，蓝窗书店的成年店员。', first_mes: 'VC01_FIRST 欢迎来到蓝窗书店。', alternate_greetings: alts,
        book: worldBook(BOOK, [bookEntry({ id: 1, keys: [], content: 'VC01_CONST_常驻设定', constant: true, insertion_order: 100, comment: '常驻' }), bookEntry({ id: 2, keys: ['钟塔'], content: 'VC01_KEY_钟塔设定', insertion_order: 90, comment: '关键词' })]),
        extensions: { vc_meta: meta },
    });
    const jsonFile = path.join(FIX, `${J}.json`); fs.writeFileSync(jsonFile, JSON.stringify(jsonCard, null, 2), { mode: 0o600 });
    const pngMeta = { run: RUN, kind: 'c01-png' };
    const pngCard = cardV2({ name: P, description: 'VC01P_DESC 原创合成角色（PNG 卡）。', first_mes: 'VC01P_FIRST 你好，这里是 PNG 卡开场。', alternate_greetings: ['VC01P_ALT 备用'], extensions: { vc_meta: pngMeta } });
    const pngFile = path.join(FIX, `${P}.png`); fs.writeFileSync(pngFile, makePngCard(pngCard, { width: 72, height: 72, rgba: [200, 120, 80, 255] }), { mode: 0o600 });

    let info;
    let ok = await step('C01.1 导入 JSON 卡并读回字段（开场/备用开场/内嵌世界书/扩展 metadata）', true, async () => {
        info = await importCharacterFile(page, jsonFile, J);
        const c = await ctxEval(page, (n) => { const x = window.SillyTavern.getContext().characters.find((c) => c.name === n); return { first_mes: x.first_mes, alts: x.data?.alternate_greetings, entries: (x.data?.character_book?.entries || []).map((e) => e.keys), bookName: x.data?.character_book?.name, meta: x.data?.extensions?.vc_meta }; }, J);
        if (c.first_mes !== jsonCard.data.first_mes) throw new Error(`first_mes 不符 ${c.first_mes}`);
        if (JSON.stringify(c.alts) !== JSON.stringify(alts)) throw new Error(`alternate_greetings 不符 ${JSON.stringify(c.alts)}`);
        if (c.bookName !== BOOK || c.entries.length !== 2 || c.entries[1][0] !== '钟塔') throw new Error(`character_book 不符 ${JSON.stringify({ b: c.bookName, e: c.entries })}`);
        if (JSON.stringify(c.meta) !== JSON.stringify(meta)) throw new Error(`extensions.vc_meta 不符 ${JSON.stringify(c.meta)}`);
        return `avatar=${info.avatar}；first_mes / alternate_greetings(2) / character_book(2 条) / vc_meta 与输入一致`;
    });
    ok = await step('C01.2 打开角色：开场消息 = first_mes，swipes = 1 + 备用开场数，DOM 可见', ok, async () => {
        await selectCharacter(page, J);
        const m0 = await chatMes(page, 0); const dom = await mesText(page, 0);
        if (m0.mes !== jsonCard.data.first_mes || m0.is_user) throw new Error(`chat[0] 不符 ${JSON.stringify(m0)}`);
        if (m0.swipes !== 1 + alts.length) throw new Error(`swipes=${m0.swipes}（要求 ${1 + alts.length}）`);
        if (!dom || !dom.includes('VC01_FIRST')) throw new Error(`DOM 开场未渲染 ${dom}`);
        return `chat[0].mes="${m0.mes.slice(0, 28)}" swipes=${m0.swipes}`;
    });
    ok = await step('C01.3 内嵌世界书：确认导入弹窗 → worlds/ 落盘 → 绑定持久化到角色 PNG', ok, async () => {
        const r = await importEmbeddedBookAndBind(page, BOOK, info.avatar);
        const entries = Object.values(r.world.entries || {});
        const keys = entries.map((e) => (e.key || []).join('|'));
        if (r.entries !== 2 || !keys.includes('钟塔')) throw new Error(`世界书条目不符 ${JSON.stringify(keys)}`);
        if (!entries.some((e) => e.constant === true && String(e.content).includes('VC01_CONST'))) throw new Error('常驻条目未保留 constant=true');
        return `弹窗:${String(r.popup).slice(0, 50)}；worlds/${BOOK}.json entries=${r.entries} keys=[${keys.join(',')}]；extensions.world 已写入角色 PNG`;
    });
    await step('C01.4 导出 JSON：spec / first_mes / alternate_greetings / character_book / vc_meta / world 字段保留，chat 剔除', ok, async () => {
        const ex = await exportCharacter(page, info.avatar, 'json'); const d = ex.data || {};
        const checks = { spec: ['chara_card_v2', 'chara_card_v3'].includes(ex.spec), first_mes: d.first_mes === jsonCard.data.first_mes, alts: JSON.stringify(d.alternate_greetings) === JSON.stringify(alts), book: d.character_book?.entries?.length === 2, meta: JSON.stringify(d.extensions?.vc_meta) === JSON.stringify(meta), world: d.extensions?.world === BOOK, noChat: ex.chat === undefined };
        if (Object.values(checks).some((v) => !v)) throw new Error(`${JSON.stringify(checks)} spec=${JSON.stringify(ex.spec)}`);
        return `spec=${ex.spec}/${ex.spec_version} ${JSON.stringify(checks)}`;
    });
    ok = await step('C01.5 导入 PNG 卡（tEXt chara）并读回字段，落盘保留 72x72 原图', true, async () => {
        const i2 = await importCharacterFile(page, pngFile, P);
        const c = await ctxEval(page, (n) => { const x = window.SillyTavern.getContext().characters.find((c) => c.name === n); return { first_mes: x.first_mes, alts: x.data?.alternate_greetings, meta: x.data?.extensions?.vc_meta }; }, P);
        if (c.first_mes !== pngCard.data.first_mes || JSON.stringify(c.meta) !== JSON.stringify(pngMeta) || c.alts?.length !== 1) throw new Error(JSON.stringify(c));
        const size = pngSize(fs.readFileSync(path.join(USER_DIR, 'characters', i2.avatar)));
        if (size?.width !== 72 || size?.height !== 72) throw new Error(`落盘 PNG 尺寸 ${JSON.stringify(size)}`);
        info = i2;
        return `avatar=${i2.avatar} 72x72 保留；first_mes / alternate_greetings / vc_meta 一致`;
    });
    await step('C01.6 导出 PNG：chara 块含 name / first_mes / vc_meta，fav 重置，尺寸保留', ok, async () => {
        const buf = await exportCharacter(page, info.avatar, 'png');
        const chara = readCharaChunk(buf); const size = pngSize(buf);
        const checks = { name: chara?.data?.name === P, first_mes: chara?.data?.first_mes === pngCard.data.first_mes, meta: JSON.stringify(chara?.data?.extensions?.vc_meta) === JSON.stringify(pngMeta), size: size?.width === 72 && size?.height === 72, favReset: chara?.data?.extensions?.fav === false };
        if (Object.values(checks).some((v) => !v)) throw new Error(JSON.stringify(checks));
        return `${buf.length}B ${JSON.stringify(checks)}`;
    });
    current.screenshot = await shot(page, 'C01');
}
// ---------- C02 世界书 ----------
async function caseC02(page) {
    beginCase('C02', '世界书：关键词、次级条件、递归、预算和冷却代表路径，查看最终注入');
    const N = `VC02${RUN}`, BOOK = `VC02Book${RUN}`;
    const filler = 'WI02_BLO_低优先级长条目，用于触发预算溢出，内容为原创合成占位文字。'.repeat(50);
    const book = worldBook(BOOK, [
        bookEntry({ id: 1, keys: ['钟塔'], content: 'WI02_KEY_钟塔旁有一处地窖入口', insertion_order: 100, comment: '关键词（含递归触发词 地窖）' }),
        bookEntry({ id: 2, keys: ['地窖'], content: 'WI02_REC_地窖里藏着旧书', insertion_order: 90, comment: '仅由递归激活' }),
        bookEntry({ id: 3, keys: ['钟塔'], secondary_keys: ['午夜'], selective: true, content: 'WI02_SEC_午夜钟塔会鸣响', insertion_order: 80, comment: '次级条件 AND_ANY', extensions: { selectiveLogic: 0 } }),
        bookEntry({ id: 4, keys: ['冷却词'], content: 'WI02_COOL_冷却条目内容', insertion_order: 70, comment: '冷却 3 条消息', extensions: { cooldown: 3 } }),
        bookEntry({ id: 5, keys: ['预算词'], content: 'WI02_BHI_短条目', insertion_order: 60, comment: '预算内高优先级' }),
        bookEntry({ id: 6, keys: ['预算词'], content: filler, insertion_order: 50, comment: '预算外低优先级长条目' }),
    ]);
    const card = cardV2({ name: N, description: 'VC02_DESC 原创合成角色。', first_mes: 'VC02_FIRST 你好。', book, extensions: { vc_meta: { run: RUN, kind: 'c02' } } });
    const file = path.join(FIX, `${N}.json`); fs.writeFileSync(file, JSON.stringify(card, null, 2), { mode: 0o600 });

    let info;
    let ok = await step('C02.0 导入含 6 条世界书的卡 → 打开 → 导入并绑定世界书 → 开启递归（持久化）', true, async () => {
        info = await importCharacterFile(page, file, N); await selectCharacter(page, N);
        const r = await importEmbeddedBookAndBind(page, BOOK, info.avatar);
        const e = Object.values(r.world.entries);
        const cool = e.find((x) => String(x.content).startsWith('WI02_COOL')); const sec = e.find((x) => String(x.content).startsWith('WI02_SEC'));
        if (r.entries !== 6 || cool?.cooldown !== 3 || sec?.selective !== true || (sec?.keysecondary || [])[0] !== '午夜') throw new Error(`转换后字段不符 ${JSON.stringify({ n: r.entries, cooldown: cool?.cooldown, selective: sec?.selective, ks: sec?.keysecondary })}`);
        await ctxEval(page, () => { $('#world_info_recursive').prop('checked', true).trigger('input'); $('#world_info_budget_cap').val(0).trigger('input'); });
        await poll(async () => (await persistedSettings(page))?.world_info_settings?.world_info_recursive === true, 15000, 'world_info_recursive 持久化');
        return 'entries=6（cooldown=3 / selective+keysecondary 转换正确）；递归已开启并持久化到 settings.json';
    });
    ok = await step('C02.1 关键词 + 递归：发送含"钟塔"→ 最终请求含 KEY 与 REC；SEC / COOL / BHI 不注入', ok, async () => {
        const { capture } = await sendSolo(page, '请介绍一下钟塔。'); const s = flat(capture);
        const got = { KEY: s.includes('WI02_KEY'), REC: s.includes('WI02_REC'), SEC: s.includes('WI02_SEC'), COOL: s.includes('WI02_COOL'), BHI: s.includes('WI02_BHI'), authMatched: capture.authMatched, model: capture.model };
        if (!(got.KEY && got.REC && !got.SEC && !got.COOL && !got.BHI && got.authMatched && got.model === MOCK_MODEL)) throw new Error(JSON.stringify(got));
        return JSON.stringify(got);
    });
    ok = await step('C02.2 次级条件：发送含"钟塔"+"午夜"→ SEC 注入', ok, async () => {
        const s = flat((await sendSolo(page, '午夜的钟塔会怎样？')).capture);
        const got = { KEY: s.includes('WI02_KEY'), SEC: s.includes('WI02_SEC') };
        if (!(got.KEY && got.SEC)) throw new Error(JSON.stringify(got));
        return JSON.stringify(got);
    });
    // 冷却语义（world-info.js:607/634）：end = 激活时 chat.length + N，chat.length >= end 即结束；用户消息与回复各算一条，
    // 故 N=2 恰被一轮消耗，N=3 才能观察到"紧接的下一轮被抑制"。
    ok = await step('C02.3 冷却：首次"冷却词"注入 COOL；紧接着再发一次不注入（cooldown=3）', ok, async () => {
        const a = flat((await sendSolo(page, '说说冷却词。')).capture);
        const b = flat((await sendSolo(page, '再说一次冷却词。')).capture);
        const got = { first: a.includes('WI02_COOL'), second: b.includes('WI02_COOL') };
        if (!(got.first && !got.second)) throw new Error(JSON.stringify(got));
        return JSON.stringify(got);
    });
    ok = await step('C02.4 预算：cap=300 token 时"预算词"只注入高优先级短条目，低优先级长条目被截断', ok, async () => {
        await ctxEval(page, () => $('#world_info_budget_cap').val(300).trigger('input'));
        await poll(async () => (await persistedSettings(page))?.world_info_settings?.world_info_budget_cap === 300, 15000, 'budget_cap 持久化');
        let got;
        try { const s = flat((await sendSolo(page, '聊聊预算词。')).capture); got = { BHI: s.includes('WI02_BHI'), BLO: s.includes('WI02_BLO') }; }
        finally { await ctxEval(page, () => $('#world_info_budget_cap').val(0).trigger('input')); }
        if (!(got.BHI && !got.BLO)) throw new Error(JSON.stringify(got));
        return `${JSON.stringify(got)}（已恢复 cap=0）`;
    });
    await step('C02.5 聊天文件原生落盘（header + 开场 + 5 轮）', ok, async () => {
        const dir = path.join(USER_DIR, 'chats', N);
        await poll(() => fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.jsonl')), 15000, 'chat jsonl 出现');
        const f = fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')).map((x) => ({ x, m: fs.statSync(path.join(dir, x)).mtimeMs })).sort((a, b) => b.m - a.m)[0].x;
        let lines; await poll(() => { lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean); return lines.length >= 12; }, 20000, 'jsonl 行数 >= 12');
        const header = JSON.parse(lines[0]); const tw = header.chat_metadata?.timedWorldInfo;
        return `${f} lines=${lines.length} timedWorldInfo=${tw ? `cooldown keys=${Object.keys(tw.cooldown || {}).length}` : '缺失'}`;
    });
    current.screenshot = await shot(page, 'C02');
}
// ---------- C03 宏 / 预设 / 正则 ----------
// 三层区别（ST 1.19.0 实测 + 代码）：卡字段（description / first_mes）保留 {{char}}/{{user}} 原文；开场写入 chat 时与可见文本一样已替换
// （messageFormatting 再做 substituteParams）；系统提示中的角色描述替换；Chat Completion 历史 content = chat[j].mes 原样发送（openai.js setOpenAIMessages）。
async function caseC03(page) {
    beginCase('C03', '宏 / 预设 / 正则：原文、界面文本和发给模型的文本按预期区别');
    const N = `VC03${RUN}`, PRESET = `VC03Preset${RUN}`;
    const card = cardV2({ name: N, description: '{{char}}是原创合成角色，与{{user}}在蓝窗书店相识。VC03_DESC', first_mes: '我是{{char}}，你好{{user}}。VC03_FIRST', extensions: { vc_meta: { run: RUN, kind: 'c03' } } });
    const file = path.join(FIX, `${N}.json`); fs.writeFileSync(file, JSON.stringify(card, null, 2), { mode: 0o600 });
    const userName = await ctxEval(page, () => window.SillyTavern.getContext().name1);

    let ok = await step('C03.1 宏：卡字段 description / first_mes 保留 {{char}}/{{user}} 原文；chat[0].mes 与 DOM 可见文本均已替换为真实名字', true, async () => {
        await importCharacterFile(page, file, N); await selectCharacter(page, N);
        const raw = await ctxEval(page, (n) => { const c = window.SillyTavern.getContext(); const x = c.characters.find((c) => c.name === n); return { desc: x.description, cardFirst: x.first_mes, chat0: c.chat[0].mes }; }, N);
        const dom = await mesText(page, 0);
        const got = { cardDescMacro: raw.desc.includes('{{char}}') && raw.desc.includes('{{user}}'), cardFirstMacro: raw.cardFirst.includes('{{char}}') && raw.cardFirst.includes('{{user}}'), chat0Substituted: raw.chat0.includes(`我是${N}`) && raw.chat0.includes(userName) && !raw.chat0.includes('{{'), domSubstituted: !!dom && !dom.includes('{{') && dom.includes(N) && dom.includes(userName) };
        if (Object.values(got).some((v) => !v)) throw new Error(JSON.stringify({ ...got, chat0: raw.chat0.slice(0, 60), dom: dom?.slice(0, 60) }));
        return `${JSON.stringify(got)} user="${userName}"`;
    });
    ok = await step('C03.2 正则：挂载 2 条全局脚本（AI 输出 markdownOnly / 用户输入 promptOnly）并持久化', ok, async () => {
        const scripts = [
            { id: `vc03-display-${RUN}`, scriptName: 'VC03 显示层替换', findRegex: '/固定回复/g', replaceString: '显示层替换', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null },
            { id: `vc03-prompt-${RUN}`, scriptName: 'VC03 提示层替换', findRegex: '/VC_PROMPT_原词/g', replaceString: '提示层替换', trimStrings: [], placement: [1], disabled: false, markdownOnly: false, promptOnly: true, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null },
        ];
        await ctxEval(page, (s) => { const c = window.SillyTavern.getContext(); c.extensionSettings.regex = [...(c.extensionSettings.regex || []).filter((x) => !String(x.id).startsWith('vc03-')), ...s]; c.saveSettingsDebounced(); }, scripts);
        await poll(async () => ((await persistedSettings(page))?.extension_settings?.regex || []).filter((x) => String(x.id).startsWith('vc03-') && String(x.id).endsWith(RUN)).length === 2, 15000, 'regex 脚本持久化');
        return '2 条脚本已写入 extension_settings.regex 并持久化到 settings.json';
    });
    ok = await step('C03.3 正则发送：用户原文/DOM 保留、请求替换（promptOnly）；回复原文保留、DOM 替换（markdownOnly）；系统提示描述宏已替换', ok, async () => {
        const r1 = await sendSolo(page, 'VC_PROMPT_原词 请简短回复。'); const s = flat(r1.capture);
        const u = await chatMes(page, r1.userIdx); const a = await chatMes(page, r1.replyIdx);
        const uDom = await mesText(page, r1.userIdx); const aDom = await mesText(page, r1.replyIdx);
        const got = {
            userRaw: u.mes.includes('VC_PROMPT_原词'), userDomRaw: !!uDom && uDom.includes('VC_PROMPT_原词'),
            reqReplaced: s.includes('提示层替换') && !s.includes('VC_PROMPT_原词'),
            replyRaw: a.mes.includes('固定回复'), replyDomReplaced: !!aDom && aDom.includes('显示层替换') && !aDom.includes('固定回复'),
            sysDescSubstituted: s.includes(`${N}是原创合成角色`) && s.includes('VC03_DESC') && !s.includes('{{char}}是'),
        };
        if (Object.values(got).some((v) => !v)) throw new Error(JSON.stringify(got));
        return JSON.stringify(got);
    });
    ok = await step('C03.4 预设：从默认预设派生主提示标记 → 原生导入 → 自动选中并落盘 OpenAI Settings/', ok, async () => {
        const base = JSON.parse(fs.readFileSync(path.join(USER_DIR, 'OpenAI Settings', 'Default.json'), 'utf8'));
        const main = (base.prompts || []).find((p) => p.identifier === 'main'); if (!main) throw new Error('Default.json 缺 main prompt');
        main.content = `VC03_PRESET_MAIN_${RUN} 你是原创合成角色，请简短回答。`;
        Object.assign(base, { chat_completion_source: 'custom', custom_url: `${MOCK_URL}/v1`, custom_model: MOCK_MODEL }); delete base.reverse_proxy; delete base.proxy_password;
        const pf = path.join(FIX, `${PRESET}.json`); fs.writeFileSync(pf, JSON.stringify(base, null, 2), { mode: 0o600 });
        await page.setInputFiles('#openai_preset_import_file', pf);
        // 预设含 custom_url 等端点字段时 ST 弹"The imported preset contains proxy and/or custom endpoint settings"（openai.js:4789），按原生路径选 Import as-is
        const popup = await clickPopup(page, /Import as-is|按原样导入|原样导入/, 8000);
        await poll(() => ctxEval(page, (n) => window.SillyTavern.getContext().chatCompletionSettings?.preset_settings_openai === n, PRESET), 20000, '预设选中');
        await poll(() => fs.existsSync(path.join(USER_DIR, 'OpenAI Settings', `${PRESET}.json`)), 15000, '预设文件落盘');
        const live = await ctxEval(page, () => { const s = window.SillyTavern.getContext().chatCompletionSettings; return { source: s.chat_completion_source, model: s.custom_model, main: (s.prompts || []).find((p) => p.identifier === 'main')?.content?.slice(0, 24) }; });
        if (live.source !== 'custom' || live.model !== MOCK_MODEL || !String(live.main).startsWith('VC03_PRESET_MAIN')) throw new Error(JSON.stringify(live));
        return `preset=${PRESET} 弹窗=${popup.clicked ? 'Import as-is' : '未出现'} ${JSON.stringify(live)}`;
    });
    await step('C03.5 再发一轮：系统提示含预设标记；历史回复保留"固定回复"（显示层正则不进请求）；历史用户词仍为提示层替换；请求全文无未替换宏', ok, async () => {
        const s = flat((await sendSolo(page, '请再回复一次。')).capture);
        const got = { presetMark: s.includes(`VC03_PRESET_MAIN_${RUN}`), historyReplyRaw: s.includes('固定回复') && !s.includes('显示层替换'), historyUserPromptReplaced: s.includes('提示层替换') && !s.includes('VC_PROMPT_原词'), historyFirstSubstituted: s.includes(`我是${N}`), noRawMacro: !s.includes('{{char}}') && !s.includes('{{user}}') };
        if (Object.values(got).some((v) => !v)) throw new Error(JSON.stringify(got));
        return JSON.stringify(got);
    });
    await ctxEval(page, () => { const c = window.SillyTavern.getContext(); c.extensionSettings.regex = (c.extensionSettings.regex || []).filter((x) => !String(x.id).startsWith('vc03-')); c.saveSettingsDebounced(); });
    current.screenshot = await shot(page, 'C03');
}
// ---------- C04/C05 真实 MVU 状态卡 ----------
let complex = null;
async function queueReplies(...replies) {
    if (MANAGED && replies.length !== 1) throw new Error('受管 fixture 每次设置单个确定响应');
    const r = await fetch(`${MOCK_URL}/${MANAGED ? '__ctl' : '__replies'}`, { method: 'POST', body: JSON.stringify(MANAGED ? { overrides: { '*': { text: replies[0] } } } : replies) });
    if (!r.ok) throw new Error(`mock replies HTTP ${r.status}`);
}
async function mvuState(page, messageId = -1) {
    return page.evaluate((i) => {
        if (!window.Mvu) return null;
        const d = Mvu.getMvuData({ type: 'message', message_id: i });
        const value = (k) => Array.isArray(d.stat_data?.[k]) ? d.stat_data[k][0] : d.stat_data?.[k];
        return { trust: value('trust'), scene: value('scene'), discussed: value('discussed_book') };
    }, messageId);
}
async function expectTrust(page, trust, messageId = -1) {
    await poll(async () => { const s = await mvuState(page, messageId); return s?.trust === trust && s.scene === 'bookshop'; }, 25000, `MVU trust=${trust}`);
}
async function swipeReady(page) {
    await poll(() => page.evaluate(async () => (await import('/script.js')).isSwipingAllowed()), 15000, '原生 swipe 生命周期完成');
}
async function reloadComplex(page) {
    await page.reload({ waitUntil: 'domcontentloaded' }); await uiReady(page);
    await selectCharacter(page, complex.name); await connectMock(page);
    await poll(() => page.evaluate(() => !!window.Mvu), 30000, 'MVU 初始化');
}
async function panelTrust(page, messageId, expected) {
    const frame = page.frameLocator(`#chat .mes[mesid="${messageId}"] .mes_text iframe`).first();
    await frame.locator('#read-state').click({ timeout: 20000 });
    await poll(async () => (await frame.locator('#trust').innerText()) === String(expected), 10000, '真实状态栏按钮读数');
}
async function persistedTrust(page, messageId, expected) {
    const id = await page.evaluate(() => SillyTavern.getContext().getCurrentChatId());
    const file = path.join(USER_DIR, 'chats', path.basename(complex.avatar, '.png'), `${id}.jsonl`);
    await poll(() => {
        if (!fs.existsSync(file)) return false;
        const m = fs.readFileSync(file, 'utf8').trim().split('\n').map((x) => JSON.parse(x))[messageId + 1];
        const v = m?.variables?.[m.swipe_id ?? 0]?.stat_data?.trust;
        return (Array.isArray(v) ? v[0] : v) === expected;
    }, 20000, '原生 JSONL 状态落盘');
}
async function caseC04(page) {
    beginCase('C04', '真实 Helper iframe / EJS / MVU：初始化、更新、上下文、刷新');
    const name = `澄夏C04${RUN}`, book = `蓝窗书店C04${RUN}`;
    const file = path.join(FIX, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(complexCard(name, book), null, 2));
    let ok = await step('C04.1 原生导入，启用可信合成脚本与显示正则', true, async () => {
        const c = await importCharacterFile(page, file, name); complex = { name, ...c };
        await selectCharacter(page, name); await importEmbeddedBookAndBind(page, book, c.avatar);
        await page.evaluate((avatar) => {
            const c = SillyTavern.getContext(), es = c.extensionSettings;
            es.tavern_helper ??= {}; es.tavern_helper.script ??= {}; es.tavern_helper.script.enabled ??= {};
            const enabled = es.tavern_helper.script.enabled.characters ??= [];
            if (!enabled.includes(avatar)) enabled.push(avatar);
            es.character_allowed_regex ??= [];
            if (!es.character_allowed_regex.includes(avatar)) es.character_allowed_regex.push(avatar);
            c.saveSettingsDebounced();
        }, c.avatar);
        await poll(async () => { const s = (await persistedSettings(page)).extension_settings; return s.tavern_helper?.script?.enabled?.characters?.includes(c.avatar) === true && s.character_allowed_regex?.includes(c.avatar) === true; }, 20000, '脚本及正则启用落盘');
        await reloadComplex(page);
        return '真实锁定 MVU 自托管脚本加载；角色绑定世界书';
    });
    ok = await step('C04.2 初始化 10，真实 iframe 按钮读取当前楼层', ok, async () => {
        await expectTrust(page, 10, 0); await panelTrust(page, 0, 10); await persistedTrust(page, 0, 10);
        return JSON.stringify(await mvuState(page, 0));
    });
    ok = await step('C04.3 原生生成经过 MVU 解析更新为 15；显示隐藏协议，原文保留', ok, async () => {
        await queueReplies(complexReply(15));
        const result = await sendSolo(page, '聊聊书店里的旅行笔记。'); complex.replyId = result.replyIdx;
        await expectTrust(page, 15); await panelTrust(page, result.replyIdx, 15); await persistedTrust(page, result.replyIdx, 15);
        const raw = (await chatMes(page, result.replyIdx)).mes;
        const shown = await mesText(page, result.replyIdx);
        if (!raw.includes("_.set('trust', 15)") || shown.includes('_.set(')) throw new Error('正则显示/原文边界不符');
        const request = flat(result.capture);
        if (!request.includes('VC04_BOOK') || !request.includes(name) || /\{\{char\}\}|\{\{user\}\}|<%/.test(request) || request.includes('VC04_EJS_DISCUSS')) throw new Error('首轮宏、世界书或 EJS 条件不符');
        return 'trust=15；discussed_book=true；原始协议保留，显示层隐藏；首轮无条件片段';
    });
    ok = await step('C04.4 刷新重开保持 15；下一轮实际请求包含 EJS 条件片段', ok, async () => {
        await reloadComplex(page); await expectTrust(page, 15); await panelTrust(page, complex.replyId, 15);
        await queueReplies(complexReply(15)); const r = await sendSolo(page, '继续谈旅行笔记里的海边小镇。'); complex.replyId = r.replyIdx;
        const request = flat(r.capture);
        if (!request.includes('VC04_EJS_DISCUSS') || /<%|\{\{char\}\}|\{\{user\}\}/.test(request)) throw new Error('EJS 未按真实变量注入下一轮');
        await expectTrust(page, 15); await persistedTrust(page, r.replyIdx, 15);
        fs.writeFileSync(path.join(FIX, 'complex-card-export.json'), JSON.stringify(await exportCharacter(page, complex.avatar, 'json'), null, 2));
        return '刷新后状态与下一轮请求一致；已通过原生导出卡及内嵌世界书/正则/脚本引用';
    });
    complex.ready = ok;
    current.screenshot = await shot(page, 'C04-desktop');
}
async function caseC05(page) {
    beginCase('C05', '真实 swipe 状态与刷新隔离');
    let ok = await step('C05.1 原生右滑生成第二候选 8', complex?.ready === true, async () => {
        await queueReplies(complexReply(8)); await waitIdle(page);
        await page.locator('#chat .last_mes .swipe_right').click();
        await expectTrust(page, 8); await panelTrust(page, complex.replyId, 8); await persistedTrust(page, complex.replyId, 8);
        return '当前候选 trust=8，不在15上累加';
    });
    ok = await step('C05.2 刷新保持 8，原生左滑回 15，右滑回 8', ok, async () => {
        await reloadComplex(page); await expectTrust(page, 8);
        await swipeReady(page);
        await page.locator('#chat .last_mes .swipe_left').click(); await expectTrust(page, 15); await panelTrust(page, complex.replyId, 15);
        await swipeReady(page);
        await page.locator('#chat .last_mes .swipe_right').click(); await expectTrust(page, 8); await persistedTrust(page, complex.replyId, 8);
        return '原生候选与消息变量逐一对应';
    });
    ok = await step('C05.3 从 15 候选创建原生分支，与父聊天 8 候选隔离', ok, async () => {
        await swipeReady(page); await page.locator('#chat .last_mes .swipe_left').click(); await expectTrust(page, 15); await swipeReady(page);
        complex.parent = await page.evaluate(() => SillyTavern.getContext().getCurrentChatId());
        await runSlash(page, `/branch-create ${complex.replyId}`);
        await poll(() => page.evaluate((id) => SillyTavern.getContext().getCurrentChatId() !== id, complex.parent), 20000, '分支打开');
        complex.branch = await page.evaluate(() => SillyTavern.getContext().getCurrentChatId());
        await expectTrust(page, 15); await persistedTrust(page, complex.replyId, 15);
        await page.evaluate(async (id) => (await import('/script.js')).openCharacterChat(id), complex.parent);
        await swipeReady(page); await page.locator('#chat .last_mes .swipe_right').click(); await expectTrust(page, 8); await persistedTrust(page, complex.replyId, 8); await swipeReady(page);
        await page.evaluate(async (id) => (await import('/script.js')).openCharacterChat(id), complex.branch);
        await expectTrust(page, 15); await panelTrust(page, complex.replyId, 15);
        return '父聊天=8；分支=15；均原生保存且回开读回';
    });
    ok = await step('C05.4 编辑末条回复后使用 MVU 原生重算按钮，刷新保持 8', ok, async () => {
        await page.locator('#chat .last_mes .mes_edit').click();
        await page.locator('#chat .last_mes .edit_textarea').fill(complexReply(8));
        await page.locator('#chat .last_mes .mes_edit_done').click();
        await page.locator('.qr--button').filter({ hasText: '重新处理变量' }).click();
        await expectTrust(page, 8); await persistedTrust(page, complex.replyId, 8);
        await reloadComplex(page); await expectTrust(page, 8); await panelTrust(page, complex.replyId, 8);
        return '遵循上游显式重算语义；不声称历史编辑自动级联';
    });
    ok = await step('C05.5 原生重生成重新解析为 15', ok, async () => {
        await queueReplies(complexReply(15)); await waitIdle(page);
        await page.evaluate(() => document.querySelector('#option_regenerate').click());
        await expectTrust(page, 15); await persistedTrust(page, complex.replyId, 15); await panelTrust(page, complex.replyId, 15);
        return '重生成结果与当前候选状态一致';
    });
    ok = await step('C05.6 真实 MVU 异步更新暂停后切换聊天，迟到任务不得污染目标聊天', ok, async () => {
        await waitIdle(page);
        await page.evaluate(() => {
            const c = SillyTavern.getContext();
            window.__vcHold = { reached: false, released: false, finished: false };
            const buttons = Object.values(TavernHelper.getAllEnabledScriptButtons()).flat();
            const buttonId = buttons.find((b) => b.button_name === '重新处理变量').button_id;
            const originalEmit = c.eventSource.emit;
            c.eventSource.emit = function (event, ...args) {
                const result = originalEmit.call(this, event, ...args);
                if (event === buttonId) Promise.resolve(result).then(() => { window.__vcHold.finished = true; }, () => { window.__vcHold.finished = 'error'; });
                return result;
            };
            window.__vcRestoreEmit = () => { c.eventSource.emit = originalEmit; };
            c.eventSource.once(Mvu.events.VARIABLE_UPDATE_ENDED, async () => {
                window.__vcHold.reached = true;
                await new Promise((resolve) => { window.__vcRelease = resolve; });
                window.__vcHold.released = true;
            });
        });
        await page.locator('.qr--button').filter({ hasText: '重新处理变量' }).click();
        await poll(() => page.evaluate(() => window.__vcHold.reached), 10000, 'MVU 在真实 await 事件处暂停');
        await page.evaluate(async (id) => (await import('/script.js')).openCharacterChat(id), complex.parent);
        await expectTrust(page, 8);
        await page.evaluate(() => window.__vcRelease());
        await poll(() => page.evaluate(() => window.__vcHold.released), 10000, '旧异步任务释放');
        await poll(() => page.evaluate(() => window.__vcHold.finished === true), 10000, '原生按钮完整异步调用链结束');
        await page.evaluate(() => window.__vcRestoreEmit());
        await expectTrust(page, 8); await persistedTrust(page, complex.replyId, 8);
        await reloadComplex(page); await expectTrust(page, 8);
        return '旧15任务释放后目标聊天仍为8，刷新亦一致';
    });
    current.screenshot = await shot(page, 'C05-swipes');
}
async function caseUI02(page) {
    beginCase('UI02', 'W04 聊天导航与窄屏基础操作（真机另验）');
    let ok = await step('UI02.1 完整扩展加载，桌面导航与状态栏可用', MANAGED && complex?.ready === true, async () => {
        await page.locator('#vc-chat-nav').waitFor({ state: 'visible' });
        await panelTrust(page, complex.replyId, 8);
        current.screenshot = await shot(page, 'UI01-desktop');
        return '原生聊天 + 自有导航 + Go 投影 + 真实卡内 iframe 同时运行';
    });
    ok = await step('UI02.2 390/360 窄屏输入、状态栏和主要导航无横溢', ok, async () => {
        for (const width of [390, 360]) {
            await page.setViewportSize({ width, height: 844 });
            await page.locator('#vc-chat-nav').getByRole('button', { name: '聊天', exact: true }).click();
            await page.locator('#send_textarea').fill('尚未发送的窄屏草稿');
            const dims = await page.evaluate(() => {
                const r = (s) => { const e = document.querySelector(s), b = e.getBoundingClientRect(); return { x: b.x, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
                return { viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, input: r('#send_textarea'), send: r('#send_but'), nav: r('#vc-chat-nav'), font: parseFloat(getComputedStyle(document.querySelector('#send_textarea')).fontSize) };
            });
            if (dims.overflow || dims.input.right > width + 1 || dims.send.right > width + 1 || dims.send.width < 44 || dims.send.height < 44 || dims.font < 16) throw new Error(JSON.stringify(dims));
            await panelTrust(page, complex.replyId, 8);
            await shot(page, `UI02-${width}`);
        }
        await page.locator('#vc-chat-nav').getByRole('button', { name: '角色', exact: true }).click();
        await page.locator('#right-nav-panel').waitFor({ state: 'visible' });
        await page.locator('#rightNavDrawerIcon').click();
        await page.locator('#vc-chat-nav').getByRole('button', { name: '模型设置', exact: true }).click();
        await page.locator('.vcms-overlay').waitFor({ state: 'visible' });
        await page.getByRole('button', { name: '关闭模型设置', exact: true }).click();
        if (await page.locator('#send_textarea').inputValue() !== '尚未发送的窄屏草稿') throw new Error('导航丢失输入草稿');
        return '390/360 无横溢，主发送目标≥44px；角色抽屉/模型页开关保持草稿';
    });
    ok = await step('UI02.3 缩短视口保留输入，原生发送与停止仍可操作', ok, async () => {
        await page.setViewportSize({ width: 390, height: 450 });
        await page.locator('#send_textarea').focus();
        const bottom = await page.locator('#send_but').boundingBox();
        if (!bottom || bottom.y < 0 || bottom.y + bottom.height > 451) throw new Error('短视口发送控件不可达');
        await shot(page, 'UI02-short-viewport');
        await page.setViewportSize({ width: 390, height: 844 });
        await queueReplies(complexReply(15)); const result = await sendSolo(page, '手机窄屏继续聊旅行笔记。');
        await expectTrust(page, 15); await panelTrust(page, result.replyIdx, 15);
        await fetch(`${MOCK_URL}/__ctl`, { method: 'POST', body: JSON.stringify({ overrides: { '*': { text: '正在缓慢输出的合成台词。'.repeat(100), chunks: 100, delay: { firstMs: 20, perChunkMs: 100 } } } }) });
        await typeAndSend(page, '请慢一点回复，验证停止。');
        await page.locator('#mes_stop').waitFor({ state: 'visible' });
        await page.locator('#mes_stop').click(); await waitIdle(page);
        await page.locator('#send_textarea').fill('停止后可继续输入');
        await shot(page, 'UI02-stopped');
        return '短视口输入/发送可达；390px 原生发送、真实流停止与继续输入通过；软键盘和真机NOT_RUN';
    });
}
// ---------- C06 CHARX ----------
function findFiles(root, name) {
    const out = []; if (!fs.existsSync(root)) return out;
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === name) out.push(p); } };
    walk(root); return out;
}
async function caseC06(page) {
    beginCase('C06', 'CHARX：原生导入自有资源（icon / background / misc），不承诺原生没有的无损 CHARX 导出');
    const N = `VC06${RUN}`;
    const icon = makePng({ width: 40, height: 40, rgba: [60, 180, 90, 255] });
    const bg = makePng({ width: 48, height: 24, rgba: [30, 60, 120, 255] });
    const misc = makePng({ width: 20, height: 36, rgba: [220, 200, 40, 255] });
    const v2 = cardV2({ name: N, description: 'VC06_DESC 原创合成角色（CHARX）。', first_mes: 'VC06_FIRST 你好。', extensions: { vc_meta: { run: RUN, kind: 'c06' } } });
    const v3 = cardV3(v2, [
        { type: 'icon', uri: 'embeded://assets/icon/main.png', name: 'main', ext: 'png' },
        { type: 'background', uri: 'embeded://assets/background/vcbg.png', name: 'vcbg', ext: 'png' },
        { type: 'x_vc_misc', uri: 'embeded://assets/other/vcmisc.png', name: 'vcmisc', ext: 'png' },
    ]);
    const zip = makeStoredZip([
        { name: 'card.json', data: Buffer.from(JSON.stringify(v3, null, 2), 'utf8') },
        { name: 'assets/icon/main.png', data: icon }, { name: 'assets/background/vcbg.png', data: bg }, { name: 'assets/other/vcmisc.png', data: misc },
    ]);
    const file = path.join(FIX, `${N}.charx`); fs.writeFileSync(file, zip, { mode: 0o600 });

    let info;
    let ok = await step('C06.1 原生导入 .charx：角色出现，avatar 为 icon/main（40x40），chara 块含卡字段', true, async () => {
        info = await importCharacterFile(page, file, N);
        const buf = fs.readFileSync(path.join(USER_DIR, 'characters', info.avatar));
        const size = pngSize(buf); const chara = readCharaChunk(buf);
        const got = { size40: size?.width === 40 && size?.height === 40, name: chara?.data?.name === N, first_mes: chara?.data?.first_mes === v2.data.first_mes, meta: chara?.data?.extensions?.vc_meta?.kind === 'c06', assetsField: Array.isArray(chara?.data?.assets) ? chara.data.assets.length : 'absent' };
        if (!(got.size40 && got.name && got.first_mes && got.meta)) throw new Error(JSON.stringify(got));
        return `avatar=${info.avatar} ${JSON.stringify(got)}（assets 字段是否保留仅记录）`;
    });
    ok = await step('C06.2 背景资源落位 characters/<角色>/backgrounds/vcbg.png，字节与输入一致', ok, async () => {
        let hits; await poll(() => { hits = findFiles(path.join(USER_DIR, 'characters'), 'vcbg.png').filter((p) => p.includes(`${path.sep}backgrounds${path.sep}`)); return hits.length >= 1; }, 15000, 'vcbg.png 出现');
        const mine = hits.filter((p) => sha256(fs.readFileSync(p)) === sha256(bg));
        if (!mine.length) throw new Error(`找到 ${hits.length} 个 vcbg.png 但字节均不一致`);
        return path.relative(USER_DIR, mine[0]);
    });
    ok = await step('C06.3 misc 资源落位 user/images/<角色>/vcmisc.png，字节与输入一致', ok, async () => {
        let hits; await poll(() => { hits = findFiles(path.join(USER_DIR, 'user', 'images'), 'vcmisc.png'); return hits.length >= 1; }, 15000, 'vcmisc.png 出现');
        const mine = hits.filter((p) => sha256(fs.readFileSync(p)) === sha256(misc));
        if (!mine.length) throw new Error(`找到 ${hits.length} 个 vcmisc.png 但字节均不一致`);
        return path.relative(USER_DIR, mine[0]);
    });
    await step('C06.4 打开角色：开场可见；原生 JSON 导出保留字段', ok, async () => {
        await selectCharacter(page, N);
        const ex = await exportCharacter(page, info.avatar, 'json');
        const got = { first: ex.data?.first_mes === v2.data.first_mes, meta: ex.data?.extensions?.vc_meta?.kind === 'c06', dom: !!(await mesText(page, 0)) };
        if (Object.values(got).some((v) => !v)) throw new Error(JSON.stringify(got));
        return JSON.stringify(got);
    });
    note('C06.5 CHARX 无损导出', 'NOT_APPLICABLE', 'ST 1.19.0 /api/characters/export 仅支持 png / json（src/endpoints/characters.js:1658），原生无 CHARX 导出；按 VER C06 不承诺、不自造');
    current.screenshot = await shot(page, 'C06');
}
// ---------- C07 原生群聊 ----------
const groupSnapshot = (page, from) => ctxEval(page, (n) => { const c = window.SillyTavern.getContext(); const s = document.querySelector('#mes_stop'); return { len: c.chat.length, idle: !s || getComputedStyle(s).display === 'none', added: c.chat.slice(n).map((m) => ({ is_user: m.is_user, name: m.name, len: m.mes.length, original_avatar: m.original_avatar ?? null })) }; }, from);
const runSlash = (page, cmd) => ctxEval(page, (c) => { const ctx = window.SillyTavern.getContext(); const p = typeof ctx.executeSlashCommandsWithOptions === 'function' ? ctx.executeSlashCommandsWithOptions(c) : globalThis.TavernHelper.triggerSlash(c); Promise.resolve(p).catch((e) => { window.__vcSlashErr = String(e?.message || e); }); return true; }, cmd);
const slashError = (page) => ctxEval(page, () => { const e = window.__vcSlashErr || null; window.__vcSlashErr = null; return e; });
async function caseC07(page) {
    beginCase('C07', '原生群聊：指定发言、回复策略、停止和角色身份');
    const A = `VC07A${RUN}`, B = `VC07B${RUN}`, G = `VC07G${RUN}`;
    const mk = (n, d) => { const f = path.join(FIX, `${n}.json`); fs.writeFileSync(f, JSON.stringify(cardV2({ name: n, description: d, first_mes: `${n} 的开场。`, extensions: { vc_meta: { run: RUN, kind: 'c07' } } })), { mode: 0o600 }); return f; };
    const fA = mk(A, 'VC07A_DESC 原创合成成员甲。'), fB = mk(B, 'VC07B_DESC 原创合成成员乙。');
    let avA, avB, fullLen = 0, order = [];
    const DESC = { [A]: 'VC07A_DESC', [B]: 'VC07B_DESC' };
    const avatarOf = (n) => (n === A ? avA : avB);
    /** 某次请求只含指定成员的描述、不含另一成员的描述（SWAP 模式角色身份隔离）。 */
    const onlyDesc = (cap, who) => { const s = flat(cap); return s.includes(DESC[who]) && !s.includes(DESC[who === A ? B : A]); };
    let ok = await step('C07.1 导入两名成员并经原生面板建群（策略=手动，生成模式=swap），groups/<id>.json 落盘', true, async () => {
        avA = (await importCharacterFile(page, fA, A)).avatar; mark('import A done'); avB = (await importCharacterFile(page, fB, B)).avatar; mark('import B done');
        await ctxEval(page, () => $('#rm_button_group_chats').trigger('click'));
        // 右侧抽屉可能收起（祖先 display:none 使 jQuery :visible 为假），只看面板自身 display 与候选列表是否已渲染
        await poll(() => ctxEval(page, () => { const b = document.querySelector('#rm_group_chats_block'); return !!b && getComputedStyle(b).display !== 'none' && document.querySelectorAll('#rm_group_add_members .group_member').length > 0; }), 15000, '建群面板');
        for (const n of [A, B]) {
            // 候选列表分页默认 5 条（group-chats.js:1619），用原生搜索框过滤到目标成员再点"加入"
            await ctxEval(page, (name) => $('#rm_group_filter').val(name).trigger('input'), n);
            const idx = await ctxEval(page, (name) => window.SillyTavern.getContext().characters.findIndex((x) => x.name === name), n);
            await poll(() => ctxEval(page, (i) => !!document.querySelector(`#rm_group_add_members .group_member[data-chid="${i}"] .right_menu_button[data-action="add"]`), idx), 10000, `${n} 出现在候选列表`);
            await ctxEval(page, (i) => document.querySelector(`#rm_group_add_members .group_member[data-chid="${i}"] .right_menu_button[data-action="add"]`).click(), idx);
            await poll(() => ctxEval(page, (i) => !!document.querySelector(`#rm_group_members .group_member[data-chid="${i}"]`), idx), 10000, `${n} 进入成员列表`);
        }
        await ctxEval(page, () => $('#rm_group_filter').val('').trigger('input'));
        await ctxEval(page, (g) => { $('#rm_group_chat_name').val(g); $('#rm_group_activation_strategy').val('2').trigger('change'); $('#rm_group_generation_mode').val('0').trigger('change'); }, G);
        await ctxEval(page, () => document.querySelector('#rm_group_submit').click()); mark('group submit clicked');
        // createGroup 成功后只 select_rm_info 显示创建信息，不打开聊天（group-chats.js:2131）；用原生 /go <群名> 打开（slash-commands.js:5099 支持群）
        await poll(() => ctxEval(page, (g) => (window.SillyTavern.getContext().groups || []).some((x) => x.name === g), G), 30000, '群聊出现在 groups');
        const grp = await ctxEval(page, (g) => { const x = window.SillyTavern.getContext().groups.find((x) => x.name === g); return { id: x.id, members: x.members, strategy: x.activation_strategy, mode: x.generation_mode }; }, G);
        await poll(() => fs.existsSync(path.join(USER_DIR, 'groups', `${grp.id}.json`)), 10000, 'groups/<id>.json 落盘');
        await runSlash(page, `/go ${G}`); mark('/go sent');
        await poll(() => ctxEval(page, (id) => { const c = window.SillyTavern.getContext(); const g = c.groups.find((x) => x.id === id); return c.groupId === id && !!g && c.getCurrentChatId() === g.chat_id && document.querySelectorAll('#chat .mes').length === c.chat.length; }, grp.id), 30000, '群聊打开且消息加载完成');
        await waitIdle(page, '群聊打开后空闲');
        const goErr = await slashError(page); if (goErr) throw new Error(`/go 报错：${goErr}`);
        if ([...grp.members].sort().join() !== [avA, avB].sort().join() || grp.strategy !== 2 || grp.mode !== 0) throw new Error(JSON.stringify(grp));
        order = grp.members.map((av) => (av === avA ? A : B));
        return `group id=${grp.id} members(持久化顺序)=[${order.join(',')}] strategy=MANUAL mode=SWAP；/go 打开`;
    });
    ok = await step('C07.2 指定发言：/trigger 乙 → 仅乙回复，请求含乙描述不含甲描述，消息身份（name / original_avatar）为乙', ok, async () => {
        const since = await mockClear(); await waitIdle(page); const n0 = await chatLen(page);
        await runSlash(page, `/trigger await=true ${B}`);
        await poll(async () => { const err = await slashError(page); if (err) throw new Error(`/trigger 报错：${err}`); return ctxEval(page, (p) => { const c = window.SillyTavern.getContext(); const m = c.chat[p.n]; const s = document.querySelector('#mes_stop'); return c.chat.length === p.n + 1 && !!m && !m.is_user && m.mes.includes(p.mark) && (!s || getComputedStyle(s).display === 'none'); }, { n: n0, mark: REPLY_MARK }); }, 60000, '乙回复完整');
        const caps = await waitCaptures(since, 1); const m = await chatMes(page, n0); fullLen = m.mes.length;
        const got = { caps: caps.length, onlyB: onlyDesc(caps[0], B), name: m.name === B, avatar: m.original_avatar === avB, authMatched: caps[0].authMatched };
        if (!(got.caps === 1 && got.onlyB && got.name && got.avatar && got.authMatched)) throw new Error(JSON.stringify(got));
        return JSON.stringify(got);
    });
    ok = await step('C07.3 回复策略=手动：用户发言后无自动回复（3s 内 0 请求、无新消息）', ok, async () => {
        const since = await mockClear(); const n0 = await chatLen(page);
        await typeAndSend(page, '手动策略下的用户消息。');
        await poll(() => ctxEval(page, (n) => { const c = window.SillyTavern.getContext().chat; return c.length === n + 1 && c[n].is_user === true; }, n0), 10000, '用户消息入链');
        await sleep(3000);
        const snap = await groupSnapshot(page, n0); const caps = await mockChatCaptures(since);
        if (snap.len !== n0 + 1 || caps.length !== 0 || !snap.idle) throw new Error(JSON.stringify({ len: snap.len, expect: n0 + 1, caps: caps.length, idle: snap.idle }));
        return `chat +1（仅用户）captures=0 idle=${snap.idle}`;
    });
    ok = await step('C07.4 回复策略=列表顺序：切换后用户发言 → 成员按持久化顺序依次回复，各自请求只含本人描述', ok, async () => {
        await ctxEval(page, () => $('#rm_group_activation_strategy').val('1').trigger('change'));
        await poll(() => ctxEval(page, (g) => window.SillyTavern.getContext().groups.find((x) => x.name === g)?.activation_strategy === 1, G), 10000, '策略=LIST');
        const since = await mockClear(); const n0 = await chatLen(page);
        await typeAndSend(page, '列表策略下的用户消息。');
        await poll(() => ctxEval(page, (p) => { const c = window.SillyTavern.getContext(); const s = document.querySelector('#mes_stop'); return c.chat.length === p.n + 3 && c.chat.slice(p.n + 1).every((m) => !m.is_user && m.mes.includes(p.mark)) && (!s || getComputedStyle(s).display === 'none'); }, { n: n0, mark: REPLY_MARK }), 90000, '两条成员回复完整');
        const caps = await waitCaptures(since, 2); const snap = await groupSnapshot(page, n0 + 1);
        const got = { caps: caps.length, expectOrder: order, names: snap.added.map((m) => m.name), avatarsOk: snap.added.every((m, i) => m.original_avatar === avatarOf(order[i])), cap0: onlyDesc(caps[0], order[0]), cap1: onlyDesc(caps[1], order[1]) };
        if (!(got.caps === 2 && got.names.join() === order.join() && got.avatarsOk && got.cap0 && got.cap1)) throw new Error(JSON.stringify(got));
        return JSON.stringify(got);
    });
    await step('C07.5 停止：慢速模型下用户发言 → 首位成员开始流式后点击停止 → 其消息截断、次位成员不发言、仅 1 次请求', ok, async () => {
        await ctxEval(page, (m) => $('#custom_model_id').val(m).trigger('input').trigger('change'), SLOW_MODEL);
        await poll(() => ctxEval(page, (m) => window.SillyTavern.getContext().chatCompletionSettings?.custom_model === m, SLOW_MODEL), 5000, '切到慢速模型');
        const since = await mockClear(); const n0 = await chatLen(page);
        try {
            await typeAndSend(page, '停止用例的用户消息。');
            await poll(() => ctxEval(page, (n) => { const m = window.SillyTavern.getContext().chat[n + 1]; return !!m && !m.is_user && m.mes.length > 0; }, n0), 30000, '首位成员开始流式输出');
            await ctxEval(page, () => document.querySelector('#mes_stop').click());
            await poll(() => ctxEval(page, () => { const s = document.querySelector('#mes_stop'); const b = document.querySelector('#send_but'); return (!s || getComputedStyle(s).display === 'none') && !!b && getComputedStyle(b).display !== 'none'; }), 20000, '生成停止、发送按钮恢复');
            await sleep(2500);
            const snap = await groupSnapshot(page, n0 + 1); const caps = await mockChatCaptures(since);
            const got = { added: snap.added.length, name: snap.added[0]?.name, expectFirst: order[0], len: snap.added[0]?.len, fullLen, caps: caps.length, model: caps[0]?.model, capOnlyFirst: caps[0] ? onlyDesc(caps[0], order[0]) : false };
            if (!(got.added === 1 && got.name === order[0] && got.len > 0 && got.len < fullLen && got.caps === 1 && got.model === SLOW_MODEL && got.capOnlyFirst)) throw new Error(JSON.stringify(got));
            return JSON.stringify(got);
        } finally {
            await ctxEval(page, (m) => $('#custom_model_id').val(m).trigger('input').trigger('change'), MOCK_MODEL);
        }
    });
    current.screenshot = await shot(page, 'C07');
}
// ---------- main ----------
async function main() {
    process.umask(0o077);
    const pre = await preflight();
    mkdirp(ART, 0o700); mkdirp(FIX, 0o700);
    const result = {
        run: RUN, ranAt: new Date().toISOString(), st: pre.st, mock: pre.mock, browser: pre.browser,
        provider: `local-mock http://127.0.0.1:${MOCK_PORT}（固定回复，不是真实模型）`, real_model: 'NOT_RUN', target_mobile: 'NOT_RUN',
        error_notes: [
            'ST 自身缺陷（不阻断功能）：建群/导入后的高亮等待 select_rm_info（script.js:8719-8742）把 waitUntilCondition(…).then(…) 放在 try/catch 内但缺 .catch，1s 内角色列表重渲染未出现目标元素即产生未处理拒绝 "Timed out waiting for condition to be true"（utils.js:1941）。触发动作是 C07.1 点击原生 #rm_group_submit，错误约 1.3s 后抛出、常落入后续步骤窗口；高亮失败不影响建群/打开/发言（各步骤断言为独立正证据）。',
            'C07.5 点击 #mes_stop 的预期后果：stopGeneration abort → generateGroupWrapper 的 throwIfAborted（group-chats.js:948）按设计抛 "AbortSignal was fired. Group generation stopped" 终止剩余成员；promise 链顶端（#send_but click 的 async handler）无 catch，故以 pageError 形式出现。该错误正是停止用例成功的伴生证据。',
            '预设应用后的连接复检：getStatusOpen()（openai.js:4520 起）的 /api/backends/chat-completions/status fetch 被新校验中止时，其 catch 在 openai.js:4565 记录 console.error "AbortReason"（多次并行校验一次性中止即出现多条）。终态连接状态为 Valid（步骤断言覆盖），不影响任何验收结果。',
        ],
        cases, consoleErrors, pageErrors,
    };
    const finish = (code) => { fs.writeFileSync(path.join(ART, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 }); console.log(`\n== 结果 → ${path.join(ART, 'result.json')}`); process.exit(code); };
    if (pre.blockers.length) { result.status = 'BLOCKED'; result.blockers = pre.blockers; console.error(`BLOCKED\n  ${pre.blockers.join('\n  ')}`); finish(4); }

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: pre.browser, headless: true });
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'zh-CN',
        ...(process.env.VC_ST_ACCEPT_STORAGE_STATE ? { storageState: process.env.VC_ST_ACCEPT_STORAGE_STATE } : {}) })).newPage();
    page.on('console', (m) => { if (m.type() === 'error' && consoleErrors.length < 30) { const l = m.location(); consoleErrors.push({ t: tms(), text: m.text().slice(0, 240), at: l?.url ? `${l.url.replace(ST_URL, '')}:${l.lineNumber}:${l.columnNumber}` : null, during: current?.running ?? current?.id ?? null }); } });
    page.on('pageerror', (e) => { if (pageErrors.length < 30) pageErrors.push({ t: tms(), message: String(e?.message || e).slice(0, 240), stack: String(e?.stack || '').split('\n').slice(0, 8).map((s) => s.trim().replace(ST_URL, '')).join(' | ').slice(0, 900), during: current?.running ?? current?.id ?? null }); });
    const only = (() => { const i = process.argv.indexOf('--only'); return i >= 0 ? String(process.argv[i + 1] || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null; })();
    if (only) result.only = only;
    try {
        beginCase('C00', '前置：打开 ST、前端与 Helper 就绪、连接本地固定 provider');
        let connected = await step('C00.1 打开 ST 并等待前端 / Helper 就绪', true, async () => {
            const r = await page.goto(ST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            if (r?.status() !== 200) throw new Error(`HTTP ${r?.status()}`);
            await uiReady(page); await clickPopup(page, /^OK$|^好$|^确定$|关闭/, 5000);
            return `ST ${pre.st.pkgVersion}（${pre.st.gitRevision}）`;
        });
        connected = await step('C00.2 Chat Completion → Custom 指向 mock（UI / 模块 / 服务端三层读回 + onlineStatus）', connected, () => connectMock(page));
        if (connected && only?.includes('UI02') && !only.includes('C04') && process.env.VC_ST_ACCEPT_CHARACTER) {
            const name = process.env.VC_ST_ACCEPT_CHARACTER;
            await selectCharacter(page, name);
            const previous = await page.evaluate(() => {
                const c = SillyTavern.getContext(), ch = c.characters[c.characterId];
                if (ch.data?.extensions?.vc_fixture?.synthetic !== true) throw new Error('只允许复用明确标记的合成卡');
                return { avatar: ch.avatar, replyId: c.chat.length - 1 };
            });
            complex = { name, ...previous, ready: true };
            await expectTrust(page, 8);
        }
        for (const fn of [caseC01, caseC02, caseC03, caseC04, caseC05, caseC06, caseC07, caseUI02]) {
            const id = fn.name.replace('case', '');
            if (id === 'UI02' && !only?.includes('UI02')) continue;
            if (only && !only.includes(id)) continue;
            if (!connected) { beginCase(id, '依赖 C00 前置连接'); record('前置未通过', 'NOT_RUN', 'C00 失败'); continue; }
            try { await fn(page); } catch (e) {
                record(`${fn.name} 异常中断`, 'FAIL', (e?.stack || String(e)).split('\n').slice(0, 3).join(' | '));
                try { current.screenshot = await shot(page, `${current.id}-error`); } catch { /* 截图失败不影响结果 */ }
            }
        }
    } finally {
        await browser.close().catch(() => {});
        result.summary = cases.reduce((m, c) => ((m[c.status] = (m[c.status] || 0) + 1), m), {});
        const fails = cases.filter((c) => c.status === 'FAIL').length;
        result.status = fails ? 'FAIL' : (cases.some((c) => c.status === 'NOT_RUN') ? 'NOT_RUN' : 'PASS');
        console.log(`\n== 用例：${cases.map((c) => `${c.id}=${c.status}`).join('  ')}；console errors=${consoleErrors.length} page errors=${pageErrors.length}`);
        finish(fails ? 1 : 0);
    }
}
main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
