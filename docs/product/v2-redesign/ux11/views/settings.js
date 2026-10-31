export const scenarios = ['model','provider','profile','voice','appearance','account','data','notifications','drawer'].map(screen=>({key:`settings-${screen}`,params:{screen}})).concat(['empty','loading','error','long'].map(state=>({key:`settings-${state}`,params:{screen:'model',state}})));
export async function mount({container,source,params,context}) {
    if(source.startsWith('/baseline/')||innerWidth<744)return;
    const {setThemeMode}=await import(`${source}/ui/theme.js`);setThemeMode(params.get('theme')||'light');
    const {mountSettingsShell}=await import(`${source}/desktop/settings-shell.js`);
    const settings=mountSettingsShell(container,{getContext:()=>context});window.VC_SETTINGS_PREVIEW=settings;
    const screen=params.get('screen')||'model';await settings.select(['provider','profile'].includes(screen)?'model':screen==='drawer'?'left-nav-panel':screen,{initial:true});
    if(['model','provider','profile'].includes(screen)) {
        const end=Date.now()+(params.get('state')==='loading'?100:5000);while(settings.model._state.phase==='loading'&&Date.now()<end)await new Promise(r=>setTimeout(r,20));
        if(screen!=='model'){settings.model.root.querySelector('[data-action="select-provider"]')?.click();await wait('#vcms-f-display');if(screen==='profile'){settings.model.root.querySelector('[data-action="select-model"]')?.click();await wait('#vcms-m-display');}}
    }
    if(screen==='voice'){const end=Date.now()+5000;while(!container.querySelector('[data-voice-field="dailyChatLimit"]')&&Date.now()<end)await new Promise(r=>setTimeout(r,20));}
}
export async function check({params,source}) {
    if(innerWidth<744)return;
    const screen=params.get('screen'),settings=window.VC_SETTINGS_PREVIEW;
    if(['empty','loading','error','long'].includes(params.get('state'))){
        if(['loading','error'].includes(params.get('state'))&&!settings.model.root.querySelector('#vcms-save').disabled)throw Error('未载入时保存未禁用');
        if(params.get('state')==='empty'&&settings.model.root.querySelector('[data-action="select-provider"]'))throw Error('空状态出现供应商');
        return;
    }
    if(!document.querySelector('.vc-settings-shell'))throw Error('设置壳未挂载');
    if(['model','provider','profile'].includes(screen)) {
        if(settings.model.root.querySelector('.vcms-panel').getAttribute('aria-modal'))throw Error('嵌入模型仍错误地声明模态');
        if(screen==='model'){settings.model.root.querySelector('[data-action="select-provider"]').click();await wait('#vcms-f-display');}
        const input=settings.model.root.querySelector(screen==='profile'?'#vcms-m-display':'#vcms-f-display');
        const initial=input.value;input.value+='（草稿）';input.dispatchEvent(new Event('input',{bubbles:true}));
        const leave=settings.select('appearance');await wait('.vc-alert');
        if(document.activeElement.textContent!=='继续编辑')throw Error('模型分类退出默认焦点错误');
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await leave;
        if(input.value!==initial+'（草稿）')throw Error('分类退出 Esc 丢草稿');
        const discard=settings.select('appearance');(await wait('.vc-alert')).querySelector('[data-vc-ok]').click();await discard;
        if(!document.querySelector('[data-preference="theme"]'))throw Error('放弃后未切换分类');
    }
    if(screen==='voice') {
        const input=document.querySelector('[data-voice-field="dailyChatLimit"]'),save=document.querySelector('.vc-settings-header .vc-btn-fill');
        if(!save.disabled)throw Error('语音干净态保存未禁用');input.value='61';input.dispatchEvent(new Event('input',{bubbles:true}));
        const leave=settings.select('appearance');await wait('.vc-alert');if(document.activeElement.textContent!=='继续编辑')throw Error('语音退出默认焦点错误');
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await leave;if(input.value!=='61')throw Error('语音 Esc 丢草稿');
        window.VC_PREVIEW_DELAY=200;const width=save.getBoundingClientRect().width;save.click();
        if(!input.disabled||!save.disabled||save.textContent!=='保存中…'||save.getBoundingClientRect().width!==width)throw Error('语音保存等待态错误');
        await settings.select('appearance');if(!input.isConnected)throw Error('保存中允许离开');
        for(let i=0;i<80&&save.textContent==='保存中…';i++)await new Promise(r=>setTimeout(r,25));window.VC_PREVIEW_DELAY=0;
        const {fetchVoiceSettings}=await import(`${source}/api.js`);if((await fetchVoiceSettings()).dailyChatLimit!==61||!save.disabled)throw Error('语音保存未生效');
    }
    if(screen==='appearance') {
        const motion=document.querySelector('[aria-label="减弱动态效果"]');motion.click();
        if(document.documentElement.dataset.vcReducedMotion!=='true'||localStorage.getItem('vc-reduced-motion')!=='true')throw Error('减弱动态效果未保存');
    }
}
async function wait(selector){for(let i=0;i<80;i++){const node=document.querySelector(selector);if(node)return node;await new Promise(r=>setTimeout(r,25));}throw Error(`设置控件未出现：${selector}`);}
