// UX-11 本地样板验收；已有 playwright-core，无新增依赖。
import { chromium } from '../../../../integrations/sillytavern/node_modules/playwright-core/index.mjs';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const args=process.argv.slice(2);const option=(name,fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
const id=option('--id','UX-13'),views=option('--views','components,model,voice').split(','),baseline=args.includes('--baseline');
// 既有载入态 PNG 的拍摄相位（从保留图恢复）。只固定原生动画时钟，不处理图像像素。
// Chromium 的帧时钟在这些记录中舍入到 0.1ms；以后不根据候选图片重新拟合。
const CAPTURE_FRAMES = [
 {view:'chat-loading',width:390,theme:'light',shimmerMs:216.7},
 {view:'chat-loading',width:390,theme:'dark',shimmerMs:216.7},
 {view:'chat-loading',width:360,theme:'light',shimmerMs:216.7},
 {view:'chat-loading',width:360,theme:'dark',shimmerMs:216.6},
];
// Owner 2026-11-01 批准；仅原底部保存按钮，不覆盖其余 Sheet 区域。
export const PIXEL_EXCEPTIONS = [
 {name:'relationship-timbre-label-390-light',view:'voice-relationship',width:390,theme:'light',rect:{x:32,y:300,width:102,height:21},clause:'方案 §6.6，两端共用文案'},
 {name:'relationship-proactive-label-390-light',view:'voice-relationship',width:390,theme:'light',rect:{x:32,y:622,width:102,height:20},clause:'方案 §6.6，两端共用文案'},
 {name:'relationship-timbre-label-390-dark',view:'voice-relationship',width:390,theme:'dark',rect:{x:32,y:300,width:102,height:21},clause:'方案 §6.6，两端共用文案'},
 {name:'relationship-proactive-label-390-dark',view:'voice-relationship',width:390,theme:'dark',rect:{x:32,y:622,width:102,height:20},clause:'方案 §6.6，两端共用文案'},
 {name:'relationship-timbre-label-360-light',view:'voice-relationship',width:360,theme:'light',rect:{x:32,y:300,width:102,height:21},clause:'方案 §6.6，两端共用文案'},
 {name:'relationship-proactive-label-360-light',view:'voice-relationship',width:360,theme:'light',rect:{x:32,y:622,width:102,height:20},clause:'方案 §6.6，两端共用文案'},
 {name:'relationship-timbre-label-360-dark',view:'voice-relationship',width:360,theme:'dark',rect:{x:32,y:300,width:102,height:21},clause:'方案 §6.6，两端共用文案'},
 {name:'relationship-proactive-label-360-dark',view:'voice-relationship',width:360,theme:'dark',rect:{x:32,y:622,width:102,height:20},clause:'方案 §6.6，两端共用文案'},
 {name:'relationship-sheet-save-390-light',view:'voice-relationship',width:390,theme:'light',rect:{x:0,y:756,width:390,height:50},clause:'方案 §5.3'},
 {name:'relationship-sheet-save-390-dark',view:'voice-relationship',width:390,theme:'dark',rect:{x:0,y:756,width:390,height:50},clause:'方案 §5.3'},
 {name:'relationship-sheet-save-360-light',view:'voice-relationship',width:360,theme:'light',rect:{x:0,y:756,width:360,height:50},clause:'方案 §5.3'},
 {name:'relationship-sheet-save-360-dark',view:'voice-relationship',width:360,theme:'dark',rect:{x:0,y:756,width:360,height:50},clause:'方案 §5.3'},
];
const cases=[];
for(const view of views){
 if(view==='model'){for(const screen of ['home','provider','model'])cases.push({key:screen==='home'?'model':`model-${screen}`,view,params:{screen}});continue;}
 if(view==='voice'){cases.push({key:'voice',view,params:{screen:'home'}},{key:'voice-relationship',view,params:{screen:'relationship'}});continue;}
 const files=await readdir(new URL('./views/',import.meta.url)).catch(error=>{if(error.code==='ENOENT')return [];throw error;});const mod=files.includes(`${view}.js`)?await import(new URL(`./views/${view}.js`,import.meta.url)):null;
 for(const scenario of mod?.scenarios||[{key:view,params:{}}])cases.push({key:scenario.key,view,params:scenario.params||{}});
}
const base=option('--url','http://127.0.0.1:18795');
const out=path.join(root,'.review-queue/UX-11',id),baselineDir=path.join(root,'.review-queue/UX-11/baseline');await mkdir(out,{recursive:true});await mkdir(baselineDir,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.VC_W03_CHROMIUM_PATH?{executablePath:process.env.VC_W03_CHROMIUM_PATH}:{})});
const matrix=[[1440,900],[1280,800],[1024,768],[768,1024],[390,844],[360,780]];
const results=[];const started=Date.now();
async function settle(page){await page.waitForFunction(()=>document.documentElement.dataset.previewReady==='true');await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(180);}
async function pixelDiff(page,a,b,exceptions){return page.evaluate(async({urls,exceptions})=>{
 const imgs=await Promise.all(urls.map(src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src;})));
 if(imgs[0].width!==imgs[1].width||imgs[0].height!==imgs[1].height)return {total:-1,outside:-1};
 const data=imgs.map(img=>{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);return x.getImageData(0,0,c.width,c.height).data;});let total=0,outside=0;
 for(let i=0;i<data[0].length;i+=4)if(data[0][i]!==data[1][i]||data[0][i+1]!==data[1][i+1]||data[0][i+2]!==data[1][i+2]||data[0][i+3]!==data[1][i+3]){
  total++;const x=i/4%imgs[0].width,y=Math.floor(i/4/imgs[0].width);
  if(!exceptions.some(({rect:r})=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height))outside++;
 }
 return {total,outside,exceptions:exceptions.map(e=>e.name)};
},{urls:[a,b].map(buf=>'data:image/png;base64,'+buf.toString('base64')),exceptions});}
async function geometry(page){return page.evaluate(()=>{
 const visible=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.width>1&&r.height>1&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';};
 const rects=nodes=>[...nodes].filter(visible).map(n=>({tag:n.tagName,cls:n.className,text:n.textContent.trim().slice(0,20),r:n.getBoundingClientRect()}));
 const overlaps=nodes=>{const a=rects(nodes),found=[];for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++){const r=a[i].r,s=a[j].r;if(Math.min(r.right,s.right)-Math.max(r.left,s.left)>1&&Math.min(r.bottom,s.bottom)-Math.max(r.top,s.top)>1)found.push([a[i].text,a[j].text]);}return found;};
 const errors=[];if(document.documentElement.scrollWidth>innerWidth+1)errors.push('横向滚动');
 for(const list of document.querySelectorAll('[data-vc-components],.vcms-body,.vc-column,.vc-scroll,.vc-shell-scroll'))if(visible(list)){if([...list.children].length&&[...list.children].every(n=>n.classList.contains('vc-screen')))continue;const o=overlaps(list.children);if(o.length)errors.push(['内容重叠',o]);}
 for(const h of document.querySelectorAll('.vcms-header,.vc-sheet-head,.vc-shell-page.is-on > .vc-navbar'))if(visible(h)){
  const o=overlaps([...h.children].filter(n=>!n.classList.contains('vc-nav-spacer')&&!n.classList.contains('vcms-subtitle')&&!n.classList.contains('vcms-dismiss')));if(o.length)errors.push(['标题栏重叠',o]);
  for(const b of h.querySelectorAll('button'))if(visible(b)&&b.getBoundingClientRect().height>80)errors.push('标题栏按钮竖排');
 }
 const glass=[...document.querySelectorAll('body *')].filter(n=>visible(n)&&getComputedStyle(n).backdropFilter!=='none').map(n=>n.className);
 if(innerWidth>=744&&glass.length>4)errors.push(['常驻模糊表面超预算',glass]);return {errors,glass};
});}
async function overlays(page){
 await page.locator('[data-demo="discard"]').click();await page.locator('.vc-alert').waitFor();await page.waitForTimeout(180);
 assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'继续编辑','确认默认焦点');
 const hit=await page.locator('.vc-alert').evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});assert.ok(hit,'确认框叠层');
 await page.keyboard.press('Tab');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'继续编辑','Tab 循环');
 await page.keyboard.press('Escape');await page.locator('.vc-alert').waitFor({state:'detached'});
 await page.locator('[data-demo="failure"]').click();await page.waitForTimeout(180);assert.equal(await page.locator('.vc-toast').count(),1);
 assert.ok(await page.locator('.vc-toast').evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'提示条叠层');
 await page.locator('[data-demo="success"]').first().click();assert.equal(await page.locator('.vc-toast').count(),1,'提示条单实例');assert.equal(await page.locator('.vc-toast-close').count(),0,'成功无关闭按钮');
 await page.waitForTimeout(1900);assert.equal(await page.locator('.vc-toast.is-on').count(),0,'成功自动消失');
 await page.locator('[data-demo="menu"]').click();await page.locator('.vc-menu').waitFor();
 await page.evaluate(async()=>{const {confirmDiscard}=await import(window.VC_PREVIEW.source+'/ui/alert.js');void confirmDiscard();});await page.locator('.vc-alert').waitFor();
 await page.keyboard.press('Escape');await page.locator('.vc-alert').waitFor({state:'detached'});assert.equal(await page.locator('.vc-menu').count(),1,'Esc 只关闭最上层');await page.keyboard.press('Escape');await page.locator('.vc-menu').waitFor({state:'detached'});
}
async function modelInteraction(page){
 const provider=page.locator('[data-action="select-provider"]').first();await provider.click();await page.locator('#vcms-f-display').waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('vc-nav-title')),true,'层级切换聚焦标题');
 const original=await page.locator('#vcms-f-display').inputValue();assert.equal(await page.locator('#vcms-save').isDisabled(),true);
 await page.locator('#vcms-f-display').fill('合成未保存草稿');assert.equal(await page.locator('#vcms-save').isDisabled(),false);
 await page.locator('[data-action="vc-back"]').click();await page.getByRole('alertdialog',{name:'放弃更改？'}).waitFor();assert.equal(await page.evaluate(()=>document.activeElement.textContent),'继续编辑');
 await page.keyboard.press('Escape');await page.locator('.vc-alert').waitFor({state:'detached'});assert.equal(await page.locator('#vcms-f-display').inputValue(),'合成未保存草稿');
 await page.keyboard.press('Escape');assert.equal(await page.locator('.vcms-panel').isVisible(),true,'页面不响应 Esc');
 await page.locator('[data-action="vc-back"]').click();await page.locator('[data-vc-ok]').click();await page.locator('.vc-alert').waitFor({state:'detached'});await provider.click();assert.equal(await page.locator('#vcms-f-display').inputValue(),original,'放弃恢复载入值');
 const modelRow=page.locator('[data-action="select-model"]').first();await modelRow.focus();await page.keyboard.press('Enter');await page.locator('[data-vc-screen="model"]').waitFor({timeout:2000});assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('vc-nav-title')),true,'键盘层级切换聚焦标题');
 await page.locator('[data-action="vc-back"]').click();await page.locator('[data-vc-screen="provider"]').waitFor();assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-action')),'select-model','返回归还打开行');
 await page.locator('[data-action="select-model"]').first().click();await page.locator('#vcms-m-display').fill('合成模型修改');await page.locator('#vcms-save').click();await page.getByRole('alertdialog',{name:'同时影响 2 个用途'}).waitFor();assert.equal(await page.evaluate(()=>document.activeElement.textContent),'检查一下');await page.keyboard.press('Escape');await page.locator('.vc-alert').waitFor({state:'detached'});
 assert.equal(await page.locator('#vcms-m-display').inputValue(),'合成模型修改');
}
async function voiceInteraction(page,width){
 const form=page.locator('[data-voice-settings="global"]');await form.locator('[data-voice-field="dailyChatLimit"]').waitFor();
 if(width>=744){assert.equal(await page.locator('.vc-sheet-done').last().isDisabled(),true);return;}
 await page.locator('.vc-sheet-done').last().click();await form.waitFor({state:'detached'});
 await page.evaluate(async()=>{const mod=await import(window.VC_PREVIEW.source+'/voice-settings.js');await mod.openGlobalVoiceSettings();});await form.locator('[data-voice-field="dailyChatLimit"]').waitFor();
 await form.locator('[data-voice-field="dailyChatLimit"]').fill('61');await page.keyboard.press('Escape');await page.getByRole('alertdialog',{name:'放弃更改？'}).waitFor();assert.equal(await page.evaluate(()=>document.activeElement.textContent),'继续编辑');
 await page.keyboard.press('Escape');await page.locator('.vc-alert').waitFor({state:'detached'});assert.equal(await form.locator('[data-voice-field="dailyChatLimit"]').inputValue(),'61');
 await page.evaluate(()=>window.VC_PREVIEW_DELAY=200);const done=page.locator('.vc-sheet-done').last(),widthBefore=await done.evaluate(n=>n.getBoundingClientRect().width);await done.click();assert.equal(await done.textContent(),'保存中…');assert.equal(await done.isDisabled(),true);assert.equal(await done.evaluate(n=>n.getBoundingClientRect().width),widthBefore,'等待不跳宽');await form.waitFor({state:'detached'});await page.locator('.vc-toast').getByText('已保存',{exact:true}).waitFor();
}
async function runCase({entry,width,height,theme}){
  const view=entry.key;
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const url=new URL('/frame.html',base);url.search=new URLSearchParams({view:entry.view,theme,state:'ready',...entry.params,...(baseline?{baseline:'1'}:{})}).toString();
  await page.goto(url.href);await settle(page);assert.deepEqual(errors,[],`${view} ${width} ${theme} 浏览器错误`);
  const frame=CAPTURE_FRAMES.find(f=>f.view===view&&f.width===width&&f.theme===theme);
  await page.evaluate(ms=>{for(const animation of document.getAnimations())if(animation.animationName==='vc-shimmer'){animation.pause();animation.currentTime=ms;}},frame?.shimmerMs??216.7);
  if(width<744&&!baseline)assert.notEqual(await page.locator('html').getAttribute('data-vc-layout'),'desktop','手机不能进入桌面布局');
  const name=`${view}-${width}-${theme}.png`;
  if(baseline){await writeFile(path.join(baselineDir,name),await page.screenshot(),{flag:'wx'});results.push({view,width,theme,baseline:'14b67677'});await page.close();return;}
  const layout=await geometry(page);assert.deepEqual(layout.errors,[],`${view} ${width} ${theme} 几何检查`);
  let pixels;
  if(width<744){const before=await readFile(path.join(baselineDir,name));const current=await page.screenshot();const exceptions=PIXEL_EXCEPTIONS.filter(e=>e.view===view&&e.width===width&&e.theme===theme);pixels=await pixelDiff(page,before,current,exceptions);await writeFile(path.join(out,name),current);assert.equal(pixels.outside,0,`${view} ${width} ${theme} 手机像素基线（具名例外之外）`);}
  if(width===1440||width===1024||width===768&&theme==='light')await page.screenshot({path:path.join(out,name)});
  if(view==='components'&&width===1440)await overlays(page);
  if(entry.view==='model'&&entry.params.screen==='home'&&theme==='light'&&[1440,390].includes(width))await modelInteraction(page);
  if(entry.view==='voice'&&entry.params.screen==='home'&&theme==='light'&&[1440,390].includes(width))await voiceInteraction(page,width);
  const moduleName=entry.view==='model'||entry.view==='voice'?'settings':entry.view;
  if(!['components','model','voice'].includes(entry.view)){await page.evaluate(async key=>{const module=window.VC_PREVIEW.modules[key];await module?.check?.(window.VC_PREVIEW);},moduleName);}
  results.push({view,width,theme,status:'PASS',glass:layout.glass.length,...(pixels?{pixels}:{})});await page.close();
}
try{
 const jobs=[];for(const entry of cases)for(const [width,height] of matrix)for(const theme of ['light','dark'])if(!baseline||width<744){
  if(baseline){try{await readFile(path.join(baselineDir,`${entry.key}-${width}-${theme}.png`));results.push({view:entry.key,width,theme,baseline:'preserved'});continue;}catch(error){if(error.code!=='ENOENT')throw error;}}
  jobs.push({entry,width,height,theme});
 }
 const failures=[];
 await Promise.all(Array.from({length:3},async()=>{while(jobs.length){const job=jobs.shift();try{await runCase(job);}catch(error){failures.push(error);}}}));
 if(failures.length)throw failures[0];
 console.log(JSON.stringify({id,baseline,combinations:results.length,ms:Date.now()-started,status:'PASS',pixelExceptions:results.filter(r=>r.pixels?.total).map(({view,width,theme,pixels})=>({view,width,theme,...pixels}))}));
}finally{await browser.close();}
