<template>
 <view class="vc-voice-settings">
  <text v-if="error" class="vc-error" role="alert">{{ error }}</text><view v-if="!settings" class="vc-empty" aria-busy="true">正在加载…</view>
  <template v-else>
   <view v-for="engine in controls" :key="engine.flag" class="vc-section"><text class="vc-section-title">{{ engine.title }}</text><view class="vc-group"><view class="vc-field"><text>{{ availability(engine) }}</text><button role="switch" tabindex="0" class="vc-toggle" :aria-label="engine.title" :aria-checked="settings[engine.flag]" @click="settings[engine.flag]=!settings[engine.flag]"></button></view><label class="vc-field"><text>超时（秒）</text><input v-field-label type="number" v-model.number="settings[engine.timeout]" :aria-label="`${engine.title}超时`" /></label><label class="vc-field"><text>{{ engine.limit==='maxRecordingSeconds'?'最长录音（秒）':'每日上限' }}</text><input v-field-label type="number" v-model.number="settings[engine.limit]" :aria-label="`${engine.title}上限`" /></label></view></view>
   <view class="vc-group"><label class="vc-field"><text>语音频率</text><select v-model="settings.voiceFrequency" aria-label="语音频率"><option value="LOW">少</option><option value="STANDARD">标准</option><option value="HIGH">多</option></select></label></view>
   <details class="vc-section"><summary>场景指令</summary><view class="vc-group"><label v-for="(name,id) in scenes" :key="id" class="vc-field is-column"><text>{{ name }}</text><textarea v-field-label v-model="settings.cosyVoiceInstructions[id]" :maxlength="1000" :aria-label="`${name}场景指令`" /></label></view></details>
   <details class="vc-section"><summary>发送比例</summary><view class="vc-group"><label v-for="(name,id) in scenes" :key="id" class="vc-field"><text>{{ name }}（%）</text><input v-field-label type="number" :value="Math.round(settings.proactiveVoiceRates[id]*100)" @input="settings.proactiveVoiceRates[id]=Number($event.detail.value)/100" :aria-label="`${name}发送比例`" /></label></view></details>
   <button role="button" tabindex="0" class="vc-primary" :disabled="busy" :aria-disabled="busy" @click="save">{{ busy?'保存中…':'保存' }}</button><button v-if="error" role="button" tabindex="0" class="vc-plain-btn" @click="latest">加载最新</button>
  </template>
 </view>
</template>
<script>
import {getEngine} from '../engine/index.mjs';import {writeAction,errorText} from '../ui/actions.mjs';import {confirmAlert,showToast} from '../ui/feedback.mjs';
export default{
 data:()=>({settings:null,engines:null,baseline:'',error:'',busy:false,controls:[{title:'聊天语音',flag:'kokoroEnabled',engine:'kokoro',timeout:'kokoroTimeoutSeconds',limit:'dailyChatLimit'},{title:'主动语音',flag:'cosyVoiceEnabled',engine:'cosyvoice',timeout:'cosyVoiceTimeoutSeconds',limit:'dailyProactiveLimit'},{title:'语音输入',flag:'asrEnabled',engine:'asr',timeout:'asrTimeoutSeconds',limit:'maxRecordingSeconds'}],scenes:{morning:'早安',night:'晚安',care:'关心',share:'分享',default:'其他'}}),
 mounted(){this.load();},methods:{
 call(method,...args){return getEngine().call('api',method,...args);},
 availability(e){const engine=e.engine==='asr'?this.engines?.asr:this.engines?.tts?.find(x=>x.engine===e.engine);return !engine?.configured?'未配置':engine.healthy?'可用':'不可用';},
 async load(){this.error='';try{const [s,e]=await Promise.all([this.call('fetchVoiceSettings'),this.call('fetchVoiceEngines')]);this.settings=s;this.engines=e;this.baseline=JSON.stringify(s);}catch(e){this.error=errorText(e);}},
 async canLeave(){if(!this.settings||JSON.stringify(this.settings)===this.baseline)return true;return confirmAlert({title:'放弃更改？',message:'关闭后本次输入将丢失。',cancel:'继续编辑',action:'放弃'});},
 async latest(){if(await this.canLeave())await this.load();},
 async save(){if(this.busy)return;this.busy=true;this.error='';try{const {revision,updatedAt,...body}=this.settings;const next=await writeAction(()=>this.call('saveVoiceSettings',{...body,expectedRevision:revision}));this.settings=next;this.baseline=JSON.stringify(next);showToast('已保存');}catch(e){this.error=errorText(e);}finally{this.busy=false;}},
 },
};
</script>
