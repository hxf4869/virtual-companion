<template>
  <!-- 记忆管理：自动记忆总开关 + 已保存记忆（ACCEPTED）主视图 +
       待确认候选（PENDING_CONFIRMATION）次级分区。列表接口无分页参数，
       一次加载该关系下全部未删除记忆；已拒绝条目不展示。 -->
  <ConsumerShell route="/pages/memory/memory">
    <view ref="pageRoot" class="memory-page">
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
            <!-- WAI-ARIA 1.2 的 switch 只支持 true/false（mixed 非法，会被
                 user agent 当作 false 宣告）：未知时显式绑定 button 角色
                 （uni-app 会编译控件，不依赖原生默认）并省略 aria-checked；
                 已知时才绑定 switch 与真实 boolean 状态，并给稳定可访问
                 名称"自动记忆"。 -->
            <button
              type="button"
              class="autosave-toggle"
              :role="autoSaveKnown ? 'switch' : 'button'"
              :aria-checked="autoSaveChecked"
              :aria-label="autoSaveKnown ? '自动记忆' : '自动记忆，状态待确认'"
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

        <!-- R208：已有内容时的列表级反馈区。等待/失败/不确定/成功共用同一
             节点与同一按钮，键盘焦点才能留在原位；等待期间不用原生 disabled
             （会把焦点掉到 body），用 aria-disabled/aria-busy 表意，重复 GET
             由 retryList 的 listStatus loading 门挡住。 -->
        <view
          v-if="listNotice"
          class="memory-list-notice"
          :class="{ 'memory-list-notice--failed': listNotice === 'failed' }"
          role="status"
          data-testid="memory-list-notice"
          :data-state="listNotice"
        >
          <text>{{ listNoticeCopy }}</text>
          <button
            type="button"
            class="text-action"
            data-testid="memory-list-retry"
            :aria-disabled="listNotice === 'pending'"
            :aria-busy="listNotice === 'pending'"
            @click="retryList"
          >
            {{ listRetryLabel }}
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
                  <!-- 编辑保存 404：重试不会成功；只在用户明确选择后放弃草稿并刷新。 -->
                  <button
                    v-if="editNotFound"
                    type="button"
                    class="text-action"
                    data-testid="memory-edit-discard-refresh"
                    :aria-disabled="memory.listStatus === 'loading'"
                    :aria-busy="memory.listStatus === 'loading'"
                    @click="discardEditAndRefresh"
                  >
                    放弃修改并刷新列表
                  </button>
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
                  <!-- 编辑保存 404：重试不会成功；只在用户明确选择后放弃草稿并刷新。 -->
                  <button
                    v-if="editNotFound"
                    type="button"
                    class="text-action"
                    data-testid="pending-edit-discard-refresh"
                    :aria-disabled="memory.listStatus === 'loading'"
                    :aria-busy="memory.listStatus === 'loading'"
                    @click="discardEditAndRefresh"
                  >
                    放弃修改并刷新列表
                  </button>
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

                <view
                  v-else-if="rowErrorId === item.memoryId"
                  class="memory-row__error"
                  data-testid="pending-error"
                  role="alert"
                >
                  <text>{{ rowErrorMessage }}</text>
                  <!-- 候选动作 404：该行已不在待确认态，重试无效；就地给列表刷新
                       入口，复用 retryList（loading 门防重复、R208 反馈区显示等待/
                       失败），按权威重读后的状态分区或离开本区。 -->
                  <button
                    v-if="rowRefreshId === item.memoryId"
                    type="button"
                    class="text-action"
                    data-testid="pending-refresh"
                    :aria-disabled="memory.listStatus === 'loading'"
                    :aria-busy="memory.listStatus === 'loading'"
                    @click="retryList"
                  >
                    刷新列表
                  </button>
                </view>

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
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch, type ComponentPublicInstance } from "vue";

import {
  classifyMemoryWriteError,
  confirmMemory,
  deleteMemory,
  MemoryHttpError,
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
/** R214：KeepAlive 激活（可见）中；隐藏缓存页不得发起身份重读。 */
const pageActive = ref(false);
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
/** 本次编辑保存收到确定 404：条目已不可按当前状态编辑，重试同一保存不会成功。 */
const editNotFound = ref(false);

const confirmDeleteId = ref<string | null>(null);
const deleteBusy = ref(false);
const deleteError = ref("");

const pendingBusyId = ref<string | null>(null);
const rowErrorId = ref<string | null>(null);
const rowErrorMessage = ref("");
/**
 * 候选确认/拒绝收到 404 的那一行：服务端只对已不在待确认态的候选（另一
 * 会话已处理/删除或对本账号不可见）返回它，重试永不成功，行内改给列表
 * 刷新入口；权威重读成功后清掉，行按新状态分区或离开待确认区。
 */
const rowRefreshId = ref<string | null>(null);

const transport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  getAccountId: () => auth.accountId,
      getSessionId: () => auth.getSessionId(),
  getSessionRevision: () => auth.getSessionRevision(),
  onUnauthorized: () => auth.onUnauthorized(),
  // VC-R52 期望账号失配恢复：先作废旧本地归属再读当前 Cookie 身份，
  // 不自动重放动作（共享入口见 stores/auth.ts reconcileAccountContext）。
  onAccountContextChanged: () => {
    void auth.reconcileAccountContext(transport);
  },
});

/** 服务端开关值已确认（读取过或写回回显过）且没有处于未知写入中。 */
const autoSaveKnown = computed(
  () => memory.autoSaveValueKnown && memory.autoSaveState !== "unknown",
);

const autoSaveToggleLabel = computed(() => {
  if (!autoSaveKnown.value) return "状态待确认";
  return memory.autoSaveEnabled ? "已开启" : "已关闭";
});

/** switch 不支持 mixed（WAI-ARIA 1.2）：未知时返回 undefined 省略属性。 */
const autoSaveChecked = computed(() =>
  autoSaveKnown.value ? String(memory.autoSaveEnabled) : undefined,
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

// R208：已有内容时列表级反馈区的阶段文案。failed/inconclusive 仍由 store 的
// listStatus 与 listInconclusive 推导；只有用户在反馈区主动点按钮才经历
// pending → success，正常重新初始化与刷新核对发起的新读取收回手动反馈。
const LIST_NOTICE_COPY = {
  pending: "正在重新加载，下方暂时是之前的列表。",
  failed: "最新内容没有加载出来，下方可能不是当前列表。",
  inconclusive: "最新内容没有读出来，下方可能不是当前列表。",
  success: "已更新，下方是当前列表。",
} as const;
type ListNotice = keyof typeof LIST_NOTICE_COPY;

/** 用户在列表反馈区主动重载的阶段；null 时交给 failed/inconclusive 或无反馈。 */
const manualListRefresh = ref<"pending" | "success" | null>(null);

const listNotice = computed<ListNotice | null>(() => {
  if (manualListRefresh.value === "pending") return "pending";
  if (memory.listStatus === "error") return "failed";
  if (listInconclusiveNotice.value) return "inconclusive";
  if (manualListRefresh.value === "success") return "success";
  return null;
});

const listNoticeCopy = computed(() => (
  listNotice.value ? LIST_NOTICE_COPY[listNotice.value] : ""
));

const listRetryLabel = computed(() => {
  if (listNotice.value === "success") return "再次刷新";
  if (listNotice.value === "inconclusive") return "重新读取";
  return "重新加载";
});

// 手动重载等待中发生退出/401/换号的真实清理（memory.reset 递增 ownerEpoch）：
// 旧响应会按 epoch 比较丢弃、不再回来收尾，pending 若不在此清掉就会停成永久
// 等待。同步 flush 让清理落在 owner 改变的当下，先于新 owner 之后可能发起的
// 任何新 pending；旧响应本身不写任何状态，也就不会误清新 pending。
watch(() => memory.ownerEpoch, () => {
  manualListRefresh.value = null;
}, { flush: "sync" });

// R214：换号身份交接（可见页 409 ACCOUNT_CONTEXT_CHANGED → auth.reconcile
// 的同步 clear→读回，或退出/其他 Tab 登录的共享清理）。companion 页 VC-R13
// 同款判据：只在「已知账号 → 不同账号/退出」时清掉本页旧账号上下文与操作
// 意图（编辑草稿、未知结果、各类反馈与忙态）并作废在途 initialLoad（换号
// 链 auth.ts persist/clear → session-cleanup 的 memory.reset 同步递增
// ownerEpoch，与本清理一一配对，initialLoad 以它作唯一晚到丢弃代次）；
// null→X（首次发现、匿名后登录）不清理、不当过期；accountId 不变的同账号
// 重认证不触发，未保存草稿保留。清理不发起新读取：身份未定期间停在
// loading 骨架，不把 store 重置后的 idle 当真空空态，也不自动写；重读交给
// 下方的身份分支与 onActivated——隐藏缓存页不抢跑。manualListRefresh 由
// 上面 ownerEpoch 的 sync watch 随真实清理链收回。
let loadedForAccountId: string | null = null;

watch(() => auth.accountId, (next, prev) => {
  if (prev !== null && next !== prev) {
    busy.value = false;
    loadedForAccountId = null;
    relationshipId.value = "";
    relState.value = "loading";
    unknownAction.value = null;
    rejectedNotice.value = "";
    autoSaveTarget.value = null;
    autoSaveNotice.value = "";
    listInconclusive.value = false;
    unavailableDeleteIds.value = [];
    editingId.value = null;
    editDraft.value = "";
    editError.value = "";
    editNotFound.value = false;
    editBusy.value = false;
    confirmDeleteId.value = null;
    deleteBusy.value = false;
    deleteError.value = "";
    pendingBusyId.value = null;
    rowErrorId.value = null;
    rowErrorMessage.value = "";
    rowRefreshId.value = null;
  }
  // 可见页发现新的确定身份且当前内容不归属它：自动且仅一次重读关系与该
  // 账号的记忆/开关（busy 去重 mount 期间首次发现的在途加载；归属对齐后
  // 不再重复）。隐藏页不在此读，激活后再读。
  if (next !== null && pageActive.value && !busy.value && loadedForAccountId !== next) {
    void initialLoad();
  }
});

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
  // R214：换号清理链（session-cleanup 的 memory.reset）递增 ownerEpoch，
  // 它是本次加载的唯一代次：旧 initialLoad 在后续 await 上一律丢弃，不写
  // relState/relationshipId/listInconclusive，finally 也不释放新加载刚占下
  // 的 busy。同 owner 内重入由上面的 busy 门挡住，无需第二个计数器。
  const requestEpoch = memory.ownerEpoch;
  unknownAction.value = null;
  rejectedNotice.value = "";
  manualListRefresh.value = null;
  relState.value = "loading";
  try {
    if (!auth.isAuthenticated) {
      await auth.tryRefresh(transport);
      if (memory.ownerEpoch !== requestEpoch) return;
    }
    if (!auth.isAuthenticated) {
      relState.value = "error";
      return;
    }
    // R214：本页内容归属的账号；换号清理置回 null，onActivated 与身份
    // watch 据此判定是否重读——同账号返回不重复加载、草稿保留。
    loadedForAccountId = auth.accountId;
    await relStore.load(transport);
    if (memory.ownerEpoch !== requestEpoch) return;
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
    if (memory.ownerEpoch !== requestEpoch) return;
    listInconclusive.value = listOutcome === "inconclusive";
  } finally {
    if (memory.ownerEpoch === requestEpoch) busy.value = false;
  }
}

/**
 * 列表级重新加载/重新读取（反馈区按钮、空窗口不确定态与候选 404 的行内
 * 刷新入口共用）。重复触发由 store 的 listStatus loading 门挡住（aria-disabled
 * 不拦键盘事件）；等待与结果都写回同一反馈区，不卸载按钮。退出/换号后的
 * 晚到结果按 ownerEpoch 丢弃。成功反馈只在刷新后窗口有内容时给出：真实
 * 空态自身已说明当前列表。
 */
async function retryList(): Promise<void> {
  if (!relationshipId.value) return;
  if (memory.listStatus === "loading") return;
  const requestEpoch = memory.ownerEpoch;
  // 候选 404 行内入口的归属：本次重读只替发起时的那一行收尾。待确认按钮
  // 不因列表 loading 禁用，在途期间用户仍可操作另一可见候选，其 404 会把
  // 提示与入口写到新行；404 不推进写版本，store 会把本次旧快照当 ok 写回，
  // 回包时不得把新行刚写入的入口一起清掉。
  const refreshTarget = rowRefreshId.value;
  manualListRefresh.value = "pending";
  const outcome = await memory.load(transport, relationshipId.value);
  if (memory.ownerEpoch !== requestEpoch) return;
  listInconclusive.value = outcome === "inconclusive";
  manualListRefresh.value = outcome === "ok" && !listWindowEmpty.value ? "success" : null;
  // 发起行的入口由本次权威重读接管：该行已按新列表分区或离开待确认区，
  // 残留提示不再成立；失败/不确定时保留入口，可再刷新。
  if (outcome === "ok" && refreshTarget !== null && rowRefreshId.value === refreshTarget) {
    rowRefreshId.value = null;
    if (rowErrorId.value === refreshTarget) {
      rowErrorId.value = null;
      rowErrorMessage.value = "";
    }
  }
}

/**
 * 核对未确定的写结果：只有读到权威列表且能对上预期结果时才清除提示；
 * 读取失败、响应作废或存在性隐藏（空列表不可信）时保留未知提示、
 * 旧数据与再次核对入口——空值不能证明删除成功或编辑完成。
 */
async function refreshList(): Promise<void> {
  if (!relationshipId.value) return;
  // 与 retryList 共用同一列表读取：在途时不重复发 GET。
  if (memory.listStatus === "loading") return;
  const pending = unknownAction.value;
  if (!pending) {
    await retryList();
    return;
  }
  // 新读取接管列表反馈：上一次手动重载的"已更新"不得延续到这次结果上
  //（这次可能失败或是存在性隐藏）。
  manualListRefresh.value = null;
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
      // 核对确认后才退出编辑；用户已切到另一条时不关它的编辑框，等待核对
      // 期间在同一编辑框继续输入的后续草稿（trim 后不等于本次提交快照）
      // 也不丢弃，留给用户再次保存。
      if (editingId.value === pending.memoryId && editDraft.value.trim() === pending.expectedSummary) {
        cancelEdit();
      }
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
  const requestEpoch = memory.ownerEpoch;
  await memory.loadAutoSave(transport);
  // 换号清理后旧账号的核对意图不回填新账号的开关状态。
  if (memory.ownerEpoch !== requestEpoch) return;
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
  const requestEpoch = memory.ownerEpoch;
  const outcome = await memory.setAutoSave(transport, target);
  // 409 换号 reconcile 已在传输层同步推进 ownerEpoch：旧账号的写入目标与
  // 提示不得在清理后复活（结果由新账号重读确认，不自动重放动作）。
  if (memory.ownerEpoch !== requestEpoch) return;
  autoSaveTarget.value = outcome === "unknown" ? target : null;
  if (outcome === "rejected") {
    autoSaveNotice.value = "开关没有更新成功，请重新读取确认当前状态。";
  }
}

/** 切换编辑目标时丢弃未保存草稿的确认文案（不声称服务端未生效）。 */
const SWITCH_EDIT_CONFIRM_MESSAGE = "当前编辑还有更改，切换后页面上的草稿不会保留。确定切换吗？";

// 真实 H5：<view> 是 uni 内建组件（未 expose），ref 为组件实例、经 $el 取根；
// 组件测试：未注册的 view 落为原生元素，ref 即元素本身（与 VcChatComposer
// 的 nativeTextarea 同惯例）。仅查本页子树，同一时刻至多一个编辑框。
const pageRoot = ref<ComponentPublicInstance | HTMLElement | null>(null);

function editTextarea(): HTMLTextAreaElement | null {
  const host = pageRoot.value;
  if (!host) return null;
  const element = host instanceof HTMLElement ? host : host.$el;
  return element?.querySelector("textarea") ?? null;
}

function startEdit(item: MemoryItem): void {
  // 正在编辑另一条且草稿有实际改动（按保存的 trim 规则比较）时，切换会
  // 静默丢弃草稿：先原生确认，取消则保留当前草稿与编辑状态。保存
  // 在途（editBusy）不拦截，维持既有切换行为（T-58）。
  if (!editBusy.value && editingId.value !== null && editingId.value !== item.memoryId) {
    const editing = memory.items.find((entry) => entry.memoryId === editingId.value);
    if (editing && editDraft.value.trim() !== editing.summary) {
      const confirmed = typeof globalThis.confirm === "function"
        ? globalThis.confirm(SWITCH_EDIT_CONFIRM_MESSAGE)
        : false;
      if (!confirmed) return;
    }
  }
  editingId.value = item.memoryId;
  editDraft.value = item.summary;
  editError.value = "";
  editNotFound.value = false;
  confirmDeleteId.value = null;
  // R204：激活的"编辑"按钮随其操作区一起被编辑框替换，焦点会掉回 body；
  // 打开编辑器即把焦点送进输入框，键盘用户从原地直接开始改写。
  void nextTick(() => editTextarea()?.focus());
}

function cancelEdit(): void {
  editingId.value = null;
  editDraft.value = "";
  editError.value = "";
  editNotFound.value = false;
}

/**
 * 用户明确选择放弃本次编辑并按权威列表刷新（编辑保存 404 的就地入口）：
 * 先守列表读取的 loading 门——在途时不执行，避免先丢草稿才发现
 * retryList 直接返回；然后复用 cancelEdit 清稿、retryList 读取（等待/
 * 失败走 R208 列表反馈区）。清稿发生在刷新之前：行随后按权威列表卸载时
 * 编辑框已不存在，不构成入口刷新暗中丢稿。
 */
function discardEditAndRefresh(): void {
  if (memory.listStatus === "loading") return;
  cancelEdit();
  void retryList();
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
  editNotFound.value = false;
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
    // 该编辑的晚到响应不得关闭已切换到另一条的编辑框；保存发出后用户在
    // 同一编辑框继续输入的草稿（trim 后不等于本次提交内容）也不丢弃，
    // 忙态释放后可再次保存。
    if (editingId.value === item.memoryId && editDraft.value.trim() === summary) {
      cancelEdit();
    }
  } catch (caught) {
    if (memory.ownerEpoch !== requestEpoch) return;
    if (classifyMemoryWriteError(caught) === "unknown") {
      // 结果未知（5xx/协议/超时/网络中断）：不宣布失败，草稿保留等待核对。
      setUnknownAction({ kind: "edit", memoryId: item.memoryId, expectedSummary: summary });
    } else if (caught instanceof MemoryHttpError && caught.status === 404) {
      // 404（NOT_FOUND_OR_FORBIDDEN）：该条目已不可按当前状态编辑（如在
      // 另一会话被删除或候选已被处理），重试同一保存不会成功，也不自动
      // 重读；草稿保留在编辑框里，交给"放弃修改并刷新列表"由用户明确
      // 选择。只特判有实证的 404：403 另有其义（如 CSRF 明确拒绝），
      // 维持确定失败文案。晚到时用户已切到另一条（T-58）：只写回仍归属
      // 本条目的编辑提示，不把 B 的新草稿误标成无法保存；A 的 unknown
      // 核对记录不在此列，仍按既有语义全局保留。
      if (editingId.value === item.memoryId) {
        editError.value = "这条记忆当前无法保存，修改仍留在编辑框里；如需保留可先复制。";
        editNotFound.value = true;
      }
    } else {
      editError.value = "没有保存成功，请再试一次。";
    }
  } finally {
    // 换号清理已释放 editBusy 并允许新账号开自己的保存：旧账号的晚到
    // 收尾按既有 ownerEpoch 比较丢弃，不得解锁新账号的在途保存。
    if (memory.ownerEpoch === requestEpoch) {
      editBusy.value = false;
    }
  }
}

/** 离开本页丢弃未保存草稿的确认文案（不声称服务端未生效）。 */
const LEAVE_CONFIRM_MESSAGE = "当前编辑还有更改，离开后页面上的草稿不会保留。确定离开吗？";

interface H5LeaveRouter {
  beforeEach: (
    guard: (to: { path: string }, from: { path: string }) => boolean | Promise<boolean>,
  ) => () => void;
}

let leaveGuardsInstalled = false;
let removeRouteLeaveGuard: (() => void) | null = null;

/**
 * 是否有离开本页会丢失的未保存草稿：正在编辑的条目仍在共享列表且草稿
 * （按保存的 trim 规则）与已保存内容不同。未编辑、未改动、显式取消与
 * 保存成功退出编辑后都为 false；auth 清理会重置 memory.items，旧账号
 * 草稿因此找不到对应条目，不构成拦截条件。
 */
function hasUnsavedEditDraft(): boolean {
  if (editingId.value === null) return false;
  const editing = memory.items.find((item) => item.memoryId === editingId.value);
  return editing !== undefined && editDraft.value.trim() !== editing.summary;
}

// 与 companion 页同型的离开拦截：H5 的页面返回/浏览器后退最终都走
// vue-router 导航，注册一个可移除的 beforeEach 守卫即可全部拦截；确认
// 用浏览器原生 confirm（键盘可达），文案只陈述本页草稿会被丢弃。登录
// 目标永远放行，旧账号草稿不阻认证/换号链路。
async function guardRouteLeave(
  to: { path: string },
  from: { path: string },
): Promise<boolean> {
  if (from.path !== "/pages/memory/memory") return true;
  if (to.path === from.path) return true;
  if (to.path === "/pages/login/login") return true;
  if (!hasUnsavedEditDraft()) return true;
  return typeof globalThis.confirm === "function"
    ? globalThis.confirm(LEAVE_CONFIRM_MESSAGE)
    : false;
}

function guardBrowserLeave(event: BeforeUnloadEvent): void {
  if (!hasUnsavedEditDraft()) return;
  event.preventDefault();
  event.returnValue = "";
}

function installLeaveGuards(): void {
  if (leaveGuardsInstalled) return;
  leaveGuardsInstalled = true;
  // 裸 getApp 引用与 companion 页同惯例：uni-h5 构建注入；组件测试与
  // 非 uni 宿主经 typeof 静默降级（仅失去本页确认弹窗）。
  if (typeof getApp === "function") {
    const router = getApp<{ $router?: H5LeaveRouter }>().$router;
    if (router?.beforeEach) removeRouteLeaveGuard = router.beforeEach(guardRouteLeave);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", guardBrowserLeave);
  }
}

function removeLeaveGuards(): void {
  if (!leaveGuardsInstalled) return;
  leaveGuardsInstalled = false;
  removeRouteLeaveGuard?.();
  removeRouteLeaveGuard = null;
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeunload", guardBrowserLeave);
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
  rowRefreshId.value = null;
  try {
    const updated = await action(transport, item.memoryId);
    if (memory.ownerEpoch !== requestEpoch) return;
    memory.replaceItem(updated);
  } catch (caught) {
    if (memory.ownerEpoch !== requestEpoch) return;
    if (classifyMemoryWriteError(caught) === "unknown") {
      setUnknownAction({ kind: "candidate", memoryId: item.memoryId, expectedStatus });
    } else if (caught instanceof MemoryHttpError && caught.status === 404) {
      // 404（NOT_FOUND_OR_FORBIDDEN）只在候选已不是待确认态时返回：另一会话
      // 已确认/拒绝/删除，或条目对本账号不可见。既不是未知写也不是成功，
      // 更推不出具体结局；"再试一次"永不成功，改为就地刷新按权威列表分区。
      rowErrorId.value = item.memoryId;
      rowErrorMessage.value = "这条候选当前无法按待确认操作，请刷新列表确认。";
      rowRefreshId.value = item.memoryId;
    } else {
      rowErrorId.value = item.memoryId;
      rowErrorMessage.value = failureCopy;
    }
  } finally {
    pendingBusyId.value = null;
  }
}

onMounted(() => {
  pageActive.value = true;
  installLeaveGuards();
  void initialLoad();
});

// uni-h5 用 RouterView+KeepAlive 渲染页面：确认离开后页面转为 deactivated
// 缓存而非 unmount（onUnmounted 不及时触发）；而 uni 的页面 onUnload 在
// initHistory 的 history 监听回调里经 removeCurrentPages 早于路由守卫判定
// 同步触发，不能当清理时点——会在确认弹窗前撤掉守卫、绕过保护。与
// companion 页同型：幂等 install，真正 deactivated / unmounted 才 cleanup。
// 缓存的脏稿实例若被再激活，onActivated 重装守卫、草稿继续受保护，无需
// 在 deactivated 时清草稿。
onActivated(() => {
  pageActive.value = true;
  installLeaveGuards();
  // R214：缓存页重新激活时，仅当已认证且当前内容不归属本账号才重读——
  // 隐藏期间发生的换号只在身份 watch 里清理、不抢跑。同账号返回不重载、
  // 不重复请求，未保存草稿保留；与 onMounted 首次同时触发由 initialLoad
  // 同步置位的 busy 去重。
  if (!auth.isAuthenticated || busy.value) return;
  if (loadedForAccountId === auth.accountId) return;
  void initialLoad();
});

onDeactivated(() => {
  pageActive.value = false;
  removeLeaveGuards();
});

onUnmounted(() => {
  pageActive.value = false;
  removeLeaveGuards();
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

.memory-list-notice {
  display: grid;
  gap: var(--vc-space-1);
  padding: var(--vc-space-3);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-ink-muted);
  font-size: 13px;
  line-height: 20px;
}

.memory-list-notice--failed {
  color: var(--vc-color-error);
}

.memory-list-notice .text-action[aria-disabled="true"] {
  opacity: 0.6;
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
