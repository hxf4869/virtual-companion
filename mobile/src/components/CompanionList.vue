<template>
    <view class="vc-companion-list">
        <text v-if="error" class="vc-error" role="alert">{{ error }}</text>
        <view v-if="loading" class="vc-empty" aria-busy="true">正在加载…</view>
        <view v-else-if="!events.length" class="vc-empty"><VcIcon name="heart" /><text>还没有新消息</text><button role="button" tabindex="0" class="vc-plain-btn" @click="load">重新加载</button></view>
        <view class="vc-inbox-rows"><button v-for="event in events" :key="event.eventId" role="button" tabindex="0" class="vc-inbox-card" @click="openEvent(event)">
            <VcAvatar :avatar="avatar(event)" :name="name(event)" /><view class="vc-inbox-body"><text class="vc-row-name">{{ name(event) }}</text><text>{{ event.body || '需要打开此会话继续' }}</text><text class="vc-value">{{ event.stDelivered ? '已写入' : '待写入' }}</text></view>
        </button></view>
        <view class="vc-section"><text class="vc-section-title">跟进</text><view class="vc-group">
            <view v-for="f in followUps" :key="f.followUpId" class="vc-field"><view class="vc-follow-body"><text>{{ f.body || '跟进事项' }}</text><text class="vc-value">{{ f.status === 'SCHEDULED' ? '待跟进' : f.status === 'CANCELLED' ? '已取消' : '已询问' }}</text></view><button v-if="f.status === 'SCHEDULED'" role="button" tabindex="0" class="vc-plain-btn" @click="cancelFollow(f)">取消</button></view>
        </view></view>
        <view v-if="relationships.length" class="vc-section"><text class="vc-section-title">陪伴设置</text><view class="vc-group"><label class="vc-field"><text>角色</text><select v-model="relationshipId" aria-label="陪伴角色" @change="changeRelationship"><option v-for="r in relationships" :key="r.relationshipId" :value="String(r.relationshipId)">{{ r.companionName || '未命名角色' }}</option></select></label>
            <label v-if="policy" class="vc-field"><text>主动模式</text><select v-model="policy.mode" aria-label="主动模式"><option value="OFF">关闭</option><option value="FOLLOW_UP">跟进</option><option value="DAILY">日常</option><option value="CLOSE_FRIEND">亲近</option></select></label>
        </view></view>
        <view v-if="policy" class="vc-section"><text class="vc-section-title">静默时段</text><view class="vc-group"><label class="vc-field"><text>开始</text><input v-field-label type="time" v-model="policy.quietHoursStart" aria-label="静默开始" /></label><label class="vc-field"><text>结束</text><input v-field-label type="time" v-model="policy.quietHoursEnd" aria-label="静默结束" /></label><label class="vc-field"><text>时区</text><input v-field-label v-model="policy.quietHoursTimezone" aria-label="时区" /></label></view>
            <button role="button" tabindex="0" class="vc-plain-btn" :disabled="busy" :aria-disabled="busy" @click="savePolicy">{{ busy ? '保存中…' : '保存' }}</button>
        </view>
    </view>
</template>
<script>
import VcAvatar from './VcAvatar.vue';import VcIcon from './VcIcon.vue';import {getEngine,getServer} from '../engine/index.mjs';import {writeAction,errorText,reportError} from '../ui/actions.mjs';import {confirmAlert,showToast} from '../ui/feedback.mjs';
export default {
 components:{VcAvatar,VcIcon},data:()=>({events:[],relationships:[],chats:[],cards:[],followUps:[],relationshipId:'',policy:null,baseline:'',loading:true,error:'',busy:false,alive:true}),
 mounted(){this.load();},beforeUnmount(){this.alive=false;},
 methods:{
  call(module,method,...args){return getEngine().call(module,method,...args);},
  name(event){return this.relationships.find(r=>String(r.relationshipId)===String(event.relationshipId))?.companionName || '未命名角色';},
  avatar(event){return this.chats.find(c=>String(c.binding?.relationshipId)===String(event.relationshipId))?.avatar || '';},
  async load(){this.loading=true;this.error='';try{const [events,rels,chats]=await Promise.all([this.call('inbox','listInbox'),this.call('api','fetchRelationships'),getServer().recentChats(200)]);if(!this.alive)return;this.events=events;this.relationships=rels.filter(r=>r.personaRef==='st-character');this.chats=chats;this.relationshipId=this.relationshipId||String(this.relationships[0]?.relationshipId||'');if(this.relationshipId)await this.loadPolicy();}catch(e){this.error=errorText(e);}finally{this.loading=false;}},
  async loadPolicy(){const id=this.relationshipId;const [policy,follow]=await Promise.all([this.call('inbox','getProactivePolicy',id),this.call('inbox','listFollowUps',id)]);if(!this.alive||this.relationshipId!==id)return;this.policy=await this.call('inbox','readProactivePolicy',policy,id);this.followUps=follow;this.baseline=JSON.stringify(this.policy);},
  async canLeave(){if(!this.policy || JSON.stringify(this.policy)===this.baseline)return true;return confirmAlert({title:'放弃更改？',message:'关闭后本次输入将丢失。',cancel:'继续编辑',action:'放弃'});},
  async changeRelationship(){if(!await this.canLeave()){this.relationshipId=this.policy.relationshipId;return;}try{await this.loadPolicy();}catch(e){reportError(e);}},
  async savePolicy(){if(this.busy)return;const quiet=[this.policy.quietHoursStart,this.policy.quietHoursEnd,this.policy.quietHoursTimezone];if(quiet.some(Boolean)&&!quiet.every(Boolean)){this.error='静默时段需要同时填写开始、结束和时区。';return;}this.busy=true;this.error='';try{const body=await this.call('inbox','proactivePolicyPayload',this.policy);await writeAction(()=>this.call('inbox','putProactivePolicy',this.relationshipId,body));this.baseline=JSON.stringify(this.policy);showToast('已保存');}catch(e){this.error=errorText(e);}finally{this.busy=false;}},
  async cancelFollow(f){try{await writeAction(()=>this.call('inbox','cancelFollowUp',f.followUpId));await this.loadPolicy();}catch(e){reportError(e);}},
  async openEvent(e){const row=this.chats.find(c=>String(c.binding?.conversationId)===String(e.conversationId));if(!row){showToast('需要打开此会话继续');return;}try{await this.call('inbox','markInboxRead',e.eventId);uni.navigateTo({url:`/pages/chat/conversation?avatar=${encodeURIComponent(row.avatar)}&file=${encodeURIComponent(row.file)}&name=${encodeURIComponent(this.name(e))}`});}catch(err){reportError(err);}},
 },
};
</script>
<style>
.vc-inbox-rows { display: flex; flex-direction: column; gap: var(--vc-space-sm); }
.vc-inbox-card { display: flex; align-items: flex-start; gap: var(--vc-space-sm); width: 100%; padding: var(--vc-space-md); background: var(--vc-card); border-radius: var(--vc-radius-lg); color: var(--vc-ink); text-align: left; }
.vc-inbox-body, .vc-follow-body { flex: 1; display: flex; flex-direction: column; gap: var(--vc-space-xs); min-width: 0; font-size: var(--vc-fs-body); }
.vc-row-name { font-size: var(--vc-fs-headline); font-weight: 600; }
</style>
