// 纯 CSS 漂移；JS 只在氛围、可见性与偏好变化时运行。
import { rotateHue, timeOfDayShift } from '../theme-logic.js';

export { rotateHue, timeOfDayShift };
export function mountAurora(doc = document) {
    const root=doc.createElement('div');root.className='vc-desktop-aurora';root.setAttribute('aria-hidden','true');doc.body.prepend(root);
    const syncVisibility=()=>root.classList.toggle('is-paused',doc.hidden);
    doc.addEventListener('visibilitychange',syncVisibility);syncVisibility();
    const syncPeriod=()=>{root.dataset.vcPeriod=timeOfDayShift(new Date());};
    syncPeriod();const periodTimer=setInterval(syncPeriod,60000);
    let current='',timer;
    function setTint(tint='') {
        if(current===tint && root.firstElementChild)return;
        current=tint;clearTimeout(timer);
        const old=root.firstElementChild;
        const group=doc.createElement('div');group.className='vc-aurora-set';
        for(const color of [tint||'255,150,120',tint?rotateHue(tint):'170,135,255',tint?'120,170,255':'100,165,255']){
            const spot=doc.createElement('div');spot.className='vc-aurora-spot';spot.style.setProperty('--c',color);group.append(spot);
        }
        // 最多保留新旧两组，切换完成立即移除旧组。
        for(const extra of [...root.children].slice(1))extra.remove();
        if(old)group.classList.add('is-entering');
        root.prepend(group);
        if(old){group.getBoundingClientRect();requestAnimationFrame(()=>group.classList.remove('is-entering'));
old.classList.add('is-leaving');timer=setTimeout(()=>old.remove(),900);}
    }
    setTint();
    return {root,setTint,destroy(){clearTimeout(timer);clearInterval(periodTimer);doc.removeEventListener('visibilitychange',syncVisibility);root.remove();}};
}
