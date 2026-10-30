import path from 'node:path';
import {
    waitFor,
} from './managed-lib.mjs';
import { pinVcUi } from './vc-ui-pin.mjs';
import { log, rt } from './lib/accept-runtime.mjs';
import { trackPageErrors } from './lib/page-errors.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import { providerCatalogSpec, readFixtureCapture } from './lib/accept-scene-helpers.mjs';

export async function sceneUi03Browser(ctx) {
    // 真实浏览器 UI03 验收（默认不在 --filter，主会话串联时执行）：
    //   注入合成 Go 会话 cookie → 打开 ST → 真实 DOM 全流程：
    //   1) 模型页编辑保存 → 服务端 revision+1 → 界面读回一致；
    //   2) 另侧更新后 UI 保存 → 409 冲突，草稿原样保留（conflict-keep）；
    //   3) Key 只显示状态（状态盒/替换框为空且 password/页面无明文）；
    //   4) 用途绑定经 UI 保存 → 投影写原生设置（marker/模型/上下文/输出参数/main_api）；
    //   5) 三协议（Chat/Responses/Claude）经原生界面发送，fixture 断言真实出站。
    //   截图不含 API Key（页面本身不回显凭据）。
    let chromium;
    try {
        ({ chromium } = await import('playwright-core'));
    } catch {
        throw new Error('playwright-core 不可用（node_modules 缺失）；真实浏览器串联由主会话环境执行');
    }
    // chromium 可执行文件可用 VC_W03_CHROMIUM_PATH 覆盖（playwright-core 1.64 锁定依赖；
    // 无对应版本缓存时复用本机已有的 Chromium for Testing 二进制）
    const launchOpts = { headless: true };
    if (process.env.VC_W03_CHROMIUM_PATH) launchOpts.executablePath = process.env.VC_W03_CHROMIUM_PATH;
    const browser = await chromium.launch(launchOpts);
    try {
        const browserContext = await browser.newContext();
        await pinVcUi(browserContext, 'off');
        await browserContext.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: rt.ST_BASE },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: rt.ST_BASE },
        ]);
        const page = await browserContext.newPage();
        const pageErrors = trackPageErrors(page);
        const consoleLines = [];
        page.on('console', (m) => consoleLines.push(`[page:${m.type()}] ${m.text().slice(0, 160)}`));
        // 网络探针（诊断连接检查与生成）：request 级（未应答也可见）+ 4xx/5xx 应答体
        page.on('request', (req) => {
            const u = req.url();
            if (u.includes('/api/backends/chat-completions/status') || u.includes('/api/backends/chat-completions/generate')) {
                let hint = '';
                try {
                    const pd = req.postDataJSON?.();
                    if (pd) hint = ` src=${pd.chat_completion_source} marker=${String(pd.custom_url ?? pd.reverse_proxy ?? '').slice(0, 40)}`;
                } catch { /* 无体 */ }
                console.log(`[ui03-req] POST ${u.replace(rt.ST_BASE, '')}${hint}`);
            }
        });
        page.on('response', async (res) => {
            const u = res.url();
            const isWatched = u.includes('/api/backends/chat-completions/status') || u.includes('/api/backends/chat-completions/generate');
            if (isWatched || res.status() >= 400) {
                let bodyHint = '';
                try {
                    const req = res.request();
                    const pd = req.postDataJSON?.() ?? null;
                    bodyHint = pd ? ` src=${pd.chat_completion_source} custom=${String(pd.custom_url ?? pd.reverse_proxy ?? '').slice(0, 46)}` : '';
                } catch { /* 无体 */ }
                let respHint = '';
                if (res.status() >= 400) {
                    try { respHint = ` resp=${(await res.text()).slice(0, 120)}`; } catch { /* 已释放 */ }
                }
                console.log(`[ui03-net] ${res.status()} ${u.replace(rt.ST_BASE, '')}${bodyHint}${respHint}`);
            }
        });
        await page.goto(rt.ST_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => {
            const area = document.querySelector('dialog[open].popup textarea');
            const shown = area && area.getClientRects().length > 0 && getComputedStyle(area).visibility !== 'hidden';
            const app = document.querySelector('#vc_models_menu_button') || document.body.classList.contains('vc-ui');
            return shown || (app && !document.querySelector('dialog[open].popup'));
        }, undefined, { timeout: 45000 });
        // ST 首启欢迎弹窗（合成 dataRoot 首次初始化）会拦截所有点击：按真实用户流程完成
        // （用户名默认合成填入 + 确定），不绕过、不调 z-index
        // ST 首启欢迎弹窗（合成 dataRoot 首次初始化）会拦截所有点击：按真实用户流程完成。
        // 控件为锁定源码形状（public/scripts/popup.js）：textarea=用户名（默认 User）、
        // .popup-button-ok=确定（DIV 按钮，getByRole(button) 不可见）
        const welcomeDialog = page.locator('dialog[open].popup').first();
        if (await welcomeDialog.count()) {
            const name = welcomeDialog.locator('textarea');
            await name.waitFor({ state: 'visible', timeout: 15000 });
            await name.fill('w03-owner');
            await welcomeDialog.locator('.popup-button-ok').click();
            await welcomeDialog.waitFor({ state: 'hidden', timeout: 10000 });
            log.info('ST 首启欢迎弹窗已按真实用户流程完成（合成用户名 + .popup-button-ok）');
        }
        // 扩展经 manifest hooks.activate 自动激活（已验证）；按钮在收起的魔法棒菜单里，
        // attached 等待确认激活，随后按真实用户路径打开（魔法棒 → 模型设置）
        await page.waitForSelector('#vc_models_menu_button', { state: 'attached', timeout: 45000 });
        const openPanel = async () => {
            // overlay 元素常驻 DOM（init 即挂载、保持隐藏），开合判断必须用可见性
            if (await page.locator('.vcms-overlay').isVisible()) return;
            await page.click('#extensionsMenuButton');
            await page.click('#vc_models_menu_button');
            await page.waitForSelector('.vcms-overlay', { state: 'visible', timeout: 10000 });
        };
        const closePanel = async () => {
            if (!(await page.locator('.vcms-overlay').isVisible())) return;
            // 有未保存修改时关闭会先确认；按真实用户路径先放弃修改（阶段 2 保留的冲突草稿等）
            if (await page.locator('#vcms-dirty').isVisible()) {
                await page.click('#vcms-discard');
                await page.waitForSelector('#vcms-dirty', { state: 'hidden', timeout: 5000 });
            }
            await page.click('.vcms-overlay [data-action="close"]');
            await page.waitForSelector('.vcms-overlay', { state: 'hidden', timeout: 10000 });
        };
        await openPanel();
        try {
            await page.waitForSelector('#vcms-provider-list > *', { timeout: 10000 });
        } catch {
            const panelState = await page.evaluate(() => ({
                hidden: document.querySelector('.vcms-overlay')?.hidden ?? null,
                outerStart: document.querySelector('.vcms-overlay')?.outerHTML?.replace(/\s+/g, ' ').slice(0, 260) ?? null,
                rootHtml: document.querySelector('#vc-model-settings-root')?.outerHTML?.replace(/\s+/g, ' ').slice(0, 200) ?? null,
                bodyClass: document.body.className,
            }));
            const pageErrs = consoleLines.filter((l) => l.includes('error') || l.includes('Error')).slice(-6);
            console.log(`[ui03-panel-state] ${JSON.stringify(panelState)} errs=${JSON.stringify(pageErrs)}`);
            await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-panel-missing.png'), fullPage: false });
            throw new Error(`模型页 provider 列表未出现：${JSON.stringify(panelState).slice(0, 200)}`);
        }
        const cardCount = await page.locator('#vcms-provider-list > *').count();
        if (cardCount < 5) throw new Error(`模型页 provider 卡不足：${cardCount}（期望 ≥5，catalog-admin 已建）`);

        // —— 阶段 1：真实 DOM 保存 → 读回（首卡默认已选中，表单已在）——
        // 契约：保存不触发任何上游请求（page.js:657、MASTER_PLAN:103）——真实页面计数断言
        const saveCount0 = await ctx.fixtureHttp.count();
        const chatCard = page.locator('#vcms-provider-list > *').first();
        await page.waitForSelector('#vcms-f-display', { timeout: 5000 });
        const beforeList = await ctx.admin.listProviders();
        const beforeRow = beforeList.json.find((p) => p.providerId === 'vc03m-chat');
        await reauthForWrite(ctx);
        await page.fill('#vcms-f-display', '受管 Chat（UI03）');
        await page.click('#vcms-save');
        await waitFor(async () => {
            const l = await ctx.admin.listProviders();
            const row = l.json.find((p) => p.providerId === 'vc03m-chat');
            return row && row.displayName === '受管 Chat（UI03）' && row.revision === beforeRow.revision + 1;
        }, { timeoutMs: 15000, label: 'UI 保存落库（displayName + revision+1）' });
        await chatCard.click(); // 重新选中读回
        await page.waitForSelector('#vcms-f-display', { timeout: 5000 });
        const readBack = await page.inputValue('#vcms-f-display');
        if (readBack !== '受管 Chat（UI03）') throw new Error(`UI 读回异常：display=${readBack}`);
        if ((await ctx.fixtureHttp.count()) !== saveCount0) {
            throw new Error(`保存期间出现上游请求（违反零请求契约）：${saveCount0} → ${await ctx.fixtureHttp.count()}`);
        }
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-save-readback.png'), fullPage: false });
        log.ok('UI03 保存读回通过：真实 DOM 编辑 → 保存 → 服务端 revision+1 → 界面读回一致');

        // —— 阶段 2：版本冲突保留草稿 ——
        await page.fill('#vcms-f-display', 'UI03 冲突草稿值');
        const curList = await ctx.admin.listProviders();
        const curRow = curList.json.find((p) => p.providerId === 'vc03m-chat');
        const externalName = `受管 Chat（他侧更新 ${Date.now() % 1000}）`;
        await reauthForWrite(ctx);
        const external = await ctx.admin.saveProvider('vc03m-chat', {
            displayName: externalName, protocol: 'OPENAI_CHAT_COMPLETIONS',
            baseUrl: `${rt.FIXTURE_BASE}/v1`, state: 'ENABLED', expectedRevision: curRow.revision,
            models: providerCatalogSpec(ctx.secrets.fixtureKey)[0].models,
        });
        if (external.status !== 200) throw new Error(`外部更新失败：HTTP ${external.status}`);
        await page.click('#vcms-save');
        await page.waitForSelector('[data-action="conflict-keep"]', { timeout: 10000 });
        const draftKept = await page.inputValue('#vcms-f-display');
        if (draftKept !== 'UI03 冲突草稿值') throw new Error(`冲突后草稿被破坏：display=${draftKept}`);
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-conflict-draft.png'), fullPage: false });
        await page.click('[data-action="conflict-keep"]');
        const afterConflict = (await ctx.admin.listProviders()).json.find((p) => p.providerId === 'vc03m-chat');
        if (afterConflict.displayName === 'UI03 冲突草稿值' || afterConflict.displayName !== externalName) {
            throw new Error(`冲突后服务端值异常：${afterConflict.displayName}`);
        }
        log.ok('UI03 版本冲突保留草稿通过：409 后界面草稿原样、服务端保持他侧更新');

        // —— 阶段 3：Key 只显示状态 ——
        // 受管 Chat 已配置合成 Key：选中即显示状态盒（不回显、无输入框），替换才出现 password 输入
        await chatCard.click();
        await page.waitForSelector('.vcms-keybox', { timeout: 5000 });
        if (await page.locator('#vcms-f-key').count()) throw new Error('已配置 Key 的供应商不应直接出现密钥输入框');
        const keyboxText = await page.locator('.vcms-keybox').first().innerText();
        if (!/已配置/.test(keyboxText)) throw new Error(`Key 状态盒文案异常：${keyboxText.slice(0, 60)}`);
        await page.click('[data-action="key-replace"]');
        await page.waitForSelector('#vcms-f-key', { timeout: 5000 });
        const keyType = await page.getAttribute('#vcms-f-key', 'type');
        const keyValue = await page.inputValue('#vcms-f-key');
        if (keyType !== 'password') throw new Error(`密钥输入框 type=${keyType}（应为 password）`);
        if (keyValue !== '') throw new Error(`替换密钥框必须为空且不回显原值，实际=${String(keyValue).slice(0, 8)}…`);
        const pageHtml = await page.content();
        if (pageHtml.includes(ctx.secrets.fixtureKey)) throw new Error('页面 DOM 泄露明文密钥');
        await page.click('[data-action="key-undo"]');
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-key-status.png'), fullPage: false });
        log.ok('UI03 Key 只显示状态通过：状态盒 + password 替换框 + 页面无明文密钥');

        // —— 阶段 4/5：用途绑定 + 原生投影/上下文/输出参数 + 三协议原生发送 ——
        const bindAndProject = async (optionValue, markerPred, label) => {
            // 契约断言：用途绑定 → 投影刷新全程零上游请求（含改 source 的绑定；
            // 连接只发生在用户显式点击"连接"）
            const count0 = await ctx.fixtureHttp.count();
            await openPanel();
            await page.click('[data-action="tab"][data-tab="bindings"]');
            await page.waitForSelector('select[data-bind="binding.FOREGROUND_CHAT"]', { timeout: 5000 });
            await page.selectOption('select[data-bind="binding.FOREGROUND_CHAT"]', optionValue);
            await page.click('[data-action="save-bindings"]');
            await waitFor(async () => {
                const purposes = await ctx.admin.listPurposes();
                const row = purposes.json.find((r) => r.purpose === 'FOREGROUND_CHAT');
                const [p, f] = optionValue.split('::');
                return row && row.providerId === p && row.profileKey === f && row.status === 'READY';
            }, { timeoutMs: 15000, label: `UI 绑定落库（${label}）` });
            await page.waitForFunction((pred) => {
                const oai = window.SillyTavern?.getContext?.()?.chatCompletionSettings ?? {};
                return pred.includes('reverse')
                    ? String(oai.reverse_proxy ?? '').includes(pred.replace('reverse:', ''))
                    : String(oai.custom_url ?? '').includes(pred);
            }, markerPred, { timeout: 20000, polling: 400 });
            if ((await ctx.fixtureHttp.count()) !== count0) {
                throw new Error(`${label} 绑定/投影期间出现上游请求（违反零请求契约）：${count0} → ${await ctx.fixtureHttp.count()}`);
            }
        };
        const nativeSend = async (text, expectReply, { expectProxyMarker } = {}) => {
            await closePanel(); // 面板是全屏遮罩，发送前按真实路径收起
            // 真实用户连接步骤：ST 的连接检查只在点"连接"时发起（投影不自动触发）。
            // 打开右上 API 抽屉 → 点连接 → 等发送键出现（no_connection 时它被隐藏）
            if (await page.locator('#send_but.displayNone').count()) {
                if (!(await page.locator('#api_button_openai').isVisible())) {
                    await page.click('#API-status-top');
                }
                await page.waitForSelector('#api_button_openai', { state: 'visible', timeout: 10000 });
                await page.click('#api_button_openai');
                await page.waitForFunction(() => !document.querySelector('#send_but')?.classList.contains('displayNone')
                    && document.querySelector('#send_but')?.offsetParent !== null, undefined, { timeout: 30000, polling: 400 });
            }
            const since = (await ctx.fixtureHttp.captures({})).at(-1)?.seq ?? 0;
            await page.fill('#send_textarea', text);
            await page.waitForFunction(() => {
                const b = document.querySelector('#send_but');
                const s = document.querySelector('#mes_stop');
                return b && !b.disabled && !b.classList.contains('disabled')
                    && (!s || getComputedStyle(s).display === 'none'); // 点击前无在途生成
            }, undefined, { timeout: 30000, polling: 400 });
            await page.click('#send_but');
            // Claude 源 reverse_proxy 变更后，ST 客户端会弹"正在连接代理"确认（openai.js:537
            // validateReverseProxy）阻塞生成：核对弹窗确指本轮绑定标记后才按真实用户流程确认
            if (expectProxyMarker) {
                const confirmDialog = page.locator('dialog[open].popup').first();
                await confirmDialog.waitFor({ timeout: 15000 });
                const dlgText = (await confirmDialog.innerText()).replace(/\s+/g, ' ');
                if (!dlgText.includes(expectProxyMarker)) {
                    throw new Error(`代理确认弹窗目标异常（期望含 ${expectProxyMarker}）：${dlgText.slice(0, 120)}`);
                }
                await confirmDialog.locator('.popup-button-ok').click();
                await confirmDialog.waitFor({ state: 'hidden', timeout: 10000 });
            }
            // 判据用 getContext().chat 真源（accept.mjs 同模式）：末两条恰为本轮消息对
            // （用户文本本轮唯一）+ AI 回复到位 + #mes_stop 空闲。首次无角色发送会
            // newAssistantChat 替换欢迎会话（script.js:1760），不能跨会话套计数增长
            try {
                await page.waitForFunction(({ text: t, reply }) => {
                    const ch = window.SillyTavern.getContext()?.chat ?? [];
                    const last = ch[ch.length - 1];
                    const prev = ch[ch.length - 2];
                    const stop = document.querySelector('#mes_stop');
                    const idle = !stop || getComputedStyle(stop).display === 'none';
                    return idle && !!prev && prev.is_user === true && String(prev.mes ?? '').includes(t)
                        && !!last && !last.is_user && String(last.mes ?? '').includes(reply);
                }, { text, reply: expectReply }, { timeout: 45000, polling: 500 });
            } catch {
                const diag = await page.evaluate(() => ({
                    chatLen: window.SillyTavern.getContext()?.chat?.length ?? -1,
                    lastTwo: (window.SillyTavern.getContext()?.chat ?? []).slice(-2).map((m) => ({ is_user: m.is_user, mes: String(m.mes ?? '').slice(0, 60) })),
                    stopVisible: (() => { const s = document.querySelector('#mes_stop'); return !!s && getComputedStyle(s).display !== 'none'; })(),
                    lastResources: performance.getEntriesByType('resource').slice(-8).map((e) => `${e.name.split('/').slice(-2).join('/')} ${Math.round(e.duration)}ms`),
                    genState: window.SillyTavern.getContext()?.generation_started ?? null,
                }));
                await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-send-stuck.png'), fullPage: false });
                console.log(`[ui03-send-diag] ${JSON.stringify(diag)} console=${JSON.stringify(consoleLines.slice(-8))}`);
                throw new Error(`原生发送后未等到本轮消息对：${JSON.stringify(diag)}`);
            }
            return since;
        };

        // 协议 1/3：Chat Completions（投影负责把 main_api 切到 openai——真实接线）
        await bindAndProject('vc03m-chat::chat', 'provider=vc03m-chat&profile=chat', 'chat');
        await page.waitForFunction(() => {
            const c = window.SillyTavern?.getContext?.() ?? {};
            const oai = c.chatCompletionSettings ?? {};
            return String(c.mainApi ?? '') === 'openai'
                && oai.chat_completion_source === 'custom'
                && String(oai.custom_url ?? '').startsWith('vc-go://')
                && Number(oai.openai_max_tokens) === 2048
                && Number(oai.openai_max_context) === 8192
                && String(oai.custom_model ?? '') === 'vc03m-chat';
        }, undefined, { timeout: 20000, polling: 400 });
        // 受管 dataRoot 跨运行持久（chat/设置累积），用户文本带本轮唯一 scope 后缀，
        // 防止上一轮的同文案消息对让断言误匹配
        const sinceChat = await nativeSend(`UI03 原生发送：Chat ${ctx.scope}`, '受管验收的合成回复');
        let cap = await readFixtureCapture(ctx, { protocol: 'chat', since: sinceChat });
        if (cap.finalUrl !== '/v1/chat/completions' || cap.body.model !== 'vc03m-chat' || cap.auth.matched !== true) {
            throw new Error(`Chat 原生发送出站异常：${cap.finalUrl} ${cap.body?.model}`);
        }
        if (Math.abs(Number(cap.body.temperature) - 0.3) > 1e-6) throw new Error(`Chat 原生发送钉住采样丢失：${cap.body.temperature}`);
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-native-chat.png'), fullPage: false });
        log.ok('UI03 原生投影+Chat 原生发送通过：marker/模型/上下文 8192/输出 2048/钉住采样经原生界面真实发出');

        // 协议 2/3：Responses（仍走 custom 源，插件桥适配 /v1/responses）
        await bindAndProject('vc03m-resp::usage', 'provider=vc03m-resp&profile=usage', 'responses');
        const sinceResp = await nativeSend(`UI03 原生发送：Responses ${ctx.scope}`, '带固定用量的回复');
        cap = await readFixtureCapture(ctx, { protocol: 'responses', since: sinceResp });
        if (cap.finalUrl !== '/v1/responses' || cap.body.model !== 'vc03m-usage' || cap.auth.matched !== true || cap.body.store !== false) {
            throw new Error(`Responses 原生发送出站异常：${cap.finalUrl} ${cap.body?.model} store=${cap.body?.store}`);
        }
        log.ok('UI03 Responses 原生发送通过：原生界面 → 插件桥 → /v1/responses（store=false、auth 匹配）');

        // 协议 3/3：Anthropic（同为 main_api=openai，族内 chat_completion_source=claude）
        await bindAndProject('vc03m-claude::chat', 'reverse:provider=vc03m-claude&profile=chat', 'claude');
        await page.waitForFunction(() => {
            const c = window.SillyTavern?.getContext?.() ?? {};
            const oai = c.chatCompletionSettings ?? {};
            return String(c.mainApi ?? '') === 'openai'
                && oai.chat_completion_source === 'claude'
                && String(oai.reverse_proxy ?? '').startsWith('vc-go://') && String(oai.claude_model ?? '') === 'vc03m-chat';
        }, undefined, { timeout: 20000, polling: 400 });
        const sinceClaude = await nativeSend(`UI03 原生发送：Claude ${ctx.scope}`, '受管验收的合成回复', {
            // 只确认确指本轮 claude 绑定标记的代理弹窗（不全局接受任意弹窗）
            expectProxyMarker: 'vc-go://model-purposes/FOREGROUND_CHAT?provider=vc03m-claude',
        });
        cap = await readFixtureCapture(ctx, { protocol: 'anthropic', since: sinceClaude });
        if (cap.finalUrl !== '/v1/messages' || cap.body.model !== 'vc03m-chat' || cap.auth.matched !== true) {
            throw new Error(`Claude 原生发送出站异常：${cap.finalUrl} ${cap.body?.model}`);
        }
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'ui03-native-claude.png'), fullPage: false });
        log.ok('UI03 Anthropic 原生发送通过：main_api=openai + source=claude + reverse_proxy marker → /v1/messages');

        ctx.screenshots.push('ui03-save-readback.png', 'ui03-conflict-draft.png', 'ui03-key-status.png', 'ui03-native-chat.png', 'ui03-native-claude.png');
        pageErrors.assertNone();
        log.ok('UI03 真实浏览器界面验收通过：保存读回 / 冲突保留草稿 / Key 只显状态 / 原生投影与三协议原生发送');
    } finally {
        await browser.close();
    }
}

// ---------------------------------------------------------------------------

export const ui03BrowserScene = {
    id: 'ui03-browser',
    title: 'UI03 浏览器场景（真实浏览器，主会话串联执行；截图进 artifacts）',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneUi03Browser,
};
export const scenes = [ui03BrowserScene];
