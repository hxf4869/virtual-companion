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
                <view class="vc-section"><text class="vc-section-title">外观</text><view class="vc-group"><label class="vc-field"><text>角色主题</text><select v-model="theme" aria-label="角色主题" @change="saveTheme"><option value="">跟随全局</option><option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option></select></label></view></view>
                <button role="button" tabindex="0" class="vc-plain-btn" @click="inspectCard">角色卡</button>
            </template>
        </view>
        <VcOverlays />
    </view>
</template>
<script>
import VcAurora from '../../components/VcAurora.vue';import VcIcon from '../../components/VcIcon.vue';import VcOverlays from '../../components/VcOverlays.vue';
import {getEngine,getServer,showStView} from '../../engine/index.mjs';import {avatarUrl} from '../../ui/tint.mjs';import {THEMES} from '../../themes/index.mjs';import {reportError} from '../../ui/actions.mjs';
export default {
    components:{VcAurora,VcIcon,VcOverlays},data:()=>({avatar:'',card:null,relationships:[],theme:'',themes:THEMES,creating:false,instanceName:'',busy:false,error:''}),
    computed:{instances(){const ref=this.card?.data?.extensions?.vc_character_ref || getEngine().card(this.avatar)?.characterRef;return ref?this.relationships.filter(r=>r.characterRef===ref):[];}},
    onLoad(o){this.avatar=o.avatar||'';this.load();},
    methods:{
        image:avatarUrl,back(){uni.navigateBack();},
        async load(){this.error='';try{this.card=(await getServer().characters()).find(c=>c.avatar===this.avatar);this.theme=this.card?.data?.extensions?.vc_theme || '';this.relationships=await getEngine().call('api','fetchRelationships');}catch(e){this.error='没有完成，请重试。';}},
        async saveTheme(){try{await getEngine().saveCharacterTheme(this.theme,this.avatar);}catch(e){reportError(e);}},
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
</style>
