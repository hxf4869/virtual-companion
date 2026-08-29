<!-- DATA-EXPORT (FR-DATA-002): asynchronous data-export page. Enqueues the
export, polls the status (manual refresh — no auto-polling in Alpha), shows
the short-lived one-time download link while READY and performs the download
through the authenticated transport. The document carries the AI-content
notice and per-message aiGenerated markers. -->
<template>
  <!-- DOGFOOD-09：页面容器声明 main landmark，页面标题声明一级标题语义。 -->
  <ConsumerShell route="/pages/export/export">



    <view class="intro">
      <text>
        导出为异步生成：文件短期有效，下载链接一次性且需登录后使用；文档含
        AI 生成内容标识（assistant 消息 aiGenerated=true）。
      </text>
    </view>

    <view v-if="passwordError" class="error" data-testid="export-password-error" role="alert">
      <text>{{ passwordError }}</text>
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
      <input
        v-model="exportPassword"
        data-testid="export-password"
        class="export-input"
        type="password"
        autocomplete="current-password"
        placeholder="当前密码（发起导出前确认）"
        aria-label="发起导出当前密码"
      />
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
  </ConsumerShell>
</template>

<script lang="ts">
// DATA-EXPORT (FR-DATA-002): presentation-only page; the load-bearing flows
// live in the tested api/store modules. Every action routes through the
// store, which only mutates state on a confirmed API result.
import { onMounted, ref } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { useAuthStore } from "@/stores/auth";
import { useExportStore } from "@/stores/export";
import { formatLocalDateTime } from "@/domain/timestamp";

export default {
  name: "ExportPage",
  components: { ConsumerShell },
  setup() {
    const auth = useAuthStore();
    const store = useExportStore();
    const lastExportId = ref<string | null>(null);
    // ADR-0006 §7.7 (DOGFOOD-08): creating an export requires the freshly
    // re-entered CURRENT password; the server verifies it fail-closed.
    const exportPassword = ref("");
    const passwordError = ref("");

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
      // Empty re-entry never sends the request; the input stays for retry.
      if (!exportPassword.value) {
        passwordError.value = "请输入当前密码后再发起导出。";
        return;
      }
      passwordError.value = "";
      const created = await store.create(transport, exportPassword.value);
      if (created && store.request) {
        lastExportId.value = store.request.exportId;
        exportPassword.value = "";
      }
      // A failed create keeps the input for retry; the store's actionError
      // banner surfaces the server refusal (wrong password fails closed).
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

    // P2（round4）：与其它消费者页统一走本地时间 helper（YYYY-MM-DD HH:mm）。
    function formatTime(instant: string): string {
      return formatLocalDateTime(instant);
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
      exportPassword,
      passwordError,
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
  min-height: 40px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-env);
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
.primary-btn,
.save-btn,
.submit-btn {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-5);
  border: 0;
  border-radius: var(--vc-radius-s);
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.primary-btn::after,
.save-btn::after,
.submit-btn::after {
  border: 0;
}

.primary-btn[disabled],
.save-btn[disabled],
.submit-btn[disabled] {
  color: var(--vc-muted);
}
.status-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-1);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
}

.status-label {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.status-meta {
  color: var(--vc-ink);
  font-size: var(--vc-text-md);
  font-weight: 600;
}

.error-text {
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
}

.download-btn {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-5);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.download-btn::after {
  border: 0;
}

.download-preview {
  margin-top: var(--vc-space-3);
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  background: var(--vc-sunken);
  font-size: var(--vc-text-xs);
}

.preview-title {
  display: block;
  margin-bottom: var(--vc-space-2);
  font-weight: 600;
}

.preview-notice {
  display: block;
  margin-bottom: var(--vc-space-2);
  color: var(--vc-warning);
}

.preview-line {
  display: block;
  overflow-wrap: anywhere;
}
</style>
