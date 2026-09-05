<template>
  <view class="vc-chat-shell">
    <header class="vc-chat-shell__header vc-chrome" role="banner">
      <button
        type="button"
        class="vc-chat-shell__icon-button"
        data-testid="nav-conversations"
        aria-label="返回"
        @click="$emit('back')"
      >
        <AppIcon name="back" :size="20" />
      </button>

      <view class="vc-chat-shell__identity">
        <view class="vc-chat-shell__avatar" aria-hidden="true">{{ initial }}</view>
        <view class="vc-chat-shell__identity-copy">
          <text
            class="vc-chat-shell__name"
            role="heading"
            aria-level="1"
            data-testid="chat-companion-name"
          >
            {{ companionName || "聊天" }}
          </text>
          <text class="vc-chat-shell__disclosure" data-testid="chat-ai-label">
            AI 陪伴者 · 非真人
          </text>
        </view>
      </view>

      <button
        type="button"
        class="vc-chat-shell__icon-button"
        data-testid="chat-context-open"
        aria-label="打开聊天选项"
        :aria-expanded="menuOpen ? 'true' : 'false'"
        @click="$emit('menu')"
      >
        <AppIcon name="more" :size="20" />
      </button>
    </header>

    <main class="vc-chat-shell__main" role="main">
      <slot />
    </main>

    <view class="vc-chat-shell__composer">
      <slot name="composer" />
    </view>

    <view v-if="showBottomNav" class="vc-chat-shell__nav-space" aria-hidden="true" />
    <BottomNav v-if="showBottomNav" active="chats" />

    <slot name="overlay" />
  </view>
</template>

<script setup lang="ts">
import { computed } from "vue";

import BottomNav from "@/app/BottomNav.vue";
import AppIcon from "@/design-system/AppIcon.vue";
import { useAuthStore } from "@/stores/auth";

const props = defineProps<{
  companionName: string;
  menuOpen?: boolean;
}>();

defineEmits<{
  (event: "back"): void;
  (event: "menu"): void;
}>();

const auth = useAuthStore();
const showBottomNav = computed(() => auth.isAuthenticated);
const initial = computed(() => props.companionName.trim().slice(0, 1) || "伴");
</script>

<style scoped>
.vc-chat-shell {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  max-width: 520px;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  margin: 0 auto;
  overflow: hidden;
  color: var(--vc-color-ink);
  background: var(--vc-color-canvas);
}

.vc-chat-shell__header {
  z-index: var(--vc-z-header);
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  align-items: center;
  box-sizing: border-box;
  min-height: calc(58px + env(safe-area-inset-top, 0px));
  padding:
    calc(7px + env(safe-area-inset-top, 0px))
    calc(var(--vc-space-2) + env(safe-area-inset-right, 0px))
    7px
    calc(var(--vc-space-2) + env(safe-area-inset-left, 0px));
  border-bottom: 1px solid var(--vc-color-hairline);
  background: var(--vc-color-canvas);
}

.vc-chat-shell__icon-button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--vc-radius-full);
  color: var(--vc-color-ink);
  background: transparent;
}

.vc-chat-shell__icon-button::after {
  border: 0;
}

.vc-chat-shell__icon-button:active {
  background: var(--vc-color-surface-soft);
}

.vc-chat-shell__icon-button:focus-visible {
  outline: 2px solid var(--vc-color-primary);
  outline-offset: -2px;
}

.vc-chat-shell__identity {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--vc-space-2);
  min-width: 0;
  text-align: center;
}

.vc-chat-shell__avatar {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  box-sizing: border-box;
  width: 26px;
  height: 26px;
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-full);
  color: var(--vc-color-primary);
  background: var(--vc-color-surface-soft);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

.vc-chat-shell__identity-copy {
  display: grid;
  min-width: 0;
}

.vc-chat-shell__name,
.vc-chat-shell__disclosure {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vc-chat-shell__name {
  color: var(--vc-color-ink);
  font-size: 15px;
  font-weight: 600;
  line-height: 20px;
}

.vc-chat-shell__disclosure {
  color: var(--vc-color-ink-muted);
  font-size: 10px;
  line-height: 14px;
}

.vc-chat-shell__main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.vc-chat-shell__composer {
  flex: 0 0 auto;
  min-width: 0;
}

.vc-chat-shell__nav-space {
  flex: 0 0 calc(53px + env(safe-area-inset-bottom, 0px));
  height: calc(53px + env(safe-area-inset-bottom, 0px));
}

@media (min-width: 521px) {
  .vc-chat-shell {
    border-right: 1px solid var(--vc-color-hairline);
    border-left: 1px solid var(--vc-color-hairline);
  }
}
</style>
