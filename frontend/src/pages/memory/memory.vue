<!-- TASK-0030: H5 memory management page. Renders pending candidates (never as
saved facts) separately from canonical memory; confirm/reject/edit/delete actions
route through the store, which only mutates state on a confirmed API result and
surfaces failures instead of faking success. Sources come from the API.
TASK-0105 (P2-16/P3-03/P3-04): transport is the shared authenticated transport
(401 -> session handling, CSRF on state changes); edit mode exits only on
confirmed save; empty evidence does not render a container; error and busy
states carry alert/live a11y semantics. -->
<template>
  <view class="memory-page">
    <view class="bar">
      <input
        v-model="relationshipId"
        class="rel-input"
        placeholder="relationship id"
        aria-label="relationship id"
      />
      <button
        data-testid="reload"
        :disabled="!relationshipId || busy"
        :aria-busy="busy"
        @click="reload"
      >
        刷新记忆
      </button>
      <button
        data-testid="nav-index"
        class="nav-index"
        aria-label="返回边界台"
        @click="goTo('/pages/index/index')"
      >
        返回边界台
      </button>
      <button
        data-testid="nav-chat"
        class="nav-index"
        aria-label="离线聊天"
        @click="goTo(chatHref())"
      >
        离线聊天
      </button>
    </view>

    <RelationshipSelector
      :relationships="relStore.relationships"
      :current-id="relationshipId || null"
      :status="relStore.status"
      :busy="relStore.status === 'loading'"
      :show-create="false"
      @activate="onPickRelationship"
    />

    <view
      v-if="showEmptyRelationshipId"
      class="empty-status"
      data-testid="empty-relationship-id"
      role="status"
    >
      <text>请先选择或填写 relationship id 再刷新记忆。</text>
    </view>
    <view
      v-if="showPrefillHint"
      class="empty-status"
      data-testid="prefill-hint"
      role="status"
    >
      <text>已填入关系，请点击刷新记忆。</text>
    </view>

    <view
      v-if="memory.error"
      class="error"
      role="alert"
    >{{ errorText }}</view>

    <view class="section" aria-live="polite">
      <text class="section-title">待确认候选（{{ memory.pendingCount }}）</text>
      <text class="hint">候选未经确认，不作为已保存事实。</text>
      <view
        v-if="showEmptyPending"
        class="empty-status"
        data-testid="empty-pending"
        role="status"
      >
        <text>还没有待确认候选。模型提取的内容需你确认后才会成为记忆。</text>
      </view>
      <view
        v-for="m in memory.pending"
        :key="m.memoryId"
        class="card pending"
      >
        <text class="summary">{{ m.summary }}</text>
        <text class="meta">{{ m.scope }}</text>
        <view class="actions">
          <button size="mini" :disabled="busy" @click="onConfirm(m.memoryId)">
            确认
          </button>
          <button size="mini" :disabled="busy" @click="onReject(m.memoryId)">
            拒绝
          </button>
          <button size="mini" @click="onEvidence(m.memoryId)">来源</button>
        </view>
        <view v-if="hasEvidence(m.memoryId)" class="evidence">
          <text
            v-for="e in memory.evidence[m.memoryId]"
            :key="e.evidenceId"
            class="source"
          >• {{ e.sourceRef }}</text>
        </view>
      </view>
    </view>

    <view class="section" aria-live="polite">
      <text class="section-title">Canonical 记忆（{{ memory.canonicalCount }}）</text>
      <view
        v-if="showEmptyCanonical"
        class="empty-status"
        data-testid="empty-canonical"
        role="status"
      >
        <text>还没有已保存记忆。</text>
      </view>
      <view
        v-for="m in memory.canonical"
        :key="m.memoryId"
        class="card canonical"
      >
        <text v-if="editingId !== m.memoryId" class="summary">{{ m.summary }}</text>
        <view v-else class="edit-row">
          <input
            v-model="draftSummary"
            class="edit-input"
            aria-label="编辑记忆内容"
          />
          <button size="mini" :disabled="busy" @click="onSave(m.memoryId)">
            保存
          </button>
        </view>
        <text class="meta">{{ m.scope }}</text>
        <view class="actions">
          <button
            size="mini"
            :disabled="busy"
            @click="startEdit(m.memoryId, m.summary)"
          >
            编辑
          </button>
          <button size="mini" :disabled="busy" @click="onDelete(m.memoryId)">
            删除
          </button>
          <button size="mini" @click="onEvidence(m.memoryId)">来源</button>
        </view>
        <view v-if="hasEvidence(m.memoryId)" class="evidence">
          <text
            v-for="e in memory.evidence[m.memoryId]"
            :key="e.evidenceId"
            class="source"
          >• {{ e.sourceRef }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import RelationshipSelector from "@/components/RelationshipSelector.vue";
import { useAuthStore } from "@/stores/auth";
import type { MemoryTransport } from "@/api/memory";
import { useMemoryStore, type MemoryErrorCode } from "@/stores/memory";
import { useRelationshipStore } from "@/stores/relationship";

const memory = useMemoryStore();
const relStore = useRelationshipStore();
const auth = useAuthStore();

const relationshipId = ref("");
const busy = ref(false);
const editingId = ref<string | null>(null);
const draftSummary = ref("");
const hasLoaded = ref(false);
const showEmptyPending = computed(
  () => hasLoaded.value && memory.pendingCount === 0,
);
const showEmptyCanonical = computed(
  () => hasLoaded.value && memory.canonicalCount === 0,
);
const showEmptyRelationshipId = computed(
  () => relationshipId.value.trim().length === 0,
);
const showPrefillHint = computed(
  () =>
    relationshipId.value.trim().length > 0 &&
    !hasLoaded.value &&
    memory.error === null,
);

// TASK-0105 (P2-16): shared authenticated transport -- the single place where
// credentials/CSRF are attached; an HTTP 401 routes to the auth store's
// session handling (clear + redirect to login) exactly like the rest of the H5.
const transport: MemoryTransport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  onUnauthorized: () => auth.onUnauthorized(),
});

const errorText = computed(() => {
  const map: Record<MemoryErrorCode, string> = {
    "load-failed": "加载失败，请稍后重试",
    "session-expired": "登录已过期，请重新登录",
    "confirm-not-confirmed": "确认未生效（候选不存在或已变更）",
    "confirm-failed": "确认失败，请稍后重试",
    "reject-not-confirmed": "拒绝未生效",
    "reject-failed": "拒绝失败，请稍后重试",
    "update-not-confirmed": "编辑未生效",
    "update-failed": "编辑失败，请稍后重试",
    "delete-not-confirmed": "删除未生效（记忆可能已不存在）",
    "delete-failed": "删除失败，请稍后重试",
    "evidence-failed": "来源加载失败，请稍后重试",
  };
  return memory.error ? map[memory.error] : "";
});

/** An empty evidence array must not render an empty container (P3-03). */
function hasEvidence(memoryId: string): boolean {
  const list = memory.evidence[memoryId];
  return Array.isArray(list) && list.length > 0;
}

function readQueryRelationshipId(): string {
  try {
    if (typeof location === "undefined") return "";
    return (
      new URLSearchParams(String(location.search || ""))
        .get("relationshipId")
        ?.trim() ?? ""
    );
  } catch {
    return "";
  }
}

function focusReload(): void {
  void nextTick(() => {
    try {
      if (typeof document !== "undefined") {
        document
          .querySelector<HTMLButtonElement>('[data-testid="reload"]')
          ?.focus();
      }
    } catch {
      // Best-effort a11y; never auto-load.
    }
  });
}

function onPickRelationship(id: string): void {
  if (!id) return;
  relationshipId.value = id;
  focusReload();
}

onMounted(() => {
  void relStore.load(transport);
  const prefill = readQueryRelationshipId();
  if (prefill && !relationshipId.value) {
    relationshipId.value = prefill;
    focusReload();
  }
});

async function reload(): Promise<void> {
  if (!relationshipId.value) return;
  busy.value = true;
  try {
    await memory.load(transport, relationshipId.value);
    hasLoaded.value = memory.error === null;
  } finally {
    busy.value = false;
  }
}

async function onConfirm(id: string): Promise<void> {
  busy.value = true;
  try {
    await memory.confirm(transport, id);
  } finally {
    busy.value = false;
  }
}

async function onReject(id: string): Promise<void> {
  busy.value = true;
  try {
    await memory.reject(transport, id);
  } finally {
    busy.value = false;
  }
}

function startEdit(id: string, summary: string): void {
  editingId.value = id;
  draftSummary.value = summary;
}

async function onSave(id: string): Promise<void> {
  busy.value = true;
  try {
    // Exit edit mode ONLY on a confirmed save (P3-03); on failure the edit row
    // stays open and the error region announces the typed failure.
    const saved = await memory.update(transport, id, draftSummary.value);
    if (saved) {
      editingId.value = null;
    }
  } finally {
    busy.value = false;
  }
}

async function onDelete(id: string): Promise<void> {
  busy.value = true;
  try {
    await memory.remove(transport, id);
  } finally {
    busy.value = false;
  }
}

async function onEvidence(id: string): Promise<void> {
  await memory.loadEvidence(transport, id);
}

function chatHref(): string {
  const id = relationshipId.value.trim();
  if (!id) return "/pages/chat/chat";
  return `/pages/chat/chat?relationshipId=${encodeURIComponent(id)}`;
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
    // Presentation-only navigation; never break memory confirm/load.
  }
}
</script>

<style scoped>
.memory-page {
  padding: 12px;
}
.bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.rel-input {
  flex: 1;
  border: 1px solid #ccc;
  padding: 6px;
}
.nav-index {
  flex: 0 0 auto;
}
.section {
  margin-bottom: 16px;
}
.section-title {
  font-weight: bold;
  display: block;
  margin-bottom: 4px;
}
.hint {
  color: #888;
  font-size: 12px;
  display: block;
  margin-bottom: 8px;
}
.empty-status {
  color: #666;
  font-size: 13px;
  margin-bottom: 8px;
}
.card {
  border: 1px solid #eee;
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
}
.card.pending {
  border-left: 3px solid #d97706;
}
.card.canonical {
  border-left: 3px solid #2563eb;
}
.summary {
  display: block;
}
.meta {
  color: #666;
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.edit-row {
  display: flex;
  gap: 6px;
}
.edit-input {
  flex: 1;
  border: 1px solid #ccc;
  padding: 4px;
}
.evidence {
  margin-top: 6px;
}
.source {
  display: block;
  font-size: 12px;
  color: #555;
}
.error {
  color: #b91c1c;
  margin-bottom: 8px;
}
</style>
