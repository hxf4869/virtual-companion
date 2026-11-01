<template>
    <view class="vc-avatar" :style="style" aria-hidden="true">
        <image v-if="src && !broken" class="vc-avatar-img" :src="src" mode="aspectFill" @error="broken = true" />
        <text v-else class="vc-avatar-initial">{{ initial }}</text>
    </view>
</template>
<script>
import { avatarUrl, tintOf } from '../ui/tint.mjs';

// 头像 + 角色氛围色光环；图片不可用时显示首字。
export default {
    props: { avatar: { type: String, default: '' }, name: { type: String, default: '' }, size: { type: String, default: 'var(--vc-avatar-md)' }, halo: { type: Boolean, default: true } },
    data() { return { tint: '', broken: false }; },
    computed: {
        src() { return avatarUrl(this.avatar); },
        initial() { return [...(this.name || '?')][0]; },
        style() { return { '--vc-avatar-size': this.size, ...(this.halo && this.tint ? { '--vc-avatar-tint': this.tint } : {}) }; },
    },
    watch: { avatar: { immediate: true, handler() { this.broken = false; tintOf(this.src).then((t) => { this.tint = t; }); } } },
};
</script>
<style>
.vc-avatar { position: relative; width: var(--vc-avatar-size); height: var(--vc-avatar-size); flex: none; border-radius: var(--vc-radius-pill);
    background: var(--vc-fill); display: flex; align-items: center; justify-content: center; overflow: hidden;
    box-shadow: 0 0 0 2px rgba(var(--vc-avatar-tint, var(--vc-tint-default)), 0.35), 0 4px 14px rgba(var(--vc-avatar-tint, var(--vc-tint-default)), 0.35); }
.vc-avatar-img { width: 100%; height: 100%; }
.vc-avatar-initial { font-size: var(--vc-fs-headline); font-weight: 600; color: var(--vc-ink-2); }
</style>
