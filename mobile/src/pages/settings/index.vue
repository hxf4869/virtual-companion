<template>
 <view class="vc-detail-page vc-settings-page" :class="{'is-sheet':section==='home'}">
  <VcAurora />
  <view class="vc-settings-surface">
  <view v-if="section==='home'" class="vc-sheet-handle" aria-hidden="true"></view>
  <view class="vc-subnav"><button role="button" tabindex="0" class="vc-round vc-glass" aria-label="返回" @click="back"><VcIcon :name="section==='home'?'x':'chevron-left'" /></button><text>{{ title }}</text><view class="vc-nav-spacer"></view></view>
  <view class="vc-detail-content">
   <template v-if="section === 'home'">
    <view class="vc-group"><button v-for="entry in entries" :key="entry.id" role="button" tabindex="0" class="vc-field is-link" @click="section=entry.id"><view class="vc-settings-icon"><VcIcon :name="entry.icon" size="var(--vc-icon-sm)" /></view><text>{{ entry.title }}</text><VcIcon name="chevron-right" size="var(--vc-icon-sm)" /></button></view>
    <view class="vc-section"><text class="vc-section-title">酒馆</text><view class="vc-group"><button v-for="entry in tavern" :key="entry.id" role="button" tabindex="0" class="vc-field is-link" @click="drawer(entry.id)"><text>{{ entry.label }}</text><VcIcon name="chevron-right" size="var(--vc-icon-sm)" /></button></view></view>
   </template>
   <template v-else-if="section === 'appearance'">
    <view class="vc-group"><label class="vc-field"><text>外观</text><select :value="theme.mode" aria-label="外观模式" @change="mode($event.target.value)"><option value="auto">自动</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label v-if="themes.length > 1" class="vc-field"><text>主题</text><select :value="theme.themeId" aria-label="主题" @change="setTheme($event.target.value)"><option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option></select></label></view>
    <text v-if="error" class="vc-error" role="alert">{{ error }}</text>
   </template>
   <ModelSettings v-else-if="section === 'models'" ref="activeForm" />
   <VoiceSettings v-else-if="section === 'voice'" ref="activeForm" />
   <AccountSettings v-else-if="section === 'account'" ref="activeForm" />
   <AccountSettings v-else-if="section === 'data'" ref="activeForm" data-mode />
  </view>
  </view>
  <VcOverlays />
 </view>
</template>
<script>
import VcAurora from '../../components/VcAurora.vue';import VcIcon from '../../components/VcIcon.vue';import VcOverlays from '../../components/VcOverlays.vue';
import ModelSettings from '../../settings/ModelSettings.vue';import VoiceSettings from '../../settings/VoiceSettings.vue';import AccountSettings from '../../settings/AccountSettings.vue';
import {getEngine,showStView} from '../../engine/index.mjs';import {themeState,setGlobalTheme,setThemeMode} from '../../theme/store.mjs';import {THEMES} from '../../themes/index.mjs';import {errorText} from '../../ui/actions.mjs';
const ENTRIES=[{id:'appearance',title:'外观',icon:'smile'},{id:'models',title:'模型',icon:'layout-grid'},{id:'voice',title:'语音',icon:'mic'},{id:'account',title:'账户',icon:'user-round'},{id:'data',title:'账户与数据',icon:'book-open'}];
export default{
 components:{VcAurora,VcIcon,VcOverlays,ModelSettings,VoiceSettings,AccountSettings},data:()=>({section:'home',theme:themeState,themes:THEMES,error:'',entries:ENTRIES,tavern:[{id:'left-nav-panel',label:'AI 回复配置'},{id:'AdvancedFormatting',label:'提示词格式'},{id:'WorldInfo',label:'世界书'},{id:'rm_extensions_block',label:'扩展'},{id:'PersonaManagement',label:'人设'},{id:'Backgrounds',label:'背景'},{id:'user-settings-block',label:'界面'},{id:'rm_api_block',label:'API 连接'},{id:'right-nav-panel',label:'角色卡'}]}),
 computed:{title(){return ENTRIES.find(e=>e.id===this.section)?.title || '设置';}},
 onBackPress(){if(this.section!=='home'){this.back();return true;}return false;},
 methods:{
 async back(){if(this.$refs.activeForm?.canLeave && !await this.$refs.activeForm.canLeave())return;if(this.section==='home')uni.navigateBack();else this.section='home';},
 async mode(value){this.error='';try{await getEngine().saveThemeSettings({mode:value});setThemeMode(value);}catch(e){this.error=errorText(e);}},
 async setTheme(value){try{await getEngine().saveThemeSettings({global:value});setGlobalTheme(value);}catch(e){this.error=errorText(e);}},
 async drawer(id){try{await getEngine().call('api','fetchSession');await showStView(true);await getEngine().openDrawer(id);}catch(e){this.error=errorText(e);}},
 },
};
</script>
<style>
.vc-settings-surface { position: relative; }
.is-sheet .vc-settings-surface { position: fixed; top: max(8dvh, var(--vc-nav-height)); bottom: 0; left: 0; right: 0; max-width: var(--vc-reading-max); margin: 0 auto; overflow-y: auto; border-radius: var(--vc-radius-sheet) var(--vc-radius-sheet) 0 0; background: var(--vc-glass-strong); }
.is-sheet .vc-subnav { background: none; }
.vc-sheet-handle { width: 36px; height: 5px; margin: var(--vc-space-xs) auto 0; border-radius: var(--vc-radius-pill); background: var(--vc-fill-2); }
.vc-settings-icon { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: var(--vc-radius-xs); background: var(--vc-accent); color: var(--vc-on-accent); flex: none; }
</style>
