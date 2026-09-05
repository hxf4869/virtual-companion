<template>
  <nav
    class="vc-bottom-nav vc-chrome"
    role="navigation"
    aria-label="主导航"
    data-testid="consumer-tabbar"
  >
    <!-- 三入口 Consumer Shell 底栏：自定义 H5 底栏（非 pages.json 原生
         tabBar），保留 query、深链、返回栈与 uni 导航守卫。活动 tab 用品牌
         色图标与文字强调（不只靠颜色：aria-current + 字重）。触摸目标 ≥48px。 -->
    <button
      v-for="tab in CONSUMER_TABS"
      :key="tab.key"
      type="button"
      class="vc-bottom-nav__item"
      :class="{ 'is-active': tab.key === active }"
      :data-testid="`tab-${tab.key}`"
      :aria-current="tab.key === active ? 'page' : undefined"
      @click="onTabClick(tab)"
    >
      <span class="vc-bottom-nav__icon" aria-hidden="true">
        <AppIcon :name="TAB_ICONS[tab.key]" :size="20" />
      </span>
      <text class="vc-bottom-nav__label">{{ tab.label }}</text>
    </button>
  </nav>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

import AppIcon, { type AppIconName } from "@/design-system/AppIcon.vue"; // 图标契约见组件 script

import { switchTabTo } from "./navigate";
import { CONSUMER_TABS, type TabDef, type TabKey } from "./navigation";

const TAB_ICONS: Record<TabKey, AppIconName> = {
  home: "home",
  chats: "chats",
  me: "me",
};

export default defineComponent({
  name: "BottomNav",
  components: { AppIcon },
  props: {
    active: {
      type: String as PropType<TabKey>,
      required: true,
      validator: (value: TabKey) =>
        CONSUMER_TABS.some((tab) => tab.key === value),
    },
  },
  setup() {
    function onTabClick(tab: TabDef): void {
      switchTabTo(tab.href);
    }

    return { CONSUMER_TABS, TAB_ICONS, onTabClick };
  },
});
</script>

<style scoped>
.vc-bottom-nav {
  position: fixed;
  z-index: var(--vc-z-nav);
  right: 0;
  bottom: 0;
  left: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  box-sizing: border-box;
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  padding:
    0
    env(safe-area-inset-right, 0px)
    env(safe-area-inset-bottom, 0px)
    env(safe-area-inset-left, 0px);
  background: var(--vc-color-canvas);
  border-top: 1px solid var(--vc-color-hairline);
  border-radius: 0;
}

.vc-bottom-nav__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 52px;
  min-height: 52px;
  margin: 0;
  padding: 3px var(--vc-space-1) 2px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--vc-color-ink-muted);
  font: inherit;
  font-size: var(--vc-text-xs);
  line-height: 1.3;
  transition:
    color var(--vc-motion-fast) var(--vc-ease-out),
    background-color var(--vc-motion-fast) var(--vc-ease-out);
}

.vc-bottom-nav__item::after {
  border: 0;
}

.vc-bottom-nav__item.is-active {
  color: var(--vc-color-primary);
  font-weight: 600;
}

.vc-bottom-nav__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}

.vc-bottom-nav__item.is-active .vc-bottom-nav__icon {
  color: var(--vc-color-primary);
}

.vc-bottom-nav__label {
  font-size: 12px;
  line-height: 16px;
}

.vc-bottom-nav__item:not([disabled]):active {
  background: var(--vc-color-surface-soft);
}

.vc-bottom-nav__item:focus-visible {
  outline: 2px solid var(--vc-color-primary);
  outline-offset: -3px;
}

@media (min-width: 521px) {
  .vc-bottom-nav {
    border-right: 1px solid var(--vc-border-env);
    border-left: 1px solid var(--vc-border-env);
  }
}

</style>
