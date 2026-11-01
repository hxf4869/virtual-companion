<template>
    <view>
        <VcFeedback /><VcReauth />
        <view v-if="engine.stView" class="vc-stview-bar"><button role="button" tabindex="0" class="vc-st-back vc-glass" aria-label="返回" @click="close"><VcIcon name="chevron-left" /><text>返回聊天</text></button></view>
    </view>
</template>
<script>
import VcFeedback from './VcFeedback.vue';
import VcReauth from './VcReauth.vue';
import VcIcon from './VcIcon.vue';
import { engineState, showStView } from '../engine/index.mjs';
export default { components: { VcFeedback, VcIcon, VcReauth }, data: () => ({ engine: engineState }), methods: { close() { showStView(false); } } };
</script>
<style>
.vc-stview-bar { position: fixed; z-index: var(--vc-z-stview-bar); bottom: calc(var(--vc-space-xs) + env(safe-area-inset-bottom)); left: var(--vc-space-md); }
.vc-st-back { display: flex; align-items: center; gap: var(--vc-space-xxs); min-height: var(--vc-touch); border-radius: var(--vc-radius-pill); color: var(--vc-ink); font-size: var(--vc-fs-subhead); }
</style>
