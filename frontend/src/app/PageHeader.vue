<template>
  <header
    class="vc-header vc-chrome"
    :class="{ 'vc-header--sub': showBack }"
    role="banner"
    data-testid="page-header"
  >
    <!-- 统一页头：返回（可选）+ 标题（一级标题语义）+ 上下文操作。替代
         uni 原生标题栏（navigationStyle: custom），
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

    <span v-if="!showBack" class="vc-header__sigil" aria-hidden="true">
      <i></i>
    </span>

    <view class="vc-header__copy">
      <text class="vc-header__title" role="heading" aria-level="1">
        {{ title }}
      </text>
    </view>

    <view class="vc-header__actions" :class="{ 'has-back': !showBack }">
      <text v-if="!$slots.actions" class="vc-header__trust">AI 陪伴 · 非真人</text>
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
  box-sizing: border-box;
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  min-height: 60px;
  padding: var(--vc-space-2)
    calc(var(--vc-space-4) + env(safe-area-inset-right, 0px))
    var(--vc-space-2)
    calc(var(--vc-space-4) + env(safe-area-inset-left, 0px));
  background: var(--vc-env-raised);
  border-bottom: 1px solid var(--vc-border-env);
  padding-top: calc(var(--vc-space-2) + env(safe-area-inset-top, 0px));
}

.vc-header__back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
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

.vc-header__sigil {
  position: relative;
  display: block;
  width: 15px;
  height: 15px;
  margin: 0 var(--vc-space-1);
  border: 1px solid var(--vc-primary);
  transform: rotate(45deg);
}

.vc-header__sigil i {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4px;
  height: 4px;
  background: var(--vc-primary);
  transform: translate(-50%, -50%);
}

.vc-header__title {
  overflow: hidden;
  color: var(--vc-on-env);
  font-size: var(--vc-text-lg);
  font-weight: 720;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vc-header--sub .vc-header__title {
  font-size: var(--vc-text-lg);
  letter-spacing: -0.01em;
}

.vc-header__actions {
  display: flex;
  align-items: center;
  gap: var(--vc-space-1);
  min-width: 44px;
  justify-content: flex-end;
}

.vc-header__actions.has-back {
  min-width: 0;
}

.vc-header__actions:empty {
  min-width: 0;
}

.vc-header__trust {
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-xs);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

@media (max-width: 340px) {
  .vc-header__trust {
    display: none;
  }
}
</style>
