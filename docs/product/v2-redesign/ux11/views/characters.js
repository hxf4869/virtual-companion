export const scenarios=[{key:'characters',params:{}},{key:'characters-selected',params:{selected:'1'}},{key:'characters-detail',params:{detail:'1'}},...['empty','loading','error','long'].map(state=>({key:`characters-${state}`,params:{state}}))];
export async function mount({container,args={},source,params,context}) {
    const mod=await import(`${source}/instance-page.js`);
    const options={...args,getCards:()=>mod.cardsFromContext(context),getBindings:()=>mod.bindingsFromContext(context)};
    if(source.startsWith('/baseline/')||innerWidth<744){const legacyFixture=!params.get('detail')&&!params.get('selected')&&['ready',null].includes(params.get('state'));const mounted=mod.mountCharactersTab(container,legacyFixture?args:options);if(params.get('state')!=='loading'){for(let i=0;i<150&&container.querySelector('[aria-busy="true"]');i++)await new Promise(r=>setTimeout(r,20));if(container.querySelector('[aria-busy="true"]'))throw Error('角色手机挂载未完成');}if(params.get('selected')==='1'){container.querySelector('.vc-role')?.click();await new Promise(r=>setTimeout(r,20));}return mounted;}
    // 真实宿主里无模板的实例（如「雨夜旅馆」）显示在角色网格下方；样板用 ?loose=1 复现，不进入验收矩阵。
    if(params.get('loose')){const {previewRelationships:rows}=await import('../fixtures.js');if(!rows.some(row=>row.relationshipId==='99'))rows.push({...rows[0],relationshipId:'99',companionName:'雨夜旅馆',characterRef:''});}
    // 使用同一公开业务控制器与渲染函数；桌面不调用会隐藏底层页面的手机页面栈。
    const {confirmDiscard}=await import(`${source}/ui/alert.js`),{bindPointerLights}=await import(`${source}/desktop/pointer-light.js`),{transitionContent}=await import(`${source}/desktop/transition.js`);
    const root=document.createElement('div');root.className='vc-characters vc-desktop-characters';
    const list=document.createElement('section');list.className='vc-screen vc-characters-list';
    const detail=document.createElement('section');detail.className='vc-screen vc-character-detail';detail.hidden=true;
    const file=document.createElement('input');file.type='file';file.accept='.json,.png,application/json,image/png';file.hidden=true;root.append(list,detail,file);container.append(root);
    let query='',selected='',descriptionOpen=false,loading=true,dead=false,typing=false,releaseLights=()=>{},saveWidth=0,openerRef='';
    const page=mod.createInstancePage({...options,importCard:spec=>mod.importNativeCharacterFile({...spec,getContext:()=>context}),onChange(){if(!typing)paint();}});
    const dirty=()=>page.state.draftName!==page.state.savedName&&Boolean(page.state.creating||page.state.selectedRelationshipId);
    async function requestLeave(){if(page.state.busy)return false;if(!dirty())return true;if(!await confirmDiscard({opener:document.activeElement}))return false;page.state.unsaved={type:'close'};page.confirmDiscard();return true;}
    function paint(){
        if(dead)return;releaseLights();const active=document.activeElement,field=active?.name,caret=active?.selectionStart;
        const viewState={...page.state,cards:page.state.cards.map(card=>({...card,avatar:context.characters.find(raw=>raw?.data?.extensions?.vc_character_ref===card.characterRef)?.avatar||''}))};
        list.innerHTML=mod.renderCharactersTab(viewState,{screen:'list',loading});
        const search=document.createElement('input');search.type='search';search.className='vc-character-search';search.placeholder='搜索';search.setAttribute('aria-label','搜索');search.value=query;search.disabled=loading;list.querySelector('.vc-navbar').insertBefore(search,list.querySelector('[data-action="import"]'));applyFilter();
        detail.hidden=!selected;root.classList.toggle('is-detail',Boolean(selected));
        if(selected){const state={...viewState,selectedRelationshipId:page.state.creating?page.state.selectedRelationshipId:''};detail.innerHTML=mod.renderCharactersTab(state,{screen:'detail',detailRef:selected,descriptionOpen});}
        for(const card of list.querySelectorAll('.vc-role')){card.dataset.vcLight='';card.dataset.vcTilt='';}
        const save=detail.querySelector('[type="submit"]');if(save){save.disabled=page.state.busy||!dirty();if(page.state.busy){save.style.width=`${saveWidth}px`;save.style.minWidth=`${saveWidth}px`;save.textContent='保存中…';}}
        for(const field of detail.querySelectorAll('input,button[data-action="cancel-edit"]'))field.disabled=page.state.busy;
        // 独立样板没有完整ST原生编辑器，不将人设动作错误映射到角色卡编辑。
        for(const native of detail.querySelectorAll('[data-action="edit-card"],[data-action="edit-persona"]'))native.disabled=true;
        if(field){const next=detail.querySelector(`[name="${field}"]`);next?.focus();if(Number.isInteger(caret))next?.setSelectionRange(caret,caret);}
        releaseLights=bindPointerLights(root);
    }
    function applyFilter(){for(const card of list.querySelectorAll('.vc-role'))card.hidden=Boolean(query)&&!card.querySelector('b')?.textContent.toLowerCase().includes(query.toLowerCase());}
    async function open(ref){if(!await requestLeave())return;openerRef=ref;const previous=list.querySelector(`[data-ref="${CSS.escape(ref)}"] .vc-role-avatar`);if(previous)previous.style.viewTransitionName='vc-character-art';selected=ref;typing=true;page.selectTemplate(ref);typing=false;const transition=transitionContent(root,()=>{paint();const next=detail.querySelector('.vc-poster-avatar');if(next)next.style.viewTransitionName='vc-character-art';},{shared:true});await transition?.updateCallbackDone;detail.querySelector('h1')?.focus();}
    root.addEventListener('click',async event=>{
        const button=event.target.closest('button');if(!button||button.disabled)return;
        const action=button.dataset.action;
        if(action==='import')file.click();
        if(action==='retry')void refresh();
        if(action==='select-template')await open(button.dataset.ref);
        if(action==='back'&&await requestLeave()){selected='';const transition=transitionContent(root,()=>{paint();const avatar=list.querySelector(`[data-ref="${CSS.escape(openerRef)}"] .vc-role-avatar`);if(avatar)avatar.style.viewTransitionName='vc-character-art';},{shared:true});await transition?.updateCallbackDone;list.querySelector(`[data-ref="${CSS.escape(openerRef)}"]`)?.focus();}
        if(action==='create'){if(await requestLeave()){page.startCreate();detail.querySelector('input')?.focus();}}
        if(action==='cancel-edit'&&await requestLeave()){if(page.state.creating){page.state.unsaved={type:'close'};page.confirmDiscard();}detail.querySelector('h1')?.focus();}
        if(action==='toggle-description'){descriptionOpen=!descriptionOpen;paint();}
        if(action==='edit-card')mod.openHostCharacterPanel();
        if(action==='edit-voice'){const row=page.state.relationships.find(row=>row.characterRef===selected);if(row){const voice=await import(`${source}/voice-settings.js`);await voice.openRelationshipVoiceSettings(row.relationshipId,{opener:button});}}
        if(action==='select-instance'){if(!await requestLeave())return;page.selectInstance(button.dataset.id);const row=page.state.relationships.find(row=>String(row.relationshipId)===button.dataset.id);if(row)args.onOpenInstance?.({relationshipId:String(row.relationshipId),characterRef:selected,name:row.companionName});}
    });
    root.addEventListener('input',event=>{if(event.target.classList.contains('vc-character-search')){query=event.target.value.trim();applyFilter();return;}if(event.target.name!=='displayName')return;typing=true;page.setName(event.target.value);typing=false;const save=detail.querySelector('[type="submit"]');if(save)save.disabled=!dirty();});
    root.addEventListener('submit',async event=>{event.preventDefault();if(page.state.busy)return;saveWidth=detail.querySelector('[type="submit"]').getBoundingClientRect().width;await page.save();if(!page.state.nameError){const keep=selected;await page.open();page.selectTemplate(keep);detail.querySelector('h1')?.focus();}});
    file.addEventListener('change',async()=>{const chosen=file.files[0];file.value='';if(chosen)await page.importFile({name:chosen.name,bytes:new Uint8Array(await chosen.arrayBuffer())});});
    async function refresh(){loading=true;paint();await page.open();loading=false;paint();}
    const start=refresh();if(params.get('state')!=='loading')await start;if(params.get('detail')==='1'||params.get('selected')==='1'||params.get('state')==='long'){const ref=page.state.cards[0]?.characterRef;if(ref)await open(ref);}
    window.VC_CHARACTERS_PREVIEW={root,page,open,requestLeave};
    return {refresh,destroy(){dead=true;releaseLights();root.remove();}};
}
export async function check({params}) {
    if(innerWidth<744||['loading','empty','error'].includes(params.get('state')))return;
    const {root,page,open}=window.VC_CHARACTERS_PREVIEW;
    const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('角色状态未更新');};
    await wait(()=>!root.querySelector('[aria-busy="true"]'));
    const search=root.querySelector('.vc-character-search');search.value='林舟';search.dispatchEvent(new Event('input',{bubbles:true}));const found=[...root.querySelectorAll('.vc-role')].filter(card=>!card.hidden);if(found.length!==1||!found[0].textContent.includes('林舟')||!found[0].textContent.includes('1 个实例'))throw Error('角色名过滤或实例计数错误');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));
    const first=page.state.cards[0]?.characterRef;if(!first)throw Error('角色卡未载入');await open(first);
    if(root.querySelector('.vc-character-detail').hidden)throw Error('角色详情未展开');
    if(Math.abs(root.querySelector('.vc-character-detail').getBoundingClientRect().width-400)>1)throw Error('角色详情不是400宽');
    root.querySelector('.vc-character-detail [data-action="create"]').click();await wait(()=>root.querySelector('[name="displayName"]'));
    const input=root.querySelector('[name="displayName"]');input.value='合成草稿';input.dispatchEvent(new Event('input',{bubbles:true}));
    const leave=window.VC_CHARACTERS_PREVIEW.requestLeave();await wait(()=>document.querySelector('.vc-alert'));
    if(document.activeElement.textContent!=='继续编辑')throw Error('实例退出默认焦点错误');window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await leave;if(input.value!=='合成草稿')throw Error('实例Esc丢草稿');
    const discard=window.VC_CHARACTERS_PREVIEW.requestLeave();await wait(()=>document.querySelector('.vc-alert'));document.querySelector('[data-vc-ok]').click();await discard;if(page.state.creating)throw Error('实例放弃未恢复');
    root.querySelector('.vc-character-detail [data-action="create"]').click();await wait(()=>root.querySelector('[name="displayName"]'));
    const next=root.querySelector('[name="displayName"]');next.value='合成新增实例';next.dispatchEvent(new Event('input',{bubbles:true}));
    window.VC_PREVIEW_DELAY=200;root.querySelector('.vc-character-detail [type="submit"]').click();if(!page.state.busy)throw Error('创建未进入等待态');
    await wait(()=>!page.state.busy&&!page.state.nameError&&root.querySelector(`.vc-role[data-ref="${CSS.escape(first)}"] > span:last-child`)?.textContent==='2 个实例');window.VC_PREVIEW_DELAY=0;if(document.activeElement!==root.querySelector('.vc-character-detail h1'))throw Error('创建完成未聚焦详情标题');
}
