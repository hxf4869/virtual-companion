<!-- MEM-DETAIL: independent memory + evidence page (product §8.2 item 10).
Reuses GET /memories/{id} and GET /memories/{id}/evidence. Existence hidden. -->
<template>
  <ConsumerShell route="/pages/memory-detail/memory-detail">
    <template #header-actions>
      <!-- E2E 05 锚点：返回记忆列表（携带关系上下文）。 -->
      <button
        data-testid="nav-memory"
        class="mem-back"
        aria-label="返回记忆管理"
        @click="goTo(memoryHref())"
      >
        记忆列表
      </button>
    </template>

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
        <text class="meta" data-testid="memory-status">状态 {{ publicMemoryStatusLabel(record.status) }}</text>
        <text class="meta" data-testid="memory-scope">范围 {{ publicMemoryScopeLabel(record.scope) }}</text>
        <text v-if="record.createdAt" class="meta" data-testid="memory-created">
          记录时间 {{ formatLocalDateTime(record.createdAt) }}
        </text>
        <text v-if="record.autoSaved" class="meta" data-testid="memory-auto">
          自动保存条目（可随时删除）
        </text>
        <text v-if="record.eventAt" class="meta" data-testid="memory-event">
          事件时间 {{ formatLocalDateTime(record.eventAt) }} · 状态 {{ eventStatusLabel(record.eventStatus) }}
        </text>
        <text v-if="record.eventExpiresAt" class="meta" data-testid="memory-event-expires">
          事件过期 {{ formatLocalDateTime(record.eventExpiresAt) }}（过期后不再使用，仅询问后续）
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
  </ConsumerShell>
</template>

<script lang="ts">
import { onMounted, ref } from "vue";

import { getMemory, listMemoryEvidence, type Memory, type MemoryEvidence } from "@/api/memory";
import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { buildContextHref, readContextFromLocation } from "@/domain/context-href";
import { publicMemoryScopeLabel, publicMemoryStatusLabel } from "@/domain/public-memory-display";
import { formatLocalDateTime } from "@/domain/timestamp";
import { useAuthStore } from "@/stores/auth";

export default {
  name: "MemoryDetailPage",
  components: { ConsumerShell },
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
        return readContextFromLocation(location).memoryId ?? "";
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
      try {
        const relationshipId =
          typeof location !== "undefined"
            ? readContextFromLocation(location).relationshipId
            : null;
        return buildContextHref("memory", { relationshipId });
      } catch {
        return buildContextHref("memory");
      }
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
      formatLocalDateTime,
      publicMemoryScopeLabel,
      publicMemoryStatusLabel,
    };
  },
};
</script>

<style scoped>
.mem-back {
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

.mem-back::after {
  border: 0;
}

.card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-1);
  margin-top: var(--vc-space-3);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
}

.label {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.summary {
  font-size: var(--vc-text-md);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.meta,
.source {
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  overflow-wrap: anywhere;
}

.error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-3);
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 1px solid var(--vc-danger);
  border-radius: var(--vc-radius-m);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
}

.error button {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-danger);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-danger);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.error button::after {
  border: 0;
}
</style>
