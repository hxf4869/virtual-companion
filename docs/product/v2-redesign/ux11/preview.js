import { installSyntheticAPI, installHostFixture, installDrawerFixtures, relationship, previewRelationships } from './fixtures.js';
installSyntheticAPI();
const params=new URLSearchParams(location.search);
const baseline=params.get('baseline')==='1';
const loadDesktop=!baseline&&params.get('desktop')!=='0';
export const source=baseline?'/baseline/source':'/source';
export const view=params.get('view')||'components';
const theme=params.get('theme')||'light';
document.documentElement.dataset.vcTheme=theme==='auto'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):theme;
for(const name of ['style','vc-ui','shell','chat-shell','chat-view','settings-pages','voice','instance','memory','inbox','story','drawers','account']){
 const link=document.createElement('link');link.rel='stylesheet';link.href=`${source}/${name}.css`;if(name==='shell')link.id='vc-shell-css';document.head.append(link);
}
if(loadDesktop){for(const file of ['base','chat','settings','characters','memory','inbox','story']){if(file!=='base'&&!await fetch(`${source}/desktop/${file}.css`,{method:'HEAD'}).then(r=>r.ok))continue;const link=document.createElement('link');link.rel='stylesheet';link.href=`${source}/desktop/${file}.css`;document.head.append(link);}}
const {icon}=await import(`${source}/ui/icons.js`);
const {bindSegment,bindSwitch,bindRangeFills}=await import(`${source}/ui/controls.js`);
const {confirmAlert,confirmDiscard}=await import(`${source}/ui/alert.js`);
const {showToast}=await import(`${source}/ui/toast.js`);
const {openSheet}=await import(`${source}/ui/sheet.js`);
const {popMenu}=await import(`${source}/ui/menu.js`);
const api=await import(`${source}/api.js`);api.setStHeadersProvider(()=>({'X-CSRF-Token':'synthetic-preview'}));await api.captureSessionContext();
installHostFixture();
if(view==='settings')installDrawerFixtures();
const context={characters:[],chatMetadata:{},chat:[],name1:'合成验收用户'};
if(['characters','memory','inbox','story'].includes(view)&&params.get('state')!=='empty')context.characters=[{name:'小满',avatar:'',data:{extensions:{vc_character_ref:'synthetic-xiaoman'}}},{name:'林舟',avatar:'',data:{extensions:{vc_character_ref:'synthetic-linzhou'}}}];
if(view==='story')context.chatMetadata={vc_binding:{conversationId:'21',relationshipId:'11',mode:'STORY'}};
if(view==='chat'){context.name2='小满';context.characterId=0;context.chatMetadata={vc_binding:{relationshipId:'11'}};}
const {mountShell,registerShellTabs}=await import(`${source}/shell.js`);
const mounts={characters:'mountCharactersTab',memory:'mountMemoryTab',inbox:'mountInboxTab',story:'mountStoryTab'};
const files={characters:'instance-page',memory:'memory-page',inbox:'inbox-page',story:'story-page'};
const modules={};
for(const key of ['chat',...Object.keys(mounts)]){
 const response=await fetch(`views/${key}.js`,{method:'HEAD'});
 if(response.ok)modules[key]=await import(`./views/${key}.js`);
}
function components(container){
 container.querySelector('.vc-large-title')?.setAttribute('hidden','');
 const root=document.createElement('div');root.className='vc-desk-components';root.dataset.vcComponents='';
 const button=(text,action,kind='gray')=>`<button type="button" class="vc-btn vc-btn-${kind}" data-demo="${action}">${text}</button>`;
 root.innerHTML=`<section class="vc-desk-group"><h2>按钮</h2><div class="vc-desk-actions">${button('保存','success','fill')}${button('取消','success')}${button('删除','confirm','danger')}${button('更多','menu')}</div><div class="vc-desk-actions"><button type="button" class="vc-btn vc-btn-fill" disabled>不可用</button>${button('编辑设置','edit')}</div></section>
 <section class="vc-desk-group"><h2>输入与选择</h2><div class="vc-desk-field"><label for="sample-name">显示名称</label><input id="sample-name" value="我的伙伴"></div><div class="vc-desk-field" data-vc-desktop-only><label for="sample-password">密码</label><input id="sample-password" type="password" aria-invalid="true" aria-describedby="sample-password-error"><span class="vc-desk-error" id="sample-password-error">密码不正确，请重试。</span></div><div class="vc-desk-field"><label for="sample-number">数量</label><input type="number" id="sample-number" value="3"></div><div class="vc-desk-field"><label for="sample-select">语音频率</label><select id="sample-select"><option>标准</option><option>少</option><option>多</option></select></div></section>
 <section class="vc-desk-group"><h2>选择控件</h2><div class="vc-cell"><span class="vc-grow">主动发送语音</span><button type="button" class="vc-switch" role="switch" aria-label="主动发送语音" aria-checked="true"><span></span></button></div><div class="vc-cell"><span class="vc-grow">语速</span><input type="range" class="vc-range" aria-label="语速" min=".5" max="2" value="1" step=".05"></div><div class="vc-segment"><i class="vc-segment-thumb"></i>${['少','标准','多'].map((t,i)=>`<button type="button" aria-pressed="${i===1}">${t}</button>`).join('')}</div></section>
 <section class="vc-desk-group"><h2>提示与确认</h2><div class="vc-desk-actions">${button('已保存','success')}${button('没有完成，请重试。','failure')}${button('放弃修改','discard')}</div></section>
 <section class="vc-desk-group"><h2>状态</h2><div class="vc-cell"><span class="vc-dot vc-dot-ok"></span><span>可用</span></div><div class="vc-cell"><span class="vc-dot vc-dot-warn"></span><span>待配置</span></div></section>`;
 root.insertAdjacentHTML('beforeend',`<section class="vc-desk-group" data-vc-desktop-only><h2>复选框</h2><label class="vc-cell"><input type="checkbox" checked>已选择</label><label class="vc-cell"><input type="checkbox">未选择</label></section><section class="vc-desk-group" data-vc-desktop-only><h2>空状态</h2><div class="vc-empty">${icon('brain',{size:48})}<p>没有找到记忆</p>${button('重新加载','success')}</div></section><section class="vc-desk-group" data-vc-desktop-only><h2>载入</h2><div class="vc-skeleton-row"><span class="vc-skeleton vc-skeleton-avatar"></span><span class="vc-grow"><span class="vc-skeleton vc-skeleton-line"></span><span class="vc-skeleton vc-skeleton-line is-short"></span></span></div></section><section class="vc-desk-group" data-vc-desktop-only><h2>身份验证</h2><div class="vc-desk-actions">${button('重新验证身份','identity')}</div></section>`);
 const syncDesktop=()=>{for(const el of root.querySelectorAll('[data-vc-desktop-only]'))el.hidden=innerWidth<744;};syncDesktop();window.addEventListener('resize',syncDesktop);
 container.append(root);bindRangeFills(document);for(const el of root.querySelectorAll('.vc-switch'))bindSwitch(el);for(const el of root.querySelectorAll('.vc-segment'))bindSegment(el);
 return {refresh(){},destroy(){window.removeEventListener('resize',syncDesktop);}};
}
const registry={};
for(const key of Object.keys(mounts))registry[key]=(container,args)=>{
 if(view==='components'&&key==='characters')return components(container);
 if(modules[key])return modules[key].mount({container,args,source,params,context});
 void import(`${source}/${files[key]}.js`).then(mod=>mod[mounts[key]](container,args));return {refresh(){}};
};
registerShellTabs(registry);
const shell=mountShell({getContext:()=>context,loadRelationships:async()=>['chat','characters','memory','inbox','story'].includes(view)?previewRelationships:[relationship],loadInbox:async()=>[],loadNative:async()=>({})});
let desktop;
if(loadDesktop){
 const {mountAurora}=await import(`${source}/desktop/aurora.js`);desktop=mountAurora();
 const {bindSidebarLens,readReducedMotion}=await import(`${source}/desktop/transition.js`);document.documentElement.dataset.vcReducedMotion=String(readReducedMotion());bindSidebarLens(shell.querySelector('.vc-sidebar'));
}
const routes={components:'characters',model:'characters',voice:'characters',settings:'characters'};
const selected=routes[view]||view;
shell.querySelector(`.vc-sidebar [data-nav="${selected}"]`)?.click();
if(view==='chat'&&!modules.chat)await shell.openConversation({relationshipId:'11',name:'小满',instanceName:'日常'});
if(view==='chat'&&modules.chat)await modules.chat.mount({shell,source,params,context,desktop});
if(view==='components'){shell.querySelector('[data-page="characters"] .vc-nav-title').textContent='组件';}
let model;
if(view==='model'){
 const {mountModelSettings}=await import(`${source}/page.js`);model=mountModelSettings();model.open();
 const wait=Date.now()+(params.get('state')==='loading'?100:5000);while(model._state.phase==='loading'&&Date.now()<wait)await new Promise(r=>setTimeout(r,20));
 if(params.get('screen')!=='home'&&params.get('screen')){model.root.querySelector('[data-action="select-provider"]')?.click();await new Promise(r=>setTimeout(r,20));if(params.get('screen')==='model')model.root.querySelector('[data-action="select-model"]')?.click();}
}
if(view==='voice'){
 const voice=await import(`${source}/voice-settings.js`);if(params.get('screen')==='relationship')await voice.openRelationshipVoiceSettings('11');else await voice.openGlobalVoiceSettings();
}
if(view==='settings'){
 const voice=await import(`${source}/voice-settings.js`);await voice.refreshVoiceAvailability();window.dispatchEvent(new CustomEvent('vc-shell-navigate',{detail:{destination:'settings'}}));
 const res=await fetch('views/settings.js',{method:'HEAD'});if(res.ok){modules.settings=await import('./views/settings.js');await modules.settings.mount({container:shell.querySelector('.vc-shell-settings .vc-shell-scroll'),source,params,context,model});}
}
document.addEventListener('click',async e=>{
 const button=e.target.closest('[data-demo]');if(!button)return;
 const action=button.dataset.demo;
 if(action==='success')showToast('已保存');
 if(action==='failure')showToast('没有完成，请重试。',{type:'failure'});
 if(action==='confirm')await confirmAlert({title:'删除这条记忆？',message:'聊天原文仍保留，可能继续用于当前对话。',action:'删除记忆',opener:button});
 if(action==='discard')await confirmDiscard({opener:button});
 if(action==='menu')popMenu(button,[{label:'复制',icon:'copy'},{label:'编辑',icon:'pencil'},'-',{label:'删除',icon:'trash-2',danger:true}]);
 if(action==='identity'){
  const {mountDataRights}=await import(`${source}/data-rights.js`);const account=mountDataRights();account.open(button);document.querySelector('[data-reset]')?.click();
 }
 if(action==='edit'){
  const form=document.createElement('form');form.className='vc-column';form.innerHTML='<label class="vc-cell">实例名称<input name="name" value="小满 · 日常"></label>';
  const sheet=openSheet({title:'声音',body:form,isDirty:()=>form.elements.name.value!=='小满 · 日常',onSubmit:async()=>true,opener:button});
  window.VC_SAMPLE_SHEET=sheet;
 }
});
if(loadDesktop){
 for(const node of shell.querySelectorAll('.vc-side-link'))node.setAttribute('data-vc-light','');
 const {bindPointerLights}=await import(`${source}/desktop/pointer-light.js`);bindPointerLights(document);
}
window.VC_PREVIEW={model,shell,desktop,source,params,modules};
await Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map(link=>link.sheet?Promise.resolve():new Promise(resolve=>{link.addEventListener('load',resolve,{once:true});link.addEventListener('error',resolve,{once:true});})));
await new Promise(requestAnimationFrame);document.documentElement.dataset.previewReady='true';
