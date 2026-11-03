// 同一锁定Monaco的世界书编辑叶子；原字体/显示偏好沿用原localStorage键。
import {openSheet} from '../ui/sheet.js';
import {mountTavernEditorView} from './build/index.js';
import {dataFields,options} from './tavern-fields.js';
import {iconSpriteUrl} from '../ui/icons.js';
const STORAGE_KEY='st_monaco_editor_settings';
const defaults={fontSize:14,fontFamily:"'Cascadia Code','Fira Code',Consolas,'Courier New',monospace",lineHeight:0,letterSpacing:0,fontWeight:'normal',fontLigatures:false,theme:'ejsTheme',cursorStyle:'line',cursorBlinking:'blink',renderWhitespace:'boundary',renderLineHighlight:'line',guidesIndent:'indentation',wordWrap:false,lineNumbers:true,minimap:true,bracketPairColorization:true,folding:true,glyphMargin:false,smoothScrolling:true,mouseWheelZoom:false,scrollBeyondLastLine:true,stickyScroll:true,contextmenu:true,quickSuggestions:true,semanticHighlighting:true,insertSpaces:true,tabSize:4,detectIndentation:true,trimAutoWhitespace:true,wordBasedSuggestions:'currentDocument'};
const labels={fontSize:'字号',fontFamily:'字体',lineHeight:'行高',letterSpacing:'字间距',fontWeight:'字重',fontLigatures:'连字',theme:'主题',cursorStyle:'光标',cursorBlinking:'闪烁',renderWhitespace:'空白',renderLineHighlight:'行高亮',guidesIndent:'缩进线',wordWrap:'换行',lineNumbers:'行号',minimap:'缩略图',bracketPairColorization:'括号配色',folding:'折叠',glyphMargin:'符号边栏',smoothScrolling:'平滑滚动',mouseWheelZoom:'滚轮缩放',scrollBeyondLastLine:'末行后滚动',stickyScroll:'固定上下文',contextmenu:'上下文菜单',quickSuggestions:'快速建议',semanticHighlighting:'语义高亮',insertSpaces:'使用空格',tabSize:'缩进宽度',detectIndentation:'自动检测缩进',trimAutoWhitespace:'清理空白',wordBasedSuggestions:'词语建议'};
const enums={theme:['ejsTheme','vs','vs-dark','hc-black','hc-light'],fontWeight:['normal','bold','100','200','300','400','500','600','700','800','900'],cursorStyle:['line','block','underline','line-thin','block-outline','underline-thin'],cursorBlinking:['blink','smooth','phase','expand','solid'],renderWhitespace:['none','boundary','selection','trailing','all'],renderLineHighlight:['none','gutter','line','all'],guidesIndent:['indentation','none'],wordBasedSuggestions:['off','currentDocument','matchingDocuments','allDocuments']};
const toOptions=cfg=>({...Object.fromEntries(Object.keys(defaults).map(key=>[key,cfg[key]])),wordWrap:cfg.wordWrap?'on':'off',lineNumbers:cfg.lineNumbers?'on':'off',minimap:{enabled:cfg.minimap},bracketPairColorization:{enabled:cfg.bracketPairColorization},stickyScroll:{enabled:cfg.stickyScroll},guides:cfg.guidesIndent==='none'?{indentation:false,bracketPairs:false}:{indentation:true,bracketPairs:true},'semanticHighlighting.enabled':cfg.semanticHighlighting});
export function openCodeEditor({owner,value,onApply,onDone}){
    let baseline;try{baseline={...defaults,...JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')};}catch{baseline={...defaults};}
    const preferences={...baseline},drafts=new Map(),errors=new Map();let text=value,dead=false,editor;
    const body=owner.ownerDocument.createElement('div');body.className='vc-world-code-editor';
    const details=owner.ownerDocument.createElement('details'),summary=owner.ownerDocument.createElement('summary');summary.textContent='编辑器设置';
    const settings=owner.ownerDocument.createElement('div');details.append(summary,settings);
    const canvas=owner.ownerDocument.createElement('div');canvas.className='vc-world-code-canvas';canvas.setAttribute('role','region');canvas.setAttribute('aria-label','世界书代码');
    const status=owner.ownerDocument.createElement('p');status.setAttribute('role','status');status.textContent='正在加载…';body.append(details,status,canvas);
    const dirty=()=>text!==value||JSON.stringify(preferences)!==JSON.stringify(baseline)||errors.size>0;
    const view=mountTavernEditorView(settings,{sprite:iconSpriteUrl(),loading:false,busy:false,resources:[],actions:[],groups:[],onField:edit,onAction(){}});
    function render(){if(dead)return;view.update({sprite:iconSpriteUrl(),loading:false,busy:false,resources:[],actions:[],groups:[{id:'editor',title:'',fields:dataFields(defaults,labels).map(field=>({...field,key:field.name,value:drafts.has(field.name)?drafts.get(field.name):preferences[field.name],...(enums[field.name]?{kind:'select',options:options([...new Set([...enums[field.name],preferences[field.name]])])}:{}),error:errors.get(field.name)}))}],onField:edit,onAction(){}});}
    function edit(name,value){
        if(dead)return;
        if(typeof defaults[name]==='number'){
            const number=Number(value);drafts.set(name,String(value));
            if(!String(value).trim()||!Number.isFinite(number)||name==='fontSize'&&(number<8||number>48)){errors.set(name,'请输入有效数值。');render();return;}
            value=number;errors.delete(name);
        }
        preferences[name]=value;editor?.update(toOptions(preferences));render();
    }
    const sheet=openSheet({title:'代码编辑',body,owner,large:true,isDirty:dirty,
        onSubmit(){if(!editor||errors.size)return false;onApply(text);try{localStorage.setItem(STORAGE_KEY,JSON.stringify(preferences));}catch{/*沿用原本机偏好不可用时的当前窗口行为*/}return true;},
        onDone(){dead=true;editor?.dispose();view.unmount();onDone?.();},
    });
    render();
    void import('/scripts/extensions/third-party/ST-Prompt-Template/dist/desktop-editor.js').then(async module=>{
        if(dead||!canvas.isConnected)return;
        const value=await module.createDesktopEditor(canvas,{value:text,options:toOptions(preferences),onChange:next=>{text=next;}});
        if(dead||!canvas.isConnected){value.dispose();return;}editor=value;status.remove();
    }).catch(()=>{if(!dead)status.textContent='代码编辑器没有加载出来，请关闭后重试。';});
    return {isDirty:dirty,requestLeave:()=>sheet.close(),destroy:()=>sheet.dismiss()};
}
