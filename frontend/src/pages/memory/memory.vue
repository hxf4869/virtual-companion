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
              :aria-checked="memory.autoSaveEnabled"
              data-testid="autosave-toggle"
              :disabled="memory.autoSaveState === 'saving' || memory.autoSaveState === 'loading'"
              @click="onToggleAutoSave"
            >
              {{ memory.autoSaveEnabled ? "已开启" : "已关闭" }}
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
              开关状态没有加载出来。
            </text>
            <button
              type="button"
              class="text-action"
              data-testid="autosave-retry"
              @click="retryAutoSave"
            >
              重试
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
          v-if="listEmpty"
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
                  <text class="memory-confirm__copy">删除后，陪伴不再把这条内容用于聊天。</text>
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
      </template>
    </view>
  </ConsumerShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import {
  confirmMemory,
  deleteMemory,
  rejectMemory,
  updateMemory,
  MemoryProtocolError,
  type MemoryItem,
  type MemoryTransport,
} from "@/api/memory";
import {
  TransportTimeoutError,
  createAuthenticatedTransport,
} from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import AppIcon from "@/design-system/AppIcon.vue";
import { formatLocalDateTime } from "@/domain/timestamp";
import { useAuthStore } from "@/stores/auth";
import { useMemoryStore } from "@/stores/memory";
import { useRelationshipStore } from "@/stores/relationship";

type RelState = "loading" | "ready" | "error" | "missing";

const auth = useAuthStore();
const relStore = useRelationshipStore();
const memory = useMemoryStore();

const relState = ref<RelState>("loading");
const relationshipId = ref("");
const busy = ref(false);
const unknownAction = ref(false);

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

const firstListLoading = computed(() =>
  relState.value === "ready" && memory.listStatus === "loading" && memory.items.length === 0,
);

const listEmpty = computed(() =>
  relState.value === "ready"
  && memory.listStatus === "ready"
  && memory.acceptedItems.length === 0
  && memory.pendingItems.length === 0,
);

function isUnknownOutcome(caught: unknown): boolean {
  return caught instanceof MemoryProtocolError || caught instanceof TransportTimeoutError;
}

async function initialLoad(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  unknownAction.value = false;
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
    await Promise.all([
      memory.load(transport, relId),
      memory.loadAutoSave(transport),
    ]);
  } finally {
    busy.value = false;
  }
}

async function retryList(): Promise<void> {
  if (!relationshipId.value) return;
  await memory.load(transport, relationshipId.value);
}

async function refreshList(): Promise<void> {
  await retryList();
  unknownAction.value = false;
}

async function retryAutoSave(): Promise<void> {
  await memory.loadAutoSave(transport);
}

async function onToggleAutoSave(): Promise<void> {
  if (memory.autoSaveState === "saving" || memory.autoSaveState === "loading") return;
  await memory.setAutoSave(transport, !memory.autoSaveEnabled);
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

/** 编辑失败不退出编辑（保留草稿）；结果未知时交给顶部核对入口。 */
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
    cancelEdit();
  } catch (caught) {
    if (memory.ownerEpoch !== requestEpoch) return;
    if (isUnknownOutcome(caught)) {
      cancelEdit();
      unknownAction.value = true;
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

/** 删除失败保留原条目并可重试；结果未知时交给顶部核对入口。 */
async function doDelete(item: MemoryItem): Promise<void> {
  if (deleteBusy.value) return;
  const requestEpoch = memory.ownerEpoch;
  deleteBusy.value = true;
  deleteError.value = "";
  try {
    // 存在性隐藏（403/404）与确认删除都按已删除处理。
    await deleteMemory(transport, item.memoryId);
    if (memory.ownerEpoch !== requestEpoch) return;
    memory.removeItem(item.memoryId);
    closeDelete();
  } catch (caught) {
    if (memory.ownerEpoch !== requestEpoch) return;
    if (isUnknownOutcome(caught)) {
      closeDelete();
      unknownAction.value = true;
    } else {
      deleteError.value = "没有删除成功，这条记忆还在，请再试一次。";
    }
  } finally {
    deleteBusy.value = false;
  }
}

async function confirmCandidate(item: MemoryItem): Promise<void> {
  await actOnCandidate(item, confirmMemory, "没有确认成功，请再试一次。");
}

async function rejectCandidate(item: MemoryItem): Promise<void> {
  await actOnCandidate(item, rejectMemory, "没有拒绝成功，请再试一次。");
}

async function actOnCandidate(
  item: MemoryItem,
  action: (transport: MemoryTransport, memoryId: string) => Promise<MemoryItem>,
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
    if (isUnknownOutcome(caught)) {
      unknownAction.value = true;
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
