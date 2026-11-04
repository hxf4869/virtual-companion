// 同一锁定Monaco的世界书编辑叶子；原字体/显示偏好沿用原localStorage键。
import {openSheet} from '../ui/sheet.js';
import {mountTavernEditorView} from './build/index.js';
import {iconSpriteUrl} from '../ui/icons.js';
import {
    CODE_EDITOR_STORAGE_KEY,
    defaults,
    labels,
    enums,
    toOptions,
    readCodeEditorPreferences,
    writeCodeEditorPreferences,
    buildCodeEditorFields,
    validateCodeEditorField,
} from './tavern-controller.js';
export {
    CODE_EDITOR_STORAGE_KEY,
    defaults,
    labels,
    enums,
    toOptions,
    readCodeEditorPreferences,
    writeCodeEditorPreferences,
    buildCodeEditorFields,
    validateCodeEditorField,
};
export function openCodeEditor({owner,value,onApply,onDone}){
    const baseline=readCodeEditorPreferences();
    const preferences={...baseline},drafts=new Map(),errors=new Map();let text=value,dead=false,editor;
    const body=owner.ownerDocument.createElement('div');body.className='vc-world-code-editor';
    const details=owner.ownerDocument.createElement('details'),summary=owner.ownerDocument.createElement('summary');summary.textContent='编辑器设置';
    const settings=owner.ownerDocument.createElement('div');details.append(summary,settings);
    const canvas=owner.ownerDocument.createElement('div');canvas.className='vc-world-code-canvas';canvas.setAttribute('role','region');canvas.setAttribute('aria-label','世界书代码');
    const status=owner.ownerDocument.createElement('p');status.setAttribute('role','status');status.textContent='正在加载…';body.append(details,status,canvas);
    const dirty=()=>text!==value||JSON.stringify(preferences)!==JSON.stringify(baseline)||errors.size>0;
    const view=mountTavernEditorView(settings,{sprite:iconSpriteUrl(),loading:false,busy:false,resources:[],actions:[],groups:[],onField:edit,onAction(){}});
    function render(){if(dead)return;view.update({sprite:iconSpriteUrl(),loading:false,busy:false,resources:[],actions:[],groups:[{id:'editor',title:'',fields:buildCodeEditorFields(preferences,drafts,errors)}],onField:edit,onAction(){}});}
    function edit(name,value){
        if(dead)return;
        const result=validateCodeEditorField(name,value);
        if(!result.ok){drafts.set(name,result.draft);errors.set(name,result.error);render();return;}
        drafts.delete(name);errors.delete(name);
        preferences[name]=result.value;editor?.update(toOptions(preferences));render();
    }
    const sheet=openSheet({title:'代码编辑',body,owner,large:true,isDirty:dirty,
        onSubmit(){if(!editor||errors.size)return false;onApply(text);writeCodeEditorPreferences(preferences);return true;},
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
