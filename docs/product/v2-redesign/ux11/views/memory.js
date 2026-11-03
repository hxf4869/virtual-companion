export const scenarios = [{key:'memory',params:{}},{key:'memory-detail',params:{screen:'detail'}},{key:'memory-edit',params:{screen:'edit'}},...['empty','loading','error','long'].map(state=>({key:`memory-${state}`,params:{state}})),...['timeline','diary','favorites'].map(section=>({key:`memory-${section}`,params:{section}}))];
async function wait(predicate) {
    for (let i=0;i<250;i++) { if(predicate())return; await new Promise(resolve=>setTimeout(resolve,20)); }
    throw Error('记忆生产组件状态未更新');
}
export async function mount({container,args={},source,params}) {
    const mod = await import(`${source}/memory-page.js`);
    const handle = mod.mountMemoryTab(container,args);
    window.VC_MEMORY_PREVIEW = {root:container,handle};
    if(params.get('state')!=='loading') await wait(()=>!container.querySelector('[aria-busy="true"]'));
    const section=params.get('section');
    if(innerWidth>=744&&section&&section!=='timeline') {
        container.querySelector(`[data-section="${section}"]`)?.click();
        await wait(()=>container.querySelector(section==='diary'?'.vc-diary':'.vc-fav'));
        if(!['loading','empty','error'].includes(params.get('state')))await wait(()=>container.querySelector(section==='diary'?'.vc-diary-paper:not(.is-loading)':'.vc-fav-card'));
    }
    if(innerWidth>=744&&section==='timeline'&&!['loading','empty','error'].includes(params.get('state')))await wait(()=>container.querySelector('.vc-mem-source:not([hidden])'));
    if(params.get('screen')&&params.get('state')!=='loading') {
        container.querySelector('.vc-memory-row')?.click();
        await wait(()=>document.querySelector('.vc-memory-detail-screen .vc-memory-title'));
        if(params.get('screen')==='edit')document.querySelector('.vc-memory-detail-screen [data-action="edit"]')?.click();
    }
    return handle;
}
export async function check({params}) {
    if(innerWidth<744||['empty','loading','error'].includes(params.get('state')))return;
    if(params.get('section'))return sectionCheck(params.get('section'));
    const {root}=window.VC_MEMORY_PREVIEW;
    root.querySelector('.vc-memory-row').click();
    await wait(()=>document.querySelector('.vc-memory-detail-screen .vc-memory-title'));
    const dialog=document.querySelector('.vc-memory-detail-screen');
    dialog.querySelector('[data-action="edit"]').click();
    const field=dialog.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'合成纠正草稿');
    field.dispatchEvent(new Event('input',{bubbles:true}));
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    await wait(()=>document.querySelector('[data-vc-cancel]')===document.activeElement);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    await wait(()=>!document.querySelector('.vc-alert'));
    if(dialog.querySelector('textarea').value!=='合成纠正草稿')throw Error('记忆Esc丢草稿');
    window.VC_PREVIEW_DELAY=200; dialog.querySelector('[type="submit"]').click();
    if(!dialog.querySelector('textarea').disabled)throw Error('纠正未锁定');
    await wait(()=>!dialog.querySelector('textarea'));window.VC_PREVIEW_DELAY=0;
    if(dialog.querySelector('.vc-memory-title').textContent!=='合成纠正草稿')throw Error('纠正替代记录错误');
    dialog.querySelector('[data-action="back"]').click();await wait(()=>!document.querySelector('.vc-memory-detail-screen'));
    root.querySelector('.vc-mem-card [data-action="forget-inline"]').click();
    await wait(()=>document.querySelector('[data-vc-cancel]')===document.activeElement);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    await wait(()=>!document.querySelector('.vc-alert'));
    if(window.__previewRequests.some(r=>r.method==='DELETE'))throw Error('取消删除仍调用接口');
    const search=root.querySelector('[name="q"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search,'桂花');
    search.dispatchEvent(new Event('input',{bubbles:true}));search.form.requestSubmit();
    await wait(()=>!root.querySelector('[aria-busy="true"]'));
    if([...root.querySelectorAll('.vc-memory-summary')].some(node=>!node.textContent.includes('桂花')))throw Error('检索接口未筛选');
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
