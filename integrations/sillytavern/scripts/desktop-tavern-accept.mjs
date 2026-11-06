// NF-07：九类自有酒馆设置通过真实ST文档接口保存；仅使用受管合成数据。
import assert from 'node:assert/strict';
import path from 'node:path';
import {PNG} from 'pngjs';
import { createStClient } from './managed-lib.mjs';
import { seedDesktopBenchmark, desktopBenchmarkContext } from './desktop-startup-accept.mjs';
import { openDesktopFixture } from './desktop-chat-accept.mjs';

async function sceneDesktopTavern(ctx) {
    const fixture = await seedDesktopBenchmark(ctx);
    const st = createStClient({baseUrl:ctx.w05.stBase,expectedIdentity:ctx.secrets.session,
        extraCookies:`vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}`});
    const settings = JSON.parse((await st.call('POST','/api/settings/get',{})).json.settings);
    settings.extension_settings.vc_reply_planner = false;
    settings.extension_settings.EjsTemplate ||= {};
    Object.assign(settings.extension_settings.EjsTemplate,{compile_workers:false,sandbox:false});
    settings.extension_settings.EjsTemplate.code_editor=true;
    settings.extension_settings.tavern_helper ||= {};
    settings.extension_settings.tavern_helper.script ||= {};
    settings.extension_settings.tavern_helper.script.enabled ||= {};
    settings.extension_settings.tavern_helper.script.enabled.characters = [fixture.avatar];
    settings.extension_settings.variables ||= {global:{}};settings.extension_settings.variables.global ||= {};settings.extension_settings.variables.global.NF07='初始';
    settings.oai_settings ||= {}; settings.oai_settings.top_k_openai = 0;
    settings.nf07_unknown = {preserve:'synthetic'};
    assert.equal((await st.call('POST','/api/settings/save',settings)).status,200);
    const presetName='NF07-preset';
    assert.equal((await st.call('POST','/api/presets/save',{apiId:'openai',name:presetName,preset:{...settings.oai_settings,temperature:0.4,frequency_penalty:0,presence_penalty:0,repetition_penalty:1,top_p:1,min_p:0,top_k:0,top_a:0,
        prompts:[{identifier:'main',name:'主提示词',role:'system',content:'NF07 named {{char}}',system_prompt:true,marker:false}],prompt_order:[{character_id:100001,order:[{identifier:'main',enabled:true}]}]}})).status,200);
    const book='NF07-synthetic';
    assert.equal((await st.call('POST','/api/worldinfo/edit',{name:book,data:{entries:{0:{uid:0,key:[],keysecondary:[],constant:true,content:'NF07 世界书 <%= "运行" %>',comment:'NF07 条目',order:100,position:0,disable:false,probability:100,useProbability:true,depth:4,role:0}}}})).status,200);
    const {chromium}=await import('playwright-core');
    const browser=await chromium.launch({headless:true,...(process.env.VC_W03_CHROMIUM_PATH?{executablePath:process.env.VC_W03_CHROMIUM_PATH}:{})});
    const context=await desktopBenchmarkContext(browser,ctx),page=await context.newPage(),errors=[],forbidden=[];
    const beforeSettings=await ctx.fixtureHttp.count({protocol:'chat'});
    page.setDefaultTimeout(25000);
    page.on('pageerror',error=>errors.push(error.name+': '+error.message));
    page.on('request',request=>{const pathname=new URL(request.url()).pathname;if(['/', '/script.js','/scripts/extensions.js','/scripts/st-context.js'].includes(pathname))forbidden.push(pathname);});
    let releaseRuntime;const gate=new Promise(resolve=>{releaseRuntime=resolve;});
    await page.route(url=>url.pathname.endsWith('/desktop/standalone/runtime.js')||url.pathname==='/version',async route=>{await gate;await route.continue();});
    const open=async key=>{
        const shell=page.locator('#vc-shell');
        if(await shell.getAttribute('data-settings')!=='open'){
            await page.locator('#vc-shell .vc-sidebar [data-settings]').click();
            await page.waitForFunction(()=>document.querySelector('#vc-shell')?.dataset.settings==='open');
        }
        await page.locator(`.vc-settings-categories [data-category="${key}"]`).click();
        await page.waitForFunction(k=>document.querySelector('.vc-settings-shell')?.dataset.category===k,key);
        await page.locator('.vc-tavern-form').waitFor();
    };
    const save=async()=>{await page.locator('[data-tavern-save]').click();await page.waitForFunction(()=>document.querySelector('[data-tavern-save]')?.disabled&&document.querySelector('.vc-tavern-form')?.getAttribute('aria-busy')==='false');};
    const field=name=>page.getByLabel(name,{exact:true});
    const shots=async key=>{
        for(const viewport of [{width:1440,height:900},{width:390,height:844}])for(const theme of ['light','dark']){
            await page.setViewportSize(viewport);
            await page.evaluate(async theme=>(await import('/scripts/extensions/third-party/vc-model-settings/ui/theme.js')).setThemeMode(theme),theme);
            await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'||a.effect?.getComputedTiming().iterations===Infinity));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            await page.screenshot({path:path.join(ctx.artifactsDir,`nf-tavern-${key}-${viewport.width}-${theme}.png`)});
            const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,bad:[...document.querySelectorAll('.vc-tavern-form input:not([type=hidden]),.vc-tavern-form textarea,.vc-tavern-form select')].filter(n=>n.getClientRects().length).some(n=>{const r=n.getBoundingClientRect();return r.left<0||r.right>innerWidth+1;})}));
            assert.ok(geometry.overflow<=1&&!geometry.bad,JSON.stringify(geometry));
            if(viewport.width===1440){const controls=await page.locator('.vc-tavern-form .vc-desk-field input:not([type=hidden]):not([type=checkbox]):not([aria-hidden=true])').evaluateAll(nodes=>nodes.map(node=>({type:node.type,field:node.closest('.vc-desk-field').dataset.tavernField,height:node.getBoundingClientRect().height,row:node.closest('.vc-desk-field').getBoundingClientRect().height})));assert.ok(controls.every(row=>row.height===36&&row.row>=44),'桌面输入视觉36px，行至少44px '+JSON.stringify(controls));const checks=await page.locator('.vc-tavern-check > input[type=checkbox]').evaluateAll(nodes=>nodes.map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,hit:node.closest('label').getBoundingClientRect().height,row:node.closest('.vc-desk-field').getBoundingClientRect().height})));assert.ok(checks.every(row=>row.width===18&&row.height===18&&row.hit>=44&&row.row>=44),'集合复选框18px，标签命中区与表单行至少44px '+JSON.stringify(checks));}
            if(viewport.width===390){
                const rows=await page.locator('.vc-tavern-form .vc-desk-field').evaluateAll(nodes=>nodes.slice(0,12).map(node=>{
                    const control=node.querySelector('input:not([type=hidden]),textarea,select,.vc-switch,output');
                    const style=control&&getComputedStyle(control);return{display:getComputedStyle(node).display,label:node.querySelector('label')?.textContent,
                        border:style?.borderTopWidth,height:control?.getBoundingClientRect().height,background:style?.backgroundColor};
                }));
                assert.ok(rows.every(row=>row.display==='grid'||row.display==='flex'),`窄窗口字段必须有明确布局 ${JSON.stringify(rows)}`);
            }
        }
        await page.setViewportSize({width:1440,height:900});
    };
    let stage='start';
    const at=value=>{stage=value;console.log(`[nf-tavern] ${value}`);};
    try{
        await openDesktopFixture(page,ctx.w05.stBase,fixture);
        at('held-reply');await open('left-nav-panel');
        await field('Top K').fill('-');assert.equal(await field('Top K').inputValue(),'-');
        await page.locator('[data-tavern-save]').click();await page.getByText('请先修正标出的输入。',{exact:true}).waitFor();
        assert.equal(await field('Top K').inputValue(),'-');await field('Top K').fill('23');await save();
        let current=JSON.parse((await st.call('POST','/api/settings/get',{})).json.settings);
        assert.equal(current.oai_settings.top_k_openai,23);assert.deepEqual(current.nf07_unknown,{preserve:'synthetic'});
        assert.equal(await page.locator('html').getAttribute('data-vc-runtime'),null,'酒馆设置不等待聊天模块');
        await shots('reply');
        at('conflict');await field('Top K').fill('24');
        const concurrent=structuredClone(current);concurrent.oai_settings.top_k_openai=25;
        assert.equal((await st.call('POST','/api/settings/save',concurrent)).status,200);
        await page.locator('[data-tavern-save]').click();await page.getByRole('button',{name:'加载最新',exact:true}).waitFor();
        assert.equal(await field('Top K').inputValue(),'24');
        await page.getByRole('button',{name:'加载最新',exact:true}).click();await page.getByRole('button',{name:'放弃',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('[data-tavern-group=reply] [data-tavern-field*=top_k_openai] input')?.value==='25');
        at('format');await open('AdvancedFormatting');await field('提示词').fill((await field('提示词').inputValue())+' NF07');await save();
        at('world');await open('WorldInfo');await page.locator('[data-tavern-resource=world]').selectOption(book);
        await field('内容').fill('NF07 世界书 <%= "已更新" %>');await page.locator('[data-tavern-group=global-world]').getByRole('checkbox',{name:book,exact:true}).check();await save();
        assert.equal((await st.call('POST','/api/worldinfo/get',{name:book})).json.entries[0].content,'NF07 世界书 <%= "已更新" %>');
        at('code-editor');await page.locator('[data-tavern-action=code-edit]').click();
        await page.locator('.vc-world-code-canvas .monaco-editor').waitFor({state:'visible'});
        await page.locator('.vc-world-code-canvas .view-lines').click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('NF07 Monaco <%= "saved" ');await page.keyboard.press('End');
        await page.getByText('编辑器设置',{exact:true}).click();await field('字号').fill('16');
        await page.waitForFunction(()=>getComputedStyle(document.querySelector('.vc-world-code-canvas .view-lines')).fontSize==='16px');
        await page.getByText('编辑器设置',{exact:true}).click();
        for(const viewport of [{width:1440,height:900},{width:390,height:844}])for(const theme of ['light','dark']){
            await page.setViewportSize(viewport);await page.evaluate(async theme=>(await import('/scripts/extensions/third-party/vc-model-settings/ui/theme.js')).setThemeMode(theme),theme);
            const box=await page.locator('.vc-world-code-canvas').boundingBox();assert.ok(box.width>200&&box.height>=240);
            await page.screenshot({path:path.join(ctx.artifactsDir,`nf-tavern-editor-${viewport.width}-${theme}.png`)});
        }
        await page.setViewportSize({width:1440,height:900});await page.locator('.vc-sheet').getByRole('button',{name:'完成',exact:true}).click();await page.locator('.vc-sheet').waitFor({state:'detached'});
        assert.equal(await field('内容').inputValue(),'NF07 Monaco <%= "saved" %>');await save();
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('st_monaco_editor_settings')).fontSize),16);
        assert.equal(await page.locator('html').getAttribute('data-vc-runtime'),null,'代码编辑器独立于聊天启动');
        assert.equal(await field('绑定世界书').isDisabled(),true,'运行模块未就绪时只禁止聊天绑定');await shots('world');
        for(const key of ['PersonaManagement','Backgrounds','user-settings-block','rm_api_block','right-nav-panel']){
            at(key);await open(key);assert.equal(await page.locator('.vc-tavern-banner[role=alert]').count(),0);
        }
        at('presentation');await open('user-settings-block');
        const previousCss=await field('自定义 CSS').inputValue();await field('自定义 CSS').fill(previousCss+'\nbody { --nf07-synthetic: 7; }');
        await page.getByRole('switch',{name:'隐藏聊天头像',exact:true}).click();await save();
        assert.equal(await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--nf07-synthetic').trim()),'7');
        assert.equal(await page.locator('body').getAttribute('data-vc-hide-chat-avatars'),'true');
        await field('自定义 CSS').fill(previousCss);await page.getByRole('switch',{name:'隐藏聊天头像',exact:true}).click();await save();
        at('background');await open('Backgrounds');
        const oldImages=(await st.call('POST','/api/backgrounds/all',{})).json.images.map(row=>row.filename);
        const image=new PNG({width:8,height:8});for(let i=0;i<image.data.length;i+=4){image.data[i]=51;image.data[i+1]=102;image.data[i+2]=153;image.data[i+3]=255;}
        const uploaded=page.waitForResponse(response=>response.url().endsWith('/api/backgrounds/all')&&response.request().method()==='POST');
        await page.locator('[data-tavern-upload=background-upload]').setInputFiles({name:'nf07-background.png',mimeType:'image/png',buffer:PNG.sync.write(image)});
        const filename=(await (await uploaded).json()).images.find(row=>!oldImages.includes(row.filename)).filename;
        await page.getByRole('button',{name:filename,exact:true}).click();await save();
        assert.ok(await page.locator('.vc-tavern-background').evaluate(node=>getComputedStyle(node).backgroundImage.includes('/backgrounds/')));
        assert.equal(await page.locator('.vc-tavern-background').isHidden(),false);
        await page.locator('[data-tavern-action=background-delete]').click();await page.getByRole('button',{name:'删除',exact:true}).click();await save();
        assert.equal(await page.locator('.vc-tavern-background').isHidden(),true);
        at('character-crud');await open('right-nav-panel');await page.locator('[data-tavern-action=character-new]').click();
        await page.locator('.vc-sheet input').fill('NF07 新建角色');await page.locator('.vc-sheet').getByRole('button',{name:'完成',exact:true}).click();
        await page.locator('.vc-sheet').waitFor({state:'detached'});
        await page.waitForFunction(()=>document.querySelector('[data-tavern-resource=character]')?.selectedOptions[0]?.textContent==='NF07 新建角色');
        const createdAvatar=await page.locator('[data-tavern-resource=character]').inputValue();
        await field('名称').fill('NF07 修改角色');await save();
        assert.equal((await st.call('POST','/api/characters/get',{avatar_url:createdAvatar})).json.name,'NF07 修改角色');
        await page.locator('[data-tavern-action=character-delete]').click();await page.getByRole('button',{name:'同时删除聊天',exact:true}).click();await page.getByRole('button',{name:'删除',exact:true}).click();
        await page.waitForFunction(avatar=>![...document.querySelector('[data-tavern-resource=character]').options].some(option=>option.value===avatar),createdAvatar);
        at('extensions');await open('rm_extensions_block');await field('全局变量').fill('{broken');
        await page.locator('[data-tavern-save]').click();assert.equal(await field('全局变量').inputValue(),'{broken');
        await field('全局变量').fill('{"NF07":"已保存"}');await save();await shots('extensions');
        assert.equal(await ctx.fixtureHttp.count({protocol:'chat'}),beforeSettings,'设置保存不能生成');
        at('runtime');releaseRuntime();await page.waitForFunction(()=>document.documentElement.dataset.vcRuntime==='prepared');
        await page.locator('#vc-shell .vc-sidebar [data-nav="chat"]').click();
        await page.locator('#send_textarea').fill('NF07 合成草稿');await page.waitForFunction(()=>Boolean(document.querySelector('#send_but')&&!document.querySelector('#send_but').disabled));
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chatCompletionSettings.top_k_openai),23,'已接受更改在迟到的运行模块中生效');
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().extensionSettings.variables.global.NF07),'已保存');
        at('late-global-variable');
        await page.evaluate(()=>{globalThis.nf07VariableOutcome=null;void TavernHelper.updateVariablesWith(async value=>{await new Promise(resolve=>{globalThis.nf07VariableRelease=resolve;});return{...value,NF07:'迟到修改'};},{type:'global'}).then(()=>{globalThis.nf07VariableOutcome=200;},error=>{globalThis.nf07VariableOutcome=error.status;});});
        await open('rm_extensions_block');await field('全局变量').fill('{"NF07":"手工更新"}');await save();
        await page.evaluate(()=>nf07VariableRelease());await page.waitForFunction(()=>globalThis.nf07VariableOutcome===409);
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().extensionSettings.variables.global.NF07),'手工更新');
        await field('全局变量').fill('{"NF07":"已保存"}');await save();
        await page.locator('#vc-shell .vc-sidebar [data-nav="chat"]').click();
        at('helper-worldbook');
        const helperBook=await page.evaluate(async()=>{
            await TavernHelper.createWorldbook('NF07-helper',[{name:'合成条目',content:'初始',strategy:{type:'constant'}}]);
            await TavernHelper.updateWorldbookWith('NF07-helper',entries=>entries.map(entry=>({...entry,content:'Helper 已更新'})));
            const result=await TavernHelper.createWorldbookEntries('NF07-helper',[{name:'新增',content:'第二条'}]);
            const removed=await TavernHelper.deleteWorldbookEntries('NF07-helper',entry=>entry.name==='新增');
            return {content:removed.worldbook[0].content,created:result.new_entries.length,deleted:removed.deleted_entries.length};
        });assert.deepEqual(helperBook,{content:'Helper 已更新',created:1,deleted:1});
        await page.waitForFunction(()=>Boolean(document.querySelector('#send_but')&&!document.querySelector('#send_but').disabled));
        at('helper-generation');await ctx.fixtureHttp.setOverride('vc03m-chat',{text:'NF07 脚本合成回复。',tool:null,chunks:3});
        const helper=await page.evaluate(async()=>{
            const ctx=SillyTavern.getContext(),length=ctx.chat.length,events=[];
            const listener=(_text,id)=>events.push(id);ctx.eventSource.on('js_stream_token_received_fully',listener);
            const raw=await TavernHelper.generateRaw({generation_id:'nf07-raw',user_input:'NF07 raw input',ordered_prompts:[{role:'system',content:'NF07 raw system'},'user_input'],max_chat_history:0,should_stream:true,should_return_reasoning:true});
            const normal=await TavernHelper.generate({generation_id:'nf07-preset',user_input:'NF07 preset input',overrides:{char_description:'NF07 description override',chat_history:{prompts:[]}},max_chat_history:0});
            ctx.eventSource.removeListener('js_stream_token_received_fully',listener);
            return {raw:raw.content,normal,length:ctx.chat.length-length,stream:events.includes('nf07-raw')};
        });assert.deepEqual(helper,{raw:'NF07 脚本合成回复。',normal:'NF07 脚本合成回复。',length:0,stream:true});
        const helperCaptures=await ctx.fixtureHttp.captures({protocol:'chat'});
        assert.deepEqual(helperCaptures.at(-2).body.messages.map(({role,content})=>({role,content})),[{role:'system',content:'NF07 raw system'},{role:'user',content:'NF07 raw input'}]);
        assert.ok(JSON.stringify(helperCaptures.at(-1).body.messages).includes('NF07 description override'));
        const named=await page.evaluate(name=>TavernHelper.generate({preset_name:name,user_input:'NF07 named input',max_chat_history:0}),presetName);assert.equal(named,'NF07 脚本合成回复。');
        assert.ok(JSON.stringify((await ctx.fixtureHttp.captures({protocol:'chat'})).at(-1).body.messages).includes('NF07 named NF 合成角色'));
        at('nested-ejs');
        const nestedBefore=await ctx.fixtureHttp.count({protocol:'chat'});
        const nested=await page.evaluate(async()=>{
            const ctx=SillyTavern.getContext(),card=ctx.characters[ctx.characterId],previous=card.description;
            card.description='<% globalThis.nf07ExpiredHelper = TavernHelper; const value = await TavernHelper.generateRaw({user_input:"NF07 nested",ordered_prompts:["user_input"],max_chat_history:0}); %>NF07 nested EJS <%= value %>';
            try{return await TavernHelper.generate({user_input:'NF07 outer',max_chat_history:0});}finally{card.description=previous;}
        });assert.equal(nested,'NF07 脚本合成回复。');
        assert.equal(await ctx.fixtureHttp.count({protocol:'chat'}),nestedBefore+2,'EJS内生成是同一owner串行子步骤');
        assert.ok(JSON.stringify((await ctx.fixtureHttp.captures({protocol:'chat'})).at(-1).body.messages).includes('NF07 nested EJS NF07 脚本合成回复。'));
        assert.equal(await page.evaluate(async()=>{try{await nf07ExpiredHelper.generateRaw({user_input:'过期',ordered_prompts:['user_input']});return false;}catch{return true;}}),true,'结束模板不能沿用生成上下文');
        at('input-preferences');await open('user-settings-block');await page.getByRole('switch',{name:'Markdown 快捷键',exact:true}).click();await save();
        await page.locator('#vc-shell .vc-sidebar [data-nav="chat"]').click();
        await page.locator('#send_textarea').fill('NF07 keyboard');await page.locator('#send_textarea').press('ControlOrMeta+A');await page.locator('#send_textarea').press('Control+b');
        assert.equal(await page.locator('#send_textarea').inputValue(),'**NF07 keyboard**');
        await open('user-settings-block');await page.getByRole('switch',{name:'Markdown 快捷键',exact:true}).click();await save();
        at('continuation');await open('left-nav-panel');await page.getByRole('switch',{name:'发送时续写',exact:true}).click();await page.getByRole('switch',{name:'自动续写',exact:true}).click();await page.getByRole('switch',{name:'允许聊天补全续写',exact:true}).click();
        const tokens=await page.evaluate(()=>SillyTavern.getContext().getTokenCountAsync('NF07 脚本合成回复。',0));await field('续写目标长度').fill(String(tokens+1));await save();
        const beforeContinue=await ctx.fixtureHttp.count({protocol:'chat'});
        await page.locator('#vc-shell .vc-sidebar [data-nav="chat"]').click();await page.locator('#send_textarea').fill('NF07 自动续写');await page.locator('#send_but').click();
        await page.waitForFunction(()=>!document.querySelector('#mes_stop')&&SillyTavern.getContext().chat.at(-1)?.mes==='NF07 脚本合成回复。NF07 脚本合成回复。');
        assert.equal(await ctx.fixtureHttp.count({protocol:'chat'}),beforeContinue+2);
        await open('left-nav-panel');await page.getByRole('switch',{name:'发送时续写',exact:true}).click();await page.getByRole('switch',{name:'自动续写',exact:true}).click();await page.getByRole('switch',{name:'允许聊天补全续写',exact:true}).click();await save();
        at('chat-world');await open('WorldInfo');assert.equal(await field('绑定世界书').isDisabled(),false);
        await field('绑定世界书').selectOption(book);await save();
        assert.equal((await st.call('POST','/api/chats/get',{avatar_url:fixture.avatar,file_name:fixture.file})).json[0].chat_metadata.world_info,book);
        await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.documentElement.dataset.vcApp==='ready');
        await page.locator('#vc-shell .vc-sidebar [data-nav="chat"]').click();
        await page.locator(`[data-convo-list] [data-relationship-id="${fixture.chat[0].chat_metadata.vc_binding.relationshipId}"]`).click();
        await page.waitForFunction(()=>document.documentElement.dataset.vcRuntime==='prepared'&&SillyTavern.getContext().chatMetadata.world_info==='NF07-synthetic');
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chatCompletionSettings.top_k_openai),25,'刷新读取并发端保存的新值');
        assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);
        return {pages:9,heldRuntime:true,conditionalSave:true,conflictDraft:true,numericDraft:true,jsonDraft:true,unknownPreserved:true,metadataF2:true,refresh:true,nativeRequests:0};
    }catch(error){throw new Error(`NF07 ${stage}: ${error.message}; ${JSON.stringify({errors,forbidden})}`);}
    finally{releaseRuntime();await browser.close();await ctx.fixtureHttp.setOverride('vc03m-chat',null);}
}
export const desktopTavernScene={id:'nf-tavern',title:'NF-07 独立酒馆设置、条件保存与运行时应用',needs:['catalog','stack','browser'],default:false,run:sceneDesktopTavern};
