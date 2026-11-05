// NF-04：使用既有合成复杂卡、真实锁定EJS/Helper/MVU与受管provider。
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { PNG } from 'pngjs';
import { createStClient, waitFor } from './managed-lib.mjs';
import { seedDesktopBenchmark, desktopBenchmarkContext } from './desktop-startup-accept.mjs';
import { openDesktopFixture, captureWindows } from './desktop-chat-accept.mjs';
import { complexCard, complexReply, isRequiredCardResource } from './lib/complex-card.mjs';
import { openStCharacterChat } from './lib/open-st-chat.mjs';
import { nativeReady } from './f2-chat-accept.mjs';

async function formatCardProbe(page, fixture, raw) {
    const { avatar, file } = fixture;
    const relationshipId = fixture.chat[0].chat_metadata.vc_binding.relationshipId;
    // React 可以先显示历史预览。实际 formatter 读取当前会话的 Helper 数据。
    await page.waitForFunction(({ avatar, file, relationshipId }) => {
        const context = window.SillyTavern?.getContext?.();
        return context?.chatId === file && context.characters?.[context.characterId]?.avatar === avatar
            && context.chatMetadata?.vc_binding?.relationshipId === relationshipId && context.chat?.length === 1
            && typeof window.TavernHelper?.formatAsDisplayedMessage === 'function'
            && typeof window.TavernHelper?.formatAsTavernRegexedString === 'function';
    }, { avatar, file, relationshipId }, { timeout: 30000 });
    return page.evaluate(text => ({
        html: TavernHelper.formatAsDisplayedMessage(text, { message_id: 0 }),
        prompt: TavernHelper.formatAsTavernRegexedString(text, 'ai_output', 'prompt'),
    }), raw);
}

async function verifyOrdinaryContent(ctx, st, browser) {
    const fixture = await seedDesktopBenchmark(ctx, { messages: 2 });
    const base = new URL(ctx.w05.stBase);
    const probePath = '/user/files/nf14-code-executed.txt';
    const payload = [
        'NF14_ORDINARY_MESSAGE',
        `<% setvar('nf14EjsExecuted', true); await fetch('${probePath}?source=ejs'); %>`,
        '```html',
        `<!doctype html><html><body><script>
        parent.document.documentElement.dataset.nf14ParentRead = String(Boolean(parent.SillyTavern.getContext().chat.length));
        parent.SillyTavern.getContext().chatMetadata.variables.nf14HtmlExecuted = true;
        fetch('${probePath}?source=html');
        </script></body></html>`,
        '```',
    ].join('\n');
    const original = await st.call('POST', '/api/characters/get', { avatar_url: fixture.avatar });
    assert.equal(original.status, 200);
    original.json.data.description = `NF14_UNTRUSTED_DESCRIPTION <% globalThis.nf14DescriptionExecuted = true; void fetch('${probePath}?source=description').catch(() => {}); %>`;
    const ordinaryBook = 'NF14 普通导入世界书';
    original.json.data.extensions.world = ordinaryBook;
    assert.equal((await st.call('POST', '/api/worldinfo/edit', { name: ordinaryBook, data: { entries: {
        0: { uid: 0, key: [], keysecondary: [], comment: '普通导入条目', constant: true, selective: false,
            order: 100, position: 0, disable: false, displayIndex: 0, useProbability: true, probability: 100,
            content: `NF14_UNTRUSTED_WORLDBOOK <% globalThis.nf14WorldbookExecuted = true; void fetch('${probePath}?source=worldbook').catch(() => {}); %>` },
    } } })).status, 200);
    original.json.data.extensions.tavern_helper = { scripts: [{
        type: 'script', enabled: true, id: 'nf14-untrusted-import', name: '合成未授权脚本',
        content: `fetch('${probePath}?source=imported-card');`,
    }] };
    assert.equal((await st.call('POST', '/api/characters/merge-attributes', { avatar: fixture.avatar, data: original.json.data })).status, 200);

    const receivedRedirect = [];
    const sink = createServer((request, response) => {
        // 捕获是否到达和是否携带身份，不保存请求头或 Cookie 内容。
        receivedRedirect.push({ method: request.method, hasIdentity: Boolean(request.headers.cookie
            || request.headers['x-vc-expected-account-id'] || request.headers['x-csrf-token']) });
        response.writeHead(200, { 'access-control-allow-origin': base.origin, 'access-control-allow-credentials': 'true',
            'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': request.headers['access-control-request-headers'] || 'content-type' });
        response.end(request.method === 'GET' ? 'NF14_FORBIDDEN_ATTACHMENT' : '');
    });
    sink.listen(0, '127.0.0.1');
    await once(sink, 'listening');
    let ordinary;
    try {
        const redirectTarget = `http://127.0.0.1:${sink.address().port}/nf14-redirect-target`;
        const similar = new URL(base);
        similar.hostname += '.vc-r6.invalid';
        const okPath = '/user/files/nf14-attachment-ok.txt', absolutePath = '/user/files/nf14-attachment-absolute.txt';
        const redirectPath = '/user/files/nf14-attachment-redirect.txt';
        const loaded = await st.call('POST', '/api/chats/get', { avatar_url: fixture.avatar, file_name: fixture.file });
        assert.equal(loaded.status, 200);
        loaded.json[0].chat_metadata.variables ||= {};
        Object.assign(loaded.json[0].chat_metadata, { note_prompt: 'NF14_AUTHOR_NOTE', note_interval: 1, note_position: 1, note_depth: 1, note_role: 0 });
        loaded.json[1].mes = payload;
        loaded.json[2].mes = payload;
        loaded.json[2].extra = { ...loaded.json[2].extra, files: [
            { url: okPath },
            { url: base.origin + '/user/files/./nf14-attachment-absolute.txt' },
            { url: similar.origin + '/user/files/nf14-attachment-lookalike.txt' },
            { url: '/user/files/../nf14-attachment-outside.txt' },
            { url: redirectPath },
        ] };
        assert.equal((await st.call('POST', '/api/chats/save', { avatar_url: fixture.avatar, file_name: fixture.file, chat: loaded.json })).status, 200);
        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: payload, tool: null });
        ordinary = await desktopBenchmarkContext(browser, ctx, { serviceWorkers: 'block' });
        const page = await ordinary.newPage();
        const requests = [];
        await page.route(url => url.pathname.includes('nf14-') && url.port !== String(sink.address().port), async route => {
            const { pathname } = new URL(route.request().url());
            requests.push(pathname);
            if (pathname === okPath) return route.fulfill({ contentType: 'text/plain', body: 'NF14_ALLOWED_ATTACHMENT' });
            if (pathname === absolutePath) return route.fulfill({ contentType: 'text/plain', body: 'NF14_NORMALIZED_ATTACHMENT' });
            if (pathname === redirectPath) return route.fulfill({ status: 302, headers: { location: redirectTarget } });
            // 合成相似域和探针请求在首跳拦下，绝不访问真实外部地址。
            return route.abort('blockedbyclient');
        });
        await openDesktopFixture(page, ctx.w05.stBase, fixture, 2);
        const assertInert = async () => {
            assert.equal(await page.locator('#chat iframe, [data-vc-card-scripts] iframe').count(), 0, '普通历史/模型输出及未授权导入卡不可挂载执行 iframe');
            assert.deepEqual(await page.evaluate(() => {
                const variables = SillyTavern.getContext().chatMetadata.variables || {};
                return { readParent: Boolean(document.documentElement.dataset.nf14ParentRead),
                    htmlMutation: Object.hasOwn(variables, 'nf14HtmlExecuted'), ejsMutation: Object.hasOwn(variables, 'nf14EjsExecuted'),
                    descriptionExecuted: Boolean(globalThis.nf14DescriptionExecuted), worldbookExecuted: Boolean(globalThis.nf14WorldbookExecuted) };
            }), { readParent: false, htmlMutation: false, ejsMutation: false, descriptionExecuted: false, worldbookExecuted: false });
        };
        await page.locator('#send_textarea').fill('NF14 合成安全检查');
        await page.waitForFunction(() => Boolean(document.querySelector('#send_but:not(:disabled)')));
        await assertInert();
        // 已批准修正的语义由发运请求单验，避免继承原生 IN_CHAT 异步过滤缺陷。
        await page.evaluate(() => {
            const context = SillyTavern.getContext();
            const afterTask = () => new Promise(resolve => setTimeout(resolve, 0));
            for (const [id, allowed] of [['NF14_FILTER_ALLOWED', true], ['NF14_FILTER_DENIED', false]]) {
                context.setExtensionPrompt(id, id, 1, 0, false, 0, async () => { await afterTask(); return allowed; });
            }
            context.eventSource.on(context.eventTypes.CHAT_COMPLETION_PROMPT_READY, async ({ chat, dryRun }) => {
                if (dryRun) return;
                await afterTask();
                const lastUser = chat.findLast(message => message.role === 'user' && typeof message.content === 'string');
                if (lastUser) lastUser.content += '\nNF14_AWAITED_HOOK';
            });
        });
        const generation = page.waitForRequest(request => new URL(request.url()).pathname === '/api/backends/chat-completions/generate');
        await page.locator('#send_but').click();
        const request = await generation;
        const prompt = JSON.stringify(request.postDataJSON().messages);
        assert.ok(prompt.includes('NF14_ALLOWED_ATTACHMENT'), '合法根路径附件必须真正进入发运提示词');
        assert.ok(prompt.includes('NF14_NORMALIZED_ATTACHMENT'), '规范化同源绝对附件 URL 必须真正进入发运提示词');
        for (const marker of ['NF14_AUTHOR_NOTE', 'NF14_FILTER_ALLOWED', 'NF14_AWAITED_HOOK']) {
            assert.ok(prompt.includes(marker), `发运提示词必须应用 ${marker}`);
        }
        assert.ok(prompt.includes('NF14_UNTRUSTED_DESCRIPTION'), '普通导入角色描述仍作为数据进入提示词');
        assert.ok(prompt.includes('NF14_UNTRUSTED_WORLDBOOK'), '普通导入世界书仍作为数据进入提示词');
        assert.ok(!prompt.includes('NF14_FILTER_DENIED'), '异步过滤拒绝的注入不能进入发运提示词');
        assert.ok(!prompt.includes('NF14_FORBIDDEN_ATTACHMENT'), '重定向响应不能进入提示词');
        await page.waitForFunction(() => document.querySelectorAll('#chat > .mes').length === 4 && !document.querySelector('#mes_stop'));
        assert.match(await page.locator('#chat > .mes').last().locator('.mes_text').textContent(), /NF14_ORDINARY_MESSAGE/);
        await assertInert();
        const saved = await st.call('POST', '/api/chats/get', { avatar_url: fixture.avatar, file_name: fixture.file });
        assert.equal(saved.status, 200);
        assert.equal(saved.json.at(-1).extra?.vc_source?.settled, true, '普通模型输出仍经 F2 正常保存');
        assert.ok(!Object.hasOwn(saved.json[0].chat_metadata.variables || {}, 'nf14EjsExecuted'));
        assert.ok(!Object.hasOwn(saved.json[0].chat_metadata.variables || {}, 'nf14HtmlExecuted'));
        assert.deepEqual(requests.sort(), [okPath, absolutePath, redirectPath].sort(), '仅尝试合法附件及其同源首跳');
        assert.deepEqual(receivedRedirect, [], '同源 302 不得向跨源目标发起请求或转发身份');
    } finally {
        await ordinary?.close();
        await new Promise((resolve, reject) => sink.close(error => error ? reject(error) : resolve()));
    }
}

async function sceneDesktopCards(ctx) {
    const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: ctx.secrets.session,
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}` });
    const fixture = await seedDesktopBenchmark(ctx);
    const book = 'NF04 合成书店', card = complexCard('NF04 合成澄夏', book);
    card.data.extensions.tavern_helper.scripts[0].button.buttons.push({ name: '重演楼层', visible: true });
    const existing = (await st.call('POST', '/api/characters/get', { avatar_url: fixture.avatar })).json;
    card.data.extensions.vc_character_ref = existing.data.extensions.vc_character_ref;
    card.data.extensions.world = book;
    assert.equal((await st.call('POST', '/api/characters/merge-attributes', { avatar: fixture.avatar, data: card.data })).status, 200);
    const entries = Object.fromEntries(card.data.character_book.entries.map((entry, index) => [entry.id, {
        uid: entry.id, key: entry.keys, keysecondary: entry.secondary_keys, content: entry.content, comment: entry.comment,
        constant: entry.constant, selective: entry.selective, selectiveLogic: 0, order: entry.insertion_order,
        position: 0, disable: false, displayIndex: index, useProbability: true, probability: 100,
        group: '', groupWeight: 100, depth: 4, role: 0, addMemo: true,
    }]));
    assert.equal((await st.call('POST', '/api/worldinfo/edit', { name: book, data: { entries } })).status, 200);
    const records = (await st.call('POST', '/api/chats/get', { avatar_url: fixture.avatar, file_name: fixture.file })).json;
    records.splice(1, records.length - 1, { name: card.data.name, is_user: false, is_system: false,
        mes: card.data.first_mes, swipe_id: 0, swipes: [card.data.first_mes], extra: {}, send_date: '2026-11-03T00:00:00Z' });
    assert.equal((await st.call('POST', '/api/chats/save', { avatar_url: fixture.avatar, file_name: fixture.file, chat: records })).status, 200);
    const settings = JSON.parse((await st.call('POST', '/api/settings/get', {})).json.settings);
    settings.extension_settings ||= {};
    settings.extension_settings.EjsTemplate ||= {};
    Object.assign(settings.extension_settings.EjsTemplate, { compile_workers: false, sandbox: false });
    settings.extension_settings.character_allowed_regex = [fixture.avatar];
    settings.extension_settings.tavern_helper ||= {};
    settings.extension_settings.tavern_helper.script ||= {};
    settings.extension_settings.tavern_helper.script.enabled ||= {};
    settings.extension_settings.tavern_helper.script.enabled.characters = [fixture.avatar];
    settings.extension_settings.vc_reply_planner = false;
    assert.equal((await st.call('POST', '/api/settings/save', settings)).status, 200);
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    const context = await desktopBenchmarkContext(browser, ctx), page = await context.newPage();
    const errors = [], forbidden = [], failedResources = [], runtimeErrors = [];
    let stage = '普通内容与附件边界';
    let chatSaveRequests = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/chats/save') chatSaveRequests += 1;
    });
    page.on('pageerror', error => errors.push(error.stack?.split('\n').slice(0, 5).join('\n') || error.name + ': ' + error.message));
    const recordResourceFailure = (request, failure) => {
        const pathname = new URL(request.url()).pathname;
        if (isRequiredCardResource(pathname, request.resourceType())) failedResources.push({ path: pathname, failure });
    };
    page.on('requestfailed', request => recordResourceFailure(request, request.failure()?.errorText));
    page.on('response', response => {
        if (response.status() >= 400) recordResourceFailure(response.request(), response.status());
    });
    page.on('console', message => { if (message.type() === 'error') {
        const error = message.text().match(/(?:ReferenceError|TypeError|SyntaxError):[^\n]{1,180}/)?.[0];
        if (error) runtimeErrors.push(error);
    } });
    page.on('request', request => { const url = new URL(request.url());
        if (['/', '/script.js', '/index.html', '/scripts/extensions.js', '/scripts/st-context.js'].includes(url.pathname)
            || /(?:JS-Slash-Runner|ST-Prompt-Template)\/dist\/index\.js$/.test(url.pathname)) forbidden.push(url.pathname); });
    try {
        await verifyOrdinaryContent(ctx, st, browser);
        stage = '原生 Helper formatter';
        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: complexReply(15), tool: null, chunks: 3 });
        const probe = `**NF04_FORMAT**\n\n${complexReply(15)}\n\n<StatusPlaceHolderImpl/>`;
        const native = await desktopBenchmarkContext(browser, ctx);
        let expectedFormat;
        try {
            const reference = await native.newPage();
            await reference.goto(ctx.w05.stBase + '/native/', { waitUntil: 'domcontentloaded' });
            await nativeReady(reference);
            await openStCharacterChat(reference, fixture);
            expectedFormat = await formatCardProbe(reference, fixture, probe);
        } finally {
            await native.close();
        }
        assert.match(expectedFormat.html, /<strong>NF04_FORMAT<\/strong>/, '原生锁定 formatter 必须实际转换 Markdown');
        assert.doesNotMatch(expectedFormat.html, /UpdateVariable|_\.set\(|StatusPlaceHolderImpl/);
        assert.match(expectedFormat.html, /查看当前状态/);
        assert.match(expectedFormat.html, /getCurrentMessageId\(\)/);
        assert.match(expectedFormat.prompt, /<UpdateVariable>/, '显示正则不能改变提示层');
        assert.match(expectedFormat.prompt, /<StatusPlaceHolderImpl\/>/);
        stage = '发运 Helper formatter';
        await openDesktopFixture(page, ctx.w05.stBase, fixture, 1);
        await page.waitForFunction(() => ['prepared', 'error'].includes(document.documentElement.dataset.vcRuntime));
        assert.equal(await page.locator('html').getAttribute('data-vc-runtime'), 'prepared', '发运桌面必须实际初始化聊天运行模块');
        const actualFormat = await formatCardProbe(page, fixture, probe);
        assert.ok(actualFormat.html === expectedFormat.html, '发运 Helper formatter 与独立原生浏览器上下文一致');
        assert.ok(actualFormat.prompt === expectedFormat.prompt, '发运 Helper prompt regex 与独立原生浏览器上下文一致');
        stage = 'MVU 首楼初始化';
        await page.locator('#send_textarea').fill('聊聊书店里的旅行笔记。');
        await page.waitForFunction(() => globalThis.Mvu?.getMvuData({ type: 'message', message_id: 0 })?.stat_data?.trust?.[0] === 10, null, { timeout: 45000 });
        await page.waitForFunction(() => !document.querySelector('#send_but')?.disabled, null, { timeout: 30000 });
        const panel = page.frameLocator('#TH-message--0--0');
        await panel.locator('#read-state').click();
        assert.equal(await panel.locator('#trust').textContent(), '10');
        stage = '首轮生成与 F2';
        await page.locator('#send_but').click();
        await page.waitForFunction(() => !document.querySelector('#mes_stop') && globalThis.Mvu?.getMvuData({ type: 'message' })?.stat_data?.trust?.[0] === 15, null, { timeout: 30000 });
        const read = async () => (await st.call('POST', '/api/chats/get', { avatar_url: fixture.avatar, file_name: fixture.file })).json;
        const storedTrust = async (id, value) => waitFor(async () => {
            const records = await read(), message = records[id + 1];
            return message?.variables?.[message.swipe_id || 0]?.stat_data?.trust?.[0] === value;
        }, { label: '真实F2变量保存', timeoutMs: 10000 });
        const captures = async () => ctx.fixtureHttp.captures({ protocol: 'chat' });
        const prompt = async () => JSON.stringify((await captures()).at(-1)?.body?.messages);
        const expectState = (trust, discussed) => page.waitForFunction(({ trust, discussed }) => {
            const state = globalThis.Mvu?.getMvuData({ type: 'message' })?.stat_data;
            return state?.trust?.[0] === trust && state?.discussed_book?.[0] === discussed && !document.querySelector('#mes_stop');
        }, { trust, discussed }, { timeout: 30000 });
        const panelTrust = async (index, trust) => {
            const panel = page.frameLocator(`#TH-message--${index}--0`);
            await panel.locator('#read-state').click(); assert.equal(await panel.locator('#trust').textContent(), String(trust));
        };
        const reopen = async count => {
            await openDesktopFixture(page, ctx.w05.stBase, fixture, count);
            await page.locator('#send_textarea').fill('NF04 合成就绪检查');
            await page.waitForFunction(() => Boolean(globalThis.Mvu) && !document.querySelector('#send_but')?.disabled);
            await page.locator('#send_textarea').fill('');
        };
        const send = async () => {
            await page.locator('#send_textarea').fill('继续谈旅行笔记里的海边小镇。');
            await page.waitForFunction(() => !document.querySelector('#send_but')?.disabled); await page.locator('#send_but').click();
        };
        await storedTrust(2, 15); await panelTrust(2, 15);
        assert.doesNotMatch(await page.locator('#chat > .mes[mesid="2"] .mes_text').textContent(), /UpdateVariable|_\.set\(|StatusPlaceHolderImpl/,
            '实际 React 消息渲染隐藏显示层协议');
        assert.ok((await prompt()).includes('VC04_BOOK'));
        assert.equal((await prompt()).includes('VC04_EJS_DISCUSS'), false, '首轮EJS读取false');
        assert.equal(/<%|\{\{char\}\}|\{\{user\}\}/.test(await prompt()), false);
        stage = '重开验证首轮变量';
        await reopen(3); await expectState(15, true); await panelTrust(2, 15);
        const addReply = (amount, discussed) => complexReply(0).replace("_.set('trust', 0);", `_.add('trust', ${amount});`)
            .replace("_.set('discussed_book', true);", `_.set('discussed_book', ${discussed});`);
        stage = '第二轮生成与 F2';
        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: addReply(2, true), tool: null });
        await send(); await expectState(17, true); await storedTrust(4, 17); await panelTrust(4, 17);
        assert.ok((await prompt()).includes('VC04_EJS_DISCUSS'), '下一轮真实请求读取MVU新变量');

        // NF-05再接消息编辑控件；这里通过原Helper数据API验编辑与真实MVU按钮重处理。
        stage = 'Helper 编辑回复';
        await page.evaluate(text => TavernHelper.setChatMessages([{ message_id: 4, message: text }]), addReply(4, false));
        stage = 'MVU 重新处理变量';
        const beforeReprocess = (await read())[0].chat_metadata.vc_f2;
        const reprocessSaveRequests = chatSaveRequests;
        await page.getByRole('button', { name: '重新处理变量', exact: true }).click();
        await expectState(19, false); await storedTrust(4, 19); await panelTrust(4, 19);
        const afterReprocess = (await read())[0].chat_metadata.vc_f2;
        assert.equal(chatSaveRequests - reprocessSaveRequests, 1, '重新处理变量整批只发送一次 F2 保存');
        assert.deepEqual(afterReprocess, { ...beforeReprocess, revision: beforeReprocess.revision + 1 }, '重新处理变量完成后 F2 revision 恰好 +1');
        await reopen(5); await expectState(19, false); await panelTrust(4, 19);
        stage = 'EJS worker 与沙箱生成';
        await page.evaluate(() => { EjsTemplate.setFeatures({ compile_workers: true, sandbox: true }); SillyTavern.getContext().saveSettingsDebounced(); });
        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: addReply(1, true), tool: null });
        await send(); await expectState(20, true); await storedTrust(6, 20);
        assert.equal((await prompt()).includes('VC04_EJS_DISCUSS'), false, '编辑重处理后的false进入下一轮EJS');

        stage = 'MVU 重演楼层';
        const beforeReplay = (await captures()).length;
        await page.evaluate(text => TavernHelper.setChatMessages([{ message_id: 2, message: text }]), complexReply(20));
        await page.getByRole('button', { name: '重演楼层', exact: true }).click();
        // Esc保留原取消语义，不能把默认楼层当作已确认输入。
        await page.locator('.vc-sheet').filter({ has: page.locator('input') }).press('Escape');
        await page.locator('.vc-sheet').waitFor({ state: 'detached' });
        await expectState(20, true);
        const beforeReplayToken = (await read())[0].chat_metadata.vc_f2;
        const replaySaveRequests = chatSaveRequests;
        await page.getByRole('button', { name: '重演楼层', exact: true }).click();
        for (const value of ['6', '0']) {
            const sheet = page.locator('.vc-sheet').filter({ has: page.locator('input') });
            const previous = await sheet.elementHandle();
            await sheet.locator('input').fill(value); await sheet.locator('.vc-sheet-done').click();
            await page.waitForFunction(node => !node.isConnected, previous);
        }
        await expectState(25, true); await storedTrust(6, 25); await panelTrust(6, 25);
        assert.equal((await captures()).length, beforeReplay, '重处理/重演不触发额外模型');
        const saved = await read();
        assert.equal(chatSaveRequests - replaySaveRequests, 1, '重演楼层写回和刷新只发送一次 F2 保存');
        assert.deepEqual(saved[0].chat_metadata.vc_f2, { ...beforeReplayToken, revision: beforeReplayToken.revision + 1 }, '重演完成后 F2 revision 恰好 +1');
        assert.ok(saved[7].mes.includes("_.add('trust', 1)"));
        assert.equal(saved[7].variables[0].stat_data.trust[0], 25);
        assert.ok(saved.slice(1).every(message => message.extra?.vc_source?.settled === true), '最终来源已收敛');
        await reopen(7); await expectState(25, true); await panelTrust(6, 25);
        stage = '六作用域变量持久化';
        await page.evaluate(() => {
            for (const type of ['message', 'chat', 'character', 'preset', 'script', 'global']) {
                TavernHelper.insertOrAssignVariables({ ['nf_scope_' + type]: type }, { type, message_id: 6, script_id: 'vc04-mvu' });
            }
        });
        await waitFor(async () => {
            const card = (await st.call('POST', '/api/characters/get', { avatar_url: fixture.avatar })).json;
            const helper = card.data.extensions.tavern_helper;
            return helper.variables?.nf_scope_character === 'character' && helper.scripts.find(script => script.id === 'vc04-mvu').data?.nf_scope_script === 'script';
        }, { timeoutMs: 10000, label: '角色/脚本变量经原卡存储落盘' });
        await waitFor(async () => {
            const packet = (await st.call('POST', '/api/settings/get', {})).json;
            return JSON.parse(packet.settings).extension_settings.variables.global.nf_scope_global === 'global'
                && packet.openai_settings.some(preset => JSON.parse(preset).extensions?.tavern_helper?.variables?.nf_scope_preset === 'preset');
        }, { timeoutMs: 10000, label: '全局/预设变量经原设置与预设存储落盘' });
        await waitFor(async () => { const records = await read(); return records[0].chat_metadata.variables.nf_scope_chat === 'chat'
            && records[7].variables[0].nf_scope_message === 'message'; }, { timeoutMs: 10000, label: '聊天/消息变量经F2落盘' });
        await reopen(7); await expectState(25, true);
        assert.deepEqual(await page.evaluate(() => Object.fromEntries(['message', 'chat', 'character', 'preset', 'script', 'global'].map(type =>
            [type, TavernHelper.getVariables({ type, message_id: 6, script_id: 'vc04-mvu' })['nf_scope_' + type]]))),
        { message: 'message', chat: 'chat', character: 'character', preset: 'preset', script: 'script', global: 'global' });
        // NF-05：在真实MVU卡上生成/切换候选，变量与来源按swipe保存并刷新恢复。
        stage = '候选生成与切换';
        const oldSource = (await read())[7].extra.vc_source.id;
        const beforeSwipe = (await captures()).length;
        await page.evaluate(() => { const c = SillyTavern.getContext(); c.eventSource.makeFirst(c.eventTypes.MESSAGE_SWIPED, () => {
            const m = c.chat.at(-1); if (m.swipes?.[m.swipe_id] === '') globalThis.nf05EmptyCandidate = Object.keys(m.variables[m.swipe_id]).length === 0;
        }); c.eventSource.makeFirst(c.eventTypes.GENERATION_STARTED, type => {
            if (type === 'swipe') { const m = c.chat.at(-1); globalThis.nf05SwipeStart = { at: m.swipe_id, empty: globalThis.nf05EmptyCandidate }; }
        }); });
        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: complexReply(31), tool: null, chunks: 3 });
        const swipe = async action => { await page.locator('#chat>.mes').last().hover(); await page.locator(`#chat>.mes:last-child [data-vc-act="${action}"]`).click(); };
        await swipe('swipe-next'); await expectState(31, true); await storedTrust(6, 31); await panelTrust(6, 31);
        assert.deepEqual(await page.evaluate(() => globalThis.nf05SwipeStart), { at: 1, empty: true }, '真实EJS/MVU生成钩子先读取新候选上下文');
        let selected = (await read())[7]; const newSource = selected.extra.vc_source.id;
        assert.notEqual(newSource, oldSource); assert.equal(selected.variables[0].stat_data.trust[0], 25); assert.equal(selected.variables[1].stat_data.trust[0], 31);
        await swipe('swipe-prev'); await expectState(25, true); await storedTrust(6, 25); await panelTrust(6, 25);
        assert.equal((await read())[7].extra.vc_source.id, oldSource);
        await swipe('swipe-next'); await expectState(31, true); await storedTrust(6, 31);
        assert.equal((await read())[7].extra.vc_source.id, newSource); assert.equal((await captures()).length, beforeSwipe + 1, '切到已有候选不额外生成');
        await reopen(7); await expectState(31, true); await panelTrust(6, 31);
        stage = '窗口与主题切换';
        const originalFrame = await page.locator('#TH-message--6--0').elementHandle();
        const preferredScheme = await page.frameLocator('#TH-message--6--0').locator('html').evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
        await captureWindows(page, ctx, 'nf-cards', async (image, viewport, scheme) => {
            // 每个窗口/主题同时核对真实变量、同一iframe与实际保存的PNG，避免仅凭预览误判内容。
            assert.equal(await page.locator('#TH-message--6--0').evaluate((frame, original) => frame === original, originalFrame), true, '切换窗口/主题不能重建卡片并重跑脚本');
            assert.equal(await page.frameLocator('#TH-message--6--0').locator('html').evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), preferredScheme, '应用主题不能改写卡内系统偏好媒体查询');
            const schemes = await page.evaluate(() => [document.body, document.querySelector('#TH-message--6--0')].map(node => getComputedStyle(node).colorScheme));
            assert.ok(schemes.every(value => value.includes(scheme)), '控件和卡片嵌入元素仍须继承宿主明暗选择');
            await panelTrust(6, 31);
            const state = await page.frameLocator('#TH-message--6--0').locator('body').evaluate(body => {
                const trust = document.querySelector('#trust'), rect = trust.getBoundingClientRect(), style = getComputedStyle(body);
                return { trust: trust.textContent, opacity: style.opacity, visibility: style.visibility, width: rect.width, height: rect.height };
            });
            assert.equal(state.trust, '31'); assert.equal(state.opacity, '1'); assert.equal(state.visibility, 'visible');
            assert.ok(state.width > 0 && state.height > 0, '各窗口/主题的卡片变量文字必须实际参与布局');
            const rect = await page.locator('#TH-message--6--0').boundingBox(), png = PNG.sync.read(image);
            const scale = png.width / viewport.width;
            let textPixels = 0;
            for (let y = Math.max(0, Math.ceil(rect.y * scale)); y < Math.min(png.height, (rect.y + rect.height) * scale); y++) {
                for (let x = Math.max(0, Math.ceil(rect.x * scale)); x < Math.min(png.width, (rect.x + rect.width) * scale); x++) {
                    const pixel = (y * png.width + x) * 4;
                    // 既有合成卡深色面板的白色文字；空白背景不满足该条件，不依赖字体像素精确匹配。
                    if (png.data[pixel] > 180 && png.data[pixel + 1] > 180 && png.data[pixel + 2] > 180) textPixels++;
                }
            }
            assert.ok(textPixels > 20, `${viewport.width}/${scheme}的真实卡片截图应绘出文字和按钮，亮色像素=${textPixels}`);
        });
        await page.evaluate(() => { EjsTemplate.setFeatures({ compile_workers: false, sandbox: false }); SillyTavern.getContext().saveSettingsDebounced(); });
        assert.deepEqual(forbidden, []); assert.deepEqual(errors, []);
        assert.deepEqual(failedResources, [], '发运场景所需的锁定卡片资源必须加载成功');
        return { initialized: 10, generated: 15, nextTurn: 17, reprocessed: 19, replayed: 25, workerAndSandbox: true, ordinaryContentInert: true, attachmentBoundary: true, candidateVariables: [25, 31], nativeRequests: 0 };
    } catch (error) {
        const state = await page.evaluate(() => ({ app: document.documentElement.dataset.vcApp, runtime: document.documentElement.dataset.vcRuntime,
            notice: document.querySelector('#vc-chat-gen')?.textContent, frames: [...document.querySelectorAll('iframe')].map(frame => ({ id: frame.id, kind: frame.dataset.vcCardKind })),
            mvu: Boolean(globalThis.Mvu) }));
        throw new Error(stage + '：' + error.message + ' ' + JSON.stringify({ state, errors, forbidden, failedResources, runtimeErrors }), { cause: error });
    } finally {
        await browser.close();
        const packet = (await st.call('POST', '/api/settings/get', {})).json;
        const finalSettings = JSON.parse(packet.settings);
        finalSettings.extension_settings.EjsTemplate ||= {};
        Object.assign(finalSettings.extension_settings.EjsTemplate, { compile_workers: false, sandbox: false });
        assert.equal((await st.call('POST', '/api/settings/save', finalSettings)).status, 200, '无论场景成败均恢复合成EJS模式');
    }
}

export const desktopCardScene = { id: 'nf-cards', title: 'NF-04 独立桌面真实复杂卡与变量链', needs: ['catalog', 'stack', 'browser'], default: false, run: sceneDesktopCards };
