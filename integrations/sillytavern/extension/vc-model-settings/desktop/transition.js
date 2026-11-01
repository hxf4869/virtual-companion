import { SPRING } from '../ui/motion.js';
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.vcReducedMotion==='true';
export function transitionContent(element, update, { shared = false } = {}) {
    if(document.documentElement.dataset.vcLayout!=='desktop')return update();
    if(shared && document.startViewTransition && !reducedMotion())return document.startViewTransition(update);
    const result=update();element.animate(reducedMotion()?[{opacity:0},{opacity:1}]:[{opacity:0,transform:'translateY(8px)',filter:'blur(6px)'},{opacity:1,transform:'none',filter:'blur(0)'}],{duration:reducedMotion()?150:320,easing:reducedMotion()?'ease':SPRING});return result;
}
export function readReducedMotion(storage = localStorage) {try{return storage.getItem('vc-reduced-motion')==='true';}catch{return false;}}
export function writeReducedMotion(value, storage = localStorage) {try{storage.setItem('vc-reduced-motion',String(Boolean(value)));}catch{/* 与现有回复样式相同，本机存储不可用时仅当前窗口生效。 */}document.documentElement.dataset.vcReducedMotion=String(Boolean(value));window.dispatchEvent(new Event('vc-motion-preference'));}
export function bindSidebarLens(sidebar) {
    const lens=document.createElement('i');lens.className='vc-desktop-lens';lens.setAttribute('aria-hidden','true');sidebar.prepend(lens);
    const sync=()=>{const active=sidebar.querySelector('[aria-current="page"]');if(!active)return;const r=active.getBoundingClientRect(),p=sidebar.getBoundingClientRect();lens.style.width=`${r.width}px`;lens.style.height=`${r.height}px`;lens.style.transform=`translate(${r.left-p.left}px,${r.top-p.top+sidebar.scrollTop}px)`;};
    const click=()=>requestAnimationFrame(sync);sidebar.addEventListener('click',click);window.addEventListener('vc-shell-destination',click);window.addEventListener('resize',sync);sync();return ()=>{sidebar.removeEventListener('click',click);window.removeEventListener('vc-shell-destination',click);window.removeEventListener('resize',sync);lens.remove();};
}
