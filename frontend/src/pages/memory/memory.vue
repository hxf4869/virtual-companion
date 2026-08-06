<!-- TASK-0030: H5 memory management page. Renders pending candidates (never as
saved facts) separately from canonical memory; confirm/reject/edit/delete actions
route through the store, which only mutates state on a confirmed API result and
surfaces failures instead of faking success. Sources come from the API. -->
<template>
  <view class="memory-page">
    <view class="bar">
      <input
        v-model="relationshipId"
        class="rel-input"
        placeholder="relationship id"
      />
      <button :disabled="!relationshipId || busy" @click="reload">
        刷新记忆
      </button>
    </view>

    <view v-if="memory.error" class="error">{{ errorText }}</view>

    <view class="section">
      <text class="section-title">待确认候选（{{ memory.pendingCount }}）</text>
      <text class="hint">候选未经确认，不作为已保存事实。</text>
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
        <view v-if="memory.evidence[m.memoryId]" class="evidence">
          <text
            v-for="e in memory.evidence[m.memoryId]"
            :key="e.evidenceId"
            class="source"
          >• {{ e.sourceRef }}</text>
        </view>
      </view>
    </view>

    <view class="section">
      <text class="section-title">Canonical 记忆（{{ memory.canonicalCount }}）</text>
      <view
        v-for="m in memory.canonical"
        :key="m.memoryId"
        class="card canonical"
      >
        <text v-if="editingId !== m.memoryId" class="summary">{{ m.summary }}</text>
        <view v-else class="edit-row">
          <input v-model="draftSummary" class="edit-input" />
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
        <view v-if="memory.evidence[m.memoryId]" class="evidence">
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
import { computed, ref } from "vue";

import type { MemoryTransport } from "@/api/memory";
import { useMemoryStore, type MemoryErrorCode } from "@/stores/memory";

const memory = useMemoryStore();

const relationshipId = ref("");
const busy = ref(false);
const editingId = ref<string | null>(null);
const draftSummary = ref("");

// Production transport: fetch-based (H5). Network failures throw and are caught
// by the store, which surfaces a failure instead of faking success.
const transport: MemoryTransport = {
  async request(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  },
};

const errorText = computed(() => {
  const map: Record<MemoryErrorCode, string> = {
    "load-failed": "加载失败",
    "confirm-not-confirmed": "确认未生效（候选不存在或已变更）",
    "confirm-failed": "确认失败",
    "reject-not-confirmed": "拒绝未生效",
    "reject-failed": "拒绝失败",
    "update-not-confirmed": "编辑未生效",
    "update-failed": "编辑失败",
    "delete-not-confirmed": "删除未生效（记忆可能已不存在）",
    "delete-failed": "删除失败",
    "evidence-failed": "来源加载失败",
  };
  return memory.error ? map[memory.error] : "";
});

async function reload(): Promise<void> {
  if (!relationshipId.value) return;
  busy.value = true;
  try {
    await memory.load(transport, relationshipId.value);
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
    await memory.update(transport, id, draftSummary.value);
    editingId.value = null;
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
