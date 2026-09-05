<template>
  <button
    class="vc-session-preview"
    type="button"
    data-testid="session-preview"
    :aria-label="`打开对话：${title}`"
    @click="$emit('open')"
  >
    <view class="vc-session-preview__copy">
      <text class="vc-session-preview__title">{{ title }}</text>
      <text v-if="preview" class="vc-session-preview__preview">{{ preview }}</text>
    </view>
    <view class="vc-session-preview__meta">
      <text v-if="time">{{ time }}</text>
      <AppIcon name="chevron-right" :size="16" />
    </view>
  </button>
</template>

<script setup lang="ts">
import AppIcon from "@/design-system/AppIcon.vue";

defineProps<{
  title: string;
  preview?: string | null;
  time?: string;
}>();

defineEmits<{
  (event: "open"): void;
}>();
</script>

<style scoped>
.vc-session-preview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--vc-space-3);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 64px;
  margin: 0;
  padding: var(--vc-space-3) 0;
  border: 0;
  border-bottom: 1px solid var(--vc-color-hairline);
  border-radius: 0;
  color: var(--vc-color-ink);
  background: transparent;
  font: inherit;
  text-align: left;
}

.vc-session-preview::after {
  border: 0;
}

.vc-session-preview__copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.vc-session-preview__title,
.vc-session-preview__preview {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vc-session-preview__title {
  font-size: 15px;
  font-weight: 500;
  line-height: 22px;
}

.vc-session-preview__preview {
  color: var(--vc-color-ink-muted);
  font-size: 12px;
  line-height: 18px;
}

.vc-session-preview__meta {
  display: flex;
  align-items: center;
  gap: var(--vc-space-2);
  color: var(--vc-color-ink-muted);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}

.vc-session-preview:active {
  background: var(--vc-color-surface-soft);
}

.vc-session-preview:focus-visible {
  outline: 2px solid var(--vc-color-primary);
  outline-offset: -2px;
}
</style>
