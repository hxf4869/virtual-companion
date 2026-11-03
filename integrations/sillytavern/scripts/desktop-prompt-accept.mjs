// NF-02：原生实际请求与独立计算模块逐字段对照；只使用受管合成数据，不发送模型请求。
import assert from 'node:assert/strict';
import { createStClient } from './managed-lib.mjs';
import { seedDesktopBenchmark, desktopBenchmarkContext, ensureNativeConnection, confirmSyntheticNativeProxy } from './desktop-startup-accept.mjs';
import { bindForeground, providerCatalogSpec } from './lib/accept-scene-helpers.mjs';
import { openStCharacterChat } from './lib/open-st-chat.mjs';
import { nativeReady } from './f2-chat-accept.mjs';

const ROOT = '/scripts/extensions/third-party/vc-model-settings/';
const MEMORY_PATH = '/api/plugins/virtual-companion/go/api/v1/st/memory/recall';
const identityHeaders = request => ({ accountId: request.headers()['x-vc-expected-account-id'], sessionId: request.headers()['x-vc-expected-session-id'] });
const CASES = [
    { id: 'chat-modern', provider: 'vc03m-chat', profile: 'chat', model: 'vc03m-chat', modern: true },
    { id: 'responses-modern', provider: 'vc03m-resp', profile: 'reasoning', model: 'vc03m-reasoning', modern: true },
    { id: 'claude-modern', provider: 'vc03m-claude', profile: 'chat', model: 'vc03m-chat', modern: true },
    { id: 'chat-legacy', provider: 'vc03m-chat', profile: 'chat', model: 'vc03m-chat', modern: false },
];

function paths(a, b, prefix = '') {
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return [prefix];
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => paths(a[key], b[key], prefix ? prefix + '.' + key : key)).slice(0, 20);
}

async function scenePromptParity(ctx) {
    const selected = process.env.VC_NF_PROMPT_CASES ? CASES.filter(row => process.env.VC_NF_PROMPT_CASES.split(',').includes(row.id)) : CASES;
    assert.ok(selected.length, '至少选择一组真实合成输入');
    const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: ctx.secrets.session,
        extraCookies: 'vc_session=' + ctx.secrets.session.vcSession + '; vc_csrf=' + ctx.secrets.session.vcCsrf });
    const catalog = providerCatalogSpec(ctx.secrets.fixtureKey).find(row => row.providerId === 'vc03m-chat');
    const current = (await ctx.admin.listProviders()).json.find(row => row.providerId === catalog.providerId);
    catalog.models.find(row => row.profileKey === 'chat').contextWindowTokens = 4096;
    catalog.models.find(row => row.profileKey === 'chat').maxOutputTokens = 256;
    assert.equal((await ctx.admin.saveProvider(catalog.providerId, { ...catalog, expectedRevision: current.revision })).status, 200);
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    const completed = [];
    try {
        for (const test of selected) {
            console.log('[nf-prompts] ' + test.id);
            const fixture = await seedDesktopBenchmark(ctx);
            await bindForeground(ctx, test.provider, test.profile, test.model);
            const read = await st.call('POST', '/api/chats/get', { avatar_url: fixture.avatar, file_name: fixture.file });
            assert.equal(read.status, 200);
            const records = read.json;
            records[0].chat_metadata.variables = { topic: '旅行笔记', prompt_seen: 0 };
            for (const message of records.slice(1)) message.mes = ('合成上下文。').repeat(30);
            records.push({ name: '合成验收用户', is_user: true, mes: 'NF_INPUT 旅行笔记', send_date: '2026-11-03T00:00:00.000Z' });
            assert.equal((await st.call('POST', '/api/chats/save', { avatar_url: fixture.avatar, file_name: fixture.file, chat: records })).status, 200);
            const book = 'NF-计算世界书';
            const entry = (uid, key, content, extra = {}) => ({ uid, key: [key], keysecondary: [], content, comment: '合成条目',
                constant: false, selective: false, order: 100 - uid, position: 0, disable: false, excludeRecursion: false,
                preventRecursion: false, delayUntilRecursion: false, probability: 100, useProbability: true, ...extra });
            assert.equal((await st.call('POST', '/api/worldinfo/edit', { name: book, data: { entries: {
                0: entry(0, 'NF_REPLACED', 'NF_BOOK 海边 {{getvar::topic}}', { sticky: 2, cooldown: 1 }),
                1: entry(1, '海边', 'NF_RECURSION'),
            } } })).status, 200);
            const reference = await desktopBenchmarkContext(browser, ctx);
            const candidate = await desktopBenchmarkContext(browser, ctx);
            // 两个独立 realm；候选侧阻断应用聊天初始化，直接用相同解析输入调用实际计算入口。
            await candidate.route('**/desktop/standalone/runtime.js', route => route.abort());
            const oldPage = await reference.newPage(), newPage = await candidate.newPage();
            oldPage.setDefaultTimeout(60000); newPage.setDefaultTimeout(60000);
            const memoryExchanges = [];
            let preparedContext;
            await oldPage.route('**' + MEMORY_PATH, async route => {
                // 在真实召回发出前记录同一份内存输入；存储会规范化来源字段，不能拿磁盘字段替代原生内存。
                preparedContext = await oldPage.evaluate(() => JSON.parse(JSON.stringify({
                    chatMetadata: SillyTavern.getContext().chatMetadata, chat: SillyTavern.getContext().chat,
                })));
                await route.continue();
            });
            oldPage.on('response', response => {
                if (new URL(response.url()).pathname !== MEMORY_PATH) return;
                // Playwright读取响应副本，不消费页面fetch。只在内存保留本组合成输入。
                memoryExchanges.push((async () => ({ request: response.request().postDataJSON(), identity: identityHeaders(response.request()),
                    status: response.status(), body: await response.body() }))());
            });
            let release, captured;
            const capturedRequest = new Promise(resolve => { captured = resolve; });
            const hold = new Promise(resolve => { release = resolve; });
            await oldPage.route('**/api/backends/chat-completions/generate', async route => {
                captured(route.request().postDataJSON());
                await hold;
                await route.abort('aborted');
            });
            let generation;
            try {
                await oldPage.goto(ctx.w05.stBase + '/native/', { waitUntil: 'domcontentloaded' });
                await nativeReady(oldPage);
                await openStCharacterChat(oldPage, fixture);
                await ensureNativeConnection(oldPage);
                const input = await oldPage.evaluate(async ({ root, modern, book }) => {
                    const script = await import('/script.js');
                    const { power_user } = await import('/scripts/power-user.js');
                    const world = await import('/scripts/world-info.js');
                    const { cancelDebouncedMetadataSave } = await import('/scripts/extensions.js');
                    const tokenizers = await import('/scripts/tokenizers.js');
                    const { moment } = await import('/lib.js');
                    const context = SillyTavern.getContext();
                    moment.now = () => Date.parse('2026-11-03T00:00:00.000Z');
                    Math.random = () => 0.5;
                    power_user.experimental_macro_engine = modern;
                    power_user.console_log_prompts = false;
                    const settings = context.chatCompletionSettings;
                    settings.function_calling = true;
                    settings.squash_system_messages = true;
                    const main = settings.prompts.find(row => row.identifier === 'main');
                    main.content = '{{setvar::prompt_seen::1}}NF_PRESET {{char}} / {{user}} / {{getvar::topic}}';
                    context.characters[context.characterId].data.extensions.world = book;
                    context.characters[context.characterId].data.extensions.regex_scripts = [{
                        id: 'nf-regex', scriptName: '合成正则', findRegex: '/NF_INPUT/g', replaceString: 'NF_REPLACED',
                        trimStrings: [], placement: [1, 2, 5], disabled: false, markdownOnly: false, promptOnly: true,
                        runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
                    }];
                    context.extensionSettings.character_allowed_regex ||= [];
                    context.extensionSettings.character_allowed_regex.push(context.characters[context.characterId].avatar);
                    // 复用原设置入口设置递归，不使用临时DOM值来替代计算输入。
                    const worldSettings = { ...world.getWorldInfoSettings(), world_info_recursive: true,
                        world_info: { ...world.getWorldInfoSettings().world_info, globalSelect: [] } };
                    world.setWorldInfoSettings(worldSettings, { world_names: [book] });
                    // 纯计算的外部输入保持固定；清除原生UI待保存项，并预热实际tokenizer。
                    // 各计算检查点取消新排入的UI元数据计时器，真实F2写入由nf-chat/f2-chat-ui验。
                    await tokenizers.countTokensOpenAIAsync({ role: 'user', content: 'NF tokenizer warmup' }, true);
                    cancelDebouncedMetadataSave();
                    await script.saveChat();
                    const saved = await fetch('/api/settings/get', { method: 'POST', headers: script.getRequestHeaders(), body: '{}' }).then(response => response.json());
                    const raw = JSON.parse(saved.settings);
                    raw.oai_settings = settings; raw.power_user = power_user; raw.extension_settings = context.extensionSettings;
                    raw.world_info_settings = world.getWorldInfoSettings(); raw.tag_map = context.tagMap;
                    const traces = [];
                    const watched = ['GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS', 'WORLDINFO_ENTRIES_LOADED', 'WORLDINFO_SCAN_DONE',
                        'WORLD_INFO_ACTIVATED', 'GENERATE_BEFORE_COMBINE_PROMPTS', 'GENERATE_AFTER_COMBINE_PROMPTS',
                        'CHAT_COMPLETION_PROMPT_READY', 'GENERATE_AFTER_DATA', 'CHAT_COMPLETION_SETTINGS_READY'];
                    for (const key of watched) context.eventSource.on(context.eventTypes[key], () => { cancelDebouncedMetadataSave(); traces.push(key); });
                    globalThis.nfTrace = traces;
                    return JSON.parse(JSON.stringify({ context: { characters: context.characters, characterId: context.characterId,
                        chat: context.chat, chatMetadata: context.chatMetadata, chatId: context.chatId, groupId: context.groupId,
                        name1: context.name1, name2: context.name2, extensionPrompts: context.extensionPrompts, firstDisplayedMessageId:
                            Number(document.querySelector('#chat>.mes')?.getAttribute('mesid') || 0) },
                        raw, presets: Object.fromEntries(saved.openai_setting_names.map((name, index) => [name, JSON.parse(saved.openai_settings[index])])), watched }));
                }, { root: ROOT, modern: test.modern, book });
                generation = oldPage.evaluate(() => SillyTavern.getContext().generate('normal', { automatic_trigger: true }));
                // scope 随打开会话/生成改变；原生 Claude 可能在生成前再次确认新标记。
                const nativeRequest = test.provider === 'vc03m-claude'
                    ? Promise.race([capturedRequest, confirmSyntheticNativeProxy(oldPage).then(() => capturedRequest)])
                    : capturedRequest;
                let deadline;
                const timeout = new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('原生未产生待对照请求')), 45000); });
                let expected;
                const endedBeforeRequest = generation.then(async () => {
                    const state = await oldPage.evaluate(async () => ({
                        trace: globalThis.nfTrace, generating: (await import('/script.js')).isGenerating(),
                        overlays: [...document.querySelectorAll('dialog[open]')].map(node => node.id),
                    }));
                    throw new Error('原生在请求前结束：' + JSON.stringify(state));
                });
                try { expected = await Promise.race([nativeRequest, endedBeforeRequest, timeout]); } finally { clearTimeout(deadline); }
                const expectedState = await oldPage.evaluate(length => JSON.parse(JSON.stringify({
                    metadata: SillyTavern.getContext().chatMetadata,
                    chat: SillyTavern.getContext().chat.slice(0, length),
                    globals: SillyTavern.getContext().extensionSettings.variables,
                    trace: globalThis.nfTrace,
                })), input.context.chat.length);
                const memory = await Promise.all(memoryExchanges);
                assert.equal(memory.length, 1, '参考页必须实际完成一轮记忆召回');
                assert.equal(memory[0].status, 200, '参考记忆端口必须真实成功');
                // NF-10 原生提示词准备先提交 metadata；纯计算的输入从同一已落盘边界开始。
                // 保留全部最终请求/状态/外部请求断言，并明确验证这次 F2 提交没有预先执行宏。
                const prepared = await st.call('POST', '/api/chats/get', { avatar_url: fixture.avatar, file_name: fixture.file });
                assert.equal(prepared.status, 200);
                const preparedMetadata = prepared.json[0].chat_metadata;
                assert.deepEqual(preparedMetadata.vc_f2, { id: input.context.chatMetadata.vc_f2.id, revision: input.context.chatMetadata.vc_f2.revision + 1 });
                assert.equal(preparedMetadata.vc_f2.revision, memory[0].request.revision);
                assert.deepEqual(preparedContext.chatMetadata.vc_f2, preparedMetadata.vc_f2);
                assert.deepEqual(preparedMetadata.variables, input.context.chatMetadata.variables, '持久化边界不能预执行提示词变量宏');
                assert.deepEqual(preparedContext.chatMetadata.variables, input.context.chatMetadata.variables);
                const promptInput = messages => messages.map(({ name, is_user, is_system, mes, send_date, vc_message_id, variables }) => ({ name, is_user, is_system, mes, send_date, vc_message_id, variables }));
                assert.deepEqual(promptInput(prepared.json.slice(1)), promptInput(input.context.chat), 'F2准备必须保持同一计算输入');
                assert.deepEqual(promptInput(preparedContext.chat), promptInput(input.context.chat));
                input.context.chatMetadata = preparedContext.chatMetadata;
                input.context.chat = preparedContext.chat;
                let memoryUsed = 0;
                const memoryDifferences = [];
                await candidate.route('**' + MEMORY_PATH, async route => {
                    const recorded = memory[memoryUsed++];
                    const differences = recorded ? paths({ request: recorded.request, identity: recorded.identity },
                        { request: route.request().postDataJSON(), identity: identityHeaders(route.request()) }) : ['extra-call'];
                    memoryDifferences.push(...differences);
                    // 原生宏的1秒保存会推进服务器F2版本。纯计算对照必须使用同一份外部输入，
                    // 完整请求/身份匹配后才回放刚录制的真实响应；真实召回/保存冲突另由NF-03验。
                    await route.fulfill(differences.length ? { status: 409, json: { code: 'NF_PARITY_INPUT_MISMATCH' } }
                        : { status: recorded.status, contentType: 'application/json', body: recorded.body });
                });
                const nativePaths = [];
                newPage.on('request', request => { const url = new URL(request.url()).pathname; if (['/', '/script.js', '/scripts/extensions.js', '/scripts/st-context.js'].includes(url)) nativePaths.push(url); });
                await newPage.goto(ctx.w05.stBase + '/desktop/', { waitUntil: 'domcontentloaded' });
                await newPage.waitForFunction(() => document.documentElement.dataset.vcApp === 'ready');
                const actual = await newPage.evaluate(async ({ root, input }) => {
                    const { createDesktopClient } = await import(root + 'desktop/standalone/client.js');
                    const { EventEmitter } = await import(root + 'desktop/standalone/engine/events.js');
                    const { event_types } = await import(root + 'desktop/standalone/engine/st/events.js');
                    const { createChatEngine, runtimeSettings } = await import(root + 'desktop/standalone/engine/runtime.js');
                    const { resolveForegroundProjection } = await import(root + 'projection.js');
                    const { fetchModelPurposes, fetchProviders } = await import(root + 'api.js');
                    const { moment } = await import('/lib.js');
                    moment.now = () => Date.parse('2026-11-03T00:00:00.000Z'); Math.random = () => 0.5;
                    const client = createDesktopClient(); await client.initialize();
                    const context = { ...input.context, eventSource: new EventEmitter(), eventTypes: event_types };
                    const settings = runtimeSettings(input.raw);
                    const [purposes, providers] = await Promise.all([fetchModelPurposes(), fetchProviders()]);
                    const decision = resolveForegroundProjection(purposes, providers);
                    const models = providers.flatMap(provider => provider.models.map(model => ({ id: model.modelId, ...model })));
                    const engine = await createChatEngine({ client, context, settings, decision, presets: input.presets, models });
                    const trace = [];
                    for (const key of input.watched) context.eventSource.on(event_types[key], () => trace.push(key));
                    const packet = await engine.prepare({ type: 'normal', automatic_trigger: true });
                    return JSON.parse(JSON.stringify({ packet, state: { metadata: context.chatMetadata, chat: context.chat,
                        globals: context.extensionSettings.variables, trace } }));
                }, { root: ROOT, input });
                assert.deepEqual(memoryDifferences, [], '记忆外部输入请求/页面身份必须一致');
                assert.equal(memoryUsed, memory.length, '候选不得多调或漏调记忆端口');
                assert.ok(JSON.stringify(expected).includes('NF_BOOK'), '参考世界书必须真实触发');
                assert.ok(JSON.stringify(expected).includes('NF_RECURSION'), '参考世界书必须真实递归');
                assert.ok(JSON.stringify(expected).includes('NF_REPLACED'), '参考正则必须真实运行');
                assert.ok(JSON.stringify(expected).includes('NF_PRESET'), '参考预设必须真实运行');
                assert.deepEqual(nativePaths, [], '候选计算不能加载完整酒馆');
                const bodyDiff = paths(expected, actual.packet?.body);
                const stateDiff = paths(expectedState, actual.state);
                assert.deepEqual(bodyDiff, [], '最终序列化请求不等价：' + bodyDiff.join(',') + '; checkpoints=' + JSON.stringify({
                    nativeMemory: Boolean(expected.vc_memory), candidateMemory: Boolean(actual.packet?.body.vc_memory), stateDiff,
                    revisionBefore: input.context.chatMetadata.vc_f2?.revision, nativeRevision: expectedState.metadata.vc_f2?.revision,
                    candidateRevision: actual.state.metadata.vc_f2?.revision,
                    ejsDelimiters: [expected,actual.packet?.body].map(body=>(body?.messages?.[0]?.content?.match?.(/<%/g)||[]).length),
                }));
                assert.deepEqual(stateDiff, [], '最终状态不等价：' + stateDiff.join(','));
                completed.push({ id: test.id, request: true, state: true, nativeRequests: nativePaths.length, modelRequests: 0 });
            } finally {
                release();
                await reference.close(); await candidate.close();
                await generation?.catch(() => {});
            }
        }
        return { cases: completed, modelRequests: 0 };
    } finally { await browser.close(); }
}

export const desktopPromptScene = { id: 'nf-prompts', title: 'NF-02 新旧实际请求/状态、三协议与新旧宏对照', needs: ['catalog', 'stack', 'browser'], default: false, run: scenePromptParity };
