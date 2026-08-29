<!-- REPORT-BE (FR-DATA-001 / §20.15): report & complaint intake page. A
submission is stored with a catalog reason and a bounded note; status stays
SUBMITTED until a human review resolves it. No invented ticket numbers, SLA
promises or hotline role-play. Message reports arrive via ?messageId=. -->
<template>
  <ConsumerShell route="/pages/report/report">
    <template #header-actions>
      <button
        data-testid="nav-help"
        class="page-act"
        aria-label="帮助与安全支持"
        @click="goTo('/pages/help/help')"
      >
        帮助
      </button>
    </template>




    <view class="section" data-testid="report-intro" role="status">
      <text>
        提交后会进入人工处理队列。这里不会承诺处理时限，也不会编造工单编号或回复内容。
        需要现实紧急帮助时，请联系当地紧急服务或你信任的真人支持。
      </text>
    </view>

    <view v-if="anchoredMessageId" class="section" data-testid="report-anchor">
      <text>本次提交将关联你举报的那条消息（消息编号 {{ anchoredMessageId }}）。</text>
    </view>

    <view class="section">
      <text class="section-title">举报原因</text>
      <view class="reason-row">
        <button
          v-for="r in REPORT_REASONS"
          :key="r"
          class="reason-chip"
          :class="{ active: reason === r }"
          :data-testid="`report-reason-${r}`"
          :aria-pressed="reason === r"
          @click="reason = r"
        >
          {{ REPORT_REASON_LABELS[r] }}
        </button>
      </view>
      <textarea
        v-model="note"
        class="note-input"
        data-testid="report-note"
        aria-label="问题描述"
        :maxlength="2000"
        placeholder="请描述发生了什么（必填，最多 2000 字）"
      />
      <button
        class="nav-index submit-btn"
        data-testid="report-submit"
        :disabled="store.busy || !canSubmit"
        @click="onSubmit"
      >
        提交举报
      </button>
      <view v-if="submitResult === 'ok'" class="result ok" data-testid="report-submit-ok" role="status">
        <text>已提交。你可以在下方看到处理状态。</text>
      </view>
      <view v-else-if="submitResult === 'rejected'" class="result err" data-testid="report-submit-rejected" role="alert">
        <text>提交未成功：原因或描述不符合要求，或关联的消息已不存在。内容不会被保存。</text>
      </view>
    </view>

    <view class="section">
      <text class="section-title">我的举报</text>
      <view v-if="store.loadFailed" class="result err" data-testid="report-load-failed" role="alert">
        <text>举报记录加载失败，请重试。</text>
        <button data-testid="report-retry" class="nav-index" :disabled="store.busy" @click="onRetry">
          重试
        </button>
      </view>
      <text v-else-if="store.loaded && store.reports.length === 0" class="row" data-testid="report-empty">
        还没有提交过举报。
      </text>
      <view v-for="r in store.reports" :key="r.id" class="report-row" :data-testid="`report-row-${r.id}`">
        <text class="row">
          {{ REPORT_REASON_LABELS[r.reason] }}<text v-if="r.messageId"> · 已关联到你举报的那条消息</text>
        </text>
        <text class="row meta">{{ r.note }}</text>
        <text class="row meta" :data-testid="`report-status-${r.id}`">
          {{ REPORT_STATUS_LABELS[r.status] }} · 提交于 {{ formatLocalDateTime(r.createdAt) }}
        </text>
        <text v-if="r.resolutionNote" class="row meta">处理说明：{{ r.resolutionNote }}</text>
      </view>
    </view>
  </ConsumerShell>
</template>

<script lang="ts">
import { computed, onMounted, ref } from "vue";

import { REPORT_REASONS, type ReportReason, type ReportTransport } from "@/api/report";
import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { readContextFromLocation } from "@/domain/context-href";
import { formatLocalDateTime } from "@/domain/timestamp";
import { REPORT_REASON_LABELS, REPORT_STATUS_LABELS, useReportStore } from "@/stores/report";
import { useAuthStore } from "@/stores/auth";

export default {
  name: "ReportPage",
  components: { ConsumerShell },
  setup() {
    const auth = useAuthStore();
    const store = useReportStore();
    const reason = ref<ReportReason>("UNSAFE_CONTENT");
    const note = ref("");
    const submitResult = ref<"idle" | "ok" | "rejected">("idle");
    const anchoredMessageId = ref<string | null>(null);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    onMounted(async () => {
      // A message report arrives from the chat page via ?messageId=. H5 hash
      // routing keeps the query inside the hash, so reuse the shared
      // context-href reader (hash first, then search) instead of hand-parsing
      // location.search.
      try {
        const ids = readContextFromLocation(
          (globalThis as { location?: { pathname?: string; search?: string; hash?: string } })
            .location,
        );
        anchoredMessageId.value =
          ids.messageId && ids.messageId.trim() ? ids.messageId.trim() : null;
      } catch {
        anchoredMessageId.value = null;
      }
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      await store.load(transport);
    });

    const canSubmit = computed(() => note.value.trim().length > 0);

    async function onSubmit(): Promise<void> {
      submitResult.value = "idle";
      const ok = await store.submit(
        transport as ReportTransport,
        reason.value,
        note.value.trim(),
        anchoredMessageId.value ?? undefined,
      );
      submitResult.value = ok ? "ok" : "rejected";
      if (ok) {
        note.value = "";
      }
    }

    async function onRetry(): Promise<void> {
      await store.load(transport);
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
        // Presentation-only.
      }
    }

    return {
      store,
      reason,
      note,
      submitResult,
      anchoredMessageId,
      canSubmit,
      formatLocalDateTime,
      REPORT_REASONS,
      REPORT_REASON_LABELS,
      REPORT_STATUS_LABELS,
      onSubmit,
      onRetry,
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
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
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
.reason-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
}

.reason-chip {
  /* P2（round3）：触控目标 ≥44px，与全站控件一致。 */
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-pill);
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-sm);
}

.reason-chip::after {
  border: 0;
}

.reason-chip.active {
  border: 0;
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font-weight: 600;
}

.report-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-1);
  padding: var(--vc-space-3) 0;
  border-bottom: 1px solid var(--vc-border);
}

.ok {
  color: var(--vc-success);
  font-size: var(--vc-text-sm);
}

.err {
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
}
</style>
