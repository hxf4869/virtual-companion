<template>
  <view class="vc-internal vc-chrome" :data-page="spec.path">
    <!-- Internal Shell：ops/admin 独立外壳。同一 token 的中性高密度变体
         ——暮色深底 + 抬升面板，不借用消费者首页的暖纸布局；无消费者底栏。
         入口可见性由导航模型 + nav-guard 守卫；无权限时不渲染页面数据
         轮廓（shouldRenderPageData），本壳只负责已获授权页面的呈现。 -->
    <PageHeader
      :title="headerTitle"
      show-back
      back-label="返回首页"
      back-fallback="/pages/index/index"
    >
      <template v-if="$slots['header-actions']" #actions>
        <slot name="header-actions" />
      </template>
    </PageHeader>

    <view class="vc-internal__main" role="main">
      <slot />
    </view>
  </view>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from "vue";

import PageHeader from "./PageHeader.vue";
import { routeSpecOf, type RouteSpec } from "./navigation";

export default defineComponent({
  name: "InternalShell",
  components: { PageHeader },
  props: {
    route: {
      type: String,
      required: true,
    },
    title: {
      type: String as PropType<string | undefined>,
      default: undefined,
    },
  },
  setup(props) {
    const spec = computed<RouteSpec>(() => {
      const resolved = routeSpecOf(props.route);
      if (!resolved || resolved.shell !== "internal") {
        throw new Error(
          `InternalShell: route ${props.route} is not an internal route`,
        );
      }
      return resolved;
    });
    const headerTitle = computed(() => props.title ?? spec.value.title);
    return { spec, headerTitle };
  },
});
</script>

<style scoped>
.vc-internal {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--vc-env);
}

.vc-internal__main {
  box-sizing: border-box;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--vc-space-4) var(--vc-space-4)
    calc(var(--vc-space-6) + env(safe-area-inset-bottom, 0px));
  color: var(--vc-ink);
  font-size: var(--vc-text-sm);
  line-height: 1.55;
}

@media (min-width: 768px) {
  .vc-internal__main {
    padding: var(--vc-space-5) var(--vc-space-6);
  }
}
</style>
