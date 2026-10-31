// 合成样板数据；不读取部署配置、真实账户或现有选择记录。
export const voiceSettings={revision:1,kokoroEnabled:true,cosyVoiceEnabled:true,asrEnabled:true,kokoroTimeoutSeconds:60,cosyVoiceTimeoutSeconds:300,asrTimeoutSeconds:30,dailyChatLimit:60,dailyProactiveLimit:8,maxRecordingSeconds:60,voiceFrequency:'STANDARD',cosyVoiceInstructions:{morning:'自然、轻松地说早安。',night:'放轻声音，像熟悉的朋友。',care:'温和一点，认真听对方说话。',share:'像聊天一样分享生活。',default:'用自然、清楚的语气说话。'},proactiveVoiceRates:{morning:.3,night:.6,care:.4,share:.2,default:.3},kokoroMoodSpeeds:{开心:1.05,黏人:.95,好奇:1.05,得意:1.05,懒洋洋:.9,有点累:.9,想独处:.95,有点烦:1,困:.85}};
export const engines={tts:[{engine:'kokoro',configured:true,enabled:true,healthy:true,voices:[{id:'zf_001',name:'温和女声',gender:'FEMALE'},{id:'zm_010',name:'自然男声',gender:'MALE'}]},{engine:'cosyvoice',configured:true,enabled:true,healthy:true,voices:[{id:'default',name:'默认',gender:'FEMALE'}]}],asr:{configured:true,enabled:true,healthy:true}};
export const relationship={relationshipId:'11',companionName:'小满 · 日常',gender:'FEMALE',speed:1.1,kokoroVoice:'zf_001',cosyVoice:null,voiceFrequency:null,proactiveEngine:'kokoro',proactiveVoice:true};
const model={profileKey:'chat',modelId:'synthetic-chat',displayName:'日常聊天',contextWindowTokens:32768,maxOutputTokens:2048,state:'ENABLED',reasoningLevels:['low','medium','high'],generationParams:{temperature:.7,topP:.9,reasoningEffort:'medium'},capabilities:{imageInput:'DECLARED',videoInput:'UNKNOWN',pdfInput:'DECLARED',structuredOutput:'DECLARED',toolCalls:'VERIFIED',nativeWebSearch:'UNKNOWN',systemMessage:'DECLARED',temperature:'DECLARED',topP:'DECLARED'},pricing:{currency:'CNY',inputPerMillionTokens:1.2,outputPerMillionTokens:4.8},ledgerPrice:'ACTIVE',boundPurposes:['FOREGROUND_CHAT','BACKGROUND_GREETINGS']};
export const providers=[{providerId:'synthetic-primary',displayName:'日常模型服务',protocol:'OPENAI_CHAT_COMPLETIONS',baseUrl:'https://api.example.test/v1',endpointUrl:'https://api.example.test/v1/chat/completions',state:'ENABLED',revision:1,credentialConfigured:true,models:[model]},{providerId:'synthetic-secondary',displayName:'备用模型服务',protocol:'OPENAI_RESPONSES',baseUrl:'https://backup.example.test/v1',endpointUrl:'https://backup.example.test/v1/responses',state:'DISABLED',revision:1,credentialConfigured:false,models:[{...structuredClone(model),profileKey:'backup',modelId:'synthetic-backup',displayName:'备用配置',boundPurposes:[]}]}];
export const purposes=['FOREGROUND_CHAT','MEMORY_EXTRACTION_DEDUP_SUMMARY','BACKGROUND_GREETINGS','STORY_DIRECTOR','NPC_DIALOGUE','EMBEDDING'].map(purpose=>({purpose,providerId:purpose==='EMBEDDING'?null:'synthetic-primary',profileKey:purpose==='EMBEDDING'?null:'chat',state:purpose==='EMBEDDING'?'DISABLED':'ENABLED',revision:1,status:purpose==='EMBEDDING'?'PENDING_CONFIGURATION':'READY'}));
export const previewRelationships=[
 {...relationship,personaRef:'st-character',characterRef:'synthetic-xiaoman',mode:'COMPANION',displayName:'日常',companionName:'小满 · 日常',remindersAllowed:true,avoidTopics:[]},
 {...relationship,relationshipId:'12',personaRef:'st-character',characterRef:'synthetic-linzhou',mode:'COMPANION',displayName:'散步',companionName:'林舟 · 散步',remindersAllowed:true,avoidTopics:[]},
];
export const previewMemories=['喜欢桂花乌龙，不加糖','周末喜欢睡到自然醒','傍晚喜欢沿湖散步','喜欢拍照，尤其是傍晚的光','不喜欢香菜','晚上更喜欢语音聊天'].map((summary,i)=>({memoryId:String(101+i),relationshipId:'11',mode:'COMPANION',summary,lifecycle:'ACTIVE',sourceStatus:i===3?'PENDING_VERIFICATION':'VALID',type:'PREFERENCE',version:1,time:{eventDate:'2026-10-'+String(28-i).padStart(2,'0')},createdAt:'2026-11-01T08:00:00+08:00'}));
export const previewPrompts={vc_long_term_memory:{value:previewMemories.slice(0,3).map(row=>row.summary).join('\n')}};
export const previewFollowUps=[{followUpId:'201',relationshipId:'11',status:'SCHEDULED',eventId:'synthetic-follow',body:'一起去看展',eventDate:'2026-11-02',eventTime:'10:00',triggerAt:'2026-11-02T10:00:00+08:00'}];
export const previewInbox=[{eventId:'synthetic-greeting',relationshipId:'11',intent:'GREETING',body:'早呀，今天降温了，出门记得带围巾',createdAt:'2026-11-01T08:02:00+08:00',linkStatus:'present',stDelivered:true}];
export const previewPolicy={relationshipId:'11',enabled:true,mode:'DAILY',checkInAfterMinutes:120,quietHoursStart:'23:00',quietHoursEnd:'07:30',quietHoursTimezone:'Asia/Shanghai',dailyLimit:4,recentInteractionMinutes:120,allowedModes:['COMPANION'],offlineCapable:true};
const storyPeople=[{actorId:'player',name:'调查者',role:'player',scene:'lobby'},...['林岚','周澈','苏禾'].map((name,i)=>({actorId:['lin','zhou','su'][i],name,role:'npc',scene:'lobby',publicPersona:'旅馆的客人'}))];
export const previewRun={conversationId:'21',runId:'31',branchId:'41',caseId:'rainy-inn-v1',worldVersion:1,stage:'investigation',participants:storyPeople};
export const previewStoryView={conversationId:'21',runId:'31',branchId:'41',actorId:'player',worldVersion:1,publicLore:{setting:'雨夜，小旅馆的一枚展柜怀表失踪。玩家受邀调查。',locations:['lobby','kitchen','workshop'],knownEvent:'20:20 老板发现怀表不见了。'},knowledge:[{id:'empty-case',fact:'大堂展柜是空的'}],events:[{eventId:'301',worldVersion:1,body:{clueName:'钥匙借用记录',text:'林岚出示了借用记录',phase:'investigation'}}],participants:storyPeople.filter(p=>p.actorId!=='player')};
export function installSyntheticAPI(){
 const originalFetch=window.fetch.bind(window);window.__previewRequests=[];
 window.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.origin!==location.origin)throw new Error('样板仅允许本机资源');
  if(!url.pathname.startsWith('/api/'))return originalFetch(input,init);
  const path=url.pathname.replace('/api/plugins/virtual-companion/go',''),method=init.method||'GET';
  const params=new URLSearchParams(location.search),view=params.get('view'),scenario=params.get('state')||'ready';
  const contentView=['characters','memory','inbox','story','chat'].includes(view);
  if(scenario==='loading'&&!path.includes('/auth/'))return new Promise(()=>{});
  if(scenario==='error'&&!path.includes('/auth/'))return new Response(JSON.stringify({code:'SYNTHETIC_FAILURE',message:'没有完成，请重试。'}),{status:503,headers:{'Content-Type':'application/json'}});

  window.__previewRequests.push({path,method});if(window.VC_PREVIEW_DELAY && method!=='GET')await new Promise(resolve=>setTimeout(resolve,window.VC_PREVIEW_DELAY));let data;
  if(path.endsWith('/auth/session'))data={accountId:'1',sessionId:'42',role:'ADMIN',username:'合成验收用户',nextStep:'ACTIVE',authenticatorEnabled:true,passwordMustChange:false};
  else if(path.endsWith('/auth/reauth'))data={ok:true};
  else if(path.endsWith('/voice/settings')){if(method==='PUT'){Object.assign(voiceSettings,JSON.parse(init.body),{revision:voiceSettings.revision+1});delete voiceSettings.expectedRevision;}data=voiceSettings;}
  else if(path.endsWith('/voice/engines'))data=engines;
  else if(path.endsWith('/st/bindings')&&method==='POST'){const body=JSON.parse(init.body),id=String(Math.max(...previewRelationships.map(row=>Number(row.relationshipId)))+1);previewRelationships.push({...relationship,...body,relationshipId:id,personaRef:'st-character',companionName:body.displayName});data={relationshipId:id,conversationId:String(300+Number(id))};}
  else if(path.endsWith('/relationships'))data=contentView?(scenario==='empty'?[]:previewRelationships):[relationship];
  else if(/\/relationships\/\d+$/.test(path)&&method==='PATCH'){data=contentView?previewRelationships.find(row=>row.relationshipId===path.split('/').at(-1)):relationship;Object.assign(data,JSON.parse(init.body));}
  else if(path.endsWith('/proactive-policy')){if(method==='PUT')Object.assign(previewPolicy,JSON.parse(init.body));data=previewPolicy;}
  else if(path.endsWith('/companion-state'))data={mood:{vibe:'好奇'}};
  else if(path.endsWith('/follow-ups'))data=scenario==='empty'?[]:previewFollowUps;
  else if(path.includes('/follow-ups/')&&path.endsWith('/cancel')){data=previewFollowUps[0];data.status='CANCELLED';}
  else if(/\/relationships\/\d+\/memories$/.test(path))data=scenario==='empty'?[]:previewMemories.map(row=>scenario==='long'?{...row,summary:row.summary.repeat(20)}:row);
  else if(path.endsWith('/evidence'))data=[];
  else if(/\/memories\/\d+$/.test(path)){data=previewMemories.find(row=>row.memoryId===path.split('/').at(-1));if(method==='PATCH')Object.assign(data,JSON.parse(init.body),{version:data.version+1});if(method==='DELETE')Object.assign(data,{lifecycle:'FORGOTTEN'});}
  else if(path.endsWith('/st/memory/recall'))data={items:previewMemories.slice(0,3),memories:previewMemories.slice(0,3)};
  else if(path.endsWith('/notification-channels')||path.endsWith('/notification-deliveries')||path.endsWith('/auth/sessions')||path.endsWith('/auth/trusted-devices')||path.endsWith('/consents'))data=[];
  else if(path.endsWith('/voice/usage'))data={storageBytes:0};
  else if(path.endsWith('/story/runs'))data=previewRun;
  else if(path.includes('/actors/player/view'))data=previewStoryView;
  else if(path.endsWith('/projections'))data=[];
  else if(path.endsWith('/rewind'))data={branchId:'42',worldVersion:0,stage:'investigation'};

  else if(path.endsWith('/inbox'))data=contentView&&scenario!=='empty'?previewInbox:[];
  else if(path.endsWith('/admin/providers')&&method==='GET')data=scenario==='empty'?[]:scenario==='long'?providers.map(row=>({...row,displayName:row.displayName.repeat(8),models:row.models.map(model=>({...model,displayName:model.displayName.repeat(8)}))})):providers;
  else if(path.endsWith('/admin/model-purposes')&&method==='GET')data=scenario==='empty'?purposes.map(row=>({...row,providerId:null,profileKey:null,status:'PENDING_CONFIGURATION'})):purposes;
  else if(path.endsWith('/admin/usage'))data=[];
  else if(path.endsWith('/admin/local-models'))data={embedding:{configured:true,enabled:true,healthy:true},rerank:{configured:true,enabled:true,healthy:true,revision:1}};
  else if(path.endsWith('/admin/local-models/rerank'))data={configured:true,enabled:true,healthy:true,revision:2};
  else if(path.includes('/discover'))data=[{modelId:'synthetic-chat',displayName:'日常聊天'},{modelId:'synthetic-vision',displayName:'图像对话'}];
  else if(path.includes('/admin/providers/')&&['PUT','POST'].includes(method)){
   const id=decodeURIComponent(path.split('/admin/providers/')[1].split('/')[0]);const body=JSON.parse(init.body||'{}');let provider=providers.find(p=>p.providerId===id);
   if(!provider){provider={providerId:id,models:[],revision:0};providers.push(provider)}
   Object.assign(provider,body,{revision:provider.revision+1});delete provider.expectedRevision;delete provider.credential;data=provider;
  }else if(path.includes('/admin/model-purposes/')&&method==='PUT'){
   const purpose=decodeURIComponent(path.split('/').at(-1)),body=JSON.parse(init.body||'{}'),row=purposes.find(p=>p.purpose===purpose);Object.assign(row,body,{revision:row.revision+1});delete row.expectedRevision;data=row;
  }else return new Response(JSON.stringify({code:'PREVIEW_UNAVAILABLE',message:'此动作仅展示样式。'}),{status:409,headers:{'Content-Type':'application/json'}});
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 };
}

// 真实宿主选择器；只有合成消息，不从当前会话取数据。
export function installHostFixture(doc = document) {
 const sheld=doc.createElement('div');sheld.id='sheld';
 sheld.innerHTML='<div id="chat">'+Array.from({length:24},(_,i)=>`<div class="mes" is_user="${i%2===0}"><div class="mesAvatarWrapper"><div class="avatar"></div></div><div class="mes_block"><div class="ch_name"><span class="name_text">${i%2===0?'你':'小满'}</span></div><div class="mes_text">${i%2===0?'今天想去湖边走走':'等你忙完，我们一起去'}</div></div></div>`).join('')+'</div><form id="send_form"><button type="button" id="options_button" aria-label="更多">+</button><textarea id="send_textarea" aria-label="消息" placeholder="发消息…"></textarea><button type="button" id="vc-voice-input" aria-label="语音输入"></button><button type="button" id="send_but" aria-label="发送"></button></form>';
 // 桌面加载真实 chat-view.js 后由生产模块绘制图标；手机旧 fixture 与原基线保持相同。
 if(innerWidth>=744&&new URLSearchParams(location.search).get('baseline')!=='1'){
  sheld.querySelector('#options_button').replaceChildren();
  sheld.querySelector('#vc-voice-input').remove();
 }
 const state=new URLSearchParams(location.search).get('state');
 if(state==='empty')sheld.querySelector('#chat').replaceChildren();
 if(state==='long')for(const text of sheld.querySelectorAll('.mes_text'))text.textContent=text.textContent.repeat(24);
 doc.body.append(sheld);return sheld;
}

export function installDrawerFixtures(doc=document){
 const host=doc.createElement('div');host.id='top-settings-holder';
 for(const [id,panel,label] of [['ai-config-button','left-nav-panel','AI 回复配置'],['advanced-formatting-button','AdvancedFormatting','提示词格式'],['WI-SP-button','WorldInfo','世界书'],['extensions-settings-button','rm_extensions_block','扩展'],['persona-management-button','PersonaManagement','人设'],['backgrounds-button','Backgrounds','背景'],['user-settings-button','user-settings-block','界面'],['sys-settings-button','rm_api_block','API 连接'],['rightNavHolder','right-nav-panel','角色卡']]){
  const drawer=doc.createElement('div');drawer.className='drawer';drawer.id=id;
  const toggle=doc.createElement('button');toggle.type='button';toggle.className='drawer-toggle';toggle.setAttribute('aria-label',label);
  const content=doc.createElement('div');content.id=panel;content.className='drawer-content closedDrawer';content.hidden=true;
  content.innerHTML='<label class="vc-cell">'+label+'<input value="合成设置"></label>';
  toggle.addEventListener('click',()=>{content.hidden=!content.hidden;content.classList.toggle('openDrawer',!content.hidden);content.classList.toggle('closedDrawer',content.hidden);});
  drawer.append(toggle,content);host.append(drawer);
 }
 doc.body.append(host);return host;
}
