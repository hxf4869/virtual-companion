export const scenarios=[{key:'memory',params:{}},{key:'memory-detail',params:{screen:'detail'}},{key:'memory-edit',params:{screen:'edit'}},...['empty','loading','error','long'].map(state=>({key:`memory-${state}`,params:{state}})),...['timeline','diary','favorites'].map(section=>({key:`memory-${section}`,params:{section}}))];
export async function mount({container,args={},source,params}) {
 const mod=await import(`${source}/memory-page.js`);
 if(source.startsWith('/baseline/')||innerWidth<744){const handle=mod.mountMemoryTab(container,args);if(params.get('state')!=='loading')for(let i=0;i<150&&container.querySelector('[aria-busy="true"]');i++)await new Promise(r=>setTimeout(r,20));if(params.get('screen')&&params.get('state')!=='loading'){container.querySelector('.vc-memory-row')?.click();for(let i=0;i<100&&!container.querySelector('.vc-memory-detail-screen .vc-memory-title');i++)await new Promise(r=>setTimeout(r,20));if(params.get('screen')==='edit')container.querySelector('[data-action="edit"]')?.click();}return handle;}
 if(params.get('section')){ // UX-31–33：桌面用真实 mountMemoryTab（新分区），手机沿用上面的基线分支
  const handle=mod.mountMemoryTab(container,args),section=params.get('section'),wait=async(predicate,ms=12000)=>{for(let i=0;i<ms/20;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('记忆分区未就绪 '+section);};
  await wait(()=>container.querySelector('.vc-mem-card'));
  if(section==='timeline')await wait(()=>container.querySelector('.vc-mem-source:not([hidden])'));
  else{container.querySelector(`[data-section="${section}"]`).click();await wait(()=>container.querySelector(section==='diary'?'.vc-diary-paper':'.vc-fav-card'));}
  return handle;
 }
 const {confirmAlert,confirmDiscard}=await import(`${source}/ui/alert.js`),{popMenu}=await import(`${source}/ui/menu.js`),{bindSegment}=await import(`${source}/ui/controls.js`);
 const root=document.createElement('section');root.className='vc-desktop-memory vc-memory-tab';container.append(root);
 const dialog=document.createElement('div');dialog.className='vc-memory-editor vc-memory-tab';dialog.hidden=true;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','记忆详情');const scrim=document.createElement('div');scrim.className='vc-scrim vc-memory-editor-scrim';scrim.hidden=true;document.body.append(scrim,dialog);scrim.addEventListener('click',()=>void close());
 let dead=false,segment,menu,typing=false,openerId='',width=0;
 const page=mod.createMemoryPage({onChange(){if(!typing)paint();}});
 const dirty=()=>page.state.editing&&page.state.draft!==page.state.detail?.summary;
 async function close(){if(page.state.busy)return false;if(dirty()&&!await confirmDiscard({opener:document.activeElement}))return false;page.cancelEdit();dialog.hidden=true;scrim.hidden=true;root.querySelector(`[data-memory-id="${CSS.escape(openerId)}"]`)?.focus();return true;}
 function paint(){
  if(dead)return;const scroll=root.scrollTop;segment?.dispose();const saved=document.activeElement,field=saved?.name,caret=saved?.selectionStart;
  root.innerHTML=mod.renderMemoryTab(page.state);const column=root.firstElementChild,form=column.querySelector('form'),results=column.querySelector('.vc-memory-results'),search=form.querySelector('.vc-search');
  const aside=document.createElement('aside');aside.className='vc-memory-sidebar';const content=document.createElement('div');content.className='vc-memory-main';
  for(const el of [...form.children])if(el!==search)aside.append(el);content.append(search,results);form.append(aside,content);
  for(const row of root.querySelectorAll('.vc-memory-row')){
   const item=page.state.items.find(item=>String(item.memoryId)===row.dataset.memoryId),rel=page.state.relationships.find(rel=>String(rel.relationshipId)===String(item.relationshipId));
   row.querySelector('.vc-meta').textContent=`${rel?.companionName||'未命名角色'} · ${item.time?.eventDate||'日期未知'}`;
   const actions=document.createElement('div');actions.className='vc-memory-row-actions';
   for(const [action,label] of [['correct','纠正'],['delete','删除']]){if(action==='correct'&&item.lifecycle!=='ACTIVE'||action==='delete'&&['FORGETTING','FORGOTTEN'].includes(item.lifecycle))continue;const button=document.createElement('button');button.type='button';button.className='vc-btn vc-btn-text';button.dataset.rowAction=action;button.dataset.id=item.memoryId;button.textContent=label;button.disabled=page.state.busy;actions.append(button);}row.parentElement.append(actions);if(!row.querySelector('.vc-status')){const template=document.createElement('div');template.innerHTML=mod.renderMemoryDetailTab({...page.state,detail:item,evidence:[]});const status=template.querySelector('.vc-memory-status .vc-status');if(status)row.querySelector('.vc-grow').append(status);}
  }
  segment=bindSegment(root.querySelector('[data-vc-memory-segment]'),{onChange(index){page.setFilterDraft('status',['','PENDING_VERIFICATION','INVALID'][index]);void page.filter({...page.state.filterDraft});}});
  if(!dialog.hidden){dialog.innerHTML=mod.renderMemoryDetailTab(page.state);dialog.querySelector('.vc-navbar').querySelector('[data-action="back"]').setAttribute('aria-label','关闭');
   const save=dialog.querySelector('[type="submit"]');if(save){save.disabled=page.state.busy||page.state.conflict||!dirty()||!page.state.draft.trim();if(page.state.busy){save.style.width=`${width}px`;save.style.minWidth=`${width}px`;}}
   if(field){const next=dialog.querySelector(`[name="${field}"]`);next?.focus();if(Number.isInteger(caret))next?.setSelectionRange(caret,caret);}
  }
  root.scrollTop=scroll;
 }
 async function select(id,edit=false,opener){if(!await close())return;openerId=id;await page.select(id);if(!page.state.detail)return;dialog.hidden=false;scrim.hidden=false;if(edit)page.edit();paint();dialog.querySelector(edit?'textarea':'.vc-memory-title')?.focus();}
 async function remove(id,opener){if(page.state.busy)return;if(dirty()&&!await close())return;await page.select(id);if(!page.state.detail)return;const ok=await confirmAlert({title:'删除这条记忆？',message:mod.FORGET_NOTICE,action:'删除记忆',opener});if(ok)await page.forget();}
 root.addEventListener('input',e=>{if(e.target.name)page.setFilterDraft(e.target.name,e.target.value);});
 root.addEventListener('submit',async e=>{e.preventDefault();const form=e.target;const from=form.querySelector('[name="eventDateFrom"]'),to=form.querySelector('[name="eventDateTo"]');to.setCustomValidity(from.value&&to.value&&from.value>to.value?'结束日期不能早于开始日期。':'');if(form.reportValidity())await page.filter({...page.state.filterDraft});});
 root.addEventListener('click',async e=>{const button=e.target.closest('button');if(!button||button.disabled)return;if(button.dataset.rowAction){if(button.dataset.rowAction==='delete')await remove(button.dataset.id,button);else await select(button.dataset.id,true,button);return;}if(button.dataset.memoryId){await select(button.dataset.memoryId,false,button);return;}const action=button.dataset.action;if(action==='retry-list')await page.open(args.getRelationshipId?.());if(action==='clear-filters')await page.filter({});if(action==='more')await page.more();if(action==='pick-instance'){menu?.close();menu=popMenu(button,page.state.relationships.map(rel=>({label:rel.companionName,check:String(rel.relationshipId)===page.state.relationshipId,run:()=>page.changeRelationship(rel.relationshipId)})),{below:true});}});
 dialog.addEventListener('input',e=>{if(e.target.name==='summary'){page.setDraft(e.target.value);dialog.querySelector('[type="submit"]').disabled=!dirty()||!page.state.draft.trim();}});
 dialog.addEventListener('submit',async e=>{e.preventDefault();if(e.target.dataset.form==='reauth'){const input=e.target.elements.password;const password=input.value;input.value='';await page.authenticate(password);return;}width=dialog.querySelector('[type="submit"]').getBoundingClientRect().width;await page.save();});
 dialog.addEventListener('click',async e=>{const button=e.target.closest('button');if(!button||button.disabled)return;const action=button.dataset.action;if(action==='back'||action==='cancel-edit')await close();if(action==='edit'){page.edit();dialog.querySelector('textarea')?.focus();}if(action==='confirm-forget'){await remove(page.state.selectedId,button);if(['FORGETTING','FORGOTTEN'].includes(page.state.detail?.lifecycle))await close();}if(action==='refresh-detail')await page.refreshDetail();if(action==='cancel-reauth')page.cancelReauth();});
 dialog.addEventListener('keydown',e=>{if(document.querySelector('.vc-alert'))return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();void close();}if(e.key==='Tab'){const controls=[...dialog.querySelectorAll('button,input,textarea,select,[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length);if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0]?.focus();}}});
 const open=page.open(args.getRelationshipId?.());if(params.get('state')!=='loading')await open;
 if(params.get('screen')&&page.state.items[0])await select(page.state.items[0].memoryId,params.get('screen')==='edit');
 window.VC_MEMORY_PREVIEW={page,root,dialog,select,close,remove};
 return {refresh:()=>page.open(page.state.relationshipId),destroy(){dead=true;segment?.dispose();menu?.close();dialog.remove();scrim.remove();page.close();root.remove();}};
}
export async function check({params}){
 if(innerWidth<744||['empty','loading','error'].includes(params.get('state')))return;
 if(params.get('section'))return sectionCheck(params.get('section'));
 const {page,root,dialog,select,close,remove}=window.VC_MEMORY_PREVIEW;const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('记忆状态未就绪');};
 if(Math.abs(root.querySelector('.vc-memory-sidebar').getBoundingClientRect().width-240)>1)throw Error('记忆筛选宽度');
 const first=page.state.items[0];await select(first.memoryId,true);const area=dialog.querySelector('textarea');area.value='合成纠正草稿';area.dispatchEvent(new Event('input',{bubbles:true}));const leaving=close();await wait(()=>document.querySelector('.vc-alert'));if(document.activeElement.textContent!=='继续编辑')throw Error('记忆默认焦点');window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));await leaving;if(area.value!=='合成纠正草稿')throw Error('记忆Esc丢草稿');
 window.VC_PREVIEW_DELAY=200;dialog.querySelector('[type="submit"]').click();await wait(()=>page.state.busy);if(!dialog.querySelector('textarea').disabled)throw Error('纠正未锁定');await wait(()=>!page.state.busy&&!page.state.editing);window.VC_PREVIEW_DELAY=0;if(page.state.detail.summary!=='合成纠正草稿'||page.state.detail.memoryId===first.memoryId)throw Error('纠正替代记录错误');await close();
 const task=remove(page.state.items[0].memoryId,root);await wait(()=>document.querySelector('.vc-alert'));if(document.activeElement.textContent!=='取消')throw Error('删除默认焦点');window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));await task;if(window.__previewRequests.some(r=>r.method==='DELETE'))throw Error('取消删除仍调用接口');
 const search=root.querySelector('[name="q"]');search.value='桂花';search.dispatchEvent(new Event('input',{bubbles:true}));root.querySelector('form').requestSubmit();await wait(()=>!page.state.loading&&page.state.filters.q==='桂花');if(page.state.items.some(item=>!item.summary.includes('桂花')))throw Error('检索接口未筛选');
}

// UX-31–33：新分区的交互断言（桌面）。请求记录来自合成接口。
async function sectionCheck(section){
 const wait=async(predicate,message)=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error(message);};
 const $=(selector)=>document.querySelector(selector),$$=(selector)=>[...document.querySelectorAll(selector)];
 const sent=(method,pattern)=>window.__previewRequests.some(r=>r.method===method&&pattern.test(r.path));
 if(section==='timeline'){
  const labels=$$('.vc-mem-day h2').map(n=>n.textContent);if(labels[0]!=='今天'||labels[1]!=='昨天')throw Error('时间线分组 '+labels.join());
  if(!$('.vc-mem-pin'))throw Error('钉住卡无钉子图标');
  if(!$('.vc-mem-source:not([hidden])').textContent.startsWith('来自'))throw Error('来源一句');
  const unpinned=$('.vc-mem-card[data-pinned="false"] [data-action="pin"]');unpinned.click();await wait(()=>sent('PUT',/\/pin$/),'钉住未调用接口');
  $('[data-action="edit-inline"]').click();await wait(()=>$('.vc-mem-card.is-editing textarea'),'内联编辑未出现');
  $('[data-action="cancel-inline"]').click();await wait(()=>!$('.vc-mem-card.is-editing'),'内联编辑取消');
  $('[data-section="pinned"]').click();await wait(()=>$$('.vc-mem-card').length&&$$('.vc-mem-card').every(n=>n.dataset.pinned==='true'),'已钉住视图');
  $('[data-section="pending"]').click();await wait(()=>$$('.vc-mem-card').length===1,'待核验视图');
  const toggle=$('[data-vc-incognito]');toggle.click();await wait(()=>sent('PUT',/\/incognito-pref$/)&&$('[data-vc-incognito]').getAttribute('aria-checked')==='true','这次不记');
  return;
 }
 if(section==='diary'){
  if($('link[data-vc-diary-font]'))throw Error('未选手写却加载了字体样式表');
  if(!$('.vc-diary-day[data-has="true"]'))throw Error('日期条无圆点');
  if(!$('.vc-diary-moments li'))throw Error('今天的瞬间');
  $('[data-action="diary-font"]').click();await wait(()=>$('.vc-menu [role="menuitem"]'),'Aa 浮层');
  const items=$$('.vc-menu [role="menuitem"]');if(items.map(n=>n.textContent).join()!=='正文,手写')throw Error('Aa 选项 '+items.map(n=>n.textContent));
  items[1].click();await wait(()=>$('.vc-diary-paper.is-hand')&&$('link[data-vc-diary-font]'),'手写字体');
  if(localStorage.getItem('vc-diary-font')!=='hand')throw Error('字体偏好未保存');
  $('[data-action="diary-month"][data-delta="1"]').click();await wait(()=>$('.vc-diary .vc-memory-empty'),'无日记空态');
  if($('.vc-diary .vc-memory-empty').textContent!=='还没有日记')throw Error('空态文案');
  return;
 }
 if(section==='favorites'){
  if($$('.vc-fav-card').length!==8)throw Error('收藏卡片数');
  if($$('.vc-fav-aside .vc-fav-reminder').length!==2)throw Error('即将提醒');
  $('[data-action="remove-favorite"]').click();await wait(()=>$$('.vc-fav-card').length===7&&sent('DELETE',/\/favorites\/\d+$/),'取消收藏');
  $('[data-action="cancel-reminder"]').click();await wait(()=>sent('DELETE',/\/reminders\/\d+$/)&&$$('.vc-fav-aside .vc-fav-reminder').length===1,'取消提醒');
  $('[data-action="fav-segment"][data-segment="reminders"]').click();await wait(()=>$('.vc-fav[data-segment="reminders"] .vc-fav-reminder'),'提醒分段');
  return;
 }
}
