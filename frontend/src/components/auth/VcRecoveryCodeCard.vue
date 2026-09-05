<template>
  <view class="vc-recovery-codes">
    <view class="vc-recovery-codes__intro">
      <text class="vc-recovery-codes__title" role="heading" aria-level="1">
        保存恢复码
      </text>
      <text class="vc-recovery-codes__lead">
        无法使用身份验证器时，可以用恢复码登录。每个恢复码只能使用一次。
      </text>
    </view>

    <view class="vc-recovery-codes__list" aria-label="一次性恢复码">
      <text
        v-for="code in codes"
        :key="code"
        class="vc-recovery-codes__code"
        user-select
      >
        {{ code }}
      </text>
    </view>

    <view class="vc-recovery-codes__actions">
      <wd-button
        block
        size="large"
        data-testid="recovery-continue"
        @click="$emit('continue')"
      >
        我已保存，进入首页
      </wd-button>
      <button
        class="vc-recovery-codes__copy"
        type="button"
        @click="$emit('copy')"
      >
        {{ copyMessage || "复制全部恢复码" }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  codes: string[];
  copyMessage?: string;
}>(), {
  copyMessage: "",
});

defineEmits<{
  (event: "copy"): void;
  (event: "continue"): void;
}>();
</script>

<style scoped>
.vc-recovery-codes {
  display: grid;
  gap: var(--vc-space-6);
  min-width: 0;
}

.vc-recovery-codes__intro {
  display: grid;
  gap: var(--vc-space-2);
}

.vc-recovery-codes__title {
  font-size: 28px;
  font-weight: 600;
  line-height: 36px;
}

.vc-recovery-codes__lead {
  color: var(--vc-color-ink-muted);
  font-size: 15px;
  line-height: 24px;
}

.vc-recovery-codes__list {
  display: grid;
  gap: var(--vc-space-1);
  padding: var(--vc-space-3) var(--vc-space-4);
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface-soft);
}

.vc-recovery-codes__code {
  color: var(--vc-color-ink);
  font-family: var(--vc-font-mono);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  line-height: 28px;
  text-align: center;
}

.vc-recovery-codes__actions {
  display: grid;
  gap: var(--vc-space-1);
}

.vc-recovery-codes__copy {
  width: 100%;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 0;
  border-radius: var(--vc-radius-control);
  color: var(--vc-color-primary);
  background: transparent;
  font-size: 15px;
  font-weight: 500;
}

.vc-recovery-codes__copy::after {
  border: 0;
}

.vc-recovery-codes__copy:active {
  background: var(--vc-color-surface-soft);
}
</style>
