<template>
  <nav
    class="vc-bottom-nav"
    role="navigation"
    aria-label="主导航"
    data-testid="consumer-tabbar"
  >
    <!-- 四入口 Consumer Shell 底栏：自定义 H5 底栏（非 pages.json 原生
         tabBar），保留 query、深链、返回栈与 uni 导航守卫。活动 tab 用暖光
         顶线 + 文字强调（不只靠颜色：aria-current + 字重）。触摸目标 ≥48px。 -->
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
        <AppIcon :name="TAB_ICONS[tab.key]" :size="22" />
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
  memory: "memory",
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
  grid-template-columns: repeat(4, 1fr);
  max-width: 720px;
  margin: 0 auto;
  padding: var(--vc-space-1) var(--vc-space-2)
    calc(var(--vc-space-1) + env(safe-area-inset-bottom, 0px));
  background: var(--vc-env-raised);
  border-top: 1px solid var(--vc-border-env);
}

.vc-bottom-nav__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 52px;
  margin: 0;
  padding: var(--vc-space-1) var(--vc-space-2);
  border: 0;
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-on-env-muted);
  font: inherit;
  font-size: var(--vc-text-xs);
  line-height: 1.3;
  transition: color var(--vc-motion-fast) var(--vc-ease-out);
}

.vc-bottom-nav__item::after {
  border: 0;
}

.vc-bottom-nav__item.is-active {
  color: var(--vc-on-env);
  font-weight: 600;
}

.vc-bottom-nav__icon {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 24px;
}

/* 暖光顶线：活动 tab 像亮着的窗，稳定出现在同一位置。 */
.vc-bottom-nav__item.is-active .vc-bottom-nav__icon::before {
  position: absolute;
  top: -5px;
  left: 50%;
  width: 18px;
  height: 2px;
  transform: translateX(-50%);
  border-radius: 1px;
  background: var(--vc-glow);
  content: "";
}

.vc-bottom-nav__item.is-active .vc-bottom-nav__icon {
  color: var(--vc-glow);
}

.vc-bottom-nav__label {
  font-size: var(--vc-text-xs);
}
</style>
