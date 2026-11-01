<template>
    <view>
        <view v-if="fb.toast" class="vc-toast vc-glass" :class="{ 'is-error': fb.toast.error }" role="status" @click="dismiss">{{ fb.toast.text }}</view>
        <view v-if="fb.alert" class="vc-scrim" @click.self="fb.alert.resolve(false)">
            <view class="vc-alert vc-glass" role="alertdialog" :aria-label="fb.alert.title">
                <text class="vc-alert-title">{{ fb.alert.title }}</text>
                <text v-if="fb.alert.message" class="vc-alert-message">{{ fb.alert.message }}</text>
                <view class="vc-alert-actions">
                    <button class="vc-alert-btn" autofocus @click="fb.alert.resolve(false)">{{ fb.alert.cancel }}</button>
                    <button class="vc-alert-btn" :class="{ 'is-danger': fb.alert.danger }" @click="fb.alert.resolve(true)">{{ fb.alert.action }}</button>
                </view>
            </view>
        </view>
    </view>
</template>
<script>
import { feedback, dismissToast } from '../ui/feedback.mjs';

export default { data() { return { fb: feedback }; }, methods: { dismiss() { dismissToast(); } } };
</script>
<style>
.vc-toast { position: fixed; z-index: var(--vc-z-toast); top: calc(env(safe-area-inset-top) + var(--vc-space-xs)); left: 50%; transform: translateX(-50%);
    max-width: calc(100vw - var(--vc-space-xxl)); padding: var(--vc-space-xs) var(--vc-space-md); border-radius: var(--vc-radius-pill); font-size: var(--vc-fs-subhead); }
.vc-toast.is-error { color: var(--vc-danger); }
.vc-scrim { position: fixed; inset: 0; z-index: var(--vc-z-alert); background: var(--vc-scrim); display: flex; align-items: center; justify-content: center; }
.vc-alert { width: min(280px, calc(100vw - var(--vc-space-xxl))); border-radius: var(--vc-radius-lg); padding: var(--vc-space-lg) var(--vc-space-md) var(--vc-space-sm);
    display: flex; flex-direction: column; gap: var(--vc-space-xs); text-align: center; }
.vc-alert-title { font-size: var(--vc-fs-headline); font-weight: 600; }
.vc-alert-message { font-size: var(--vc-fs-footnote); color: var(--vc-ink-2); }
.vc-alert-actions { display: flex; gap: var(--vc-space-xs); margin-top: var(--vc-space-xs); }
.vc-alert-btn { flex: 1; min-height: var(--vc-touch); border-radius: var(--vc-radius-pill); border: 0; background: var(--vc-fill); color: var(--vc-ink); font-size: var(--vc-fs-body); }
.vc-alert-btn.is-danger { background: var(--vc-danger-fill); color: var(--vc-on-accent); }
.vc-alert-btn:focus-visible { outline: 2px solid var(--vc-accent); }
</style>
