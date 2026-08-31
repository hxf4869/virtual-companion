<template>
  <!-- 线性准入流程只保留 Go Runtime 已实现的内部账号登录。 -->
  <view class="login-page" role="main">
    <view class="login-window">
      <view class="login-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></view>
      <text class="login-title" role="heading" aria-level="1">登录</text>
      <text class="login-lead">
        虚拟陪伴 · Technical Alpha 内部账号。AI 陪伴，非真人。
      </text>

      <view class="login-form">
        <!-- 持久可见标签：不依赖 placeholder/aria-label 承载字段语义。 -->
        <view class="login-field">
          <text class="login-label" data-testid="login-label-username">用户名</text>
          <input
            class="login-input"
            data-testid="username"
            v-model="username"
            placeholder="输入内部用户名"
            aria-label="用户名"
            autocomplete="username"
          />
        </view>
        <view class="login-field">
          <text class="login-label" data-testid="login-label-password">密码</text>
          <input
            class="login-input"
            data-testid="password"
            v-model="password"
            password
            placeholder="输入密码"
            aria-label="密码"
            autocomplete="current-password"
            @keydown.enter="onSubmit"
          />
        </view>
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
import { hrefFromLocation, PASSWORD_CHANGE_HREF, resolvePostLoginHref } from "@/domain/nav-guard";
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

    function redirectHome(url = "/pages/index/index"): void {
      try {
        const uniApi = (globalThis as Record<string, unknown>).uni as
          | { redirectTo?: (options: { url: string }) => void }
          | undefined;
        if (uniApi?.redirectTo) {
          uniApi.redirectTo({ url });
        } else if (typeof location !== "undefined") {
          location.href = url.startsWith("/pages/") ? `/#${url}` : url;
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
          // uni h5 renders <uni-input data-testid="username"> wrapping the
          // native input — focus must land on the real, focusable element
          // (E2E finding: focusing the wrapper is a silent no-op).
          const field =
            document.querySelector<HTMLInputElement>(
              '[data-testid="username"] input',
            ) ??
            document.querySelector<HTMLInputElement>(
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
        if (store.passwordMustChange) {
          redirectHome(PASSWORD_CHANGE_HREF);
          return;
        }
        const current =
          typeof location !== "undefined" ? hrefFromLocation(location) : "/pages/login/login";
        const returned = resolvePostLoginHref(current, { fallback: "" });
        redirectHome(returned || (await destinationAfterLogin()));
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
    };
  },
});
</script>

<style scoped>
/* 线性准入视觉：浅色卡片式登录窗。窄屏不出现横向溢出。 */
.login-page {
  display: flex;
  justify-content: center;
  box-sizing: border-box;
  min-height: 100vh;
  min-height: 100dvh;
  padding: calc(var(--vc-space-8) + env(safe-area-inset-top, 0px))
    var(--vc-space-4)
    calc(var(--vc-space-7) + env(safe-area-inset-bottom, 0px));
  background: var(--vc-env);
}

.login-window {
  position: relative;
  display: grid;
  gap: var(--vc-space-3);
  box-sizing: border-box;
  width: 100%;
  max-width: 400px;
  align-self: start;
  padding: var(--vc-space-7) var(--vc-space-5);
  border: 0;
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  overflow: hidden;
}

.login-window::before {
  position: absolute;
  inset: 0;
  background: url("/static/quiet-loom/woven-field.png") repeat;
  background-size: 512px 512px;
  content: "";
  mix-blend-mode: multiply;
  opacity: 0.08;
  pointer-events: none;
}

.login-window > * {
  position: relative;
  z-index: 1;
}

.login-title {
  font-size: var(--vc-text-3xl);
  font-weight: 700;
  letter-spacing: -0.025em;
}

.login-mark {
  position: relative;
  width: 40px;
  height: 40px;
  margin-bottom: var(--vc-space-2);
}

.login-mark i {
  position: absolute;
  top: 19px;
  left: 4px;
  width: 32px;
  height: 1px;
  background: var(--vc-primary);
  transform-origin: center;
}

.login-mark i:nth-child(2) { background: var(--vc-success); transform: rotate(45deg); }
.login-mark i:nth-child(3) { background: var(--vc-danger); transform: rotate(90deg); }
.login-mark i:nth-child(4) { transform: rotate(135deg); }

.login-lead {
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  line-height: 1.7;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--vc-space-3);
}

.login-field {
  display: flex;
  flex-direction: column;
  gap: var(--vc-space-1);
}

.login-label {
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.login-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 48px;
  padding: 0 var(--vc-space-3);
  background-color: var(--vc-sunken);
  border: 1px solid var(--vc-border-strong);
  border-radius: 0;
  color: var(--vc-ink);
  font-size: 16px;
}

.login-submit {
  min-height: 48px;
  margin: var(--vc-space-1) 0 0;
  border: 0;
  border-radius: 0;
  background-color: var(--vc-primary);
  color: var(--vc-on-primary);
  font-weight: 600;
  font-size: var(--vc-text-md);
}

.login-submit::after {
  border: 0;
}

.login-submit:not([disabled]):active {
  background-color: var(--vc-primary-hover);
}

.login-error {
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
  overflow-wrap: anywhere;
}

.login-hint {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

</style>
