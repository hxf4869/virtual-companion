// NF-03：自有桌面真实普通聊天纵切，只调用受管合成provider。
import assert from 'node:assert/strict';
import path from 'node:path';
import { createStClient, waitFor } from './managed-lib.mjs';
import { seedDesktopBenchmark, desktopBenchmarkContext } from './desktop-startup-accept.mjs';
import { bindForeground } from './lib/accept-scene-helpers.mjs';

const CASES = [
    { id: 'chat-stream', provider: 'vc03m-chat', profile: 'chat', model: 'vc03m-chat', protocol: 'chat', stream: true },
    { id: 'responses-stream', provider: 'vc03m-resp', profile: 'usage', model: 'vc03m-usage', protocol: 'responses', stream: true },
    { id: 'claude-stream', provider: 'vc03m-claude', profile: 'chat', model: 'vc03m-chat', protocol: 'anthropic', stream: true },
    { id: 'claude-tool-loop-stream', provider: 'vc03m-claude', profile: 'chat', model: 'vc03m-chat', protocol: 'anthropic', stream: true, tools: true },
    { id: 'chat-json', provider: 'vc03m-chat', profile: 'chat', model: 'vc03m-chat', protocol: 'chat', stream: false },
    { id: 'responses-json', provider: 'vc03m-resp', profile: 'usage', model: 'vc03m-usage', protocol: 'responses', stream: false },
    { id: 'claude-json', provider: 'vc03m-claude', profile: 'chat', model: 'vc03m-chat', protocol: 'anthropic', stream: false },
    { id: 'planner', provider: 'vc03m-chat', profile: 'chat', model: 'vc03m-chat', protocol: 'chat', stream: true, planner: true },
    { id: 'recovery', provider: 'vc03m-chat', profile: 'chat', model: 'vc03m-chat', protocol: 'chat', stream: true, recovery: true },
];

export async function openDesktopFixture(page, base, fixture, messages = 24) {
    await page.goto(base + '/desktop/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.vcApp === 'ready');
    const id = fixture.chat[0].chat_metadata.vc_binding.relationshipId;
    await page.locator(`[data-convo-list] [data-relationship-id="${id}"]`).click();
    await page.waitForFunction(count => document.querySelectorAll('#chat > .mes').length === count, messages);
}

async function captureWindows(page, ctx) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        for (const scheme of ['light', 'dark']) {
            await page.evaluate(async mode => (await import('/scripts/extensions/third-party/vc-model-settings/ui/theme.js')).setThemeMode(mode), scheme);
            await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations()
                .filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity)
                .map(animation => animation.finished.catch(() => {}))); });
            const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.body.scrollWidth,
                input: document.querySelector('#send_textarea').getBoundingClientRect().toJSON(),
                last: document.querySelector('#chat>.mes:last-child').getBoundingClientRect().toJSON(),
                send: document.querySelector('#send_but').getBoundingClientRect().toJSON() }));
            assert.ok(geometry.scrollWidth <= geometry.width + 1);
            assert.ok(geometry.input.left >= 0 && geometry.input.right <= geometry.width + 1);
            assert.ok(geometry.last.bottom <= geometry.input.top + 1 && geometry.last.top >= 0,
                `保持底部时窗口调整后仍应看到最新回复 ${JSON.stringify({ last: geometry.last.bottom, input: geometry.input.top, width: geometry.width })}`);
            assert.ok(geometry.send.width >= 36 && geometry.send.height >= 36);
            await page.screenshot({ path: path.join(ctx.artifactsDir, `nf-chat-${viewport.width}-${scheme}.png`) });
        }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
}

async function recoveryChecks({ ctx, st, page, fixture, other, reply }) {
    const read = async target => {
        const response = await st.call('POST', '/api/chats/get', { avatar_url: target.avatar, file_name: target.file });
        assert.equal(response.status, 200); return response.json;
    };
    const input = page.locator('#send_textarea');
    const send = async text => {
        await input.fill(text); await page.waitForFunction(() => !document.querySelector('#send_but')?.disabled);
        await page.locator('#send_but').click();
    };
    const notice = text => page.waitForFunction(value => document.querySelector('#vc-chat-gen')?.textContent.includes(value)
        && !document.querySelector('#mes_stop'), text);
    const done = () => page.waitForFunction(text => document.querySelector('#chat>.mes:last-child .mes_text')?.textContent === text
        && !document.querySelector('#mes_stop'), reply);

    // 服务端已提交用户消息、ACK仍在途时输入下一份草稿；旧ACK不能清掉它。
    let fetched = false, held = false, release;
    const gate = new Promise(resolve => { release = resolve; });
    const holdSave = async route => {
        if (held) { await route.continue(); return; }
        held = true; const response = await route.fetch(); fetched = true;
        await gate; await route.fulfill({ response });
    };
    await page.route('**/api/chats/save', holdSave);
    const lateDraft = 'NF03 晚到ACK期间输入的新草稿';
    await ctx.fixtureHttp.setOverride('vc03m-chat', { error: { status: 500, message: 'synthetic failure' } });
    try {
        await send('NF03 合成失败输入');
        await waitFor(() => fetched, { timeoutMs: 10000, label: 'F2真实ACK已捕获' });
        await input.fill(lateDraft); release();
        await notice('没有发送成功');
    } finally { release(); await page.unroute('**/api/chats/save', holdSave); }
    assert.equal(await input.inputValue(), lateDraft);
    const beforeRetry = await read(fixture);
    await ctx.fixtureHttp.setOverride('vc03m-chat', { text: reply });
    await page.locator('#vc-chat-gen button').filter({ hasText: '重试' }).click(); await done();
    const afterRetry = await read(fixture);
    assert.equal(afterRetry.filter(message => message.is_user).length, beforeRetry.filter(message => message.is_user).length, '重试回复不重复写用户消息');
    assert.equal(await input.inputValue(), lateDraft, '重试也不消费新草稿');

    // 实际慢速provider：停止保留部分回复与来源，不把部分回复变成长时记忆证据。
    const slow = { text: 'NF03 合成慢速回复，用来验证停止与切会话。'.repeat(5), chunks: 10, delay: { firstMs: 100, perChunkMs: 180 } };
    await ctx.fixtureHttp.setOverride('vc03m-chat', slow);
    const stopCount = await page.locator('#chat>.mes').count() + 2;
    await send('NF03 合成停止输入');
    await page.waitForFunction(count => document.querySelector('#mes_stop') && document.querySelectorAll('#chat>.mes').length === count
        && document.querySelector('#chat>.mes:last-child')?.getAttribute('is_user') === 'false', stopCount);
    await input.fill('NF03 停止时保留的草稿'); await page.locator('#mes_stop').click(); await notice('已停止');
    let saved = await read(fixture);
    assert.equal(saved.at(-1).extra.finish_reason, 'cancelled'); assert.equal(saved.at(-1).extra.no_memory, true);
    assert.equal(await input.inputValue(), 'NF03 停止时保留的草稿');
    await waitFor(async () => (await ctx.fixtureHttp.captures({ protocol: 'chat' })).at(-1)?.aborted === true,
        { timeoutMs: 5000, label: '受管provider收到真实停止' });

    await ctx.fixtureHttp.setOverride('vc03m-chat', { ...slow, abortAfterChunks: 2 });
    await send('NF03 合成断网输入'); await notice('没有发送成功');
    saved = await read(fixture);
    assert.equal(saved.at(-1).extra.finish_reason, 'error'); assert.equal(saved.at(-1).extra.no_memory, true);
    assert.ok(saved.at(-1).mes.length > 0, '断流部分回复仍存在JSONL中');

    // 同账号另一消费者先提交，桌面必须409保留草稿并等待显式读取最新。
    saved.push({ name: '合成另一端', is_user: true, mes: 'NF03 另一端已保存', send_date: new Date().toISOString(), extra: {} });
    assert.equal((await st.call('POST', '/api/chats/save', { avatar_url: fixture.avatar, file_name: fixture.file, chat: saved })).status, 200);
    await ctx.fixtureHttp.setOverride('vc03m-chat', { text: reply });
    const beforeConflict = await ctx.fixtureHttp.count({ protocol: 'chat' });
    const casDraft = 'NF03 CAS合成草稿{{input}}';
    await send(casDraft); await notice('这段对话已在另一处更新');
    assert.equal(await input.inputValue(), casDraft);
    assert.equal(await ctx.fixtureHttp.count({ protocol: 'chat' }), beforeConflict, '保存冲突不得发模型请求');
    assert.ok(!(await read(fixture)).some(message => message.mes === 'NF03 CAS合成草稿'));
    const conflict = page.locator('#vc-f2-conflict');
    await conflict.waitFor({ state: 'visible' });
    assert.equal(await conflict.evaluate(panel => panel.open), true);
    assert.equal(await conflict.locator('[data-action="keep-draft"]').count(), 1);
    await conflict.locator('[data-action="view-latest"]').click();
    await conflict.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('#send_but')?.disabled);
    assert.equal(await input.inputValue(), casDraft);
    await page.locator('#send_but').click(); await done();
    saved = await read(fixture); assert.equal(saved.at(-2).mes, 'NF03 CAS合成草稿');

    await ctx.fixtureHttp.setOverride('vc03m-chat', slow);
    const switchCount = await page.locator('#chat>.mes').count() + 2;
    await send('NF03 合成切会话输入');
    await page.waitForFunction(count => document.querySelector('#mes_stop') && document.querySelectorAll('#chat>.mes').length === count
        && document.querySelector('#chat>.mes:last-child')?.getAttribute('is_user') === 'false', switchCount);
    await input.fill('NF03 A草稿');
    const otherId = other.chat[0].chat_metadata.vc_binding.relationshipId;
    await page.locator(`[data-convo-list] [data-relationship-id="${otherId}"]`).click();
    await page.waitForFunction(() => document.querySelectorAll('#chat>.mes').length === 24);
    await input.fill('NF03 B草稿'); await page.waitForFunction(() => !document.querySelector('#send_but')?.disabled);
    assert.equal(await input.inputValue(), 'NF03 B草稿');
    assert.equal(await page.locator('#chat>.mes:last-child .mes_text').textContent(), '合成基准消息 24。');
    assert.equal((await read(other)).length, other.chat.length, '迟到旧回复不能写进新会话');
    const old = await read(fixture); assert.equal(old.at(-1).extra.finish_reason, 'cancelled');
    const firstId = fixture.chat[0].chat_metadata.vc_binding.relationshipId;
    await page.locator(`[data-convo-list] [data-relationship-id="${firstId}"]`).click();
    await page.waitForFunction(count => document.querySelectorAll('#chat>.mes').length === count, old.length - 1);
    assert.equal(await input.inputValue(), 'NF03 A草稿', '同文件名不同角色的草稿必须隔离');
    await openDesktopFixture(page, ctx.w05.stBase, fixture, old.length - 1);
    assert.equal(await input.inputValue(), 'NF03 A草稿', '刷新恢复既有vc-draft存储中的作用域草稿');
    return { httpError: true, retry: true, lateAckDraft: true, stop: true, interruptedStream: true, cas: true, switchChat: true, scopedDraftRefresh: true };
}

async function sceneDesktopChat(ctx) {
    const selected = process.env.VC_NF_CHAT_CASES ? CASES.filter(row => process.env.VC_NF_CHAT_CASES.split(',').includes(row.id)) : CASES;
    assert.ok(selected.length);
    const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: ctx.secrets.session,
        extraCookies: 'vc_session=' + ctx.secrets.session.vcSession + '; vc_csrf=' + ctx.secrets.session.vcCsrf });
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    const completed = [];
    try {
        for (const row of selected) {
            console.log('[nf-chat] ' + row.id);
            const fixture = await seedDesktopBenchmark(ctx);
            const other = row.recovery ? await seedDesktopBenchmark(ctx) : null;
            await bindForeground(ctx, row.provider, row.profile, row.model);
            const packet = (await st.call('POST', '/api/settings/get', {})).json;
            const settings = JSON.parse(packet.settings);
            settings.oai_settings ||= {}; settings.extension_settings ||= {};
            settings.power_user ||= {}; settings.power_user.send_on_enter = 0;
            Object.assign(settings.oai_settings, { stream_openai: row.stream, function_calling: row.tools || false, show_thoughts: true });
            settings.extension_settings.vc_reply_planner = row.planner || false;
            assert.equal((await st.call('POST', '/api/settings/save', settings)).status, 200);
            const reply = 'NF03 合成回复。';
            await ctx.fixtureHttp.setOverride(row.model, { text: reply, reasoning: { text: 'NF03 合成推理。', encrypted: false },
                tool: null, delay: { firstMs: 30, perChunkMs: 30 }, chunks: 3,
                ...(row.planner ? { replyPlanner: '{"kind":"reply","direction":"合成方向"}' } : {}) });
            const context = await desktopBenchmarkContext(browser, ctx), page = await context.newPage();
            page.setDefaultTimeout(30000);
            const forbidden = [], errors = [];
            page.on('request', request => {
                const pathname = new URL(request.url()).pathname;
                if (['/', '/index.html', '/script.js', '/scripts/extensions.js', '/scripts/st-context.js'].includes(pathname)) forbidden.push(pathname);
            });
            page.on('pageerror', error => errors.push(error.name + ': ' + error.message));
            let stage = 'open';
            try {
                const before = await ctx.fixtureHttp.count({ protocol: row.protocol });
                await openDesktopFixture(page, ctx.w05.stBase, fixture);
                stage = 'ready-to-send';
                const input = 'NF03 合成输入 ' + row.id;
                await page.locator('#send_textarea').fill(input);
                await page.waitForFunction(() => !document.querySelector('#send_but')?.disabled);
                assert.equal(await ctx.fixtureHttp.count({ protocol: row.protocol }), before, '打开/配置不能调用模型');
                // 同一真实按钮连击：第二次到达旧React props时也须由唯一owner拒绝。
                if (row.id === 'chat-stream') await page.locator('#send_but').dblclick();
                else if (row.id === 'chat-json') await page.locator('#send_textarea').press('Enter');
                else await page.locator('#send_but').evaluate(button => { button.click(); button.click(); });
                stage = 'receive';
                await page.waitForFunction(text => !document.querySelector('#mes_stop') &&
                    (document.querySelector('#chat > .mes:last-child .mes_text')?.textContent === text || document.querySelector('#vc-chat-gen')?.textContent), reply);
                assert.equal(await page.locator('#chat>.mes:last-child .mes_text').textContent(), reply);
                assert.equal(await ctx.fixtureHttp.count({ protocol: row.protocol }), before + (row.planner ? 2 : 1), '双击只允许一条回复流程（开启planner时含原有quiet规划）');
                const saved = (await st.call('POST', '/api/chats/get', { avatar_url: fixture.avatar, file_name: fixture.file })).json;
                assert.equal(saved.length, fixture.chat.length + 2, '原生JSONL保留24条历史并只追加一对消息');
                assert.equal(saved.at(-2).mes, input); assert.equal(saved.at(-1).mes, reply);
                if (row.protocol !== 'chat' && !row.tools) assert.equal(saved.at(-1).extra.reasoning, 'NF03 合成推理。');
                assert.notEqual(saved.at(-2).name, 'unused'); assert.equal(saved.at(-1).name, 'NF 合成角色');
                assert.ok(saved[0].chat_metadata.vc_f2.revision > fixture.chat[0].chat_metadata.vc_f2.revision);
                assert.equal(saved.at(-1).extra.vc_source.settled, true);
                assert.equal(await page.locator('#send_textarea').inputValue(), '');
                const capture = (await ctx.fixtureHttp.captures({ protocol: row.protocol })).at(-1);
                if (row.planner) assert.ok(JSON.stringify(capture.body).includes('合成方向'), '原有planner必须真实规划并注入回复');
                assert.equal(capture.auth.matched, true); assert.equal(capture.model, row.model); assert.equal(capture.stream, row.stream);
                assert.equal(await page.locator('iframe').count(), 0); assert.deepEqual(forbidden, []); assert.deepEqual(errors, []);
                if (row.id === 'chat-stream') await captureWindows(page, ctx);
                await openDesktopFixture(page, ctx.w05.stBase, fixture, 26);
                assert.equal(await page.locator('#chat > .mes:last-child .mes_text').textContent(), reply);
                const recovery = row.recovery ? await recoveryChecks({ ctx, st, page, fixture, other, reply }) : undefined;
                assert.deepEqual(forbidden, []); assert.deepEqual(errors, []);
                completed.push({ id: row.id, persisted: true, refresh: true,
                    modelCalls: await ctx.fixtureHttp.count({ protocol: row.protocol }) - before, nativeRequests: 0, ...(recovery ? { recovery } : {}) });
            } catch (error) {
                const state = await page.evaluate(() => ({ app: document.documentElement.dataset.vcApp,
                    runtime: document.documentElement.dataset.vcRuntime, messages: document.querySelectorAll('#chat>.mes').length,
                    notice: document.querySelector('#vc-chat-gen')?.textContent, sending: Boolean(document.querySelector('#mes_stop')),
                    disabled: document.querySelector('#send_but')?.disabled }));
                if (state.runtime === 'error' || stage === 'ready-to-send') {
                    await page.evaluate(async fixture => {
                        const root = '/scripts/extensions/third-party/vc-model-settings/desktop/standalone/';
                        const { createDesktopClient } = await import(root + 'client.js');
                        const { prepareChatRuntime } = await import(root + 'runtime.js');
                        const { EventEmitter } = await import(root + 'engine/events.js');
                        const { event_types } = await import(root + 'engine/st/events.js');
                        const client = createDesktopClient(); await client.initialize();
                        const context = { characters: await client.characters(), chat: [], chatMetadata: {}, chatId: '', extensionPrompts: {},
                            eventSource: new EventEmitter(), eventTypes: event_types };
                        const session = await prepareChatRuntime({ client, context });
                        await session.activate(fixture, await client.readChat(fixture));
                    }, { avatar: fixture.avatar, file: fixture.file });
                }
                throw new Error(`${row.id}/${stage}: ${error.message}; ${JSON.stringify({ state, errors })}`);
            } finally { await context.close(); await ctx.fixtureHttp.setOverride(row.model, null); }
        }
        return { cases: completed };
    } finally { await browser.close(); }
}

export const desktopChatScene = { id: 'nf-chat', title: 'NF-03 独立桌面普通聊天、三协议/F2与恢复', needs: ['catalog', 'stack', 'browser'], default: false, run: sceneDesktopChat };
