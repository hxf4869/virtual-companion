import { mountTavernEditorView } from './build/index.js';
import { confirmAlert, confirmDiscard } from '../ui/alert.js';
import { showToast } from '../ui/toast.js';
import { openSheet } from '../ui/sheet.js';
import { iconSpriteUrl } from '../ui/icons.js';
import { fetchModelPurposes, fetchProviders } from '../api.js';
import { resolveForegroundProjection, ineligibleReasonLabel } from '../projection.js';
import { documentChanges, documentEqual, documentValue, applyDocumentValues } from '../settings-documents.js';
import { replyDefaults, appearanceDefaults, formatDefaults, worldDefaults, worldEntryDefaults, personaDefaults, ejsDefaults, helperDefaults, chatCompletionDefaultPrompts, promptManagerDefaultPromptOrder } from './tavern-defaults.js';
import { options, openaiPresetFields, replyFields, promptFields, worldFields, worldSettingFields, personaFields, appearanceFields, characterFields, noteFields, dataFields, ejsLabels, renderLabels } from './tavern-fields.js';

const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const get = (value, path) => documentValue(value, path).value;
function put(value, path, next) {
    if (!path.length) return copy(next);
    let parent = value;
    for (const key of path.slice(0,-1)) {
        if (!Object.hasOwn(parent,key) || parent[key] === null || typeof parent[key] !== 'object') Object.defineProperty(parent,key,{value:{},writable:true,enumerable:true,configurable:true});
        parent = parent[key];
    }
    if (next===undefined) delete parent[path.at(-1)];
    else Object.defineProperty(parent,path.at(-1),{value:copy(next),writable:true,enumerable:true,configurable:true});
    return value;
}
function defaults(value, fallback) {
    if (!object(value)) return value === undefined ? copy(fallback) : copy(value);
    const next = copy(value);
    for (const [key, item] of Object.entries(fallback)) next[key] = Object.hasOwn(next, key) ? (object(item) && object(next[key]) ? defaults(next[key], item) : next[key]) : copy(item);
    return next;
}
const split = name => name.split('.');
const emptyOption = { value: '', label: '未选择' };
const builtinPrompts = new Set(chatCompletionDefaultPrompts.prompts.map(prompt=>prompt.identifier));
const actions = (...values) => values.map(([id, label, extra]) => ({ id, label, ...extra }));
const connectionKeys = /^(?:api_key|api_key_.*|.*_api_key|proxy_password|password|credential|credentials|custom_url|reverse_proxy|custom_include_headers|custom_include_body|azure_base_url|secret_key|access_token|refresh_token)$/i;
function portablePreset(value) {
    // Connection fields are not portable. Unknown preset / extension data remains byte-for-value intact.
    return Object.fromEntries(Object.entries(value).filter(([key])=>!connectionKeys.test(key)).map(([key,item])=>[key,copy(item)]));
}
function parseObject(value, label) {
    const next = typeof value === 'string' ? JSON.parse(value) : copy(value);
    if (!object(next)) throw new Error(`${label}必须是 JSON 对象。`);
    return next;
}

/** One React subtree, one in-memory draft per original ST document. No ST UI bootstrap. */
export function mountTavernSettings(container, opts = {}) {
    const { key, client, setHeader = () => {}, getContext = () => ({}) } = opts;
    const ac = new AbortController(), records = new Map(), bindings = new Map(), textDrafts = new Map(), errors = new Map();
    let destroyed = false, ticket = 0, busy = false, loading = true, error = '', conflict = false, view, codeEditor;
    let packet, settings, metadata, metadataOwner = '', selectedWorld = '', selectedPersona = '', selectedCharacter = '', selectedPrompt = '';
    let worlds = [], avatars = [], backgrounds = [], characters = [], selectedTemplate = 'context', selectedScope = '', projection, projectionError = '', sheet;
    const selectedPresets = { openai: '', context: '', instruct: '', sysprompt: '', reasoning: '' };
    const alive = id => !destroyed && !ac.signal.aborted && (id === undefined || id === ticket);
    const context = () => { try { return getContext() || {}; } catch { return {}; } };
    const contextIdentity = ctx => JSON.stringify([ctx.chatId ?? '', ctx.character?.avatar ?? ctx.characters?.[ctx.characterId]?.avatar ?? '', ctx.groupId ?? '']);
    const currentAvatar = () => context().character?.avatar ?? context().characters?.[context().characterId]?.avatar ?? '';
    const canMetadata = () => context().canEditChatMetadata === true && Boolean(opts.onMetadataCommit) && contextIdentity(context()) === metadataOwner;
    const noteDefaults = () => {
        const note=settings?.next.extension_settings?.note || {};
        return {note_prompt:note.default ?? '',note_interval:note.defaultInterval ?? 1,note_position:note.defaultPosition ?? 1,note_depth:note.defaultDepth ?? 4,note_role:note.defaultRole ?? 0};
    };
    const addRecord = (id, kind, raw, fallback = {}, extra = {}) => {
        const value = defaults(raw === undefined ? {} : raw, fallback);
        const record = { id, kind, raw: copy(raw), view: copy(value), next: copy(value), ...extra };
        records.set(id, record); return record;
    };
    const presetRecord = (api, name = selectedPresets[api]) => records.get(`preset:${api}:${name}`);
    const charRecord = () => records.get(`character:${selectedCharacter}`);
    const worldRecord = () => records.get(`world:${selectedWorld}`);
    const changed = record => !documentEqual(record.view, record.next) || record.raw === undefined;
    const dirty = () => [...records.values()].some(changed) || errors.size > 0 || Boolean(codeEditor?.isDirty());
    const request = (url, body = {}) => client.request(url, body, { signal: ac.signal });
    const post = (url, body) => client.post(url, body, { signal: ac.signal });
    const notify = message => { if (alive()) showToast(message); };
    function fail(cause) {
        if (!alive() || cause?.name === 'AbortError') return;
        conflict = cause?.status === 409;
        error = conflict ? '设置已在另一处更新。当前输入仍保留；加载最新会放弃本次更改。' : (cause?.message || '操作没有完成，请重试。');
        render();
    }
    function bind(record, path, spec, extra = {}) {
        const id = JSON.stringify([record.id, ...path]);
        const raw = get(record.next,path);
        const value = raw ?? spec.fallback ?? (spec.kind === 'json' ? {} : spec.kind === 'list' || spec.kind === 'multiselect' ? [] : spec.kind === 'boolean' ? false : '');
        bindings.set(id, { record, path, spec, disabled: extra.disabled });
        let displayed = value;
        if (spec.kind === 'json') displayed = textDrafts.has(id) ? textDrafts.get(id) : JSON.stringify(value, null, 2);
        if (spec.kind === 'number') displayed = textDrafts.has(id) ? textDrafts.get(id) : value;
        if (spec.nullableBoolean) displayed = String(raw ?? null);
        return { ...spec, ...extra, key: id, value: displayed, error: errors.get(id) };
    }
    function fields(record, base, specs, extra) { return specs.map(spec => bind(record, [...base, ...split(spec.name)], spec, extra)); }
    const rawField = (name, label, kind = 'text', extra = {}) => ({name,label,kind,...extra});
    function group(id, title, record, base, specs, extra) { return { id, title, fields: fields(record, base, specs, extra) }; }
    function resource(id, label, value, rows) { return { key: id, label, value, options: rows }; }
    const presetOptions = api => [...records.values()].filter(r => r.kind === 'preset' && r.apiId === api).map(r => ({value:r.name,label:r.name}));
    function modelFields() {
        if (!projection?.eligible) return [{key:'model-status',label:'前台聊天',value:projectionError || ineligibleReasonLabel(projection?.reason || 'no-binding'),disabled:true}];
        const p = projection;
        return [['protocol','协议',p.protocol],['provider','供应商',p.providerLabel],['model','模型',p.modelId],['context','上下文窗口',p.contextWindowTokens],['output','输出上限',p.maxOutputTokens],
            ...(p.pinned.temperature === undefined ? [] : [['temperature','温度',p.pinned.temperature]]),
            ...(p.pinned.topP === undefined ? [] : [['top-p','Top P',p.pinned.topP]]),
            ...(p.pinned.reasoningEffort === undefined ? [] : [['reasoning','推理等级',p.pinned.reasoningEffort]])].map(([id,label,value])=>({key:`model-${id}`,label,value,disabled:true}));
    }
    function promptOrder() {
        const oai = settings.next.oai_settings;
        const scopes = Array.isArray(oai.prompt_order) ? oai.prompt_order : [];
        if (!selectedScope && scopes.length) selectedScope = String(scopes[0].character_id);
        return scopes.find(scope => String(scope.character_id) === selectedScope);
    }
    function selectedPromptObject() { return settings.next.oai_settings.prompts?.find(prompt => prompt.identifier === selectedPrompt); }
    function render() {
        if (!alive()) return;
        bindings.clear();
        const p = { sprite:iconSpriteUrl(), loading, busy, error, conflict, resources:[], actions:[], groups:[], onField:edit, onAction:(action,value)=>void act(action,value) };
        if (!loading && settings) {
            const oai = settings.next.oai_settings;
            if (key === 'left-nav-panel') {
                p.resources.push(resource('preset','回复预设',selectedPresets.openai,[emptyOption,...presetOptions('openai')]));
                p.actions.push(...actions(['preset-apply','应用预设'],['preset-save','保存预设'],['preset-save-as','另存预设'],['preset-import','导入',{accept:'.json,application/json'}],['preset-export','导出']));
                p.groups.push({id:'model',title:'前台模型',fields:modelFields(),actions:actions(['models','模型设置'])});
                p.groups.push(group('reply','回复参数',settings,['oai_settings'],replyFields.map(spec=>{
                    const pinned = projection?.eligible && ({temp_openai:'temperature',top_p_openai:'topP',reasoning_effort:'reasoningEffort'}[spec.name]);
                    return pinned && projection.pinned[pinned] !== undefined ? {...spec,disabled:true} : spec;
                })));
                if (projection?.eligible) {
                    for (const f of p.groups.at(-1).fields) {
                        const name = bindings.get(f.key)?.spec.name, pinned = {temp_openai:'temperature',top_p_openai:'topP',reasoning_effort:'reasoningEffort'}[name];
                        if (pinned && projection.pinned[pinned] !== undefined) { f.value = projection.pinned[pinned]; bindings.get(f.key).disabled = true; }
                    }
                }
                p.groups.push(group('continuation','续写',settings,['power_user'],[rawField('auto_continue.enabled','自动续写','boolean'),rawField('auto_continue.allow_chat_completions','允许聊天补全续写','boolean'),rawField('auto_continue.target_length','续写目标长度','number',{min:0,step:1}),rawField('quick_continue','快速续写','boolean'),rawField('continue_on_send','发送时续写','boolean'),rawField('custom_stopping_strings','停止字符串','code')]));
                p.groups.push(group('logit-bias','Token 偏置',settings,['oai_settings'],[rawField('bias_preset_selected','偏置预设','select',{options:Object.keys(oai.bias_presets || {}).map(name=>({value:name,label:name}))}),rawField('bias_presets','偏置定义','json')]));
            } else if (key === 'AdvancedFormatting') {
                p.resources.push(resource('template','格式模板',selectedTemplate,options(['context','instruct','sysprompt','reasoning'])));
                p.resources.push(resource('template-preset','模板预设',selectedPresets[selectedTemplate],[emptyOption,...presetOptions(selectedTemplate)]));
                p.actions.push(...actions(['template-apply','应用模板'],['template-save','保存模板'],['template-save-as','另存模板'],['template-import','导入模板',{accept:'.json,application/json'}],['template-export','导出模板'],['prompt-add','新增提示词'],['prompt-delete','删除提示词',{disabled:!selectedPromptObject() || builtinPrompts.has(selectedPrompt)}]));
                const prompts = Array.isArray(oai.prompts) ? oai.prompts : [];
                if (!selectedPrompt && prompts.length) selectedPrompt = prompts[0].identifier;
                p.items = prompts.map(prompt=>({id:prompt.identifier,name:prompt.name || prompt.identifier,selected:prompt.identifier===selectedPrompt}));
                const order = promptOrder();
                p.resources.push(resource('scope','提示词作用域',selectedScope,(oai.prompt_order || []).map(scope=>({value:String(scope.character_id),label:String(scope.character_id)}))));
                p.order = (order?.order || []).map(item=>({id:item.identifier,name:prompts.find(prompt=>prompt.identifier===item.identifier)?.name || item.identifier,enabled:item.enabled===true}));
                const index = prompts.findIndex(prompt=>prompt.identifier===selectedPrompt);
                if (index >= 0) p.groups.push(group('prompt','提示词',settings,['oai_settings','prompts',String(index)],promptFields.map(spec=>spec.name==='identifier'||builtinPrompts.has(selectedPrompt)&&['system_prompt','marker'].includes(spec.name) ? {...spec,disabled:true} : spec)));
                p.groups.push(group('format',selectedTemplate,settings,['power_user',selectedTemplate],dataFields(formatDefaults[selectedTemplate]).map(spec=>spec.kind==='text' && !['name','preset','names_behavior','activation_regex'].includes(spec.name) ? {...spec,kind:'code'} : spec)));
                p.groups.push(group('reply-format','消息与角色格式',settings,['oai_settings'],['impersonation_prompt','new_chat_prompt','new_group_chat_prompt','new_example_chat_prompt','continue_nudge_prompt','wi_format','group_nudge_prompt','scenario_format','personality_format'].map(name=>rawField(name,name,'code'))));
            } else if (key === 'WorldInfo') {
                p.resources.push(resource('world','世界书',selectedWorld,[emptyOption,...worlds.map(name=>({value:name,label:name}))]));
                p.actions.push(...actions(['world-new','新建世界书'],['world-import','导入',{accept:'.json,application/json'}],['world-export','导出'],['world-delete','删除世界书',{disabled:!worldRecord()}],['entry-add','新增条目',{disabled:!worldRecord()}],['entry-delete','删除条目',{disabled:!worldRecord()?.next.entries?.[selectedPrompt]}]));
                p.groups.push(group('global-world','全局世界书',settings,['world_info_settings','world_info'],[rawField('globalSelect','启用世界书','multiselect',{options:worlds.map(name=>({value:name,label:name}))})]));
                p.groups.push(group('world-scan','扫描与预算',settings,['world_info_settings'],worldSettingFields));
                const book = worldRecord();
                if (book) {
                    const entries = book.next.entries || {};
                    if (!Object.hasOwn(entries,selectedPrompt)) selectedPrompt = Object.keys(entries)[0] || '';
                    p.items = Object.entries(entries).map(([id,entry])=>({id,name:entry.comment || `条目 ${id}`,selected:id===selectedPrompt}));
                    if (entries[selectedPrompt]) {
                        p.groups.push(group('entry','条目',book,['entries',selectedPrompt],worldFields));
                        if(settings.next.extension_settings.EjsTemplate?.code_editor)p.groups.at(-1).actions=actions(['code-edit','代码编辑']);
                    }
                }
                const char = charRecord();
                if (char) {
                    p.groups.push(group('character-world','角色世界书',char,['data','extensions'],[rawField('world','主世界书','select',{options:[emptyOption,...worlds.map(name=>({value:name,label:name}))]})]));
                    const filename = selectedCharacter.replace(/\.[^.]+$/,'');
                    const list = settings.next.world_info_settings.world_info.charLore || [];
                    const index = list.findIndex(row=>row.name===filename);
                    const value = index < 0 ? [] : list[index].extraBooks || [];
                    const id = 'character-extra-worlds';
                    bindings.set(id,{special:'extra-books',filename});
                    p.groups.push({id:'extra-books',title:'角色附加世界书',fields:[{key:id,label:'世界书',kind:'multiselect',value,options:worlds.map(name=>({value:name,label:name}))}]});
                }
                p.groups.push(group('chat-world','当前聊天',metadata,[],[rawField('world_info','绑定世界书','select',{options:[emptyOption,...worlds.map(name=>({value:name,label:name}))]})],{disabled:!canMetadata()}));
            } else if (key === 'PersonaManagement') {
                p.resources.push(resource('persona','人设',selectedPersona,[emptyOption,...avatars.map(id=>({value:id,label:settings.next.power_user.personas?.[id] || id}))]));
                p.actions.push(...actions(['persona-upload','上传头像',{accept:'image/*'}],['persona-delete','删除人设',{disabled:!selectedPersona}],['persona-select','设为当前人设',{disabled:!selectedPersona}]));
                p.gallery = avatars.map(id=>({id,name:settings.next.power_user.personas?.[id] || id,src:`/User Avatars/${encodeURIComponent(id)}`,selected:id===selectedPersona}));
                if (selectedPersona) {
                    // Avatar filenames may contain dots: bind this exact map key rather than splitting it.
                    p.groups.push({id:'persona-name',title:'人设',fields:[bind(settings,['power_user','personas',selectedPersona],rawField('name','名称'))]});
                    p.groups.push(group('persona','描述与绑定',settings,['power_user','persona_descriptions',selectedPersona],personaFields));
                }
                p.groups.push(group('persona-behavior','人设选择',settings,['power_user'],[rawField('default_persona','默认人设','select',{options:[emptyOption,...avatars.map(id=>({value:id,label:settings.next.power_user.personas?.[id] || id}))]}),rawField('persona_auto_lock','自动锁定聊天人设','boolean'),rawField('persona_allow_multi_connections','允许多个绑定人设','boolean'),rawField('persona_show_notifications','显示人设切换提示','boolean')]));
                p.groups.push(group('persona-chat','当前聊天',metadata,[],[rawField('persona','锁定人设','select',{options:[emptyOption,...avatars.map(id=>({value:id,label:settings.next.power_user.personas?.[id] || id}))]})],{disabled:!canMetadata()}));
            } else if (key === 'Backgrounds') {
                p.actions.push(...actions(['background-upload','上传背景',{accept:'image/*'}],['background-rename','重命名'],['background-delete','删除背景']));
                p.gallery = backgrounds.map(row=>({id:row.filename,name:row.filename,src:row.isAnimated && !settings.next.background?.animation ? `/thumbnail?type=bg&file=${encodeURIComponent(row.filename)}` : `/backgrounds/${encodeURIComponent(row.filename)}`,selected:settings.next.background?.name===row.filename}));
                p.groups.push(group('background','背景',settings,['background'],[rawField('name','文件名','text',{disabled:true}),rawField('fitting','填充方式','select',{options:options(['classic','cover','contain','stretch','center'])}),rawField('animation','播放动画缩略图','boolean')]));
                p.groups.push(group('background-chat','当前聊天',metadata,[],[rawField('custom_background','聊天背景 URL'),rawField('chat_backgrounds','聊天背景列表','list')],{disabled:!canMetadata()}));
                p.groups.at(-1).actions = actions(['background-lock','将当前背景绑定聊天',{disabled:!canMetadata()}],['background-unlock','解除聊天背景',{disabled:!canMetadata()}]);
            } else if (key === 'user-settings-block') {
                p.actions.push(...actions(['appearance','外观设置']));
                p.groups.push(group('appearance','酒馆界面',settings,['power_user'],appearanceFields));
            } else if (key === 'rm_api_block') {
                p.groups.push({id:'connection',title:'前台聊天连接',fields:modelFields(),actions:actions(['models','模型设置'],['connection-reload','刷新状态'])});
            } else if (key === 'right-nav-panel') {
                p.resources.push(resource('character','角色卡',selectedCharacter,[emptyOption,...characters.map(char=>({value:char.avatar,label:char.name || char.avatar}))]));
                p.actions.push(...actions(['character-new','新建角色卡'],['character-import','导入角色卡',{accept:'.json,.png,.webp,.charx'}],['character-export','导出角色卡',{disabled:!charRecord()}],['character-duplicate','复制角色卡',{disabled:!charRecord()}],['character-delete','删除角色卡',{disabled:!charRecord()}]));
                if (charRecord()) p.groups.push(group('character','角色卡内容',charRecord(),['data'],characterFields));
            } else if (key === 'rm_extensions_block') {
                p.groups.push(group('ejs','提示词模板 EJS',settings,['extension_settings','EjsTemplate'],dataFields(ejsDefaults,ejsLabels).map(spec=>spec.name==='cache_enabled'?{...spec,kind:'select',numeric:true,options:options([{value:0,label:'禁用'},{value:1,label:'启用'},{value:2,label:'仅世界书'}])}:spec.name==='cache_hasher'?{...spec,kind:'select',options:options(['h32ToString','h64ToString'])}:spec.kind==='number'?{...spec,min:spec.name==='depth_limit'?-1:0,step:1}:spec)));
                p.groups.push(group('helper-render','酒馆助手渲染',settings,['extension_settings','tavern_helper','render'],dataFields(helperDefaults.render,renderLabels).map(spec=>spec.name==='collapse_code_block'?{...spec,kind:'select',options:options([{value:'none',label:'不折叠'},{value:'frontend_only',label:'仅前端代码'},{value:'all',label:'全部'}])}:spec)));
                p.groups.push(group('helper-script','脚本启用范围',settings,['extension_settings','tavern_helper','script','enabled'],[rawField('global','全局脚本','boolean'),rawField('presets','启用的预设','list'),rawField('characters','启用的角色','list')]));
                p.groups.push(group('helper-global','全局脚本与变量',settings,['extension_settings'],[rawField('tavern_helper.script.scripts','脚本与文件夹','json',{fallback:[]}),rawField('variables.global','全局变量','json',{fallback:{}}),rawField('regex','正则脚本','json',{fallback:[]})]));
                const preset = presetRecord('openai');
                p.resources.push(resource('extension-preset','扩展预设',selectedPresets.openai,[emptyOption,...presetOptions('openai')]));
                if (preset) p.groups.push(group('helper-preset','预设脚本与变量',preset,['extensions'],[rawField('tavern_helper.scripts','脚本与文件夹','json',{fallback:[]}),rawField('tavern_helper.variables','预设变量','json',{fallback:{}}),rawField('regex_scripts','正则脚本','json',{fallback:[]})]));
                p.resources.push(resource('character','扩展角色',selectedCharacter,[emptyOption,...characters.map(char=>({value:char.avatar,label:char.name || char.avatar}))]));
                if (charRecord()) p.groups.push(group('helper-character','角色脚本与变量',charRecord(),['data','extensions'],[rawField('tavern_helper.scripts','脚本与文件夹','json',{fallback:[]}),rawField('tavern_helper.variables','角色变量','json',{fallback:{}}),rawField('regex_scripts','正则脚本','json',{fallback:[]})]));
                p.groups.push(group('author-note','当前聊天作者注释',metadata,[],noteFields,{disabled:!canMetadata()}));
            }
        }
        if (!view) view = mountTavernEditorView(container,p); else view.update(p);
        const isDirty = dirty();
        setHeader({dirty:isDirty,working:busy,disabled:loading || busy || !isDirty,onSave:()=>void save(),onDiscard:()=>void discard()});
    }

    function edit(id, value) {
        if (!alive() || busy || loading || codeEditor) return;
        if (id.startsWith('order:')) {
            const row = promptOrder()?.order?.find(item=>item.identifier===id.slice(6));
            if (row) row.enabled = value === true;
            render(); return;
        }
        const target = bindings.get(id);
        if (!target || target.disabled || target.spec?.disabled) return;
        if (target.special === 'extra-books') {
            const info = settings.next.world_info_settings.world_info;
            info.charLore ||= [];
            const index = info.charLore.findIndex(row=>row.name===target.filename);
            if (index < 0) info.charLore.push({name:target.filename,extraBooks:value}); else info.charLore[index].extraBooks = value;
            render(); return;
        }
        const {record,path,spec} = target;
        if (record.kind==='metadata' && !canMetadata()) return;
        let parsed = value;
        errors.delete(id);
        if (spec.kind === 'json' || spec.kind === 'number') {
            textDrafts.set(id,String(value));
            try {
                if (spec.kind === 'json') {
                    parsed = JSON.parse(String(value));
                    const baseline = get(record.view,path) ?? spec.fallback ?? {};
                    if (Array.isArray(baseline) !== Array.isArray(parsed) || (!Array.isArray(parsed) && !object(parsed))) throw new Error('格式不匹配');
                    if(spec.name.endsWith('scripts') && spec.name.includes('tavern_helper') && !parsed.every(item=>object(item)&&['script','folder'].includes(item.type)&&typeof item.id==='string'&&typeof item.name==='string'&&(item.type!=='folder'||Array.isArray(item.scripts))))throw new Error('脚本格式不匹配');
                } else {
                    if (String(value).trim()==='' && spec.nullable) parsed = null;
                    else {
                        if (String(value).trim()==='' || !Number.isFinite(Number(value))) throw new Error('请输入数字');
                        parsed = Number(value);
                        if (spec.min !== undefined && parsed < spec.min || spec.max !== undefined && parsed > spec.max) throw new Error('超出范围');
                        if (typeof spec.step === 'number') {
                            const units=(parsed-(spec.min ?? 0))/spec.step;
                            if(Math.abs(units-Math.round(units))>1e-7)throw new Error('步长不匹配');
                        }
                    }
                }
            } catch { errors.set(id,spec.kind==='json' ? '请输入有效且类型匹配的 JSON。' : '请输入范围内的有效数字。'); render(); return; }
        } else if (spec.nullableBoolean) parsed = value==='null' ? null : value==='true';
        else if (spec.numeric) parsed = Number(value);
        record.next = put(record.next,path,parsed);
        render();
    }
    async function discard() {
        if (!alive() || busy || !dirty()) return;
        if (!await confirmDiscard({opener:container.ownerDocument.activeElement,owner:container}) || !alive()) return;
        for (const record of records.values()) {
            if (record.raw===undefined) {
                records.delete(record.id);
                if(record.kind==='world')worlds=worlds.filter(name=>name!==record.name);
            } else record.next=copy(record.view);
        }
        textDrafts.clear(); errors.clear(); error=''; conflict=false; render();
    }
    function clearRecordText(record) {
        for (const id of textDrafts.keys()) if (JSON.parse(id)[0]===record.id) { textDrafts.delete(id); errors.delete(id); }
    }
    function clearPathText(record,path,{splice=false}={}) {
        for(const id of [...textDrafts.keys()]) {
            const parts=JSON.parse(id);
            if(parts[0]!==record.id || !path.slice(0,-1).every((part,index)=>String(parts[index+1])===String(part)))continue;
            const offset=path.length,last=path.at(-1),selected=parts[offset];
            if(String(selected)===String(last)) {textDrafts.delete(id);errors.delete(id);}
            else if(splice && Number(selected)>Number(last)) {
                const text=textDrafts.get(id),validation=errors.get(id);textDrafts.delete(id);errors.delete(id);parts[offset]=String(Number(selected)-1);
                const next=JSON.stringify(parts);textDrafts.set(next,text);if(validation)errors.set(next,validation);
            }
        }
    }
    async function save() {
        if (!alive() || busy || loading || codeEditor) return;
        if (!container.querySelector('form')?.reportValidity() || errors.size) { error='请先修正标出的输入。'; render(); return; }
        await run(async()=>{
            for (const record of records.values()) {
                if (!changed(record)) continue;
                const changes = record.raw===undefined ? [{path:[],before:{exists:false},after:{exists:true,value:copy(record.next)}}] : documentChanges(record.raw,record.view,record.next);
                if (record.kind==='metadata') {
                    if (!canMetadata()) throw new Error('聊天已切换或尚未就绪，聊天绑定尚未保存；其他设置可继续保存。');
                    await opts.onMetadataCommit(changes);
                } else if (record.kind==='character') {
                    // The original merge endpoint retains unknown V2 extensions; it has no conditional patch contract.
                    const fresh = await request('/api/characters/get',{avatar_url:record.avatar});
                    if (!alive()) return;
                    if (!documentEqual(fresh.data,record.raw.data)) { const cause=new Error('角色卡已在另一处更新。');cause.status=409;throw cause; }
                    const update = {};
                    for (const change of changes) {
                        if (change.path[0] !== 'data') continue;
                        if (change.after.exists) put(update,change.path,change.after.value);
                    }
                    await post('/api/characters/merge-attributes',{avatar:record.avatar,...update});
                } else {
                    const url = record.kind==='settings' ? '/api/settings/save' : record.kind==='preset' ? '/api/presets/save' : '/api/worldinfo/edit';
                    await post(url,{...(record.name ? {name:record.name} : {}),...(record.apiId ? {apiId:record.apiId} : {}),vc_changes:changes});
                }
                if (!alive()) return;
                const canonical = applyDocumentValues(copy(record.raw),changes);
                record.raw=copy(canonical); record.view=copy(record.next); clearRecordText(record);
                // Advance each successful baseline before applying runtime callbacks; a later resource may fail.
                if (record.kind==='settings') await opts.onSettingsCommit?.(changes,copy(canonical));
                else if (record.kind==='preset') await opts.onPresetCommit?.(record.apiId,record.name,changes,copy(canonical));
                else if (record.kind==='world') await opts.onWorldbookCommit?.(record.name,copy(canonical));
                else if (record.kind==='character') {await opts.onCharacterSaved?.(record.avatar);const card=characters.find(card=>card.avatar===record.avatar);if(card)card.name=canonical.data.name;}
                if (!alive()) return;
            }
            notify('已保存');
        });
    }
    async function run(operation) {
        if (!alive() || busy) return;
        busy=true; error=''; conflict=false; render();
        try { await operation(); } catch(cause) { fail(cause); }
        finally { if (alive()) {busy=false;render();} }
    }
    function download(value,name) {
        if (!alive()) return;
        const blob = value instanceof Blob ? value : new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
        const url = URL.createObjectURL(blob), anchor=container.ownerDocument.createElement('a');
        anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    function askName(title, initial, complete) {
        if (!alive() || busy) return;
        const body=container.ownerDocument.createElement('form');body.className='vc-tavern-name';
        const label=container.ownerDocument.createElement('label');label.textContent='名称';
        const input=container.ownerDocument.createElement('input');input.required=true;input.value=initial || '';input.maxLength=120;label.append(input);body.append(label);
        let accepted=false;
        sheet=openSheet({title,body,owner:container,onSubmit:()=>{
            if (!alive() || !body.reportValidity()) return false;
            const name=input.value.trim();
            if (!name || /[\\/\u0000-\u001f]/.test(name)) {input.setCustomValidity('名称不能包含路径或控制字符。');input.reportValidity();return false;}
            accepted=true;queueMicrotask(()=>{if(alive())void Promise.resolve().then(()=>complete(name)).catch(fail);}); return true;
        },onDone:()=>{sheet=null;},isDirty:()=>!accepted});
        input.addEventListener('input',()=>input.setCustomValidity(''));
        body.addEventListener('submit',event=>{event.preventDefault();sheet?.done?.click();});
    }
    async function upload(url,file,extra={}) {
        const body=new FormData();body.append('avatar',file);
        for(const [name,value] of Object.entries(extra))body.append(name,value);
        const headers=new Headers(client.headers());headers.delete('Content-Type');
        const response=await fetch(url,{method:'POST',headers,body,credentials:'same-origin',signal:ac.signal});
        if(!response.ok){const cause=new Error('上传没有完成，请重试。');cause.status=response.status;throw cause;}
        return response;
    }
    async function loadCharacter(avatar, id = ticket) {
        if (!avatar || records.has(`character:${avatar}`)) return;
        const raw=await request('/api/characters/get',{avatar_url:avatar});
        if (!alive(id)) return;
        if (!object(raw.data)) throw new Error('角色卡缺少 V2 data。');
        addRecord(`character:${avatar}`,'character',raw,{}, {avatar});
    }
    async function importCharacter(file) {
        const format=file.name.split('.').at(-1).toLowerCase();
        const response=await upload('/api/characters/import',file,{file_type:format}),result=await response.json();
        if(!alive())return;
        characters=await request('/api/characters/all');if(!alive())return;
        selectedCharacter=String(result.file_name).replace(/\.png$/,'')+'.png';
        await loadCharacter(selectedCharacter);await opts.onCharacterSaved?.(selectedCharacter);
    }
    function chooseCharacterDeletion() {
        const avatar=selectedCharacter,body=container.ownerDocument.createElement('div');body.className='vc-column';
        sheet=openSheet({title:'删除角色卡',body,owner:container,onDone:()=>{sheet=null;}});
        for(const [deleteChats,label] of [[false,'仅删除角色卡'],[true,'同时删除聊天']]){
            const button=container.ownerDocument.createElement('button');button.type='button';button.className='vc-btn vc-btn-danger';button.textContent=label;
            button.addEventListener('click',async()=>{
                sheet?.dismiss();sheet=null;
                if(!alive()||!await confirmAlert({title:`${label}？`,owner:container})||!alive())return;
                await run(async()=>{
                    await opts.onDeleteCharacter(avatar,deleteChats);if(!alive())return;
                    records.delete(`character:${avatar}`);characters=characters.filter(card=>card.avatar!==avatar);selectedCharacter=characters[0]?.avatar || '';
                    await loadCharacter(selectedCharacter);
                });
            });body.append(button);
        }
    }
    async function loadWorld(name, id = ticket) {
        if (!name || records.has(`world:${name}`)) return;
        const raw=await request('/api/worldinfo/get',{name});
        if (!alive(id)) return;
        const record=addRecord(`world:${name}`,'world',parseObject(raw,'世界书'),{entries:{}},{name});
        for(const id of Object.keys(record.next.entries || {}))record.next.entries[id]=defaults(record.next.entries[id],worldEntryDefaults);
        record.view=copy(record.next);
    }
    function templateDraft(api) {
        if(api!=='openai')return settings.next.power_user[api];
        const next=copy(settings.next.oai_settings);
        delete next.preset_settings_openai;
        for(const [presetKey,settingKey] of Object.entries(openaiPresetFields)) {
            if(Object.hasOwn(next,settingKey)){next[presetKey]=next[settingKey];delete next[settingKey];}
        }
        return {...copy(presetRecord('openai')?.next),...next};
    }
    function applyPreset(api) {
        const preset=presetRecord(api);if(!preset)throw new Error('请先选择预设。');
        const data=portablePreset(preset.next);
        if(api==='openai') {
            for(const [presetKey,settingKey] of Object.entries(openaiPresetFields))if(Object.hasOwn(data,presetKey)){data[settingKey]=data[presetKey];delete data[presetKey];}
            const locked=Object.fromEntries(['custom_model','claude_model','openai_max_context','openai_max_tokens','chat_completion_source','custom_url','reverse_proxy'].filter(name=>Object.hasOwn(settings.next.oai_settings,name)).map(name=>[name,settings.next.oai_settings[name]]));
            settings.next.oai_settings={...settings.next.oai_settings,...copy(data),...locked,preset_settings_openai:preset.name};
            if(projection?.eligible) for(const [name,pinned] of Object.entries({temp_openai:'temperature',top_p_openai:'topP',reasoning_effort:'reasoningEffort'})) if(projection.pinned[pinned]!==undefined)settings.next.oai_settings[name]=projection.pinned[pinned];
        } else settings.next.power_user[api]={...settings.next.power_user[api],...copy(data),[api==='context'||api==='instruct'?'preset':'name']:preset.name};
    }
    async function act(action,value) {
        if (!alive() || busy) return;
        if(action==='save'){await save();return;}
        if(action==='reload'){if(dirty()&&!await confirmDiscard({owner:container})||!alive())return;await load();return;}
        if(action==='models'||action==='appearance') {if(await api.requestLeave()&&alive())(action==='models'?opts.onOpenModels:opts.onOpenAppearance)?.();return;}
        if(action==='select-template'){selectedTemplate=String(value);render();return;}
        if(action==='select-template-preset'){selectedPresets[selectedTemplate]=String(value);render();return;}
        if(action==='select-preset'||action==='select-extension-preset'){selectedPresets.openai=String(value);render();return;}
        if(action==='select-scope'){selectedScope=String(value);render();return;}
        if(action==='select-item'){selectedPrompt=String(value);render();return;}
        if(action==='code-edit') {
            const record=worldRecord(),uid=selectedPrompt;if(!record?.next.entries?.[uid]||codeEditor)return;
            const {openCodeEditor}=await import('./code-editor.js');if(!alive())return;
            codeEditor=openCodeEditor({owner:container,value:record.next.entries[uid].content || '',onApply:value=>{if(alive()){record.next.entries[uid].content=value;render();}},onDone:()=>{codeEditor=null;render();}});return;
        }
        if(action==='select-persona'){selectedPersona=String(value);render();return;}
        if(action==='select-image'&&key==='PersonaManagement'){selectedPersona=String(value);render();return;}
        if(action==='select-image'&&key==='Backgrounds'){settings.next.background={...settings.next.background,name:String(value),url:`url("backgrounds/${encodeURIComponent(String(value))}")`};render();return;}
        if(action==='select-world'){await run(async()=>{await loadWorld(String(value));if(alive()){selectedWorld=String(value);selectedPrompt='';}});return;}
        if(action==='select-character'){await run(async()=>{await loadCharacter(String(value));if(alive())selectedCharacter=String(value);});return;}
        if(action==='connection-reload'){await run(loadProjection);return;}
        if(action==='prompt-up'||action==='prompt-down') {
            const rows=promptOrder()?.order,index=rows?.findIndex(item=>item.identifier===value),other=index+(action==='prompt-up'?-1:1);
            if(rows&&index>=0&&other>=0&&other<rows.length)[rows[index],rows[other]]=[rows[other],rows[index]];render();return;
        }
        if(action==='prompt-add') {
            settings.next.oai_settings.prompts ||= [];
            const id=crypto.randomUUID();settings.next.oai_settings.prompts.push({identifier:id,name:'新提示词',role:'system',content:'',system_prompt:false,marker:false,injection_position:0,injection_depth:4,injection_order:100,forbid_overrides:false,injection_trigger:[]});
            for(const scope of settings.next.oai_settings.prompt_order || [])scope.order.push({identifier:id,enabled:true});selectedPrompt=id;render();return;
        }
        if(action==='prompt-delete') {
            const prompt=selectedPromptObject();if(!prompt||builtinPrompts.has(prompt.identifier))return;
            if(!await confirmAlert({title:'删除提示词？',owner:container})||!alive())return;
            clearPathText(settings,['oai_settings','prompts',String(settings.next.oai_settings.prompts.indexOf(prompt))],{splice:true});
            settings.next.oai_settings.prompts=settings.next.oai_settings.prompts.filter(item=>item.identifier!==selectedPrompt);
            for(const scope of settings.next.oai_settings.prompt_order || [])scope.order=scope.order.filter(item=>item.identifier!==selectedPrompt);
            selectedPrompt='';render();return;
        }
        if(action.startsWith('preset-')||action.startsWith('template-')) {
            const apiId=action.startsWith('preset-')?'openai':selectedTemplate,operation=action.slice(action.indexOf('-')+1);
            try {
                if(operation==='apply')applyPreset(apiId);
                else if(operation==='save') {
                    const preset=presetRecord(apiId);if(!preset)throw new Error('请先选择预设。');
                    preset.next={...preset.next,...copy(portablePreset(templateDraft(apiId)))};await save();return;
                } else if(operation==='save-as') {askName('另存预设','',name=>{
                    if(records.has(`preset:${apiId}:${name}`))throw new Error('同名预设已存在，请选择其他名称。');
                    const record=addRecord(`preset:${apiId}:${name}`,'preset',undefined,{}, {apiId,name});
                    record.next={...copy(portablePreset(templateDraft(apiId))),...(apiId==='openai'?{}:{name})};selectedPresets[apiId]=name;render();
                });return;}
                else if(operation==='export')download(portablePreset(templateDraft(apiId)),`${selectedPresets[apiId] || apiId}.json`);
                else if(operation==='import'&&value instanceof File) {
                    const imported=portablePreset(parseObject(await value.text(),'预设'));if(!alive())return;
                    askName('导入预设',value.name.replace(/\.json$/i,''),name=>{
                        if(records.has(`preset:${apiId}:${name}`))throw new Error('同名预设已存在，请选择其他名称。');
                        const record=addRecord(`preset:${apiId}:${name}`,'preset',undefined,{}, {apiId,name});record.next={...imported,...(apiId==='openai'?{}:{name})};selectedPresets[apiId]=name;render();
                    });return;
                }
                render();
            }catch(cause){fail(cause);}return;
        }
        if(action==='world-new'||action==='world-import') {
            let imported={entries:{}};
            try{
                if(value instanceof File)imported=parseObject(await value.text(),'世界书');
                if(!object(imported.entries)||!Object.values(imported.entries).every(object))throw new Error('请选择包含 entries 对象的酒馆世界书 JSON。');
            }catch(cause){fail(cause);return;}
            if(!alive())return;
            askName('世界书名称',value instanceof File?value.name.replace(/\.json$/i,''):'',name=>{
                if(worlds.includes(name))throw new Error('同名世界书已存在。');
                const record=addRecord(`world:${name}`,'world',undefined,{}, {name});record.next=copy(imported);record.next.entries ||= {};worlds.push(name);selectedWorld=name;selectedPrompt='';render();
            });return;
        }
        if(action==='world-export'){if(worldRecord())download(worldRecord().next,`${selectedWorld}.json`);return;}
        if(action==='entry-add') {
            const record=worldRecord();if(!record)return;record.next.entries ||= {};
            const ids=Object.keys(record.next.entries).map(Number).filter(Number.isFinite),id=String(ids.length?Math.max(...ids)+1:0);
            record.next.entries[id]={...copy(worldEntryDefaults),uid:Number(id),displayIndex:Object.keys(record.next.entries).length};selectedPrompt=id;render();return;
        }
        if(action==='entry-delete') {
            if(!worldRecord()?.next.entries?.[selectedPrompt]||!await confirmAlert({title:'删除条目？',owner:container})||!alive())return;
            clearPathText(worldRecord(),['entries',selectedPrompt]);
            delete worldRecord().next.entries[selectedPrompt];selectedPrompt='';render();return;
        }
        if(action==='world-delete') {
            const record=worldRecord();if(!record||!await confirmAlert({title:'删除世界书？',message:'此操作会删除世界书文件。',owner:container})||!alive())return;
            await run(async()=>{
                if(record.raw!==undefined)await post('/api/worldinfo/delete',{name:record.name});if(!alive())return;
                records.delete(record.id);worlds=worlds.filter(name=>name!==record.name);selectedWorld='';selectedPrompt='';clearRecordText(record);
                await opts.onWorldbookCommit?.(record.name,null,'delete');
            });return;
        }
        if(action==='persona-select') {
            if(!selectedPersona)return;
            const pu=settings.next.power_user,persona=defaults(pu.persona_descriptions?.[selectedPersona],personaDefaults);
            settings.next.user_avatar=selectedPersona;settings.next.username=pu.personas?.[selectedPersona] || settings.next.username;
            for(const [from,to] of Object.entries({description:'persona_description',position:'persona_description_position',depth:'persona_description_depth',role:'persona_description_role',lorebook:'persona_description_lorebook'}))pu[to]=persona[from];
            if(pu.persona_auto_lock&&canMetadata())metadata.next.persona=selectedPersona;render();return;
        }
        if(action==='persona-upload'&&value instanceof File) {
            await run(async()=>{const response=await upload('/api/avatars/upload',value),result=await response.json();if(!alive())return;
                avatars.push(result.path);selectedPersona=result.path;settings.next.power_user.personas ||= {};settings.next.power_user.persona_descriptions ||= {};
                settings.next.power_user.personas[result.path]=value.name.replace(/\.[^.]+$/,'');settings.next.power_user.persona_descriptions[result.path]=copy(personaDefaults);
            });return;
        }
        if(action==='persona-delete') {
            if(!selectedPersona||!await confirmAlert({title:'删除人设？',message:'此操作会删除头像文件。',owner:container})||!alive())return;
            await run(async()=>{await post('/api/avatars/delete',{avatar:selectedPersona});if(!alive())return;
                avatars=avatars.filter(id=>id!==selectedPersona);delete settings.next.power_user.personas?.[selectedPersona];delete settings.next.power_user.persona_descriptions?.[selectedPersona];
                if(settings.next.power_user.default_persona===selectedPersona)settings.next.power_user.default_persona=null;selectedPersona='';
            });return;
        }
        if(action==='background-lock'||action==='background-unlock') {if(canMetadata()){metadata.next=put(metadata.next,['custom_background'],action==='background-lock'?settings.next.background.url:undefined);render();}return;}
        if(action==='background-upload'&&value instanceof File) {await run(async()=>{await upload('/api/backgrounds/upload',value);if(alive()){const result=await request('/api/backgrounds/all');if(alive())backgrounds=result.images || [];}});return;}
        if(action==='background-rename') {const old=settings.next.background.name;askName('背景名称',old,name=>void run(async()=>{await post('/api/backgrounds/rename',{old_bg:old,new_bg:name});if(!alive())return;
            backgrounds=backgrounds.map(row=>row.filename===old?{...row,filename:name}:row);settings.next.background.name=name;settings.next.background.url=`url("backgrounds/${encodeURIComponent(name)}")`;
        }));return;}
        if(action==='background-delete') {
            const bg=settings.next.background.name;if(!backgrounds.some(row=>row.filename===bg)||!await confirmAlert({title:'删除背景？',owner:container})||!alive())return;
            await run(async()=>{await post('/api/backgrounds/delete',{bg});if(!alive())return;backgrounds=backgrounds.filter(row=>row.filename!==bg);settings.next.background.name='__transparent.png';settings.next.background.url='url("backgrounds/__transparent.png")';});return;
        }
        if(action==='character-export'&&charRecord()) {await run(async()=>{const response=await post('/api/characters/export',{avatar_url:selectedCharacter,format:'json'});if(alive())download(await response.blob(),`${selectedCharacter.replace(/\.[^.]+$/,'')}.json`);});return;}
        if(action==='character-new') {askName('新建角色卡','',name=>void run(()=>importCharacter(new File([JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',data:{name,description:'',personality:'',scenario:'',first_mes:'',mes_example:'',extensions:{}}})],'character.json',{type:'application/json'}))));return;}
        if(action==='character-delete'&&charRecord()&&opts.onDeleteCharacter){chooseCharacterDeletion();return;}
        if(action==='character-import'&&value instanceof File) {await run(()=>importCharacter(value));return;}
        if(action==='character-duplicate'&&charRecord()) {await run(async()=>{const result=await request('/api/characters/duplicate',{avatar_url:selectedCharacter});if(!alive())return;characters=await request('/api/characters/all');if(!alive())return;await loadCharacter(result.path);selectedCharacter=result.path;await opts.onCharacterSaved?.(selectedCharacter);});}
    }
    async function loadProjection() {
        try {const [purposes,providers]=await Promise.all([fetchModelPurposes(),fetchProviders()]);if(alive()){projection=resolveForegroundProjection(purposes,providers);projectionError='';}}
        catch(cause){if(alive()){projection=null;projectionError=cause?.message || '无法读取模型绑定。';}}
    }
    async function load() {
        if(!alive()||busy)return;
        const id=++ticket;loading=true;error='';conflict=false;settings=undefined;metadata=undefined;records.clear();textDrafts.clear();errors.clear();selectedPrompt='';selectedScope='';render();
        try {
            const next=await request('/api/settings/get');if(!alive(id))return;
            packet=next;records.clear();textDrafts.clear();errors.clear();
            const raw=parseObject(packet.settings,'设置');
            settings=addRecord('settings','settings',raw,{oai_settings:{...replyDefaults,...chatCompletionDefaultPrompts,prompt_order:[]},power_user:{...appearanceDefaults,...formatDefaults,personas:{},persona_descriptions:{},persona_auto_lock:false,persona_allow_multi_connections:false},world_info_settings:worldDefaults,extension_settings:{EjsTemplate:ejsDefaults,tavern_helper:helperDefaults},background:{name:'__transparent.png',url:'url("backgrounds/__transparent.png")',fitting:'classic',animation:false}});
            // PromptManager materializes this global scope before first use; keep it a view default until edited.
            if(Array.isArray(settings.next.oai_settings.prompt_order)&&!settings.next.oai_settings.prompt_order.length){settings.next.oai_settings.prompt_order=[{character_id:100001,order:copy(promptManagerDefaultPromptOrder)}];settings.view=copy(settings.next);}
            for(const [index,name] of (packet.openai_setting_names || []).entries())addRecord(`preset:openai:${name}`,'preset',parseObject(packet.openai_settings[index],'回复预设'),{}, {apiId:'openai',name});
            for(const apiId of ['context','instruct','sysprompt','reasoning'])for(const raw of packet[apiId] || [])if(raw?.name)addRecord(`preset:${apiId}:${raw.name}`,'preset',raw,{}, {apiId,name:raw.name});
            selectedPresets.openai=settings.next.oai_settings.preset_settings_openai || '';
            for(const apiId of ['context','instruct','sysprompt','reasoning'])selectedPresets[apiId]=settings.next.power_user[apiId]?.preset || settings.next.power_user[apiId]?.name || '';
            const ctx=context();metadataOwner=contextIdentity(ctx);metadata=addRecord('metadata','metadata',copy(ctx.chatMetadata || ctx.chat_metadata || {}),noteDefaults());
            const tasks=[];
            if(['left-nav-panel','rm_api_block'].includes(key))tasks.push(loadProjection());
            if(key==='PersonaManagement')tasks.push(request('/api/avatars/get').then(result=>{if(alive(id)){
                avatars=result;selectedPersona=settings.next.user_avatar || avatars[0] || '';
                for(const avatar of avatars)settings.next.power_user.persona_descriptions[avatar]=defaults(settings.next.power_user.persona_descriptions[avatar],personaDefaults);
                settings.view=copy(settings.next);
            }}));
            if(key==='Backgrounds')tasks.push(request('/api/backgrounds/all').then(result=>{if(alive(id))backgrounds=result.images || [];}));
            if(['right-nav-panel','WorldInfo','rm_extensions_block'].includes(key))tasks.push(request('/api/characters/all').then(async result=>{if(!alive(id))return;characters=result;selectedCharacter=currentAvatar() || (key==='right-nav-panel'?characters[0]?.avatar:'') || '';await loadCharacter(selectedCharacter);}));
            if(key==='WorldInfo')tasks.push(request('/api/worldinfo/list').then(async result=>{if(!alive(id))return;worlds=result.map(row=>row.file_id);selectedWorld=worlds[0] || '';selectedPrompt='';await loadWorld(selectedWorld);}));
            await Promise.all(tasks);
        }catch(cause){if(alive(id))fail(cause);}
        finally{if(alive(id)){loading=false;render();}}
    }
    function destroy() {if(destroyed)return;destroyed=true;++ticket;ac.abort();codeEditor?.destroy();codeEditor=null;sheet?.dismiss?.();sheet=null;view?.unmount();opts.signal?.removeEventListener('abort',destroy);}
    const api={isDirty:()=>alive()&&dirty(),working:()=>alive()&&busy,
        async requestLeave(){if(!alive())return true;if(busy)return false;if(codeEditor&&!await codeEditor.requestLeave())return false;if(!dirty())return true;return await confirmDiscard({owner:container})&&alive()&&!busy;},
        refreshContext(){if(!alive()||busy||loading||!metadata)return;const ctx=context(),identity=contextIdentity(ctx);if(identity!==metadataOwner){if(changed(metadata)){error='聊天已切换，尚未保存的聊天绑定仍保留。';}else{metadataOwner=identity;metadata=addRecord('metadata','metadata',copy(ctx.chatMetadata || ctx.chat_metadata || {}),noteDefaults());}}render();},destroy};
    opts.signal?.addEventListener('abort',destroy,{once:true});
    if(opts.signal?.aborted)destroy();else void load();
    return api;
}
