<!-- CONSENT (FR-AUTH-003/005): versioned consent management page. Records are
append-only: every grant/revoke appends a new versioned row and this page shows
the effective latest row per type. The Alpha demo pins the version the user saw
to "2026-08"; MODEL_TRAINING notes withdrawal never affects basic chat. -->
<template>
  <view class="consent-page">
    <view class="bar">
      <text class="title">同意管理</text>
      <button
        data-testid="nav-chat"
        class="nav-index"
        aria-label="离线聊天"
        @click="goTo('/pages/chat/chat')"
      >
        离线聊天
      </button>
      <button
        data-testid="nav-index"
        class="nav-index"
        aria-label="返回边界台"
        @click="goTo('/pages/index/index')"
      >
        返回边界台
      </button>
    </view>

    <view class="intro">
      <text>
        同意记录为追加式版本化记录（当前版本 {{ CONSENT_VERSION }}，Alpha 演示）。
        每次同意或撤回都会追加一条新记录，本页展示每类同意的最新生效状态。
      </text>
    </view>

    <view
      v-if="store.loadFailed"
      class="error"
      data-testid="consent-load-failed"
      role="alert"
    >
      <text>同意记录加载失败，请重试。</text>
      <button
        data-testid="consent-retry"
        class="nav-index"
        :disabled="store.busy"
        @click="onRetry"
      >
        重试
      </button>
    </view>
    <view v-if="actionError" class="error" data-testid="consent-action-failed" role="alert">
      <text>{{ actionError }}</text>
    </view>

    <template v-if="!store.loadFailed">
      <view
        v-for="option in CONSENT_OPTIONS"
        :key="option.type"
        class="consent-row"
        data-testid="consent-row"
      >
        <view class="consent-copy">
          <text class="consent-label">{{ option.label }}</text>
          <text class="consent-note">{{ option.note }}</text>
          <text class="consent-meta">版本 {{ versionFor(option.type) }}</text>
        </view>
        <text
          class="consent-status"
          :class="`consent-status--${statusTone(option.type)}`"
          data-testid="consent-status"
        >
          {{ statusLabel(option.type) }}
        </text>
        <button
          data-testid="consent-grant"
          class="nav-index grant-btn"
          :disabled="store.busy || store.grantedFor(option.type) === true"
          @click="onToggle(option.type, true)"
        >
          同意
        </button>
        <button
          data-testid="consent-revoke"
          class="nav-index revoke-btn"
          :disabled="store.busy || store.grantedFor(option.type) !== true"
          @click="onToggle(option.type, false)"
        >
          撤回
        </button>
      </view>
    </template>

    <!-- EMERGENCY-CONTACT (§20.14): the contact lifecycle card. Saving needs
         the standing EMERGENCY_CONTACT consent; an unverified contact is only
         a draft and can never be used for an actual liaison. The Alpha
         invite is simulated — the token is shown for manual relay, nothing
         is ever sent. The whole section hides while the deployment has the
         capability switched off (§20.14 未完成评审宁可不启用；403 → 隐藏). -->
    <view v-if="!emcHidden" class="emc-section">
      <view class="emc-head">
        <text class="emc-title">紧急联系人</text>
        <text
          v-if="emergencyContact"
          class="consent-status"
          :class="emergencyContact.status === 'VERIFIED'
            ? 'consent-status--granted' : 'consent-status--none'"
          data-testid="emc-status"
        >
          {{ emergencyContact.status === 'VERIFIED' ? '已验证' : '草稿（未验证）' }}
        </text>
      </view>
      <view class="intro">
        <text>
          紧急联系人不是普通通讯录字段：未验证前仅保存为草稿，不能用于实际联络；
          只有在经批准的最高风险条件下、由人工判断后才可能联络，绝不由模型自动触发。
          联系方式加密存储；每次查看都会留下审计记录。
        </text>
      </view>

      <view v-if="emcError" class="error" data-testid="emc-error" role="alert">
        <text>{{ emcError }}</text>
      </view>

      <view v-if="!emergencyContact" class="emc-form">
        <input
          v-model="emcLabel"
          class="emc-input"
          data-testid="emc-label"
          placeholder="称呼（如：妈妈）"
          aria-label="紧急联系人称呼"
        />
        <input
          v-model="emcContact"
          class="emc-input"
          data-testid="emc-contact"
          placeholder="联系方式（Alpha 演示数据）"
          aria-label="紧急联系人联系方式"
        />
        <button
          data-testid="emc-save"
          class="nav-index grant-btn"
          :disabled="store.busy || !emcLabel.trim() || !emcContact.trim()"
          @click="onSaveContact"
        >
          保存为草稿
        </button>
        <view v-if="!emcConsentGranted()" class="emc-hint">
          <text>需先在上方对「紧急联系人处理」给出单独同意。</text>
        </view>
      </view>

      <template v-else>
        <view class="emc-card" data-testid="emc-card">
          <text class="emc-line">{{ emergencyContact.label }} · {{ emergencyContact.contact }}</text>
          <text v-if="emergencyContact.status === 'VERIFIED'" class="consent-meta">
            验证于 {{ emergencyContact.verifiedAt }}（方式 {{ emergencyContact.verifiedMethod }}，
            条款版本 {{ emergencyContact.consentVersion }}，有效期至 {{ emergencyContact.verifiedExpiresAt }}）
          </text>
          <text v-else class="consent-meta">未验证草稿：变更后需重新验证，未验证不可用于实际联络。</text>
        </view>

        <view v-if="emergencyContact.status === 'DRAFT'" class="emc-form">
          <button
            data-testid="emc-invite"
            class="nav-index"
            :disabled="store.busy"
            @click="onStartVerification"
          >
            生成验证邀请
          </button>
          <view v-if="inviteToken" class="emc-card" data-testid="emc-invite-token">
            <text>（模拟邀请，无真实发送）验证码：{{ inviteToken }}</text>
            <text class="consent-meta">请交由联系人本人确认；7 天内有效。</text>
          </view>
          <input
            v-model="confirmToken"
            class="emc-input"
            data-testid="emc-confirm-token"
            placeholder="（模拟）联系人输入邀请码确认接受"
            aria-label="联系人邀请码"
          />
          <button
            data-testid="emc-confirm"
            class="nav-index grant-btn"
            :disabled="store.busy || !confirmToken.trim()"
            @click="onConfirmVerification"
          >
            联系人确认接受
          </button>
        </view>

        <button
          data-testid="emc-revoke"
          class="nav-index revoke-btn"
          :disabled="store.busy"
          @click="onRevokeContact"
        >
          撤回紧急联系人
        </button>
      </template>
    </view>
  </view>
</template>

<script lang="ts">
// CONSENT (FR-AUTH-003/005): presentation-only page; the load-bearing flows
// live in the tested api/store modules. Every grant/revoke routes through the
// store, which only mutates state on a confirmed API result.
import { onMounted, ref } from "vue";

import type { ConsentType } from "@/api/consent";
import {
  confirmEmergencyContactVerification,
  EmergencyContactHttpError,
  getEmergencyContact,
  revokeEmergencyContact,
  saveEmergencyContact,
  startEmergencyContactVerification,
  type EmergencyContact,
} from "@/api/emergency-contact";
import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";
import { CONSENT_OPTIONS, useConsentStore } from "@/stores/consent";

/** Alpha demo pins the consent version the user saw. */
const CONSENT_VERSION = "2026-08";

export default {
  name: "ConsentPage",
  setup() {
    const auth = useAuthStore();
    const store = useConsentStore();
    const actionError = ref("");

    // EMERGENCY-CONTACT (§20.14): the lifecycle card state.
    const emergencyContact = ref<EmergencyContact | null>(null);
    const emcLabel = ref("");
    const emcContact = ref("");
    const inviteToken = ref("");
    const confirmToken = ref("");
    const emcError = ref("");
    // §20.14 enablement: the backend 403s every endpoint while the review is
    // pending — the whole section then hides (宁可不启用).
    const emcHidden = ref(false);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      await store.load(transport);
      await refreshContact();
    });

    async function refreshContact(): Promise<void> {
      try {
        emergencyContact.value = await getEmergencyContact(transport);
      } catch (e) {
        if (e instanceof EmergencyContactHttpError && e.status === 403) {
          // Capability switched off on this deployment — hide the section.
          emcHidden.value = true;
          return;
        }
        // The consent rows stay usable; the contact card just shows the form.
        emergencyContact.value = null;
      }
    }

    async function onSaveContact(): Promise<void> {
      emcError.value = "";
      try {
        emergencyContact.value = await saveEmergencyContact(
          transport,
          emcLabel.value.trim(),
          emcContact.value.trim(),
        );
        emcLabel.value = "";
        emcContact.value = "";
      } catch {
        emcError.value = "保存失败：请确认已单独同意「紧急联系人处理」。";
      }
    }

    async function onStartVerification(): Promise<void> {
      emcError.value = "";
      try {
        const invite = await startEmergencyContactVerification(transport);
        inviteToken.value = invite.token;
      } catch {
        emcError.value = "生成验证邀请失败，请重试。";
      }
    }

    async function onConfirmVerification(): Promise<void> {
      emcError.value = "";
      try {
        emergencyContact.value = await confirmEmergencyContactVerification(
          transport,
          confirmToken.value.trim(),
        );
        inviteToken.value = "";
        confirmToken.value = "";
      } catch {
        emcError.value = "验证失败：邀请码不正确或已过期（7 天有效）。";
      }
    }

    async function onRevokeContact(): Promise<void> {
      emcError.value = "";
      try {
        await revokeEmergencyContact(transport);
        emergencyContact.value = null;
        inviteToken.value = "";
        confirmToken.value = "";
      } catch {
        emcError.value = "撤回失败，请重试。";
      }
    }

    const emcConsentGranted = () => store.grantedFor("EMERGENCY_CONTACT") === true;

    async function onRetry(): Promise<void> {
      actionError.value = "";
      await store.load(transport);
    }

    async function onToggle(type: ConsentType, granted: boolean): Promise<void> {
      actionError.value = "";
      try {
        const ok = await store.setConsent(transport, type, CONSENT_VERSION, granted);
        if (!ok) {
          actionError.value = "操作未获服务端确认，请重试。";
        }
      } catch {
        actionError.value = granted ? "同意提交失败，请重试。" : "撤回提交失败，请重试。";
      }
    }

    function versionFor(type: ConsentType): string {
      return store.records.find((r) => r.consentType === type)?.version ?? CONSENT_VERSION;
    }

    function statusLabel(type: ConsentType): string {
      const granted = store.grantedFor(type);
      if (granted === true) return "已同意";
      if (granted === false) return "已撤回";
      return "未记录";
    }

    function statusTone(type: ConsentType): string {
      const granted = store.grantedFor(type);
      if (granted === true) return "granted";
      if (granted === false) return "revoked";
      return "none";
    }

    function goTo(url: string): void {
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
        // Presentation-only navigation.
      }
    }

    return {
      CONSENT_OPTIONS,
      CONSENT_VERSION,
      store,
      actionError,
      emergencyContact,
      emcLabel,
      emcContact,
      inviteToken,
      confirmToken,
      emcError,
      emcHidden,
      emcConsentGranted,
      onSaveContact,
      onStartVerification,
      onConfirmVerification,
      onRevokeContact,
      onRetry,
      onToggle,
      versionFor,
      statusLabel,
      statusTone,
      goTo,
    };
  },
};
</script>

<style scoped>
.consent-page {
  padding: 24rpx;
  background-color: #14213d;
  color: #f5f5f5;
  min-height: 100vh;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 16rpx;
}
.title {
  font-size: 32rpx;
  font-weight: 600;
  margin-right: auto;
}
.nav-index {
  flex: 0 0 auto;
  background-color: #2a3a5a;
  color: #ffffff;
  font-size: 24rpx;
}
.grant-btn {
  background-color: #16503e;
}
.revoke-btn {
  background-color: #5a1a1a;
}
.intro {
  margin: 16rpx 0;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background-color: #1c2b4a;
  font-size: 24rpx;
  color: #8fa0bd;
}
.consent-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 16rpx;
  margin-top: 12rpx;
  border-radius: 12rpx;
  background-color: #1c2b4a;
  border: 2rpx solid #2a3a5a;
}
.consent-copy {
  flex: 1 1 320rpx;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.consent-label {
  font-size: 26rpx;
}
.consent-note {
  font-size: 22rpx;
  color: #8fa0bd;
}
.consent-meta {
  font-size: 20rpx;
  color: #5f7194;
}
.consent-status {
  flex: 0 0 auto;
  font-size: 24rpx;
}
.consent-status--granted {
  color: #89d3cc;
}
.consent-status--revoked {
  color: #f19a94;
}
.consent-status--none {
  color: #8fa0bd;
}
.emc-section {
  margin-top: 32rpx;
  padding: 16rpx;
  border-radius: 12rpx;
  background-color: #16233f;
  border: 2rpx solid #2a3a5a;
}
.emc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-bottom: 8rpx;
}
.emc-title {
  font-size: 30rpx;
  font-weight: 600;
}
.emc-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12rpx;
  margin-top: 12rpx;
}
.emc-input {
  flex: 1 1 280rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  color: #f5f5f5;
  font-size: 26rpx;
}
.emc-card {
  margin-top: 12rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background-color: #1c2b4a;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.emc-line {
  font-size: 26rpx;
}
.emc-hint {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #f19a94;
}
.error {
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background-color: #5a1a1a;
  font-size: 24rpx;
  display: flex;
  align-items: center;
  gap: 12rpx;
}
</style>
