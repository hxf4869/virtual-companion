<template>
 <div class="vc-incoming" :class="{'has-scene':sceneActive}" role="dialog" aria-modal="true" aria-label="来电" tabindex="-1" @keydown.tab.prevent="focusNext" @keydown.esc.stop.prevent="reply('DECLINE')">
  <VcAurora :background="background" @scene="sceneActive=$event" />
  <view class="vc-incoming-content">
   <text class="vc-incoming-clock">{{ time }}</text>
   <view class="vc-incoming-person"><VcAvatar :name="name" :avatar="avatar" size="var(--vc-avatar-call)" /><view class="vc-incoming-details"><text class="vc-incoming-name">{{ name }}</text><text class="vc-incoming-label">{{ copy.title }}</text></view></view>
   <text v-if="incoming.error" class="vc-error" role="alert">{{ incoming.error }}</text>
   <view class="vc-incoming-controls"><view class="vc-incoming-choices">
    <view class="vc-incoming-option"><button role="button" tabindex="0" class="vc-incoming-action vc-incoming-decline" :disabled="incoming.busy" :aria-disabled="incoming.busy" :aria-label="copy.decline" @click="reply('DECLINE')"><VcIcon name="phone-off" size="var(--vc-icon-xl)" /></button><text>{{ copy.decline }}</text></view>
    <button role="button" tabindex="0" class="vc-incoming-message vc-glass" :disabled="incoming.busy" :aria-disabled="incoming.busy" @click="reply('DECLINE',true)">{{ copy.message }}</button>
    <view class="vc-incoming-option"><button role="button" tabindex="0" class="vc-incoming-action vc-incoming-answer" :disabled="incoming.busy" :aria-disabled="incoming.busy" :aria-label="copy.answer" @click="reply('ANSWER')"><VcIcon name="phone" size="var(--vc-icon-xl)" /></button><text>{{ copy.answer }}</text></view>
   </view></view>
  </view>
 </div>
</template>
<script>
import VcAurora from './VcAurora.vue';import VcAvatar from './VcAvatar.vue';import VcIcon from './VcIcon.vue';
import {incomingState,getIncomingCalls,getEngine,getServer} from '../engine/index.mjs';import {prepareIncomingCall} from '../voice/incoming.mjs';
import {setCharacterTheme,themeState} from '../theme/store.mjs';import {tintOf,avatarUrl} from '../ui/tint.mjs';import {INCOMING_COPY} from '../copy.mjs';import {showToast} from '../ui/feedback.mjs';
export default {
 components:{VcAurora,VcAvatar,VcIcon},data:()=>({incoming:incomingState,copy:INCOMING_COPY,name:'未命名角色',avatar:'',background:'',sceneActive:false,target:null,time:'',live:true}),
 async mounted(){
  this.opener=document.activeElement;this.$el.focus();this.previousTheme={character:themeState.character,tint:themeState.tint};
  this.tick=()=>{this.time=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});};this.tick();this.clock=setInterval(this.tick,1000);
  try{const event=this.incoming.event;const [chats,rels]=await Promise.all([getServer().recentChats(200),getEngine().call('api','fetchRelationships')]);if(!this.live)return;this.target=chats.find(c=>String(c.binding?.conversationId)===String(event.conversationId));this.avatar=this.target?.avatar||'';this.name=rels.find(r=>String(r.relationshipId)===String(event.relationshipId))?.companionName||'未命名角色';const card=getEngine().card(this.avatar);this.background=card?.background||'';const tint=await tintOf(avatarUrl(this.avatar));if(this.live)setCharacterTheme(card?.theme,tint);}catch{if(this.live)this.incoming.error=this.copy.failed;}
 },
 beforeUnmount(){this.live=false;clearInterval(this.clock);setCharacterTheme(this.previousTheme?.character,this.previousTheme?.tint);if(this.opener?.getClientRects?.().length)this.opener.focus();},
 methods:{
  async reply(action,message=false){
   if((action==='ANSWER'||message)&&!this.target){this.incoming.error=this.copy.failed;return;}
   const target=this.target,name=this.name;const event=await getIncomingCalls().reply(action);
   if(!event){if(!this.incoming.event)showToast(this.incoming.error,{error:true});return;}
   if(action==='ANSWER'||message){if(action==='ANSWER')prepareIncomingCall(event);uni.navigateTo({url:`/pages/chat/conversation?avatar=${encodeURIComponent(target.avatar)}&file=${encodeURIComponent(target.file)}&name=${encodeURIComponent(name)}${action==='ANSWER'?`&call=${encodeURIComponent(event.eventId)}`:''}`});}
  },
  focusNext(e){const buttons=[...this.$el.querySelectorAll('[role="button"]')].filter(b=>!b.hasAttribute('disabled'));const i=buttons.indexOf(document.activeElement);buttons[i<0?(e.shiftKey?buttons.length-1:0):(i+(e.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus();},
 },
};
</script>
<style>
.vc-incoming { position: fixed; inset: 0; z-index: var(--vc-z-alert); background: var(--vc-canvas); color: var(--vc-ink); }
.vc-incoming-content { position: relative; z-index: var(--vc-z-content); max-width: var(--vc-reading-max); height: 100%; box-sizing: border-box; margin: auto; display: flex; flex-direction: column; align-items: center; padding: calc(var(--vc-space-xxl) + env(safe-area-inset-top)) var(--vc-space-md) calc(var(--vc-space-xxl) + env(safe-area-inset-bottom)); }
.vc-incoming-clock { font-size: var(--vc-fs-large-title); font-weight: 300; font-variant-numeric: tabular-nums; margin: var(--vc-space-xl) 0; }
.vc-incoming-person { display: flex; flex-direction: column; align-items: center; margin-top: var(--vc-space-xl); gap: var(--vc-space-md); }
.vc-incoming-details { display: flex; flex-direction: column; align-items: center; gap: var(--vc-space-md); }
.vc-incoming-name { font-size: var(--vc-fs-large-title); font-weight: 700; text-align: center; overflow-wrap: anywhere; max-width: 100%; }
.vc-incoming-label { font-size: var(--vc-fs-body); color: var(--vc-ink-2); }
.vc-incoming-controls { margin-top: auto; width: 100%; padding-bottom: var(--vc-space-xl); }
.vc-incoming-choices { display: flex; align-items: center; justify-content: center; gap: var(--vc-space-md); }
.vc-incoming-option { display: flex; flex-direction: column; align-items: center; gap: var(--vc-space-xs); font-size: var(--vc-fs-footnote); }
.vc-incoming-action { width: var(--vc-call-hangup); height: var(--vc-call-hangup); border: 0; border-radius: var(--vc-radius-pill); color: var(--vc-on-accent); display: flex; align-items: center; justify-content: center; }
.vc-incoming-decline { background: var(--vc-danger-fill); }.vc-incoming-answer { background: var(--vc-call-accept); }
.vc-incoming-message { min-height: var(--vc-touch); padding: 0 var(--vc-space-sm); border-radius: var(--vc-radius-pill); color: var(--vc-ink); font-size: var(--vc-fs-subhead); }
.vc-incoming.has-scene { --vc-ink-2: var(--vc-ink); }
.vc-incoming.has-scene .vc-incoming-details { padding: var(--vc-space-xs) var(--vc-space-sm); background: var(--vc-glass-strong); border-radius: var(--vc-radius-lg); }
.vc-incoming.has-scene :is(.vc-incoming-clock, .vc-incoming-option > text, .vc-error) { padding: var(--vc-space-xxs) var(--vc-space-xs); background: var(--vc-glass-strong); border-radius: var(--vc-radius-sm); }
</style>
