import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openVoiceChat, voiceControl, voiceShots } from './voice-accept-lib.mjs';

export async function sceneVoiceInput(ctx) {
    await voiceControl('asr');
    const {browser,page,st,card,file}=await openVoiceChat(ctx,'语音输入',{fakeAudio:true});
    let stage='recording start';
    const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message.slice(0,120)));
    const sourceErrors=[];
    page.on('response',async(response)=>{
        if(!response.url().includes('/st/sources/reconcile') || response.status()<400)return;
        let data;try{data=await response.json();}catch{data={};}
        const code=data.code || data.error?.code;
        sourceErrors.push({status:response.status(),code:typeof code==='string'&&/^[A-Z_]+$/.test(code)?code:'unclassified'});
    });
    const uploads=path.join(ctx.w05.dataRoot,'default-user','.uploads');
    const uploaded=()=>fs.existsSync(uploads)?fs.readdirSync(uploads).sort():[];
    const uploadsBefore=uploaded();
    try {
        await page.evaluate(()=>{
            const probe=window.vcRecordingProbe={};const media=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia=async(...args)=>{try{const stream=await media(...args);probe.media=true;return stream;}catch(error){probe.mediaError=error.name;throw error;}};
            const decode=AudioContext.prototype.decodeAudioData;
            AudioContext.prototype.decodeAudioData=function(...args){const result=decode.apply(this,args);result.then((buffer)=>{probe.decodedSeconds=buffer.duration;},(error)=>{probe.decodeError=error.name;});return result;};
        });
        await ctx.fixtureHttp.setOverride('vc03m-chat',{text:'听到了，我在这儿',chunks:1});
        const mic=page.locator('#vc-voice-input');await mic.waitFor({state:'visible'});
        await mic.click();
        await page.waitForFunction(()=>document.querySelector('#vc-voice-input')?.getAttribute('aria-pressed')==='true',null,{timeout:5000});
        stage='recording timer';
        await page.waitForFunction(()=>document.querySelector('#vc-voice-input-note')?.textContent.startsWith('1″'));
        await mic.click();
        stage='transcription sent';
        await page.waitForFunction(()=>SillyTavern.getContext().chat.some((row)=>row.is_user && row.extra?.vc_voice_input?.durationMs>0));
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.findLast((row)=>row.is_user).extra.vc_voice_input.emotion),'HAPPY','whitelisted emotion saved as this turn cue');
        stage='voice reply';
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.extra?.vc_voice?.status==='ready',null,{timeout:30000});
        assert.equal(await page.locator('#chat .mes[is_user="true"] .vc-voice-text').last().isVisible(),true,'user transcription expanded');
        const state=await (await fetch(`http://127.0.0.1:${process.env.VC_W03_FIXTURE_PORT}/__voice/state`)).json();
        assert.equal(state.asr.calls,1);assert.equal(state.asr.maxActive,1);assert.deepEqual(state.asr.requests[0],{sampleRate:16000,channels:1,bits:16});
        assert.deepEqual(uploaded(),uploadsBefore,'raw recording never enters native disk uploads');
        await voiceShots(page,ctx,'VO-7','voice-input');
        stage='touch cancellation';
        const before=await page.evaluate(()=>SillyTavern.getContext().chat.length);
        // Native touch events exercise hold, upward cancellation and release.
        const cdp=await page.context().newCDPSession(page);const bounds=await mic.boundingBox();const x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
        await page.waitForFunction(()=>document.querySelector('#vc-voice-input')?.getAttribute('aria-pressed')==='true');
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-100,id:1}]});
        await page.waitForFunction(()=>document.querySelector('#vc-voice-input-note')?.textContent.includes('松开取消'));
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.waitForFunction(()=>document.querySelector('#vc-voice-input')?.getAttribute('aria-pressed')==='false');
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.length),before,'cancel does not send');
        await voiceControl('asr',{status:500,failures:-1});
        stage='recognition failure';
        await mic.click();await page.waitForFunction(()=>document.querySelector('#vc-voice-input-note')?.textContent.startsWith('1″'));await mic.click();
        await page.getByText('没听清，再说一次？',{exact:true}).waitFor({state:'visible'});
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.length),before,'failed recognition does not send');
        await voiceControl('asr');

        stage='late transcription after native chat switch';
        const nextFile=`voice-switch-${crypto.randomUUID()}`;
        const nextIdentity=crypto.randomUUID();
        assert.equal((await st.call('POST','/api/chats/save',{avatar_url:card.avatar,file_name:nextFile,force:false,
            chat:[{chat_metadata:{vc_f2:{id:nextIdentity,revision:0},vc_binding:{mode:'COMPANION',displayName:'语音切换验收'}}},
                {name:card.name,is_user:false,mes:'合成切换会话。',extra:{}}]})).status,200);
        const asrRoute='**/api/plugins/virtual-companion/go/api/v1/voice/asr';
        let releaseASR,asrStarted;
        const held=new Promise(resolve=>{asrStarted=resolve;});
        const gate=new Promise(resolve=>{releaseASR=resolve;});
        await page.route(asrRoute,async route=>{asrStarted();await gate;await route.continue();});
        try {
            await page.evaluate(()=>{window.vcRecordingChatArray=SillyTavern.getContext().chat;});
            await mic.click();await page.waitForFunction(()=>document.querySelector('#vc-voice-input-note')?.textContent.startsWith('1″'));await mic.click();
            await held;
            await page.evaluate(async file=>{await (await import('/script.js')).openCharacterChat(file);},nextFile);
            assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat===window.vcRecordingChatArray),true,'native switch retains the chat array');
            assert.equal(await page.evaluate(()=>SillyTavern.getContext().chatId),nextFile);
            const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/voice/asr'));
            releaseASR();await (await response).finished();
            await page.waitForFunction(()=>document.querySelector('#vc-voice-input')?.getAttribute('aria-pressed')==='false');
            assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.some(row=>row.is_user)),false,'late transcription must not enter the new chat');
            const persisted=await st.call('POST','/api/chats/get',{avatar_url:card.avatar,file_name:nextFile});
            assert.equal(persisted.status,200);
            assert.equal(persisted.json.slice(1).some(row=>row.is_user),false,'late transcription must not persist in the new chat');
        } finally {releaseASR();await page.unroute(asrRoute);}

        stage='MB-7 H5 touch recording';
        await page.setViewportSize({width:390,height:844});
        await page.goto(`${ctx.w05.stBase}/m/?vcdebug=1`);await page.locator(`[data-chat-file="${file}"]`).click();
        await page.locator('.vc-connection').waitFor({state:'hidden'});
        const mobileMic=page.getByRole('button',{name:'开始录音',exact:true});await mobileMic.waitFor();
        const mobileCDP=await page.context().newCDPSession(page),box=await mobileMic.boundingBox(),mx=box.x+box.width/2,my=box.y+box.height/2;
        const beforeMobile=await page.evaluate(()=>globalThis.__vcEngine.messages().filter(m=>m.user).length);
        await mobileCDP.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mx,y:my,id:1}]});
        await page.getByRole('button',{name:'结束录音',exact:true}).waitFor();await page.waitForTimeout(1100);
        await mobileCDP.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.waitForFunction(before=>globalThis.__vcEngine.messages().filter(m=>m.user).length===before+1,beforeMobile);
        await page.waitForFunction(()=>globalThis.__vcEngine.messages().at(-1)?.extra?.vc_voice?.status==='ready',null,{timeout:30000});
        const latestInput=await page.evaluate(()=>globalThis.__vcEngine.messages().findLast(m=>m.user).extra.vc_voice_input);
        assert.equal(latestInput.emotion,'HAPPY');assert.ok(latestInput.durationMs>0);await page.locator('.is-user .vc-voice-text').last().waitFor();
        const mobileBeforeCancel=await page.evaluate(()=>globalThis.__vcEngine.messages().length);
        await page.getByRole('button',{name:'开始录音',exact:true}).waitFor();
        await mobileCDP.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mx,y:my,id:1}]});await page.getByRole('button',{name:'结束录音',exact:true}).waitFor();
        await mobileCDP.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mx,y:my-100,id:1}]});await page.getByText(/松开取消/).waitFor();await mobileCDP.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.getByRole('button',{name:'开始录音',exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__vcEngine.messages().length),mobileBeforeCancel);
        const mobileState=await (await fetch(`http://127.0.0.1:${process.env.VC_W03_FIXTURE_PORT}/__voice/state`)).json();assert.equal(mobileState.asr.maxActive,1);assert.ok(mobileState.asr.requests.every(r=>r.sampleRate===16000&&r.channels===1&&r.bits===16));
        assert.deepEqual(uploaded(),uploadsBefore,'H5 raw audio never enters native disk uploads');
        await voiceShots(page,ctx,'MB-7','voice-input');console.log('[MB-7] PASS H5 按住录音、上滑取消、WAV 规格和用户语音条');
    } catch(error) {
        const state=await page.evaluate(()=>{
            const c=globalThis.SillyTavern?.getContext?.() || document.querySelector('#vc-engine')?.contentWindow?.SillyTavern?.getContext?.() || {chat:[]},last=c.chat.at(-1);
            return {pressed:document.querySelector('#vc-voice-input')?.getAttribute('aria-pressed'),note:document.querySelector('#vc-voice-input-note,.vc-recording-note')?.textContent,mobilePressed:document.querySelector('.vc-microphone')?.getAttribute('aria-pressed'),probe:window.vcRecordingProbe,
                chatLength:c.chat.length,lastUser:last?.is_user,voiceSent:last?.extra?.vc_voice_attempt?.sent,voiceStatus:last?.extra?.vc_voice?.status,
                tier:last?.extra?.vc_reply_length_tier,sourcePresent:!!last?.extra?.vc_source?.id,conflictVisible:!!document.querySelector('#vc-f2-conflict[open]')};
        });
        const dir=path.resolve('.review-queue/MB-7');fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,'voice-input-failure.png')});
        throw new Error(`voice-input ${stage}: ${JSON.stringify({state,sourceErrors,pageErrors})}; ${error.message}`);
    } finally {await browser.close();await ctx.fixtureHttp.setOverride('vc03m-chat',null);}
}
export const voiceInputScene={id:'voice-input',title:'VO-7 录音、16k 重采样、情绪和语音回复',needs:['catalog','stack','fixture','browser'],default:false,run:sceneVoiceInput};
