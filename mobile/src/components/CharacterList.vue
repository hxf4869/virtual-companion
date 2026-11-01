<template>
    <view>
        <view class="vc-search vc-glass"><VcIcon name="search" size="var(--vc-icon-sm)" /><input v-field-label class="vc-search-input" v-model="query" placeholder="搜索角色" aria-label="搜索角色" /></view>
        <view v-if="error" class="vc-empty"><text>没有完成，请重试。</text><button role="button" tabindex="0" class="vc-plain-btn" @click="load">重试</button></view>
        <view v-else-if="loading" class="vc-empty" aria-busy="true">正在加载…</view>
        <view v-else-if="!shown.length" class="vc-empty"><VcIcon name="user-round" /><text>还没有角色</text><button role="button" tabindex="0" class="vc-plain-btn" @click="pick">导入角色卡</button></view>
        <view v-else class="vc-character-grid">
            <button v-for="ch in shown" :key="ch.avatar" role="button" tabindex="0" class="vc-character-tile" @click="open(ch)">
                <image class="vc-character-image" :src="image(ch.avatar)" mode="aspectFill" />
                <text class="vc-character-name">{{ ch.name }}</text><view class="vc-character-meta"><text>{{ count(ch) }} 个实例</text><VcIcon name="chevron-right" size="var(--vc-icon-sm)" /></view>
            </button>
        </view>
    </view>
</template>
<script>
import VcIcon from './VcIcon.vue';
import {getServer,getEngine} from '../engine/index.mjs';
import {avatarUrl} from '../ui/tint.mjs';
import {reportError} from '../ui/actions.mjs';
export default {
    components:{VcIcon},data:()=>({rows:[],relationships:[],query:'',loading:true,error:false}),
    computed:{shown(){return this.rows.filter(x=>x.name.toLowerCase().includes(this.query.toLowerCase()));}},
    mounted(){
        // uni-input 只支持文本输入类型；H5 文件选择使用原生 file input。
        this.fileElement=document.createElement('input');this.fileElement.type='file';this.fileElement.accept='.png,.json';this.fileElement.hidden=true;this.fileElement.setAttribute('aria-label','导入角色卡');this.fileElement.addEventListener('change',this.importFile);this.$el.appendChild(this.fileElement);
        this.load();
    },
    beforeUnmount(){this.fileElement?.remove();},
    methods:{
        image:avatarUrl,
        count(ch){const ref=ch.data?.extensions?.vc_character_ref;return ref?this.relationships.filter(r=>r.characterRef===ref).length:0;},
        async load(){this.loading=true;this.error=false;try{this.rows=await getServer().characters();this.loading=false;this.relationships=await getEngine().call('api','fetchRelationships');}catch{this.error=true;this.loading=false;}},
        open(ch){uni.navigateTo({url:`/pages/character/detail?avatar=${encodeURIComponent(ch.avatar)}`});},
        pick(){this.fileElement?.click();},
        async importFile(e){const f=e.target.files?.[0];if(!f)return;try{await getEngine().call('api','fetchSession');await getEngine().importCard(f);await this.load();}catch(err){reportError(err);}finally{e.target.value='';}},
    },
};
</script>
<style>
.vc-character-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: var(--vc-space-sm); margin-top: var(--vc-space-md); }
.vc-character-tile { padding: var(--vc-space-sm); background: var(--vc-card); border-radius: var(--vc-radius-xl); color: var(--vc-ink); text-align: left; min-width: 0; width: 100%; }
.vc-character-image { width: 100%; aspect-ratio: 1; height: auto; border-radius: var(--vc-radius-bubble); display: block; background: var(--vc-fill); }
.vc-character-name { display: block; font-size: var(--vc-fs-headline); font-weight: 600; margin-top: var(--vc-space-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-character-meta { display: flex; align-items: center; justify-content: space-between; font-size: var(--vc-fs-footnote); color: var(--vc-ink-2); margin-top: var(--vc-space-xxs); }
.vc-file-input { display: none; }
</style>
