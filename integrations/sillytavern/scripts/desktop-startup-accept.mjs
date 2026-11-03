// NF-00 启动基线；复用受管栈、原生公开聊天入口和同一合成输入，不发起模型调用。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createStClient } from './managed-lib.mjs';
import { bindForeground } from './lib/accept-scene-helpers.mjs';
import { openStCharacterChat } from './lib/open-st-chat.mjs';

export async function seedDesktopBenchmark(ctx, { messages = 24 } = {}) {
    await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
        const result = await ctx.admin.call('PUT', '/api/v1/consents', { consentType, version: 'nf-synthetic', granted: true });
        assert.equal(result.status, 200, '合成授权必须成功');
    }
    const session = ctx.secrets.session;
    const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: session,
        extraCookies: `vc_session=${session.vcSession}; vc_csrf=${session.vcCsrf}` });
    const characterRef = crypto.randomUUID(), chatIdentity = crypto.randomUUID();
    const bound = await ctx.admin.call('POST', '/api/v1/st/bindings', { characterRef, chatIdentity, displayName: '合成实例', mode: 'COMPANION' });
    assert.equal(bound.status, 200, '合成实例绑定必须成功');
    const card = { name: 'NF 合成角色', description: '只用于启动测量。', first_mes: '合成问候。', personality: '', scenario: '', mes_example: '', extensions: { vc_character_ref: characterRef } };
    const data = new FormData();
    data.append('file_type', 'json');
    data.append('avatar', new Blob([JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: card })], { type: 'application/json' }), 'synthetic.json');
    const imported = await st.call('POST', '/api/characters/import', data);
    assert.equal(imported.status, 200, '合成卡导入必须成功');
    const avatar = imported.json.file_name.replace(/\.png$/, '') + '.png';
    const file = 'NF-fixed-history';
    const chat = [
        { user_name: '合成用户', character_name: card.name, chat_metadata: {
            vc_f2: { id: chatIdentity, revision: 0 }, vc_binding: { ...bound.json, mode: 'COMPANION', displayName: '合成实例' },
        } },
        ...Array.from({ length: messages }, (_, i) => ({ name: i % 2 ? card.name : '合成用户', is_user: i % 2 === 0,
            mes: `合成基准消息 ${i + 1}。`, send_date: new Date(Date.UTC(2026, 0, 1, 12, i)).toISOString() })),
    ];
    const saved = await st.call('POST', '/api/chats/save', { avatar_url: avatar, file_name: file, chat });
    assert.equal(saved.status, 200, '合成历史保存必须成功');
    return { avatar, file, chat };
}

export async function desktopBenchmarkContext(browser, ctx, options = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', ...options });
    await context.addCookies([
        { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
        { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase },
    ]);
    await context.addInitScript(() => { localStorage.setItem('vc-ui', 'on'); localStorage.setItem('vc-theme', 'light'); });
    return context;
}

export async function confirmSyntheticNativeProxy(page) {
    const dialog = page.locator('dialog[open].popup').first();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    const marker = await page.evaluate(() => window.SillyTavern.getContext().chatCompletionSettings.reverse_proxy);
    assert.ok(String(marker).startsWith('vc-go://model-purposes/FOREGROUND_CHAT?provider=vc03m-claude'), '只确认受管合成 Claude 标记');
    assert.ok((await dialog.innerText()).includes(marker), '代理确认必须确指当前受管标记');
    await dialog.locator('.popup-button-ok').click();
    await dialog.waitFor({ state: 'hidden' });
}

export async function ensureNativeConnection(page) {
    await page.waitForFunction(() => {
        const settings = window.SillyTavern?.getContext?.().chatCompletionSettings;
        return [settings?.custom_url, settings?.reverse_proxy].some(value => String(value || '').startsWith('vc-go://'));
    });
    // 调原生连接动作检查受管本地 provider，不伪造 online_status、不发生成请求。
    await page.evaluate(async () => {
        if ((await import('/script.js')).online_status === 'no_connection') document.querySelector('#api_button_openai').click();
    });
    await page.waitForFunction(async () => (await import('/script.js')).online_status !== 'no_connection'
        || document.querySelector('dialog[open].popup'));
    const dialog = page.locator('dialog[open].popup').first();
    if (await dialog.count()) await confirmSyntheticNativeProxy(page);
    await page.waitForFunction(async () => (await import('/script.js')).online_status !== 'no_connection');
}

async function sceneNativeStartup(ctx, fixedFixture) {
    const fixture = fixedFixture || await seedDesktopBenchmark(ctx);
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    try {
        const context = await desktopBenchmarkContext(browser, ctx);
        const page = await context.newPage();
        page.setDefaultTimeout(90000);
        let generated = 0;
        page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/generate')) generated++; });
        const samples = [];
        for (const cache of ['cold', 'warm']) {
            await page.goto(ctx.w05.stBase, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#preloader', { state: 'hidden' });
            await page.locator('#vc-shell .vc-sidebar [data-nav="characters"]').click();
            await page.waitForFunction(() => document.querySelector('#vc-shell')?.dataset.destination === 'characters');
            const uiMs = await page.evaluate(() => Math.round(performance.now()));
            const opening = await page.evaluate(() => performance.now());
            await openStCharacterChat(page, fixture);
            await page.waitForFunction(() => document.querySelectorAll('#chat > .mes').length === 24);
            const historyMs = await page.evaluate(() => Math.round(performance.now()));
            await page.locator('#vc-shell .vc-sidebar [data-nav="chat"]').click();
            await ensureNativeConnection(page);
            await page.waitForFunction(() => Boolean(window.SillyTavern?.getContext?.().chatMetadata?.vc_binding?.relationshipId));
            await page.locator('#send_textarea').fill('合成草稿');
            assert.equal(await page.locator('#send_textarea').inputValue(), '合成草稿');
            const sendMs = await page.evaluate(() => Math.round(performance.now()));
            await page.locator('#send_textarea').fill('');
            samples.push({ cache, uiMs, historyMs, openMs: Math.round(historyMs - opening), sendMs });
        }
        assert.equal(generated, 0, '启动测量不应发起模型生成');
        const result = { surface: 'native-baseline', viewport: '1440x900@1', messages: 24, modelRequests: generated,
            cache: 'cold=新浏览器上下文；warm=同上下文再次导航；服务器与数据库均预热；不清 OS 缓存', samples };
        fs.writeFileSync(path.join(ctx.artifactsDir, 'nf-startup.json'), JSON.stringify(result, null, 2) + '\n');
        return result;
    } finally { await browser.close(); }
}

export const nativeStartupScene = { id: 'nf-startup', title: 'NF-00 固定合成历史下原生桌面冷/热启动基线', needs: ['catalog', 'stack', 'browser'], default: false, run: sceneNativeStartup };

async function sceneIndependentDesktop(ctx) {
    const fixture = await seedDesktopBenchmark(ctx);
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    let releaseRuntime;
    const gate = new Promise(resolve => { releaseRuntime = resolve; });
    try {
        const context = await desktopBenchmarkContext(browser, ctx);
        let runtimeRequests = 0;
        await context.route('**/desktop/standalone/runtime.js', async route => { runtimeRequests++; await gate; await route.continue(); });
        const page = await context.newPage(); page.setDefaultTimeout(20000);
        const requests = [], errors = [];
        page.on('request', request => requests.push(new URL(request.url()).pathname));
        page.on('pageerror', () => errors.push('uncaught-page-error'));
        await page.goto(`${ctx.w05.stBase}/desktop/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.documentElement.dataset.vcApp === 'ready');
        await page.locator('#vc-shell .vc-sidebar [data-nav="characters"]').click();
        await page.locator('.vc-characters input[type="search"], .vc-characters .vc-search input').first().fill('NF');
        const uiMs = await page.evaluate(() => Math.round(performance.now()));
        assert.equal(runtimeRequests, 1, '真实聊天准备模块仍在等待');
        assert.equal(await page.locator('html').getAttribute('data-vc-runtime'), null);
        await page.locator('#vc-shell .vc-sidebar [data-settings]').click();
        await page.locator('.vc-settings-categories [data-category="appearance"]').click();
        await page.getByRole('heading', { name: '外观', exact: true, level: 1 }).waitFor();
        await page.locator('.vc-settings-categories [data-category="model"]').click();
        await page.locator('.vcms-root').waitFor({ state: 'visible' });
        await page.locator('#vc-shell .vc-sidebar [data-nav="chat"]').click();
        const opening = await page.evaluate(() => performance.now());
        const row = page.locator(`[data-convo-list] [data-relationship-id="${fixture.chat[0].chat_metadata.vc_binding.relationshipId}"]`);
        await row.click();
        await page.waitForFunction(() => document.querySelectorAll('#chat > .mes').length === 24);
        assert.equal(await page.locator('#send_but').isDisabled(), true, 'NF-01 不把尚未接通的发送宣称就绪');
        await page.locator('#send_textarea').fill('合成桌面草稿');
        const historyMs = await page.evaluate(() => Math.round(performance.now()));
        assert.equal(await page.locator('iframe').count(), 0);
        const geometry = await page.evaluate(() => ({
            body: document.querySelector('.vc-shell-chat-body').getBoundingClientRect().width,
            root: document.querySelector('.vc-desktop-chat-root').getBoundingClientRect().width,
            composer: document.querySelector('#form_sheld').getBoundingClientRect().width,
        }));
        assert.ok(Math.abs(geometry.body - geometry.root) <= 1, `消息根应铺满对话面板 ${JSON.stringify(geometry)}`);
        assert.ok(geometry.composer >= Math.min(geometry.body, 768) - 2, '输入区沿用既有阅读宽度');
        for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport);
            for (const scheme of ['light', 'dark']) {
                await page.evaluate(async mode => (await import('/scripts/extensions/third-party/vc-model-settings/ui/theme.js')).setThemeMode(mode), scheme);
                await page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await Promise.all(document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
                await page.screenshot({ path: path.join(ctx.artifactsDir, `nf-desktop-${viewport.width}-${scheme}.png`) });
            }
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator('#vc-shell .vc-sidebar [data-nav="characters"]').click();
        await page.locator('#vc-shell .vc-sidebar [data-nav="chat"]').click();
        assert.equal(await page.locator('#send_textarea').inputValue(), '合成桌面草稿');
        const forbidden = requests.filter(url => ['/', '/index.html', '/script.js', '/scripts/extensions.js', '/scripts/st-context.js'].includes(url)
            || /\/(?:JS-Slash-Runner|ST-Prompt-Template)\/dist\//.test(url));
        assert.deepEqual(forbidden, [], '桌面不能请求完整宿主/启动器');
        assert.equal(requests.filter(url => url.endsWith('/generate')).length, 0);
        assert.deepEqual(errors, [], '自有页面无未捕获错误');
        releaseRuntime();
        await page.waitForFunction(() => ['prepared', 'error'].includes(document.documentElement.dataset.vcRuntime));
        if (await page.locator('html').getAttribute('data-vc-runtime') === 'error') {
            // 仅失败时重建相同合成输入以得到具体异常；不输出任何凭据或正文。
            await page.evaluate(async fixture => {
                const base = '/scripts/extensions/third-party/vc-model-settings/desktop/standalone/';
                const { createDesktopClient } = await import(base + 'client.js');
                const { prepareChatRuntime } = await import(base + 'runtime.js');
                const { EventEmitter } = await import(base + 'engine/events.js');
                const { event_types } = await import(base + 'engine/st/events.js');
                const client = createDesktopClient(); await client.initialize();
                const characters = await client.characters(), records = await client.readChat(fixture);
                await prepareChatRuntime({ client, context: { characters, characterId: characters.findIndex(row => row.avatar === fixture.avatar),
                    chat: records.slice(1), chatMetadata: records[0].chat_metadata, chatId: fixture.file, name1: records[0].user_name,
                    name2: records[0].character_name, extensionPrompts: {}, eventSource: new EventEmitter(), eventTypes: event_types } });
                throw new Error('聊天准备首次初始化失败');
            }, { avatar: fixture.avatar, file: fixture.file });
        }
        const result = { uiMs, historyMs, openMs: Math.round(historyMs - opening), sendMs: null,
            delayedRuntime: true, nativeRequests: forbidden.length, modelRequests: 0, messages: fixture.chat.length - 1,
            resources: [...new Set(requests)],
            note: 'NF-01 验证导航/读取/设置独立；发送与复杂卡仍待 NF-02–04，不声称完成。' };
        fs.writeFileSync(path.join(ctx.artifactsDir, 'nf-desktop.json'), JSON.stringify(result, null, 2) + '\n');
        return result;
    } finally { releaseRuntime(); await browser.close(); }
}

export const independentDesktopScene = { id: 'nf-desktop', title: 'NF-01 独立桌面：聊天延迟、导航/设置/历史与网络边界', needs: ['catalog', 'stack', 'browser'], default: false, run: sceneIndependentDesktop };

async function sceneDesktopPerformance(ctx) {
    const fixture=await seedDesktopBenchmark(ctx);
    const st=createStClient({baseUrl:ctx.w05.stBase,expectedIdentity:ctx.secrets.session,extraCookies:`vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}`});
    const settings=JSON.parse((await st.call('POST','/api/settings/get',{})).json.settings);
    settings.firstRun=false;settings.username='合成用户';settings.extension_settings ||= {};settings.extension_settings.vc_reply_planner=false;
    assert.equal((await st.call('POST','/api/settings/save',settings)).status,200);
    const native=await sceneNativeStartup(ctx,fixture);
    const {chromium}=await import('playwright-core'),browser=await chromium.launch({headless:true,...(process.env.VC_W03_CHROMIUM_PATH?{executablePath:process.env.VC_W03_CHROMIUM_PATH}:{})});
    const samples=[],resources=[];let generated=0;
    try {
        for(let round=0;round<3;round++){
            const context=await desktopBenchmarkContext(browser,ctx),page=await context.newPage();page.setDefaultTimeout(30000);
            const forbidden=[],errors=[];page.on('pageerror',error=>errors.push(error.name));
            page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.endsWith('/generate'))generated++;if(['/', '/index.html','/script.js','/scripts/extensions.js','/scripts/st-context.js'].includes(path))forbidden.push(path);});
            for(const cache of ['cold','warm']){
                await page.goto(ctx.w05.stBase+'/desktop/',{waitUntil:'domcontentloaded'});
                await page.waitForFunction(()=>document.documentElement.dataset.vcApp==='ready');
                await page.locator('.vc-sidebar [data-nav=characters]').click();
                await page.locator('.vc-characters [name=character-search]').fill('NF');
                const uiMs=await page.evaluate(()=>Math.round(performance.now()));
                await page.locator('.vc-sidebar [data-nav=chat]').click();
                const opening=await page.evaluate(()=>performance.now());
                await page.locator(`[data-convo-list] [data-relationship-id="${fixture.chat[0].chat_metadata.vc_binding.relationshipId}"]`).click();
                await page.waitForFunction(()=>document.querySelectorAll('#chat>.mes').length===24);
                const historyMs=await page.evaluate(()=>Math.round(performance.now()));
                await page.locator('#send_textarea').fill('合成草稿');
                await page.waitForFunction(()=>Boolean(document.querySelector('#send_but')&&!document.querySelector('#send_but').disabled));
                const sendMs=await page.evaluate(()=>Math.round(performance.now()));
                assert.equal(await page.locator('iframe[src="/"],iframe[src="/native/"]').count(),0);
                samples.push({round,cache,uiMs,historyMs,openMs:Math.round(historyMs-opening),sendMs});
                resources.push({round,cache,entries:await page.evaluate(()=>performance.getEntriesByType('resource').map(entry=>({path:new URL(entry.name).pathname,duration:Math.round(entry.duration),transfer:entry.transferSize,bytes:entry.decodedBodySize})))});
                await page.locator('#send_textarea').fill('');
            }
            assert.deepEqual(forbidden,[]);assert.deepEqual(errors,[]);await context.close();
        }
    }finally{await browser.close();}
    assert.equal(generated,0,'启动测量不得生成');
    const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const medians=Object.fromEntries(['cold','warm'].map(cache=>[cache,Object.fromEntries(['uiMs','historyMs','openMs','sendMs'].map(key=>[key,median(samples.filter(row=>row.cache===cache).map(row=>row[key]))]))]));
    const result={surface:'independent-desktop',viewport:'1440x900@1',messages:24,modelRequests:generated,cache:native.cache,native:native.samples,samples,medians,resources};
    fs.writeFileSync(path.join(ctx.artifactsDir,'nf-performance.json'),JSON.stringify(result,null,2)+'\n');
    if(process.env.VC_NF_PERFORMANCE_REFERENCE){
        const previous=JSON.parse(fs.readFileSync(process.env.VC_NF_PERFORMANCE_REFERENCE,'utf8'));
        for(const cache of ['cold','warm']){
            assert.ok(medians[cache].uiMs<previous.medians[cache].uiMs,`${cache}界面可操作应改善`);
            assert.ok(medians[cache].sendMs<previous.medians[cache].sendMs,`${cache}真实可发送应改善`);
        }
    }
    return{medians,native:native.samples,modelRequests:0};
}
export const desktopPerformanceScene={id:'nf-performance',title:'NF-09 同条件原生与独立桌面冷/热启动与真实可发送',needs:['catalog','stack','browser'],default:false,run:sceneDesktopPerformance};
