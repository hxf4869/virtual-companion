<template>
    <view class="vc-header">
        <text class="vc-large-title" role="heading" aria-level="1">{{ title }}</text>
        <view class="vc-header-actions"><slot /></view>
    </view>
</template>
<script>
// 一级页标题：左侧大标题，右侧操作（头像按钮打开设置）。
export default { props: { title: { type: String, required: true } } };
</script>
<style>
.vc-header { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between;
    padding: calc(env(safe-area-inset-top) + var(--vc-space-lg)) var(--vc-space-md) var(--vc-space-sm); }
.vc-large-title { font-size: var(--vc-fs-large-title); font-weight: 700; line-height: var(--vc-lh-title); letter-spacing: -0.01em; }
.vc-header-actions { display: flex; gap: var(--vc-space-xs); }
</style>
