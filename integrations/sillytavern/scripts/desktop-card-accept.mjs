// NF-04：使用既有合成复杂卡、真实锁定EJS/Helper/MVU与受管provider。
import assert from 'node:assert/strict';
import { createStClient, waitFor } from './managed-lib.mjs';
import { seedDesktopBenchmark, desktopBenchmarkContext } from './desktop-startup-accept.mjs';
import { openDesktopFixture, captureWindows } from './desktop-chat-accept.mjs';
import { complexCard, complexReply } from './lib/complex-card.mjs';

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
    await ctx.fixtureHttp.setOverride('vc03m-chat', { text: complexReply(15), tool: null, chunks: 3 });
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    const context = await desktopBenchmarkContext(browser, ctx), page = await context.newPage();
    const errors = [], forbidden = [], failedResources = [], runtimeErrors = [];
    page.on('pageerror', error => errors.push(error.name + ': ' + error.message));
    page.on('requestfailed', request => { const url = new URL(request.url());
        if (request.resourceType() === 'script') failedResources.push({ origin: url.origin, path: url.pathname, error: request.failure()?.errorText }); });
    page.on('console', message => { if (message.type() === 'error') {
        const error = message.text().match(/(?:ReferenceError|TypeError|SyntaxError):[^\n]{1,180}/)?.[0];
        if (error) runtimeErrors.push(error);
    } });
    page.on('request', request => { const url = new URL(request.url());
        if (['/', '/script.js', '/index.html', '/scripts/extensions.js', '/scripts/st-context.js'].includes(url.pathname)
            || /(?:JS-Slash-Runner|ST-Prompt-Template)\/dist\/index\.js$/.test(url.pathname)) forbidden.push(url.pathname); });
    try {
        await openDesktopFixture(page, ctx.w05.stBase, fixture, 1);
        await page.waitForFunction(() => ['prepared', 'error'].includes(document.documentElement.dataset.vcRuntime));
        if (await page.locator('html').getAttribute('data-vc-runtime') === 'error') {
            await page.evaluate(async fixture => {
                const base = '/scripts/extensions/third-party/vc-model-settings/desktop/standalone/';
                const { createDesktopClient } = await import(base + 'client.js');
                const { prepareChatRuntime } = await import(base + 'runtime.js');
                const { EventEmitter } = await import(base + 'engine/events.js');
                const { event_types } = await import(base + 'engine/st/events.js');
                const client = createDesktopClient(); await client.initialize();
                const characters = await client.characters(), records = await client.readChat(fixture);
                await prepareChatRuntime({ client, context: { characters, characterId: characters.findIndex(row => row.avatar === fixture.avatar),
                    chat: records.slice(1), chatMetadata: records[0].chat_metadata, chatId: fixture.file, name1: '合成用户',
                    name2: 'NF04 合成澄夏', extensionPrompts: {}, eventSource: new EventEmitter(), eventTypes: event_types } });
                throw new Error('首次聊天运行模块初始化失败');
            }, fixture);
        }
        await page.locator('#send_textarea').fill('聊聊书店里的旅行笔记。');
        await page.waitForFunction(() => globalThis.Mvu?.getMvuData({ type: 'message', message_id: 0 })?.stat_data?.trust?.[0] === 10, null, { timeout: 45000 });
        await page.waitForFunction(() => !document.querySelector('#send_but')?.disabled, null, { timeout: 30000 });
        const panel = page.frameLocator('#TH-message--0--0');
        await panel.locator('#read-state').click();
        assert.equal(await panel.locator('#trust').textContent(), '10');
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
        assert.ok((await prompt()).includes('VC04_BOOK'));
        assert.equal((await prompt()).includes('VC04_EJS_DISCUSS'), false, '首轮EJS读取false');
        assert.equal(/<%|\{\{char\}\}|\{\{user\}\}/.test(await prompt()), false);
        await reopen(3); await expectState(15, true); await panelTrust(2, 15);
        const addReply = (amount, discussed) => complexReply(0).replace("_.set('trust', 0);", `_.add('trust', ${amount});`)
            .replace("_.set('discussed_book', true);", `_.set('discussed_book', ${discussed});`);
        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: addReply(2, true), tool: null });
        await send(); await expectState(17, true); await storedTrust(4, 17); await panelTrust(4, 17);
        assert.ok((await prompt()).includes('VC04_EJS_DISCUSS'), '下一轮真实请求读取MVU新变量');

        // NF-05再接消息编辑控件；这里通过原Helper数据API验编辑与真实MVU按钮重处理。
        await page.evaluate(text => TavernHelper.setChatMessages([{ message_id: 4, message: text }]), addReply(4, false));
        await page.getByRole('button', { name: '重新处理变量', exact: true }).click();
        await expectState(19, false); await storedTrust(4, 19); await panelTrust(4, 19);
        await reopen(5); await expectState(19, false); await panelTrust(4, 19);
        await page.evaluate(() => { EjsTemplate.setFeatures({ compile_workers: true, sandbox: true }); SillyTavern.getContext().saveSettingsDebounced(); });
        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: addReply(1, true), tool: null });
        await send(); await expectState(20, true); await storedTrust(6, 20);
        assert.equal((await prompt()).includes('VC04_EJS_DISCUSS'), false, '编辑重处理后的false进入下一轮EJS');

        const beforeReplay = (await captures()).length;
        await page.evaluate(text => TavernHelper.setChatMessages([{ message_id: 2, message: text }]), complexReply(20));
        await page.getByRole('button', { name: '重演楼层', exact: true }).click();
        // Esc保留原取消语义，不能把默认楼层当作已确认输入。
        await page.locator('.vc-sheet').filter({ has: page.locator('input') }).press('Escape');
        await page.locator('.vc-sheet').waitFor({ state: 'detached' });
        await expectState(20, true);
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
        assert.ok(saved[7].mes.includes("_.add('trust', 1)"));
        assert.equal(saved[7].variables[0].stat_data.trust[0], 25);
        assert.ok(saved.slice(1).every(message => message.extra?.vc_source?.settled === true), '最终来源已收敛');
        await reopen(7); await expectState(25, true); await panelTrust(6, 25);
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
        await captureWindows(page, ctx, 'nf-cards');
        await page.evaluate(() => { EjsTemplate.setFeatures({ compile_workers: false, sandbox: false }); SillyTavern.getContext().saveSettingsDebounced(); });
        assert.deepEqual(forbidden, []); assert.deepEqual(errors, []);
        return { initialized: 10, generated: 15, nextTurn: 17, reprocessed: 19, replayed: 25, workerAndSandbox: true, nativeRequests: 0 };
    } catch (error) {
        const state = await page.evaluate(() => ({ app: document.documentElement.dataset.vcApp, runtime: document.documentElement.dataset.vcRuntime,
            notice: document.querySelector('#vc-chat-gen')?.textContent, frames: [...document.querySelectorAll('iframe')].map(frame => ({ id: frame.id, kind: frame.dataset.vcCardKind })),
            mvu: Boolean(globalThis.Mvu) }));
        throw new Error(error.message + ' ' + JSON.stringify({ state, errors, forbidden, failedResources, runtimeErrors }));
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
