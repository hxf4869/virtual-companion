<template>
  <!-- 记忆管理：自动记忆总开关 + 已保存记忆（ACCEPTED）主视图 +
       待确认候选（PENDING_CONFIRMATION）次级分区。列表接口无分页参数，
       一次加载该关系下全部未删除记忆；已拒绝条目不展示。 -->
  <ConsumerShell route="/pages/memory/memory">
    <view class="memory-page">
      <view
        v-if="relState === 'loading' || firstListLoading"
        class="memory-state"
        data-testid="memory-loading"
        role="status"
      >
        <view class="memory-skeleton memory-skeleton--short" aria-hidden="true" />
        <view class="memory-skeleton" aria-hidden="true" />
        <view class="memory-skeleton" aria-hidden="true" />
        <text class="vc-sr-only">正在加载记忆</text>
      </view>

      <view
        v-else-if="relState === 'error'"
        class="memory-state memory-state--center"
        data-testid="memory-load-failed"
        role="alert"
      >
        <text class="memory-state__title">记忆没有加载出来</text>
        <text class="memory-state__copy">检查网络后再试一次。</text>
        <button type="button" class="secondary-action" data-testid="memory-retry" @click="initialLoad">
          重新加载
        </button>
      </view>

      <view
        v-else-if="relState === 'missing'"
        class="memory-state memory-state--center"
        data-testid="memory-missing"
        role="status"
      >
        <text class="memory-state__title">你的陪伴还没准备好</text>
        <text class="memory-state__copy">重新加载后，我们会继续为你准备。</text>
        <button type="button" class="secondary-action" data-testid="memory-retry" @click="initialLoad">
          重新加载
        </button>
      </view>

      <template v-else>
        <section class="autosave-card" aria-labelledby="autosave-title">
          <view class="autosave-card__head">
            <text id="autosave-title" class="autosave-card__title">自动记忆</text>
            <button
              type="button"
              class="autosave-toggle"
              role="switch"
              :aria-checked="autoSaveChecked"
              data-testid="autosave-toggle"
              :disabled="autoSaveToggleDisabled"
              @click="onToggleAutoSave"
            >
              {{ autoSaveToggleLabel }}
            </button>
          </view>

          <text
            v-if="memory.autoSaveState === 'loading'"
            class="autosave-card__note"
            data-testid="autosave-loading"
            role="status"
          >
            正在读取开关状态…
          </text>
          <template v-else-if="memory.autoSaveState === 'error'">
            <text class="autosave-card__note autosave-card__note--error" data-testid="autosave-error" role="alert">
              {{ autoSaveNotice || "开关状态没有加载出来，暂时无法确认是否开启。" }}
            </text>
            <button
              type="button"
              class="text-action"
              data-testid="autosave-retry"
              @click="retryAutoSave"
            >
              重新读取
            </button>
          </template>
          <template v-else-if="memory.autoSaveState === 'unknown'">
            <text class="autosave-card__note autosave-card__note--error" data-testid="autosave-unknown" role="alert">
              已提交，未能确认开关是否生效。
            </text>
            <button
              type="button"
              class="text-action"
              data-testid="autosave-reload"
              @click="retryAutoSave"
            >
              重新读取
            </button>
          </template>
          <template v-else-if="autoSaveNotice">
            <text class="autosave-card__note autosave-card__note--error" data-testid="autosave-rejected" role="alert">
              {{ autoSaveNotice }}
            </text>
          </template>
          <text v-else class="autosave-card__note" data-testid="autosave-note">
            开启时，陪伴会自动从聊天里提取并保存值得记住的内容。关闭后，将停止新的自动提取与保存；已保存的记忆仍会继续用于聊天，除非你在这里逐条删除。
          </text>
        </section>

        <view
          v-if="memory.listStatus === 'error'"
          class="memory-list-error"
          data-testid="memory-list-error"
          role="alert"
        >
          <text>最新内容没有加载出来，下方可能不是当前列表。</text>
          <button type="button" class="text-action" data-testid="memory-list-retry" @click="retryList">
            重新加载
          </button>
        </view>
        <view
          v-else-if="listInconclusiveNotice"
          class="memory-list-inconclusive"
          data-testid="memory-list-inconclusive-notice"
          role="status"
        >
          <text>最新内容没有读出来，下方可能不是当前列表。</text>
          <button type="button" class="text-action" data-testid="memory-inconclusive-retry" @click="retryList">
            重新读取
          </button>
        </view>

        <view
          v-if="listUnconfirmedEmpty"
          class="memory-state memory-state--center"
          data-testid="memory-list-inconclusive"
          role="status"
        >
          <text class="memory-state__title">暂时无法确认这里的记忆</text>
          <text class="memory-state__copy">
            现在没有读出已保存的内容，也可能这里暂时不可访问；稍后再试一次。
          </text>
          <button
            type="button"
            class="secondary-action"
            data-testid="memory-inconclusive-retry"
            @click="retryList"
          >
            重新读取
          </button>
        </view>

        <view
          v-else-if="listEmpty"
          class="memory-state memory-state--center"
          data-testid="memory-empty"
          role="status"
        >
          <view class="memory-state__mark" aria-hidden="true">
            <AppIcon name="document" :size="24" />
          </view>
          <text class="memory-state__title">这里还什么都没存</text>
          <text class="memory-state__copy">
            聊到的喜好、近况和约定会保存到这里，帮陪伴记住你；你可以随时编辑或删除。
          </text>
        </view>

        <template v-else>
          <section class="memory-section" aria-labelledby="memory-saved-title">
            <text id="memory-saved-title" class="memory-section__title">已保存</text>
            <view class="memory-list" data-testid="memory-saved-list">
              <text
                v-if="memory.acceptedItems.length === 0"
                class="memory-section__none"
              >
                还没有已保存的记忆。
              </text>
              <view
                v-for="item in memory.acceptedItems"
                :key="item.memoryId"
                class="memory-row"
                data-testid="memory-row"
              >
                <view class="memory-row__body">
                  <text class="memory-row__summary" data-testid="memory-summary">{{ item.summary }}</text>
                  <view class="memory-row__meta">
                    <text
                      class="memory-badge"
                      :class="{ 'memory-badge--auto': item.autoSaved }"
                      data-testid="memory-badge"
                    >
                      {{ item.autoSaved ? "自动保存" : "已确认" }}
                    </text>
                    <text data-testid="memory-time">{{ formatLocalDateTime(item.createdAt) }} 保存</text>
                    <text data-testid="memory-source">
                      {{ item.conversationId ? "来自一段对话" : "来源内容已不可用" }}
                    </text>
                  </view>
                </view>

                <text
                  v-if="verifyingDeleteId === item.memoryId"
                  class="memory-row__error"
                  data-testid="memory-verifying"
                  role="status"
                >
                  删除结果核对中，暂时不能确认这条记忆是否已删除。
                </text>
                <text
                  v-else-if="unavailableDeleteIds.includes(item.memoryId)"
                  class="memory-row__error"
                  data-testid="memory-unavailable"
                  role="status"
                >
                  这条记忆当前不可用，暂时不能确认删除是否完成。
                </text>

                <view v-if="editingId === item.memoryId" class="memory-edit" data-testid="memory-edit-box">
                  <textarea
                    v-model="editDraft"
                    class="memory-edit__input"
                    data-testid="memory-edit-input"
                    maxlength="2000"
                    aria-label="编辑记忆内容"
                  />
                  <text
                    v-if="editError"
                    class="memory-row__error"
                    data-testid="memory-edit-error"
                    role="alert"
                  >
                    {{ editError }}
                  </text>
                  <view class="memory-actions">
                    <button
                      type="button"
                      class="memory-action"
                      data-testid="memory-edit-cancel"
                      :disabled="editBusy"
                      @click="cancelEdit"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      class="memory-action memory-action--primary"
                      data-testid="memory-edit-save"
                      :disabled="editBusy"
                      @click="saveEdit(item)"
                    >
                      {{ editBusy ? "保存中…" : "保存" }}
                    </button>
                  </view>
                </view>

                <view v-else class="memory-actions">
                  <button
                    type="button"
                    class="memory-action"
                    data-testid="memory-edit"
                    @click="startEdit(item)"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    class="memory-action memory-action--danger"
                    data-testid="memory-delete"
                    @click="askDelete(item.memoryId)"
                  >
                    删除
                  </button>
                </view>

                <view
                  v-if="confirmDeleteId === item.memoryId"
                  class="memory-confirm"
                  data-testid="memory-delete-box"
                >
                  <text class="memory-confirm__title">删除这条记忆？</text>
                  <text class="memory-confirm__copy">这条长期记忆将不再用于后续回复；原聊天记录不会一并删除。</text>
                  <text
                    v-if="deleteError"
                    class="memory-row__error"
                    data-testid="memory-delete-error"
                    role="alert"
                  >
                    {{ deleteError }}
                  </text>
                  <view class="memory-actions">
                    <button
                      type="button"
                      class="memory-action"
                      data-testid="memory-delete-cancel"
                      :disabled="deleteBusy"
                      @click="closeDelete"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      class="memory-action memory-action--danger"
                      data-testid="memory-delete-confirm"
                      :disabled="deleteBusy"
                      @click="doDelete(item)"
                    >
                      {{ deleteBusy ? "删除中…" : "删除" }}
                    </button>
                  </view>
                </view>
              </view>
            </view>
          </section>

          <section v-if="memory.pendingItems.length > 0" class="memory-section" aria-labelledby="memory-pending-title">
            <text id="memory-pending-title" class="memory-section__title">待确认</text>
            <view class="memory-list memory-list--pending" data-testid="memory-pending">
              <view
                v-for="item in memory.pendingItems"
                :key="item.memoryId"
                class="memory-row memory-row--pending"
                data-testid="pending-row"
              >
                <view class="memory-row__body">
                  <text class="memory-row__summary" data-testid="pending-summary">{{ item.summary }}</text>
                  <view class="memory-row__meta">
                    <text data-testid="pending-time">{{ formatLocalDateTime(item.createdAt) }} 提取</text>
                  </view>
                </view>

                <view v-if="editingId === item.memoryId" class="memory-edit" data-testid="pending-edit-box">
                  <textarea
                    v-model="editDraft"
                    class="memory-edit__input"
                    data-testid="pending-edit-input"
                    maxlength="2000"
                    aria-label="编辑待确认记忆"
                  />
                  <text
                    v-if="editError"
                    class="memory-row__error"
                    data-testid="pending-edit-error"
                    role="alert"
                  >
                    {{ editError }}
                  </text>
                  <view class="memory-actions">
                    <button
                      type="button"
                      class="memory-action"
                      data-testid="pending-edit-cancel"
                      :disabled="editBusy"
                      @click="cancelEdit"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      class="memory-action memory-action--primary"
                      data-testid="pending-edit-save"
                      :disabled="editBusy"
                      @click="saveEdit(item)"
                    >
                      {{ editBusy ? "保存中…" : "保存" }}
                    </button>
                  </view>
                </view>

                <text
                  v-else-if="rowErrorId === item.memoryId"
                  class="memory-row__error"
                  data-testid="pending-error"
                  role="alert"
                >
                  {{ rowErrorMessage }}
                </text>

                <view v-if="editingId !== item.memoryId" class="memory-actions">
                  <button
                    type="button"
                    class="memory-action"
                    data-testid="pending-edit"
                    :disabled="pendingBusyId === item.memoryId"
                    @click="startEdit(item)"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    class="memory-action memory-action--danger"
                    data-testid="pending-reject"
                    :disabled="pendingBusyId === item.memoryId"
                    @click="rejectCandidate(item)"
                  >
                    {{ pendingBusyId === item.memoryId ? "处理中…" : "拒绝" }}
                  </button>
                  <button
                    type="button"
                    class="memory-action memory-action--primary"
                    data-testid="pending-confirm"
                    :disabled="pendingBusyId === item.memoryId"
                    @click="confirmCandidate(item)"
                  >
                    {{ pendingBusyId === item.memoryId ? "处理中…" : "确认" }}
                  </button>
                </view>
              </view>
            </view>
          </section>
        </template>

        <view
          v-if="unknownAction"
          class="memory-unknown"
          data-testid="memory-unknown"
          role="alert"
        >
          <text>已提交，未能确认结果。</text>
          <button type="button" class="text-action" data-testid="memory-refresh" @click="refreshList">
            刷新核对
          </button>
        </view>
        <view
          v-else-if="rejectedNotice"
          class="memory-unknown"
          data-testid="memory-rejected"
          role="alert"
        >
          <text>{{ rejectedNotice }}</text>
        </view>
      </template>
    </view>
  </ConsumerShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import {
  classifyMemoryWriteError,
  confirmMemory,
  deleteMemory,
  rejectMemory,
  updateMemory,
  type MemoryItem,
  type MemoryStatus,
  type MemoryTransport,
} from "@/api/memory";
import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import AppIcon from "@/design-system/AppIcon.vue";
import { formatLocalDateTime } from "@/domain/timestamp";
import { useAuthStore } from "@/stores/auth";
import { useMemoryStore } from "@/stores/memory";
import { useRelationshipStore } from "@/stores/relationship";

type RelState = "loading" | "ready" | "error" | "missing";

/** 未确认写结果：刷新核对时按预期结果验证，不能确认则保留提示。 */
type UnknownWriteAction =
  | { kind: "edit"; memoryId: string; expectedSummary: string }
  | { kind: "delete"; memoryId: string }
  | { kind: "candidate"; memoryId: string; expectedStatus: MemoryStatus };

const auth = useAuthStore();
const relStore = useRelationshipStore();
const memory = useMemoryStore();

const relState = ref<RelState>("loading");
const relationshipId = ref("");
const busy = ref(false);
const unknownAction = ref<UnknownWriteAction | null>(null);
const rejectedNotice = ref("");
const autoSaveTarget = ref<boolean | null>(null);
const autoSaveNotice = ref("");
/**
 * 最近一次列表读取结果不确定（存在性隐藏/响应作废）：空窗口不得显示
 * 确定空态，有数据时给出轻量提示。由 initialLoad/retryList 消费 load()
 * 的三态返回值维护；failed 走既有错误态，不进这里。
 */
const listInconclusive = ref(false);
/** 存在性隐藏（403/404）的删除：条目保留并标注"当前不可用"。 */
const unavailableDeleteIds = ref<string[]>([]);

const editingId = ref<string | null>(null);
const editDraft = ref("");
const editBusy = ref(false);
const editError = ref("");

const confirmDeleteId = ref<string | null>(null);
const deleteBusy = ref(false);
const deleteError = ref("");

const pendingBusyId = ref<string | null>(null);
const rowErrorId = ref<string | null>(null);
const rowErrorMessage = ref("");

const transport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  onUnauthorized: () => auth.onUnauthorized(),
});

/** 服务端开关值已确认（读取过或写回回显过）且没有处于未知写入中。 */
const autoSaveKnown = computed(
  () => memory.autoSaveValueKnown && memory.autoSaveState !== "unknown",
);

const autoSaveToggleLabel = computed(() => {
  if (!autoSaveKnown.value) return "状态待确认";
  return memory.autoSaveEnabled ? "已开启" : "已关闭";
});

const autoSaveChecked = computed(() =>
  autoSaveKnown.value ? String(memory.autoSaveEnabled) : "mixed",
);

const autoSaveToggleDisabled = computed(
  () =>
    memory.autoSaveState === "saving"
    || memory.autoSaveState === "loading"
    || !autoSaveKnown.value,
);

const verifyingDeleteId = computed(() =>
  unknownAction.value?.kind === "delete" ? unknownAction.value.memoryId : null,
);

const firstListLoading = computed(() =>
  relState.value === "ready" && memory.listStatus === "loading" && memory.items.length === 0,
);

/** 当前窗口没有任何条目（列表状态为 ready）。 */
const listWindowEmpty = computed(() =>
  relState.value === "ready"
  && memory.listStatus === "ready"
  && memory.acceptedItems.length === 0
  && memory.pendingItems.length === 0,
);

const listEmpty = computed(() => listWindowEmpty.value && !listInconclusive.value);

/** 读取结果不确定且窗口为空：显示"暂时无法确认"，不显示确定空态。 */
const listUnconfirmedEmpty = computed(() => listWindowEmpty.value && listInconclusive.value);

/** 读取结果不确定但已有内容：保留旧数据并给轻量不确定提示。 */
const listInconclusiveNotice = computed(() =>
  listInconclusive.value
  && memory.listStatus === "ready"
  && !listWindowEmpty.value,
);

function setUnknownAction(action: UnknownWriteAction): void {
  unknownAction.value = action;
  rejectedNotice.value = "";
}

function setRejectedNotice(message: string): void {
  unknownAction.value = null;
  rejectedNotice.value = message;
}

/**
 * 判等两个未知写结果是否仍是同一 action（含期望值字段）。unknownAction
 * 的每次写入都是整对象替换、从不原地变更，按值判等即可识别"还是不是
 * 当初捕获的那次待核对结果"。
 */
function isSameUnknownAction(
  a: UnknownWriteAction,
  b: UnknownWriteAction,
): boolean {
  if (a.kind !== b.kind || a.memoryId !== b.memoryId) return false;
  if (a.kind === "edit" && b.kind === "edit") {
    return a.expectedSummary === b.expectedSummary;
  }
  if (a.kind === "candidate" && b.kind === "candidate") {
    return a.expectedStatus === b.expectedStatus;
  }
  return true;
}

async function initialLoad(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  unknownAction.value = null;
  rejectedNotice.value = "";
  relState.value = "loading";
  try {
    if (!auth.isAuthenticated) {
      await auth.tryRefresh(transport);
    }
    if (!auth.isAuthenticated) {
      relState.value = "error";
      return;
    }
    await relStore.load(transport);
    if (relStore.status === "error") {
      relState.value = "error";
      return;
    }
    const relId = relStore.currentRelationshipId;
    if (!relId) {
      relState.value = "missing";
      return;
    }
    relationshipId.value = relId;
    relState.value = "ready";
    const [listOutcome] = await Promise.all([
      memory.load(transport, relId),
      memory.loadAutoSave(transport),
    ]);
    listInconclusive.value = listOutcome === "inconclusive";
  } finally {
    busy.value = false;
  }
}

async function retryList(): Promise<void> {
  if (!relationshipId.value) return;
  const outcome = await memory.load(transport, relationshipId.value);
  listInconclusive.value = outcome === "inconclusive";
}

/**
 * 核对未确定的写结果：只有读到权威列表且能对上预期结果时才清除提示；
 * 读取失败、响应作废或存在性隐藏（空列表不可信）时保留未知提示、
 * 旧数据与再次核对入口——空值不能证明删除成功或编辑完成。
 */
async function refreshList(): Promise<void> {
  if (!relationshipId.value) return;
  const pending = unknownAction.value;
  if (!pending) {
    await retryList();
    return;
  }
  const requestEpoch = memory.ownerEpoch;
  const outcome = await memory.load(transport, relationshipId.value);
  if (memory.ownerEpoch !== requestEpoch) return;
  // 挂起的读取期间可能有更新的写入：saveEdit 会改写同一条目未知结果的
  // 期望值，也可能产生另一条目的新未知结果。捕获的 pending 已不代表
  // 当前待核对状态时不得再按它清除或改写——否则会把已生效的写入误报
  // 为"没有生效"，或清掉更新后的未知提示。直接返回，UI 留给更新后的
  // action 状态，等待下一次核对。
  const current = unknownAction.value;
  if (current === null || !isSameUnknownAction(pending, current)) return;
  if (outcome !== "ok") return;
  const target = memory.items.find((item) => item.memoryId === pending.memoryId) ?? null;
  if (pending.kind === "delete") {
    if (target) {
      // 权威列表里条目仍在：删除确定未生效。
      setRejectedNotice("删除没有生效，这条记忆还在列表中，可以再试一次。");
    } else {
      unknownAction.value = null;
      rejectedNotice.value = "";
    }
    return;
  }
  if (!target) return;
  if (pending.kind === "edit") {
    if (target.summary === pending.expectedSummary) {
      unknownAction.value = null;
      rejectedNotice.value = "";
      // 核对确认后才退出编辑；用户已切到另一条时不关它的编辑框。
      if (editingId.value === pending.memoryId) cancelEdit();
    } else {
      setRejectedNotice("上一次的修改没有生效，可以再试一次。");
    }
    return;
  }
  if (target.status === pending.expectedStatus) {
    unknownAction.value = null;
    rejectedNotice.value = "";
  } else {
    rowErrorId.value = pending.memoryId;
    rowErrorMessage.value = "上一次的操作没有生效，可以再试一次。";
    unknownAction.value = null;
    rejectedNotice.value = "";
  }
}

async function retryAutoSave(): Promise<void> {
  await memory.loadAutoSave(transport);
  if (memory.autoSaveState !== "ready") return;
  const target = autoSaveTarget.value;
  autoSaveTarget.value = null;
  if (target !== null && memory.autoSaveEnabled !== target) {
    // 服务端权威值与写入目标不一致：修改确定未生效。
    autoSaveNotice.value = "上一次的修改没有生效。";
  } else {
    autoSaveNotice.value = "";
  }
}

/** 显式发送目标值（不做本地翻转）；未知结果先核对，不重复 toggle。 */
async function onToggleAutoSave(): Promise<void> {
  if (autoSaveToggleDisabled.value) return;
  autoSaveNotice.value = "";
  const target = !memory.autoSaveEnabled;
  const outcome = await memory.setAutoSave(transport, target);
  autoSaveTarget.value = outcome === "unknown" ? target : null;
  if (outcome === "rejected") {
    autoSaveNotice.value = "开关没有更新成功，请重新读取确认当前状态。";
  }
}

function startEdit(item: MemoryItem): void {
  editingId.value = item.memoryId;
  editDraft.value = item.summary;
  editError.value = "";
  confirmDeleteId.value = null;
}

function cancelEdit(): void {
  editingId.value = null;
  editDraft.value = "";
  editError.value = "";
}

/**
 * 编辑失败（确定拒绝）不退出编辑（保留草稿）；结果未知同样保留编辑框与
 * 草稿，交给顶部核对入口，核对确认后才退出。晚到响应不得关闭用户已切换
 * 到另一条的编辑框。
 */
async function saveEdit(item: MemoryItem): Promise<void> {
  if (editBusy.value) return;
  const summary = editDraft.value.trim();
  if (!summary) {
    editError.value = "内容不能为空。";
    return;
  }
  const requestEpoch = memory.ownerEpoch;
  editBusy.value = true;
  editError.value = "";
  try {
    const updated = await updateMemory(transport, item.memoryId, summary);
    // 退出/换号后旧账号的晚到响应不得写入新会话状态。
    if (memory.ownerEpoch !== requestEpoch) return;
    memory.replaceItem(updated);
    // 同一条目在前一未知结果核对完成前再次保存且成功：写入按目标串行，
    // 最新已确认结果即该条目的核对期望，避免用旧期望把已生效的写入
    // 误报为"上一次的修改没有生效"。
    const pendingUnknown = unknownAction.value;
    if (pendingUnknown?.kind === "edit" && pendingUnknown.memoryId === item.memoryId) {
      unknownAction.value = { ...pendingUnknown, expectedSummary: updated.summary };
    }
    // 该编辑的晚到响应不得关闭已切换到另一条的编辑框。
    if (editingId.value === item.memoryId) cancelEdit();
  } catch (caught) {
    if (memory.ownerEpoch !== requestEpoch) return;
    if (classifyMemoryWriteError(caught) === "unknown") {
      // 结果未知（5xx/协议/超时/网络中断）：不宣布失败，草稿保留等待核对。
      setUnknownAction({ kind: "edit", memoryId: item.memoryId, expectedSummary: summary });
    } else {
      editError.value = "没有保存成功，请再试一次。";
    }
  } finally {
    editBusy.value = false;
  }
}

function askDelete(memoryId: string): void {
  confirmDeleteId.value = memoryId;
  deleteError.value = "";
}

function closeDelete(): void {
  confirmDeleteId.value = null;
  deleteError.value = "";
}

/**
 * 删除确定拒绝（4xx）保留原条目并可重试；结果未知或存在性隐藏都不移除
 * 条目：未知时标注"核对中"，403/404 只表示当前不可用，都不是删除完成的
 * 证明，也不写"这条记忆还在"的确定断言。
 */
async function doDelete(item: MemoryItem): Promise<void> {
  if (deleteBusy.value) return;
  const requestEpoch = memory.ownerEpoch;
  deleteBusy.value = true;
  deleteError.value = "";
  try {
    const result = await deleteMemory(transport, item.memoryId);
    if (memory.ownerEpoch !== requestEpoch) return;
    if (result.kind === "deleted") {
      memory.removeItem(item.memoryId);
      closeDelete();
    } else {
      closeDelete();
      if (!unavailableDeleteIds.value.includes(item.memoryId)) {
        unavailableDeleteIds.value = [...unavailableDeleteIds.value, item.memoryId];
      }
    }
  } catch (caught) {
    if (memory.ownerEpoch !== requestEpoch) return;
    if (classifyMemoryWriteError(caught) === "unknown") {
      closeDelete();
      setUnknownAction({ kind: "delete", memoryId: item.memoryId });
    } else {
      deleteError.value = "没有删除成功，请再试一次。";
    }
  } finally {
    deleteBusy.value = false;
  }
}

async function confirmCandidate(item: MemoryItem): Promise<void> {
  await actOnCandidate(item, confirmMemory, "ACCEPTED", "没有确认成功，请再试一次。");
}

async function rejectCandidate(item: MemoryItem): Promise<void> {
  await actOnCandidate(item, rejectMemory, "REJECTED", "没有拒绝成功，请再试一次。");
}

async function actOnCandidate(
  item: MemoryItem,
  action: (transport: MemoryTransport, memoryId: string) => Promise<MemoryItem>,
  expectedStatus: MemoryStatus,
  failureCopy: string,
): Promise<void> {
  if (pendingBusyId.value) return;
  const requestEpoch = memory.ownerEpoch;
  pendingBusyId.value = item.memoryId;
  rowErrorId.value = null;
  try {
    const updated = await action(transport, item.memoryId);
    if (memory.ownerEpoch !== requestEpoch) return;
    memory.replaceItem(updated);
  } catch (caught) {
    if (memory.ownerEpoch !== requestEpoch) return;
    if (classifyMemoryWriteError(caught) === "unknown") {
      setUnknownAction({ kind: "candidate", memoryId: item.memoryId, expectedStatus });
    } else {
      rowErrorId.value = item.memoryId;
      rowErrorMessage.value = failureCopy;
    }
  } finally {
    pendingBusyId.value = null;
  }
}

onMounted(() => {
  void initialLoad();
});
</script>

<style scoped>
.memory-page {
  display: grid;
  gap: var(--vc-space-5);
  width: 100%;
  max-width: 680px;
  min-width: 0;
  padding-bottom: var(--vc-space-4);
}

.memory-state {
  display: grid;
  gap: var(--vc-space-2);
  min-width: 0;
}

.memory-state--center {
  justify-items: center;
  align-content: center;
  gap: var(--vc-space-3);
  min-height: 280px;
  padding: var(--vc-space-7) var(--vc-space-4);
  text-align: center;
}

.memory-state__title {
  color: var(--vc-color-ink);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
}

.memory-state__copy {
  max-width: 26em;
  color: var(--vc-color-ink-muted);
  font-size: 14px;
  line-height: 22px;
}

.memory-state__mark {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 52px;
  height: 52px;
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-primary);
}

.memory-skeleton {
  width: 100%;
  height: 72px;
  margin: var(--vc-space-2) 0;
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface-soft);
}

.memory-skeleton--short {
  width: 42%;
  height: 18px;
}

.autosave-card {
  display: grid;
  gap: var(--vc-space-2);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface);
}

.autosave-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-3);
}

.autosave-card__title {
  color: var(--vc-color-ink);
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}

.autosave-toggle {
  min-width: 72px;
  min-height: 40px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface);
  color: var(--vc-color-ink-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
}

.autosave-toggle[aria-checked="true"] {
  border-color: var(--vc-color-primary);
  color: var(--vc-color-primary);
}

.autosave-toggle[disabled] {
  opacity: 0.55;
}

.autosave-toggle::after {
  border: 0;
}

.autosave-card__note {
  color: var(--vc-color-ink-muted);
  font-size: 13px;
  line-height: 20px;
}

.autosave-card__note--error {
  color: var(--vc-color-error);
}

.memory-list-error {
  display: grid;
  gap: var(--vc-space-1);
  padding: var(--vc-space-3);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-error);
  font-size: 13px;
  line-height: 20px;
}

.memory-list-inconclusive {
  display: grid;
  gap: var(--vc-space-1);
  padding: var(--vc-space-3);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-ink-muted);
  font-size: 13px;
  line-height: 20px;
}

.memory-section {
  display: grid;
  gap: var(--vc-space-2);
}

.memory-section__title {
  margin-left: var(--vc-space-1);
  color: var(--vc-color-ink-muted);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.memory-section__none {
  color: var(--vc-color-ink-muted);
  font-size: 14px;
  line-height: 22px;
}

.memory-list {
  display: grid;
  gap: var(--vc-space-3);
}

.memory-row {
  display: grid;
  gap: var(--vc-space-2);
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface);
}

.memory-row--pending {
  background: var(--vc-color-surface-soft);
}

.memory-row__body {
  display: grid;
  gap: var(--vc-space-1);
  min-width: 0;
}

.memory-row__summary {
  color: var(--vc-color-ink);
  font-size: 15px;
  line-height: 22px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.memory-row__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  color: var(--vc-color-ink-muted);
  font-size: 12px;
  line-height: 18px;
}

.memory-badge {
  padding: 2px var(--vc-space-2);
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-ink-muted);
}

.memory-badge--auto {
  color: var(--vc-color-primary);
}

.memory-row__error {
  color: var(--vc-color-error);
  font-size: 13px;
  line-height: 20px;
}

.memory-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
}

.memory-action {
  min-height: 40px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface);
  color: var(--vc-color-ink);
  font: inherit;
  font-size: 13px;
}

.memory-action--primary {
  border-color: var(--vc-color-primary);
  color: var(--vc-color-primary);
}

.memory-action--danger {
  border-color: var(--vc-color-hairline);
  color: var(--vc-color-error);
}

.memory-action[disabled] {
  opacity: 0.55;
}

.memory-edit {
  display: grid;
  gap: var(--vc-space-2);
}

.memory-edit__input {
  box-sizing: border-box;
  width: 100%;
  min-height: 88px;
  padding: var(--vc-space-2) var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface);
  color: var(--vc-color-ink);
  font-size: 15px;
  line-height: 22px;
}

.memory-confirm {
  display: grid;
  gap: var(--vc-space-2);
  padding: var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface-soft);
}

.memory-confirm__title {
  color: var(--vc-color-error);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

.memory-confirm__copy {
  color: var(--vc-color-ink-muted);
  font-size: 13px;
  line-height: 20px;
}

.memory-unknown {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-2);
  padding: var(--vc-space-3);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-error);
  font-size: 13px;
  line-height: 20px;
}

.text-action {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-2);
  border: 0;
  background: transparent;
  color: var(--vc-color-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
}

.secondary-action {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface);
  color: var(--vc-color-ink);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
}

.memory-action::after,
.text-action::after,
.autosave-toggle::after,
.secondary-action::after {
  border: 0;
}

button:focus-visible {
  outline: 2px solid var(--vc-color-primary);
  outline-offset: 3px;
}
</style>
