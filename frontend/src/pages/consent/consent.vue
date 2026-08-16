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
  </view>
</template>

<script lang="ts">
// CONSENT (FR-AUTH-003/005): presentation-only page; the load-bearing flows
// live in the tested api/store modules. Every grant/revoke routes through the
// store, which only mutates state on a confirmed API result.
import { onMounted, ref } from "vue";

import type { ConsentType } from "@/api/consent";
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
