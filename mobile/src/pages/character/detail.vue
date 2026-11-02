<template>
    <view class="vc-detail-page">
        <VcAurora />
        <view class="vc-subnav"><button role="button" tabindex="0" class="vc-round vc-glass" aria-label="返回" @click="back"><VcIcon name="chevron-left" /></button><text>{{ card?.name || '角色' }}</text><view class="vc-nav-spacer"></view></view>
        <view class="vc-detail-content">
            <view v-if="error" class="vc-empty"><text>{{ error }}</text><button role="button" tabindex="0" class="vc-plain-btn" @click="load">重试</button></view>
            <template v-if="card">
                <image class="vc-character-cover" :src="image(card.avatar)" mode="aspectFill" />
                <text class="vc-character-description" selectable>{{ card.description }}</text>
                <view class="vc-section"><text class="vc-section-title">实例</text><view class="vc-group">
                    <button v-for="rel in instances" :key="rel.relationshipId" role="button" tabindex="0" class="vc-field is-link" @click="talk(rel)"><text>{{ rel.companionName || card.name }}</text><VcIcon name="chevron-right" size="var(--vc-icon-sm)" /></button>
                    <button role="button" tabindex="0" class="vc-field is-link" @click="creating = true"><VcIcon name="plus" /><text>新建实例</text></button>
                </view></view>
                <view v-if="creating" class="vc-group vc-section"><label class="vc-field"><text>实例名称</text><input v-field-label v-model="instanceName" :maxlength="32" aria-label="实例名称" /></label><button role="button" tabindex="0" class="vc-plain-btn" :disabled="busy" :aria-disabled="busy" @click="create">开始聊天</button></view>
                <view class="vc-section"><text class="vc-section-title">外观</text><view class="vc-group"><label class="vc-field"><text>角色主题</text><select v-model="theme" aria-label="角色主题" @change="saveTheme"><option value="">跟随全局</option><option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option></select></label>
                    <label class="vc-field"><text>{{ backgroundCopy.title }}</text><select v-model="backgroundMode" :aria-label="backgroundCopy.title" :disabled="backgroundBusy" @change="changeBackgroundMode"><option value="aurora">{{ backgroundCopy.aurora }}</option><option value="scene">{{ backgroundCopy.scene }}</option></select></label>
                </view>
                <view v-if="backgroundMode==='scene'" class="vc-background-picker" :aria-busy="backgroundBusy||backgroundLoading">
                    <text v-if="backgroundLoading" class="vc-value" role="status">正在加载…</text>
                    <view v-else-if="backgroundFiles.length" class="vc-background-grid"><button v-for="(file,i) in backgroundFiles" :key="file" role="button" tabindex="0" class="vc-background-choice" :class="{'is-selected':background===file}" :aria-label="`场景背景 ${i+1}`" :aria-pressed="background===file" :disabled="backgroundBusy" :aria-disabled="backgroundBusy" :data-background-file="file" @click="saveBackground(file)"><image :src="backgroundImage(file)" class="vc-background-thumb" mode="aspectFill" /></button></view>
                    <text v-else class="vc-value">{{ backgroundCopy.empty }}</text>
                    <button role="button" tabindex="0" class="vc-plain-btn vc-background-upload" :disabled="backgroundBusy" :aria-disabled="backgroundBusy" @click="fileElement?.click()"><VcIcon name="plus" size="var(--vc-icon-sm)" />{{ backgroundBusy ? backgroundCopy.saving : backgroundCopy.upload }}</button>
                </view>
                <view v-if="backgroundError" class="vc-error" role="alert"><text>{{ backgroundError }}</text><button v-if="backgroundMode==='scene'" role="button" tabindex="0" class="vc-plain-btn" :disabled="backgroundLoading||backgroundBusy" @click="loadBackgrounds">重试</button></view>
                </view>
                <button role="button" tabindex="0" class="vc-plain-btn" @click="inspectCard">角色卡</button>
            </template>
        </view>
        <VcOverlays />
    </view>
</template>
<script>
import VcAurora from '../../components/VcAurora.vue';import VcIcon from '../../components/VcIcon.vue';import VcOverlays from '../../components/VcOverlays.vue';
import {getEngine,getServer,showStView} from '../../engine/index.mjs';import {avatarUrl} from '../../ui/tint.mjs';import {THEMES} from '../../themes/index.mjs';import {reportError,errorText} from '../../ui/actions.mjs';
import {BACKGROUND_COPY} from '../../copy.mjs';import {BACKGROUND_FIELD,backgroundFile,backgroundThumbnail,prepareBackgroundUpload} from '../../theme/background.mjs';
export default {
    components:{VcAurora,VcIcon,VcOverlays},data:()=>({avatar:'',card:null,relationships:[],theme:'',themes:THEMES,creating:false,instanceName:'',busy:false,error:'',backgroundCopy:BACKGROUND_COPY,background:'',backgroundMode:'aurora',backgroundFiles:[],backgroundLoading:false,backgroundBusy:false,backgroundError:''}),
    computed:{instances(){const ref=this.card?.data?.extensions?.vc_character_ref || getEngine().card(this.avatar)?.characterRef;return ref?this.relationships.filter(r=>r.characterRef===ref):[];}},
    onLoad(o){this.avatar=o.avatar||'';this.load();},
    mounted(){this.fileElement=document.createElement('input');this.fileElement.type='file';this.fileElement.accept='image/png,image/jpeg,image/webp';this.fileElement.hidden=true;this.fileElement.setAttribute('aria-label',BACKGROUND_COPY.upload);this.fileElement.addEventListener('change',this.uploadBackground);this.$el.appendChild(this.fileElement);},
    beforeUnmount(){this.fileElement?.remove();},
    methods:{
        image:avatarUrl,back(){uni.navigateBack();},
        async load(){this.error='';try{this.card=(await getServer().characters()).find(c=>c.avatar===this.avatar);this.theme=this.card?.data?.extensions?.vc_theme || '';this.background=backgroundFile(this.card?.data?.extensions?.[BACKGROUND_FIELD]);this.backgroundMode=this.background?'scene':'aurora';if(this.background)void this.loadBackgrounds();this.relationships=await getEngine().call('api','fetchRelationships');}catch(e){this.error='没有完成，请重试。';}},
        async saveTheme(){try{await getEngine().saveCharacterTheme(this.theme,this.avatar);}catch(e){reportError(e);}},
        backgroundImage:backgroundThumbnail,
        async loadBackgrounds(){if(this.backgroundLoading)return;this.backgroundLoading=true;this.backgroundError='';try{this.backgroundFiles=await getServer().backgrounds();}catch(e){this.backgroundError=errorText(e);}finally{this.backgroundLoading=false;}},
        async changeBackgroundMode(){if(this.backgroundMode==='aurora')await this.saveBackground('');else if(!this.backgroundFiles.length)await this.loadBackgrounds();},
        async persistBackground(file){await getServer().saveCharacterBackground(this.avatar,file);await getEngine().refreshCharacters();if(getEngine().card(this.avatar)?.background!==file)throw Error('background readback');this.background=file;this.backgroundMode=file?'scene':'aurora';},
        async saveBackground(file){if(this.backgroundBusy)return;this.backgroundBusy=true;this.backgroundError='';try{await this.persistBackground(file);}catch(e){this.backgroundError=errorText(e);this.backgroundMode=this.background?'scene':'aurora';}finally{this.backgroundBusy=false;}},
        async uploadBackground(e){const file=e.target.files?.[0];e.target.value='';if(!file||this.backgroundBusy)return;this.backgroundBusy=true;this.backgroundError='';let prepared;
            try{prepared=await prepareBackgroundUpload(file);}catch{this.backgroundError=BACKGROUND_COPY.invalidImage;this.backgroundBusy=false;return;}
            try{const saved=await getServer().uploadBackground(prepared);this.backgroundFiles=[saved,...this.backgroundFiles.filter(f=>f!==saved)];await this.persistBackground(saved);}catch(e){this.backgroundError=errorText(e);}finally{this.backgroundBusy=false;}
        },
        async create(){if(this.busy||!this.instanceName.trim())return;this.busy=true;try{const row=await getEngine().createInstance(this.avatar,this.instanceName.trim());this.open(row.file);}catch(e){reportError(e);}finally{this.busy=false;}},
        async talk(rel){try{const rows=await getServer().recentChats(200);const row=rows.find(c=>String(c.binding?.relationshipId)===String(rel.relationshipId));if(row)this.open(row.file);else{const created=await getEngine().createInstance(this.avatar,rel.companionName||this.card.name,rel.relationshipId);this.open(created.file);}}catch(e){reportError(e);}},
        open(file){uni.navigateTo({url:`/pages/chat/conversation?avatar=${encodeURIComponent(this.avatar)}&file=${encodeURIComponent(file)}&name=${encodeURIComponent(this.card.name)}`});},
        async inspectCard(){await getEngine().open(this.avatar,'');await showStView(true);await getEngine().openDrawer('right-nav-panel');},
    },
};
</script>
<style>
.vc-character-cover { display: block; width: min(60vw,240px); height: min(60vw,240px); margin: var(--vc-space-lg) auto; border-radius: var(--vc-radius-xl); background: var(--vc-fill); }
.vc-character-description { display: block; font-size: var(--vc-fs-body); line-height: var(--vc-lh-body); white-space: pre-wrap; max-height: 30vh; overflow: auto; }
.vc-background-picker { margin-top: var(--vc-space-sm); }
.vc-background-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--vc-space-xs); max-height: 40vh; overflow: auto; overscroll-behavior: contain; }
.vc-background-choice { position: relative; min-width: 0; width: 100%; aspect-ratio: 16/9; padding: 0; border: 2px solid var(--vc-separator); border-radius: var(--vc-radius-sm); overflow: hidden; background: var(--vc-fill); }
.vc-background-choice.is-selected { border-color: var(--vc-accent); }
.vc-background-thumb { display: block; position: absolute; inset: 0; width: 100%; height: 100%; }
.vc-background-upload { display: flex; align-items: center; gap: var(--vc-space-xs); }
</style>
