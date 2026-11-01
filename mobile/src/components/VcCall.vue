<template>
 <div class="vc-call" role="dialog" aria-modal="true" aria-label="语音通话" tabindex="-1" @keydown.esc.stop.prevent="close" @keydown.tab.prevent="focusNext">
  <VcAurora />
  <view class="vc-call-content">
   <view class="vc-call-person">
    <view class="vc-call-ring" :class="{'is-speaking':call.phase==='speaking'}" :style="{transform:`scale(${1+call.level*.12})`}"><VcAvatar :avatar="avatar" :name="name" size="var(--vc-avatar-call)" /></view>
    <text class="vc-call-name">{{ name }}</text><text class="vc-call-time">{{ duration }}</text><text class="vc-call-status" role="status">{{ call.error || status }}</text>
   </view>
   <view v-if="captions || call.textRequired" class="vc-call-captions" aria-live="polite"><text class="vc-call-previous">{{ call.previous }}</text><text class="vc-call-current">{{ call.current }}</text></view>
   <view class="vc-call-controls">
    <button v-if="call.needsPlay" role="button" tabindex="0" class="vc-plain-btn" @click="controller.retryPlay()">继续播放</button>
    <button v-if="call.phase==='error'" role="button" tabindex="0" class="vc-plain-btn" :disabled="closing" @click="retry">重试</button>
    <view class="vc-call-options">
     <view class="vc-call-option"><button role="button" tabindex="0" class="vc-call-action vc-glass" :aria-label="call.muted?'取消静音':'静音'" :aria-pressed="call.muted" :disabled="closing||call.phase==='error'||call.phase==='connecting'" @click="controller.setMuted(!call.muted)"><VcIcon :name="call.muted?'mic-off':'mic'" size="var(--vc-icon-xl)" /></button><text>{{ call.muted?'取消静音':'静音' }}</text></view>
     <view class="vc-call-option"><button role="button" tabindex="0" class="vc-call-action vc-glass" aria-label="字幕" :aria-pressed="captions" @click="captions=!captions"><VcIcon name="text-cursor" size="var(--vc-icon-xl)" /></button><text>字幕</text></view>
    </view>
    <button role="button" tabindex="0" class="vc-call-hangup" aria-label="挂断" :disabled="closing" :aria-disabled="closing" @click="close"><VcIcon name="phone-off" size="var(--vc-icon-xl)" /></button>
   </view>
  </view>
 </div>
</template>
<script>
import VcAurora from './VcAurora.vue';import VcAvatar from './VcAvatar.vue';import VcIcon from './VcIcon.vue';
import {createCallSession} from '../voice/call.mjs';import {getEngine,engineState} from '../engine/index.mjs';import {CALL_COPY} from '../copy.mjs';
export default {
 components:{VcAurora,VcAvatar,VcIcon},props:{name:String,avatar:String,chat:Object,session:Object,maxSeconds:Number},emits:['close'],
 data:()=>({call:{phase:'connecting',elapsed:0,level:0},controller:null,captions:true,closing:false,engine:engineState}),
 computed:{duration(){return `${Math.floor(this.call.elapsed/60).toString().padStart(2,'0')}:${(this.call.elapsed%60).toString().padStart(2,'0')}`;},status(){return {connecting:CALL_COPY.connecting,listening:CALL_COPY.listening,thinking:CALL_COPY.thinking,speaking:CALL_COPY.speaking,error:CALL_COPY.failed}[this.call.phase]||CALL_COPY.listening;}},
 watch:{'engine.stView'(value){if(value)this.close();}},
 mounted(){this.opener=document.activeElement;this.$el.focus();this.init();this.visibility=()=>{if(document.hidden)this.close();};document.addEventListener('visibilitychange',this.visibility);},
 beforeUnmount(){document.removeEventListener('visibilitychange',this.visibility);if(!this.closing)void this.controller?.stop();if(this.opener?.getClientRects?.().length)this.opener.focus();},
 methods:{
  async init(){const engine=getEngine();this.controller=createCallSession({state:this.call,engine,session:this.session,chat:this.chat,maxSeconds:this.maxSeconds,convert:(...args)=>engine.call('voiceInput','recordingWAV',...args),transcribe:(...args)=>engine.call('api','transcribeVoice',...args)});await this.controller.start();},
  async retry(){this.closing=true;await this.controller.stop();this.closing=false;await this.init();},
  async close(){if(this.closing)return;this.closing=true;await this.controller?.stop();window.dispatchEvent(new CustomEvent('vc-call-metrics',{detail:this.controller?.stats}));this.$emit('close');},
  focusNext(e){const buttons=[...this.$el.querySelectorAll('[role="button"]')].filter(b=>!b.hasAttribute('disabled'));const i=buttons.indexOf(document.activeElement);buttons[i<0?(e.shiftKey?buttons.length-1:0):(i+(e.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus();},
 },
};
</script>
<style>
.vc-call { position: fixed; inset: 0; z-index: var(--vc-z-sheet); background: var(--vc-canvas); color: var(--vc-ink); }
.vc-call-content { position: relative; z-index: var(--vc-z-content); height: 100%; max-width: var(--vc-reading-max); margin: 0 auto; display: flex; flex-direction: column; align-items: center; padding: calc(var(--vc-space-xxl) + env(safe-area-inset-top)) var(--vc-space-md) calc(var(--vc-space-xl) + env(safe-area-inset-bottom)); box-sizing: border-box; }
.vc-call-person { display: flex; flex-direction: column; align-items: center; margin-top: clamp(var(--vc-space-xl),6vh,80px); }
.vc-call-ring { border-radius: var(--vc-radius-pill); box-shadow: 0 0 0 var(--vc-space-md) rgba(var(--tint),.08),0 0 0 var(--vc-space-xxl) rgba(var(--tint),.04); transition: transform var(--vc-dur-press) var(--vc-ease-out); }
.vc-call-ring.is-speaking { animation: vc-call-breathe var(--vc-dur-emphasized) var(--vc-ease-in-out) infinite alternate; }
.vc-call-name { font-size: var(--vc-fs-title-2); font-weight: 600; margin-top: var(--vc-space-xxl); }
.vc-call-time { font-size: var(--vc-fs-subhead); color: var(--vc-ink-2); font-variant-numeric: tabular-nums; margin-top: var(--vc-space-xs); }
.vc-call-status { font-size: var(--vc-fs-subhead); color: var(--vc-ink-2); min-height: var(--vc-space-xl); margin-top: var(--vc-space-xs); }
.vc-call-captions { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--vc-space-md); flex: 1; padding: var(--vc-space-lg) var(--vc-space-md); text-align: center; min-height: 0; }
.vc-call-captions > text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.vc-call-previous { font-size: var(--vc-fs-headline); color: var(--vc-ink-2); }
.vc-call-current { font-size: var(--vc-fs-title-2); font-weight: 600; }
.vc-call-controls { display: flex; flex-direction: column; align-items: center; margin-top: auto; gap: var(--vc-space-xl); }
.vc-call-options { display: flex; gap: var(--vc-space-xxl); justify-content: center; }
.vc-call-option { display: flex; flex-direction: column; align-items: center; gap: var(--vc-space-xs); font-size: var(--vc-fs-footnote); }
.vc-call-action { width: var(--vc-call-action); height: var(--vc-call-action); border: 0; border-radius: var(--vc-radius-pill); display: flex; align-items: center; justify-content: center; color: var(--vc-ink); }
.vc-call-action[aria-pressed='true'] { background: var(--vc-glass-strong); }
.vc-call-hangup { width: var(--vc-call-hangup); height: var(--vc-call-hangup); background: var(--vc-danger-fill); color: var(--vc-on-accent); border: 0; border-radius: var(--vc-radius-pill); display: flex; align-items: center; justify-content: center; }
@keyframes vc-call-breathe { to { scale: 1.04; } }
</style>
