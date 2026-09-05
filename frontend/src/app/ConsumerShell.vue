<template>
  <view class="vc-shell" :data-page="spec.path">
    <!-- Consumer Shell：消费者页面的统一外框。tab 根页在登录态渲染
         三入口底栏；二级页只保留返回路径，避免重复占用底部空间。 -->
    <PageHeader
      v-if="showHeader"
      :title="headerTitle"
      :show-back="spec.shell === 'consumer-sub' || spec.shell === 'admission'"
      back-label="返回"
      :back-fallback="backFallback"
    >
      <template v-if="$slots['header-actions']" #actions>
        <slot name="header-actions" />
      </template>
    </PageHeader>

    <view
      class="vc-shell__main"
      :class="{
        'vc-shell__main--headerless': !showHeader,
        'vc-shell__main--with-nav': showBottomNav,
      }"
      role="main"
    >
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
    showHeader: {
      type: Boolean,
      default: true,
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

    // 三入口底栏只对已登录的 tab 根页渲染：匿名访问公开页时不展示通往受保护
    // 页的入口（点击只会被守卫送回登录页，不是诚实的导航）。
    const showBottomNav = computed(
      () =>
        auth.isAuthenticated &&
        !auth.passwordMustChange &&
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
  width: 100%;
  max-width: 520px;
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0 auto;
  background: var(--vc-env);
  overflow-x: clip;
}

/* 保持连续内容面；页面自己决定哪些信息需要使用白色表面。 */
.vc-shell__main {
  flex: 1;
  box-sizing: border-box;
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  padding: var(--vc-space-4) clamp(16px, 4vw, 20px)
    calc(var(--vc-space-5) + env(safe-area-inset-bottom, 0px));
  background: var(--vc-paper);
  color: var(--vc-ink);
}

.vc-shell__main--with-nav {
  padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px));
}

.vc-shell__main--headerless {
  padding-top: calc(var(--vc-space-5) + env(safe-area-inset-top, 0px));
}

@media (min-width: 768px) {
  .vc-shell {
    min-height: 100dvh;
    border-right: 1px solid var(--vc-border-env);
    border-left: 1px solid var(--vc-border-env);
  }

  .vc-shell__main {
    padding: var(--vc-space-5) var(--vc-space-5)
      calc(var(--vc-space-5) + env(safe-area-inset-bottom, 0px));
  }

  .vc-shell__main--with-nav {
    padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px));
  }
}
</style>
