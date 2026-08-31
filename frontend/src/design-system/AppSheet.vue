<template>
  <view v-if="open" class="vc-sheet" data-testid="app-sheet">
    <view
      class="vc-sheet__scrim"
      aria-hidden="true"
      @click="emit('close')"
    ></view>
    <view
      ref="panelEl"
      class="vc-sheet__panel"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      tabindex="-1"
      data-testid="app-sheet-panel"
      @keydown="onKeydown"
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
import { defineComponent, nextTick, onUnmounted, ref, watch } from "vue";

import AppIcon from "@/design-system/AppIcon.vue";

// MODAL-FOCUS (P1-7)：完整模态焦点管理——打开时焦点移入对话框；Tab /
// Shift+Tab 在对话框内循环，不进入遮罩后的页面；Escape 关闭；关闭后焦点
// 归还触发元素。明确关闭按钮与点击遮罩关闭保留。
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

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
  setup(props, { emit }) {
    const panelEl = ref<unknown>(null);
    let restoreFocusEl: HTMLElement | null = null;

    /** 模板 ref 在 uni-h5 可能是元素或组件实例（带 $el），统一取真实节点。 */
    function panelNode(): HTMLElement | null {
      const raw: unknown = panelEl.value;
      if (raw instanceof HTMLElement) return raw;
      const el = (raw as { $el?: unknown } | null)?.$el;
      return el instanceof HTMLElement ? el : null;
    }

    function focusables(): HTMLElement[] {
      const node = panelNode();
      if (!node) return [];
      return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
      );
    }

    function onKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        emit("close");
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      const active = (document.activeElement as HTMLElement | null) ?? null;
      if (list.length === 0) {
        event.preventDefault();
        panelNode()?.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && (!active || active === first || !panelNode()?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!active || active === last || !panelNode()?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    watch(
      () => props.open,
      (open) => {
        if (open) {
          restoreFocusEl = (document.activeElement as HTMLElement | null) ?? null;
          void nextTick(() => {
            const list = focusables();
            (list[0] ?? panelNode())?.focus();
          });
        } else {
          restoreFocusEl?.focus?.();
          restoreFocusEl = null;
        }
      },
    );

    onUnmounted(() => {
      // 触发者可能已随页面状态消失（focus() 为可选调用），尽力归还焦点。
      restoreFocusEl?.focus?.();
      restoreFocusEl = null;
    });

    return { emit, panelEl, onKeydown };
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
  background: var(--vc-scrim);
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
  background: var(--vc-card);
  color: var(--vc-ink);
  box-shadow: var(--vc-shadow-floating);
}

.vc-sheet__panel:focus-visible {
  outline: none;
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
  font-weight: 600;
}

.vc-sheet__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
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
