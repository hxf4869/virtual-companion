// 纯 CSS 漂移；JS 只在氛围、可见性与偏好变化时运行。
export function rotateHue(rgb, degrees = 40) {
    const [r,g,b] = rgb.split(',').map((v) => Number(v.trim()) / 255);
    const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min, l=(max+min)/2;
    if (!d) return rgb;
    let h=max===r ? ((g-b)/d)%6 : max===g ? (b-r)/d+2 : (r-g)/d+4;
    h=((h*60+degrees)%360+360)%360/60;
    const s=d/(1-Math.abs(2*l-1)), c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs(h%2-1)), m=l-c/2;
    const result=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];
    return result.map((v) => Math.round((v+m)*255)).join(',');
}
// UX-34 晨昏氛围：本地时段 -> 时段名；色相 / 亮度偏移量由主题 CSS 变量按 data-vc-period 提供。
export function timeOfDayShift(date = new Date()) {
    const h = date.getHours();
    return h >= 6 && h < 10 ? 'morning' : h >= 10 && h < 17 ? 'noon' : h >= 17 && h < 20 ? 'evening' : 'night';
}
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
