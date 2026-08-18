<template>
  <view class="login-page">
    <view class="login-header">
      <text>Virtual Companion · 登录</text>
      <view class="login-header-nav">
        <button
          data-testid="nav-index"
          class="nav-index"
          aria-label="返回边界台"
          @click="goToIndex"
        >
          返回边界台
        </button>
        <button
          data-testid="nav-chat"
          class="nav-index"
          aria-label="离线聊天"
          @click="goToChat"
        >
          离线聊天
        </button>
        <button
          data-testid="nav-memory"
          class="nav-index"
          aria-label="记忆管理"
          @click="goToMemory"
        >
          记忆管理
        </button>
      </view>
    </view>
    <view class="login-form">
      <input
        class="login-input"
        data-testid="username"
        v-model="username"
        placeholder="用户名"
        aria-label="用户名"
        autocomplete="username"
      />
      <input
        class="login-input"
        data-testid="password"
        v-model="password"
        password
        placeholder="密码"
        aria-label="密码"
        autocomplete="current-password"
      />
      <button
        class="login-submit"
        data-testid="submit"
        :disabled="!canSubmit || submitting"
        :aria-busy="submitting"
        @click="onSubmit"
      >
        {{ submitting ? "登录中…" : "登录" }}
      </button>
      <view
        v-if="message"
        class="login-error"
        data-testid="error"
        role="alert"
      >
        <text>{{ message }}</text>
        <text v-if="requestIdCopy" data-testid="login-request-id">{{ requestIdCopy }}</text>
      </view>
      <view class="login-hint">
        <text>内部账号登录 · 凭据经批准渠道注入，不落仓库</text>
      </view>
    </view>
  </view>
</template>

<script lang="ts">
// TASK-0034: minimal H5 login page. Presentation only: the fail-closed rules
// live in the tested auth store and identity API client. On a confirmed login
// the user is sent to the Alpha boundary page; on a server rejection the page
// shows a generic message and never discloses whether the account exists.
// TASK-0105 (P3-04): stable aria-labels, alert semantics on the error region,
// aria-busy while submitting, and focus returns to the username field after a
// failed attempt so keyboard/screen-reader users can correct and resubmit.
import { computed, defineComponent, ref } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import { resolveNextStep } from "@/domain/next-step";
import { requestIdLabel } from "@/domain/request-id";
import { useAgeStore } from "@/stores/age";
import { useAuthStore } from "@/stores/auth";
import { useConsentStore } from "@/stores/consent";
import { useRelationshipStore } from "@/stores/relationship";

export default defineComponent({
  name: "LoginPage",
  setup() {
    const store = useAuthStore();
    const age = useAgeStore();
    const consent = useConsentStore();
    const relStore = useRelationshipStore();
    const username = ref("");
    const password = ref("");
    const submitting = ref(false);
    const message = ref("");
    const requestIdCopy = ref("");
    const canSubmit = computed(
      () => username.value.trim().length > 0 && password.value.length > 0,
    );

    const transport = createAuthenticatedTransport({
      getAccessToken: () => store.accessToken,
      onUnauthorized: () => store.onUnauthorized(),
    });

    function goToIndex(): void {
      navigatePresentation("/pages/index/index");
    }

    function goToChat(): void {
      navigatePresentation("/pages/chat/chat");
    }

    function goToMemory(): void {
      navigatePresentation("/pages/memory/memory");
    }

    function navigatePresentation(url: string): void {
      try {
        const uniApi = (globalThis as Record<string, unknown>).uni as
          | { navigateTo?: (options: { url: string }) => void }
          | undefined;
        if (uniApi?.navigateTo) {
          uniApi.navigateTo({ url });
        } else if (typeof location !== "undefined") {
          location.href = url;
        }
      } catch {
        // Presentation-only navigation; never break login submit/fail.
      }
    }

    function redirectHome(url = "/pages/index/index"): void {
      try {
        const uniApi = (globalThis as Record<string, unknown>).uni as
          | { redirectTo?: (options: { url: string }) => void }
          | undefined;
        if (uniApi?.redirectTo) {
          uniApi.redirectTo({ url });
        } else if (typeof location !== "undefined") {
          location.href = url;
        }
      } catch {
        // Never let navigation break a successful login transition.
      }
    }

    async function destinationAfterLogin(): Promise<string> {
      await Promise.all([age.load(transport), consent.load(transport), relStore.load(transport)]);
      const step = resolveNextStep({
        authenticated: true,
        ageKnown: !age.loadFailed,
        ageState: age.ageState,
        consentKnown: !consent.loadFailed,
        grantedTypes: consent.records.filter((row) => row.granted).map((row) => row.consentType),
        hasCompanion: relStore.relationships.length > 0,
      });
      return step.kind === "ready" ? "/pages/index/index" : step.href;
    }

    /** Move focus back to the username field after a failed attempt (a11y). */
    function focusUsername(): void {
      try {
        if (typeof document !== "undefined") {
          const field = document.querySelector<HTMLInputElement>(
            '[data-testid="username"]',
          );
          field?.focus();
        }
      } catch {
        // Best-effort a11y; never break the login flow.
      }
    }

    async function onSubmit(): Promise<void> {
      if (submitting.value || !canSubmit.value) {
        return;
      }
      submitting.value = true;
      message.value = "";
      requestIdCopy.value = "";
      const ok = await store.login(transport, username.value, password.value);
      submitting.value = false;
      if (ok) {
        redirectHome(await destinationAfterLogin());
      } else {
        message.value =
          store.error === "network-failed"
            ? "网络错误，请重试"
            : "用户名或密码错误";
        requestIdCopy.value = requestIdLabel();
        focusUsername();
      }
    }

    return {
      username,
      password,
      submitting,
      canSubmit,
      message,
      requestIdCopy,
      onSubmit,
      goToIndex,
      goToChat,
      goToMemory,
    };
  },
});
</script>

<style scoped>
.login-page {
  padding: 48rpx;
  background-color: #14213d;
  color: #f5f5f5;
  min-height: 100vh;
}
.login-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  font-size: 36rpx;
  font-weight: 600;
  margin-bottom: 40rpx;
}
.login-header-nav {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.nav-index {
  flex: 0 0 auto;
  font-size: 26rpx;
  font-weight: 400;
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}
.login-input {
  height: 88rpx;
  padding: 0 24rpx;
  background-color: #1c2b4a;
  border-radius: 12rpx;
  color: #f5f5f5;
}
.login-submit {
  margin-top: 12rpx;
  background-color: #2a9d8f;
  color: #ffffff;
}
.login-error {
  color: #e63946;
  font-size: 26rpx;
}
.login-hint {
  opacity: 0.7;
  font-size: 24rpx;
}
</style>
