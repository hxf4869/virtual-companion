<template>
    <view class="vc-tabbar vc-glass" role="tablist">
        <view v-for="t in tabs" :key="t.id" class="vc-tab" :class="{ 'is-on': t.id === modelValue }" role="tab"
            :aria-selected="t.id === modelValue ? 'true' : 'false'" tabindex="0"
            @click="$emit('update:modelValue', t.id)" @keydown.enter="$emit('update:modelValue', t.id)">
            <view class="vc-tab-icon"><VcIcon :name="t.icon" size="var(--vc-icon-tab)" /><text v-if="badges[t.id]" class="vc-badge">{{ badgeText(badges[t.id]) }}</text></view>
            <text class="vc-tab-label">{{ t.label }}</text>
        </view>
    </view>
</template>
<script>
import VcIcon from './VcIcon.vue';

// 悬浮玻璃胶囊标签栏（变体 floating，DESIGN.md §17.3）。图标固定，不随主题换。
export const TABS = [
    { id: 'chat', label: '聊天', icon: 'message-circle' },
    { id: 'characters', label: '角色', icon: 'user-round' },
    { id: 'memory', label: '记忆', icon: 'book-open' },
    { id: 'companion', label: '陪伴', icon: 'heart' },
    { id: 'story', label: '剧情', icon: 'clapperboard' },
];

export default {
    components: { VcIcon },
    props: { modelValue: { type: String, required: true }, badges: { type: Object, default: () => ({}) } },
    emits: ['update:modelValue'],
    data() { return { tabs: TABS }; },
    methods: { badgeText(n) { return n >= 100 ? '99+' : String(n); } },
};
</script>
<style>
.vc-tabbar { position: fixed; z-index: var(--vc-z-tabbar); left: var(--vc-space-md); right: var(--vc-space-md);
    bottom: calc(var(--vc-space-xs) + env(safe-area-inset-bottom)); height: var(--vc-tabbar-height);
    display: flex; align-items: center; padding: 0 var(--vc-space-xxs); border-radius: var(--vc-radius-pill); }
.vc-tab { flex: 1; height: calc(var(--vc-tabbar-height) - var(--vc-space-xs)); display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 2px; border-radius: var(--vc-radius-pill); color: var(--vc-ink-2); transition: transform var(--vc-dur-press) var(--vc-spring), background var(--vc-dur-quick); }
.vc-tab:active { transform: scale(.92); }
.vc-tab.is-on { color: var(--vc-accent); background: var(--vc-glass-strong); }
.vc-tab:focus-visible { outline: 2px solid var(--vc-accent); }
.vc-tab-icon { position: relative; display: flex; }
.vc-tab-label { font-size: var(--vc-fs-tab); line-height: var(--vc-lh-title); }
.vc-badge { position: absolute; top: -6px; left: 14px; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: var(--vc-radius-pill);
    background: var(--vc-danger-fill); color: var(--vc-on-accent); font-size: var(--vc-fs-caption); line-height: 18px; text-align: center; }
</style>
