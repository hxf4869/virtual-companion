<template>
  <view v-if="open" class="vc-sheet" data-testid="app-sheet">
    <view
      class="vc-sheet__scrim"
      aria-hidden="true"
      @click="emit('close')"
    ></view>
    <view
      class="vc-sheet__panel"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      data-testid="app-sheet-panel"
    >
      <view class="vc-sheet__head">
        <text class="vc-sheet__title" role="heading" aria-level="2">{{ title }}</text>
        <button
          type="button"
          class="vc-sheet__close vc-tap"
          data-testid="app-sheet-close"
          aria-label="关闭"
          @click="emit('close')"
        >
          <AppIcon name="close" :size="18" />
        </button>
      </view>
      <view class="vc-sheet__body">
        <slot />
      </view>
    </view>
  </view>
</template>

<script lang="ts">
import { defineComponent } from "vue";

import AppIcon from "@/design-system/AppIcon.vue";

export default defineComponent({
  name: "AppSheet",
  components: { AppIcon },
  props: {
    open: {
      type: Boolean,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
  },
  emits: ["close"],
  setup(_, { emit }) {
    return { emit };
  },
});
</script>

<style scoped>
.vc-sheet {
  position: fixed;
  inset: 0;
  z-index: var(--vc-z-overlay);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.vc-sheet__scrim {
  position: absolute;
  inset: 0;
  background: rgba(10, 15, 24, 0.62);
}

.vc-sheet__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  max-height: 82dvh;
  box-sizing: border-box;
  padding: var(--vc-space-4)
    calc(var(--vc-space-4) + env(safe-area-inset-right, 0px))
    calc(var(--vc-space-5) + env(safe-area-inset-bottom, 0px))
    calc(var(--vc-space-4) + env(safe-area-inset-left, 0px));
  border-radius: var(--vc-radius-l) var(--vc-radius-l) 0 0;
  background: var(--vc-paper);
  color: var(--vc-ink);
  box-shadow: 0 -8px 32px rgba(10, 15, 24, 0.35);
}

@media (min-width: 600px) {
  .vc-sheet {
    align-items: center;
  }

  .vc-sheet__panel {
    border-radius: var(--vc-radius-l);
  }
}

.vc-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-3);
  margin-bottom: var(--vc-space-3);
}

.vc-sheet__title {
  font-size: var(--vc-text-lg);
  font-weight: 650;
}

.vc-sheet__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-muted);
}

.vc-sheet__close::after {
  border: 0;
}

.vc-sheet__body {
  min-height: 0;
  overflow-y: auto;
}
</style>
