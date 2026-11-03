export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.vcReducedMotion==='true' || document.documentElement.dataset.vcNativeReducedMotion==='true';
export function transitionContent(element, update, { shared = false } = {}) {
    if(document.documentElement.dataset.vcLayout!=='desktop')return update();
    if(shared && document.startViewTransition && !reducedMotion())return document.startViewTransition(update);
    const result = update();
    const reduced = reducedMotion();
    const css = globalThis.getComputedStyle?.(element);
    const value = name => css?.getPropertyValue(name).trim() || '';
    const time = value(reduced ? '--vc-dur-reduced' : '--vc-dur-emphasized');
    const duration = (parseFloat(time) || 0) * (time.endsWith('ms') ? 1 : 1000);
    if (!duration) return result;
    element.animate(reduced ? [{opacity:0},{opacity:1}] : [
        {opacity:0,transform:`translateY(${value('--vc-content-rise') || '0px'})`,filter:`blur(${value('--vc-content-blur') || '0px'})`},
        {opacity:1,transform:'none',filter:'blur(0)'},
    ], {duration,easing:value(reduced ? '--vc-ease-reduced' : '--vc-spring') || 'linear'});
    return result;
}
export function readReducedMotion(storage = localStorage) {try{return storage.getItem('vc-reduced-motion')==='true';}catch{return false;}}
export function writeReducedMotion(value, storage = localStorage) {try{storage.setItem('vc-reduced-motion',String(Boolean(value)));}catch{/* 与现有回复样式相同，本机存储不可用时仅当前窗口生效。 */}document.documentElement.dataset.vcReducedMotion=String(Boolean(value));window.dispatchEvent(new Event('vc-motion-preference'));}
export function bindSidebarLens(sidebar) {
    const lens=document.createElement('i');lens.className='vc-desktop-lens';lens.setAttribute('aria-hidden','true');sidebar.prepend(lens);
    const sync=()=>{const active=sidebar.querySelector('[aria-current="page"]');if(!active)return;const r=active.getBoundingClientRect(),p=sidebar.getBoundingClientRect();lens.style.width=`${r.width}px`;lens.style.height=`${r.height}px`;lens.style.transform=`translate(${r.left-p.left}px,${r.top-p.top+sidebar.scrollTop}px)`;};
    const click=()=>requestAnimationFrame(sync);sidebar.addEventListener('click',click);window.addEventListener('vc-shell-destination',click);window.addEventListener('resize',sync);sync();return ()=>{sidebar.removeEventListener('click',click);window.removeEventListener('vc-shell-destination',click);window.removeEventListener('resize',sync);lens.remove();};
}

// UX-34 共享元素过渡：from 与 to 在同一次视图过渡中共用 view-transition-name，250ms。
// update 完成后 to 才出现（可为函数，在 update 之后求值）；不支持 View Transitions 或减少动效时直接 update。
// 视图过渡回调的启动宽限：超过即放弃动画直接更新（窗口在后台或渲染被节流时浏览器会一直推迟回调）。
export const TRANSITION_START_GRACE_MS = 120;
export function sharedTransition(update, { from, to, name = 'vc-shared' } = {}) {
    const doc = from?.ownerDocument || globalThis.document;
    const canAnimate = doc?.documentElement?.dataset?.vcLayout === 'desktop' && typeof doc.startViewTransition === 'function' && !reducedMotion()
        && doc.visibilityState !== 'hidden';
    if (!canAnimate) { const result = update(); return Promise.resolve(result).then(() => undefined); }
    let target;
    let ran = null;
    // 返回的 Promise 在界面更新完成时兑现（不等动画结束），调用方可以据此认为状态已生效。
    const run = () => {
        ran ??= (async () => {
            if (from) from.style.viewTransitionName = '';
            await update();
            target = typeof to === 'function' ? to() : to;
            if (target) target.style.viewTransitionName = name;
        })();
        return ran;
    };
    if (from) from.style.viewTransitionName = name;
    const transition = doc.startViewTransition(run);
    // 窗口不在前台渲染时浏览器会推迟回调，界面会一直停在旧画面：短时间内没开始就放弃动画直接更新。
    const grace = setTimeout(() => { if (!ran) { transition.skipTransition?.(); void run(); } }, TRANSITION_START_GRACE_MS);
    const clear = () => { if (from) from.style.viewTransitionName = ''; if (target) target.style.viewTransitionName = ''; };
    transition.finished.then(clear, clear);
    // 浏览器回调或宽限定时器先开始更新的一方生效；等到这次更新完成再兑现。
    return new Promise((resolve, reject) => {
        const wait = () => {
            if (!ran) { setTimeout(wait, 16); return; }
            clearTimeout(grace);
            ran.then(() => resolve(undefined), reject);
        };
        wait();
    });
}
