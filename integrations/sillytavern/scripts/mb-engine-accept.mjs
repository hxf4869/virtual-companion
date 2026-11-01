// MB-3 引擎适配层：真实 /m/ 页面 + 适配模块驱动隐藏 ST（ADR-0011 §1–2、MB-0 报告第 3 节）。
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README；ADR-0009 §3）。
// 前提：已运行 `npm --prefix mobile run build:h5`。页面以 ?vcdebug=1 打开，取得 globalThis.__vcEngine。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeStOnboarding } from './lib/st-onboarding.mjs';
import { complexCard } from './lib/complex-card.mjs';
import { createStClient } from './managed-lib.mjs';
import { ownerBudgetResetSql } from './lib/owner-budget.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEV = process.env.VC_W03_DEV_DIR || path.resolve(HERE, '../dev-managed');
const SHOTS = path.resolve(HERE, '../../../.review-queue/MB-3');
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

function importJson(st, card) {
    const form = new FormData();
    form.append('file_type', 'json');
    form.append('avatar', new Blob([JSON.stringify(card)], { type: 'application/json' }), 'synthetic.json');
    return st.call('POST', '/api/characters/import', form);
}

async function until(fn, ms, label) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 150)); }
    throw new Error(`等待超时：${label}`);
}

export async function sceneMbEngine(ctx) {
    if (!fs.existsSync(path.join(DEV, 'st-run', 'plugins', 'virtual-companion', 'mobile-dist', 'index.html'))) {
        throw new Error('受管插件缺少 mobile-dist：先运行 npm --prefix mobile run build:h5 再装配');
    }
    fs.mkdirSync(SHOTS, { recursive: true });
    await reauthForWrite(ctx);
    const purposes = await ctx.admin.listPurposes();
    const row = purposes.json?.find((item) => item.purpose === 'FOREGROUND_CHAT');
    const bound = await ctx.admin.savePurpose('FOREGROUND_CHAT', { providerId: 'vc03m-chat', profileKey: 'chat', state: 'ENABLED', expectedRevision: row.revision });
    if (bound.status !== 200) throw new Error(`前台绑定 HTTP ${bound.status}`);
    ctx.w10.psql(ownerBudgetResetSql(ctx.w05.ownerId));
    const s = ctx.secrets.session;
    const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: s, extraCookies: `vc_session=${s.vcSession}; vc_csrf=${s.vcCsrf}` });
    const name = `MB3 ${crypto.randomUUID().slice(0, 6)}`;
    const imported = await importJson(st, { name, description: '合成卡，只供 MB-3。', first_mes: '你好。', personality: '', scenario: '', mes_example: '' });
    if (imported.status !== 200) throw new Error(`导入合成卡 HTTP ${imported.status}`);
    const avatar = `${imported.json.file_name.replace(/\.png$/, '')}.png`;
    const file = `MB3-${crypto.randomUUID()}`;
    const rows = Array.from({ length: 12 }, (_, i) => ({ name: i % 2 ? name : 'owner', is_user: i % 2 === 0, mes: `合成历史 ${i + 1}。`, send_date: new Date(Date.now() - (12 - i) * 60000).toISOString() }));
    const saved = await st.call('POST', '/api/chats/save', { avatar_url: avatar, file_name: file,
        chat: [{ user_name: 'unused', character_name: name, chat_metadata: { vc_f2: { id: crypto.randomUUID(), revision: 0 }, vc_binding: { mode: 'COMPANION', displayName: '合成实例' } } }, ...rows] });
    if (saved.status !== 200) throw new Error(`保存聊天 HTTP ${saved.status}`);
    const complex = await importJson(st, complexCard(`澄夏MB3${crypto.randomUUID().slice(0, 6)}`, `蓝窗MB3${crypto.randomUUID().slice(0, 6)}`));
    if (complex.status !== 200) throw new Error(`导入复杂卡 HTTP ${complex.status}`);
    const complexAvatar = `${complex.json.file_name.replace(/\.png$/, '')}.png`;

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    const origin = new URL(ctx.w05.stBase).origin;
    const reply = (text, chunks = 5, perChunkMs = 40) => ctx.fixtureHttp.setOverride('vc03m-chat', { text, chunks, delay: { firstMs: 50, perChunkMs } });
    const fail = [];
    const check = (ok, label, detail = '') => { console.log(`[mb-engine] ${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`); if (!ok) fail.push(label); };
    try {
        const bc = await browser.newContext(PHONE);
        await bc.addCookies([{ name: 'vc_session', value: s.vcSession, url: ctx.w05.stBase }, { name: 'vc_csrf', value: s.vcCsrf, url: ctx.w05.stBase }]);
        await completeStOnboarding(bc, ctx.w05.stBase);
        const page = await bc.newPage();
        page.setDefaultTimeout(120000);
        const foreign = [];
        page.on('request', (r) => { const u = r.url(); if (r.frame() === page.mainFrame() && /^https?:/.test(u) && new URL(u).origin !== origin) foreign.push(u.slice(0, 80)); });
        const E = (fn, arg) => page.evaluate(fn, arg);
        await page.goto(`${ctx.w05.stBase}/m/?vcdebug=1`);
        await page.waitForFunction(() => document.documentElement.dataset.vcEngine === 'ready', null, { timeout: 180000 });
        const hidden = await E(() => { const f = document.querySelector('#vc-engine'); const cs = getComputedStyle(f); const d = f.contentDocument; return { opacity: cs.opacity, pe: cs.pointerEvents, aria: f.getAttribute('aria-hidden'), last: globalThis.__vcEngine.lastPopup, popup: [...d.querySelectorAll('dialog.popup[open], dialog[open]')].map((x) => (x.className + ':' + (x.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120))) }; });
        check(hidden.opacity === '0' && hidden.pe === 'none' && hidden.aria === 'true', '引擎就绪且隐藏', JSON.stringify(hidden));


        await E(([a, f]) => globalThis.__vcEngine.open(a, f), [avatar, file]);
        await E(() => { globalThis.__mbTokens = 0; globalThis.__vcEngine.on('token', () => { globalThis.__mbTokens += 1; }); });
        await reply('测试回复：第一条流式回答。');
        let before = await E((t) => globalThis.__vcEngine.send(t), '测试：你好');
        await E((b) => globalThis.__vcEngine.waitEnded(b), before);
        let msgs = await E(() => globalThis.__vcEngine.messages());
        check(msgs.at(-1).text.includes('第一条流式回答') && msgs.at(-2).user && await E(() => globalThis.__mbTokens) > 1, '发送与流式事件');

        await reply('测试回复：' + '很长的内容。'.repeat(40), 40, 150);
        await E(() => { globalThis.__mbTokens = 0; });
        await E((t) => globalThis.__vcEngine.send(t), '测试：讲个长的');
        await until(() => E(() => globalThis.__mbTokens >= 3), 30000, '长回复开始');
        await E(() => globalThis.__vcEngine.stop());
        await page.waitForTimeout(1500);
        msgs = await E(() => globalThis.__vcEngine.messages());
        check(!msgs.at(-1).user && msgs.at(-1).text.length > 0 && msgs.at(-1).text.length < 245, '停止保留已生成部分', `len=${msgs.at(-1).text.length}`);

        await reply('测试回复：重新生成的回答。');
        before = await E(() => globalThis.__vcEngine.regenerate());
        await E((b) => globalThis.__vcEngine.waitEnded(b), before);
        await reply('测试回复：新的候选。');
        before = await E(() => globalThis.__vcEngine.swipe('right'));
        await E((b) => globalThis.__vcEngine.waitEnded(b), before);
        msgs = await E(() => globalThis.__vcEngine.messages());
        const two = msgs.at(-1).swipes >= 2 && msgs.at(-1).text.includes('新的候选');
        await E(() => globalThis.__vcEngine.swipe('left'));
        await until(() => E(() => globalThis.__vcEngine.messages().at(-1).swipe === 0), 10000, '切回候选').catch(() => {});
        msgs = await E(() => globalThis.__vcEngine.messages());
        check(two && msgs.at(-1).text.includes('重新生成的回答'), '重新生成与候选切换');

        const userId = msgs.map((m) => m.user).lastIndexOf(true);
        await E(([i, t]) => globalThis.__vcEngine.edit(i, t), [userId, '测试：改过的话']);
        const lenBefore = msgs.length;
        await E((i) => globalThis.__vcEngine.remove(i), lenBefore - 1);
        const chatId = await E(() => globalThis.__vcEngine.chatId());
        let server = [];
        for (let k = 0; k < 25; k += 1) {
            const r = await st.call('POST', '/api/chats/get', { ch_name: name, file_name: chatId, avatar_url: avatar });
            server = (r.json || []).slice(1);
            if (server.length === lenBefore - 1) break;
            await page.waitForTimeout(200);
        }
        msgs = await E(() => globalThis.__vcEngine.messages());
        check(server[userId]?.mes === '测试：改过的话' && server.length === msgs.length
            && JSON.stringify(server.map((m) => m.mes)) === JSON.stringify(msgs.map((m) => m.text)), '编辑删除落盘且只有一份聊天', `engine=${msgs.length} server=${server.length}`);

        // 首次打开带内嵌世界书的卡：宿主弹窗被接管，自动切到 ST 视图，返回按钮可关闭。
        await E((a) => { globalThis.__vcEngine.open(a, '').catch(() => {}); }, complexAvatar);
        await page.waitForFunction(() => document.querySelector('#vc-engine')?.classList.contains('is-shown'), null, { timeout: 30000 }).catch(() => {});
        const shown = await E(() => ({ shown: document.querySelector('#vc-engine').classList.contains('is-shown'), back: Boolean(document.querySelector('.vc-stview-bar')) }));
        await page.screenshot({ path: path.join(SHOTS, 'popup-st-view-390.png') });
        check(shown.shown && shown.back, '宿主弹窗切到 ST 视图并提供返回', JSON.stringify(shown));
        // 合成复杂卡会先询问正则许可，再询问内嵌世界书；DISPLAY 弹窗里的隐藏按钮不是确认入口。
        for (let i = 0; i < 10; i += 1) {
            const accept = page.frameLocator('#vc-engine').locator('dialog.popup[open]').last().locator('.popup-button-ok:visible, .popup-button-custom:visible').filter({ hasText: /^(Yes|OK|是|确定|导入)$/ }).first();
            if (await accept.count()) await accept.click({ timeout: 3000 });
            await page.waitForTimeout(200);
        }
        await page.locator('.vc-stview-bar [aria-label="返回"]').click();
        await page.waitForTimeout(500);
        check(!(await E(() => document.querySelector('#vc-engine').classList.contains('is-shown'))), '返回后 ST 视图关闭');

        // 主题设置：存服务器（ST 扩展设置），刷新后由引擎读回并生效。
        await E(() => globalThis.__vcEngine.saveThemeSettings({ mode: 'dark' }));
        await E(() => localStorage.removeItem('vc-mobile-theme'));
        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.vcEngine === 'ready', null, { timeout: 180000 });
        await page.waitForFunction(() => document.documentElement.dataset.vcTheme === 'dark', null, { timeout: 10000 }).catch(() => {});
        check(await E(() => document.documentElement.dataset.vcTheme) === 'dark', '主题设置存服务器并读回');
        await E(() => globalThis.__vcEngine.saveThemeSettings({ mode: 'auto' }));
        check(foreign.length === 0, '外壳零跨域请求', [...new Set(foreign)].join(' | '));
        await ctx.fixtureHttp.setOverride('vc03m-chat', null);
        await bc.close();
    } finally {
        await browser.close();
    }
    if (fail.length) throw new Error(`MB-3 未通过：${fail.join('、')}`);
}

export const mbEngineScene = {
    id: 'mb-engine',
    title: 'MB-3 引擎适配：真实 /m/ 驱动隐藏 ST 完成对话、弹窗接管、ST 视图与主题读回',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneMbEngine,
};
