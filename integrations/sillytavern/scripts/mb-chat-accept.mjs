// MB-4：真实 /m/ 页面的聊天操作与手机多尺寸截图。仅合成账号、合成消息。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStClient } from './managed-lib.mjs';
import { completeStOnboarding } from './lib/st-onboarding.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import { ownerBudgetResetSql } from './lib/owner-budget.mjs';

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
    let page;
    try {
        const bc=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
        await bc.addCookies([{name:'vc_session',value:s.vcSession,url:ctx.w05.stBase},{name:'vc_csrf',value:s.vcCsrf,url:ctx.w05.stBase}]);
        await completeStOnboarding(bc,ctx.w05.stBase);
        page=await bc.newPage();page.setDefaultTimeout(20000);
        const errors=[];page.on('pageerror',e=>errors.push(e.message.slice(0,160)));
        await page.goto(`${ctx.w05.stBase}/m/?vcdebug=1`);
        await page.locator(`.vc-row[data-chat-file='${file}']`).click();
        const input=page.locator('.vc-chat-input textarea');
        await input.fill('测试：你好');
        await page.waitForFunction(()=>document.documentElement.dataset.vcEngine==='ready',null,{timeout:180000});
        await page.waitForFunction(()=>!document.querySelector('[aria-label="发送"]')?.hasAttribute('disabled'));
        await reply('测试回复：今天也一起好好过。');
        await page.getByRole('button',{name:'发送',exact:true}).click();
        await page.locator('.vc-markdown',{hasText:'今天也一起好好过'}).waitFor();
        await page.getByRole('button',{name:'发送',exact:true}).waitFor();
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
        await page.locator('.vc-edit-sheet textarea').fill('测试：修改过的回复');
        await page.getByRole('button',{name:'保存',exact:true}).click();
        await page.locator('.vc-markdown',{hasText:'修改过的回复'}).waitFor();
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
        for(const width of [360,390,430,1440])for(const scheme of ['light','dark']) {
            await page.setViewportSize({width,height:width===1440?900:844});await page.emulateMedia({colorScheme:scheme});
            await page.screenshot({path:path.join(SHOTS,`conversation-${width}-${scheme}.png`)});
            const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
            if(overflow)throw Error(`宽度 ${width} 横向溢出`);
        }
        if(errors.length)throw Error(`页面错误：${errors.join(' | ')}`);
        fs.writeFileSync(path.join(SHOTS,'NOTES.md'),'# MB-4\n\n合成会话：发送与停止、引用、搜索、草稿回填、编辑删除；360/390/430/1440 浅深色截图。\n');
        await bc.close();
    } catch (e) {
        if(page) { await page.screenshot({path:path.join(SHOTS,'failure.png')}).catch(()=>{}); const state=await page.evaluate(()=>({url:location.hash,engine:document.documentElement.dataset.vcEngine,buttons:[...document.querySelectorAll('uni-button[aria-label]')].slice(0,12).map(b=>({role:b.getAttribute('role'),label:b.getAttribute('aria-label')}))})).catch(()=>({})); console.log('[mb-chat] failure state '+JSON.stringify(state)); }
        throw e;
    } finally {await ctx.fixtureHttp.setOverride('vc03m-chat',null);await browser.close();}
}
export const mbChatScene={id:'mb-chat',title:'MB-4 H5 聊天：页面操作、草稿保留与多尺寸布局',needs:['catalog','stack','browser'],default:false,run:sceneMbChat};
