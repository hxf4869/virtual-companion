// MB-5：原生 H5 一级页与设置读写。使用受管账号，不触及 Owner 的数据。
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {createStClient} from './managed-lib.mjs';import {completeStOnboarding} from './lib/st-onboarding.mjs';import {reauthForWrite} from './lib/reauth-write.mjs';
const SHOTS=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../.review-queue/MB-5');
export async function sceneMbPages(ctx) {
 fs.mkdirSync(SHOTS,{recursive:true});await reauthForWrite(ctx);
 const s=ctx.secrets.session;const st=createStClient({baseUrl:ctx.w05.stBase,expectedIdentity:s,extraCookies:`vc_session=${s.vcSession}; vc_csrf=${s.vcCsrf}`});
 const name=`澄夏MB5${crypto.randomUUID().slice(0,5)}`;const form=new FormData();form.append('file_type','json');form.append('avatar',new Blob([JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',data:{name,description:'蓝窗书店的成年店员。',personality:'',scenario:'',first_mes:'你好，今天想读些什么？',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'',character_version:'1',extensions:{vc_character_ref:crypto.randomUUID()}}})],{type:'application/json'}),'card.json');
 const imp=await st.call('POST','/api/characters/import',form);if(imp.status!==200)throw Error('合成卡导入失败');
 const providersBefore=(await ctx.admin.listProviders()).json;const provider=providersBefore.find(p=>p.providerId==='vc03m-chat');
 const {chromium}=await import('playwright-core');const browser=await chromium.launch({headless:true,...(process.env.VC_W03_CHROMIUM_PATH?{executablePath:process.env.VC_W03_CHROMIUM_PATH}:{})});
 let page;
 try {
  const bc=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});await bc.addCookies([{name:'vc_session',value:s.vcSession,url:ctx.w05.stBase},{name:'vc_csrf',value:s.vcCsrf,url:ctx.w05.stBase}]);await completeStOnboarding(bc,ctx.w05.stBase);
  page=await bc.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message.slice(0,140)));await page.goto(`${ctx.w05.stBase}/m/?vcdebug=1`);
  const tab=async(label)=>page.getByRole('tab',{name:label,exact:true}).click();
  await tab('角色');
  const extraName=`白芷MB5${crypto.randomUUID().slice(0,5)}`;
  await page.locator('input[type="file"]').setInputFiles({name:'mb5.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({name:extraName,description:'合成导入验证',first_mes:'你好'}))});
  await page.locator('.vc-character-tile',{hasText:extraName}).waitFor();
  console.log('[mb-pages] PASS 角色卡文件从 H5 导入');
  await page.locator('.vc-character-tile',{hasText:name}).click();
  await page.getByRole('button',{name:'新建实例',exact:true}).click();await page.getByLabel('实例名称',{exact:true}).fill('蓝窗日常');await page.getByRole('button',{name:'开始聊天',exact:true}).click();
  await page.locator('.vc-conversation').waitFor({timeout:45000});await page.waitForFunction(()=>!document.querySelector('.vc-connection'),null,{timeout:30000});
  const binding=await page.evaluate(()=>globalThis.__vcEngine.binding());assert.ok(binding.relationshipId);
  const rel=(await ctx.admin.call('GET','/api/v1/relationships')).json.find(r=>String(r.relationshipId)===String(binding.relationshipId));assert.equal(rel.companionName,'蓝窗日常');
  console.log('[mb-pages] PASS 角色 → 新建实例 → 原生聊天，关系绑定读回');
  await page.locator('.vc-conv-nav [aria-label="返回"]').click();await page.locator('.vc-subnav [aria-label="返回"]').click();
  await tab('记忆');await page.locator('.vc-memory-list').waitFor();await page.getByLabel('角色实例',{exact:true}).selectOption(String(binding.relationshipId));await page.locator('.vc-empty',{hasText:'暂无记忆'}).waitFor();
  await tab('陪伴');await page.getByLabel('陪伴角色',{exact:true}).selectOption(String(binding.relationshipId));await page.getByLabel('主动模式',{exact:true}).waitFor();
  await page.getByLabel('静默开始',{exact:true}).fill('23:00');await page.getByLabel('静默结束',{exact:true}).fill('07:00');await page.getByLabel('时区',{exact:true}).fill('Asia/Shanghai');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('status',{name:''}).filter({hasText:'已保存'}).waitFor();
  const policy=(await ctx.admin.call('GET',`/api/v1/relationships/${binding.relationshipId}/proactive-policy`)).json;assert.equal(policy.quietHoursStart,'23:00');assert.equal(policy.quietHoursTimezone,'Asia/Shanghai');console.log('[mb-pages] PASS 记忆页与陪伴静默设置读回');
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'外观',exact:true}).click();await page.getByLabel('外观模式',{exact:true}).selectOption('dark');await page.waitForFunction(()=>document.documentElement.dataset.vcTheme==='dark');
  await page.locator('.vc-subnav [aria-label="返回"]').click();await page.getByRole('button',{name:'模型',exact:true}).click();await page.getByRole('button',{name:new RegExp(provider.displayName)}).first().click();await page.getByLabel('供应商名称',{exact:true}).fill('手机模型设置');
  let requireReauth=true;await bc.route('**/api/v1/admin/providers/*',async route=>{if(requireReauth&&route.request().method()==='PUT'){requireReauth=false;await route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'ACCESS_DENIED',message:'Reauthentication required'})});}else await route.continue();});
  await page.getByRole('button',{name:'保存',exact:true}).click();const verification=page.getByRole('dialog',{name:'重新验证身份'});await verification.getByLabel('密码',{exact:true}).fill(ctx.secrets.password);await verification.getByRole('button',{name:'验证并继续',exact:true}).click();await verification.waitFor({state:'hidden'});
  await page.getByRole('button',{name:/手机模型设置/}).waitFor();const current=(await ctx.admin.listProviders()).json.find(p=>p.providerId===provider.providerId);assert.equal(current.displayName,'手机模型设置');assert.deepEqual(current.models.map(m=>m.generationParams),provider.models.map(m=>m.generationParams));assert.equal(current.credentialConfigured,provider.credentialConfigured);console.log('[mb-pages] PASS 模型保存读回且不清凭据或未编辑参数');
  await page.locator('.vc-subnav [aria-label="返回"]').click();await page.getByRole('button',{name:'语音',exact:true}).click();await page.getByLabel('语音频率',{exact:true}).selectOption('LOW');
  const voiceSaved=page.waitForResponse(r=>r.url().endsWith('/api/v1/voice/settings')&&r.request().method()==='PUT');
  await page.getByRole('button',{name:'保存',exact:true}).click();assert.equal((await voiceSaved).status(),200);await page.getByRole('button',{name:'保存',exact:true}).waitFor();const voice=(await ctx.admin.call('GET','/api/v1/voice/settings')).json;assert.equal(voice.voiceFrequency,'LOW');
  await page.locator('.vc-subnav [aria-label="返回"]').click();await page.getByRole('button',{name:'账户',exact:true}).click();await page.getByText('当前会话',{exact:true}).waitFor();console.log('[mb-pages] PASS 语音设置读回和账户会话');
  await page.locator('.vc-subnav [aria-label="返回"]').click();await page.screenshot({path:path.join(SHOTS,'settings-390-dark.png')});await page.locator('.vc-subnav [aria-label="返回"]').click();
  for(const label of ['角色','记忆','陪伴','剧情']) {
   await tab(label);await page.waitForTimeout(350);await page.screenshot({path:path.join(SHOTS,`${label}-390-dark.png`)});
  }
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'外观',exact:true}).click();await page.getByLabel('外观模式',{exact:true}).selectOption('light');await page.locator('.vc-subnav [aria-label="返回"]').click();await page.screenshot({path:path.join(SHOTS,'settings-390-light.png')});await page.locator('.vc-subnav [aria-label="返回"]').click();
  for(const label of ['角色','记忆','陪伴','剧情']) {await tab(label);await page.waitForTimeout(350);await page.screenshot({path:path.join(SHOTS,`${label}-390-light.png`)});}
  await page.getByRole('button',{name:/进入剧情/}).click();await page.waitForFunction(()=>document.querySelector('#vc-engine').classList.contains('is-shown'));await page.waitForFunction(()=>document.querySelector('#vc-engine').contentDocument.querySelector('#vc-shell')?.dataset.destination==='story');await page.locator('.vc-stview-bar [aria-label="返回"]').click();
  await page.setViewportSize({width:1440,height:1000});
  for(const mode of ['light','dark']) {
   await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'外观',exact:true}).click();await page.getByLabel('外观模式',{exact:true}).selectOption(mode);await page.locator('.vc-subnav [aria-label="返回"]').click();await page.screenshot({path:path.join(SHOTS,`settings-1440-${mode}.png`)});await page.locator('.vc-subnav [aria-label="返回"]').click();
   for(const label of ['角色','记忆','陪伴','剧情']) {await tab(label);await page.waitForTimeout(200);await page.screenshot({path:path.join(SHOTS,`${label}-1440-${mode}.png`)});}
  }
  if(errors.length)throw Error(`页面错误：${errors.join(' | ')}`);
  fs.writeFileSync(path.join(SHOTS,'NOTES.md'),'# MB-5\n\n合成数据走查角色/实例、记忆、陪伴静默策略、模型、外观、语音和账户设置，截图供 Owner 复核。系统通知功能继续搁置。\n');
  await bc.close();
 }catch(e){if(page)await page.screenshot({path:path.join(SHOTS,'failure.png')}).catch(()=>{});throw e;}finally{await browser.close();}
}
export const mbPagesScene={id:'mb-pages',title:'MB-5 H5 角色、记忆、陪伴、剧情入口与设置读回',needs:['catalog','stack','browser'],default:false,run:sceneMbPages};
