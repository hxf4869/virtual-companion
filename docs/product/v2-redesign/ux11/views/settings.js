const DRAWER_PANEL={ai:'left-nav-panel',api:'rm_api_block',prompt:'AdvancedFormatting',world:'WorldInfo',persona:'PersonaManagement',card:'right-nav-panel',extensions:'rm_extensions_block',backgrounds:'Backgrounds',ui:'user-settings-block'};
export const scenarios = ['model','provider','profile','voice','appearance','account','data','notifications','drawer'].map(screen=>({key:`settings-${screen}`,params:{screen}})).concat(['empty','loading','error','long'].map(state=>({key:`settings-${state}`,params:{screen:'model',state}})),Object.keys(DRAWER_PANEL).filter(name=>name!=='ai').map(drawer=>({key:`settings-drawer-${drawer}`,params:{screen:'drawer',drawer}})));
// UX-22 R4：样板里没有真实宿主抽屉。下面用与宿主相同的 id / class 结构合成最小 DOM（仅样板使用），
// 真实宿主表现需在受管环境复核。ST 自带的几条基础规则也在此近似，否则 .flex-container 等不成形。
const HOST_BASE='.flex-container{display:flex;flex-wrap:wrap;gap:5px;align-items:center}.flexNoGap{gap:0}.flexFlowColumn{flex-direction:column;align-items:stretch}.flex1{flex:1}.wide100p{width:100%}.width100p{width:100%}.marginLeft5{margin-left:5px}.gap3px{gap:3px}.justifyCenter{justify-content:center}.spaceEvenly{justify-content:space-evenly;align-items:flex-start}.range-block{display:flex;flex-wrap:wrap;align-items:center;margin-bottom:5px;justify-content:space-between}.range-block-title{margin:0;width:100%;text-align:center}.range-block-range-and-counter{flex:1;flex-wrap:nowrap;display:flex}.range-block-range{flex:1}.range-block-counter{margin-left:5px;flex:1;display:flex;gap:5px}.toggle-description{width:max-content;margin-left:5px;margin-right:15px;font-size:.85em;text-align:center}.checkbox_label{display:flex;column-gap:5px;align-items:baseline}.title_restorable{display:flex;flex-direction:row;justify-content:space-between;align-items:center}.menu_button{display:inline-flex;cursor:pointer}.inline-drawer{display:flex;flex-direction:column}.inline-drawer-header{display:flex;justify-content:space-between;align-items:center}.inline-drawer-icon{display:inline-block}.margin0{margin:0}.opacity50p{opacity:.5}.drawer-content h3,.drawer-content h4{margin:0}';
const btn=(name,label)=>`<i class="menu_button fa-solid" title="${label}">${ico(name)}</i>`;
const tbtn=(name,label)=>`<div class="menu_button menu_button_icon">${ico(name)}<span>${label}</span></div>`;
let ico=()=>'';
const range=(title,id,value)=>`<div class="range-block"><div class="range-block-title">${title}</div><div class="range-block-range-and-counter"><div class="range-block-range"><input type="range" id="${id}" min="0" max="100" value="${value}"></div><div class="range-block-counter"><input type="number" value="${value}" data-for="${id}"></div></div></div>`;
const num=(title,value)=>`<div class="range-block"><div class="range-block-title">${title}</div><div class="wide100p"><input type="number" class="text_pole" value="${value}"></div></div>`;
const toggle=(title,note,on=true)=>`<div class="range-block"><label class="checkbox_label"><input type="checkbox"${on?' checked':''}><span>${title}</span></label>${note?`<div class="toggle-description justifyLeft">${note}</div>`:''}</div>`;
const presets=(title)=>`<div class="margin0 title_restorable standoutHeader"><strong><span>${title}</span></strong><div class="flex-container gap3px">${btn('link','绑定')}${btn('upload','导入')}${btn('download','导出')}${btn('trash-2','删除')}</div></div><div class="flex-container flexNoGap"><select class="flex1 text_pole"><option>Default</option></select><div class="flex-container marginLeft5 gap3px">${btn('save','保存')}${btn('pencil','重命名')}${btn('plus','另存')}</div></div>`;
const field=(title,control)=>`<div class="flex-container flexFlowColumn"><h4 class="margin0">${title}</h4>${control}</div>`;
const text=(value='')=>`<input class="text_pole" value="${value}">`;
const area=(value='')=>`<textarea class="text_pole" rows="3">${value}</textarea>`;
const group=(title,body,open=true)=>`<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>${title}</b><div class="inline-drawer-icon ${open?'up':'down'}"></div></div><div class="inline-drawer-content" style="${open?'':'display:none'}">${body}</div></div>`;
const DRAWER_HTML={
 'left-nav-panel':()=>`<div class="scrollableInner"><div class="flex-container flexNoGap" id="ai_response_configuration"><div class="width100p">${presets('对话补全预设')}</div><div id="range_block_openai" class="width100p">${toggle('解锁上下文上限','移除上下文滑块的最大值限制')}${range('上下文长度 (Token)','ctx',72)}${num('最大回复长度 (Token)',64)}${num('每次生成多个备选回复',1)}${toggle('流式传输','随着回复生成逐字显示结果。<br>关闭此项时，回复将在完成后一次性显示。')}${range('温度','temp',30)}${range('频率惩罚','freq',50)}${range('存在惩罚','pres',50)}${range('Top P','top',100)}</div></div></div>`,
 'rm_api_block':()=>`<h3 id="title_api">API</h3><div class="flex-container flexFlowColumn">${field('API 连接配置',`<div class="flex-container flexNoGap"><select class="flex1 text_pole"><option>&lt;None&gt;</option></select><div class="flex-container marginLeft5 gap3px">${btn('save','保存')}${btn('pencil','重命名')}${btn('trash-2','删除')}</div></div>`)}${field('聊天补全来源','<select class="text_pole"><option>自定义（兼容 OpenAI）</option></select>')}${field('自定义端点（基础 URL）',text('https://example.invalid/v1'))}${field('自定义 API 密钥（选填）',`<div class="flex-container flexNoGap">${text('缺少密钥').replace('class="','class="flex1 ')}<div class="flex-container marginLeft5">${btn('key','密钥')}</div></div>`)}${field('输入模型名',text('vc03m-chat'))}${field('可用模型','<select class="text_pole"><option>vc03m-chat</option></select>')}<div class="flex-container">${tbtn('link','连接')}${tbtn('settings','附加参数')}${tbtn('send','发送测试消息')}</div></div>`,
 'AdvancedFormatting':()=>`<div class="flex-container alignItemsBaseline"><h3 class="margin0 flex1">高级格式化设置</h3><div class="flex-container">${tbtn('upload','全局导入')}${tbtn('download','全局导出')}</div></div><div id="advanced-formatting-cc-notice" class="info-block warning">灰色选项在使用 聊天补全API 时无效。</div><div class="flex-container spaceEvenly"><div id="ContextSettings" class="flex-container flexNoGap flexFlowColumn flex1"><h4 class="standoutHeader title_restorable"><div>上下文模板</div><div class="flex-container">${btn('zap','派生')}</div></h4><div class="flex-container"><select class="flex1 text_pole"><option>Default</option></select><div class="flex-container gap3px">${btn('save','保存')}${btn('pencil','重命名')}${btn('plus','另存')}${btn('trash-2','删除')}</div></div>${field('故事字符串',area('{{#if anchorBefore}}{{anchorBefore}}'))}${field('位置',`<select class="text_pole"><option>默认（上下文顶部）</option></select>`)}${toggle('始终将角色名称添加到提示词','')}${toggle('修剪空格','')}</div><div id="InstructSettings" class="flex-container flexNoGap flexFlowColumn flex1"><h4 class="standoutHeader title_restorable"><div>格式指引模板</div></h4><div class="flex-container"><select class="flex1 text_pole"><option>Alpaca</option></select></div>${field('激活正则表达式',text('e.g. /llama(-)?2/i'))}${toggle('用换行符包裹序列','')}</div><div id="SystemPromptSettings" class="flex-container flexNoGap flexFlowColumn flex1"><h4 class="standoutHeader title_restorable"><div>系统提示词</div></h4><div class="flex-container"><select class="flex1 text_pole"><option>Neutral - Chat</option></select></div>${field('提示词内容',area("Write {{char}}'s next reply in a fictional chat"))}${field('分词器','<select class="text_pole"><option>Best match (recommended)</option></select>')}</div></div>`,
 'WorldInfo':()=>`<div class="flex-container alignItemsBaseline"><h3 class="margin0 flex1">世界书</h3></div><div class="flex-container" style="align-items:flex-start"><div class="flex1">${field('已启用的世界书（全局有效）','<select class="text_pole"><option>没有激活的世界书。点击这里选择。</option></select>')}</div><div class="flex1">${group('全局世界书激活设置','',false)}</div></div><div class="flex-container">${tbtn('globe','创建')}<span>或</span><select class="flex1 text_pole"><option>--- 选择以编辑 ---</option></select>${btn('upload','导入')}${btn('download','导出')}${btn('pencil','重命名')}${btn('copy','复制')}${btn('trash-2','删除')}</div><div class="flex-container">${btn('plus','新建')}${btn('maximize-2','展开')}${btn('minimize-2','收起')}${btn('layers','更多')}<input class="text_pole flex1" placeholder="搜索..."><select class="text_pole flex1"><option>优先级</option></select>${btn('refresh-cw','刷新')}</div>`,
 'PersonaManagement':()=>`<div class="flex-container alignItemsBaseline"><h3 class="margin0 flex1">用户设定管理</h3><div class="flex-container">${tbtn('bar-chart','使用统计')}${tbtn('download','备份')}${tbtn('upload','恢复')}</div></div><div class="flex-container" style="align-items:flex-start;flex-wrap:nowrap"><div class="flex1"><div class="flex-container">${tbtn('user-plus','创建')}<input class="text_pole flex1" placeholder="搜索..."></div><div class="avatar-container flex-container"><div class="avatar"><b>[Unnamed Persona]</b></div></div></div><div class="flex1"><div class="flex-container"><h4 class="margin0 flex1">合成验收用户</h4>${btn('pencil','编辑')}${btn('refresh-cw','同步')}${btn('image','头像')}</div>${field('用户设定描述',area('示例：[{{user}}是一个28岁的罗马尼亚猫娘。]'))}${field('插入位置','<select class="text_pole"><option>在故事字符串/提示词管理器中</option></select>')}<h4 class="standoutHeader">全局设置</h4>${toggle('切换用户设定时显示通知','')}${toggle('允许每个角色与多个用户设定绑定','',false)}</div></div>`,
 'right-nav-panel':()=>`<div class="scrollableInner"><div class="flex-container"><h3 class="margin0 flex1">走查 c9d5532b</h3>${btn('star','收藏')}${btn('book','世界书')}${btn('globe','全局')}${btn('smile','表情')}${btn('upload','导出')}${btn('copy','复制')}${btn('trash-2','删除')}</div>${field('标签',text('搜索/创建标签'))}${group('创作者的注释','',false)}<h4 class="standoutHeader title_restorable"><div>角色描述</div>${tbtn('link','外部媒体')}</h4>${area('合成走查卡。')}<h4 class="standoutHeader title_restorable"><div>开场白</div>${tbtn('list','其他开场')}</h4>${area('合成开场。')}</div>`,
 'rm_extensions_block':()=>`<div class="flex-container"><h3 class="margin0 flex1">扩展程序</h3>${toggle('在扩展程序更新时通知','',false)}${tbtn('layers','管理扩展程序')}${tbtn('cloud','安装扩展程序')}</div><div class="flex-container" style="align-items:flex-start"><div class="flex1">${group('下载扩展程序和资源','',false)}${group('角色表情','',false)}${group('TTS','',false)}</div><div class="flex1">${group('快速回复','',false)}${group('聊天翻译','',false)}${group('正则','',false)}</div></div>`,
 'Backgrounds':()=>`<div id="bg-header-fixed" class="flex-container"><h3 class="margin0 flex1">背景</h3>${tbtn('upload','添加背景')}</div><div id="bg_menu_content" class="flex-container">${[1,2,3,4,5,6].map(n=>`<div class="bg_example"><div class="thumbnail-clipper" style="width:150px;height:84px;background:var(--vc-select-fill)"></div><div class="BGSampleTitle">背景 ${n}</div></div>`).join('')}</div>`,
 'user-settings-block':()=>`<div id="user-settings-block-content"><h4>UI 主题</h4><div class="flex-container flexNoGap"><select class="flex1 text_pole"><option>Dark Lite</option></select><div class="flex-container marginLeft5 gap3px">${btn('save','保存')}${btn('plus','另存')}</div></div>${field('头像样式','<select class="text_pole"><option>圆形</option></select>')}${field('聊天风格','<select class="text_pole"><option>扁平</option></select>')}<div name="FontBlurChatWidthBlock">${range('页面宽度','pw',50)}${range('字体比例','fs',50)}${range('模糊强度','blur',10)}</div><div name="themeToggles">${toggle('减弱动态效果','')}${toggle('隐藏聊天头像','',false)}</div></div>`,
};
function installDrawerContent(name,iconFn){
    const alias={save:'check',key:'key-round',send:'play','user-plus':'plus','bar-chart':'layers','maximize-2':'chevrons-up-down','minimize-2':'chevrons-up-down',smile:'sparkles',book:'book-open',star:'sparkles',cloud:'upload',list:'layers'};ico=(glyph)=>iconFn(alias[glyph]||glyph,{size:16});
    const id=DRAWER_PANEL[name]||'left-nav-panel',node=document.getElementById(id);
    const style=document.createElement('style');style.dataset.sampleHost='';style.textContent=HOST_BASE;document.head.append(style);
    node.innerHTML=DRAWER_HTML[id]();node.hidden=true;
}
export async function mount({container,source,params,context}) {
    if(source.startsWith('/baseline/')||innerWidth<744)return;
    const {setThemeMode}=await import(`${source}/ui/theme.js`);setThemeMode(params.get('theme')||'light');
    const {mountSettingsShell}=await import(`${source}/desktop/settings-shell.js`);
    if(params.get('screen')==='drawer'){
        const {icon}=await import(`${source}/ui/icons.js`);installDrawerContent(params.get('drawer')||'ai',icon);
        const {mountDrawerPages}=await import(`${source}/drawers.js`);mountDrawerPages(document);
    }
    const settings=mountSettingsShell(container,{getContext:()=>context});window.VC_SETTINGS_PREVIEW=settings;
    const screen=params.get('screen')||'model';await settings.select(['provider','profile'].includes(screen)?'model':screen==='drawer'?DRAWER_PANEL[params.get('drawer')||'ai']:screen,{initial:true});
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
        const initial=input.value;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,input.value+'（草稿）');input.dispatchEvent(new Event('input',{bubbles:true}));
        const leave=settings.select('appearance');await wait('.vc-alert');
        if(document.activeElement.textContent!=='继续编辑')throw Error('模型分类退出默认焦点错误');
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await leave;
        if(input.value!==initial+'（草稿）')throw Error('分类退出 Esc 丢草稿');
        const discard=settings.select('appearance');(await wait('.vc-alert')).querySelector('[data-vc-ok]').click();await discard;
        if(!document.querySelector('[data-preference="theme"]'))throw Error('放弃后未切换分类');
    }
    if(screen==='voice') {
        const input=document.querySelector('[data-voice-field="dailyChatLimit"]'),save=document.querySelector('.vc-settings-header .vc-btn-fill');
        if(!save.disabled)throw Error('语音干净态保存未禁用');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'61');input.dispatchEvent(new Event('input',{bubbles:true}));
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
