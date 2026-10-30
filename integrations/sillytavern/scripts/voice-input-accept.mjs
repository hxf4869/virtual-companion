import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openVoiceChat, voiceControl, voiceShots } from './voice-accept-lib.mjs';

export async function sceneVoiceInput(ctx) {
    await voiceControl('asr');
    const {browser,page}=await openVoiceChat(ctx,'语音输入',{fakeAudio:true});
    let stage='recording start';
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
    } catch(error) {
        const state=await page.evaluate(()=>({pressed:document.querySelector('#vc-voice-input')?.getAttribute('aria-pressed'),note:document.querySelector('#vc-voice-input-note')?.textContent,probe:window.vcRecordingProbe}));
        throw new Error(`voice-input ${stage}: ${JSON.stringify(state)}; ${error.message}`);
    } finally {await browser.close();await ctx.fixtureHttp.setOverride('vc03m-chat',null);}
}
export const voiceInputScene={id:'voice-input',title:'VO-7 录音、16k 重采样、情绪和语音回复',needs:['catalog','stack','fixture','browser'],default:false,run:sceneVoiceInput};
