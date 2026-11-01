<template>
    <view class="vc-main">
        <VcAurora />
        <VcPageHeader :title="current.label">
            <button v-if="tab === 'characters'" role="button" tabindex="0" class="vc-round vc-glass" aria-label="导入角色卡" @click="$refs.characters?.pick()"><VcIcon name="plus" /></button>
            <view class="vc-round vc-glass" role="button" tabindex="0" aria-label="设置" @click="settings" @keydown.enter="settings"><VcIcon name="settings" /></view>
        </VcPageHeader>
        <view class="vc-content"><ChatList v-if="tab === 'chat'" ref="chats" /><CharacterList v-else-if="tab === 'characters'" ref="characters" /><MemoryList v-else-if="tab === 'memory'" ref="memory" /><CompanionList v-else-if="tab === 'companion'" ref="companion" /><StoryList v-else-if="tab === 'story'" /></view>
        <VcTabBar :model-value="tab" @update:modelValue="changeTab" />
        <VcOverlays />
    </view>
</template>
<script>
import CharacterList from '../../components/CharacterList.vue';
import MemoryList from '../../components/MemoryList.vue';
import CompanionList from '../../components/CompanionList.vue';
import StoryList from '../../components/StoryList.vue';
import ChatList from '../../components/ChatList.vue';
import VcOverlays from '../../components/VcOverlays.vue';
import VcAurora from '../../components/VcAurora.vue';
import VcIcon from '../../components/VcIcon.vue';
import VcPageHeader from '../../components/VcPageHeader.vue';
import VcTabBar, { TABS } from '../../components/VcTabBar.vue';
import { engineState, showStView } from '../../engine/index.mjs';

// 一级页容器：五个目的地在同一页内切换，二级页（对话、设置）在后续条目以推入方式打开。
export default {
    components: { VcAurora, VcIcon, VcPageHeader, VcTabBar, ChatList, VcOverlays, CharacterList, MemoryList, CompanionList, StoryList },
    data() { return { tab: 'chat', engine: engineState }; },
    onShow() { this.$refs.chats?.load(); },
    computed: { current() { return TABS.find((t) => t.id === this.tab) || TABS[0]; } },
    methods: {
        async changeTab(tab) { const panel=this.$refs[this.tab]; if(panel?.canLeave && !await panel.canLeave())return; this.tab=tab; },
        settings() { uni.navigateTo({ url:'/pages/settings/index' }); },
        closeSt() { showStView(false); },
    },
};
</script>
<style>
.vc-main { min-height: 100vh; }
.vc-content { position: relative; z-index: 1; padding: 0 var(--vc-space-md) calc(var(--vc-tabbar-height) + var(--vc-space-xl) + env(safe-area-inset-bottom)); }
.vc-round { width: var(--vc-touch); height: var(--vc-touch); border-radius: var(--vc-radius-pill); display: flex; align-items: center; justify-content: center; color: var(--vc-ink); }
</style>
