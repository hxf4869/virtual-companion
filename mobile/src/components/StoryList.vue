<template>
    <view class="vc-story-list">
        <button role="button" tabindex="0" class="vc-case" @click="open"><VcIcon name="clapperboard" size="var(--vc-avatar-md)" /><view><text class="vc-case-title">雨夜旅馆：失踪的怀表</text><text class="vc-case-action">进入剧情 ›</text></view></button>
        <text v-if="error" class="vc-error" role="alert">{{ error }}</text>
    </view>
</template>
<script>
import VcIcon from './VcIcon.vue';import {getEngine,showStView} from '../engine/index.mjs';import {errorText} from '../ui/actions.mjs';
export default{components:{VcIcon},data:()=>({error:''}),methods:{async open(){this.error='';try{await getEngine().call('api','fetchSession');await showStView(true);await getEngine().call('shell','requestShellDestination','story');}catch(e){this.error=errorText(e);}}}};
</script>
<style>
.vc-case { width: 100%; aspect-ratio: 16/9; display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: var(--vc-space-lg); border-radius: var(--vc-radius-xl); background: var(--vc-story-cover); color: var(--vc-story-ink); text-align: left; }
.vc-case-title { display: block; font-size: var(--vc-fs-title-2); font-weight: 600; }
.vc-case-action { display: block; margin-top: var(--vc-space-xs); font-size: var(--vc-fs-body); }
</style>
