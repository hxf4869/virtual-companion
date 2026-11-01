<template>
    <view class="vc-memory-list">
        <label class="vc-field vc-glass vc-instance-picker"><select v-model="relationshipId" aria-label="角色实例" @change="load(false)"><option v-for="r in relationships" :key="r.relationshipId" :value="String(r.relationshipId)">{{ r.companionName || '未命名角色' }}</option></select></label>
        <view class="vc-search vc-glass"><VcIcon name="search" size="var(--vc-icon-sm)" /><input v-field-label class="vc-search-input" v-model="query" placeholder="搜索" aria-label="搜索记忆" @confirm="load(false)" /><button role="button" tabindex="0" class="vc-plain-btn" @click="load(false)">搜索</button></view>
        <view class="vc-segment" role="tablist"><button v-for="f in filters" :key="f.id" role="tab" tabindex="0" :aria-selected="status === f.id" @click="status=f.id;load(false)">{{ f.label }}</button></view>
        <text v-if="error" class="vc-error" role="alert">{{ error }}</text>
        <view v-if="loading" class="vc-empty" aria-busy="true">正在加载…</view>
        <view v-else-if="!items.length" class="vc-empty"><VcIcon name="book-open" /><text>暂无记忆</text><button role="button" tabindex="0" class="vc-plain-btn" @click="load(false)">重新加载</button></view>
        <view class="vc-memory-rows">
            <button v-for="m in items" :key="m.memoryId" role="button" tabindex="0" class="vc-memory-card" @click="select(m)"><text class="vc-memory-text">{{ m.summary }}</text><text class="vc-value">{{ date(m.time?.recordedAt) }} · {{ statusLabel(m) }}</text></button>
        </view>
        <button v-if="nextCursor" role="button" tabindex="0" class="vc-plain-btn" :disabled="loading" :aria-disabled="loading" @click="load(true)">加载更多</button>
        <view v-if="selected" class="vc-memory-scrim" @click.self="closeDetail"><view class="vc-memory-detail vc-glass" role="dialog" aria-modal="true" aria-label="记忆">
            <view class="vc-edit-head"><button role="button" tabindex="0" class="vc-plain-btn" @click="closeDetail">取消</button><text>记忆</text><button role="button" tabindex="0" class="vc-plain-btn" :disabled="busy || selected.lifecycle !== 'ACTIVE'" :aria-disabled="busy || selected.lifecycle !== 'ACTIVE'" @click="correct">保存</button></view>
            <textarea v-field-label v-model="draft" :disabled="selected.lifecycle !== 'ACTIVE'" :maxlength="2000" aria-label="纠正记忆" /><text v-if="detailError" class="vc-error" role="alert">{{ detailError }}</text>
            <text v-for="(source,i) in evidence" :key="i" class="vc-memory-source">{{ source.excerpt || source.text || source.summary || '' }}</text>
            <button role="button" tabindex="0" class="vc-plain-btn vc-delete-memory" :disabled="busy" :aria-disabled="busy" @click="forget">删除</button>
        </view></view>
    </view>
</template>
<script>
import VcIcon from './VcIcon.vue';import {getEngine} from '../engine/index.mjs';import {writeAction,errorText} from '../ui/actions.mjs';import {confirmAlert,showToast} from '../ui/feedback.mjs';
export default {
 components:{VcIcon},data:()=>({relationships:[],relationshipId:'',query:'',status:'',filters:[{id:'',label:'全部'},{id:'PENDING_VERIFICATION',label:'待核验'},{id:'INVALID',label:'已失效'}],items:[],nextCursor:null,loading:true,error:'',selected:null,draft:'',evidence:[],detailError:'',busy:false,run:0}),
 mounted(){this.init();},beforeUnmount(){this.run++;},
 methods:{
  api(method,...args){return getEngine().call('api',method,...args);},date(v){return v?new Date(v).toLocaleDateString('zh-CN'):'';},statusLabel(m){return m.sourceStatus==='INVALID'?'已失效':m.sourceStatus==='PENDING_VERIFICATION'?'待核验':({ACTIVE:'生效中',SUPERSEDED:'已被替代',FORGETTING:'清理中',FORGOTTEN:'已遗忘'}[m.lifecycle]||'状态未知');},
  async init(){try{this.relationships=(await this.api('fetchRelationships')).filter(r=>r.personaRef==='st-character');this.relationshipId=String(this.relationships[0]?.relationshipId||'');await this.load(false);}catch(e){this.error=errorText(e);this.loading=false;}},
  async load(append=false){const run=++this.run;this.loading=true;this.error='';try{if(!this.relationshipId){this.items=[];return;}const r=await this.api('fetchMemories',this.relationshipId,{q:this.query,status:this.status,limit:20,...(append?{cursor:this.nextCursor}:{})});if(run!==this.run)return;this.items=append?[...this.items,...r.items]:r.items;this.nextCursor=r.nextCursor;}catch(e){if(run===this.run)this.error=errorText(e);}finally{if(run===this.run)this.loading=false;}},
  async select(m){this.selected=m;this.draft=m.summary;this.detailError='';this.evidence=[];try{const result=await this.api('fetchMemoryEvidence',m.memoryId);if(this.selected?.memoryId===m.memoryId)this.evidence=Array.isArray(result)?result:result.items||[];}catch{this.detailError='来源加载失败，请刷新详情。';}},
  async closeDetail(){if(this.draft!==this.selected?.summary&&!await confirmAlert({title:'放弃更改？',message:'关闭后本次输入将丢失。',cancel:'继续编辑',action:'放弃'}))return false;this.selected=null;return true;},
  async canLeave(){return !this.selected || await this.closeDetail();},
  async correct(){if(this.busy)return;this.busy=true;this.detailError='';try{await writeAction(()=>this.api('correctMemory',this.selected.memoryId,{summary:this.draft,expectedVersion:this.selected.version}));this.selected=null;await this.load(false);showToast('已保存');}catch(e){this.detailError=errorText(e);}finally{this.busy=false;}},
  async forget(){if(!await confirmAlert({title:'删除这条记忆？',message:'聊天原文仍保留，可能继续用于当前对话。',action:'删除记忆'}))return;this.busy=true;try{await writeAction(()=>this.api('forgetMemory',this.selected.memoryId));this.selected=null;await this.load(false);showToast('已删除');}catch(e){this.detailError=errorText(e);}finally{this.busy=false;}},
 },
};
</script>
<style>
.vc-instance-picker { border-radius: var(--vc-radius-pill); margin-bottom: var(--vc-space-sm); }
.vc-instance-picker select { max-width: 100%; width: 100%; text-align: left; }
.vc-memory-rows { display: flex; flex-direction: column; gap: var(--vc-space-sm); }
.vc-memory-card { background: var(--vc-card); border-radius: var(--vc-radius-lg); padding: var(--vc-space-md); width: 100%; text-align: left; color: var(--vc-ink); }
.vc-memory-text { display: block; font-size: var(--vc-fs-body); white-space: pre-wrap; margin-bottom: var(--vc-space-xs); }
.vc-memory-scrim { position: fixed; inset: 0; z-index: var(--vc-z-sheet); background: var(--vc-scrim); display: flex; align-items: flex-end; justify-content: center; }
.vc-memory-detail { width: calc(100vw - var(--vc-space-xxl)); padding: var(--vc-space-md); margin-bottom: var(--vc-space-md); max-height: 80vh; overflow: auto; border-radius: var(--vc-radius-sheet); }
.vc-memory-detail textarea { width: 100%; min-height: 160px; margin: var(--vc-space-sm) 0; font-size: var(--vc-fs-body); color: var(--vc-ink); }
.vc-edit-head { display: flex; align-items: center; justify-content: space-between; font-size: var(--vc-fs-headline); font-weight: 600; }
.vc-memory-source { display: block; color: var(--vc-ink-2); font-size: var(--vc-fs-footnote); }
.vc-delete-memory { color: var(--vc-danger); }
</style>
