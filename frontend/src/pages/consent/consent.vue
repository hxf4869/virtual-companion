<!-- CONSENT (FR-AUTH-003/005): versioned consent management page. Records are
append-only: every grant/revoke appends a new versioned row and this page shows
the effective latest row per type. The Alpha demo pins the version the user saw
to "2026-08"; MODEL_TRAINING notes withdrawal never affects basic chat. -->
<template>
  <ConsumerShell route="/pages/consent/consent">

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
        class="vc-btn"
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
          class="vc-btn vc-btn--primary"
          :disabled="store.busy || store.grantedFor(option.type) === true"
          @click="onToggle(option.type, true)"
        >
          同意
        </button>
        <button
          v-if="revokeTarget !== option.type"
          data-testid="consent-revoke"
          class="vc-btn vc-btn--danger"
          :disabled="store.busy || store.grantedFor(option.type) !== true"
          @click="openRevoke(option.type)"
        >
          撤回
        </button>

        <!-- ADR-0006 §7.7 (DOGFOOD-08): a revocation is high-risk — the
             caller must re-enter the CURRENT password inline (grants never
             show this panel). -->
        <view v-else class="revoke-confirm" data-testid="consent-revoke-panel">
          <text class="consent-note">撤回需重新输入当前密码确认。</text>
          <input
            v-model="revokePassword"
            class="vc-input"
            data-testid="consent-revoke-password"
            type="password"
            autocomplete="current-password"
            placeholder="当前密码"
            aria-label="撤回确认当前密码"
          />
          <view class="revoke-actions">
            <button
              data-testid="consent-revoke-cancel"
              class="vc-btn"
              :disabled="store.busy"
              @click="closeRevoke"
            >
              取消
            </button>
            <button
              data-testid="consent-revoke-confirm"
              class="vc-btn vc-btn--danger"
              :disabled="store.busy"
              @click="onToggle(option.type, false)"
            >
              确认撤回
            </button>
          </view>
        </view>
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
          class="vc-input"
          data-testid="emc-label"
          placeholder="称呼（如：妈妈）"
          aria-label="紧急联系人称呼"
        />
        <input
          v-model="emcContact"
          class="vc-input"
          data-testid="emc-contact"
          placeholder="联系方式（Alpha 演示数据）"
          aria-label="紧急联系人联系方式"
        />
        <button
          data-testid="emc-save"
          class="vc-btn vc-btn--primary"
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
            class="vc-btn"
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
            class="vc-input"
            data-testid="emc-confirm-token"
            placeholder="（模拟）联系人输入邀请码确认接受"
            aria-label="联系人邀请码"
          />
          <button
            data-testid="emc-confirm"
            class="vc-btn vc-btn--primary"
            :disabled="store.busy || !confirmToken.trim()"
            @click="onConfirmVerification"
          >
            联系人确认接受
          </button>
        </view>

        <button
          data-testid="emc-revoke"
          class="vc-btn vc-btn--danger"
          :disabled="store.busy"
          @click="onRevokeContact"
        >
          撤回紧急联系人
        </button>
      </template>
    </view>
  </ConsumerShell>
</template>

<script lang="ts">
// CONSENT (FR-AUTH-003/005): presentation-only page; the load-bearing flows
// live in the tested api/store modules. Every grant/revoke routes through the
// store, which only mutates state on a confirmed API result.
import { onMounted, ref } from "vue";

import type { ConsentType } from "@/api/consent";
import { ConsentHttpError } from "@/api/consent";
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
import ConsumerShell from "@/app/ConsumerShell.vue";
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

    // ADR-0006 §7.7 (DOGFOOD-08): the revocation flow opens an inline
    // password confirm; grants never ask for one.
    const revokeTarget = ref<ConsentType | null>(null);
    const revokePassword = ref("");

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

    function openRevoke(type: ConsentType): void {
      if (store.busy) return;
      revokeTarget.value = type;
      revokePassword.value = "";
      actionError.value = "";
    }

    function closeRevoke(): void {
      revokeTarget.value = null;
      revokePassword.value = "";
    }

    async function onToggle(type: ConsentType, granted: boolean): Promise<void> {
      actionError.value = "";
      if (granted) {
        // Grant: low-risk, no password gate.
        revokeTarget.value = null;
        revokePassword.value = "";
        try {
          const ok = await store.setConsent(transport, type, CONSENT_VERSION, true);
          if (!ok) {
            actionError.value = "操作未获服务端确认，请重试。";
          }
        } catch {
          actionError.value = "同意提交失败，请重试。";
        }
        return;
      }
      if (revokeTarget.value !== type) {
        openRevoke(type);
        return;
      }
      // Revocation: empty re-entry never sends the request.
      if (!revokePassword.value) {
        actionError.value = "请输入当前密码以确认撤回。";
        return;
      }
      try {
        const ok = await store.setConsent(
          transport, type, CONSENT_VERSION, false, revokePassword.value,
        );
        if (!ok) {
          actionError.value = "操作未获服务端确认，请重试。";
          return;
        }
        closeRevoke();
      } catch (e) {
        // A wrong password maps to the server's non-disclosing 404 — keep
        // the panel open so the caller can retry with the right password.
        actionError.value = e instanceof ConsentHttpError && e.status === 404
          ? "当前密码不正确，撤回未执行。"
          : "撤回提交失败，请重试。";
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

    return {
      CONSENT_OPTIONS,
      CONSENT_VERSION,
      store,
      actionError,
      revokeTarget,
      revokePassword,
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
      openRevoke,
      closeRevoke,
      versionFor,
      statusLabel,
      statusTone,
    };
  },
};
</script>

<style scoped>
.intro {
  margin: 0 0 var(--vc-space-4);
  padding: var(--vc-space-3) var(--vc-space-4);
  border-radius: var(--vc-radius-m);
  background: var(--vc-sunken);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  line-height: 1.7;
}

.vc-btn {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
  flex: 0 0 auto;
}

.vc-btn::after {
  border: 0;
}

.vc-btn--primary {
  border: 0;
  background: var(--vc-primary);
  color: var(--vc-on-primary);
}

.vc-btn--danger {
  border-color: var(--vc-danger);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
}

.vc-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-ink);
  font-size: var(--vc-text-md);
}

.consent-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-3);
  padding: var(--vc-space-4);
  margin-top: var(--vc-space-3);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
  border: 1px solid var(--vc-border);
}

.consent-copy {
  flex: 1 1 16em;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.consent-label {
  font-size: var(--vc-text-md);
  font-weight: 600;
}

.consent-note {
  font-size: var(--vc-text-xs);
  color: var(--vc-muted);
}

.consent-meta {
  font-size: var(--vc-text-xs);
  color: var(--vc-muted);
}

.consent-status {
  flex: 0 0 auto;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.consent-status--granted {
  color: var(--vc-success);
}

.consent-status--revoked {
  color: var(--vc-danger);
}

.consent-status--none {
  color: var(--vc-muted);
}

.revoke-confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  flex: 1 1 100%;
  padding: var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-danger-bg);
}

.revoke-confirm .vc-input {
  flex: 1 1 12em;
  width: auto;
}

.revoke-actions {
  display: flex;
  gap: var(--vc-space-2);
}

.error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  margin: var(--vc-space-3) 0 0;
  padding: var(--vc-space-3) var(--vc-space-4);
  border-radius: var(--vc-radius-m);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
}

.emc-section {
  margin-top: var(--vc-space-6);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
}

.emc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-3);
}

.emc-title {
  font-size: var(--vc-text-md);
  font-weight: 650;
}

.emc-section .intro {
  background: transparent;
  padding: var(--vc-space-2) 0 0;
}

.emc-form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-3);
}

.emc-form .vc-input {
  flex: 1 1 12em;
  width: auto;
}

.emc-hint {
  flex: 1 1 100%;
  color: var(--vc-warning);
  font-size: var(--vc-text-xs);
}

.emc-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: var(--vc-space-3);
  padding: var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  overflow-wrap: anywhere;
}

.emc-line {
  font-size: var(--vc-text-sm);
  font-weight: 600;
}
</style>
