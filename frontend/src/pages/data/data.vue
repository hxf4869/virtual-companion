<!-- DATA-VIEW (FR-DATA-001): read-only overview of stored account data.
Uses existing list APIs; report/appeal status reads the report intake list
(REPORT-BE). -->
<template>
  <view class="data-page">
    <view class="bar">
      <text class="title">我的数据</text>
      <button data-testid="nav-export" class="nav-index" aria-label="数据导出" @click="goTo('/pages/export/export')">
        数据导出
      </button>
      <button data-testid="nav-index" class="nav-index" aria-label="返回边界台" @click="goTo('/pages/index/index')">
        返回边界台
      </button>
    </view>

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
        <text class="row">角色：{{ auth.role ?? "未知" }}</text>
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
          {{ item.title || item.lastMessagePreview || `会话 ${item.conversationId}` }}
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
          {{ item.summary }}（{{ item.status }}）
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
          {{ item.consentType }} · {{ item.granted ? "已同意" : "已撤回" }}
        </button>
        <text v-if="store.consents.length === 0" class="empty">没有同意记录。</text>
      </view>

      <view class="section" data-testid="data-model">
        <text class="section-title">当前使用的模型说明</text>
        <button data-testid="data-open-ai-notice" class="row row-link" @click="goTo('/pages/ai-notice/ai-notice')">
          {{ store.serviceMode?.summary ?? "服务状态尚未读取。" }}
        </button>
        <text v-if="store.serviceMode" class="meta">模式 {{ store.serviceMode.mode }}</text>
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
  </view>
</template>

<script lang="ts">
import { onMounted, ref } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import EmptyState from "@/design-system/EmptyState.vue";
import ErrorNotice from "@/design-system/ErrorNotice.vue";
import RetryButton from "@/design-system/RetryButton.vue";
import { buildContextHref } from "@/domain/context-href";
import { personaDisplayName } from "@/domain/persona";
import { requestIdLabel } from "@/domain/request-id";
import { useAuthStore } from "@/stores/auth";
import { useDataStore } from "@/stores/data";
import { REPORT_REASON_LABELS, useReportStore } from "@/stores/report";

export default {
  name: "DataPage",
  components: { EmptyState, ErrorNotice, RetryButton },
  setup() {
    const auth = useAuthStore();
    const store = useDataStore();
    const reportStore = useReportStore();
    const requestIdCopy = ref("");
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
.data-page {
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
.intro,
.empty,
.meta {
  font-size: 24rpx;
  color: #8fa0bd;
  line-height: 1.6;
}
.section {
  margin-top: 20rpx;
  padding: 16rpx;
  border-radius: 16rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.section-title {
  font-size: 26rpx;
  font-weight: 600;
}
.row {
  font-size: 24rpx;
}
.row-link {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #d7e4ff;
  text-align: left;
}
.error {
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background-color: #5a1a1a;
  font-size: 24rpx;
}
</style>
