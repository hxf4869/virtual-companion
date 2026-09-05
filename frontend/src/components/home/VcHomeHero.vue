<template>
  <view class="vc-home-hero" data-testid="home-hero">
    <view class="vc-home-hero__identity">
      <view class="vc-home-hero__avatar" aria-hidden="true">
        <text>{{ initial }}</text>
        <view class="vc-home-hero__avatar-dot" />
      </view>
      <text
        class="vc-home-hero__name"
        role="heading"
        aria-level="1"
        data-testid="current-relationship"
      >
        {{ companionName }}
      </text>
      <text class="vc-home-hero__disclosure">AI 陪伴者 · 非真人</text>
    </view>

    <view class="vc-home-hero__conversation">
      <text class="vc-home-hero__copy">{{ conversationCopy }}</text>
      <text v-if="activityTime" class="vc-home-hero__time">{{ activityTime }}</text>
    </view>

    <button
      class="vc-home-hero__action"
      type="button"
      :data-testid="hasConversation ? 'home-continue-chat' : 'home-start-chat'"
      @click="$emit('primary')"
    >
      {{ hasConversation ? "继续上次对话" : "开始第一次对话" }}
    </button>
  </view>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  companionName: string;
  conversationCopy: string;
  activityTime?: string;
  hasConversation: boolean;
}>();

defineEmits<{
  (event: "primary"): void;
}>();

const initial = computed(() => props.companionName.trim().slice(0, 1) || "伴");
</script>

<style scoped>
.vc-home-hero {
  display: grid;
  gap: var(--vc-space-6);
  box-sizing: border-box;
  min-width: 0;
  padding: var(--vc-space-6) var(--vc-space-5) var(--vc-space-5);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-hero);
  background: var(--vc-color-surface);
}

.vc-home-hero__identity {
  display: grid;
  justify-items: center;
  gap: var(--vc-space-1);
  min-width: 0;
  text-align: center;
}

.vc-home-hero__avatar {
  position: relative;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 56px;
  height: 56px;
  margin-bottom: var(--vc-space-1);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-full);
  color: var(--vc-color-primary);
  background: var(--vc-color-surface-soft);
  font-size: 20px;
  font-weight: 600;
  line-height: 1;
}

.vc-home-hero__avatar-dot {
  position: absolute;
  right: 1px;
  bottom: 3px;
  box-sizing: border-box;
  width: 11px;
  height: 11px;
  border: 2px solid var(--vc-color-surface);
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-secondary);
}

.vc-home-hero__name {
  max-width: 100%;
  color: var(--vc-color-ink);
  font-size: 22px;
  font-weight: 600;
  line-height: 30px;
  overflow-wrap: anywhere;
}

.vc-home-hero__disclosure {
  color: var(--vc-color-ink-muted);
  font-size: 12px;
  line-height: 18px;
}

.vc-home-hero__conversation {
  display: grid;
  justify-items: center;
  gap: var(--vc-space-2);
  min-width: 0;
  padding: 0 var(--vc-space-2);
  text-align: center;
}

.vc-home-hero__copy {
  display: -webkit-box;
  max-width: 28em;
  overflow: hidden;
  color: var(--vc-color-ink);
  font-size: 16px;
  line-height: 26px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.vc-home-hero__time {
  color: var(--vc-color-ink-muted);
  font-size: 12px;
  line-height: 18px;
}

.vc-home-hero__action {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 48px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 0;
  border-radius: var(--vc-radius-control);
  color: var(--vc-color-surface);
  background: var(--vc-color-primary);
  font: inherit;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
  transition: background-color 140ms ease-out;
}

.vc-home-hero__action::after {
  border: 0;
}

.vc-home-hero__action:active {
  background: var(--vc-color-primary-pressed);
}

.vc-home-hero__action:focus-visible {
  outline: 2px solid var(--vc-color-primary);
  outline-offset: 3px;
}

@media (max-width: 359px) {
  .vc-home-hero {
    gap: var(--vc-space-5);
    padding: var(--vc-space-5) var(--vc-space-4) var(--vc-space-4);
  }
}
</style>
