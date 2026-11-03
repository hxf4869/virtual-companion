export const scenarios = [{key:'inbox',params:{}},{key:'inbox-messages',params:{messages:'1'}},{key:'inbox-voice',params:{messages:'1',voice:'1'}},...['empty','loading','error','long'].map(state=>({key:`inbox-${state}`,params:{state,...(state==='long'?{messages:'1'}:{})}}))];
async function wait(predicate) {
    for (let i=0;i<250;i++) {if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}
    throw Error('陪伴生产组件状态未更新');
}
function input(node,value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);
    node.dispatchEvent(new Event('input',{bubbles:true}));
}
export async function mount({container,args={},source,params}) {
    const mod=await import(`${source}/inbox-page.js`);
    const opened=[];
    // 完整 ST 打开会话为宿主边界；样板记录原回调参数，其余全部使用生产挂载。
    const handle=mod.mountInboxTab(container,{...args,onOpenConversation:payload=>opened.push(payload)});
    window.VC_INBOX_PREVIEW={root:container,handle,opened};
    if(params.get('state')!=='loading')await wait(()=>container.querySelector('.vc-inbox-workspace'));
    if(params.get('channel')) {
        container.querySelector(`[data-action="open-channel"][data-channel="${params.get('channel')}"]`)?.click();
        await wait(()=>container.querySelector('[data-channel-card]'));
    }
    return handle;
}
export async function check({params}) {
    if(innerWidth<744||['empty','loading','error'].includes(params.get('state')))return;
    const {root}=window.VC_INBOX_PREVIEW;
    const right=root.querySelector('.vc-inbox-preferences');
    if(innerWidth>=1180&&Math.abs(right.getBoundingClientRect().width-320)>1)throw Error('陪伴右栏宽度');
    input(root.querySelector('[data-field="quietHoursStart"]'),'22:30');
    root.closest('#vc-shell').querySelector('.vc-sidebar [data-nav="characters"]').click();
    await wait(()=>document.querySelector('[data-vc-cancel]')===document.activeElement);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    await wait(()=>!document.querySelector('.vc-alert'));
    if(root.querySelector('[data-field="quietHoursStart"]').value!=='22:30')throw Error('陪伴Esc丢草稿');
    window.VC_PREVIEW_DELAY=200;
    root.querySelector('[data-action="save-policy"]').click();
    if(!root.querySelector('[data-action="save-policy"]').disabled||!root.querySelector('[data-field="quietHoursStart"]').disabled)throw Error('陪伴等待未锁定');
    await wait(()=>!root.querySelector('[data-field="quietHoursStart"]').disabled);window.VC_PREVIEW_DELAY=0;
    if(root.querySelector('[data-field="quietHoursStart"]').value!=='22:30'||!root.querySelector('[data-action="save-policy"]').disabled)throw Error('陪伴保存未读回');
    const follow=root.querySelector('[data-action="open-follow"]');
    if(follow) {
        follow.click();await wait(()=>document.querySelector('.vc-menu [role="menuitem"]'));
        document.querySelector('.vc-menu [role="menuitem"]').click();
        await wait(()=>document.querySelector('[data-vc-cancel]')===document.activeElement);
        document.querySelector('[data-vc-ok]').click();
        await wait(()=>root.querySelector('.vc-inbox-follow[data-status="CANCELLED"]'));
    }
}
