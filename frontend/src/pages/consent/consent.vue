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

  </ConsumerShell>
</template>

<script lang="ts">
// CONSENT (FR-AUTH-003/005): presentation-only page; the load-bearing flows
// live in the tested api/store modules. Every grant/revoke routes through the
// store, which only mutates state on a confirmed API result.
import { onMounted, ref } from "vue";

import type { ConsentType } from "@/api/consent";
import { ConsentHttpError } from "@/api/consent";
import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { useAuthStore } from "@/stores/auth";
import { CONSENT_OPTIONS, useConsentStore } from "@/stores/consent";

/** Alpha demo pins the consent version the user saw. */
const CONSENT_VERSION = "2026-08";

export default {
  name: "ConsentPage",
  components: { ConsumerShell },
  setup() {
    const auth = useAuthStore();
    const store = useConsentStore();
    const actionError = ref("");

    // ADR-0006 §7.7 (DOGFOOD-08): the revocation flow opens an inline
    // password confirm; grants never ask for one.
    const revokeTarget = ref<ConsentType | null>(null);
    const revokePassword = ref("");

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
    });

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
  padding: var(--vc-space-3) 0;
  border-top: 1px solid var(--vc-border);
  border-bottom: 1px solid var(--vc-border);
  border-radius: 0;
  background: transparent;
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
  font-size: 16px;
}

.consent-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-3);
  padding: var(--vc-space-5) 0;
  margin-top: 0;
  border-radius: 0;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--vc-border);
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
  font-weight: 700;
}

.consent-row .vc-btn--primary {
  border: 1px solid var(--vc-primary);
  background: transparent;
  color: var(--vc-primary);
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

</style>
