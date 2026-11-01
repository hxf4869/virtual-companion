<template>
    <view class="vc-main">
        <VcAurora />
        <VcPageHeader :title="current.label">
            <view class="vc-round vc-glass" role="button" tabindex="0" aria-label="设置"><VcIcon name="settings" /></view>
        </VcPageHeader>
        <view class="vc-content"></view>
        <VcTabBar v-model="tab" />
        <view v-if="engine.stView" class="vc-stview-bar">
            <view class="vc-round vc-glass" role="button" tabindex="0" aria-label="返回" @click="closeSt" @keydown.enter="closeSt"><VcIcon name="chevron-left" /></view>
        </view>
    </view>
</template>
<script>
import VcAurora from '../../components/VcAurora.vue';
import VcIcon from '../../components/VcIcon.vue';
import VcPageHeader from '../../components/VcPageHeader.vue';
import VcTabBar, { TABS } from '../../components/VcTabBar.vue';
import { engineState, showStView } from '../../engine/index.mjs';

// 一级页容器：五个目的地在同一页内切换，二级页（对话、设置）在后续条目以推入方式打开。
export default {
    components: { VcAurora, VcIcon, VcPageHeader, VcTabBar },
    data() { return { tab: 'chat', engine: engineState }; },
    computed: { current() { return TABS.find((t) => t.id === this.tab) || TABS[0]; } },
    methods: { closeSt() { showStView(false); } },
};
</script>
<style>
.vc-main { min-height: 100vh; }
.vc-content { position: relative; z-index: 1; padding: 0 var(--vc-space-md) calc(var(--vc-tabbar-height) + var(--vc-space-xl) + env(safe-area-inset-bottom)); }
.vc-round { width: var(--vc-touch); height: var(--vc-touch); border-radius: var(--vc-radius-pill); display: flex; align-items: center; justify-content: center; color: var(--vc-ink); }
.vc-stview-bar { position: fixed; z-index: var(--vc-z-stview-bar); left: var(--vc-space-md); top: calc(env(safe-area-inset-top) + var(--vc-space-xs)); }
</style>
