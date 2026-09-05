<template>
  <ConsumerShell route="/pages/account/account" :show-header="false">
    <view class="profile-page">
      <view class="profile-topbar">
        <text class="profile-topbar__title" role="heading" aria-level="1">我的</text>
        <view class="profile-mark" aria-hidden="true">@</view>
      </view>

      <view
        v-if="auth.sessionStatus === 'unknown'"
        class="profile-state"
        :role="auth.error === 'refresh-failed' ? 'alert' : 'status'"
        data-testid="account-loading"
      >
        <template v-if="auth.error === 'refresh-failed'">
          <text class="profile-state__title">暂时没能打开账号信息</text>
          <text class="profile-state__copy">检查网络后再试一次。</text>
          <button class="secondary-action" data-testid="account-retry" @click="restoreAccount">
            重新加载
          </button>
        </template>
        <template v-else>
          <view class="profile-skeleton profile-skeleton--short" aria-hidden="true" />
          <view class="profile-skeleton" aria-hidden="true" />
          <text class="vc-sr-only">正在加载账号信息</text>
        </template>
      </view>

      <view
        v-else-if="!auth.isAuthenticated"
        class="profile-state"
        data-testid="account-signed-out"
      >
        <text class="profile-state__title">登录后查看账号与安全设置</text>
        <text class="profile-state__copy">你的设置会跟随账号保存。</text>
        <button class="primary-action" data-testid="nav-login" @click="goTo('/pages/login/login')">
          登录
        </button>
      </view>

      <template v-else>
        <view class="profile-identity" data-testid="account-identity">
          <view class="profile-avatar" aria-hidden="true">{{ accountMark }}</view>
          <view class="profile-identity__copy">
            <text class="profile-identity__label">当前账号</text>
            <text class="profile-identity__email" data-testid="account-email">
              {{ auth.email || "已登录账号" }}
            </text>
          </view>
        </view>

        <view
          v-if="auth.passwordMustChange"
          class="required-notice"
          data-testid="password-required"
          role="alert"
        >
          <AppIcon name="lock" :size="18" />
          <text>请先设置一个新密码，再继续使用其他功能。</text>
        </view>

        <section class="settings-section" aria-labelledby="account-section-title">
          <text id="account-section-title" class="settings-section__title">账号</text>
          <view class="settings-list">
            <button
              type="button"
              class="settings-row"
              data-testid="password-toggle"
              :aria-expanded="passwordOpen"
              @click="passwordOpen = !passwordOpen"
            >
              <span class="settings-row__copy">
                <text class="settings-row__label">修改密码</text>
                <text class="settings-row__note">修改后需要重新登录</text>
              </span>
              <AppIcon :name="passwordOpen ? 'arrow-up' : 'chevron-right'" :size="18" />
            </button>

            <view v-if="passwordOpen" class="inline-form" data-testid="password-form">
              <text class="form-label">当前密码</text>
              <input
                v-model="currentPassword"
                class="form-input"
                data-testid="current-password"
                type="password"
                autocomplete="current-password"
                aria-label="当前密码"
              />
              <text class="form-label">新密码</text>
              <input
                v-model="newPassword"
                class="form-input"
                data-testid="new-password"
                type="password"
                autocomplete="new-password"
                aria-label="新密码"
              />
              <text class="form-hint">至少 8 个字符</text>
              <text class="form-label">再次输入新密码</text>
              <input
                v-model="confirmPassword"
                class="form-input"
                data-testid="confirm-password"
                type="password"
                autocomplete="new-password"
                aria-label="再次输入新密码"
              />
              <text
                v-if="passwordMessage"
                class="form-message"
                data-testid="password-message"
                role="alert"
              >
                {{ passwordMessage }}
              </text>
              <button
                type="button"
                class="primary-action primary-action--compact"
                data-testid="change-password"
                :disabled="busy || !canChangePassword"
                @click="onChangePassword"
              >
                {{ busy === "password" ? "修改中…" : "确认修改" }}
              </button>
            </view>
          </view>
        </section>

        <section class="settings-section" aria-labelledby="security-section-title">
          <text id="security-section-title" class="settings-section__title">安全</text>
          <view class="settings-list">
            <view class="security-fact" data-testid="authenticator-status">
              <view
                class="security-fact__icon"
                :class="{ 'security-fact__icon--warning': !auth.authenticatorEnabled }"
                aria-hidden="true"
              >
                <AppIcon name="shield" :size="20" />
              </view>
              <view class="settings-row__copy">
                <text class="settings-row__label">身份验证器</text>
                <text class="settings-row__note">
                  {{ auth.authenticatorEnabled ? "已开启" : "需要设置" }}
                </text>
              </view>
            </view>

            <view class="trusted-devices" data-testid="trusted-devices">
              <view class="trusted-devices__heading">
                <view class="settings-row__copy">
                  <text class="settings-row__label">信任的设备</text>
                  <text class="settings-row__note">登录仍需密码，可免验证身份验证器</text>
                </view>
                <button
                  v-if="deviceState === 'error'"
                  type="button"
                  class="text-action"
                  data-testid="trusted-devices-retry"
                  @click="loadTrustedDevices"
                >
                  重试
                </button>
              </view>

              <text v-if="deviceState === 'loading'" class="device-state" role="status">
                正在加载设备…
              </text>
              <text
                v-else-if="deviceState === 'error'"
                class="device-state device-state--error"
                data-testid="trusted-devices-error"
                role="alert"
              >
                设备没有加载出来。
              </text>
              <text v-else-if="trustedDevices.length === 0" class="device-state">
                暂无信任的设备。
              </text>

              <view
                v-for="device in trustedDevices"
                :key="device.id"
                class="device-row"
                data-testid="trusted-device-row"
              >
                <view class="device-row__copy">
                  <text class="device-row__name">{{ device.displayName }}</text>
                  <text class="device-row__meta">
                    最近使用 {{ formatLocalDateTime(device.lastUsedAt) }}
                  </text>
                  <text class="device-row__meta">
                    {{ formatLocalDateTime(device.expiresAt) }} 到期
                  </text>
                </view>
                <button
                  type="button"
                  class="device-row__revoke"
                  data-testid="trusted-device-revoke"
                  :disabled="busy !== null"
                  @click="onRevokeTrustedDevice(device.id)"
                >
                  {{ busy === `device:${device.id}` ? "撤销中…" : "撤销" }}
                </button>
              </view>

              <text
                v-if="deviceActionError"
                class="device-state device-state--error"
                data-testid="trusted-device-action-error"
                role="alert"
              >
                {{ deviceActionError }}
              </text>
            </view>
          </view>
        </section>

        <section class="settings-section" aria-labelledby="about-section-title">
          <text id="about-section-title" class="settings-section__title">关于</text>
          <view class="settings-list">
            <view class="security-fact" data-testid="ai-identity-note">
              <view class="security-fact__icon" aria-hidden="true">
                <AppIcon name="info" :size="20" />
              </view>
              <view class="settings-row__copy">
                <text class="settings-row__label">AI 陪伴者</text>
                <text class="settings-row__note">回复由 AI 生成，并非真人。</text>
              </view>
            </view>
          </view>
        </section>

        <button
          v-if="auth.role === 'ADMIN'"
          type="button"
          class="admin-entry"
          data-testid="me-admin"
          @click="goTo('/pages/admin/admin')"
        >
          <span>进入管理后台</span>
          <AppIcon name="chevron-right" :size="18" />
        </button>

        <button
          type="button"
          class="logout-action"
          data-testid="account-logout"
          :disabled="busy !== null"
          @click="onLogout"
        >
          <AppIcon name="logout" :size="18" />
          <text>{{ busy === "logout" ? "正在退出…" : "退出登录" }}</text>
        </button>

        <view class="danger-zone">
          <button
            type="button"
            class="danger-zone__toggle"
            data-testid="delete-account-open"
            :aria-expanded="deleteOpen"
            :disabled="busy !== null"
            @click="deleteOpen = !deleteOpen"
          >
            注销账号
          </button>
          <view v-if="deleteOpen" class="danger-zone__confirm" data-testid="delete-account-confirm">
            <text class="danger-zone__title">注销后无法恢复</text>
            <text class="danger-zone__copy">
              聊天等账号数据会被删除；依法需要保留的审计记录会按期限留存。
            </text>
            <text class="form-label">输入当前密码确认</text>
            <input
              v-model="deletePassword"
              class="form-input"
              data-testid="delete-account-password"
              type="password"
              autocomplete="current-password"
              aria-label="注销确认当前密码"
            />
            <text
              v-if="deleteError"
              class="form-message"
              data-testid="delete-account-error"
              role="alert"
            >
              {{ deleteError }}
            </text>
            <view class="danger-zone__actions">
              <button type="button" class="secondary-action" data-testid="delete-account-cancel" @click="closeDelete">
                取消
              </button>
              <button
                type="button"
                class="danger-action"
                data-testid="delete-account-confirm-btn"
                :disabled="busy !== null"
                @click="onConfirmDelete"
              >
                {{ busy === "delete" ? "注销中…" : "确认注销" }}
              </button>
            </view>
          </view>
        </view>
      </template>
    </view>
  </ConsumerShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import {
  changeAuthPassword,
  deleteAccount,
  listTrustedDevices,
  revokeTrustedDevice,
  type TrustedDevice,
} from "@/api/auth";
import { createAuthenticatedTransport } from "@/api/transport";
import { goTo } from "@/app/navigate";
import ConsumerShell from "@/app/ConsumerShell.vue";
import AppIcon from "@/design-system/AppIcon.vue";
import { formatLocalDateTime } from "@/domain/timestamp";
import { useAuthStore } from "@/stores/auth";

type DeviceState = "idle" | "loading" | "ready" | "error";
type BusyAction = "password" | "logout" | "delete" | `device:${string}`;

const auth = useAuthStore();
const passwordOpen = ref(auth.passwordMustChange);
const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const passwordMessage = ref("");
const trustedDevices = ref<TrustedDevice[]>([]);
const deviceState = ref<DeviceState>("idle");
const deviceActionError = ref("");
const deleteOpen = ref(false);
const deletePassword = ref("");
const deleteError = ref("");
const busy = ref<BusyAction | null>(null);

const transport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  onUnauthorized: () => auth.onUnauthorized(),
});

const accountMark = computed(() => {
  const value = auth.email?.trim();
  return value ? value.slice(0, 1).toUpperCase() : "我";
});

const canChangePassword = computed(() => (
  currentPassword.value.length > 0
  && newPassword.value.length >= 8
  && newPassword.value === confirmPassword.value
));

onMounted(restoreAccount);

async function restoreAccount(): Promise<void> {
  if (!auth.isAuthenticated) {
    await auth.tryRefresh(transport);
  }
  if (!auth.isAuthenticated) return;
  if (auth.passwordMustChange) passwordOpen.value = true;
  await loadTrustedDevices();
}

async function loadTrustedDevices(): Promise<void> {
  deviceState.value = "loading";
  deviceActionError.value = "";
  try {
    trustedDevices.value = await listTrustedDevices(transport);
    deviceState.value = "ready";
  } catch {
    deviceState.value = "error";
  }
}

async function onRevokeTrustedDevice(deviceId: string): Promise<void> {
  if (busy.value) return;
  busy.value = `device:${deviceId}`;
  deviceActionError.value = "";
  try {
    if (!await revokeTrustedDevice(transport, deviceId)) {
      deviceActionError.value = "没有撤销成功，请再试一次。";
      return;
    }
    trustedDevices.value = trustedDevices.value.filter((device) => device.id !== deviceId);
  } catch {
    deviceActionError.value = "没有撤销成功，请再试一次。";
  } finally {
    busy.value = null;
  }
}

async function onChangePassword(): Promise<void> {
  if (busy.value || !canChangePassword.value) return;
  busy.value = "password";
  passwordMessage.value = "";
  try {
    const changed = await changeAuthPassword(
      transport,
      currentPassword.value,
      newPassword.value,
    );
    if (!changed) {
      passwordMessage.value = "没有修改成功，请检查当前密码。";
      return;
    }
    auth.clear();
    goTo("/pages/login/login");
  } catch {
    passwordMessage.value = "没有修改成功，请稍后再试。";
  } finally {
    busy.value = null;
  }
}

async function onLogout(): Promise<void> {
  if (busy.value) return;
  busy.value = "logout";
  try {
    await auth.logout(transport);
    goTo("/pages/login/login");
  } finally {
    busy.value = null;
  }
}

function closeDelete(): void {
  deleteOpen.value = false;
  deletePassword.value = "";
  deleteError.value = "";
}

async function onConfirmDelete(): Promise<void> {
  if (busy.value) return;
  if (!deletePassword.value) {
    deleteError.value = "请输入当前密码。";
    return;
  }
  busy.value = "delete";
  deleteError.value = "";
  try {
    if (!await deleteAccount(transport, deletePassword.value)) {
      deleteError.value = "当前密码不正确，账号没有注销。";
      return;
    }
    auth.clear();
    goTo("/pages/login/login");
  } catch {
    deleteError.value = "暂时无法注销，请稍后再试。";
  } finally {
    busy.value = null;
  }
}
</script>

<style scoped>
.profile-page {
  width: 100%;
  padding-bottom: var(--vc-space-4);
}

.profile-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  margin-bottom: var(--vc-space-5);
}

.profile-topbar__title {
  font-size: 24px;
  font-weight: 650;
  line-height: 32px;
}

.profile-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface);
  color: var(--vc-color-primary);
  font-size: 15px;
  font-weight: 700;
}

.profile-identity {
  display: flex;
  align-items: center;
  gap: var(--vc-space-3);
  min-width: 0;
  margin-bottom: var(--vc-space-6);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-hero);
  background: var(--vc-color-surface);
}

.profile-avatar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-primary);
  font-size: 18px;
  font-weight: 650;
}

.profile-identity__copy,
.settings-row__copy,
.device-row__copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  text-align: left;
}

.profile-identity__label,
.settings-row__note,
.device-row__meta,
.form-hint,
.profile-state__copy,
.danger-zone__copy {
  color: var(--vc-color-ink-muted);
  font-size: 12px;
  line-height: 18px;
}

.profile-identity__email {
  overflow-wrap: anywhere;
  color: var(--vc-color-ink);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.required-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--vc-space-2);
  margin-bottom: var(--vc-space-5);
  padding: var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-primary);
  font-size: 13px;
  line-height: 20px;
}

.settings-section {
  display: block;
  margin-bottom: var(--vc-space-5);
}

.settings-section__title {
  display: block;
  margin: 0 0 var(--vc-space-2) var(--vc-space-1);
  color: var(--vc-color-ink-muted);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.settings-list {
  overflow: hidden;
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface);
}

.settings-row,
.security-fact,
.trusted-devices {
  width: 100%;
  margin: 0;
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--vc-color-ink);
  font: inherit;
}

.settings-row,
.security-fact {
  display: flex;
  align-items: center;
  gap: var(--vc-space-3);
  min-height: 64px;
}

.settings-row + .settings-row,
.settings-row + .inline-form,
.security-fact + .trusted-devices {
  border-top: 1px solid var(--vc-color-hairline);
}

.settings-row::after,
.primary-action::after,
.secondary-action::after,
.text-action::after,
.device-row__revoke::after,
.admin-entry::after,
.logout-action::after,
.danger-zone__toggle::after,
.danger-action::after {
  border: 0;
}

.settings-row:active,
.admin-entry:active {
  background: var(--vc-color-surface-soft);
}

.settings-row__label,
.device-row__name {
  color: var(--vc-color-ink);
  font-size: 15px;
  font-weight: 550;
  line-height: 22px;
}

.security-fact__icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-success);
}

.security-fact__icon--warning {
  color: var(--vc-color-warning);
}

.trusted-devices {
  display: block;
}

.trusted-devices__heading {
  display: flex;
  align-items: flex-start;
  gap: var(--vc-space-2);
}

.device-state {
  display: block;
  padding: var(--vc-space-3) 0 var(--vc-space-1);
  color: var(--vc-color-ink-muted);
  font-size: 13px;
  line-height: 20px;
}

.device-state--error,
.form-message {
  color: var(--vc-color-error);
}

.device-row {
  display: flex;
  align-items: center;
  gap: var(--vc-space-3);
  margin-top: var(--vc-space-3);
  padding-top: var(--vc-space-3);
  border-top: 1px solid var(--vc-color-hairline);
}

.device-row__revoke,
.text-action,
.danger-zone__toggle {
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-2);
  border: 0;
  background: transparent;
  color: var(--vc-color-error);
  font: inherit;
  font-size: 13px;
}

.text-action {
  color: var(--vc-color-primary);
}

.inline-form {
  padding: var(--vc-space-4);
  background: var(--vc-color-surface-soft);
}

.form-label {
  display: block;
  margin: var(--vc-space-3) 0 var(--vc-space-1);
  color: var(--vc-color-ink);
  font-size: 13px;
  font-weight: 550;
  line-height: 20px;
}

.form-label:first-child {
  margin-top: 0;
}

.form-input {
  width: 100%;
  min-height: 46px;
  padding: 10px var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface);
  color: var(--vc-color-ink);
  font-size: 16px;
}

.form-message {
  display: block;
  margin-top: var(--vc-space-2);
  font-size: 13px;
  line-height: 20px;
}

.primary-action,
.secondary-action,
.danger-action {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  margin: var(--vc-space-4) 0 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid transparent;
  border-radius: var(--vc-radius-control);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
}

.primary-action {
  width: 100%;
  background: var(--vc-color-primary);
  color: var(--vc-color-surface);
}

.primary-action--compact {
  margin-top: var(--vc-space-4);
}

.secondary-action {
  background: var(--vc-color-surface);
  border-color: var(--vc-color-hairline);
  color: var(--vc-color-ink);
}

.danger-action {
  background: var(--vc-color-error);
  color: var(--vc-color-surface);
}

.admin-entry,
.logout-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-2);
  width: 100%;
  min-height: 48px;
  margin: 0 0 var(--vc-space-4);
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface);
  color: var(--vc-color-ink);
  font: inherit;
  font-size: 14px;
}

.logout-action {
  justify-content: center;
  color: var(--vc-color-primary);
  font-weight: 600;
}

.danger-zone {
  padding-top: var(--vc-space-2);
  border-top: 1px solid var(--vc-color-hairline);
  text-align: center;
}

.danger-zone__toggle {
  color: var(--vc-color-ink-muted);
}

.danger-zone__confirm {
  margin-top: var(--vc-space-2);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface);
  text-align: left;
}

.danger-zone__title,
.danger-zone__copy {
  display: block;
}

.danger-zone__title {
  color: var(--vc-color-error);
  font-size: 15px;
  font-weight: 650;
}

.danger-zone__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--vc-space-2);
}

.profile-state {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 320px;
  padding: var(--vc-space-5);
  text-align: center;
}

.profile-state__title {
  color: var(--vc-color-ink);
  font-size: 20px;
  font-weight: 650;
  line-height: 28px;
}

.profile-state__copy {
  margin-top: var(--vc-space-2);
}

.profile-skeleton {
  width: 100%;
  height: 18px;
  margin: var(--vc-space-2) 0;
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface-soft);
}

.profile-skeleton--short {
  width: 42%;
}

@media (max-width: 340px) {
  .profile-identity,
  .settings-row,
  .security-fact,
  .trusted-devices,
  .inline-form,
  .danger-zone__confirm {
    padding-right: var(--vc-space-3);
    padding-left: var(--vc-space-3);
  }
}
</style>
