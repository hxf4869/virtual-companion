<template>
  <!-- 线性准入流程：登录。只突出登录本身；凭码开通保持折叠，不与主层级
       竞争。旧的边界台导航入口已随 IA 移除（375px 溢出根因）。 -->
  <view class="login-page" role="main">
    <view class="login-window">
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

        <!-- INVITE (V60): provisioning through a single-use invite code. The
             server fail-closes to 403 while invite-registration-enabled=false;
             the page shows that plain wording instead of guessing. -->
        <button
          class="login-invite-toggle"
          data-testid="invite-toggle"
          :aria-expanded="inviteOpen"
          @click="inviteOpen = !inviteOpen"
        >
          {{ inviteOpen ? "收起凭邀请码开通" : "凭邀请码开通测试账号" }}
        </button>
        <view v-if="inviteOpen" class="login-invite" data-testid="invite-panel">
          <input
            v-model="inviteCode"
            class="login-input"
            data-testid="invite-code"
            placeholder="邀请码"
            aria-label="邀请码"
          />
          <input
            v-model="inviteUsername"
            class="login-input"
            data-testid="invite-username"
            placeholder="用户名"
            aria-label="用户名"
          />
          <input
            v-model="invitePassword"
            class="login-input"
            data-testid="invite-password"
            type="password"
            placeholder="密码"
            aria-label="密码"
            autocomplete="new-password"
          />
          <input
            v-model="inviteDisplayName"
            class="login-input"
            data-testid="invite-display-name"
            placeholder="昵称"
            aria-label="昵称"
          />
          <button
            class="login-submit"
            data-testid="invite-submit"
            :disabled="!canInviteSubmit || submitting"
            @click="onInviteRegister"
          >
            {{ submitting ? "开通中…" : "凭码开通" }}
          </button>
          <view
            v-if="inviteMessage"
            class="login-error"
            data-testid="invite-result"
            role="status"
          >
            <text>{{ inviteMessage }}</text>
          </view>
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

import { AuthHttpError, inviteRegister } from "@/api/auth";
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
    // INVITE (V60): provisioning through a single-use code.
    const inviteOpen = ref(false);
    const inviteCode = ref("");
    const inviteUsername = ref("");
    const invitePassword = ref("");
    const inviteDisplayName = ref("");
    const inviteMessage = ref("");
    const canInviteSubmit = computed(
      () =>
        inviteCode.value.trim().length > 0 &&
        inviteUsername.value.trim().length > 0 &&
        invitePassword.value.length > 0 &&
        inviteDisplayName.value.trim().length > 0,
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

    async function onInviteRegister(): Promise<void> {
      if (submitting.value || !canInviteSubmit.value) {
        return;
      }
      submitting.value = true;
      inviteMessage.value = "";
      try {
        const created = await inviteRegister(transport, {
          code: inviteCode.value.trim(),
          username: inviteUsername.value.trim(),
          password: invitePassword.value,
          displayName: inviteDisplayName.value.trim(),
        });
        inviteMessage.value =
          `开通成功：${created.username}。请用该账号登录。`;
        inviteCode.value = "";
        invitePassword.value = "";
      } catch (e) {
        if (e instanceof AuthHttpError && e.status === 403) {
          inviteMessage.value = "凭码开通未开放。";
        } else if (e instanceof AuthHttpError && (e.status === 400 || e.status === 404)) {
          inviteMessage.value = "邀请码或资料不符合要求，未开通。";
        } else {
          inviteMessage.value = "开通失败，请重试。";
        }
      } finally {
        submitting.value = false;
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
      inviteOpen,
      inviteCode,
      inviteUsername,
      invitePassword,
      inviteDisplayName,
      inviteMessage,
      canInviteSubmit,
      onInviteRegister,
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
  padding: calc(var(--vc-space-7) + env(safe-area-inset-top, 0px))
    var(--vc-space-4)
    calc(var(--vc-space-7) + env(safe-area-inset-bottom, 0px));
  background: var(--vc-env);
}

.login-window {
  display: grid;
  gap: var(--vc-space-3);
  box-sizing: border-box;
  width: 100%;
  max-width: 420px;
  align-self: start;
  padding: var(--vc-space-6);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-l);
  background: var(--vc-card);
  color: var(--vc-ink);
}

.login-title {
  font-size: var(--vc-text-2xl);
  font-weight: 700;
}

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
  border-radius: var(--vc-radius-s);
  color: var(--vc-ink);
  font-size: 16px;
}

.login-submit {
  min-height: 48px;
  margin: var(--vc-space-1) 0 0;
  border: 0;
  border-radius: var(--vc-radius-s);
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

.login-invite-toggle {
  align-self: flex-start;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.login-invite-toggle::after {
  border: 0;
}

.login-invite {
  display: flex;
  flex-direction: column;
  gap: var(--vc-space-3);
  padding-top: var(--vc-space-2);
  border-top: 1px solid var(--vc-border);
}
</style>
