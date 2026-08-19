<!-- MEM-DETAIL: independent memory + evidence page (product §8.2 item 10).
Reuses GET /memories/{id} and GET /memories/{id}/evidence. Existence hidden. -->
<template>
  <view class="detail-page">
    <view class="bar">
      <text class="title">记忆详情</text>
      <button
        data-testid="nav-memory"
        class="nav-index"
        aria-label="返回记忆管理"
        @click="goTo(memoryHref())"
      >
        记忆管理
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

    <view v-if="missing" class="error" data-testid="memory-missing" role="alert">
      <text>未找到或无权访问。</text>
    </view>
    <view v-else-if="loadFailed" class="error" data-testid="memory-load-failed" role="alert">
      <text>记忆详情加载失败，请重试。</text>
      <button data-testid="memory-retry" class="nav-index" :disabled="busy" @click="reload">
        重试
      </button>
    </view>

    <template v-else-if="record">
      <view class="card" data-testid="memory-card">
        <text class="label">摘要</text>
        <text class="summary" data-testid="memory-summary">{{ record.summary }}</text>
        <text class="meta" data-testid="memory-status">状态 {{ record.status }}</text>
        <text class="meta" data-testid="memory-scope">范围 {{ record.scope }}</text>
        <text v-if="record.createdAt" class="meta" data-testid="memory-created">
          记录时间 {{ record.createdAt }}
        </text>
        <text v-if="record.autoSaved" class="meta" data-testid="memory-auto">
          自动保存条目（可随时删除）
        </text>
        <text v-if="record.eventAt" class="meta" data-testid="memory-event">
          事件时间 {{ record.eventAt }} · 状态 {{ eventStatusLabel(record.eventStatus) }}
        </text>
        <text v-if="record.eventExpiresAt" class="meta" data-testid="memory-event-expires">
          事件过期 {{ record.eventExpiresAt }}（过期后不再使用，仅询问后续）
        </text>
        <text v-if="record.supersededAt" class="meta" data-testid="memory-superseded">
          已被 {{ record.supersededByMemoryId }} 替代，不作为已保存事实
        </text>
      </view>

      <view v-if="sources.length > 0" class="card" data-testid="memory-evidence">
        <text class="label">来源</text>
        <text v-for="e in sources" :key="e.evidenceId" class="source" data-testid="memory-source">
          {{ e.sourceRef }}
        </text>
      </view>
      <view v-else class="card" data-testid="memory-evidence-empty" role="status">
        <text>没有可展示的来源。</text>
      </view>
    </template>
  </view>
</template>

<script lang="ts">
import { onMounted, ref } from "vue";

import { getMemory, listMemoryEvidence, type Memory, type MemoryEvidence } from "@/api/memory";
import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";

export default {
  name: "MemoryDetailPage",
  setup() {
    const auth = useAuthStore();
    const record = ref<Memory | null>(null);
    const sources = ref<MemoryEvidence[]>([]);
    const missing = ref(false);
    const loadFailed = ref(false);
    const busy = ref(false);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    function readMemoryId(): string {
      try {
        if (typeof location === "undefined") return "";
        return new URLSearchParams(String(location.search || "")).get("memoryId")?.trim() ?? "";
      } catch {
        return "";
      }
    }

    /** R44: plain label for the §11.12 memory-event-statuses code. */
    function eventStatusLabel(status?: string): string {
      switch (status) {
        case "PLANNED":
          return "计划中";
        case "IN_PROGRESS":
          return "进行中";
        case "COMPLETED":
          return "已完成";
        case "CANCELLED":
          return "已取消";
        default:
          return "未知";
      }
    }

    async function reload(): Promise<void> {
      const id = readMemoryId();
      missing.value = false;
      loadFailed.value = false;
      record.value = null;
      sources.value = [];
      if (!id) {
        missing.value = true;
        return;
      }
      busy.value = true;
      try {
        const memory = await getMemory(transport, id);
        if (!memory) {
          missing.value = true;
          return;
        }
        record.value = memory;
        sources.value = await listMemoryEvidence(transport, id);
      } catch {
        loadFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    function memoryHref(): string {
      return "/pages/memory/memory";
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

    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      await reload();
    });

    return {
      record,
      sources,
      missing,
      loadFailed,
      busy,
      reload,
      memoryHref,
      goTo,
      eventStatusLabel,
    };
  },
};
</script>

<style scoped>
.detail-page {
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
.card {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 16rpx;
  padding: 20rpx;
  border-radius: 16rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
}
.label {
  font-size: 24rpx;
  color: #8fa0bd;
}
.summary {
  font-size: 30rpx;
  font-weight: 600;
}
.meta,
.source {
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
