// NF-02：原生与实际发运桌面的请求逐字段对照；只使用受管合成数据，不发送模型请求。
import assert from 'node:assert/strict';
import { createStClient } from './managed-lib.mjs';
import { seedDesktopBenchmark, desktopBenchmarkContext, ensureNativeConnection, confirmSyntheticNativeProxy } from './desktop-startup-accept.mjs';
import { bindForeground, providerCatalogSpec } from './lib/accept-scene-helpers.mjs';
import { openStCharacterChat } from './lib/open-st-chat.mjs';
import { nativeReady } from './f2-chat-accept.mjs';
import { openDesktopFixture } from './desktop-chat-accept.mjs';

const GENERATE_PATH = '/api/backends/chat-completions/generate';
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

async function captureNativeCompanionInputs(page) {
    await page.addInitScript(() => {
        const actualFetch = window.fetch.bind(window);
        globalThis.nfCompanionInputs = [];
        window.fetch = function (input, init) {
            const pathname = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
            // UI 状态卡也读同一路径；这里只冻结实际提示词注入的调用。
            if (!pathname.endsWith('/companion-state') || !new Error().stack.includes('/companion-prompt.js:')) return actualFetch(input, init);
            const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
            const request = { method: init?.method || 'GET', pathname, body: init?.body ?? null,
                identity: { accountId: headers.get('x-vc-expected-account-id'), sessionId: headers.get('x-vc-expected-session-id') } };
            return actualFetch(input, init).then(async response => {
                globalThis.nfCompanionInputs.push({ request, status: response.status, text: await response.clone().text() });
                return response;
            });
        };
    });
}

async function registerPromptMacro(page) {
    await page.evaluate(() => TavernHelper.registerMacroLike(/NF_REGISTRY_PROBE/g, () => 'NF_REGISTRY_RESOLVED'));
}

async function withinPromptStage(label, work) {
    let timer;
    try {
        return await Promise.race([work(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('等待超时（60 秒）')), 60000);
        })]);
    } catch (error) {
        throw new Error(label() + '：' + error.message, { cause: error });
    } finally {
        clearTimeout(timer);
    }
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
            const card = await st.call('POST', '/api/characters/get', { avatar_url: fixture.avatar });
            assert.equal(card.status, 200);
            Object.assign(card.json.data.extensions, { world: book, regex_scripts: [{
                id: 'nf-regex', scriptName: '合成正则', findRegex: '/NF_INPUT/g', replaceString: 'NF_REPLACED',
                trimStrings: [], placement: [1, 2, 5], disabled: false, markdownOnly: false, promptOnly: true,
                runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
            }] });
            assert.equal((await st.call('POST', '/api/characters/merge-attributes', { avatar: fixture.avatar, data: card.json.data })).status, 200);
            // 原生 CHAT_CHANGED 会等待嵌入正则授权。用真实设置 API 预先允许本轮合成卡。
            const settingsPacket = await st.call('POST', '/api/settings/get', {});
            assert.equal(settingsPacket.status, 200);
            const fixtureSettings = JSON.parse(settingsPacket.json.settings);
            (fixtureSettings.extension_settings.character_allowed_regex ||= []).push(fixture.avatar);
            assert.equal((await st.call('POST', '/api/settings/save', fixtureSettings)).status, 200);
            const reference = await desktopBenchmarkContext(browser, ctx);
            const candidate = await desktopBenchmarkContext(browser, ctx);
            const oldPage = await reference.newPage(), newPage = await candidate.newPage();
            const fixedTime = new Date('2026-11-03T00:00:00.000Z');
            await captureNativeCompanionInputs(oldPage);
            oldPage.setDefaultTimeout(60000); newPage.setDefaultTimeout(60000);
            let stage;
            const setStage = label => { stage = label; console.log('[nf-prompts] ' + test.id + ' ' + stage); };
            const runStage = (label, work) => {
                setStage(label);
                return withinPromptStage(() => stage, work);
            };
            oldPage.on('console', message => {
                if (message.type() !== 'debug') return;
                const label = message.text();
                if (['[nf-prompts] native tokenizer', '[nf-prompts] native saveChat', '[nf-prompts] native settings fetch'].includes(label)) {
                    setStage(label.slice('[nf-prompts] '.length));
                }
            });
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
            await oldPage.route('**' + GENERATE_PATH, async route => {
                captured(route.request().postDataJSON());
                await hold;
                await route.abort('aborted');
            });
            let generation, desktopGeneration, releaseDesktop;
            try {
                await runStage('native navigation', () => oldPage.goto(ctx.w05.stBase + '/native/', { waitUntil: 'domcontentloaded' }));
                await runStage('nativeReady', () => nativeReady(oldPage));
                await runStage('openStCharacterChat', () => openStCharacterChat(oldPage, fixture));
                await runStage('ensureNativeConnection', () => ensureNativeConnection(oldPage));
                await runStage('native Helper registry', () => oldPage.waitForFunction(() => typeof window.TavernHelper?.registerMacroLike === 'function'));
                const input = await runStage('native setup', () => oldPage.evaluate(async ({ modern, book }) => {
                    const script = await import('/script.js');
                    const { power_user } = await import('/scripts/power-user.js');
                    const world = await import('/scripts/world-info.js');
                    const { cancelDebouncedMetadataSave } = await import('/scripts/extensions.js');
                    const tokenizers = await import('/scripts/tokenizers.js');
                    const context = SillyTavern.getContext();
                    Math.random = () => 0.5;
                    power_user.experimental_macro_engine = modern;
                    power_user.console_log_prompts = false;
                    const settings = context.chatCompletionSettings;
                    settings.function_calling = true;
                    settings.squash_system_messages = true;
                    const main = settings.prompts.find(row => row.identifier === 'main');
                    main.content = '{{setvar::prompt_seen::1}}NF_PRESET {{char}} / {{user}} / {{getvar::topic}} / NF_REGISTRY_PROBE';
                    context.extensionSettings.vc_reply_planner = false;
                    // 复用原设置入口设置递归，不使用临时DOM值来替代计算输入。
                    const worldSettings = { ...world.getWorldInfoSettings(), world_info_recursive: true,
                        world_info: { ...world.getWorldInfoSettings().world_info, globalSelect: [] } };
                    world.setWorldInfoSettings(worldSettings, { world_names: [book] });
                    // 纯计算的外部输入保持固定；清除原生UI待保存项，并预热实际tokenizer。
                    // 各计算检查点取消新排入的UI元数据计时器，真实F2写入由nf-chat/f2-chat-ui验。
                    console.debug('[nf-prompts] native tokenizer');
                    await tokenizers.countTokensOpenAIAsync({ role: 'user', content: 'NF tokenizer warmup' }, true);
                    cancelDebouncedMetadataSave();
                    console.debug('[nf-prompts] native saveChat');
                    await script.saveChat();
                    console.debug('[nf-prompts] native settings fetch');
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
                    saved.settings = JSON.stringify(raw);
                    return JSON.parse(JSON.stringify({ context: { chat: context.chat, chatMetadata: context.chatMetadata },
                        settingsPacket: saved, watched }));
                }, { modern: test.modern, book }));
                await runStage('register native macro', () => registerPromptMacro(oldPage));
                // 打开聊天的原生轮询依赖 Date.now() 推进，只在对照生成时固定两边的提示词时间。
                await runStage('fix native generation time', () => oldPage.clock.setFixedTime(fixedTime));
                setStage('capture native generation request');
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
                const expectedState = await runStage('read native request state', () => oldPage.evaluate(length => JSON.parse(JSON.stringify({
                    metadata: SillyTavern.getContext().chatMetadata,
                    chat: SillyTavern.getContext().chat.slice(0, length),
                    globals: SillyTavern.getContext().extensionSettings.variables,
                    trace: globalThis.nfTrace,
                })), input.context.chat.length));
                const expectedPrompts = await runStage('read native extension prompts', () => oldPage.evaluate(() => Object.fromEntries(Object.entries(SillyTavern.getContext().extensionPrompts).filter(([key]) => key.startsWith('vc_')))));
                const companionInputs = await runStage('read native companion inputs', () => oldPage.evaluate(() => globalThis.nfCompanionInputs));
                assert.equal(companionInputs.length, 1, '参考页必须实际读取提示词注入所用的陪伴状态');
                assert.equal(companionInputs[0].status, 200, '参考陪伴状态端口必须真实成功');
                const memory = await runStage('read native memory response', () => Promise.all(memoryExchanges));
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
                // 只在生产 HTTP 数据边界冻结合成输入；会话、宏注册表和事件均由发运应用初始化。
                await newPage.route('**/api/settings/get', route => route.fulfill({ json: input.settingsPacket }));
                const replayedChat = [{ ...prepared.json[0], chat_metadata: preparedContext.chatMetadata }, ...preparedContext.chat];
                await newPage.route('**/api/chats/get', route => {
                    const request = route.request().postDataJSON();
                    return request.avatar_url === fixture.avatar && request.file_name === fixture.file
                        ? route.fulfill({ json: replayedChat }) : route.continue();
                });
                await newPage.addInitScript(() => { Math.random = () => 0.5; });
                const nativePaths = [], appScripts = [];
                newPage.on('request', request => {
                    const pathname = new URL(request.url()).pathname;
                    if (['/', '/script.js', '/scripts/extensions.js', '/scripts/st-context.js'].includes(pathname)) nativePaths.push(pathname);
                    if (request.resourceType() === 'script' && /^\/desktop\/assets\/.+\.js$/.test(pathname)) appScripts.push(pathname);
                });
                await runStage('openDesktopFixture', () => openDesktopFixture(newPage, ctx.w05.stBase, fixture, preparedContext.chat.length));
                const composer = newPage.locator('#send_textarea');
                await composer.fill('NF14 生产会话就绪检查');
                await newPage.waitForFunction(() => typeof SillyTavern.getContext().generate === 'function'
                    && Boolean(document.querySelector('#send_but:not(:disabled)')));
                await composer.fill('');
                await runStage('register desktop macro', () => registerPromptMacro(newPage));
                const before = await runStage('read desktop input', () => newPage.evaluate(watched => {
                    const context = SillyTavern.getContext();
                    globalThis.nfTrace = [];
                    for (const key of watched) context.eventSource.on(context.eventTypes[key], () => globalThis.nfTrace.push(key));
                    return JSON.parse(JSON.stringify({ chat: context.chat, metadata: context.chatMetadata }));
                }, input.watched));
                assert.deepEqual(promptInput(before.chat), promptInput(preparedContext.chat), '生产会话打开后保留相同提示词输入');
                assert.deepEqual(before.metadata.vc_f2, preparedContext.chatMetadata.vc_f2, '生产会话使用同一 F2 输入');
                assert.deepEqual(before.metadata.variables, preparedContext.chatMetadata.variables, '生产会话准备未预执行宏');
                const desktopCompanion = [], companionMismatches = [];
                await newPage.route('**/companion-state', async route => {
                    const incoming = route.request();
                    const request = { method: incoming.method(), pathname: new URL(incoming.url()).pathname,
                        body: incoming.postData(), identity: identityHeaders(incoming) };
                    const recorded = companionInputs[desktopCompanion.length];
                    const differences = recorded ? paths(recorded.request, request) : ['extra-call'];
                    companionMismatches.push(...differences);
                    desktopCompanion.push({ request, status: recorded?.status, text: recorded?.text });
                    await route.fulfill(differences.length ? { status: 409, json: { code: 'NF_PARITY_COMPANION_INPUT_MISMATCH' } }
                        : { status: recorded.status, contentType: 'application/json', body: recorded.text });
                });
                const desktopHold = new Promise(resolve => { releaseDesktop = resolve; });
                await newPage.route('**' + GENERATE_PATH, async route => {
                    await desktopHold;
                    await route.abort('aborted');
                });
                // Session 公开的 normal 重试保留已在历史中的最后一条用户消息。
                await runStage('fix desktop generation time', () => newPage.clock.setFixedTime(fixedTime));
                setStage('capture desktop generation request');
                const desktopRequest = newPage.waitForRequest(request => new URL(request.url()).pathname === GENERATE_PATH, { timeout: 45000 });
                desktopGeneration = newPage.evaluate(() => SillyTavern.getContext().generate('normal'));
                const outgoing = await Promise.race([desktopRequest, desktopGeneration.then(() => {
                    throw new Error('桌面会话在发出待对照请求前结束');
                })]);
                const actual = await runStage('read desktop request state', () => newPage.evaluate(() => {
                    const context = SillyTavern.getContext();
                    return JSON.parse(JSON.stringify({ prompts: Object.fromEntries(Object.entries(context.extensionPrompts).filter(([key]) => key.startsWith('vc_'))),
                        state: { metadata: context.chatMetadata, chat: context.chat, globals: context.extensionSettings.variables, trace: globalThis.nfTrace } }));
                }));
                actual.packet = { body: outgoing.postDataJSON() };
                actual.companionInputs = desktopCompanion;
                assert.ok(appScripts.length > 0, '候选必须载入实际发运 React 脚本');
                assert.deepEqual(memoryDifferences, [], '记忆外部输入请求/页面身份必须一致');
                assert.equal(memoryUsed, memory.length, '候选不得多调或漏调记忆端口');
                assert.deepEqual(companionMismatches, [], '陪伴状态外部输入请求与页面身份必须一致');
                assert.equal(desktopCompanion.length, companionInputs.length, '候选不得多调或漏调提示词陪伴状态端口');
                assert.ok(JSON.stringify(expected).includes('NF_BOOK'), '参考世界书必须真实触发');
                assert.ok(JSON.stringify(expected).includes('NF_RECURSION'), '参考世界书必须真实递归');
                assert.ok(JSON.stringify(expected).includes('NF_REPLACED'), '参考正则必须真实运行');
                assert.ok(JSON.stringify(expected).includes('NF_PRESET'), '参考预设必须真实运行');
                assert.ok(JSON.stringify(expected).includes('NF_REGISTRY_RESOLVED'), '参考 Helper 注册表必须参与实际请求');
                assert.ok(JSON.stringify(actual.packet.body).includes('NF_REGISTRY_RESOLVED'), '发运 Helper 注册表必须参与实际请求');
                assert.deepEqual(nativePaths, [], '候选计算不能加载完整酒馆');
                const bodyDiff = paths(expected, actual.packet?.body);
                const stateDiff = paths(expectedState, actual.state);
                assert.deepEqual(bodyDiff, [], '最终序列化请求不等价：' + bodyDiff.join(',') + '; checkpoints=' + JSON.stringify({
                    nativeMemory: Boolean(expected.vc_memory), candidateMemory: Boolean(actual.packet?.body.vc_memory), stateDiff,
                    revisionBefore: input.context.chatMetadata.vc_f2?.revision, nativeRevision: expectedState.metadata.vc_f2?.revision,
                    candidateRevision: actual.state.metadata.vc_f2?.revision,
                    ejsDelimiters: [expected,actual.packet?.body].map(body=>(body?.messages?.[0]?.content?.match?.(/<%/g)||[]).length),
                    promptDiffs: paths(expectedPrompts, actual.prompts),
                    companionInputDiffs: paths(companionInputs, actual.companionInputs),
                    companionInputs: [companionInputs, actual.companionInputs].map(records => records.map(record => {
                        const body = JSON.parse(record.text);
                        return { status: record.status, tier: body.mood?.tier, vibeLength: body.mood?.vibe?.length, lineLength: body.mood?.line?.length, emotionLength: body.emotion?.line?.length };
                    })),
                    promptLineLengths: [expectedPrompts, actual.prompts].map(prompts => Object.fromEntries(Object.entries(prompts).map(([key, prompt]) => [key, String(prompt.value || '').split('\n').map(line => line.length)]))),
                    messageDiffs: expected.messages?.flatMap((message, index) => {
                        const candidate = actual.packet?.body?.messages?.[index];
                        if (message.content === candidate?.content) return [];
                        return [{ index, role: message.role, lengths: [message.content?.length, candidate?.content?.length], stickerRules: [message.content, candidate?.content].map(content => typeof content === 'string' && content.includes('可用表情')) }];
                    }),
                }));
                assert.deepEqual(stateDiff, [], '最终状态不等价：' + stateDiff.join(','));
                completed.push({ id: test.id, request: true, state: true, nativeRequests: nativePaths.length, modelRequests: 0 });
            } finally {
                release(); releaseDesktop?.();
                await reference.close(); await candidate.close();
                await Promise.allSettled([generation, desktopGeneration]);
            }
        }
        return { cases: completed, modelRequests: 0 };
    } finally { await browser.close(); }
}

export const desktopPromptScene = { id: 'nf-prompts', title: 'NF-02 新旧实际请求/状态、三协议与新旧宏对照', needs: ['catalog', 'stack', 'browser'], default: false, run: scenePromptParity };
