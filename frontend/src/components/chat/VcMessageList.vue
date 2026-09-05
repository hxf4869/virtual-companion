<template>
  <view
    class="vc-message-list"
    data-testid="history"
    role="region"
    aria-label="消息历史"
    tabindex="0"
    @wheel.passive="$emit('user-intent', $event)"
    @touchmove.passive="$emit('user-intent', $event)"
    @keydown="$emit('user-intent', $event)"
  >
    <button
      v-if="hasMore && messages.length > 0"
      class="vc-message-list__older"
      data-testid="load-more"
      :disabled="busy"
      @click="$emit('load-more')"
    >
      查看更早消息
    </button>

    <view
      v-if="empty"
      class="vc-message-list__empty"
      data-testid="empty-history"
      role="status"
    >
      <text class="vc-message-list__empty-title">从这里开始</text>
      <text class="vc-message-list__empty-copy">想说什么都可以，我会认真听。</text>
    </view>

    <view v-else class="vc-message-list__messages">
      <VcMessageBubble
        v-for="message in messages"
        :key="message.messageId"
        :message="message"
        :companion-name="companionName"
        :streaming="message.messageId === '__streaming__'"
      />
    </view>

    <view
      class="vc-message-list__status"
      data-testid="status"
      role="status"
      aria-live="polite"
    >
      <view v-if="statusText" class="vc-message-list__status-copy" :data-tone="statusTone">
        <view v-if="statusTone === 'progress'" class="vc-message-list__typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </view>
        <text>{{ statusText }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import type { Message } from "@/api/chat";

import VcMessageBubble from "./VcMessageBubble.vue";

defineProps<{
  messages: Message[];
  companionName: string;
  empty: boolean;
  hasMore: boolean;
  busy: boolean;
  statusText?: string;
  statusTone?: "progress" | "muted" | "error";
}>();

defineEmits<{
  (event: "load-more"): void;
  (event: "user-intent", value: Event): void;
}>();
</script>

<style scoped>
.vc-message-list {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: var(--vc-space-5) clamp(16px, 4vw, 20px) var(--vc-space-6);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  outline: none;
  background: var(--vc-color-canvas);
}

.vc-message-list:focus-visible {
  box-shadow: inset 0 0 0 2px var(--vc-color-primary);
}

.vc-message-list__older {
  display: grid;
  place-items: center;
  min-height: 44px;
  margin: 0 auto var(--vc-space-5);
  padding: 0 var(--vc-space-4);
  border: 0;
  border-radius: var(--vc-radius-control);
  color: var(--vc-color-secondary);
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}

.vc-message-list__older::after {
  border: 0;
}

.vc-message-list__older:active {
  background: var(--vc-color-surface-soft);
}

.vc-message-list__messages {
  display: grid;
  gap: var(--vc-space-6);
  min-width: 0;
}

.vc-message-list__empty {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: var(--vc-space-2);
  min-height: 100%;
  padding: var(--vc-space-7) var(--vc-space-4);
  box-sizing: border-box;
  text-align: center;
}

.vc-message-list__empty-title {
  color: var(--vc-color-ink);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
}

.vc-message-list__empty-copy {
  color: var(--vc-color-ink-muted);
  font-size: 14px;
  line-height: 22px;
}

.vc-message-list__status {
  min-height: 32px;
  padding-top: var(--vc-space-4);
}

.vc-message-list__status-copy {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--vc-space-2);
  color: var(--vc-color-ink-muted);
  font-size: 13px;
  line-height: 20px;
}

.vc-message-list__status-copy[data-tone="error"] {
  color: var(--vc-color-error);
}

.vc-message-list__typing {
  display: flex;
  gap: 3px;
}

.vc-message-list__typing i {
  display: block;
  width: 4px;
  height: 4px;
  border-radius: var(--vc-radius-full);
  background: currentColor;
  animation: vc-message-dot 1.1s ease-in-out infinite;
}

.vc-message-list__typing i:nth-child(2) {
  animation-delay: 120ms;
}

.vc-message-list__typing i:nth-child(3) {
  animation-delay: 240ms;
}

@keyframes vc-message-dot {
  0%,
  70%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  35% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .vc-message-list__typing i {
    animation: none;
  }
}
</style>
