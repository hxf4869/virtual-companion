<template>
  <!-- Direction contract: Warm Familiarity, Stitch-approved single-column auth,
       one terracotta primary action, no legacy card/nav/technical surface. -->
  <VcAuthShell
    :show-brand="screen === 'credentials'"
    :show-back="screen !== 'credentials' && screen !== 'recovery-codes'"
    @back="onBack"
  >
    <view v-if="screen === 'credentials'" class="auth-screen">
      <view class="auth-heading">
        <text class="auth-title" role="heading" aria-level="1">登录</text>
        <text class="auth-lead">登录后，继续和 AI 陪伴者的对话。AI 陪伴者 · 非真人。</text>
      </view>

      <view class="auth-form">
        <VcAuthField
          v-model="account"
          field-id="login-account"
          label="账号"
          kind="text"
          autocomplete="username"
          placeholder="输入用户名或邮箱"
          :disabled="submitting"
          test-id="account"
        />
        <VcAuthField
          v-model="password"
          field-id="login-password"
          label="密码"
          kind="password"
          autocomplete="current-password"
          placeholder="输入密码"
          :maxlength="1024"
          :disabled="submitting"
          :error="passwordError"
          test-id="password"
          @submit="submitCredentials"
        />

        <view v-if="message" class="auth-error" role="alert" data-testid="error">
          {{ message }}
        </view>

        <wd-button
          block
          size="large"
          :loading="submitting"
          :disabled="!canSubmitCredentials || submitting"
          data-testid="submit"
          :aria-busy="submitting ? 'true' : 'false'"
          @click="submitCredentials"
        >
          继续
        </wd-button>
      </view>
    </view>

    <view v-else-if="screen === 'totp'" class="auth-screen">
      <view class="auth-heading">
        <text class="auth-title" role="heading" aria-level="1">验证登录</text>
        <text class="auth-lead">
          打开你的身份验证器，输入 6 位验证码。
          <text v-if="maskedAccount" class="auth-account">当前账号：{{ maskedAccount }}</text>
        </text>
      </view>

      <view class="auth-form auth-form--verify">
        <VcTotpCodeInput
          v-model="totpCode"
          :error="message"
          :disabled="submitting"
          @submit="submitTotp"
        />
        <view class="auth-trust">
          <VcTrustDevice v-model="trustDevice" :disabled="submitting" />
          <text class="auth-trust__hint">下次仍需输入账号和密码。</text>
        </view>
        <wd-button
          block
          size="large"
          :loading="submitting"
          :disabled="totpCode.length !== 6 || submitting"
          data-testid="totp-submit"
          @click="submitTotp"
        >
          验证并登录
        </wd-button>
        <button
          class="auth-secondary-action"
          type="button"
          :disabled="submitting"
          data-testid="use-recovery-code"
          @click="openRecoveryCode"
        >
          使用恢复码
        </button>
      </view>
    </view>

    <view v-else-if="screen === 'recovery'" class="auth-screen">
      <view class="auth-heading">
        <text class="auth-title" role="heading" aria-level="1">使用恢复码</text>
        <text class="auth-lead">输入你保存的一次性恢复码，完成本次登录。</text>
      </view>

      <view class="auth-form">
        <VcAuthField
          v-model="recoveryCode"
          field-id="recovery-code"
          label="恢复码"
          kind="text"
          autocomplete="one-time-code"
          placeholder="例如 ABCD-EFGH-IJKL-MNOP"
          :maxlength="32"
          :disabled="submitting"
          test-id="recovery-code"
          @submit="submitRecoveryCode"
        />
        <view v-if="message" class="auth-error" role="alert">{{ message }}</view>
        <view class="auth-trust">
          <VcTrustDevice v-model="trustDevice" :disabled="submitting" />
          <text class="auth-trust__hint">下次仍需输入账号和密码。</text>
        </view>
        <wd-button
          block
          size="large"
          :loading="submitting"
          :disabled="recoveryCode.trim().length === 0 || submitting"
          data-testid="recovery-submit"
          @click="submitRecoveryCode"
        >
          使用恢复码登录
        </wd-button>
      </view>
    </view>

    <view v-else-if="screen === 'setup-loading'" class="auth-loading" role="status">
      <text class="auth-title" role="heading" aria-level="1">设置身份验证器</text>
      <text class="auth-lead">正在准备二维码…</text>
    </view>

    <!-- VC-R166: 二维码暂时没有加载出来（503/网络/超时）不是「验证已失效」：
         如实说明并可重试；只有挑战真正不可用才进 expired。 -->
    <view v-else-if="screen === 'setup-error'" class="auth-status">
      <text class="auth-title" role="heading" aria-level="1">设置身份验证器</text>
      <text class="auth-lead" role="alert" data-testid="setup-load-error">
        二维码暂时没有加载出来，请检查网络后重试。
      </text>
      <wd-button block size="large" data-testid="setup-retry" @click="loadSetup">
        重新加载二维码
      </wd-button>
      <wd-button block size="large" variant="plain" @click="resetToLogin">
        返回登录
      </wd-button>
    </view>

    <VcAuthenticatorSetup
      v-else-if="screen === 'setup' && auth.authenticatorSetup"
      :setup="auth.authenticatorSetup"
      :code="totpCode"
      :trust-device="trustDevice"
      :submitting="submitting"
      :error="message"
      :copy-message="copyMessage"
      @update:code="totpCode = $event"
      @update:trust-device="trustDevice = $event"
      @copy-key="copyAuthenticatorKey"
      @confirm="submitAuthenticatorSetup"
    />

    <VcRecoveryCodeCard
      v-else-if="screen === 'recovery-codes'"
      :codes="auth.recoveryCodes"
      :copy-message="copyMessage"
      @copy="copyRecoveryCodes"
      @continue="finishRecoveryCodes"
    />

    <view v-else-if="screen === 'admission'" class="auth-status">
      <view class="auth-status__mark" aria-hidden="true" />
      <text class="auth-title" role="heading" aria-level="1">{{ admission.title }}</text>
      <text class="auth-lead">{{ admission.description }}</text>
      <wd-button block size="large" variant="plain" @click="resetToLogin">
        返回登录
      </wd-button>
    </view>

    <view v-else class="auth-status">
      <text class="auth-title" role="heading" aria-level="1">本次登录已结束</text>
      <text class="auth-lead">本次登录验证已失效，请重新输入账号和密码。</text>
      <wd-button block size="large" @click="resetToLogin">重新登录</wd-button>
    </view>

    <template v-if="screen === 'credentials' && !auth.registrationEnabled" #footer>
      <text>注册暂未开放。</text>
    </template>
  </VcAuthShell>
</template>

<script setup lang="ts">
import { getUniApi } from "@/platform/uni-api";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import VcAuthenticatorSetup from "@/components/auth/VcAuthenticatorSetup.vue";
import VcAuthField from "@/components/auth/VcAuthField.vue";
import VcAuthShell from "@/components/auth/VcAuthShell.vue";
import VcRecoveryCodeCard from "@/components/auth/VcRecoveryCodeCard.vue";
import VcTotpCodeInput from "@/components/auth/VcTotpCodeInput.vue";
import VcTrustDevice from "@/components/auth/VcTrustDevice.vue";
import {
  hrefFromLocation,
  PASSWORD_CHANGE_HREF,
  resolvePostLoginHref,
} from "@/domain/nav-guard";
import { useAuthStore, type AuthErrorCode } from "@/stores/auth";

type AuthScreen =
  | "credentials"
  | "totp"
  | "recovery"
  | "setup-loading"
  | "setup-error"
  | "setup"
  | "recovery-codes"
  | "admission"
  | "expired";

const auth = useAuthStore();
const screen = ref<AuthScreen>("credentials");
const account = ref("");
const password = ref("");
const totpCode = ref("");
const recoveryCode = ref("");
const trustDevice = ref(false);
const submitting = ref(false);
const message = ref("");
const passwordError = ref("");
const copyMessage = ref("");

const transport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  // 未确立身份时 auth.accountId 为 null：不带期望账号头，登录请求原样发出。
  getAccountId: () => auth.accountId,
      getSessionId: () => auth.getSessionId(),
  getSessionRevision: () => auth.getSessionRevision(),
  onUnauthorized: () => auth.onUnauthorized(),
  onAccountContextChanged: () => {
    void auth.reconcileAccountContext(transport);
  },
});

const canSubmitCredentials = computed(
  () => account.value.trim().length > 0 && password.value.length > 0,
);
const maskedAccount = computed(() => maskAccount(account.value));
const admission = computed(() => {
  switch (auth.nextStep) {
    case "EMAIL_VERIFICATION_REQUIRED":
      return {
        title: "请验证邮箱",
        description: "打开注册邮箱中的验证邮件，完成验证后再回来登录。",
      };
    case "REVIEW_PENDING":
      return {
        title: "账号正在审核",
        description: "邮箱已验证。审核通过后才能聊天，请稍后再回来登录。",
      };
    case "DISABLED":
      return {
        title: "账号暂时不可用",
        description: "这个账号当前无法登录。如有疑问，请联系管理员。",
      };
    case "REJECTED":
      return {
        title: "申请未通过",
        description: "这个账号目前不能使用。如需了解原因，请联系管理员。",
      };
    default:
      return {
        title: "无法继续登录",
        description: "请返回登录后重试。",
      };
  }
});

onMounted(() => {
  void auth.loadRegistrationStatus(transport);
});

// VC-R168: 本页在途登录动作的流程归属（store 异步方法同步入口建立后捕获）。
// 归属检查通过后清空；模式切换/卸载仅作废「仍由本页拥有」的流程——本地
// 归属失效，不中止网络请求，也不撤销任何服务端会话/Cookie。
const inFlightFlow = ref<number | null>(null);

function invalidateInFlight(): void {
  const flow = inFlightFlow.value;
  if (flow === null) return;
  inFlightFlow.value = null;
  auth.invalidateOwnedLoginFlow(flow);
  submitting.value = false;
}

onBeforeUnmount(invalidateInFlight);

async function submitCredentials(): Promise<void> {
  if (submitting.value || !canSubmitCredentials.value) return;
  message.value = "";
  passwordError.value = "";

  const normalizedAccount = account.value.trim().toLowerCase();
  if (password.value.length === 0) {
    passwordError.value = "请输入密码。";
    return;
  }

  submitting.value = true;
  // VC-R168: 先调 store（同步入口已建立流程序）再捕获；await 后先查归属，
  // 再释放 busy/写视图/导航。
  const pending = auth.login(transport, normalizedAccount, password.value);
  const flow = auth.getLoginFlowSeq();
  inFlightFlow.value = flow;
  const next = await pending;
  if (auth.getLoginFlowSeq() !== flow) return;
  inFlightFlow.value = null;
  submitting.value = false;
  if (!next) {
    message.value = auth.error === "invalid-credentials"
      ? "账号或密码不正确，请重新输入。"
      : messageForError(auth.error);
    if (auth.error === "invalid-credentials") await focusField("account");
    return;
  }

  account.value = normalizedAccount;
  if (next === "ACTIVE") {
    navigateAfterLogin();
    return;
  }
  password.value = "";
  totpCode.value = "";
  recoveryCode.value = "";
  trustDevice.value = false;
  copyMessage.value = "";

  if (next === "TOTP_REQUIRED") {
    screen.value = "totp";
    return;
  }
  if (next === "AUTHENTICATOR_SETUP_REQUIRED") {
    await loadSetup();
    return;
  }
  screen.value = "admission";
}

// VC-R166: 首次加载与重试共用一个入口。入口同步置 setup-loading 挡住重复
// 点击；捕获本次 challenge id，await 后已变（返回登录被 reset 或新挑战）则
// 安静丢弃——本页 screen/message 由这里保护，全局 secret/error 由 store 的
// 同款守卫保护。只有 challenge-unavailable 才进 expired；其余失败停留可
// 重试的 setup-error，不再把 503/网络/超时谎报成「验证已失效」。
async function loadSetup(): Promise<void> {
  const challengeAtStart = auth.challengeId;
  // VC-R168: setup 读取不是 mutation（不推进 store 序），但页面卸载/模式
  // 切换作废的正是「仍由本页拥有」的在途读取——登记本页在途标记，归属
  // 成立才处理视图并清标记。
  const flow = auth.getLoginFlowSeq();
  inFlightFlow.value = flow;
  screen.value = "setup-loading";
  const loaded = await auth.loadAuthenticatorSetup(transport);
  if (auth.getLoginFlowSeq() !== flow || auth.challengeId !== challengeAtStart) {
    // 归属已失效（invalidate/reset 已清本页在途标记或作废本流程）：不改
    // 视图、不清他人标记。
    return;
  }
  inFlightFlow.value = null;
  if (loaded) {
    screen.value = "setup";
    return;
  }
  if (auth.error === "challenge-unavailable") {
    screen.value = "expired";
    return;
  }
  screen.value = "setup-error";
}

async function submitTotp(): Promise<void> {
  if (submitting.value || totpCode.value.length !== 6) return;
  message.value = "";
  submitting.value = true;
  // VC-R168: 归属先捕获后 await；迟到结果不得改视图/导航。
  const pending = auth.verifyAuthenticatorCode(transport, totpCode.value, trustDevice.value);
  const flow = auth.getLoginFlowSeq();
  inFlightFlow.value = flow;
  const ok = await pending;
  if (auth.getLoginFlowSeq() !== flow) return;
  inFlightFlow.value = null;
  submitting.value = false;
  if (ok) {
    navigateAfterLogin();
    return;
  }
  if (auth.error === "challenge-unavailable") {
    message.value = "";
    screen.value = "expired";
    return;
  }
  message.value = messageForError(auth.error);
}

async function submitRecoveryCode(): Promise<void> {
  if (submitting.value || recoveryCode.value.trim().length === 0) return;
  message.value = "";
  submitting.value = true;
  // VC-R168: 同 submitTotp——归属先捕获后 await。
  const pending = auth.verifyRecoveryCode(transport, recoveryCode.value, trustDevice.value);
  const flow = auth.getLoginFlowSeq();
  inFlightFlow.value = flow;
  const ok = await pending;
  if (auth.getLoginFlowSeq() !== flow) return;
  inFlightFlow.value = null;
  submitting.value = false;
  if (ok) {
    navigateAfterLogin();
    return;
  }
  if (auth.error === "challenge-unavailable") {
    message.value = "";
    screen.value = "expired";
    return;
  }
  message.value = auth.error === "invalid-code"
    ? "恢复码不正确或已经使用，请检查后重试。"
    : messageForError(auth.error);
}

async function submitAuthenticatorSetup(): Promise<void> {
  if (submitting.value || totpCode.value.length !== 6) return;
  message.value = "";
  submitting.value = true;
  // VC-R168: 同 submitTotp——归属先捕获后 await。
  const pending = auth.confirmAuthenticator(transport, totpCode.value, trustDevice.value);
  const flow = auth.getLoginFlowSeq();
  inFlightFlow.value = flow;
  const ok = await pending;
  if (auth.getLoginFlowSeq() !== flow) return;
  inFlightFlow.value = null;
  submitting.value = false;
  if (!ok) {
    if (auth.error === "challenge-unavailable") {
      message.value = "";
      screen.value = "expired";
      return;
    }
    message.value = messageForError(auth.error);
    return;
  }
  copyMessage.value = "";
  screen.value = "recovery-codes";
}

function openRecoveryCode(): void {
  // VC-R168: totp→recovery 模式切换同样作废仍由本页持有的 TOTP 提交。
  invalidateInFlight();
  message.value = "";
  recoveryCode.value = "";
  screen.value = "recovery";
}

function onBack(): void {
  if (screen.value === "recovery") {
    // VC-R168: recovery→totp 模式切换作废仍由本页持有的恢复码提交；挑战
    // 数据保留，同挑战可改用 TOTP 继续验证。
    invalidateInFlight();
    message.value = "";
    screen.value = "totp";
    return;
  }
  resetToLogin();
}

function resetToLogin(): void {
  inFlightFlow.value = null;
  auth.resetLoginFlow();
  screen.value = "credentials";
  password.value = "";
  totpCode.value = "";
  recoveryCode.value = "";
  trustDevice.value = false;
  submitting.value = false;
  message.value = "";
  passwordError.value = "";
  copyMessage.value = "";
}
function finishRecoveryCodes(): void {
  navigateAfterLogin();
}

function navigateAfterLogin(): void {
  if (auth.passwordMustChange) {
    redirectTo(PASSWORD_CHANGE_HREF);
    return;
  }
  const current = typeof location !== "undefined"
    ? hrefFromLocation(location)
    : "/pages/login/login";
  const returned = resolvePostLoginHref(current, { fallback: "" });
  redirectTo(returned || "/pages/index/index");
}

function redirectTo(url: string): void {
  try {
    const uniApi = getUniApi() as
      | { redirectTo?: (options: { url: string }) => void }
      | undefined;
    if (uniApi?.redirectTo) {
      uniApi.redirectTo({ url });
    } else if (typeof location !== "undefined") {
      location.href = url.startsWith("/pages/") ? `/#${url}` : url;
    }
  } catch {
    // A confirmed session remains valid even when this navigation attempt fails.
  }
}

function copyAuthenticatorKey(): void {
  const key = auth.authenticatorSetup?.manualKey;
  if (!key) return;
  void copyText(key, "密钥已复制");
}

function copyRecoveryCodes(): void {
  if (auth.recoveryCodes.length === 0) return;
  void copyText(auth.recoveryCodes.join("\n"), "恢复码已复制");
}

async function copyText(value: string, successMessage: string): Promise<void> {
  copyMessage.value = "";
  try {
    const uniApi = getUniApi() as
      | { setClipboardData?: (options: { data: string; success?: () => void; fail?: () => void }) => void }
      | undefined;
    if (uniApi?.setClipboardData) {
      await new Promise<void>((resolve, reject) => {
        uniApi.setClipboardData?.({ data: value, success: resolve, fail: reject });
      });
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(value);
    } else {
      throw new Error("clipboard unavailable");
    }
    copyMessage.value = successMessage;
  } catch {
    copyMessage.value = "复制失败，请长按内容复制";
  }
}

function messageForError(code: AuthErrorCode | null): string {
  switch (code) {
    case "invalid-code":
      return "验证码不正确，请重新输入。";
    case "challenge-unavailable":
      return "本次登录验证已失效，请返回后重新登录。";
    case "rate-limited":
      return "尝试次数较多，请稍后再试。";
    case "network-failed":
    case "refresh-failed":
      return "网络连接不稳定，请检查网络后重试。";
    default:
      return "暂时无法完成登录，请稍后再试。";
  }
}

function maskAccount(value: string): string {
  const normalized = value.trim();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return normalized;
  return `${normalized.slice(0, 1)}***${normalized.slice(at)}`;
}

async function focusField(testId: string): Promise<void> {
  await nextTick();
  try {
    if (typeof document === "undefined") return;
    const field = document.querySelector<HTMLInputElement>(
      `[data-testid="${testId}"] input, input[data-testid="${testId}"]`,
    );
    field?.focus();
  } catch {
    // Best effort only; errors still remain visible next to the form.
  }
}
</script>

<style scoped>
.auth-screen,
.auth-status,
.auth-loading {
  display: grid;
  gap: var(--vc-space-6);
  min-width: 0;
}

.auth-heading {
  display: grid;
  gap: var(--vc-space-2);
}

.auth-title {
  color: var(--vc-color-ink);
  font-size: 28px;
  font-weight: 600;
  line-height: 36px;
}

.auth-lead {
  color: var(--vc-color-ink-muted);
  font-size: 15px;
  line-height: 24px;
}

.auth-account {
  display: block;
  margin-top: var(--vc-space-1);
  color: var(--vc-color-ink-muted);
  overflow-wrap: anywhere;
}

.auth-form {
  display: grid;
  gap: var(--vc-space-4);
  min-width: 0;
}

.auth-form--verify {
  gap: var(--vc-space-3);
}

.auth-error {
  color: var(--vc-color-error);
  font-size: 14px;
  line-height: 22px;
}

.auth-secondary-action {
  width: 100%;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 0;
  border-radius: var(--vc-radius-control);
  color: var(--vc-color-primary);
  background: transparent;
  font-size: 15px;
  font-weight: 500;
  line-height: 24px;
}

.auth-secondary-action::after {
  border: 0;
}

.auth-secondary-action:not([disabled]):active {
  background: var(--vc-color-surface-soft);
}

.auth-trust {
  display: grid;
  gap: 0;
}

.auth-trust__hint {
  margin-top: calc(-1 * var(--vc-space-1));
  padding-left: 30px;
  color: var(--vc-color-ink-muted);
  font-size: 12px;
  line-height: 18px;
}

.auth-status {
  align-content: start;
  padding-top: var(--vc-space-4);
}

.auth-status__mark {
  width: 28px;
  height: 4px;
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-secondary);
}

.auth-loading {
  align-content: start;
  padding-top: var(--vc-space-4);
}

@media (min-width: 600px) {
  .auth-screen,
  .auth-status,
  .auth-loading {
    padding-top: var(--vc-space-4);
  }
}
</style>
