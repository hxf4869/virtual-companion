<template>
  <view class="vc-shell" :data-page="spec.path">
    <!-- Consumer Shell：消费者页面的统一外框。浅色 chrome（页头 + 四
         入口底栏）+ 浅色内容区。tab 根页与二级页渲染底栏（登录态）；
         沉浸式/准入/内部页不消费本组件。 -->
    <PageHeader
      :title="headerTitle"
      :show-back="spec.shell === 'consumer-sub' || spec.shell === 'admission'"
      back-label="返回"
      :back-fallback="backFallback"
    >
      <template v-if="$slots['header-actions']" #actions>
        <slot name="header-actions" />
      </template>
    </PageHeader>

    <view class="vc-shell__main" role="main">
      <slot />
    </view>

    <BottomNav
      v-if="showBottomNav"
      :active="spec.tab ?? 'home'"
    />
  </view>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from "vue";

import { useAuthStore } from "@/stores/auth";

import BottomNav from "./BottomNav.vue";
import PageHeader from "./PageHeader.vue";
import { CONSUMER_TABS, hasBottomNav, routeSpecOf, type RouteSpec } from "./navigation";

export default defineComponent({
  name: "ConsumerShell",
  components: { PageHeader, BottomNav },
  props: {
    /** 当前页面路径（导航模型 key）。 */
    route: {
      type: String,
      required: true,
    },
    /** 覆盖页头标题（默认取导航模型 title）。 */
    title: {
      type: String as PropType<string | undefined>,
      default: undefined,
    },
  },
  setup(props) {
    const auth = useAuthStore();

    const spec = computed<RouteSpec>(() => {
      const resolved = routeSpecOf(props.route);
      if (!resolved) {
        throw new Error(`ConsumerShell: unknown route ${props.route}`);
      }
      return resolved;
    });

    const headerTitle = computed(() => props.title ?? spec.value.title);

    // 返回兜底：二级页回所属 tab 根；线性准入页回首页。
    const backFallback = computed(() => {
      if (spec.value.shell === "admission") return "/pages/index/index";
      const tab = CONSUMER_TABS.find((entry) => entry.key === spec.value.tab);
      return tab?.href ?? "/pages/index/index";
    });

    // 四入口底栏只对已登录会话渲染：匿名访问公开页时不展示通往受保护
    // 页的入口（点击只会被守卫送回登录页，不是诚实的导航）。
    const showBottomNav = computed(
      () =>
        auth.isAuthenticated &&
        spec.value.tab !== null &&
        hasBottomNav(spec.value),
    );

    return { spec, headerTitle, backFallback, showBottomNav };
  },
});
</script>

<style scoped>
.vc-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--vc-env);
}

/* 浅色内容层：页面是一整面浅色内容区，无窗框装饰。 */
.vc-shell__main {
  flex: 1;
  box-sizing: border-box;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: var(--vc-space-4) var(--vc-space-4)
    calc(76px + env(safe-area-inset-bottom, 0px));
  background: var(--vc-paper);
  color: var(--vc-ink);
}

@media (min-width: 768px) {
  .vc-shell__main {
    padding: var(--vc-space-6) var(--vc-space-6)
      calc(84px + env(safe-area-inset-bottom, 0px));
  }
}
</style>
