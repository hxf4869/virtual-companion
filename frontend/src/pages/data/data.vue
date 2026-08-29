<!-- DATA-VIEW (FR-DATA-001): read-only overview of stored account data.
Uses existing list APIs; report/appeal status reads the report intake list
(REPORT-BE). -->
<template>
  <ConsumerShell route="/pages/data/data">
    <template #header-actions>
      <button
        data-testid="nav-export"
        class="page-act"
        aria-label="数据导出"
        @click="goTo('/pages/export/export')"
      >
        数据导出
      </button>
    </template>




    <view class="intro">
      <text>
        这里只查看已经保存在本服务中的数据。导出请走「数据导出」。
        举报和申诉提交后会有人工处理，本页只显示真实记录。
      </text>
    </view>

    <view v-if="store.loadFailed" class="error" data-testid="data-load-failed" role="alert">
      <ErrorNotice message="数据加载失败，请重试。" :request-id="store.asyncState.requestId ?? undefined" :stale="store.asyncState.stale" />
      <RetryButton data-testid="data-retry" :disabled="store.busy" @retry="onRetry" />
    </view>
    <view
      v-else-if="store.asyncState.status === 'partial'"
      class="error"
      data-testid="data-partial"
    >
      <ErrorNotice
        message="部分数据读取失败，未当作空结果。"
        :request-id="store.asyncState.requestId ?? undefined"
        :stale="store.asyncState.stale"
      />
      <RetryButton :disabled="store.busy" @retry="onRetry" />
    </view>

    <template v-if="!store.loadFailed">
      <view class="section" data-testid="data-account">
        <text class="section-title">账号</text>
        <button data-testid="data-open-account" class="row row-link" @click="goTo('/pages/account/account')">
          账号编号：{{ auth.accountId ?? "未登录" }}
        </button>
        <text class="row">角色：{{ accountRoleLabel(auth.role) }}</text>
      </view>

      <view class="section" data-testid="data-relationships">
        <text class="section-title">角色与关系（{{ store.relationships.length }}）</text>
        <button
          v-for="rel in store.relationships"
          :key="rel.relationshipId"
          class="row row-link"
          data-testid="data-open-companion"
          @click="goTo(companionHref(rel.relationshipId))"
        >
          {{ rel.companionName || personaDisplayName(rel.personaRef) }} · {{ rel.active ? "当前使用" : "未使用" }}
        </button>
        <text v-if="store.relationships.length === 0" class="empty">没有关系记录。</text>
      </view>

      <view class="section" data-testid="data-conversations">
        <text class="section-title">聊天记录（{{ store.conversations.length }}）</text>
        <button
          v-for="item in store.conversations.slice(0, 8)"
          :key="item.conversationId"
          class="row row-link"
          data-testid="data-open-conversation"
          @click="goTo(conversationHref(item))"
        >
          {{ readableConversationTitle(item) }}
        </button>
        <text v-if="store.conversations.length === 0" class="empty">没有会话记录。</text>
      </view>

      <view class="section" data-testid="data-memories">
        <text class="section-title">长期记忆（{{ store.memories.length }}）</text>
        <button
          v-for="item in store.memories.slice(0, 8)"
          :key="item.memoryId"
          class="row row-link"
          data-testid="data-open-memory"
          @click="goTo(memoryHref(item))"
        >
          {{ item.summary }}（{{ publicMemoryStatusLabel(item.status) }}）
        </button>
        <EmptyState
          v-if="store.memories.length === 0 && !store.asyncState.failedDomains.includes('memory')"
          message="没有记忆记录。"
        />
      </view>

      <view class="section" data-testid="data-reminders">
        <text class="section-title">提醒（{{ store.reminders.length }}）</text>
        <button
          v-for="item in store.reminders.slice(0, 8)"
          :key="item.reminderId"
          class="row row-link"
          data-testid="data-open-reminder"
          @click="goTo(reminderHref(item.relationshipId))"
        >
          {{ item.text }}
        </button>
        <EmptyState
          v-if="store.reminders.length === 0 && !store.asyncState.failedDomains.includes('reminder')"
          message="没有提醒记录。"
        />
      </view>

      <view class="section" data-testid="data-consents">
        <text class="section-title">同意记录（{{ store.consents.length }}）</text>
        <button
          v-for="item in store.consents"
          :key="item.consentId"
          class="row row-link"
          data-testid="data-open-consent"
          @click="goTo('/pages/consent/consent')"
        >
          {{ consentTypeLabel(item.consentType) }} · {{ item.granted ? "已同意" : "已撤回" }}
        </button>
        <text v-if="store.consents.length === 0" class="empty">没有同意记录。</text>
      </view>

      <view class="section" data-testid="data-model">
        <text class="section-title">当前使用的模型说明</text>
        <button data-testid="data-open-ai-notice" class="row row-link" @click="goTo('/pages/ai-notice/ai-notice')">
          {{ store.serviceMode?.summary ?? "服务状态尚未读取。" }}
        </button>
      </view>

      <view class="section" data-testid="data-appeals">
        <text class="section-title">举报和申诉状态</text>
        <button
          v-for="r in reportStore.reports.slice(0, 8)"
          :key="r.id"
          class="row row-link"
          data-testid="data-open-report"
          @click="goTo('/pages/report/report')"
        >
          {{ REPORT_REASON_LABELS[r.reason] }} ·
          {{ r.status === "SUBMITTED" ? "已提交，等待人工处理" : "已处理" }}
        </button>
        <text v-if="reportStore.loaded && reportStore.reports.length === 0" class="empty" data-testid="data-report-empty">
          还没有提交过举报。
        </text>
      </view>
    </template>
  </ConsumerShell>
</template>

<script lang="ts">
import { onMounted, ref } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import EmptyState from "@/design-system/EmptyState.vue";
import ErrorNotice from "@/design-system/ErrorNotice.vue";
import RetryButton from "@/design-system/RetryButton.vue";
import { buildContextHref } from "@/domain/context-href";
import { readableConversationTitle } from "@/domain/conversation-display";
import { accountRoleLabel } from "@/domain/account-display";
import { publicMemoryStatusLabel } from "@/domain/public-memory-display";
import { personaDisplayName } from "@/domain/persona";
import { requestIdLabel } from "@/domain/request-id";
import { useAuthStore } from "@/stores/auth";
import { CONSENT_OPTIONS } from "@/stores/consent";
import { useDataStore } from "@/stores/data";
import { REPORT_REASON_LABELS, useReportStore } from "@/stores/report";

export default {
  name: "DataPage",
  components: { ConsumerShell, EmptyState, ErrorNotice, RetryButton },
  setup() {
    const auth = useAuthStore();
    const store = useDataStore();
    const reportStore = useReportStore();
    const requestIdCopy = ref("");

    // P2（round3）：同意记录用与同意页一致的中文标签，不显示 SERVICE_TERMS
    // 等原始码；类型集是封闭联合，兜底仍不露出内部码。
    function consentTypeLabel(type: string): string {
      return CONSENT_OPTIONS.find((o) => o.type === type)?.label ?? "同意项";
    }

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
      // REPORT-BE: the appeal-status section reads the real intake list; a
      // failed read keeps it empty rather than faking a status.
      await reportStore.load(transport);
      requestIdCopy.value = store.loadFailed ? requestIdLabel() : "";
    });

    async function onRetry(): Promise<void> {
      await store.load(transport);
      await reportStore.load(transport);
      requestIdCopy.value = store.loadFailed ? requestIdLabel() : "";
    }

    function knownRelationshipIds(): string[] {
      return store.relationships.map((row) => row.relationshipId);
    }

    function companionHref(relationshipId: string): string {
      return buildContextHref("companion", {
        relationshipId,
        knownRelationshipIds: knownRelationshipIds(),
      });
    }

    function conversationHref(item: { relationshipId: string; conversationId: string }): string {
      return buildContextHref("chat", {
        relationshipId: item.relationshipId,
        conversationId: item.conversationId,
        knownRelationshipIds: knownRelationshipIds(),
      });
    }

    function memoryHref(item: { relationshipId?: string; memoryId: string }): string {
      return buildContextHref("memory-detail", {
        relationshipId: item.relationshipId,
        memoryId: item.memoryId,
        knownRelationshipIds: knownRelationshipIds(),
      });
    }

    function reminderHref(relationshipId: string): string {
      return buildContextHref("reminder", {
        relationshipId,
        knownRelationshipIds: knownRelationshipIds(),
      });
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
      auth,
      store,
      reportStore,
      accountRoleLabel,
      consentTypeLabel,
      readableConversationTitle,
      publicMemoryStatusLabel,
      REPORT_REASON_LABELS,
      personaDisplayName,
      requestIdCopy,
      onRetry,
      goTo,
      companionHref,
      conversationHref,
      memoryHref,
      reminderHref,
    };
  },
};
</script>

<style scoped>
/* The Lit Window 语义 token（Phase 5 迁移）。 */
.intro {
  margin: 0 0 var(--vc-space-4);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  line-height: 1.75;
}

.section {
  margin-bottom: var(--vc-space-5);
}

.section-title {
  display: block;
  margin-bottom: var(--vc-space-2);
  font-size: var(--vc-text-md);
  font-weight: 600;
}

.section-subtitle {
  display: block;
  margin: var(--vc-space-2) 0 var(--vc-space-1);
  font-size: var(--vc-text-sm);
  font-weight: 600;
  color: var(--vc-muted);
}

.label {
  display: block;
  margin: var(--vc-space-3) 0 var(--vc-space-1);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.meta {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.row {
  display: block;
  margin-bottom: var(--vc-space-2);
  font-size: var(--vc-text-sm);
  line-height: 1.7;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-3);
}

.nav-index {
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
}

.nav-index::after {
  border: 0;
}

.page-act {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  /* 暗面页头上的真实控件边界 ≥3:1。 */
  border: 1px solid var(--vc-border-env-strong);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-on-env);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.page-act::after {
  border: 0;
}

.error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  margin: var(--vc-space-3) 0;
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 1px solid var(--vc-danger);
  border-radius: var(--vc-radius-m);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
}

.empty {
  display: block;
  margin: var(--vc-space-3) 0;
  padding: var(--vc-space-4);
  border: 1px dashed var(--vc-border-strong);
  border-radius: var(--vc-radius-m);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-1);
  margin-bottom: var(--vc-space-4);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
  font-size: var(--vc-text-sm);
}

.input,
.reminder-input,
.export-input,
.account-input,
.note-input {
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
.row-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-3);
  width: 100%;
  min-height: 52px;
  margin: 0;
  padding: var(--vc-space-2) 0;
  border: 0;
  border-bottom: 1px solid var(--vc-border);
  border-radius: 0;
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-md);
  text-align: left;
}

.row-link::after {
  border: 0;
}
</style>
