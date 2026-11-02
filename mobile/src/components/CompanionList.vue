<template>
    <view class="vc-companion-list">
        <text v-if="error" class="vc-error" role="alert">{{ error }}</text>
        <view v-if="loading" class="vc-empty" aria-busy="true">正在加载…</view>
        <view v-else-if="!events.length" class="vc-empty"><VcIcon name="heart" /><text>还没有新消息</text><button role="button" tabindex="0" class="vc-plain-btn" @click="load">重新加载</button></view>
        <view class="vc-inbox-rows"><view v-for="event in events" :key="event.eventId" class="vc-inbox-card" :data-inbox-event="event.eventId">
            <VcAvatar :avatar="avatar(event)" :name="name(event)" /><view class="vc-inbox-body"><button role="button" tabindex="0" class="vc-inbox-open" @click="openEvent(event)"><text class="vc-row-name">{{ name(event) }}</text><text v-if="event.call" class="vc-value">{{ copy.states[event.call.state] }}</text></button>
            <VcVoice v-if="event.voice" :message="{id:-1,text:event.body,user:false,extra:{vc_voice:event.voice}}" /><text v-else>{{ event.body || '需要打开此会话继续' }}</text><text class="vc-value">{{ event.stDelivered ? '已写入' : '待写入' }}</text>
            <button v-if="event.call && event.call.state!=='RINGING'" role="button" tabindex="0" class="vc-plain-btn vc-callback" :disabled="!event.stDelivered" :aria-disabled="!event.stDelivered" @click="openEvent(event,true)"><VcIcon name="phone" size="var(--vc-icon-sm)" />{{ copy.callback }}</button></view>
        </view></view>
        <view class="vc-section"><text class="vc-section-title">跟进</text><view class="vc-group">
            <view v-for="f in followUps" :key="f.followUpId" class="vc-field"><view class="vc-follow-body"><text>{{ f.body || '跟进事项' }}</text><text class="vc-value">{{ f.status === 'SCHEDULED' ? '待跟进' : f.status === 'CANCELLED' ? '已取消' : '已询问' }}</text></view><button v-if="f.status === 'SCHEDULED'" role="button" tabindex="0" class="vc-plain-btn" @click="cancelFollow(f)">取消</button></view>
        </view></view>
        <view v-if="relationships.length" class="vc-section"><text class="vc-section-title">陪伴设置</text><view class="vc-group"><label class="vc-field"><text>角色</text><select v-model="relationshipId" aria-label="陪伴角色" :disabled="busy || policyLoading" @change="changeRelationship"><option v-for="r in relationships" :key="r.relationshipId" :value="String(r.relationshipId)">{{ r.companionName || '未命名角色' }}</option></select></label>
            <label v-if="policy" class="vc-field"><text>主动模式</text><select v-model="policy.mode" aria-label="主动模式"><option value="OFF">关闭</option><option value="FOLLOW_UP">跟进</option><option value="DAILY">日常</option><option value="CLOSE_FRIEND">亲近</option></select></label>
        </view></view>
        <view v-if="policy" class="vc-section"><text class="vc-section-title">静默时段</text><view class="vc-group"><label class="vc-field"><text>开始</text><input v-field-label type="time" v-model="policy.quietHoursStart" aria-label="静默开始" /></label><label class="vc-field"><text>结束</text><input v-field-label type="time" v-model="policy.quietHoursEnd" aria-label="静默结束" /></label><label class="vc-field"><text>时区</text><input v-field-label v-model="policy.quietHoursTimezone" aria-label="时区" /></label></view>
            <button role="button" tabindex="0" class="vc-plain-btn" :disabled="busy || policyLoading" :aria-disabled="busy || policyLoading" @click="savePolicy">{{ busy ? '保存中…' : '保存' }}</button>
        </view>
    </view>
</template>
<script>
import VcAvatar from './VcAvatar.vue';import VcIcon from './VcIcon.vue';import VcVoice from './VcVoice.vue';import {getEngine,getServer,incomingState} from '../engine/index.mjs';import {prepareIncomingCall} from '../voice/incoming.mjs';import {INCOMING_COPY} from '../copy.mjs';import {writeAction,errorText,reportError} from '../ui/actions.mjs';import {confirmAlert,showToast} from '../ui/feedback.mjs';
export default {
 components:{VcAvatar,VcIcon,VcVoice},data:()=>({events:[],incoming:incomingState,copy:INCOMING_COPY,relationships:[],chats:[],cards:[],followUps:[],relationshipId:'',policy:null,policyLoading:false,baseline:'',loading:true,error:'',busy:false,alive:true}),
 watch:{'incoming.events'(rows){this.events=rows;}},
 mounted(){this.load();},beforeUnmount(){this.alive=false;},
 methods:{
  call(module,method,...args){return getEngine().call(module,method,...args);},
  name(event){return this.relationships.find(r=>String(r.relationshipId)===String(event.relationshipId))?.companionName || '未命名角色';},
  avatar(event){return this.chats.find(c=>String(c.binding?.relationshipId)===String(event.relationshipId))?.avatar || '';},
  async load(){this.loading=true;this.error='';try{const [events,rels,chats]=await Promise.all([this.call('inbox','listInbox'),this.call('api','fetchRelationships'),getServer().recentChats(200)]);if(!this.alive)return;this.events=events;this.relationships=rels.filter(r=>r.personaRef==='st-character');this.chats=chats;this.relationshipId=this.relationshipId||String(this.relationships[0]?.relationshipId||'');if(this.relationshipId)await this.loadPolicy();}catch(e){this.error=errorText(e);}finally{this.loading=false;}},
  async loadPolicy(){const id=this.relationshipId;this.policyLoading=true;this.policy=null;this.followUps=[];try{const [policy,follow]=await Promise.all([this.call('inbox','getProactivePolicy',id),this.call('inbox','listFollowUps',id)]);const draft=await this.call('inbox','readProactivePolicy',policy,id);if(!this.alive||this.relationshipId!==id)return;this.policy=draft;this.followUps=follow;this.baseline=JSON.stringify(draft);}finally{if(this.relationshipId===id)this.policyLoading=false;}},
  async canLeave(){if(!this.policy || JSON.stringify(this.policy)===this.baseline)return true;return confirmAlert({title:'放弃更改？',message:'关闭后本次输入将丢失。',cancel:'继续编辑',action:'放弃'});},
  async changeRelationship(){if(!await this.canLeave()){this.relationshipId=this.policy.relationshipId;return;}try{await this.loadPolicy();}catch(e){reportError(e);}},
  async savePolicy(){if(this.busy||this.policyLoading||!this.policy)return;const draft={...this.policy},id=String(draft.relationshipId);const quiet=[draft.quietHoursStart,draft.quietHoursEnd,draft.quietHoursTimezone];if(quiet.some(Boolean)&&!quiet.every(Boolean)){this.error='静默时段需要同时填写开始、结束和时区。';return;}this.busy=true;this.error='';try{const body=await this.call('inbox','proactivePolicyPayload',draft);await writeAction(()=>this.call('inbox','putProactivePolicy',id,body));this.baseline=JSON.stringify(draft);showToast('已保存');}catch(e){this.error=errorText(e);}finally{this.busy=false;}},
  async cancelFollow(f){try{await writeAction(()=>this.call('inbox','cancelFollowUp',f.followUpId));await this.loadPolicy();}catch(e){reportError(e);}},
  async openEvent(e,callback=false){const row=this.chats.find(c=>String(c.binding?.conversationId)===String(e.conversationId));if(!row){showToast('需要打开此会话继续');return;}try{await this.call('inbox','markInboxRead',e.eventId);if(callback)prepareIncomingCall({...e,callback:true});uni.navigateTo({url:`/pages/chat/conversation?avatar=${encodeURIComponent(row.avatar)}&file=${encodeURIComponent(row.file)}&name=${encodeURIComponent(this.name(e))}${callback?`&call=${encodeURIComponent(e.eventId)}`:''}`});}catch(err){reportError(err);}},
 },
};
</script>
<style>
.vc-inbox-rows { display: flex; flex-direction: column; gap: var(--vc-space-sm); }
.vc-inbox-card { display: flex; align-items: flex-start; gap: var(--vc-space-sm); box-sizing: border-box; width: 100%; padding: var(--vc-space-md); background: var(--vc-card); border-radius: var(--vc-radius-lg); color: var(--vc-ink); text-align: left; }
.vc-inbox-body, .vc-follow-body { flex: 1; display: flex; flex-direction: column; gap: var(--vc-space-xs); min-width: 0; font-size: var(--vc-fs-body); }
.vc-row-name { font-size: var(--vc-fs-headline); font-weight: 600; }
.vc-inbox-open { display: flex; flex-direction: column; align-items: flex-start; gap: var(--vc-space-xxs); padding: 0; background: none; border: 0; color: var(--vc-ink); text-align: left; min-height: var(--vc-touch); }
.vc-callback { display: flex; align-items: center; gap: var(--vc-space-xxs); align-self: flex-start; }
.vc-inbox-card .vc-callback[disabled] { background: none; color: var(--vc-ink-3); }
</style>
