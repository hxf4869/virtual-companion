<!-- DATA-EXPORT (FR-DATA-002): asynchronous data-export page. Enqueues the
export, polls the status (manual refresh — no auto-polling in Alpha), shows
the short-lived one-time download link while READY and performs the download
through the authenticated transport. The document carries the AI-content
notice and per-message aiGenerated markers. -->
<template>
  <view class="export-page">
    <view class="bar">
      <text class="title">数据导出</text>
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
        导出为异步生成：文件短期有效，下载链接一次性且需登录后使用；文档含
        AI 生成内容标识（assistant 消息 aiGenerated=true）。
      </text>
    </view>

    <view v-if="store.actionError" class="error" data-testid="export-action-failed" role="alert">
      <text>{{ store.actionError }}</text>
    </view>
    <view v-if="store.downloadFailed" class="error" data-testid="export-download-failed" role="alert">
      <text>下载失败：链接可能已被使用或已过期，请刷新状态后重试。</text>
    </view>
    <view v-if="store.loadFailed" class="error" data-testid="export-load-failed" role="alert">
      <text>导出状态加载失败，请重试。</text>
    </view>

    <view class="actions">
      <button
        data-testid="export-create"
        class="nav-index primary-btn"
        :disabled="store.busy || store.request?.status === 'PENDING'"
        @click="onCreate"
      >
        发起导出
      </button>
      <button
        v-if="store.request"
        data-testid="export-refresh"
        class="nav-index"
        :disabled="store.busy"
        @click="onRefresh"
      >
        刷新状态
      </button>
    </view>

    <view v-if="store.request" class="status-card" data-testid="export-status-card">
      <text class="status-label" data-testid="export-status">
        {{ statusLabel(store.request.status) }}
      </text>
      <text class="status-meta">请求时间 {{ formatTime(store.request.requestedAt) }}</text>
      <text v-if="store.request.completedAt" class="status-meta">
        完成时间 {{ formatTime(store.request.completedAt) }}
      </text>
      <text v-if="store.request.expiresAt" class="status-meta">
        下载有效期至 {{ formatTime(store.request.expiresAt) }}
      </text>
      <text v-if="store.request.errorMessage" class="status-meta error-text">
        原因：{{ store.request.errorMessage }}
      </text>
      <text v-if="store.request.status === 'EXPIRED'" class="status-meta">
        已过期，文件已自动删除，可重新发起导出。
      </text>

      <button
        v-if="store.canDownload()"
        data-testid="export-download"
        class="nav-index download-btn"
        :disabled="store.busy"
        @click="onDownload"
      >
        下载导出文件
      </button>
      <text v-if="store.canDownload()" class="status-meta" data-testid="export-once-hint">
        下载链接仅在发起导出时生成一次，刷新或离开页面后无法找回；失效后请等过期再重新发起。
      </text>
      <text v-if="store.download && !store.downloadFailed" class="status-meta">
        已下载（一次性链接已失效，页面保留本次内容预览）。
      </text>
    </view>

    <view
      v-if="store.download"
      class="download-preview"
      data-testid="export-download-preview"
    >
      <text class="preview-title">导出内容</text>
      <text class="preview-notice">{{ store.download.aiContentNotice }}</text>
      <text class="preview-line">
        会话 {{ store.download.conversations.length }} 个 · 记忆
        {{ store.download.memories.length }} 条 · 提醒
        {{ store.download.reminders.length }} 条 · 同意记录
        {{ store.download.consents.length }} 条
      </text>
    </view>
  </view>
</template>

<script lang="ts">
// DATA-EXPORT (FR-DATA-002): presentation-only page; the load-bearing flows
// live in the tested api/store modules. Every action routes through the
// store, which only mutates state on a confirmed API result.
import { onMounted, ref } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";
import { useExportStore } from "@/stores/export";

export default {
  name: "ExportPage",
  setup() {
    const auth = useAuthStore();
    const store = useExportStore();
    const lastExportId = ref<string | null>(null);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      // No persisted export in Alpha: the page starts empty; the user
      // creates one (or the demo refreshes after enqueueing elsewhere).
    });

    async function onCreate(): Promise<void> {
      const created = await store.create(transport);
      if (created && store.request) {
        lastExportId.value = store.request.exportId;
      }
    }

    async function onRefresh(): Promise<void> {
      // Prefer the id from this page's own create call; fall back to the
      // store's current request so refresh always targets the right export.
      const id = lastExportId.value ?? store.request?.exportId;
      if (id) {
        await store.refresh(transport, id);
      }
    }

    async function onDownload(): Promise<void> {
      await store.downloadDocument(transport);
    }

    function statusLabel(status: string): string {
      switch (status) {
        case "READY":
          return "已就绪，可下载";
        case "FAILED":
          return "生成失败";
        case "EXPIRED":
          return "已过期";
        default:
          return "生成中…";
      }
    }

    function formatTime(instant: string): string {
      const date = new Date(instant);
      if (Number.isNaN(date.getTime())) return instant;
      return date.toLocaleString();
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
      store,
      lastExportId,
      onCreate,
      onRefresh,
      onDownload,
      statusLabel,
      formatTime,
      goTo,
    };
  },
};
</script>

<style scoped>
.export-page {
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
.primary-btn {
  background-color: #16503e;
}
.download-btn {
  background-color: #16503e;
}
.intro {
  margin: 16rpx 0;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background-color: #1c2b4a;
  font-size: 24rpx;
  color: #8fa0bd;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin: 16rpx 0;
}
.status-card {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 16rpx;
  border-radius: 12rpx;
  background-color: #1c2b4a;
  border: 2rpx solid #2a3a5a;
}
.status-label {
  font-size: 28rpx;
  font-weight: 600;
  color: #89d3cc;
}
.status-meta {
  font-size: 22rpx;
  color: #8fa0bd;
}
.error-text {
  color: #f19a94;
}
.download-preview {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 16rpx;
  padding: 16rpx;
  border-radius: 12rpx;
  background-color: #1c2b4a;
  border: 2rpx solid #2a3a5a;
}
.preview-title {
  font-size: 26rpx;
  font-weight: 600;
}
.preview-notice {
  font-size: 22rpx;
  color: #e4b96d;
}
.preview-line {
  font-size: 22rpx;
  color: #8fa0bd;
}
.error {
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background-color: #5a1a1a;
  font-size: 24rpx;
}
</style>
