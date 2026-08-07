<template>
  <view class="login-page">
    <view class="login-header">Virtual Companion · 登录</view>
    <view class="login-form">
      <input
        class="login-input"
        data-testid="username"
        v-model="username"
        placeholder="用户名"
        autocomplete="username"
      />
      <input
        class="login-input"
        data-testid="password"
        v-model="password"
        password
        placeholder="密码"
        autocomplete="current-password"
      />
      <button
        class="login-submit"
        data-testid="submit"
        :disabled="submitting"
        @click="onSubmit"
      >
        {{ submitting ? "登录中…" : "登录" }}
      </button>
      <view v-if="message" class="login-error" data-testid="error">
        <text>{{ message }}</text>
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
import { defineComponent, ref } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";

export default defineComponent({
  name: "LoginPage",
  setup() {
    const store = useAuthStore();
    const username = ref("");
    const password = ref("");
    const submitting = ref(false);
    const message = ref("");

    const transport = createAuthenticatedTransport({
      getAccessToken: () => store.accessToken,
      onUnauthorized: () => store.onUnauthorized(),
    });

    function redirectHome(): void {
      try {
        const uniApi = (globalThis as Record<string, unknown>).uni as
          | { redirectTo?: (options: { url: string }) => void }
          | undefined;
        if (uniApi?.redirectTo) {
          uniApi.redirectTo({ url: "/pages/index/index" });
        } else if (typeof location !== "undefined") {
          location.href = "/pages/index/index";
        }
      } catch {
        // Never let navigation break a successful login transition.
      }
    }

    async function onSubmit(): Promise<void> {
      if (submitting.value) {
        return;
      }
      submitting.value = true;
      message.value = "";
      const ok = await store.login(transport, username.value, password.value);
      submitting.value = false;
      if (ok) {
        redirectHome();
      } else {
        message.value =
          store.error === "network-failed"
            ? "网络错误，请重试"
            : "用户名或密码错误";
      }
    }

    return {
      username,
      password,
      submitting,
      message,
      onSubmit,
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
  font-size: 36rpx;
  font-weight: 600;
  margin-bottom: 40rpx;
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
