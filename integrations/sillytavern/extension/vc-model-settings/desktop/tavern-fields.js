// Explicit metadata for supported locked ST fields. Paths are supplied by the controller.
export const options = values => values.map(value => typeof value === 'object' ? value : ({ value, label: String(value) }));
// Locked openai.js settingsToUpdate aliases; the file and live settings use different names.
export const openaiPresetFields = { temperature:'temp_openai',frequency_penalty:'freq_pen_openai',presence_penalty:'pres_pen_openai',top_p:'top_p_openai',top_k:'top_k_openai',top_a:'top_a_openai',min_p:'min_p_openai',repetition_penalty:'repetition_penalty_openai' };
const field = (name, label, kind = 'text', extra = {}) => ({ name, label, kind, ...extra });
export const replyFields = [
    field('temp_openai','温度','number',{ min: 0, max: 2, step: 0.01 }),
    field('top_p_openai','Top P','number',{ min: 0, max: 1, step: 0.01 }),
    field('top_k_openai','Top K','number',{ min: 0, step: 1 }), field('min_p_openai','Min P','number',{ min: 0, max: 1, step: 0.01 }),
    field('top_a_openai','Top A','number',{ min: 0, max: 1, step: 0.01 }),
    field('freq_pen_openai','频率惩罚','number',{ min: -2, max: 2, step: 0.01 }),
    field('pres_pen_openai','存在惩罚','number',{ min: -2, max: 2, step: 0.01 }),
    field('repetition_penalty_openai','重复惩罚','number',{ min: 0, step: 0.01 }),
    field('stream_openai','流式回复','boolean'), field('n','候选回复数','number',{ min: 1, step: 1 }),
    field('seed','随机种子','number',{ min: -1, step: 1 }), field('reasoning_effort','推理等级'),
    field('verbosity','详细程度','select',{ options: options(['auto','low','medium','high']) }),
    field('show_thoughts','显示推理','boolean'), field('continue_prefill','续写预填','boolean'),
    field('continue_postfix','续写后缀','select',{ options: options([{value:'',label:'无'},{value:' ',label:'空格'},{value:'\n',label:'换行'},{value:'\n\n',label:'双换行'}]) }),
    field('assistant_prefill','助手预填','textarea'), field('assistant_impersonation','扮演预填','textarea'),
    field('send_if_empty','空消息内容','textarea'), field('function_calling','工具调用','boolean'),
    field('tool_call_recurse_limit','工具递归上限','number',{ min: 0, step: 1 }),
    field('tool_reasoning_mode','工具推理','select',{ options: options(['disabled','since_last_user','active_chain']) }),
    field('squash_system_messages','合并系统消息','boolean'), field('media_inlining','内联媒体','boolean'),
    field('inline_image_quality','图片质量','select',{ options: options(['auto','low','high']) }),
    field('enable_web_search','网页搜索','boolean'), field('request_images','请求图片','boolean'),
    field('request_image_aspect_ratio','图片比例'), field('request_image_resolution','图片分辨率'),
    field('names_behavior','角色名称处理','number',{ step: 1 }), field('custom_prompt_post_processing','提示词后处理'),
];
export const promptFields = [field('name','名称'), field('role','角色','select',{options:options(['system','user','assistant'])}),
    field('content','提示词','code'), field('identifier','标识符'), field('system_prompt','系统提示词','boolean'),
    field('marker','占位标记','boolean'), field('injection_position','注入位置','number',{step:1}),
    field('injection_depth','注入深度','number',{min:0,step:1}), field('injection_order','注入顺序','number',{step:1}),
    field('injection_trigger','生成触发器','list'), field('forbid_overrides','禁止角色覆盖','boolean')];
export const worldFields = [
    field('comment','名称'), field('content','内容','code'), field('key','关键词','list'), field('keysecondary','辅助关键词','list'),
    ...['constant','vectorized','selective','addMemo','disable','ignoreBudget','excludeRecursion','preventRecursion','matchPersonaDescription','matchCharacterDescription','matchCharacterPersonality','matchCharacterDepthPrompt','matchScenario','matchCreatorNotes','useProbability','groupOverride'].map((name,i)=>field(name,['始终激活','向量匹配','辅助关键词过滤','添加备注','停用','忽略预算','排除递归','阻止递归','匹配人设描述','匹配角色描述','匹配角色性格','匹配角色深度提示','匹配场景','匹配作者注释','启用概率','覆盖分组'][i],'boolean')),
    ...['selectiveLogic','order','position','delayUntilRecursion','probability','depth','groupWeight','role'].map((name,i)=>field(name,['过滤逻辑','顺序','插入位置','延迟至递归层','触发概率','深度','分组权重','角色'][i],'number',{step:1})),
    ...['scanDepth','sticky','cooldown','delay'].map((name,i)=>field(name,['扫描深度（空值继承）','持续轮数','冷却轮数','延迟轮数'][i],'number',{nullable:true,min:0,step:1})),
    ...['caseSensitive','matchWholeWords','useGroupScoring'].map((name,i)=>field(name,['区分大小写','匹配完整词','分组评分'][i],'select',{nullableBoolean:true, options:options([{value:'null',label:'继承'},{value:'true',label:'启用'},{value:'false',label:'停用'}])})),
    field('outletName','出口'),field('group','分组'),field('automationId','自动化标识'),field('triggers','生成触发器','list'),
    field('characterFilter','角色与标签过滤','json',{fallback:{isExclude:false,names:[],tags:[]}}),
];
export const worldSettingFields = [
    ...['world_info_depth','world_info_min_activations','world_info_min_activations_depth_max','world_info_budget','world_info_character_strategy','world_info_budget_cap','world_info_max_recursion_steps'].map((name,i)=>field(name,['扫描深度','最少激活条目','最大扫描深度','上下文预算 %','角色书插入策略','预算上限','递归步数上限'][i],'number',{min:0,step:1})),
    ...['world_info_include_names','world_info_recursive','world_info_overflow_alert','world_info_case_sensitive','world_info_match_whole_words','world_info_use_group_scoring'].map((name,i)=>field(name,['包括名称','递归扫描','预算溢出提醒','区分大小写','匹配完整词','分组评分'][i],'boolean')),
];
export const personaFields = [field('description','描述','code'),field('position','插入位置','number',{step:1}),field('depth','深度','number',{min:0,step:1}),field('role','角色','number',{step:1}),field('lorebook','世界书'),field('title','标题'),field('connections','角色与群组绑定','json',{fallback:[]})];
export const appearanceFields = [field('font_scale','字号缩放','number',{min:0.5,max:2,step:0.05}),field('chat_width','聊天宽度','number',{min:1,max:100,step:1}),field('blur_strength','模糊强度','number',{min:0,step:1}),field('avatar_style','头像样式','select',{numeric:true,options:options([{value:0,label:'圆形'},{value:1,label:'矩形'},{value:2,label:'方形'},{value:3,label:'圆角'}])}),
    ...['hideChatAvatars_enabled','timestamps_enabled','timestamp_model_icon','timer_enabled','mesIDDisplay_enabled','message_token_count_enabled','allow_name1_display','allow_name2_display','auto_scroll_chat_to_bottom','smooth_streaming','reduced_motion','compact_input_area','confirm_message_delete','auto_save_msg_edits','auto_fix_generated_markdown','trim_spaces','enable_md_hotkeys'].map((name,i)=>field(name,['隐藏聊天头像','时间戳','模型图标','生成用时','消息编号','Token 数量','显示用户名称','显示角色名称','自动滚动','平滑流式','减弱动态','紧凑输入区','删除消息前确认','自动保存消息编辑','修正 Markdown','清理空格','Markdown 快捷键'][i],'boolean')),
    field('smooth_streaming_speed','流式速度','number',{min:0,max:100,step:1}),field('smooth_streaming_no_think','推理立即显示','boolean'),
    field('send_on_enter','回车发送','select',{numeric:true,options:options([{value:-1,label:'关闭'},{value:0,label:'自动'},{value:1,label:'开启'}])}),field('custom_css','自定义 CSS','code')];
export const characterFields = [field('name','名称','text',{required:true}),field('description','描述','code'),field('personality','性格','textarea'),field('scenario','场景','textarea'),field('first_mes','开场白','code'),field('mes_example','对话示例','code'),field('system_prompt','系统提示词','code'),field('post_history_instructions','历史后提示词','code'),field('alternate_greetings','备选开场白','list'),field('creator_notes','作者注释','code'),field('creator','作者'),field('character_version','版本'),field('tags','标签','list'),field('extensions.world','主世界书'),field('extensions.depth_prompt.prompt','深度提示词','code'),field('extensions.depth_prompt.depth','提示词深度','number',{min:0,step:1}),field('extensions.depth_prompt.role','提示词角色','text'),field('extensions.talkativeness','健谈度','number',{min:0,max:1,step:0.01}),field('extensions.fav','收藏','boolean')];
export const noteFields = [field('note_prompt','作者注释','code'),field('note_interval','插入间隔','number',{min:0,step:1}),field('note_depth','注入深度','number',{min:0,step:1}),field('note_position','注入位置','number',{min:0,step:1}),field('note_role','注入角色','number',{min:0,step:1})];
export function dataFields(defaults, labels = {}) { return Object.entries(defaults).map(([name,value])=>field(name,labels[name] || name,typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'text')); }
export const ejsLabels={enabled:'启用扩展',generate_enabled:'生成时执行 EJS',generate_loader_enabled:'生成前后注入',render_enabled:'渲染楼层时执行 EJS',render_loader_enabled:'渲染前后注入',with_context_disabled:'禁用 with 语句块',debug_enabled:'控制台详细信息',autosave_enabled:'自动保存变量更新',preload_worldinfo_enabled:'提前加载世界书 EJS',code_blocks_enabled:'处理代码块',raw_message_evaluation_enabled:'先处理原始内容',filter_message_enabled:'生成时过滤楼层模板',cache_enabled:'编译缓存',cache_size:'缓存数量',cache_hasher:'缓存函数',inject_loader_enabled:'@INJECT 注入',invert_enabled:'旧条目兼容模式',depth_limit:'楼层处理最大深度',compile_workers:'后台编译',sandbox:'环境隔离',code_editor:'世界书代码编辑器',preload_only:'世界书仅预加载'};
export const renderLabels={enabled:'HTML 渲染',collapse_code_block:'折叠代码块',allow_streaming:'流式渲染',use_blob_url:'使用 Blob 地址',use_cleanup_protector:'脚本清理保护',optimize_hljs:'优化代码高亮',depth:'渲染深度',depth_ignore_hidden:'忽略隐藏楼层'};
