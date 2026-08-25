<!-- TASK-0030: H5 memory management page. Renders pending candidates (never as
saved facts) separately from canonical memory; confirm/reject/edit/delete actions
route through the store, which only mutates state on a confirmed API result and
surfaces failures instead of faking success. Sources come from the API.
TASK-0105 (P2-16/P3-03/P3-04): transport is the shared authenticated transport
(401 -> session handling, CSRF on state changes); edit mode exits only on
confirmed save; empty evidence does not render a container; error and busy
states carry alert/live a11y semantics. -->
<template>
  <!-- DOGFOOD-09：页面容器声明 main landmark；本页没有可见页面标题，用与
       导航栏标题同文案的视觉隐藏一级标题保住标题语义。 -->
  <view class="memory-page" role="main">
    <text class="vc-sr-only" role="heading" aria-level="1">记忆管理</text>
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
      <button
        data-testid="nav-login"
        class="nav-index"
        aria-label="登录"
        @click="goTo('/pages/login/login')"
      >
        登录
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
    <input
      v-model="filterQuery"
      class="rel-input"
      data-testid="memory-filter"
      placeholder="按内容筛选"
      aria-label="按内容筛选"
    />

    <view
      v-if="relStore.status === 'ready'"
      class="current-relationship"
      data-testid="current-relationship"
      role="status"
    >
      <text>{{
        relationshipId.trim()
          ? `当前关系：${relationshipId.trim()}`
          : "还没有当前关系。"
      }}</text>
    </view>
    <view
      v-else-if="relStore.status === 'error'"
      class="current-relationship"
      data-testid="relationship-load-error"
      role="status"
    >
      <text>关系列表加载失败。</text>
    </view>

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

    <ErrorNotice
      v-if="memory.error"
      :message="errorText"
      :request-id="memoryRequestId ?? undefined"
      :stale="memory.canonicalCount > 0 || memory.pendingCount > 0"
    />
    <RetryButton
      v-if="memory.error === 'load-failed'"
      :disabled="busy"
      @retry="reload"
    />

    <!-- MEM-AUTO-SAVE (§7.4): the low-sensitivity auto-save switch. Only the
         fixed whitelist categories (称呼/口味/作息) auto-save; every auto row
         is marked below and individually deletable; the switch can be turned
         off at any time (可随时撤销). -->
    <view class="auto-save-card" data-testid="memory-auto-save">
      <view class="auto-save-copy">
        <text class="section-subtitle">低敏记忆自动保存</text>
        <text class="meta">
          仅称呼、口味、作息三类短句自动保存；其余仍需你确认。自动保存的条目会标注，可随时删除。
        </text>
      </view>
      <button
        data-testid="memory-auto-save-toggle"
        class="nav-index"
        :disabled="busy || autoSaveFailed"
        @click="onToggleAutoSave"
      >
        {{ autoSaveEnabled ? "已开启（点击关闭）" : "已关闭（点击开启）" }}
      </button>
    </view>
    <view
      v-if="autoSaveFailed"
      class="error"
      data-testid="memory-auto-save-failed"
      role="alert"
    >
      <text>自动保存开关加载失败，请重试。</text>
    </view>

    <view class="section" aria-live="polite">
      <text class="section-title">待确认候选（{{ memory.pendingCount }}）</text>
      <text class="hint">候选未经确认，不作为已保存事实。</text>
      <!-- MEM-MANUAL: user-entered candidate (RELATIONSHIP scope, always
           PENDING_CONFIRMATION until confirmed). -->
      <view class="candidate-entry">
        <input
          v-model="candidateSummary"
          class="candidate-input"
          data-testid="candidate-input"
          placeholder="手动添加一条记忆候选…"
          aria-label="手动添加记忆候选"
        />
        <button
          data-testid="candidate-add"
          class="nav-index"
          :disabled="!canAddCandidate || busy"
          @click="onAddCandidate"
        >
          添加
        </button>
      </view>
      <!-- R44 (§11.12): optional event fields — any event field requires the
           anchor 事件时间; expiry strictly after it. -->
      <view class="candidate-event">
        <input
          v-model="candidateEventAt"
          class="event-input"
          type="datetime-local"
          data-testid="candidate-event-at"
          placeholder="事件时间（可选）"
          aria-label="事件时间（可选）"
        />
        <select
          v-if="candidateEventAt"
          v-model="candidateEventStatus"
          class="event-input"
          data-testid="candidate-event-status"
          aria-label="事件状态"
        >
          <option
            v-for="s in eventStatuses"
            :key="s.code"
            :value="s.code"
          >
            {{ s.label }}
          </option>
        </select>
        <input
          v-if="candidateEventAt"
          v-model="candidateEventExpiresAt"
          class="event-input"
          type="datetime-local"
          data-testid="candidate-event-expires-at"
          placeholder="过期时间（可选）"
          aria-label="事件过期时间（可选）"
        />
        <text v-if="candidateEventAt" class="hint">
          事件记忆在过期后自动不再使用；到期后只会询问后续，不会编造结果。
        </text>
      </view>
      <view
        v-if="showEmptyPending"
        class="empty-status"
        data-testid="empty-pending"
        role="status"
      >
        <text>还没有待确认候选。模型提取的内容需你确认后才会成为记忆。</text>
      </view>
      <view
        v-for="m in visiblePending"
        :key="m.memoryId"
        class="card pending"
      >
        <text class="summary">{{ m.summary }}</text>
        <text class="meta">{{ m.scope }}</text>
        <text v-if="m.eventAt" class="meta" :data-testid="`memory-event-${m.memoryId}`">
          事件：{{ formatTimestamp(m.eventAt) }} · {{ eventStatusLabel(m.eventStatus) }}
        </text>
        <!-- R44 (§11.11): the explicit supersede choice — confirm may replace
             one active canonical memory; nothing is auto-detected. -->
        <select
          v-if="memory.canonicalCount > 0"
          v-model="supersedeChoice[m.memoryId]"
          class="supersede-select"
          :data-testid="`memory-supersede-${m.memoryId}`"
          aria-label="替代哪条已有记忆（可选）"
        >
          <option value="">不替代已有记忆</option>
          <option
            v-for="old in memory.canonical"
            :key="old.memoryId"
            :value="old.memoryId"
          >
            替代：{{ old.summary.slice(0, 24) }}
          </option>
        </select>
        <view class="actions">
          <button
            size="mini"
            data-testid="memory-confirm"
            :disabled="busy"
            @click="onConfirm(m.memoryId)"
          >
            确认
          </button>
          <button size="mini" :disabled="busy" @click="onReject(m.memoryId)">
            拒绝
          </button>
          <button
            size="mini"
            data-testid="memory-open-detail"
            @click="openDetail(m.memoryId)"
          >
            详情
          </button>
        </view>
      </view>
    </view>

    <view class="section" aria-live="polite">
      <text class="section-title">已保存记忆（{{ memory.canonicalCount }}）</text>
      <view
        v-if="showEmptyCanonical"
        class="empty-status"
        data-testid="empty-canonical"
        role="status"
      >
        <text>还没有已保存记忆。</text>
      </view>
      <template v-else>
        <view
          v-if="visibleRelationship.length > 0"
          data-testid="memory-group-relationship"
        >
          <text class="section-subtitle">当前角色专属</text>
          <view
            v-for="m in visibleRelationship"
            :key="m.memoryId"
            class="card canonical"
          >
            <text v-if="editingId !== m.memoryId" class="summary">{{ m.summary }}<text
                v-if="m.autoSaved"
                class="auto-badge"
                :data-testid="`memory-auto-${m.memoryId}`"
              >自动保存</text></text>
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
            <text class="meta">{{ publicMemoryScopeLabel(m.scope) }}</text>
            <text v-if="m.createdAt" class="meta" :data-testid="`memory-created-${m.memoryId}`">
              {{ formatTimestamp(m.createdAt) }}
            </text>
            <text v-if="m.eventAt" class="meta" :data-testid="`memory-event-${m.memoryId}`">
              事件：{{ formatTimestamp(m.eventAt) }} · {{ eventStatusLabel(m.eventStatus) }}
            </text>
            <view
              v-if="confirmDeleteId === m.memoryId"
              class="delete-confirm"
              data-testid="memory-delete-confirm"
              role="alert"
            >
              <text>
                将删除“{{ m.summary }}”（{{ publicMemoryScopeLabel(m.scope) }}）。删除后不再用于回复，来源链接也不再展示；删除失败时本条会保留。
              </text>
            </view>
            <view class="actions">
              <button
                size="mini"
                :disabled="busy"
                @click="startEdit(m.memoryId, m.summary)"
              >
                编辑
              </button>
              <button
                size="mini"
                data-testid="memory-delete"
                :disabled="busy"
                @click="onDelete(m.memoryId)"
              >
                {{ confirmDeleteId === m.memoryId ? "确认删除这条记忆？" : "删除" }}
              </button>
              <button
                size="mini"
                data-testid="memory-open-detail"
                @click="openDetail(m.memoryId)"
              >
                详情
              </button>
            </view>
          </view>
        </view>
        <view
          v-if="visibleSession.length > 0"
          data-testid="memory-group-session"
        >
          <text class="section-subtitle">会话记忆</text>
          <view
            v-for="m in visibleSession"
            :key="m.memoryId"
            class="card canonical"
          >
            <text v-if="editingId !== m.memoryId" class="summary">{{ m.summary }}<text
                v-if="m.autoSaved"
                class="auto-badge"
                :data-testid="`memory-auto-${m.memoryId}`"
              >自动保存</text></text>
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
            <text class="meta">{{ publicMemoryScopeLabel(m.scope) }}</text>
            <text v-if="m.createdAt" class="meta" :data-testid="`memory-created-${m.memoryId}`">
              {{ formatTimestamp(m.createdAt) }}
            </text>
            <text v-if="m.eventAt" class="meta" :data-testid="`memory-event-${m.memoryId}`">
              事件：{{ formatTimestamp(m.eventAt) }} · {{ eventStatusLabel(m.eventStatus) }}
            </text>
            <view
              v-if="confirmDeleteId === m.memoryId"
              class="delete-confirm"
              data-testid="memory-delete-confirm"
              role="alert"
            >
              <text>
                将删除“{{ m.summary }}”（{{ publicMemoryScopeLabel(m.scope) }}）。删除后不再用于回复，来源链接也不再展示；删除失败时本条会保留。
              </text>
            </view>
            <view class="actions">
              <button
                size="mini"
                :disabled="busy"
                @click="startEdit(m.memoryId, m.summary)"
              >
                编辑
              </button>
              <button
                size="mini"
                data-testid="memory-delete"
                :disabled="busy"
                @click="onDelete(m.memoryId)"
              >
                {{ confirmDeleteId === m.memoryId ? "确认删除这条记忆？" : "删除" }}
              </button>
              <button
                size="mini"
                data-testid="memory-open-detail"
                @click="openDetail(m.memoryId)"
              >
                详情
              </button>
            </view>
          </view>
        </view>
      </template>
    </view>

    <view
      v-if="visibleRejected.length > 0"
      class="section"
      data-testid="memory-group-rejected"
      aria-live="polite"
    >
      <text class="section-title">已拒绝（{{ memory.rejected.length }}）</text>
      <text class="hint">这些候选已被拒绝，不作为已保存事实。</text>
      <view v-for="m in visibleRejected" :key="m.memoryId" class="card">
        <text class="summary">{{ m.summary }}</text>
        <text class="meta">{{ m.scope }} · {{ m.status }}</text>
        <view class="actions">
          <button
            size="mini"
            data-testid="memory-open-detail"
            @click="openDetail(m.memoryId)"
          >
            详情
          </button>
        </view>
      </view>
    </view>

    <view
      v-if="visibleExpired.length > 0"
      class="section"
      data-testid="memory-group-expired"
      aria-live="polite"
    >
      <text class="section-title">已过期（{{ memory.expired.length }}）</text>
      <text class="hint">这些记录已过期，不作为已保存事实。</text>
      <view v-for="m in visibleExpired" :key="m.memoryId" class="card">
        <text class="summary">{{ m.summary }}</text>
        <text class="meta">{{ m.scope }} · {{ m.status }}</text>
        <view class="actions">
          <button
            size="mini"
            data-testid="memory-open-detail"
            @click="openDetail(m.memoryId)"
          >
            详情
          </button>
        </view>
      </view>
    </view>

    <view
      v-if="visibleSuperseded.length > 0"
      class="section"
      data-testid="memory-group-superseded"
      aria-live="polite"
    >
      <text class="section-title">已替代（{{ memory.superseded.length }}）</text>
      <text class="hint">这些记忆已被更新的确认事实替代，不作为已保存事实。</text>
      <view v-for="m in visibleSuperseded" :key="m.memoryId" class="card">
        <text class="summary">{{ m.summary }}</text>
        <text class="meta">{{ m.scope }} · 已被替代</text>
        <view class="actions">
          <button
            size="mini"
            data-testid="memory-open-detail"
            @click="openDetail(m.memoryId)"
          >
            详情
          </button>
        </view>
      </view>
    </view>

    <view
      v-if="visibleDeleted.length > 0"
      class="section"
      data-testid="memory-group-deleted"
      aria-live="polite"
    >
      <text class="section-title">已删除（{{ memory.deleted.length }}）</text>
      <text class="hint">这些记录已删除，不作为已保存事实。</text>
      <view v-for="m in visibleDeleted" :key="m.memoryId" class="card">
        <text class="summary">{{ m.summary }}</text>
        <text class="meta">{{ m.scope }} · 已删除</text>
        <view class="actions">
          <button
            size="mini"
            data-testid="memory-open-detail"
            @click="openDetail(m.memoryId)"
          >
            详情
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import ErrorNotice from "@/design-system/ErrorNotice.vue";
import RelationshipSelector from "@/components/RelationshipSelector.vue";
import RetryButton from "@/design-system/RetryButton.vue";
import { buildContextHref, readContextFromLocation } from "@/domain/context-href";
import { publicMemoryScopeLabel } from "@/domain/public-memory-display";
import { matchesLooseText } from "@/domain/text-filter";
import { lastRequestId } from "@/domain/request-id";
import { formatTimestamp } from "@/domain/timestamp";
import { useAuthStore } from "@/stores/auth";
import type { Memory, MemoryEventStatus, MemoryTransport } from "@/api/memory";
import { getMemoryAutoSave, setMemoryAutoSave } from "@/api/memory";
import { useMemoryStore, type MemoryErrorCode } from "@/stores/memory";
import { useRelationshipStore } from "@/stores/relationship";

const memory = useMemoryStore();
const relStore = useRelationshipStore();
const auth = useAuthStore();

const relationshipId = ref("");
const filterQuery = ref("");
const busy = ref(false);
const editingId = ref<string | null>(null);
const draftSummary = ref("");
// MEM-MANUAL: manual candidate entry (RELATIONSHIP scope).
const candidateSummary = ref("");
// R44 (§11.12): optional event fields on manual candidates. datetime-local
// values convert to ISO instants; a filled-but-unparseable value blocks create.
const candidateEventAt = ref("");
const candidateEventStatus = ref<MemoryEventStatus>("PLANNED");
const candidateEventExpiresAt = ref("");
const eventStatuses = [
  { code: "PLANNED", label: "计划中" },
  { code: "IN_PROGRESS", label: "进行中" },
  { code: "COMPLETED", label: "已完成" },
  { code: "CANCELLED", label: "已取消" },
  { code: "UNKNOWN", label: "未知" },
] as const;
// R44 (§11.11): per-pending-card supersede choice ("" = plain confirm).
const supersedeChoice = ref<Record<string, string>>({});
const hasLoaded = ref(false);
// MEM-AUTO-SAVE (§7.4): the per-owner low-sensitivity switch.
const autoSaveEnabled = ref(false);
const autoSaveFailed = ref(false);
const canAddCandidate = computed(
  () => relationshipId.value.trim().length > 0 && candidateSummary.value.trim().length > 0,
);

async function loadAutoSave(): Promise<void> {
  autoSaveFailed.value = false;
  try {
    autoSaveEnabled.value = await getMemoryAutoSave(transport);
  } catch {
    autoSaveFailed.value = true;
  }
}

async function onToggleAutoSave(): Promise<void> {
  if (busy.value || autoSaveFailed.value) return;
  busy.value = true;
  try {
    const next = await setMemoryAutoSave(transport, !autoSaveEnabled.value);
    autoSaveEnabled.value = next;
  } catch {
    autoSaveFailed.value = true;
  } finally {
    busy.value = false;
  }
}

function visibleMemories(list: Memory[]): Memory[] {
  return list.filter((item) => matchesLooseText(item.summary, filterQuery.value));
}

const visiblePending = computed(() => visibleMemories(memory.pending));
const visibleRelationship = computed(() => visibleMemories(memory.relationshipCanonical));
const visibleSession = computed(() => visibleMemories(memory.sessionCanonical));
const visibleRejected = computed(() => visibleMemories(memory.rejected));
const visibleExpired = computed(() => visibleMemories(memory.expired));
const visibleSuperseded = computed(() => visibleMemories(memory.superseded));
const visibleDeleted = computed(() => visibleMemories(memory.deleted));
const showEmptyPending = computed(
  () => hasLoaded.value && memory.pendingCount === 0 && memory.error !== "load-failed",
);
const showEmptyCanonical = computed(
  () => hasLoaded.value && memory.canonicalCount === 0 && memory.error !== "load-failed",
);
const showEmptyRelationshipId = computed(
  () =>
    relationshipId.value.trim().length === 0 && relStore.status !== "error",
);
const showPrefillHint = computed(
  () =>
    relationshipId.value.trim().length > 0 &&
    !hasLoaded.value &&
    memory.error === null &&
    relStore.status !== "error",
);

// TASK-0105 (P2-16): shared authenticated transport -- the single place where
// credentials/CSRF are attached; an HTTP 401 routes to the auth store's
// session handling (clear + redirect to login) exactly like the rest of the H5.
// SESS-REVIVE: a 401 first tries one silent refresh and replays the request.
const transport: MemoryTransport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  renewAccessToken: () => auth.renewAccessToken(transport),
  onUnauthorized: () => auth.onUnauthorized(),
});

const memoryRequestId = computed(() => lastRequestId());

const errorText = computed(() => {
  const map: Record<MemoryErrorCode, string> = {
    "load-failed": "加载失败，请稍后重试",
    "session-expired": "登录已过期，请重新登录",
    "create-not-confirmed": "添加未生效（请检查内容或关系）",
    "create-failed": "添加失败，请稍后重试",
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

function readQueryRelationshipId(): string {
  try {
    if (typeof location === "undefined") return "";
    return readContextFromLocation(location).relationshipId ?? "";
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

onMounted(async () => {
  // SESS-REVIVE: restore the session from the HttpOnly refresh cookie first.
  if (!auth.isAuthenticated) {
    await auth.tryRefresh(transport);
  }
  await relStore.load(transport);
  void loadAutoSave();
  const prefill = readQueryRelationshipId();
  const known = knownRelationshipIds();
  if (prefill && known?.includes(prefill) && !relationshipId.value) {
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
    const supersedeId = supersedeChoice.value[id] || undefined;
    await memory.confirm(transport, id, supersedeId, relationshipId.value.trim());
    if (memory.error === null) {
      delete supersedeChoice.value[id];
    }
  } finally {
    busy.value = false;
  }
}

/** MEM-MANUAL: submit a user-entered candidate; clear the input on success. */
async function onAddCandidate(): Promise<void> {
  const summary = candidateSummary.value.trim();
  if (!summary || !relationshipId.value.trim()) return;
  const eventAt = toIsoOrNull(candidateEventAt.value);
  const eventExpiresAt = toIsoOrNull(candidateEventExpiresAt.value);
  if (candidateEventAt.value && !eventAt) return; // unparseable: block the create
  if (candidateEventExpiresAt.value && !eventExpiresAt) return;
  busy.value = true;
  try {
    if (eventAt) {
      await memory.create(transport, relationshipId.value.trim(), summary, {
        eventAt,
        eventStatus: candidateEventStatus.value,
        eventExpiresAt: eventExpiresAt ?? undefined,
      });
    } else {
      await memory.create(transport, relationshipId.value.trim(), summary);
    }
    if (memory.error === null) {
      candidateSummary.value = "";
      candidateEventAt.value = "";
      candidateEventExpiresAt.value = "";
      candidateEventStatus.value = "PLANNED";
    }
  } finally {
    busy.value = false;
  }
}

/** datetime-local → RFC-3339 instant; empty stays empty, garbage yields null. */
function toIsoOrNull(raw: string): string | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function eventStatusLabel(status?: string): string {
  return eventStatuses.find((s) => s.code === status)?.label ?? "未知";
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

const confirmDeleteId = ref<string | null>(null);

async function onDelete(id: string): Promise<void> {
  if (confirmDeleteId.value !== id) {
    confirmDeleteId.value = id;
    return;
  }
  busy.value = true;
  try {
    await memory.remove(transport, id);
    if (memory.error === null) {
      confirmDeleteId.value = null;
    }
  } finally {
    busy.value = false;
  }
}

function knownRelationshipIds(): string[] | undefined {
  return relStore.status === "ready"
    ? relStore.relationships.map((row) => row.relationshipId)
    : undefined;
}

function openDetail(id: string): void {
  goTo(
    buildContextHref("memory-detail", {
      relationshipId: relationshipId.value,
      memoryId: id,
      knownRelationshipIds: knownRelationshipIds(),
    }),
  );
}

function chatHref(): string {
  return buildContextHref("chat", {
    relationshipId: relationshipId.value,
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
.section-subtitle {
  font-weight: 600;
  display: block;
  margin: 8px 0 4px;
  font-size: 13px;
  color: #444;
}
.hint {
  color: #5a6b7b;
  font-size: 12px;
  display: block;
  margin-bottom: 8px;
}
.empty-status {
  color: #666;
  font-size: 13px;
  margin-bottom: 8px;
}
.current-relationship {
  color: #555;
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
.candidate-entry {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.candidate-input {
  flex: 1;
  border: 1px solid #ccc;
  padding: 6px;
}
.candidate-event {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
  align-items: center;
}
.event-input {
  border: 1px solid #ccc;
  padding: 4px;
}
.supersede-select {
  margin-top: 6px;
  border: 1px solid #ccc;
  padding: 4px;
  max-width: 100%;
}
.error {
  color: #b91c1c;
  margin-bottom: 8px;
}
.auto-save-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
  border: 1px solid #d8dce6;
  border-radius: 8px;
  background-color: #f7f8fb;
}
.auto-save-copy {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.auto-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background-color: #e3f0fb;
  color: #1c5d99;
  font-size: 12px;
}
</style>
