// 合成样板数据；不读取部署配置、真实账户或现有选择记录。
export const voiceSettings={revision:1,kokoroEnabled:true,cosyVoiceEnabled:true,asrEnabled:true,kokoroTimeoutSeconds:60,cosyVoiceTimeoutSeconds:300,asrTimeoutSeconds:30,dailyChatLimit:60,dailyProactiveLimit:8,maxRecordingSeconds:60,voiceFrequency:'STANDARD',cosyVoiceInstructions:{morning:'自然、轻松地说早安。',night:'放轻声音，像熟悉的朋友。',care:'温和一点，认真听对方说话。',share:'像聊天一样分享生活。',default:'用自然、清楚的语气说话。'},proactiveVoiceRates:{morning:.3,night:.6,care:.4,share:.2,default:.3},kokoroMoodSpeeds:{开心:1.05,黏人:.95,好奇:1.05,得意:1.05,懒洋洋:.9,有点累:.9,想独处:.95,有点烦:1,困:.85}};
export const engines={tts:[{engine:'kokoro',configured:true,enabled:true,healthy:true,voices:[{id:'zf_001',name:'温和女声',gender:'FEMALE'},{id:'zm_010',name:'自然男声',gender:'MALE'}]},{engine:'cosyvoice',configured:true,enabled:true,healthy:true,voices:[{id:'default',name:'默认',gender:'FEMALE'}]}],asr:{configured:true,enabled:true,healthy:true}};
export const relationship={relationshipId:'11',companionName:'小满 · 日常',gender:'FEMALE',speed:1.1,kokoroVoice:'zf_001',cosyVoice:null,voiceFrequency:null,proactiveEngine:'kokoro',proactiveVoice:true};
const model={profileKey:'chat',modelId:'synthetic-chat',displayName:'日常聊天',contextWindowTokens:32768,maxOutputTokens:2048,state:'ENABLED',reasoningLevels:['low','medium','high'],generationParams:{temperature:.7,topP:.9,reasoningEffort:'medium'},capabilities:{imageInput:'DECLARED',videoInput:'UNKNOWN',pdfInput:'DECLARED',structuredOutput:'DECLARED',toolCalls:'VERIFIED',nativeWebSearch:'UNKNOWN',systemMessage:'DECLARED',temperature:'DECLARED',topP:'DECLARED'},pricing:{currency:'CNY',inputPerMillionTokens:1.2,outputPerMillionTokens:4.8},ledgerPrice:'ACTIVE',boundPurposes:['FOREGROUND_CHAT','BACKGROUND_GREETINGS']};
export const providers=[{providerId:'synthetic-primary',displayName:'日常模型服务',protocol:'OPENAI_CHAT_COMPLETIONS',baseUrl:'https://api.example.test/v1',endpointUrl:'https://api.example.test/v1/chat/completions',state:'ENABLED',revision:1,credentialConfigured:true,models:[model]},{providerId:'synthetic-secondary',displayName:'备用模型服务',protocol:'OPENAI_RESPONSES',baseUrl:'https://backup.example.test/v1',endpointUrl:'https://backup.example.test/v1/responses',state:'DISABLED',revision:1,credentialConfigured:false,models:[{...structuredClone(model),profileKey:'backup',modelId:'synthetic-backup',displayName:'备用配置',boundPurposes:[]}]}];
export const purposes=['FOREGROUND_CHAT','MEMORY_EXTRACTION_DEDUP_SUMMARY','BACKGROUND_GREETINGS','STORY_DIRECTOR','NPC_DIALOGUE','EMBEDDING'].map(purpose=>({purpose,providerId:purpose==='EMBEDDING'?null:'synthetic-primary',profileKey:purpose==='EMBEDDING'?null:'chat',state:purpose==='EMBEDDING'?'DISABLED':'ENABLED',revision:1,status:purpose==='EMBEDDING'?'PENDING_CONFIGURATION':'READY'}));
export function installSyntheticAPI(){
 const originalFetch=window.fetch.bind(window);window.__previewRequests=[];
 window.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.origin!==location.origin)throw new Error('样板仅允许本机资源');
  if(!url.pathname.startsWith('/api/'))return originalFetch(input,init);
  const path=url.pathname.replace('/api/plugins/virtual-companion/go',''),method=init.method||'GET';
  window.__previewRequests.push({path,method});let data;
  if(path.endsWith('/auth/session'))data={accountId:'1',sessionId:'42',role:'ADMIN',username:'合成验收用户',nextStep:'ACTIVE',authenticatorEnabled:true,passwordMustChange:false};
  else if(path.endsWith('/auth/reauth'))data={ok:true};
  else if(path.endsWith('/admin/providers')&&method==='GET')data=providers;
  else if(path.endsWith('/admin/model-purposes')&&method==='GET')data=purposes;
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
