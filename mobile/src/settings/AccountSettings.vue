<template>
 <view class="vc-account-settings">
  <text v-if="error" class="vc-error" role="alert">{{ error }}</text>
  <template v-if="!dataMode">
   <view class="vc-section"><text class="vc-section-title">修改密码</text><view class="vc-group"><label class="vc-field"><text>当前密码</text><input v-field-label v-model="password" password type="password" aria-label="当前密码" /></label><label class="vc-field"><text>新密码</text><input v-field-label v-model="newPassword" password type="password" aria-label="新密码" /></label></view><button role="button" tabindex="0" class="vc-plain-btn" :disabled="busy" :aria-disabled="busy" @click="changePassword">修改密码</button></view>
   <view class="vc-section"><text class="vc-section-title">会话</text><view class="vc-group"><view v-for="s in sessions" :key="s.id" class="vc-field"><text>{{ s.current?'当前会话':sessionName(s) }}</text><button v-if="!s.current" role="button" tabindex="0" class="vc-plain-btn" @click="revoke(s)">退出登录</button></view></view></view>
   <view v-if="devices.length" class="vc-section"><text class="vc-section-title">受信任设备</text><view class="vc-group"><view v-for="d in devices" :key="d.id" class="vc-field"><text>{{ d.displayName }}</text><button role="button" tabindex="0" class="vc-plain-btn" @click="removeDevice(d)">移除</button></view></view></view>
   <button role="button" tabindex="0" class="vc-plain-btn" @click="resetAuthenticator">重置身份验证器</button>
   <button role="button" tabindex="0" class="vc-plain-btn vc-danger" :disabled="busy" :aria-disabled="busy" @click="logout">退出登录</button>
  </template>
  <template v-else>
   <view class="vc-group"><label class="vc-field"><text>当前密码</text><input v-field-label v-model="password" password type="password" aria-label="当前密码" /></label></view>
   <view class="vc-section"><button role="button" tabindex="0" class="vc-primary" :disabled="busy" :aria-disabled="busy" @click="exportData">导出数据</button><button role="button" tabindex="0" class="vc-plain-btn" :disabled="busy" :aria-disabled="busy" @click="recover">恢复导出</button></view>
   <view v-if="job" class="vc-group"><view class="vc-field"><text>{{ exportStatus }}</text><button v-if="!job.downloadUrl" role="button" tabindex="0" class="vc-plain-btn" @click="refreshExport">刷新</button><button v-else role="button" tabindex="0" class="vc-plain-btn" @click="download">下载</button></view></view>
   <button role="button" tabindex="0" class="vc-plain-btn vc-danger" :disabled="busy || !password" :aria-disabled="busy || !password" @click="deleteAccount">删除账户</button>
  </template>
 </view>
</template>
<script>
import {getEngine,showStView} from '../engine/index.mjs';import {writeAction,errorText} from '../ui/actions.mjs';import {confirmAlert,showToast} from '../ui/feedback.mjs';
export default{
 props:{dataMode:Boolean},data:()=>({sessions:[],devices:[],identity:null,password:'',newPassword:'',busy:false,error:'',job:null}),computed:{exportStatus(){return {QUEUED:'导出中',RUNNING:'导出中',COMPLETE:'导出完成',FAILED:'导出未完成'}[this.job?.status] || this.job?.status || '导出中';}},mounted(){if(!this.dataMode)this.load();},beforeUnmount(){this.password='';this.newPassword='';},
 methods:{
 call(method,...args){return getEngine().call('api',method,...args);},sessionName(s){return s.createdAt ? new Date(s.createdAt).toLocaleString('zh-CN') : '其他会话';},
 async removeDevice(d){try{await writeAction(()=>this.call('revokeTrustedDevice',String(d.id)));await this.load();}catch(e){this.error=errorText(e);}},
 async resetAuthenticator(){if(!await confirmAlert({title:'重置身份验证器？',message:'重置后需要重新登录并设置身份验证器。',action:'重置身份验证器'}))return;try{await writeAction(()=>this.call('resetAuthenticator',String(this.identity.accountId)));location.assign('/auth/');}catch(e){this.error=errorText(e);}},
 async deleteAccount(){if(!this.password||!await confirmAlert({title:'删除账户？',message:'账户及其业务数据将进入清理流程，无法恢复。',action:'删除账户'}))return;this.busy=true;try{await this.call('deleteOwnAccount',this.password);this.password='';location.assign('/auth/');}catch(e){this.error=errorText(e);}finally{this.busy=false;}},
 async load(){try{const [r,d,id]=await Promise.all([this.call('listSessions'),this.call('listTrustedDevices'),this.call('fetchSession')]);this.sessions=Array.isArray(r)?r:r.items||[];this.devices=Array.isArray(d)?d:d.items||[];this.identity=id;}catch(e){this.error=errorText(e);}},
 async changePassword(){if(this.busy)return;this.busy=true;this.error='';try{await this.call('changePassword',this.password,this.newPassword);this.password='';this.newPassword='';showToast('已保存');}catch(e){this.error=errorText(e);}finally{this.busy=false;}},
 async revoke(s){try{await writeAction(()=>this.call('revokeSession',String(s.id)));await this.load();}catch(e){this.error=errorText(e);}},
 async logout(){if(!await confirmAlert({title:'退出登录？',action:'退出登录',danger:false}))return;try{await this.call('logoutCurrent');location.assign('/auth/');}catch(e){this.error=errorText(e);}},
 async exportData(){if(this.busy)return;this.busy=true;this.error='';try{this.job=await this.call('createDataExport',this.password);this.password='';}catch(e){this.error=errorText(e);}finally{this.busy=false;}},
 async recover(){this.busy=true;this.error='';try{this.job=await this.call('recoverDataExport',this.password);this.password='';}catch(e){this.error=errorText(e);}finally{this.busy=false;}},
 async refreshExport(){try{this.job=await this.call('getDataExport',this.job.exportId);}catch(e){this.error=errorText(e);}},
 async download(){try{const blob=await this.call('downloadDataExport',this.job.downloadUrl);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='virtual-companion-export.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){this.error=errorText(e);}},
 async openAuthenticator(){await showStView(true);await getEngine().call('drawers','openAccountData');},
 },
};
</script>
<style>
.vc-danger { color: var(--vc-danger); }
</style>
