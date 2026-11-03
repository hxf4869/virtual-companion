export const scenarios=[{key:'story',params:{}},{key:'story-continue',params:{screen:'continue'}},{key:'story-stage',params:{screen:'stage'}},...['empty','loading','error','long'].map(state=>({key:`story-${state}`,params:{state,...(state==='long'?{screen:'stage'}:{})}}))];
export async function mount({ container, args = {}, source, params, context }) {
    const mod = await import(`${source}/story-page.js`);
    const options = { ...args, getConversation: () => context.chatMetadata.vc_binding, getChatIdentity: () => context.chatMetadata.vc_binding.chatIdentity };
    const handle = mod.mountStoryTab(container, options);
    const wait = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error('剧情视图未就绪'); };
    const root = container.querySelector('.vc-story-tab');
    const enter = async () => {
        root.querySelector('[data-action="start"],[data-action="enter"]')?.click();
        await wait(() => root.dataset.view === 'stage' && !root.querySelector('.vc-letterbox'));
    };
    const back = async () => { root.querySelector('[data-action="close"]')?.click(); await wait(() => root.dataset.view === 'gate'); };
    if (params.get('state') !== 'loading') {
        await wait(() => !root.querySelector('[aria-busy="true"]'));
        if (params.get('screen') || params.get('state') === 'error') {
            if (params.get('state') === 'error') {
                root.querySelector('[data-action="start"]')?.click();
                await wait(() => root.querySelector('[role="alert"]') && !root.querySelector('.vc-letterbox'));
            } else { await enter(); if (params.get('screen') === 'continue') await back(); }
        }
    }
    window.VC_STORY_PREVIEW = { handle, root, enter, back };
    return handle;
}
export async function check({ params }) {
    if (innerWidth < 744 || ['empty', 'loading', 'error'].includes(params.get('state'))) return;
    const { root, enter, back } = window.VC_STORY_PREVIEW;
    const wait = async predicate => { for (let i = 0; i < 150; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error('剧情交互未完成'); };
    if (root.dataset.view === 'stage') await back(); else { await enter(); await back(); }
    if (root.querySelector('.vc-navbar').getBoundingClientRect().height !== 64) throw Error('剧情标题栏未显示');
    const cover = root.querySelector('.vc-case-cover').getBoundingClientRect();
    if (Math.abs(cover.width / cover.height - 16 / 9) > .01) throw Error('案件封面比例');
    await enter();
    if (root.querySelector('.vc-story').dataset.worldVersion !== '1') throw Error('剧情开始/返回丢世界版本');
    const target = root.querySelector('[data-action="ask-rewind"]'); target.click();
    await wait(() => document.querySelector('.vc-alert'));
    if (document.activeElement.textContent !== '取消') throw Error('回档默认焦点');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await wait(() => !document.querySelector('.vc-alert'));
    if (root.querySelector('.vc-story').dataset.worldVersion !== '1') throw Error('取消回档仍改变世界');
    root.querySelector('[data-action="ask-rewind"]').click(); await wait(() => document.querySelector('.vc-alert'));
    document.querySelector('[data-vc-ok]').click(); await wait(() => root.querySelector('.vc-story').dataset.worldVersion === '0');
}
