// HL-REPLY 受管场景：多气泡、硬违规只重写一次、连发三条只生成一次。
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStClient } from './managed-lib.mjs';
import { ownerBudgetResetSql } from './lib/owner-budget.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import { voiceShots } from './voice-accept-lib.mjs';
import { replyLengthStats } from '../../../scripts/reply-length-stats.mjs';

const DEV = process.env.VC_W03_DEV_DIR
    || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dev-managed');
const SHOTS = path.join(DEV, 'artifacts', 'hl-reply');
const GREETING = '这是一次合成测试对话。';
const BUBBLES = '今天有点累。想早点休息。明天再说';
const BAD = '希望对你有帮助';
const CALM = '到了就好';
const LONG = '我想听你用平时聊天的口气，把今天从出门到回家遇到的小事按顺序讲两句，不要总结成清单。';
const LONG_AGAIN = '再讲一件今天从出门到晚上回家的小事就好，用平时说话的方式，不要客套，也不要列清单。';
const BURST = ['在吗', '吃了吗', '我到了'];
const VIEWPORTS = [
    { name: '1440', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
];

function stClient(ctx) {
    const session = ctx.secrets.session;
    return createStClient({
        baseUrl: ctx.w05.stBase,
        expectedIdentity: session,
        extraCookies: `vc_session=${session.vcSession}; vc_csrf=${session.vcCsrf}`,
    });
}

async function launchBrowser() {
    const { chromium } = await import('playwright-core');
    return chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}),
    });
}

async function nativeReady(page) {
    await page.waitForFunction(() => Boolean(window.SillyTavern?.getContext?.()?.eventSource));
    await page.waitForSelector('#send_textarea', { state: 'attached' });
    await page.waitForFunction(async () => (await import('/script.js')).settingsReady || document.querySelector('dialog[open] .onboarding'));
    const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
    if (await onboarding.count()) {
        await onboarding.locator('textarea').fill('合成验收用户');
        await onboarding.locator('.popup-button-ok').click();
        await onboarding.waitFor({ state: 'hidden' });
    }
    await page.waitForFunction(async () => (await import('/script.js')).settingsReady);
    await page.waitForSelector('#preloader', { state: 'hidden' });
}

async function revealShellChat(page) {
    await page.waitForFunction(() => typeof document.querySelector('#vc-shell')?.openConversation === 'function', null, { timeout: 20000 });
    const status = await page.evaluate(async () => {
        const root = document.querySelector('#vc-shell');
        const ctx = window.SillyTavern?.getContext?.() || {};
        const id = ctx.characterId;
        const characterIndex = typeof id === 'number' ? id : Number(id);
        const character = ctx.characters?.[Number.isInteger(characterIndex) ? characterIndex : -1];
        const opened = await root.openConversation({
            relationshipId: ctx.chatMetadata?.vc_binding?.relationshipId || '',
            file: ctx.chatId || '',
            characterIndex: Number.isInteger(characterIndex) ? characterIndex : undefined,
            name: character?.name || '',
            avatar: character?.avatar || '',
        });
        const sheld = document.querySelector('#sheld')?.getBoundingClientRect();
        return { opened: opened === true, width: Math.round(sheld?.width || 0), height: Math.round(sheld?.height || 0) };
    });
    if (status.width < 200 || status.height < 200) throw new Error(`对话列没有展开 ${JSON.stringify(status)}`);
}

async function openChat(page, avatar, file) {
    await page.evaluate(async ({ avatar: fileName, file: chatFile }) => {
        const script = await import('/script.js');
        const index = script.characters.findIndex((item) => item.avatar === fileName);
        if (index < 0) throw new Error('合成卡不在角色列表');
        await script.selectCharacterById(index);
        if (chatFile) await script.openCharacterChat(chatFile);
    }, { avatar, file });
    await revealShellChat(page);
}

async function bindForeground(ctx) {
    await reauthForWrite(ctx);
    const purposes = await ctx.admin.listPurposes();
    if (purposes.status !== 200) throw new Error(`用途列表 HTTP ${purposes.status}`);
    const row = purposes.json.find((item) => item.purpose === 'FOREGROUND_CHAT');
    if (!row) throw new Error('FOREGROUND_CHAT 缺失');
    const bound = await ctx.admin.savePurpose('FOREGROUND_CHAT', {
        providerId: 'vc03m-chat', profileKey: 'chat', state: 'ENABLED', expectedRevision: row.revision,
    });
    if (bound.status !== 200) throw new Error(`前台绑定 HTTP ${bound.status}`);
    for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
        const granted = await ctx.admin.call('PUT', '/api/v1/consents', { consentType, version: 'hl-reply', granted: true });
        if (granted.status !== 200) throw new Error(`授权 ${consentType} HTTP ${granted.status}`);
    }
}

function importJson(st, card) {
    const form = new FormData();
    form.append('file_type', 'json');
    form.append('avatar', new Blob([JSON.stringify(card)], { type: 'application/json' }), 'synthetic.json');
    return st.call('POST', '/api/characters/import', form);
}

async function shot(page, ctx, name) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const primary = path.join(SHOTS, name);
    await page.screenshot({ path: primary });
    ctx.screenshots.push(primary);
    if (ctx.artifactsDir && path.resolve(ctx.artifactsDir) !== path.resolve(SHOTS)) {
        fs.mkdirSync(ctx.artifactsDir, { recursive: true });
        const copy = path.join(ctx.artifactsDir, name);
        fs.copyFileSync(primary, copy);
        ctx.screenshots.push(copy);
    }
}

async function theme(page, mode) {
    await page.evaluate((value) => {
        localStorage.setItem('vc-theme', value);
        document.documentElement.setAttribute('data-vc-theme', value);
    }, mode);
}

async function closeHostChrome(page) {
    await page.evaluate(() => {
        document.querySelectorAll('#toast-container .toast').forEach((node) => node.remove());
        for (const dialog of document.querySelectorAll('dialog[open]')) {
            if (dialog.id === 'vc-f2-conflict') continue;
            dialog.close?.();
        }
    }).catch(() => {});
}

async function chatCaptures(ctx, since) {
    const rows = await ctx.fixtureHttp.captures({ protocol: 'chat', since });
    return rows.filter((row) => Array.isArray(row.body?.messages) && row.body.model === 'vc03m-chat');
}

async function nativeIdle(page) {
    await page.waitForFunction(async()=>{
        const s=await import('/script.js');
        return !window.vcSendMutex?.isBusy && !s.isGenerating() && !s.swipesHidden && !s.isChatSaving && s.swipeState==='none'
            && !(await import('/scripts/slash-commands.js')).isExecutingCommandsFromChatInput;
    },null,{timeout:15000});
}
async function sendText(page, text) {
    await nativeIdle(page);
    await page.evaluate((value) => {
        window.vcReplyStartLength = SillyTavern.getContext().chat.length;
        const box = document.querySelector('#send_textarea');
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        set.call(box, value);
        box.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#send_but').click();
    }, text);
}

async function waitReply(page, reply) {
    try { await page.waitForFunction((text) => {
        const chat = window.SillyTavern.getContext().chat || [];
        return chat.length >= (window.vcReplyStartLength || 0) + 2 && chat.at(-1)?.is_user === false && chat.at(-1)?.mes === text
            && document.body.getAttribute('data-generating') !== 'true';
    }, reply, { timeout: 60000 }); await nativeIdle(page); } catch(error) {
        const state=await page.evaluate((expected)=>({chatLength:SillyTavern.getContext().chat.length,startLength:window.vcReplyStartLength,
            lastUser:SillyTavern.getContext().chat.at(-1)?.is_user,lastChars:SillyTavern.getContext().chat.at(-1)?.mes?.length,
            expectedReply:SillyTavern.getContext().chat.at(-1)?.mes===expected,generating:document.body.getAttribute('data-generating'),events:window.vcReplyEvents,sendStarts:window.vcSendStarts,buttonDisabled:document.querySelector('#send_but')?.disabled}),reply);
        throw Error(`native reply wait ${JSON.stringify(state)}: ${error.message}`);
    }
}

export async function sceneHlReply(ctx) {
    if ([...LONG].length <= 40 || [...LONG_AGAIN].length <= 40) throw new Error('验收发送短于防抖阈值');
    await bindForeground(ctx);
    ctx.w10.psql(ownerBudgetResetSql(ctx.w05.ownerId));
    const st = stClient(ctx);
    const cardName = `回复流水线 ${crypto.randomUUID().slice(0, 8)}`;
    const imported = await importJson(st, {
        name: cardName,
        description: '合成聊天卡，只供回复流水线验收。',
        first_mes: GREETING,
        personality: '',
        scenario: '',
        mes_example: '',
    });
    if (imported.status !== 200 || !imported.json?.file_name) throw new Error(`导入合成卡 HTTP ${imported.status}`);
    const avatar = `${imported.json.file_name.replace(/\.png$/, '')}.png`;
    const file = `HL-${crypto.randomUUID()}`;
    const saved = await st.call('POST', '/api/chats/save', {
        avatar_url: avatar,
        file_name: file,
        chat: [
            {
                user_name: 'unused',
                character_name: cardName,
                chat_metadata: { vc_f2: { id: crypto.randomUUID(), revision: 0 }, vc_binding: { mode: 'COMPANION', displayName: '合成实例' } },
            },
            { name: cardName, is_user: false, mes: GREETING, swipe_id: 0, swipes: [GREETING] },
            ...Array.from({length:7},(_,i)=>[
                {name:'合成用户',is_user:true,mes:i<3?'好家伙':`合成背景编号${i}`,extra:{}},
                {name:cardName,is_user:false,mes:'嗯',extra:{}},
            ]).flat(),
        ],
    });
    if (saved.status !== 200) throw new Error(`保存聊天 HTTP ${saved.status}`);

    const browser = await launchBrowser();
    let page;
    try {
        const bc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await bc.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase },
        ]);
        await bc.addInitScript(() => {
            localStorage.setItem('vc-ui', 'on');
            localStorage.setItem('vc-theme', 'light');
            localStorage.setItem('vc-reply-style', 'bubble');
        });
        page = await bc.newPage();
        page.setDefaultTimeout(120000);
        console.log('[hl-reply] 打开宿主');
        await page.goto(ctx.w05.stBase);
        await nativeReady(page);
        await openChat(page, avatar, file);
        await page.waitForFunction(() => document.body.classList.contains('vc-ui') && document.body.classList.contains('vc-reply-bubble'));
        await page.waitForFunction(() => !document.querySelector('#send_form')?.classList.contains('no-connection'));
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.evaluate(async()=>{
            const {openCompanionStyle}=await import('/scripts/extensions/third-party/vc-model-settings/persona.js');
            openCompanionStyle({getContext:SillyTavern.getContext});
            document.querySelector('[data-action="restore-rules"]').click();
            await (await import('/script.js')).saveSettings();
        });
        await page.locator('.vc-sheet-done').last().click();
        await page.emulateMedia({reducedMotion:'no-preference'});

        await page.evaluate(async() => {
            const c=SillyTavern.getContext(); window.vcHistoryHookCalls=0; c.eventSource.on('vc-chat-history-ready',()=>{window.vcHistoryHookCalls++;});
            const script=await import('/script.js'),commands=await import('/scripts/slash-commands.js');
            const {SimpleMutex}=await import('/scripts/util/SimpleMutex.js');const update=SimpleMutex.prototype.update;
            window.vcSendStarts=[];
            SimpleMutex.prototype.update=function(...args){
                if(this.callback===script.sendTextareaMessage){window.vcSendMutex=this;window.vcSendStarts.push({busy:this.isBusy,generating:script.isGenerating(),hidden:script.swipesHidden,saving:script.isChatSaving,swipe:script.swipeState,command:commands.isExecutingCommandsFromChatInput});window.vcSendStarts=window.vcSendStarts.slice(-6);}
                return update.apply(this,args);
            };
            window.vcReplyEvents=[];
            for(const name of ['GENERATION_STARTED','GENERATION_ENDED','CHARACTER_MESSAGE_RENDERED','GENERATION_STOPPED']) {
                c.eventSource.on(c.eventTypes[name],(type,_options,dryRun)=>{window.vcReplyEvents.push({event:name,type:name==='GENERATION_STARTED'?type:undefined,dryRun:!!dryRun});window.vcReplyEvents=window.vcReplyEvents.slice(-12);});
            }
        });

        const expressionSince=(await ctx.fixtureHttp.captures()).at(-1)?.seq || 0;
        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: BUBBLES, chunks: 1, delay: { firstMs: 30, perChunkMs: 20 } });
        const before = await page.locator('#chat > .mes').count();
        console.log('[hl-reply] 多气泡');
        await sendText(page, LONG);
        await page.waitForFunction((count) => document.querySelectorAll('#chat > .mes').length >= count + 2, before, { timeout: 60000 });
        await waitReply(page, BUBBLES);
        await page.waitForFunction(() => {
            const last = [...document.querySelectorAll('#chat > .mes')].at(-1);
            return last && last.querySelectorAll('.vc-seg').length >= 2 && !last.querySelector('.vc-typing');
        }, null, { timeout: 20000 });
        const shown = await page.evaluate((reply) => {
            const chat = window.SillyTavern.getContext().chat || [];
            const nodes = [...document.querySelectorAll('#chat > .mes')];
            const last = nodes.at(-1);
            return {
                user: chat.at(-2)?.mes || '',
                assistant: chat.at(-1)?.mes || '',
                copies: chat.filter((item) => item?.mes === reply).length,
                segs: [...(last?.querySelectorAll('.vc-seg') || [])].map((node) => node.textContent),
                greetingSegs: nodes[0]?.querySelectorAll('.vc-seg').length || 0,
            };
        }, BUBBLES);
        const windowState=await page.evaluate(()=>({calls:window.vcHistoryHookCalls,saved:SillyTavern.getContext().chatMetadata.vc_history_window}));
        if(!windowState.calls || !Number.isInteger(windowState.saved?.count)) throw new Error('RQ-1 原生历史预算钩子没有执行');
        const expressionRequests=await chatCaptures(ctx,expressionSince);
        assert.ok(expressionRequests.some((row)=>row.body.messages.some((message)=>typeof message.content==='string' && message.content.includes('<vc-user-expressions>') && message.content.includes('[\"好家伙\"]'))),'RQ-5 第八轮应携带有界用户表达数据');
        if (shown.user !== LONG) throw new Error('长消息被拆进了多条用户消息');
        if (shown.assistant !== BUBBLES || shown.copies !== 1) throw new Error('多句回复没有保持为一条消息');
        if (shown.segs.length < 2) throw new Error(`气泡数量不足 ${shown.segs.length}`);
        if (shown.greetingSegs !== 0) throw new Error('旧的单句消息被改成了分段');

        for (const mode of ['light', 'dark']) {
            await theme(page, mode);
            for (const viewport of VIEWPORTS) {
                await page.setViewportSize(viewport);
                await closeHostChrome(page);
                await page.locator('#chat > .mes').last().locator('.vc-seg').first().scrollIntoViewIfNeeded();
                const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
                if (overflow > 1) throw new Error(`bubbles ${viewport.name} 横向溢出 ${overflow}px`);
                await shot(page, ctx, `bubbles-${viewport.name}-${mode}.png`);
            }
        }

        console.log('[hl-reply] 硬违规只重写一次');
        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: BAD, chunks: 1, delay: { firstMs: 30, perChunkMs: 20 } });
        const sinceRewrite = (await ctx.fixtureHttp.captures()).at(-1)?.seq ?? 0;
        await sendText(page, LONG_AGAIN);
        const rewriteDeadline = Date.now() + 45000;
        let rewriteRows = [];
        while (Date.now() < rewriteDeadline) {
            rewriteRows = await chatCaptures(ctx, sinceRewrite);
            if (rewriteRows.length >= 2) break;
            await page.waitForTimeout(300);
        }
        if (rewriteRows.length < 2) throw new Error(`硬违规没有触发重写，捕获 ${rewriteRows.length}`);
        await page.waitForTimeout(3000);
        const rewriteAfter = await chatCaptures(ctx, sinceRewrite);
        if (rewriteAfter.length !== 2) throw new Error(`重写不是一次，捕获 ${rewriteAfter.length}`);
        await waitReply(page, BAD);

        console.log('[hl-reply] 连发三条只生成一次');
        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: CALM, chunks: 1, delay: { firstMs: 30, perChunkMs: 20 } });
        const sinceBurst = (await ctx.fixtureHttp.captures()).at(-1)?.seq ?? 0;
        await page.evaluate(async (parts) => {
            const box = document.querySelector('#send_textarea');
            const send = document.querySelector('#send_but');
            const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            for (const text of parts) {
                set.call(box, text);
                box.dispatchEvent(new Event('input', { bubbles: true }));
                send.click();
                await new Promise((resolve) => setTimeout(resolve, 120));
            }
        }, BURST);
        await page.waitForTimeout(700);
        const early = await chatCaptures(ctx, sinceBurst);
        if (early.length !== 0) throw new Error(`连发在安静窗口内就生成了 ${early.length} 次`);
        const burstDeadline = Date.now() + 15000;
        let burstRows = [];
        while (Date.now() < burstDeadline) {
            burstRows = await chatCaptures(ctx, sinceBurst);
            if (burstRows.length >= 1) break;
            await page.waitForTimeout(300);
        }
        if (burstRows.length !== 1) throw new Error(`连发应只生成一次，捕获 ${burstRows.length}`);
        await page.waitForTimeout(1500);
        const burstAfter = await chatCaptures(ctx, sinceBurst);
        if (burstAfter.length !== 1) throw new Error(`连发之后又生成了，捕获 ${burstAfter.length}`);
        await page.waitForFunction((text) => {
            const chat = window.SillyTavern.getContext().chat || [];
            return chat.some((item) => item?.is_user && item.mes === text);
        }, BURST.join('\n'), { timeout: 15000 });
        await waitReply(page,CALM);

        console.log('[hl-reply] RQ-8 默认关闭与两步生成 A/B');
        const samples=[];
        for(const enabled of [false,true]) {
            console.log(`[hl-reply] planner ${enabled?'on':'off'}`);
            await page.emulateMedia({reducedMotion:'reduce'});
            await page.evaluate(async(enabled)=>{
                const c=SillyTavern.getContext();
                const {openCompanionStyle}=await import('/scripts/extensions/third-party/vc-model-settings/persona.js');
                openCompanionStyle({getContext:SillyTavern.getContext});
                const button=document.querySelector('[data-action="toggle-planner"]');
                if((button.getAttribute('aria-checked')==='true')!==enabled)button.click();
                if((c.extensionSettings.vc_reply_planner===true)!==enabled)throw Error('planner setting not saved');
            },enabled);
            if(enabled) {
                await voiceShots(page,ctx,'RQ-8','planner');
                fs.writeFileSync(path.resolve('.review-queue/RQ-8/NOTES.md'),'# RQ-8\n\n设置 › 陪伴风格新增默认关闭的「先想再说」，沿用分组、开关与脚注。截图仅含合成数据。受管断言覆盖开关保存、恢复默认和实际调用数。\n');
            }
            await page.locator('.vc-sheet-done').last().click();
            await page.emulateMedia({reducedMotion:'no-preference'});
            await ctx.fixtureHttp.setOverride('vc03m-chat',{text:CALM,replyPlanner:'{"kind":"reply","direction":"回应近况"}',chunks:1,delay:{firstMs:30,perChunkMs:20}});
            const since=(await ctx.fixtureHttp.captures()).at(-1)?.seq || 0;
            const start=Date.now();await sendText(page,LONG);await waitReply(page,CALM);
            const rows=await chatCaptures(ctx,since);
            assert.equal(rows.length,enabled?2:1,'RQ-8 actual native model calls');
            if(enabled) {
                const helper=rows[0].body;
                assert.ok(helper.messages.some(m=>String(m.content).includes('<vc-reply-planner>')));
                assert.ok(!helper.tools?.length,'planner must not execute tools');
                assert.ok(!JSON.stringify(helper.messages).includes('<vc_memory'),'planner must not consume final memory injection');
                assert.ok(rows[1].body.messages.some(m=>String(m.content).includes('<vc-reply-plan>')));
            }
            samples.push({enabled,calls:rows.length,replyMs:Date.now()-start});
        }
        // A malformed plan uses the normal reply; an explicit closing may stay quiet.
        console.log('[hl-reply] planner malformed fallback');
        await ctx.fixtureHttp.setOverride('vc03m-chat',{text:CALM,replyPlanner:'invalid',chunks:1});
        let since=(await ctx.fixtureHttp.captures()).at(-1)?.seq || 0;
        await sendText(page,LONG);await waitReply(page,CALM);
        assert.equal((await chatCaptures(ctx,since)).length,2);
        const assistantCount=await page.evaluate(()=>SillyTavern.getContext().chat.filter(m=>!m.is_user).length);
        console.log('[hl-reply] planner closing silence');
        await ctx.fixtureHttp.setOverride('vc03m-chat',{text:CALM,replyPlanner:'{"kind":"stay_silent","direction":""}',chunks:1});
        since=(await ctx.fixtureHttp.captures()).at(-1)?.seq || 0;
        await sendText(page,'晚安！');
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.mes==='晚安！' && document.body.getAttribute('data-generating')!=='true',null,{timeout:30000});
        assert.equal((await chatCaptures(ctx,since)).length,1);
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.filter(m=>!m.is_user).length),assistantCount);
        await page.evaluate(async()=>{
            const {openCompanionStyle}=await import('/scripts/extensions/third-party/vc-model-settings/persona.js');openCompanionStyle({getContext:SillyTavern.getContext});
            document.querySelector('[data-action="restore-rules"]').click();
            if(SillyTavern.getContext().extensionSettings.vc_reply_planner!==false)throw Error('default planner must be off');
        });
        await page.locator('.vc-sheet-done').last().click();
        await page.evaluate(async()=>await (await import('/script.js')).saveSettings());
        ctx.results.rq8Planner={provider:'managed synthetic fixture',samples,qualityComparison:'fixture validates routing only; no real-model quality claim'};
        fs.writeFileSync(path.join(ctx.artifactsDir,'rq8-planner.json'),JSON.stringify(ctx.results.rq8Planner,null,2));

        console.log('[hl-reply] RQ-9 长回复折叠与实际篇幅统计');
        const longReply='今天路过一家小店，门口的猫正趴在垫子上晒太阳。'.repeat(24);
        await ctx.fixtureHttp.setOverride('vc03m-chat',{text:longReply,chunks:1});
        await sendText(page,LONG);await waitReply(page,longReply);
        const last=page.locator('#chat > .mes').last();
        const expand=last.getByRole('button',{name:'展开全文'});await expand.waitFor();
        assert.equal(await expand.getAttribute('aria-expanded'),'false');
        for(const style of ['bubble','spread']) {
            await page.evaluate(async(style)=>(await import('/scripts/extensions/third-party/vc-model-settings/chat-view.js')).writeReplyStyle(style),style);
            await expand.scrollIntoViewIfNeeded();
            await voiceShots(page,ctx,'RQ-9',`collapsed-${style}`);
        }
        await expand.click();
        assert.equal(await last.getByRole('button',{name:'收起'}).getAttribute('aria-expanded'),'true');
        assert.ok((await last.locator('.vc-segs').first().textContent()).length>360);
        await last.getByRole('button',{name:'收起'}).click();
        const actual=await page.evaluate(()=>SillyTavern.getContext().chat);
        assert.equal(actual.at(-1).mes,longReply);
        assert.ok(actual.at(-1).extra?.vc_reply_length_tier);
        const current=actual.at(-1);
        assert.equal(current.swipe_info[current.swipe_id].extra.vc_reply_length_tier,current.extra.vc_reply_length_tier);
        const persisted=await st.call('POST','/api/chats/get',{avatar_url:avatar,file_name:file});
        assert.equal(persisted.status,200);
        assert.equal(persisted.json.at(-1).extra.vc_reply_length_tier,current.extra.vc_reply_length_tier,'actual tier must survive native save');
        ctx.results.rq9Lengths={provider:'managed synthetic fixture',...replyLengthStats(persisted.json)};
        fs.writeFileSync(path.join(ctx.artifactsDir,'rq9-lengths.json'),JSON.stringify(ctx.results.rq9Lengths,null,2));
        fs.writeFileSync(path.resolve('.review-queue/RQ-9/NOTES.md'),'# RQ-9\n\n普通陪伴长回复提供展开全文 / 收起，完整原文保持一条消息；卡片和 iframe 继续原生渲染。截图涵盖气泡 / 铺开、390 / 1440 与浅深色，仅含合成数据。交互断言覆盖可逆展开、存储完整与实际篇幅标签。\n');
        await bc.close();
    } finally {
        if(page && !page.isClosed())await page.evaluate(async()=>{
            SillyTavern.getContext().extensionSettings.vc_reply_planner=false;
            await (await import('/script.js')).saveSettings();
        });
        await ctx.fixtureHttp.setOverride('vc03m-chat', null);
        await browser.close();
    }
}

export const hlReplyScene = {
    id: 'hl-reply',
    title: '回复流水线：多气泡、硬违规只重写一次、连发三条只生成一次',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneHlReply,
};
export const scenes = [hlReplyScene];
