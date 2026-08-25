<template>
  <header class="vc-header" role="banner" data-testid="page-header">
    <!-- 统一页头：返回（可选）+ 标题（一级标题语义）+ 上下文操作。挂在
         暮色环境层上，替代 uni 原生标题栏（navigationStyle: custom），
         消除原生标题与页面标题重复。 -->
    <button
      v-if="showBack"
      type="button"
      class="vc-header__back vc-tap"
      data-testid="page-back"
      :aria-label="backLabel"
      @click="onBack"
    >
      <AppIcon name="back" :size="20" />
    </button>

    <view class="vc-header__copy">
      <text
        v-if="eyebrow"
        class="vc-header__eyebrow"
        data-testid="page-header-eyebrow"
      >
        {{ eyebrow }}
      </text>
      <text class="vc-header__title" role="heading" aria-level="1">
        {{ title }}
      </text>
    </view>

    <view class="vc-header__actions" :class="{ 'has-back': !showBack }">
      <slot name="actions" />
    </view>
  </header>
</template>

<script lang="ts">
import { defineComponent } from "vue";

import AppIcon from "@/design-system/AppIcon.vue";

import { goBack } from "./navigate";

export default defineComponent({
  name: "PageHeader",
  components: { AppIcon },
  props: {
    title: {
      type: String,
      required: true,
    },
    /** 页面上方的小字说明（内部页"内部"标识等）；消费者页不使用。 */
    eyebrow: {
      type: String,
      default: "",
    },
    showBack: {
      type: Boolean,
      default: false,
    },
    backLabel: {
      type: String,
      default: "返回上一页",
    },
    backFallback: {
      type: String,
      default: undefined,
    },
  },
  setup(props) {
    function onBack(): void {
      goBack(props.backFallback);
    }
    return { onBack };
  },
});
</script>

<style scoped>
.vc-header {
  position: sticky;
  top: 0;
  z-index: var(--vc-z-header);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--vc-space-2);
  max-width: 720px;
  margin: 0 auto;
  padding: var(--vc-space-2)
    calc(var(--vc-space-3) + env(safe-area-inset-left, 0px))
    var(--vc-space-2)
    calc(var(--vc-space-2) + env(safe-area-inset-left, 0px));
  background: var(--vc-env-raised);
  border-bottom: 1px solid var(--vc-border-env);
  padding-top: calc(var(--vc-space-2) + env(safe-area-inset-top, 0px));
}

.vc-header__back {
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
  color: var(--vc-on-env);
}

.vc-header__back::after {
  border: 0;
}

.vc-header__copy {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: var(--vc-space-2);
}

.vc-header__title {
  overflow: hidden;
  color: var(--vc-on-env);
  font-size: var(--vc-text-lg);
  font-weight: 650;
  letter-spacing: 0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vc-header__eyebrow {
  flex: 0 0 auto;
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.vc-header__actions {
  display: flex;
  align-items: center;
  gap: var(--vc-space-1);
  min-width: 40px;
  justify-content: flex-end;
}

.vc-header__actions.has-back {
  min-width: 0;
}

.vc-header__actions:empty {
  min-width: 0;
}
</style>
