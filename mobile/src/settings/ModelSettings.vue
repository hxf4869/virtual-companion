<template>
 <view class="vc-model-settings">
  <text v-if="error" class="vc-error" role="alert">{{ error }}</text><view v-if="loading" class="vc-empty" aria-busy="true">正在加载…</view>
  <template v-else-if="!draft">
   <view class="vc-section"><text class="vc-section-title">供应商</text><view class="vc-group"><button v-for="p in providers" :key="p.providerId" role="button" tabindex="0" class="vc-field is-link" @click="edit(p)"><text>{{ p.displayName }}</text><text class="vc-value">{{ p.credentialConfigured ? '已保存' : '待配置' }}</text><VcIcon name="chevron-right" size="var(--vc-icon-sm)" /></button><button role="button" tabindex="0" class="vc-field is-link" @click="add"><VcIcon name="plus" /><text>添加供应商</text></button></view></view>
   <view class="vc-section"><text class="vc-section-title">用途</text><view class="vc-group"><view v-for="b in bindings" :key="b.purpose" class="vc-purpose-row"><label class="vc-field"><text>{{ label(b.purpose) }}</text><select v-model="b.choice" :aria-label="`用途 ${label(b.purpose)}`" :disabled="b.purpose === 'EMBEDDING'"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select></label><button role="button" tabindex="0" v-if="b.choice !== b.original" class="vc-plain-btn" :disabled="busy" :aria-disabled="busy" @click="saveBinding(b)">保存</button></view></view></view>
  </template>
  <template v-else>
   <view class="vc-form-actions"><button role="button" tabindex="0" class="vc-plain-btn" @click="closeProvider">返回模型</button><button role="button" tabindex="0" class="vc-primary" :disabled="busy" :aria-disabled="busy" @click="save">{{ busy ? '保存中…' : '保存' }}</button></view>
   <view class="vc-group">
    <label class="vc-field"><text>名称</text><input v-field-label v-model="draft.displayName" aria-label="供应商名称" /></label>
    <label class="vc-field"><text>协议</text><select v-model="draft.protocol" aria-label="协议"><option v-for="p in protocols" :key="p.id" :value="p.id">{{ p.label }}</option></select></label>
    <label class="vc-field is-column"><text>请求地址</text><input v-field-label v-model="draft.baseUrl" aria-label="请求地址" /></label>
    <label class="vc-field"><text>API 密钥</text><input v-field-label v-model="draft.credential" password type="password" :placeholder="draft.credentialConfigured ? '已保存' : ''" aria-label="API 密钥" autocomplete="off" /></label>
    <view class="vc-field"><text>启用</text><button role="switch" tabindex="0" class="vc-toggle" :aria-checked="draft.state === 'ENABLED'" aria-label="启用供应商" @click="draft.state=draft.state==='ENABLED'?'DISABLED':'ENABLED'"></button></view>
   </view>
   <view v-for="(m,i) in draft.models" :key="i" class="vc-section"><text class="vc-section-title">{{ m.displayName || '模型' }}</text><view class="vc-group">
    <label class="vc-field"><text>名称</text><input v-field-label v-model="m.displayName" :aria-label="`模型名称 ${i+1}`" /></label>
    <label class="vc-field is-column"><text>模型标识</text><input v-field-label v-model="m.modelId" :aria-label="`模型标识 ${i+1}`" /></label>
    <label class="vc-field"><text>上下文上限</text><input v-field-label type="number" v-model="m.contextWindowTokens" :aria-label="`上下文上限 ${i+1}`" /></label>
    <label class="vc-field"><text>最大输出</text><input v-field-label type="number" v-model="m.maxOutputTokens" :aria-label="`最大输出 ${i+1}`" /></label>
    <view class="vc-field"><text>启用</text><button role="switch" tabindex="0" class="vc-toggle" :aria-checked="m.state === 'ENABLED'" :aria-label="`启用模型 ${i+1}`" @click="m.state=m.state==='ENABLED'?'DISABLED':'ENABLED'"></button></view>
    <details class="vc-model-advanced"><summary>高级</summary><label class="vc-field"><text>Temperature</text><input v-field-label type="number" v-model="m.generationParams.temperature" @input="m.editedSubs.add('generationParams')" /></label><label class="vc-field"><text>Top P</text><input v-field-label type="number" v-model="m.generationParams.topP" @input="m.editedSubs.add('generationParams')" /></label><label class="vc-field"><text>推理强度</text><select v-model="m.generationParams.reasoningEffort" @change="m.editedSubs.add('generationParams')"><option value="">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label></details>
   </view></view>
   <button role="button" tabindex="0" class="vc-plain-btn" @click="draft.models.push(newModel())">添加模型</button>
   <button v-if="error" role="button" tabindex="0" class="vc-plain-btn" @click="latest">加载最新</button>
  </template>
 </view>
</template>
<script>
import VcIcon from '../components/VcIcon.vue';import {getEngine} from '../engine/index.mjs';import {writeAction,errorText} from '../ui/actions.mjs';import {confirmAlert,showToast} from '../ui/feedback.mjs';
import {PROTOCOLS,PURPOSES,providerDraftFromApi,newProviderDraft,newModelDraft,buildProviderPut,buildBindingOptions,validateProviderForm,validateModelForm,validateCredentialPlan} from '../../../integrations/sillytavern/extension/vc-model-settings/model-logic.js';
export default {
 components:{VcIcon},data:()=>({providers:[],bindings:[],draft:null,baseline:'',loading:true,busy:false,error:'',protocols:PROTOCOLS}),
 computed:{options(){return buildBindingOptions(this.providers);}},mounted(){this.load();},beforeUnmount(){if(this.draft)this.draft.credential='';},
 methods:{
  call(method,...args){return getEngine().call('api',method,...args);},label(id){if(id==='EMBEDDING')return '向量检索';return PURPOSES.find(x=>x.id===id)?.label || id;},newModel:newModelDraft,
  async load(){this.loading=true;this.error='';try{const [p,b]=await Promise.all([this.call('fetchProviders'),this.call('fetchModelPurposes')]);this.providers=p;this.bindings=b.map(x=>({...x,choice:x.providerId&&x.profileKey?`${x.providerId}::${x.profileKey}`:'',original:x.providerId&&x.profileKey?`${x.providerId}::${x.profileKey}`:''}));}catch(e){this.error=errorText(e);}finally{this.loading=false;}},
  edit(p){this.draft=providerDraftFromApi(p);this.baseline=JSON.stringify(buildProviderPut(this.draft));this.error='';},
  add(){const d=newProviderDraft();d.providerId=`vc-${crypto.randomUUID().slice(0,8)}`;d.models=[newModelDraft()];this.draft=d;this.baseline=JSON.stringify(buildProviderPut(d));},
  async canLeave(){const dirty=this.draft&&JSON.stringify(buildProviderPut(this.draft))!==this.baseline || this.bindings.some(b=>b.choice!==b.original);if(!dirty)return true;return confirmAlert({title:'放弃更改？',message:'关闭后本次输入将丢失。',cancel:'继续编辑',action:'放弃'});},
  async closeProvider(){if(!await this.canLeave())return;this.draft.credential='';this.draft=null;this.error='';},
  async save(){if(this.busy)return;const validation=Object.values(validateProviderForm(this.draft,{isNew:this.draft.revision===0}).errors);if(validation.length){this.error=validation.join('；');return;}const models=this.draft.models.flatMap(m=>Object.values(validateModelForm(m)));if(models.length){this.error=models.join('；');return;}const key=Object.values(validateCredentialPlan(this.draft,{isNew:this.draft.revision===0,credentialConfigured:this.draft.credentialConfigured}));if(key.length){this.error=key.join('；');return;}this.busy=true;this.error='';try{const id=this.draft.providerId;const payload=buildProviderPut(this.draft);await writeAction(()=>this.call('saveProvider',id,payload));this.draft.credential='';this.draft=null;await this.load();showToast('已保存');}catch(e){this.error=errorText(e);}finally{this.busy=false;}},
  async latest(){if(!await this.canLeave())return;const id=this.draft.providerId;await this.load();const p=this.providers.find(x=>x.providerId===id);if(p)this.edit(p);},
  async saveBinding(b){if(this.busy)return;this.busy=true;this.error='';const choice=b.choice;const [providerId,profileKey]=(choice||'').split('::');try{const r=await writeAction(()=>this.call('saveModelPurpose',b.purpose,{providerId:providerId||null,profileKey:profileKey||null,state:providerId?'ENABLED':'PENDING_CONFIGURATION',expectedRevision:b.revision}));b.revision=r.revision;b.original=choice;showToast('已保存');}catch(e){this.error=errorText(e);}finally{this.busy=false;}},
 },
};
</script>
<style>
.vc-form-actions { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--vc-space-md); gap: var(--vc-space-sm); }
.vc-purpose-row + .vc-purpose-row { border-top: 0.5px solid var(--vc-separator); }
.vc-purpose-row select { max-width: 58%; }
.vc-model-advanced { padding: var(--vc-space-sm) var(--vc-space-md); font-size: var(--vc-fs-subhead); }
</style>
