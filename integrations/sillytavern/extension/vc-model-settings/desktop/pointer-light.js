export function bindPointerLights(root = document) {
    const ac=new AbortController();const pending=new Map();let frame=0;
    const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.vcReducedMotion==='true';
    const flush=()=>{frame=0;for(const [el,p] of pending){el.style.setProperty('--mx',`${p.x}px`);el.style.setProperty('--my',`${p.y}px`);if(el.hasAttribute('data-vc-tilt')){const rx=Math.max(-4,Math.min(4,(.5-p.y/p.h)*8)),ry=Math.max(-4,Math.min(4,(p.x/p.w-.5)*8));el.style.transform=`perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-2px)`;const art=el.querySelector('img');if(art)art.style.transform=`translate(${ry*1.5}px,${-rx*1.5}px)`;}}pending.clear();};
    root.addEventListener('pointermove',e=>{const el=e.target.closest?.('[data-vc-light]');if(!el||!root.contains(el)||reduced()||e.pointerType==='touch'||document.documentElement.dataset.vcLayout!=='desktop')return;const r=el.getBoundingClientRect();pending.set(el,{x:e.clientX-r.left,y:e.clientY-r.top,w:r.width,h:r.height});if(!frame)frame=requestAnimationFrame(flush);},{signal:ac.signal});
    root.addEventListener('pointerout',e=>{const el=e.target.closest?.('[data-vc-light]');if(!el||el.contains(e.relatedTarget))return;pending.delete(el);el.style.removeProperty('transform');el.querySelector('img')?.style.removeProperty('transform');},{signal:ac.signal});
    const reset=()=>{cancelAnimationFrame(frame);frame=0;pending.clear();for(const el of root.querySelectorAll('[data-vc-tilt]')){el.style.removeProperty('transform');el.querySelector('img')?.style.removeProperty('transform');}};
    const media=matchMedia('(prefers-reduced-motion: reduce)');media.addEventListener('change',reset,{signal:ac.signal});window.addEventListener('vc-motion-preference',reset,{signal:ac.signal});
    return ()=>{ac.abort();reset();};
}
