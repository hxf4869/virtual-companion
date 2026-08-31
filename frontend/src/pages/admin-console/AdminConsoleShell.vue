<template>
  <view class="ac-shell vc-chrome" :data-page="active">
    <button
      v-if="menuOpen"
      class="ac-scrim"
      aria-label="关闭后台导航"
      @click="menuOpen = false"
    />
    <aside class="ac-rail" :class="{ 'ac-rail--open': menuOpen }" aria-label="后台控制台导航">
      <button class="ac-brand" aria-label="前往运行总览" @click="navigate('/pages/admin/admin')">
        <text class="ac-brand__mark">织</text>
        <text class="ac-brand__copy">
          <text class="ac-brand__name">静默织室</text>
          <text class="ac-brand__caption">Go Runtime 控制台</text>
        </text>
      </button>

      <nav class="ac-nav">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="ac-nav__item"
          :class="{ 'ac-nav__item--active': item.id === active }"
          :aria-current="item.id === active ? 'page' : undefined"
          :data-testid="`admin-nav-${item.id}`"
          @click="navigate(item.href)"
        >
          <AppIcon :name="item.icon" :size="20" />
          <text>{{ item.label }}</text>
        </button>
      </nav>

      <view class="ac-rail__footer">
        <view class="ac-identity">
          <AppIcon name="me" :size="18" />
          <text>管理员 · {{ environmentLabel }}</text>
        </view>
        <button class="ac-footer-action" @click="navigate('/pages/account/account', false)">
          <AppIcon name="back" :size="18" />
          <text>返回应用</text>
        </button>
        <button class="ac-footer-action" :disabled="loggingOut" @click="logout">
          <AppIcon name="logout" :size="18" />
          <text>{{ loggingOut ? "退出中…" : "退出登录" }}</text>
        </button>
      </view>
    </aside>

    <view class="ac-stage">
      <header class="ac-topbar">
        <button class="ac-menu" aria-label="打开后台导航" @click="menuOpen = true">
          <AppIcon name="menu" :size="23" />
        </button>
        <view class="ac-heading">
          <text class="ac-heading__title">{{ title }}</text>
          <text v-if="subtitle" class="ac-heading__subtitle">{{ subtitle }}</text>
        </view>
        <view class="ac-topbar__actions">
          <slot name="actions" />
        </view>
      </header>

      <main class="ac-main">
        <view v-if="accessState === 'checking'" class="ac-state" role="status">
          <AppIcon name="refresh" :size="24" spin />
          <text class="ac-state__title">正在确认后台会话</text>
          <text class="ac-state__copy">会话确认完成后再读取运行数据。</text>
        </view>
        <view v-else-if="accessState === 'unavailable'" class="ac-state" role="alert">
          <AppIcon name="warning" :size="24" />
          <text class="ac-state__title">暂时无法确认会话</text>
          <text class="ac-state__copy">服务或网络不可用。当前不会展示缓存数据，也不会假装已登录。</text>
          <button class="ac-button" data-testid="admin-access-retry" @click="$emit('retry-access')">
            <AppIcon name="refresh" :size="18" />
            重新检查
          </button>
        </view>
        <view v-else-if="accessState === 'forbidden'" class="ac-state" role="alert">
          <AppIcon name="lock" :size="24" />
          <text class="ac-state__title">当前账号不能进入后台</text>
          <text class="ac-state__copy">Go Runtime 的配置接口只接受 ADMIN 角色。</text>
          <button class="ac-button ac-button--quiet" @click="navigate('/pages/account/account', false)">
            返回我的账号
          </button>
        </view>
        <slot v-else />
      </main>
    </view>
  </view>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import AppIcon, { type AppIconName } from "@/design-system/AppIcon.vue";
import { useAuthStore } from "@/stores/auth";

import type { AdminAccessState } from "./useAdminConsole";

export type AdminSection = "overview" | "models" | "routing" | "system";

interface NavItem {
  id: AdminSection;
  label: string;
  href: string;
  icon: AppIconName;
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: "overview", label: "总览", href: "/pages/admin/admin", icon: "dashboard" },
  { id: "models", label: "模型服务", href: "/pages/admin-models/admin-models", icon: "server" },
  { id: "routing", label: "路由策略", href: "/pages/admin-routing/admin-routing", icon: "route" },
  { id: "system", label: "系统状态", href: "/pages/admin-system/admin-system", icon: "activity" },
];

export default defineComponent({
  name: "AdminConsoleShell",
  components: { AppIcon },
  emits: ["retry-access"],
  props: {
    active: { type: String as PropType<AdminSection>, required: true },
    title: { type: String, required: true },
    subtitle: { type: String, default: "" },
    accessState: {
      type: String as PropType<AdminAccessState>,
      default: "checking",
    },
    hasPendingChanges: { type: Boolean, default: false },
  },
  setup(props) {
    const auth = useAuthStore();
    const menuOpen = ref(false);
    const loggingOut = ref(false);
    const environmentLabel = computed(() =>
      typeof location !== "undefined" && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)
        ? "本地环境"
        : "当前环境",
    );
    const currentAdminHref = computed(
      () => NAV_ITEMS.find((item) => item.id === props.active)?.href ?? "",
    );
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    onMounted(() => {
      if (typeof window !== "undefined") window.addEventListener("beforeunload", guardBrowserLeave);
    });
    onBeforeUnmount(() => {
      if (typeof window !== "undefined") window.removeEventListener("beforeunload", guardBrowserLeave);
    });

    function guardBrowserLeave(event: BeforeUnloadEvent): void {
      if (!props.hasPendingChanges) return;
      event.preventDefault();
      event.returnValue = "";
    }

    async function confirmDiscardChanges(): Promise<boolean> {
      if (!props.hasPendingChanges) return true;
      const message = "离开此页面会丢弃“本次变更”中的未保存草稿。";
      const uniApi = (globalThis as Record<string, unknown>).uni as
        | {
          showModal?: (options: {
            title: string;
            content: string;
            confirmText: string;
            cancelText: string;
            success: (result: { confirm?: boolean }) => void;
            fail: () => void;
          }) => void;
        }
        | undefined;
      if (uniApi?.showModal) {
        return new Promise((resolve) => {
          uniApi.showModal?.({
            title: "放弃未保存变更？",
            content: message,
            confirmText: "放弃并离开",
            cancelText: "继续编辑",
            success: (result) => resolve(result.confirm === true),
            fail: () => resolve(false),
          });
        });
      }
      return typeof globalThis.confirm === "function" ? globalThis.confirm(message) : false;
    }

    async function navigate(url: string, replace = true, skipGuard = false): Promise<void> {
      menuOpen.value = false;
      if (url === currentAdminHref.value) return;
      if (!skipGuard && !(await confirmDiscardChanges())) return;
      try {
        const uniApi = (globalThis as Record<string, unknown>).uni as
          | {
            redirectTo?: (options: { url: string }) => void;
            navigateTo?: (options: { url: string }) => void;
          }
          | undefined;
        if (replace && uniApi?.redirectTo) uniApi.redirectTo({ url });
        else if (uniApi?.navigateTo) uniApi.navigateTo({ url });
        else if (typeof location !== "undefined") location.href = `/#${url}`;
      } catch {
        // Presentation-only navigation fallback.
      }
    }

    async function logout(): Promise<void> {
      if (loggingOut.value) return;
      if (!(await confirmDiscardChanges())) return;
      loggingOut.value = true;
      try {
        await auth.logout(transport);
        await navigate("/pages/login/login", true, true);
      } finally {
        loggingOut.value = false;
      }
    }

    return {
      navItems: NAV_ITEMS,
      menuOpen,
      loggingOut,
      environmentLabel,
      navigate,
      logout,
    };
  },
});
</script>
