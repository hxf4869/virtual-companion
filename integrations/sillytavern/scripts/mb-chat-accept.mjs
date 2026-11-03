// MB-4：真实 /m/ 页面的聊天操作与手机多尺寸截图。仅合成账号、合成消息。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStClient } from './managed-lib.mjs';
import { completeStOnboarding } from './lib/st-onboarding.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import { ownerBudgetResetSql } from './lib/owner-budget.mjs';
import { makePng } from './lib/fixtures.mjs';
import { ensureNativeConnection } from './desktop-startup-accept.mjs';
import assert from 'node:assert/strict';

const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.review-queue/MB-4');
export async function sceneMbChat(ctx) {
    fs.mkdirSync(SHOTS, {recursive:true});
    await reauthForWrite(ctx);
    const row=(await ctx.admin.listPurposes()).json.find(x=>x.purpose==='FOREGROUND_CHAT');
    const b=await ctx.admin.savePurpose('FOREGROUND_CHAT',{providerId:'vc03m-chat',profileKey:'chat',state:'ENABLED',expectedRevision:row.revision});
    if(b.status!==200) throw Error('前台绑定失败');
    ctx.w10.psql(ownerBudgetResetSql(ctx.w05.ownerId));
    const s=ctx.secrets.session;
    const st=createStClient({baseUrl:ctx.w05.stBase,expectedIdentity:s,extraCookies:`vc_session=${s.vcSession}; vc_csrf=${s.vcCsrf}`});
    const name=`小满MB4${crypto.randomUUID().slice(0,6)}`;
    const form=new FormData();form.append('file_type','json');form.append('avatar',new Blob([JSON.stringify({name,description:'仅供移动端合成测试',first_mes:'早呀～',personality:'',scenario:'',mes_example:''})],{type:'application/json'}),'card.json');
    const imp=await st.call('POST','/api/characters/import',form);
    if(imp.status!==200) throw Error('导入合成卡失败');
    const avatar=`${imp.json.file_name.replace(/\.png$/,'')}.png`; const file=`MB4-${crypto.randomUUID()}`;
    const messages=['早呀～','今天降温了，出门记得带围巾','收到！','你今天干嘛','在整理上次拍的照片','有一张晚霞超好看，等下发你'].map((mes,i)=>({name:i===2||i===3?'合成用户':name,is_user:i===2||i===3,mes,send_date:new Date(Date.now()-(6-i)*60000).toISOString()}));
    const saved=await st.call('POST','/api/chats/save',{avatar_url:avatar,file_name:file,chat:[{user_name:'unused',character_name:name,chat_metadata:{vc_f2:{id:crypto.randomUUID(),revision:0}}},...messages]});
    if(saved.status!==200)throw Error('保存合成聊天失败');
    const {chromium}=await import('playwright-core');
    const browser=await chromium.launch({headless:true,...(process.env.VC_W03_CHROMIUM_PATH?{executablePath:process.env.VC_W03_CHROMIUM_PATH}:{})});
    const reply=(text,chunks=5,perChunkMs=40)=>ctx.fixtureHttp.setOverride('vc03m-chat',{text,chunks,delay:{firstMs:50,perChunkMs}});
    let page,nestedFile='';
    try {
        const bc=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
        await bc.addCookies([{name:'vc_session',value:s.vcSession,url:ctx.w05.stBase},{name:'vc_csrf',value:s.vcCsrf,url:ctx.w05.stBase}]);
        await completeStOnboarding(bc,ctx.w05.stBase);
        page=await bc.newPage();page.setDefaultTimeout(20000);
        const errors=[],errorStacks=[];page.on('pageerror',e=>{errors.push(e.message.slice(0,160));errorStacks.push(String(e.stack).split('\n').filter(line=>/^\s+at /.test(line)).slice(0,6))});
        await page.goto(`${ctx.w05.stBase}/m/?vcdebug=1`);
        await page.locator(`.vc-row[data-chat-file='${file}']`).click();
        const input=page.locator('.vc-chat-input textarea');
        await input.fill('测试：你好');
        await page.waitForFunction(()=>document.documentElement.dataset.vcEngine==='ready',null,{timeout:180000});
        await ensureNativeConnection(page.frames().find(frame => new URL(frame.url()).pathname === '/native/'));
        await page.waitForFunction(()=>!document.querySelector('[aria-label="发送"]')?.hasAttribute('disabled'));
        await reply('测试回复：今天也一起好好过。');
        await page.getByRole('button',{name:'发送',exact:true}).click();
        await page.locator('.vc-markdown',{hasText:'今天也一起好好过'}).waitFor();
        await page.waitForFunction(()=>!document.querySelector('.vc-typing'));
        if(await input.inputValue())throw Error('发送成功草稿未清');
        console.log('[mb-chat] PASS 页面发送、流式、草稿清除');
        // 长按等价的右键菜单：引用、编辑与删除都走可见操作。
        const last=page.locator('.vc-markdown').last();await last.click({button:'right'});
        await page.getByRole('menuitem',{name:'引用',exact:true}).click();
        if(!await page.locator('.vc-compose-quote').isVisible())throw Error('引用条未显示');
        await input.fill('保留的草稿');
        await page.getByRole('button',{name:'取消引用'}).click();
        await page.locator('.vc-conv-nav [aria-label="返回"]').click();
        await page.locator(`.vc-row[data-chat-file='${file}']`).waitFor();
        if(!await page.locator(`.vc-row[data-chat-file='${file}']`).innerText().then(t=>t.includes('草稿：保留的草稿')))throw Error('列表无草稿预览');
        await page.locator(`.vc-row[data-chat-file='${file}']`).click();
        await input.waitFor(); if(await input.inputValue()!=='保留的草稿')throw Error('重新进入丢草稿');
        console.log('[mb-chat] PASS 引用、离开页面与草稿回填');
        await page.getByRole('button',{name:'搜索',exact:true}).click();
        await page.locator('.vc-chat-search input').fill('晚霞');
        await page.locator('.is-match').waitFor();
        await page.getByRole('button',{name:'完成',exact:true}).click();
        await page.locator('.vc-markdown').last().click({button:'right'});
        await page.getByRole('menuitem',{name:'编辑',exact:true}).click();
        const image='data:image/png;base64,'+makePng({width:640,height:320}).toString('base64');
        await page.locator('.vc-edit-sheet textarea').fill(`测试：修改过的回复\n\n![合成图片](${image})`);
        await page.getByRole('button',{name:'保存',exact:true}).click();
        await page.locator('.vc-markdown',{hasText:'修改过的回复'}).waitFor();
        const picture=page.locator('.vc-markdown img').last();await picture.waitFor();
        if(!await picture.evaluate(el=>el.getBoundingClientRect().width<=el.closest('.vc-bubble').getBoundingClientRect().width))throw Error('富内容图片超出气泡');
        await picture.click();await page.getByRole('dialog',{name:'图片预览',exact:true}).waitFor();await page.getByRole('button',{name:'关闭图片',exact:true}).click();
        await page.locator('.vc-markdown').last().click({button:'right'});
        await page.getByRole('menuitem',{name:'删除',exact:true}).click();
        await page.getByRole('button',{name:'取消',exact:true}).evaluate(el=>{if(el!==document.activeElement)throw Error('危险确认没有默认聚焦取消')});
        await page.getByRole('button',{name:'删除',exact:true}).click();
        await page.locator('.vc-markdown',{hasText:'修改过的回复'}).waitFor({state:'detached'});
        console.log('[mb-chat] PASS 搜索、编辑、删除');
        await reply('测试回复：'+'连续内容。'.repeat(60),50,150);
        await input.fill('测试：继续说');await page.getByRole('button',{name:'发送',exact:true}).click();
        await page.locator('.vc-markdown',{hasText:'连续内容'}).first().waitFor();await page.getByRole('button',{name:'停止',exact:true}).click();
        await page.locator('.vc-chat-note',{hasText:'已停止'}).waitFor();
        console.log('[mb-chat] PASS 停止保留部分回复');
        // A page remains in uni-app's stack while a new instance uses the single ST engine.
        await input.fill('返回 A 后保留');await page.locator('.vc-identity').click();await page.getByRole('button',{name:'新建实例',exact:true}).click();await page.getByLabel('实例名称',{exact:true}).fill('MB4 嵌套实例');await page.getByRole('button',{name:'开始聊天',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.vc-conversation')&&!document.querySelector('.vc-connection')&&globalThis.__vcEngine.chatId()!=='');
        nestedFile=await page.evaluate(()=>globalThis.__vcEngine.chatId());if(nestedFile===file)throw Error('新实例未切换聊天');
        await page.locator('.vc-conv-nav [aria-label="返回"]').click();await page.locator('.vc-subnav [aria-label="返回"]').click();await page.waitForFunction(expected=>globalThis.__vcEngine.chatId()===expected&&!document.querySelector('.vc-connection'),file);if(await input.inputValue()!=='返回 A 后保留')throw Error('恢复旧页丢失草稿');
        const marker='测试：只写入恢复后的 A';await reply('测试回复：回到这边了。');await input.fill(marker);await page.getByRole('button',{name:'发送',exact:true}).click();await page.locator('.vc-markdown',{hasText:'回到这边了'}).waitFor();await page.waitForFunction(()=>!document.querySelector('.vc-typing'));
        const readA=await st.call('POST','/api/chats/get',{avatar_url:avatar,file_name:file});const readB=await st.call('POST','/api/chats/get',{avatar_url:avatar,file_name:nestedFile});if(!readA.json.some(m=>m.is_user&&m.mes===marker)||readB.json.some(m=>m.mes===marker))throw Error('恢复旧页后消息写错会话');
        await page.locator('.vc-markdown').first().click({button:'right'});await page.getByRole('menuitem',{name:'编辑',exact:true}).click();await page.locator('.vc-edit-sheet textarea').fill('```html\n<div>合成互动内容</div>\n```');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('button',{name:/互动卡片/}).first().click();await page.locator('.vc-stview-bar').waitFor();
        await page.evaluate(async({avatar,file})=>globalThis.__vcEngine.open(avatar,file),{avatar,file:nestedFile});await page.locator('.vc-stview-bar [aria-label="返回"]').click();await page.waitForFunction(expected=>globalThis.__vcEngine.chatId()===expected&&!document.querySelector('.vc-connection'),file);
        console.log('[mb-chat] PASS 嵌套会话返回与酒馆视图返回重新绑定，消息只写入原会话');
        for(const width of [360,390,430,1440])for(const scheme of ['light','dark']) {
            await page.setViewportSize({width,height:width===1440?900:844});await page.emulateMedia({colorScheme:scheme});
            await page.screenshot({path:path.join(SHOTS,`conversation-${width}-${scheme}.png`)});
            const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
            if(overflow)throw Error(`宽度 ${width} 横向溢出`);
        }
        // NF-11：正式根桌面与手机原生宿主同时持有同一聊天，双向 CAS。
        const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
        const nativeConflicts = [];
        const recordNativeConflict = response => {
            if (new URL(response.url()).pathname === '/api/chats/save' && response.status() === 409) {
                nativeConflicts.push(response.json().then(body => body.code));
            }
        };
        page.on('response', recordNativeConflict);
        try {
            await desktopContext.addCookies(await bc.cookies());
            const desktop = await desktopContext.newPage(), nativeRequests = [];
            desktop.setDefaultTimeout(30000);
            desktop.on('request', request => { const path = new URL(request.url()).pathname; if (['/native/', '/script.js', '/scripts/extensions.js', '/scripts/st-context.js'].includes(path)) nativeRequests.push(path); });
            const current = (await st.call('POST', '/api/chats/get', { avatar_url: avatar, file_name: file })).json;
            await desktop.goto(ctx.w05.stBase + '/');
            await desktop.waitForFunction(() => document.documentElement.dataset.vcApp === 'ready');
            await desktop.evaluate(row => document.querySelector('#vc-shell').openConversation(row), { avatar, file, ...current[0].chat_metadata.vc_binding });
            await desktop.waitForFunction(id => document.documentElement.dataset.vcRuntime === 'prepared' && SillyTavern.getContext().chatMetadata?.vc_f2?.id === id, current[0].chat_metadata.vc_f2.id);
            const nativeMarker = 'NF11 手机先保存的修订';
            await page.evaluate(text => globalThis.__vcEngine.edit(0, text), nativeMarker);
            const calls = await ctx.fixtureHttp.count({ protocol: 'chat' });
            const draft = 'NF11 桌面保留的冲突草稿';
            await desktop.locator('#send_textarea').fill(draft);
            await desktop.waitForFunction(() => !document.querySelector('#send_but').disabled);
            await desktop.locator('#send_but').click();
            const panel = desktop.locator('#vc-f2-conflict'); await panel.waitFor({ state: 'visible' });
            assert.equal(await desktop.locator('#send_textarea').inputValue(), draft);
            assert.equal(await ctx.fixtureHttp.count({ protocol: 'chat' }), calls, '桌面保存冲突不能发模型请求');
            await panel.locator('[data-action="view-latest"]').click(); await panel.waitFor({ state: 'hidden' });
            await desktop.waitForFunction(text => SillyTavern.getContext().chat[0].mes === text, nativeMarker);
            assert.equal(await desktop.locator('#send_textarea').inputValue(), draft);
            await reply('测试回复：跨端版本已同步。');
            await desktop.waitForFunction(() => !document.querySelector('#send_but').disabled);
            await desktop.locator('#send_but').click();
            await desktop.waitForFunction(() => !document.querySelector('#mes_stop') && SillyTavern.getContext().chat.at(-1)?.mes.includes('跨端版本已同步'));
            assert.equal(await ctx.fixtureHttp.count({ protocol: 'chat' }), calls + 1, '显式读取最新后只有一次生成');
            const nativeDraft = 'NF11 手机旧版本保留的修订草稿';
            const rejected = await page.evaluate(async text => {
                let code;
                try { await globalThis.__vcEngine.edit(0, text); } catch (error) { code = error.code; }
                const w = globalThis.__vcEngine.frame.contentWindow;
                const { readF2Draft } = await w.eval("import('/scripts/vc-runtime/f2-client.js')");
                return { code, retained: Boolean(readF2Draft()?.includes(text)) };
            }, nativeDraft);
            assert.ok(['VC_REVISION_CONFLICT', 'VC_STALE_SOURCE'].includes(rejected.code));
            assert.equal(rejected.retained, true);
            assert.ok((await Promise.all(nativeConflicts)).includes('VC_REVISION_CONFLICT'), '手机必须实际观察到服务端409；此前失败已封锁队列时后续写入仍拒绝');
            const latest = (await st.call('POST', '/api/chats/get', { avatar_url: avatar, file_name: file })).json;
            assert.equal(latest[1].mes, nativeMarker);
            assert.equal(latest.filter(row => row.is_user && row.mes === draft).length, 1);
            assert.ok(!latest.some(row => row.mes === nativeDraft));
            assert.deepEqual(nativeRequests, [], '正式根桌面不借用手机原生宿主');
            assert.equal(await desktop.locator('#vc-engine').count(), 0);
            console.log('[mb-chat] PASS 根桌面/手机同一聊天双向CAS、保留草稿、显式重读后单次生成');
        } finally { page.off('response', recordNativeConflict); await desktopContext.close(); }
        if(errors.length)throw Error(`页面错误：${errors.join(' | ')};frames=${JSON.stringify(errorStacks)}`);
        fs.writeFileSync(path.join(SHOTS,'NOTES.md'),'# MB-4\n\n合成会话：发送与停止、引用、搜索、草稿回填、编辑删除；新增嵌套实例与酒馆视图切换后返回，恢复原会话并确认消息没有写到另一实例；360/390/430/1440 浅深色截图。\n');
        await bc.close();
    } catch (e) {
        if(page) { await page.screenshot({path:path.join(SHOTS,'failure.png')}).catch(()=>{}); const state=await page.evaluate(()=>({url:location.hash,engine:document.documentElement.dataset.vcEngine,buttons:[...document.querySelectorAll('uni-button[aria-label]')].slice(0,12).map(b=>({role:b.getAttribute('role'),label:b.getAttribute('aria-label')}))})).catch(()=>({})); console.log('[mb-chat] failure state '+JSON.stringify(state)); }
        throw e;
    } finally {await ctx.fixtureHttp.setOverride('vc03m-chat',null);await browser.close();if(nestedFile){const read=await st.call('POST','/api/chats/get',{avatar_url:avatar,file_name:nestedFile});if(read.status!==200)throw Error('读取嵌套夹具删除基线失败');const deleted=await st.call('POST','/api/chats/delete',{avatar_url:avatar,chatfile:`${nestedFile}.jsonl`,vc_f2:read.json[0].chat_metadata.vc_f2});if(deleted.status!==200)throw Error(`清理嵌套聊天失败 HTTP ${deleted.status}`);}}
}
export const mbChatScene={id:'mb-chat',title:'MB-4 H5 聊天：页面操作、草稿保留与多尺寸布局',needs:['catalog','stack','browser'],default:false,run:sceneMbChat};
