// 原ST偏好的自有桌面消费者；只投影已接受的设置，不另存一份业务配置。
export function createDesktopPreferences({getContext,document:doc=document}) {
    let settings={},backgroundKey='';
    const background=doc.createElement('div');background.className='vc-tavern-background';background.hidden=true;doc.body.prepend(background);
    const css=doc.createElement('style');css.dataset.vcCustomCss='';doc.head.append(css);
    const api={values:{},apply(next){
        settings=next;const power=settings.power_user || {};api.values=power;
        doc.documentElement.style.setProperty('--fontScale',String(power.font_scale ?? 1));
        if(power.chat_width!==undefined&&power.chat_width!==50)doc.body.style.setProperty('--vc-read',`${720*power.chat_width/50}px`);else doc.body.style.removeProperty('--vc-read');
        for(const key of ['--vc-blur-1','--vc-blur-2','--vc-blur-3']){
            if(power.blur_strength!==undefined&&power.blur_strength!==10)doc.body.style.setProperty(key,`${power.blur_strength}px`);else doc.body.style.removeProperty(key);
        }
        doc.body.dataset.vcHideChatAvatars=String(power.hideChatAvatars_enabled===true);
        doc.body.dataset.vcAvatarStyle=String(power.avatar_style ?? 0);
        doc.body.dataset.vcCompactInput=String(power.compact_input_area!==false);
        const reduced=String(power.reduced_motion===true);
        if(doc.documentElement.dataset.vcNativeReducedMotion!==reduced){doc.documentElement.dataset.vcNativeReducedMotion=reduced;doc.defaultView.dispatchEvent(new Event('vc-motion-preference'));}
        if(css.textContent!==(power.custom_css || ''))css.textContent=power.custom_css || '';
        api.refresh();
    },refresh(){
        const ctx=getContext(),value=ctx.chatMetadata?.custom_background || settings.background?.url || '';
        const fitting=settings.background?.fitting || 'classic',key=JSON.stringify([value,fitting]);if(key===backgroundKey)return;backgroundKey=key;
        // ST存储的backgrounds相对URL以同源根路径解析；/desktop/不改变存储值。
        const image=String(value).replace(/url\((['"]?)(\/?backgrounds\/)/g,'url($1/backgrounds/');
        background.hidden=!image || image.includes('__transparent.png');
        background.style.backgroundImage=image;
        background.style.backgroundSize=({classic:'cover',cover:'cover',contain:'contain',stretch:'100% 100%',center:'auto'})[fitting] || 'cover';
        doc.body.dataset.vcBackground=String(!background.hidden);
    },destroy(){background.remove();css.remove();}};
    return api;
}
