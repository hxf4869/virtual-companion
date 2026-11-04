// AGPL-3.0-only. Derive the locked EJS Monaco editor without its ST UI/chat entry.
export function createEjsEditorSource(input) {
    const cut=(start,end)=>{
        if(input.split(start).length!==2||input.split(end).length!==2)throw new Error('锁定EJS编辑器边界已变化');
        const a=input.indexOf(start),b=input.indexOf(end,a);if(b<a)throw new Error('EJS编辑器边界顺序错误');return input.slice(a,b);
    };
    const runtime=cut('var __webpack_modules__=','var __webpack_exports__={};');
    let editor=cut('function hv(e,t)','function Dv(e)');
    const replace=(from,to)=>{if(editor.split(from).length!==2)throw new Error('锁定EJS编辑器端口已变化');editor=editor.replace(from,to);};
    replace('w.code_editor&&!_v&&(','!_v&&(');
    replace('pv.eventSource.on(pv.event_types.APP_READY,(()=>{w.code_editor&&$("#world_popup_entries_list").on("click",".fa-circle-chevron-down",Dv)})),','');
    replace('console.log("monaco-editor loaded. ",_v)','void 0');
    return `// AGPL-3.0-only. Locked EJS d6f520d149 Monaco runtime/language/completion; no ST initialization.\n${runtime}\n${editor}\nexport async function loadDesktopMonaco(){await bv();return _v;}\nexport async function createDesktopEditor(container,{value='',onChange,options={}}={}){\nawait bv();\nconst editor=_v.editor.create(container,{value,language:'ejs',theme:'ejsTheme',automaticLayout:true,...options});\nconst listener=editor.onDidChangeModelContent(()=>onChange?.(editor.getValue()));\nreturn {getValue:()=>editor.getValue(),update:options=>{if(options.theme)_v.editor.setTheme(options.theme);editor.updateOptions(options);},focus:()=>editor.focus(),dispose(){listener.dispose();editor.dispose();}};\n}\n`;
}
