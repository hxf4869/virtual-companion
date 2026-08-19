<!-- REPORT-BE (FR-DATA-001 / §20.15): report & complaint intake page. A
submission is stored with a catalog reason and a bounded note; status stays
SUBMITTED until a human review resolves it. No invented ticket numbers, SLA
promises or hotline role-play. Message reports arrive via ?messageId=. -->
<template>
  <view class="report-page">
    <view class="bar">
      <text class="title">举报和申诉</text>
      <button data-testid="nav-help" class="nav-index" aria-label="帮助与安全支持" @click="goTo('/pages/help/help')">
        帮助
      </button>
      <button data-testid="nav-index" class="nav-index" aria-label="返回边界台" @click="goTo('/pages/index/index')">
        返回边界台
      </button>
    </view>

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
          {{ REPORT_REASON_LABELS[r.reason] }}<text v-if="r.messageId"> · 关联消息 {{ r.messageId }}</text>
        </text>
        <text class="row meta">{{ r.note }}</text>
        <text class="row meta" :data-testid="`report-status-${r.id}`">
          {{ REPORT_STATUS_LABELS[r.status] }} · 提交于 {{ r.createdAt }}
        </text>
        <text v-if="r.resolutionNote" class="row meta">处理说明：{{ r.resolutionNote }}</text>
      </view>
    </view>
  </view>
</template>

<script lang="ts">
import { computed, onMounted, ref } from "vue";

import { REPORT_REASONS, type ReportReason, type ReportTransport } from "@/api/report";
import { createAuthenticatedTransport } from "@/api/transport";
import { REPORT_REASON_LABELS, REPORT_STATUS_LABELS, useReportStore } from "@/stores/report";
import { useAuthStore } from "@/stores/auth";

export default {
  name: "ReportPage",
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
      // A message report arrives from the chat page via ?messageId=.
      try {
        const params = new URLSearchParams(String((globalThis as { location?: Location }).location?.search ?? ""));
        const messageId = params.get("messageId");
        anchoredMessageId.value = messageId && messageId.trim() ? messageId.trim() : null;
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
.report-page {
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
  background-color: #2a3a5a;
  color: #ffffff;
  font-size: 24rpx;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 16rpx;
  padding: 20rpx;
  border-radius: 16rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  font-size: 24rpx;
  line-height: 1.6;
  color: #d5deee;
}
.section-title {
  font-weight: 600;
}
.row {
  color: #d5deee;
}
.meta {
  font-size: 22rpx;
  color: #8fa0bd;
}
.reason-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}
.reason-chip {
  background-color: #22345a;
  color: #d5deee;
  font-size: 22rpx;
  border: 2rpx solid #2a3a5a;
}
.reason-chip.active {
  background-color: #3a5a8a;
  color: #ffffff;
}
.note-input {
  width: 100%;
  min-height: 140rpx;
  box-sizing: border-box;
  background-color: #14213d;
  color: #f5f5f5;
  border: 2rpx solid #2a3a5a;
  border-radius: 12rpx;
  padding: 12rpx;
  font-size: 24rpx;
}
.submit-btn {
  align-self: flex-start;
}
.result {
  padding: 12rpx 16rpx;
  border-radius: 12rpx;
  font-size: 24rpx;
}
.ok {
  background-color: #1a4a2a;
  color: #bfe8c6;
}
.err {
  background-color: #5a1a1a;
  color: #f2c4c4;
}
.report-row {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  padding: 12rpx 0;
  border-bottom: 2rpx solid #24365c;
}
</style>
