<template>
  <VcChatShell
    :companion-name="companionName"
    :menu-open="menuOpen"
    @back="onBack"
    @menu="menuOpen = true"
  >
    <view
      v-if="pageState === 'loading'"
      class="chat-page-state chat-page-state--loading"
      data-testid="chat-loading"
      role="status"
    >
      <view class="chat-page-skeleton chat-page-skeleton--assistant" aria-hidden="true" />
      <view class="chat-page-skeleton chat-page-skeleton--user" aria-hidden="true" />
      <text class="vc-sr-only">正在打开聊天</text>
    </view>

    <view
      v-else-if="pageState === 'error' || pageState === 'missing'"
      class="chat-page-state chat-page-state--message"
      data-testid="chat-init-error"
      role="alert"
    >
      <text class="chat-page-state__title">
        {{ pageState === "missing" ? "聊天还没准备好" : "聊天没有打开" }}
      </text>
      <text class="chat-page-state__copy">
        {{ pageState === "missing" ? "重新加载后，我们会继续为你准备。" : "检查网络后再试一次。" }}
      </text>
      <button
        class="chat-page-secondary"
        data-testid="chat-retry-init"
        @click="initPage({ resumeConversationId: manualReopenTarget() })"
      >
        重新加载
      </button>
    </view>

    <view
      v-else-if="pageState === 'waiting'"
      class="chat-page-state chat-page-state--message"
      data-testid="chat-waiting"
      role="status"
    >
      <text class="chat-page-state__title">
        {{ store.isStreaming ? "上一段回复还在生成" : "可以打开所选对话了" }}
      </text>
      <text class="chat-page-state__copy">
        {{
          store.isStreaming
            ? "等这段回复结束，就可以继续打开对话。"
            : "现在可以打开所选对话，也可以先返回。"
        }}
      </text>
      <view class="chat-page-state__actions">
        <button
          class="chat-page-primary"
          data-testid="chat-waiting-open"
          :disabled="store.isStreaming"
          @click="initPage({ resumeConversationId: manualReopenTarget() })"
        >
          打开所选会话
        </button>
        <button class="chat-page-secondary" data-testid="chat-waiting-back" @click="onBack">
          返回
        </button>
      </view>
    </view>

    <view
      v-else-if="pageState === 'account-updated'"
      class="chat-page-state chat-page-state--message"
      data-testid="chat-account-updated"
      role="status"
    >
      <text class="chat-page-state__title">登录状态已更新</text>
      <text class="chat-page-state__copy">
        当前登录的账号或会话已变化。请返回首页或打开全部会话，重新选择对话后继续。
      </text>
      <view class="chat-page-state__actions">
        <button
          class="chat-page-primary"
          data-testid="chat-account-updated-home"
          @click="onAccountUpdatedHome"
        >
          返回首页
        </button>
        <button
          class="chat-page-secondary"
          data-testid="chat-account-updated-conversations"
          @click="openAllConversations"
        >
          全部会话
        </button>
      </view>
    </view>

    <view v-else class="chat-history-frame">
      <VcMessageList
        ref="historyEl"
        :messages="displayMessages"
        :companion-name="companionName"
        :empty="showEmptyHistory"
        :has-more="showLoadMore"
        :busy="generationBusy"
        :older-load-error="olderLoadError"
        :older-loading="store.historyLoadingMore"
        :status-text="statusText"
        :status-tone="statusTone"
        :status-action="statusAction"
        @load-more="onLoadMore"
        @status-action="onStatusAction"
        @user-intent="onHistoryUserScrollIntent"
      />

      <button
        v-if="!followingLatest"
        class="chat-back-to-latest"
        data-testid="back-to-latest"
        aria-label="回到最新消息"
        @click="onBackToLatest"
      >
        回到最新
      </button>
    </view>

    <template #composer>
      <VcChatComposer
        v-if="pageState === 'ready'"
        :model-value="inputText"
        @update:model-value="onDraftInput"
        :busy="composerBusy"
        :streaming="store.isStreaming"
        :disabled="!relStore.currentRelationshipId"
        :error-text="sendErrorText"
        :can-retry="canRetry"
        :retry-label="sendUnconfirmed ? '重试原消息' : undefined"
        @send="onSend"
        @cancel="onCancel"
        @retry="onRetry"
      />
    </template>

    <template #overlay>
      <AppSheet :open="menuOpen" title="聊天选项" @close="menuOpen = false">
        <view class="chat-options">
          <button
            type="button"
            class="chat-option"
            data-testid="chat-open-all-conversations"
            @click="openAllConversations"
          >
            <view class="chat-option__icon" aria-hidden="true">
              <AppIcon name="chats" :size="20" />
            </view>
            <view class="chat-option__copy">
              <text>全部会话</text>
              <text>找到并继续过去的对话</text>
            </view>
            <AppIcon name="chevron-right" :size="18" />
          </button>

          <button
            type="button"
            class="chat-option"
            data-testid="new-conversation"
            :disabled="store.isStreaming || composerBusy || pageState === 'account-updated'"
            @click="startNewConversation"
          >
            <view class="chat-option__icon" aria-hidden="true">
              <AppIcon name="plus" :size="20" />
            </view>
            <view class="chat-option__copy">
              <text>开始新对话</text>
              <text>保留过去的对话，打开新的空白页</text>
            </view>
            <AppIcon name="chevron-right" :size="18" />
          </button>
        </view>
      </AppSheet>
    </template>
  </VcChatShell>
</template>

<script lang="ts">
// VC-R02：chat 页实例的单调令牌。uni-app H5 页面栈可同时存活多个 chat 页
// 实例并共享同一 chat store；实例在真正发起/附着流（发送、重连、恢复）时
// 把令牌传入 store，离开页面时只有归属实例才能 detach 活跃流。
let chatPageInstanceSeq = 0;
</script>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";

import { createAuthedFetch } from "@/api/authed-fetch";
import { createBrowserRealtimeDeps } from "@/api/realtime-transport";
import type { RealtimeDeps } from "@/api/realtime";
import { listRelationships } from "@/api/relationship";
import { createAuthenticatedTransport } from "@/api/transport";
import { goBack, goTo, switchTabTo } from "@/app/navigate";
import VcChatComposer from "@/components/chat/VcChatComposer.vue";
import VcChatShell from "@/components/chat/VcChatShell.vue";
import VcMessageList from "@/components/chat/VcMessageList.vue";
import AppIcon from "@/design-system/AppIcon.vue";
import AppSheet from "@/design-system/AppSheet.vue";
import { companionHeaderName } from "@/domain/companion-presentation";
import { buildContextHref, readContextFromLocation } from "@/domain/context-href";
import { installStreamLifecycle } from "@/domain/stream-recovery";
import { useAuthStore } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { useRelationshipStore } from "@/stores/relationship";

type PageState = "loading" | "ready" | "waiting" | "error" | "missing" | "account-updated";
type StatusTone = "progress" | "muted" | "error";

const RESUME_GAP_PX = 48;

// VC-R02：本实例的流归属令牌（模块级单调递增，页面实例间唯一）。
const instanceToken = ++chatPageInstanceSeq;

const store = useChatStore();
const relStore = useRelationshipStore();
const auth = useAuthStore();
const pageState = ref<PageState>("loading");
const inputText = ref("");
const menuOpen = ref(false);
// VC-R172：建会话准备段的响应式 busy（ensureConversation 挂起期间为真）。
// VC-R185：它就是提交互斥的准备段分量（与 store 的 generationStarting 衔
// 接覆盖"prepare+POST 启动"），准备反馈由本状态承担；不包 store.send 的
// SSE 与终态补读。
const preparingConversation = ref(false);
// VC-R115：结果未确认的原提交快照。失败时记录原始提交内容，重试永远
// 针对它——输入框里后来写下/编辑的下一条草稿不是重试目标，清空输入框
// 也不移除重试入口。清空点与旧 directSendError 生命周期一致：新提交
// 开始、initPage、开始新对话。
const unconfirmedSendText = ref("");
// VC-R121：输入框当前内容是否仍是失败后自动回填的原提交。正文相等不能
// 推断草稿归属（用户可能重新输入与原提交完全相同的下一条草稿），因此回填
// 时记录归属；用户随后的任何编辑、新一轮提交、initPage 或开始新对话都
// 解除归属。重试清空输入框只依据归属，不经正文比较。
let inputRefilledFromFailure = false;
const initBusy = ref(false);
// VC-R221：同一次在途 initPage 被精确身份事件（409 换号/同账号新 session）
// 作废后，其后续终态不得覆盖登录状态更新说明——用户看到的应是身份说明
// 与安全入口，而不是同次初始化落下的虚假网络错误。用户后续主动发起的
// 合法重新初始化在 initPage 入口重置本标记，照常落 error/ready。
let initInvalidatedByAccountContext = false;

/** VC-R221：initPage 终态的唯一写入口——被身份事件作废的初始化到此为止。 */
function settleInitPageState(state: PageState): void {
  if (initInvalidatedByAccountContext) return;
  pageState.value = state;
}
// VC-R04：本实例实际落地的目标会话（initPage/建会话/开始新对话时同步）。
// 恢复核对按会话归属介入：等待页（目标 ≠ 当前流所属会话）不核对、不接管，
// 与 online/visibility 监听的注册顺序无关。
let owningConversationId = "";
// VC-R04：本实例最近一次 initPage 读到的 URL 目标会话（含未落地的等待
// 目标）。hashchange 去重以此为基准——busy 等待期间 owningConversationId
// 保持旧值，浏览器返回原会话时必须能据此重开，否则页面会卡在等待态。
// null ＝ 尚未跑过 initPage。
let lastInitTargetConversationId: string | null = null;
// VC-R04：uni H5 的 RouterView 用 KeepAlive 缓存离场页面——getCurrentPages
// 栈中的隐藏实例仍存活，window 监听不随卸载移除（实测一次返回可触发两个
// 实例同时 initPage）。hashchange 只由当前活动实例响应：被停用的隐藏页
// 不响应别的页面的 hash 变化；恢复核对（online/visibility）不受此限，
// 合法所属页在后台恢复仍是设计行为。
let instanceActive = true;
// VC-R158：initPage 读过 URL 目标之后的 await（loadConversations/
// openConversation/恢复）期间收到 hashchange 时，initBusy 守卫会丢弃事件
// ——URL 已指向 conv-b，页面停在 conv-a。只为这类"确实收到但初始化忙"
// 的事件保留一个待重评标记，init 收尾清 busy 后复用 onLocationHashChange
// 按最新 location 重评一次：同目标/离开 chat/停用等守卫在 handler 内自行
// 去重，不排队旧目标——连续 A→B→A 只服从最终 URL。
let pendingHashRecheckAfterInit = false;
onActivated(() => {
  instanceActive = true;
  // R233-A：缓存实例回到前台时与共享 store 的窗口对账（见
  // reconcileAfterReactivation）——只在激活时检查，停用实例不动作。
  reconcileAfterReactivation();
});
onDeactivated(() => {
  instanceActive = false;
});

const transport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  renewAccessToken: () => auth.renewAccessToken(transport),
  getAccountId: () => auth.accountId,
  getSessionId: () => auth.getSessionId(),
  getSessionRevision: () => auth.getSessionRevision(),
  onUnauthorized: () => auth.onUnauthorized(),
  // VC-R52 期望账号失配恢复：先作废旧本地归属再读当前 Cookie 身份，不自动
  // 重放聊天动作（共享入口见 stores/auth.ts reconcileAccountContext）。
  // VC-R220：精确 409（换号或同账号新 session）已同步清理共享缓存，通用
  // 可聊空态与禁用输入框在真实身份未重新确立前是错误承诺——立即切到诚实
  // 的"登录状态已更新"说明与安全返回入口。VC-R221：同时作废正在跑的同
  // 一次 initPage——它的终态不再覆盖本态；用户主动的重新初始化（initPage
  // 入口重置标记）照常以 error/ready 覆盖，合法重开后不残留。
  onAccountContextChanged: () => {
    initInvalidatedByAccountContext = true;
    pageState.value = "account-updated";
    void auth.reconcileAccountContext(transport);
  },
});
const authedFetch = createAuthedFetch(() => auth.accessToken, {
  renewAccessToken: () => auth.renewAccessToken(transport),
  getAccountId: () => auth.accountId,
  getSessionId: () => auth.getSessionId(),
  getSessionRevision: () => auth.getSessionRevision(),
  onUnauthorized: () => auth.onUnauthorized(),
  // VC-R220/R221：同 transport 钩子——SSE 路径的精确 409 也切登录状态
  // 更新说明态并作废在途初始化。
  onAccountContextChanged: () => {
    initInvalidatedByAccountContext = true;
    pageState.value = "account-updated";
    void auth.reconcileAccountContext(transport);
  },
});
const deps: RealtimeDeps = createBrowserRealtimeDeps(authedFetch);

const companionName = computed(() => (
  relStore.current ? companionHeaderName(relStore.current) : ""
));
const displayMessages = computed(() => store.displayMessages);
const generationBusy = computed(() => store.generationStarting);
// VC-R172：发送链的视图 busy = generation POST 在途（store）∪ 建会话准备段
// （页面）。复用 composer 的 busy 语义：禁发送/重试按钮，textarea 不禁
// （组件里 textarea 只读 disabled）。VC-R185：它同时是提交互斥的关键段守卫
// （见 sendText）；终态同步段不占用——页面与 R182 的 store 边界一致。
const composerBusy = computed(() => generationBusy.value || preparingConversation.value);
const showEmptyHistory = computed(() => (
  pageState.value === "ready" &&
  displayMessages.value.length === 0 &&
  !store.isStreaming &&
  !composerBusy.value
));
const showLoadMore = computed(() => (
  store.historyHasMore && store.messages.length > 0 && !store.isStreaming
));
const canRetry = computed(() => (
  !composerBusy.value &&
  (unconfirmedSendText.value !== "" ||
    (store.phase === "failed" && store.pendingUserContent.trim().length > 0))
));
/**
 * N-05：发送结果未确认——页面快照（POST 结果未知抛错，含建会话失败）或
 * POST 失败轮（phase 失败且本轮未确认持有 generation，存在性隐藏 403/404
 * 的 null 返回也落在这里）。文案与重试动作的第一分流：原请求结局未知，
 * 只做同键普通重发，不取快照 source。VC-R115：该分支的重试按钮明确为
 * "重试原消息"，与发送当前草稿区分。
 */
const sendUnconfirmed = computed(() => (
  unconfirmedSendText.value !== "" ||
  (store.phase === "failed" && !store.turnHasGeneration)
));
/**
 * N-05（第 5 节状态矩阵）：失败文案按事实分流——已接受的请求不能说成
 * "没发出去"；仅输出未确认（exhausted/断网）时动作是重新连接原流；
 * 服务端明确终态失败才是"这次回复没有完成"。
 *
 * 分流以当前提交意图为准：发送结果未确认先走 sendUnconfirmed；重连场景
 * 只剩"本轮已确认持有 generation"的失败轮——POST 失败轮不持有 generation，
 * 旧轮的 exhausted 残留不得劫持当前重试。
 */
const reconnectFailed = computed(() => (
  !sendUnconfirmed.value &&
  store.phase === "failed" &&
  store.turnHasGeneration &&
  (store.outcome === "exhausted" ||
    store.lastDisconnect === "network" ||
    store.lastDisconnect === "service")
));
/**
 * N-05：not_found_or_forbidden 不等于服务端明确生成失败，也不等于可重连
 * 的输出未确认——反复重连只会反复 404，直接新键发送会复制用户消息。保留
 * 草稿，提供一次有界核对入口。
 */
const turnUnverifiable = computed(() => (
  !sendUnconfirmed.value &&
  store.phase === "failed" &&
  store.outcome === "not_found_or_forbidden"
));
const sendErrorText = computed(() => {
  if (sendUnconfirmed.value) return "没有确认发送结果，点此重试";
  if (store.phase !== "failed") return "";
  if (turnUnverifiable.value) return "这条回复暂时无法访问，点此核对";
  if (reconnectFailed.value) return "回复连接中断，点此重新连接";
  return "这次回复没有完成，点此重新尝试";
});
/**
 * VC-R198：更早消息加载失败的反馈不走底部状态区——停在顶部点"查看更早消息"
 * 的用户看不到列表末尾；交给列表在顶部入口就近展示并提供重试。
 */
const olderLoadError = computed(() => (
  store.historyLoadFailed ? "更早的消息没有加载出来，可以再试一次。" : ""
));
const statusText = computed(() => {
  // N-06：仅完成结果使用"回复已完成"文案（finalSyncFailed 只在完成路径
  // 置位，新一轮 send 开始即清除；phase 不符时不抢占其他文案位）。
  if (store.finalSyncFailed && store.phase === "completed") {
    return "回复已完成，记录同步暂未成功。";
  }
  if (store.recentLoadFailed) return "最近的记录没有同步完整，可以重新加载。";
  if (store.cancelUnconfirmed && store.phase === "cancelled") {
    return "已停止显示这条回复，生成状态待确认。";
  }
  // VC-R172：发送链进度——准备段只覆盖建会话，POST 段由 store 的
  // generationStarting 接管；SSE 与终态两者均假，"正在回复"不受遮盖。
  if (preparingConversation.value) return "正在准备会话…";
  if (store.generationStarting) return "正在发送…";
  switch (store.phase) {
    case "streaming":
      return "正在回复…";
    case "cancelled":
      return "已停止回复";
    case "blocked":
      return "这句话暂时无法回应，可以换一种说法。";
    default:
      return "";
  }
});
const statusAction = computed(() => {
  if (store.finalSyncFailed && store.phase === "completed") return "同步记录";
  if (store.recentLoadFailed) return "重新加载";
  if (store.cancelUnconfirmed && store.phase === "cancelled") return "核对生成状态";
  return "";
});
const statusTone = computed<StatusTone>(() => {
  if (
    store.recentLoadFailed ||
    (store.finalSyncFailed && store.phase === "completed")
  ) {
    return "error";
  }
  if (store.phase === "streaming" || preparingConversation.value || store.generationStarting) {
    return "progress";
  }
  return "muted";
});

function knownRelationshipIds(): string[] {
  return relStore.relationships.map((relationship) => relationship.relationshipId);
}

function queryContext(): { relationshipId: string; conversationId: string } {
  try {
    if (typeof location === "undefined") return { relationshipId: "", conversationId: "" };
    const parsed = readContextFromLocation(location);
    return {
      relationshipId: parsed.relationshipId ?? "",
      conversationId: parsed.conversationId ?? "",
    };
  } catch {
    return { relationshipId: "", conversationId: "" };
  }
}

function conversationsHref(): string {
  return buildContextHref("conversations", {
    relationshipId: relStore.currentRelationshipId,
    knownRelationshipIds: knownRelationshipIds(),
  });
}

function onBack(): void {
  goBack("/pages/index/index");
}

/**
 * VC-R220：账号上下文失效后的安全出口——顶层切换直达首页，不携带旧
 * 关系/会话参数，失效上下文的页面实例不留在返回栈。
 */
function onAccountUpdatedHome(): void {
  switchTabTo("/pages/index/index");
}

function openAllConversations(): void {
  menuOpen.value = false;
  goTo(conversationsHref());
}

function bindGenerationContext(): void {
  const relationshipId = relStore.currentRelationshipId;
  if (!relationshipId) return;
  store.bindGenerationContext(auth.accountId ?? "", relationshipId);
}

// R233-A：resumeConversationId——激活对账失配恢复传入本实例已成功绑定的
// 原会话（可为空串＝空会话）；目标不再取 URL query 或服务端最新，原草稿
// 不得被带进其他会话。
async function initPage(opts?: { resumeConversationId?: string }): Promise<void> {
  if (initBusy.value) return;
  initBusy.value = true;
  // VC-R221：这是"用户主动发起的合法重新初始化"——重置身份事件作废
  // 标记，本页照常走 loading→终态，并以此退出 account-updated 说明态。
  initInvalidatedByAccountContext = false;
  pageState.value = "loading";
  unconfirmedSendText.value = "";
  inputRefilledFromFailure = false;
  store.historyLoadFailed = false;
  try {
    if (!auth.isAuthenticated) await auth.tryRefresh(transport);
    if (!auth.isAuthenticated) {
      settleInitPageState("error");
      return;
    }

    await relStore.load(transport);
    if (relStore.status === "error") {
      settleInitPageState("error");
      return;
    }

    const query = queryContext();
    // VC-R04：记录本次 init 的 URL 目标（含等待未落地），供 hashchange 去重。
    lastInitTargetConversationId = query.conversationId;
    if (query.relationshipId && knownRelationshipIds().includes(query.relationshipId)) {
      relStore.currentRelationshipId = query.relationshipId;
    }
    const relationshipId = relStore.currentRelationshipId;
    if (!relationshipId) {
      settleInitPageState("missing");
      return;
    }

    const conversationsLoaded = await store.loadConversations(transport, relationshipId);
    if (!conversationsLoaded) {
      settleInitPageState("error");
      return;
    }

    const targetConversationId = opts?.resumeConversationId !== undefined
      ? opts.resumeConversationId
      : query.conversationId || store.conversations[0]?.conversationId || "";
    if (targetConversationId) {
      const opened = await store.openConversation(transport, targetConversationId);
      if (opened === "busy-streaming") {
        // VC-R02：其他会话的回复仍在生成——正常等待状态，不是网络错误；
        // 等待期间不清空/中断 store 里进行中的流。
        settleInitPageState("waiting");
        return;
      }
      if (opened !== "opened") {
        settleInitPageState("error");
        return;
      }
    } else if (store.conversationId) {
      if (store.isStreaming) {
        // VC-R02：无目标会话但另一实例的流仍在生成——同样不清空窗口。
        settleInitPageState("waiting");
        return;
      }
      store.reset();
    }

    // VC-R04：记录本实例的目标会话归属（含空会话——等待态在上方已返回，
    // 不会走到这里）。此后本实例的恢复核对都以此为准。
    owningConversationId = store.conversationId;
    bindGenerationContext();
    // VC-R204：发送失败的反馈不随页面实例销毁丢失。POST 抛错（结果未知/
    // 确定失败）不写 store 相位，原提交只记录在发起实例的未确认快照里；
    // 同会话返回时 openConversation 早退保留 turn 状态，而新实例 initPage
    // 已清空本地快照——错误文案、重试入口与原消息回填会全部消失。ready
    // 落地时按 store 仍持有的原提交重建同样的反馈；输入框已有用户草稿时
    // 只重建重试入口、不覆盖草稿（与 sendText 失败回填同一语义）。failed
    // 相位有自己的文案/重连分流，streaming/POST 在途不是失败，均不在此列。
    if (
      store.pendingUserContent.trim() !== "" &&
      !store.isStreaming &&
      !store.generationStarting &&
      store.phase !== "failed"
    ) {
      unconfirmedSendText.value = store.pendingUserContent;
      if (inputText.value.trim() === "") {
        inputText.value = store.pendingUserContent;
        inputRefilledFromFailure = true;
      }
    }
    settleInitPageState("ready");
    if (store.conversationId) {
      const restoringConversationId = store.conversationId;
      const restoringAccountId = auth.accountId;
      const restoringSessionId = auth.getSessionId();
      const stillOwnsRestore = (): boolean => instanceActive
        && owningConversationId === restoringConversationId
        && store.conversationId === restoringConversationId
        && auth.accountId === restoringAccountId
        && auth.getSessionId() === restoringSessionId;
      // 历史已就绪，恢复流独立运行；不能等整个 SSE 结束才显示消息和停止按钮。
      void store.tryRestoreAfterReload(
        deps,
        { accountId: auth.accountId ?? "", relationshipId },
        instanceToken,
        transport,
      ).then((restored) => {
        if (restored && stillOwnsRestore()) return store.loadHistory(transport);
      }).catch(() => {
        if (stillOwnsRestore()) store.recentLoadFailed = true;
      });
    }
    await nextTick();
    scheduleScrollToBottom();
  } catch {
    settleInitPageState("error");
  } finally {
    initBusy.value = false;
    if (pendingHashRecheckAfterInit) {
      pendingHashRecheckAfterInit = false;
      onLocationHashChange();
    }
  }
}

// VC-R196：把本页"可刷新的定位"同步到刚创建成功的会话。uni.redirectTo 会
// removeLastPage 并以新 __id__ 重建本页（卸载正在提交的实例）；vue-router
// 的 replace 保留 history.state.__id__（uni-h5 KeepAlive 的页面 key），同页
// 同实例只更新地址与 currentRoute，且 replaceState 不触发 hashchange/
// popstate——在途发送链不受影响。
interface H5Router {
  replace: (to: string) => unknown;
}

/**
 * R233-A：KeepAlive 缓存页重新激活时的生命周期对账。uni H5 返回导航把
 * 停用的缓存实例推回前台时，共享 chat store 的窗口可能已被其他实例切走：
 * hashchange 在停用期被守卫跳过，激活后 hashchange 又按本实例的
 * lastInitTargetConversationId 对 URL 去重，不再核对全局窗口——缓存页会拿
 * 别的实例的会话冒充自己的内容（URL/标题仍是原会话，消息却是别人的）。
 * 对账按本实例已落地的归属（owningConversationId，含空会话）核对共享窗口：
 * 一致——只静默刷新关系 metadata，草稿、滚动位置、历史窗口与进行中的流
 * 一律不动；失配——带着已成功绑定的原会话重走 initPage（busy/streaming/
 * 未知结果/身份守卫全部复用），撞上其他实例的忙流落诚实等待，不自动
 * 取消/重放，也不改读服务端最新会话把原草稿带过去。
 */
function reconcileAfterReactivation(): void {
  // 在途 init（含首次 mount 发起的那次）自己会落地窗口与归属——激活
  // 对账不重复初始化。
  if (initBusy.value) return;
  // 从未跑过 initPage 的实例没有已落地归属可核对。
  if (lastInitTargetConversationId === null) return;
  // 只有 ready 页直接显示共享窗口；loading 已被 initBusy 覆盖，
  // waiting/error/missing/account-updated 各有自己的诚实出口，不改写。
  if (pageState.value !== "ready") return;
  if (store.conversationId === owningConversationId) {
    void refreshRelationshipMetadata();
    return;
  }
  void initPage({ resumeConversationId: owningConversationId });
}

/**
 * R233-A：等待/错误页手动重开的目标——保留本实例已确定的原目标，而不是
 * 重新按 URL query/服务端最新选会话（无 query 缓存页的原草稿会被带进别的
 * 会话）。优先级：显式 URL 目标（hashchange 停用前的意图，与重开语义
 * 一致）＞ 本实例已落地的归属（激活失配恢复撞忙流/失败后仍未落地的原
 * 会话）；两者都没有（首次进入尚未落地）返回 undefined，交给 initPage
 * 默认选择。
 */
function manualReopenTarget(): string | undefined {
  if (lastInitTargetConversationId) return lastInitTargetConversationId;
  if (owningConversationId) return owningConversationId;
  return undefined;
}

/**
 * R233-A：对齐返回（共享窗口仍是本实例归属）时静默刷新关系 metadata。
 * 设置页保存陪伴称呼走 updateRelationshipPrefs 直写服务端，不经过共享
 * relationship store，缓存页标题（computed 依赖 relStore.current）不会
 * 自行更新——用既有关系列表读取拿一次权威行，只写 relationships、不动
 * currentRelationshipId；读取失败静默保留旧标题，不改变页面状态（这是
 * 显示增强，不是初始化，不落 relStore.load 失败清空 current 的语义）。
 */
async function refreshRelationshipMetadata(): Promise<void> {
  if (!auth.isAuthenticated) return;
  const accountIdAtRequest = auth.accountId;
  const sessionIdAtRequest = auth.getSessionId();
  const conversationIdAtRequest = store.conversationId;
  try {
    const rows = await listRelationships(transport);
    // await 期间本实例被停用（用户又离开）或共享窗口被其他实例切走时，
    // 晚到的旧行不得回写共享 relationships——与身份变化同一层回写门。
    if (!instanceActive) return;
    if (auth.accountId !== accountIdAtRequest || auth.getSessionId() !== sessionIdAtRequest) return;
    if (store.conversationId !== conversationIdAtRequest) return;
    relStore.relationships = rows;
  } catch {
    // 静默：标题暂留旧值，下次进入页面或失配恢复时再刷新。
  }
}

function syncLocationToCreatedConversation(conversationId: string): void {
  // 复用既有保障：initConversation 的窗口令牌已确认创建结果未被丢弃；这里
  // 再核 store 仍持有该会话（loadHistory 的 await 期间窗口可能又被切走）且
  // 本实例仍是活动页——KeepAlive 停用的隐藏页不得改写前台页面的地址。
  if (!instanceActive) return;
  if (store.conversationId !== conversationId) return;
  // 裸 getApp 引用与 companion.vue 的 H5 离开守卫同惯例：uni-h5 构建注入；
  // 组件测试与非 uni 宿主经 typeof 静默降级（仅失去地址同步，不影响发送）。
  if (typeof getApp === "function") {
    const router = getApp<{ $router?: H5Router }>().$router;
    if (router?.replace) {
      // R04 去重基准随地址更新：与 hash 事件比较的目标已是新地址的真实
      // 目标——回到旧会话的地址变更不被旧基准忽略，落回同目标也不重开。
      lastInitTargetConversationId = conversationId;
      try {
        void router.replace(buildContextHref("chat", {
          relationshipId: relStore.currentRelationshipId,
          conversationId,
          knownRelationshipIds: knownRelationshipIds(),
        }));
      } catch {
        // 地址同步失败不影响发送链（与 app/navigate.ts 的安全壳同惯例）。
      }
    }
  }
}

async function ensureConversation(): Promise<boolean> {
  if (store.conversationId) return true;
  const relationshipId = relStore.currentRelationshipId;
  if (!relationshipId) return false;
  const created = await store.initConversation(transport, relationshipId);
  if (!created) return false;
  // VC-R04：本实例首次建会话成功——归属随之更新（窗口令牌守卫保证
  // await 期间未被其他实例切换时才会走到这里）。
  owningConversationId = store.conversationId;
  // VC-R196：创建已落地，可刷新定位指向真实新会话。
  syncLocationToCreatedConversation(created.conversationId);
  bindGenerationContext();
  void store.loadConversations(transport, relationshipId);
  return true;
}

/**
 * WP-D（缺口1+2）+ VC-R185：提交路径。互斥覆盖"建会话（如需要）+ POST/
 * streaming 启动"关键段：进入即在任何 await 之前同步置 preparingConversation
 * （composerBusy 的页面侧分量），ensureConversation 同步返回后交接到 store
 * 的 generationStarting——交接语句之间无 await，无守卫空窗；返回 false 表示
 * 正被上一笔提交占用。终态同步（completed 后的身份快照/历史补页）不再占用
 * 提交锁——R182 已明确 store 边界支持旧终态同步在途时下一轮 send。
 * VC-R121：输入框草稿与提交快照分离——清空只按草稿归属（本次提交的就是
 * 输入框内容，或输入框仍持有本次提交的失败自动回填且用户未编辑），不用
 * 正文相等推断，用户重新输入的同文草稿是独立意图。失败恢复同样绝不触碰
 * 用户后来输入的新草稿。VC-R115：失败时把原始提交记为未确认快照，重试
 * 据此针对原提交，与输入框里的下一条草稿无关。
 */
async function sendText(
  text: string,
  sourceUserMessageId?: string,
  fromDraft = false,
): Promise<boolean> {
  if (composerBusy.value || store.isStreaming) return false;
  // VC-R172：准备段反馈的生命周期——进入即置位，ensureConversation 返回后
  // 交给 generationStarting（POST 段），失败路径在 catch 释放。
  preparingConversation.value = true;
  unconfirmedSendText.value = "";
  if (fromDraft) {
    if (inputText.value.trim() === text) inputText.value = "";
  } else if (inputRefilledFromFailure) {
    inputText.value = "";
  }
  inputRefilledFromFailure = false;
  // 缺陷6：提交归属锚点。建会话成功后锚点更新为提交时的会话；失败回调
  // 只在提交身份仍是当前上下文时回填输入/错误文案——用户在 await 期间
  // 切换会话后，晚到的失败响应静默丢弃，不覆盖新会话的输入与 UI。
  const anchorBeforeEnsure = store.conversationId;
  let submittedConversationId: string | null = null;
  try {
    const ready = await ensureConversation();
    if (!ready) throw new Error("conversation unavailable");
    // 准备段结束：POST 段的 busy/进度由 store 的 generationStarting 接管。
    preparingConversation.value = false;
    submittedConversationId = store.conversationId;
    await store.send(transport, deps, text, {
      sourceUserMessageId,
      ownerToken: instanceToken,
    });
    if (store.phase === "completed" && relStore.currentRelationshipId) {
      void store.loadConversations(transport, relStore.currentRelationshipId);
    }
    return true;
  } catch {
    // 建会话失败时准备段可能仍在位：释放，交给既有未确认重试反馈。
    preparingConversation.value = false;
    const expectedConversationId = submittedConversationId ?? anchorBeforeEnsure;
    if (store.conversationId !== expectedConversationId) return false;
    if (inputText.value.trim() === "") {
      inputText.value = text;
      inputRefilledFromFailure = true;
    }
    unconfirmedSendText.value = text;
    return true;
  }
}

async function onSend(): Promise<void> {
  const text = inputText.value.trim();
  if (!text || store.isStreaming || generationBusy.value) return;
  await sendText(text, undefined, true);
}

/** VC-R121：用户对输入框的每次输入都是新草稿——解除失败回填的归属。 */
function onDraftInput(value: string): void {
  inputText.value = value;
  inputRefilledFromFailure = false;
}

async function onRetry(): Promise<void> {
  if (!canRetry.value) return;
  // N-05：按事实分流。已确认 generation、仅输出未确认（exhausted/断网）时，
  // 重试＝重新连接原流/快照，绝不新建 generation、不重复用户消息；
  // not_found_or_forbidden 不重连循环也不新键发送——一次有界核对，草稿保留。
  if (reconnectFailed.value || turnUnverifiable.value) {
    void store.recoverInFlight(deps, instanceToken, owningConversationId, transport);
    return;
  }
  // N-05：发送结果未确认＝普通同键重发：不调用 resolveTurnSource、不传
  // sourceUserMessageId——原请求结局未知，复制用户消息或按旧 generation
  // 的快照重发都可能造成重复。
  // VC-R115：重试目标＝失败时记录的原提交快照——输入框里后来写下/编辑的
  // 下一条草稿不得被当作原提交重发；建会话失败（store.send 未执行）时
  // 也不取 store 里更早一轮的 pending 内容。快照为空的 store 相位分支
  // （存在性隐藏 403/404→null）仍取本轮 pendingUserContent。
  if (sendUnconfirmed.value) {
    const text = unconfirmedSendText.value || store.pendingUserContent.trim();
    if (!text) return;
    await sendText(text);
    return;
  }
  // 该分支仅在发送结果已确认时可达（sendUnconfirmed 为 false ⇒
  // unconfirmedSendText 恒为空）：即已确认 generation 的明确终态失败重试，
  // 文本一律取 store 的待重发内容。
  // N-06：服务端明确终态失败后的显式再尝试，复用已持久化的原用户消息。
  // lastTurnSource 为空时先有界取一次快照拿权威 source；拿不到就不重发，
  // 保留核对入口——绝不退回普通发送复制用户消息。
  const text = store.pendingUserContent.trim();
  if (!text) return;
  const sourceId = await store.resolveTurnSource(deps);
  if (!sourceId) return;
  await sendText(text, sourceId);
}

function onCancel(): void {
  void store.cancel();
}

function onStatusAction(): void {
  // N-06：按待处理事实分流——记录同步失败先补页；最近窗口不完整重发
  // 最近窗口请求；否则手动核对"已停止待确认"的生成，快照为权威。
  if (store.finalSyncFailed) {
    void store.retryFinalSync(transport);
    return;
  }
  if (store.recentLoadFailed) {
    void store.loadHistory(transport);
    return;
  }
  void store.recoverInFlight(deps, instanceToken, owningConversationId, transport);
}

/**
 * WP-D（缺口6）：手动加载更早消息，prepend 后做阅读锚点补偿——按真实
 * 高度差补偿，视口内容不跳动。
 * R209：在途等待期间的重复触发直接吞掉——不重发 GET（store 已有同层防
 * 重入），也不重做第二次阅读补偿。
 * R209-B：真实浏览器会在 prepend 渲染时自行锚定 scrollTop，渲染后的值不
 * 可再作基点（会双补偿）。store 在归属校验通过、提交之前回调——在此捕获
 * 浏览器锚定前的真实阅读几何（等待期间用户滚动后的位置、错误提示清除后
 * 的高度），渲染后用捕获 top + 高度差作原有补偿；作废响应不触发回调，
 * 没有有效快照就不写滚动。失败路径提前返回，不写 scrollTop。
 */
async function onLoadMore(): Promise<void> {
  if (store.historyLoadingMore) return;
  store.historyLoadFailed = false;
  // R209-B：快照经可变 holder 持有——回调在闭包内赋值，直接用 let 局部
  // 变量会被 TS 控制流按初始 null 收窄。
  const holder: { current: { top: number; height: number } | null } = { current: null };
  try {
    await store.loadMoreHistory(transport, undefined, () => {
      const node = historyNode();
      if (node) holder.current = { top: node.scrollTop, height: node.scrollHeight };
    });
  } catch {
    store.historyLoadFailed = true;
    return;
  }
  await nextTick();
  const after = historyNode();
  const anchorSnapshot = holder.current;
  if (!after || !anchorSnapshot) return;
  after.scrollTop = anchorSnapshot.top + Math.max(0, after.scrollHeight - anchorSnapshot.height);
}

/** VC-R195：开始新对话会清空输入框的确认文案（只陈述输入框内容会被清空）。 */
const NEW_CONVERSATION_CONFIRM_MESSAGE = "输入框里还有内容，开始新对话会清空输入框。确定开始新对话吗？";

function startNewConversation(): void {
  // VC-R172：准备段的在途提交尚未落地，开新对话会与其竞争窗口归属，一并禁用。
  if (store.isStreaming || composerBusy.value) return;
  // VC-R195：输入框里还有实际内容（含失败后回填的原提交）时，新开会连带
  // 清空草稿与原消息重试快照——先原生确认，取消则窗口、草稿、重试信息与
  // 菜单一律不动；空/纯空白输入没有要丢的内容，按原行为直接新开。
  if (inputText.value.trim() !== "") {
    const confirmed = typeof globalThis.confirm === "function"
      ? globalThis.confirm(NEW_CONVERSATION_CONFIRM_MESSAGE)
      : false;
    if (!confirmed) return;
  }
  menuOpen.value = false;
  store.reset();
  owningConversationId = ""; // VC-R04：本实例转入空会话，归属同步清空。
  bindGenerationContext();
  inputText.value = "";
  unconfirmedSendText.value = "";
  inputRefilledFromFailure = false;
  store.historyLoadFailed = false;
  followingLatest.value = true;
}

const historyEl = ref<unknown>(null);
const followingLatest = ref(true);
let pendingScrollFrame = 0;
// VC-R179：上次观测到的历史节点、scrollTop 与 clientHeight。视口几何
// 变化（如缩高）会在 scrollTop 未变时对历史容器派发 scroll；高度或内容
// 变化还会让浏览器把旧位置 clamp 到当前合法范围——跟随中这些都不是主
// 动阅读，不因瞬时离底丢跟随；稳定几何下的实际滚动仍按原 near-bottom
// 判定。基线在 historyEl 就绪/更换后的下一拍重建。
let observedScrollNode: HTMLElement | null = null;
let observedScrollTop = 0;
let observedClientHeight = 0;

watch(historyEl, () => {
  void nextTick(() => {
    const node = historyNode();
    observedScrollNode = node;
    observedScrollTop = node ? node.scrollTop : 0;
    observedClientHeight = node ? node.clientHeight : 0;
  });
});

function isNearBottom(node: HTMLElement): boolean {
  return node.scrollHeight <= node.clientHeight
    || node.scrollHeight - node.clientHeight - node.scrollTop <= RESUME_GAP_PX;
}

// VC-R179：把视口带到内容底。写入后同步记录实际回读的 scrollTop
// （浏览器会 clamp 到当前最大可滚动值）——观测基线不依赖异步 scroll
// 事件送达，回到最新/自动贴底与随后的几何重排之间的事件间隙内，新底
// 位置不会被当成用户移动。
function scrollHistoryToBottom(node: HTMLElement): void {
  node.scrollTop = node.scrollHeight;
  observedScrollTop = node.scrollTop;
  observedClientHeight = node.clientHeight;
  observedScrollNode = node;
}

function historyNode(): HTMLElement | null {
  const raw = historyEl.value;
  if (raw instanceof HTMLElement) return raw;
  const element = (raw as { $el?: unknown } | null)?.$el;
  return element instanceof HTMLElement ? element : null;
}

function cancelPendingScrollFrame(): void {
  if (pendingScrollFrame && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(pendingScrollFrame);
  }
  pendingScrollFrame = 0;
}

function scheduleScrollToBottom(): void {
  if (!followingLatest.value || pendingScrollFrame) return;
  const node = historyNode();
  if (!node) return;
  const conversationId = store.conversationId;
  if (typeof requestAnimationFrame !== "function") {
    scrollHistoryToBottom(node);
    return;
  }
  pendingScrollFrame = requestAnimationFrame(() => {
    pendingScrollFrame = 0;
    // VC-R179：入队后用户可能已原生 scroll 离底（滚动条拖拽/辅助滚动不
    // 产生 wheel/touchmove/keydown，user-intent 取消入口不会触发）。执行
    // 点按最新 followingLatest 放弃过期跟随，保留阅读位置；重新跟随由
    // 回到最新后的新入队帧承接。
    if (!followingLatest.value) return;
    if (historyNode() !== node || store.conversationId !== conversationId) return;
    scrollHistoryToBottom(node);
  });
}

function onHistoryUserScrollIntent(event: Event): void {
  if (
    event instanceof KeyboardEvent &&
    (event.target !== event.currentTarget ||
      !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key))
  ) {
    return;
  }
  // VC-R179：真实用户输入优先于几何判定——立即暂停跟随并取消旧自动
  // 帧，再排一次带 node/conversation 归属的原生 RAF 检查实际滚动结果。
  // 冻结输入时刻的跟随态与位置：原在跟随且无实际位移（滚轮打在边界）
  // 时恢复跟随并按需补排贴底帧——同时发生的内容增长/缩高不留假离底。
  cancelPendingScrollFrame();
  const node = historyNode();
  if (!node) return;
  const wasFollowing = followingLatest.value;
  const topBefore = node.scrollTop;
  followingLatest.value = false;
  const conversationId = store.conversationId;
  const recheck = (): void => {
    if (historyNode() !== node || store.conversationId !== conversationId) return;
    observedScrollTop = node.scrollTop;
    observedClientHeight = node.clientHeight;
    if (wasFollowing && node.scrollTop === topBefore) {
      followingLatest.value = true;
      scheduleScrollToBottom();
      return;
    }
    followingLatest.value = isNearBottom(node);
  };
  if (typeof requestAnimationFrame !== "function") {
    recheck();
    return;
  }
  pendingScrollFrame = requestAnimationFrame(() => {
    pendingScrollFrame = 0;
    recheck();
  });
}

function onHistoryScroll(event: Event): void {
  const node = historyNode();
  if (!node || event.target !== node) return;
  // VC-R179：scrollTop 未变的 scroll 是几何重排而非主动阅读——跟随中
  // 保持跟随；节点更换后的首个事件只重建观测基线。clientHeight 变化
  // 同属几何重排：中间视口会把 top clamp 到新最大值且事件可能被合并
  // 未送达，最终 scroll 里 top 相对旧基线的变化是 clamp 痕迹不是用户
  // 移动——跟随中也保留。稳定几何下的实际滚动仍按 near-bottom 判定，
  // 用户回到底部可恢复跟随。
  const sameNode = node === observedScrollNode;
  const scrollTopUnchanged = sameNode && node.scrollTop === observedScrollTop;
  // 正高度基线才可信：挂载瞬间布局未定的 0 不能证明几何 clamp。
  const geometryReshuffled =
    sameNode && observedClientHeight > 0 && node.clientHeight > 0
    && node.clientHeight !== observedClientHeight;
  observedScrollNode = node;
  observedScrollTop = node.scrollTop;
  observedClientHeight = node.clientHeight;
  if (followingLatest.value && (scrollTopUnchanged || geometryReshuffled)) return;
  followingLatest.value = isNearBottom(node);
}

function onBackToLatest(): void {
  // VC-R181：手动恢复跟随的明确意图——取消离底时排队的用户意图检查帧，
  // 避免其用冻结的 wasFollowing=false 在执行点再次关掉刚恢复的跟随。
  cancelPendingScrollFrame();
  followingLatest.value = true;
  const node = historyNode();
  if (node) scrollHistoryToBottom(node);
}

function onViewportChange(): void {
  if (followingLatest.value) scheduleScrollToBottom();
}

watch(
  () => store.conversationId,
  () => {
    cancelPendingScrollFrame();
    followingLatest.value = true;
  },
);

watch(
  () => [displayMessages.value.length, store.draft, statusText.value],
  () => {
    void nextTick(() => scheduleScrollToBottom());
  },
);

let stopLifecycle: (() => void) | undefined;

/**
 * VC-R04（疑点1 复核）：H5 直接编辑 location.hash（同页面路径、不同会话
 * 参数）时，uni 路由不重建本页实例——页面停留在旧窗口，URL 已指向 conv-b
 * 却仍显示 conv-a 的流式草稿（VC-R02 观察到的形态）。页面自行监听
 * hashchange：hash 仍指向 chat 页且目标会话与最近一次 init 的 URL 目标不同
 * 时重走完整 initPage（打开/等待/守卫语义不变）。去重基准是 init 尝试过的
 * 目标而非已落地会话：busy 等待期间浏览器返回原会话也要能重开，否则页面
 * 会卡在等待态。同目标或指向其他页面时不动作；仅当前活动实例响应
 * （KeepAlive 停用的隐藏缓存页不响应别的页面的 hash 变化）。
 */
function onLocationHashChange(): void {
  // KeepAlive 停用的隐藏页不响应——只有当前活动实例可以重开窗口。
  if (!instanceActive) return;
  if (typeof location === "undefined") return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (!/^#\/pages\/chat\/chat(\?|$)/.test(location.hash)) return;
  if (initBusy.value) {
    pendingHashRecheckAfterInit = true;
    return;
  }
  if (pageState.value === "loading") return;
  if (queryContext().conversationId === lastInitTargetConversationId) return;
  void initPage();
}

onMounted(() => {
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    stopLifecycle = installStreamLifecycle({
      addEventListener: (name, handler) => window.addEventListener(name, handler),
      removeEventListener: (name, handler) => window.removeEventListener(name, handler),
      getVisibility: () => document.visibilityState,
      onRecover: () => {
        void store.recoverInFlight(deps, instanceToken, owningConversationId, transport);
      },
    });
    document.addEventListener("scroll", onHistoryScroll, { capture: true, passive: true });
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("hashchange", onLocationHashChange);
    window.visualViewport?.addEventListener("resize", onViewportChange);
  }
  void initPage();
});

onUnmounted(() => {
  instanceActive = false;
  pendingHashRecheckAfterInit = false;
  stopLifecycle?.();
  cancelPendingScrollFrame();
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    document.removeEventListener("scroll", onHistoryScroll, true);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("hashchange", onLocationHashChange);
    window.visualViewport?.removeEventListener("resize", onViewportChange);
  }
  // VC-R02：只有登记了流归属的本实例才 detach——等待页/纯展示页离开时
  // 不得把其他页面实例正在进行的活跃流打成 failed/network。
  store.detachInFlight(instanceToken);
});
</script>

<style scoped>
.chat-page-state {
  display: grid;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: var(--vc-space-6) clamp(16px, 4vw, 20px);
}

.chat-page-state--loading {
  align-content: start;
  gap: var(--vc-space-6);
}

.chat-page-skeleton {
  height: 76px;
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface-soft);
}

.chat-page-skeleton--assistant {
  width: 72%;
}

.chat-page-skeleton--user {
  justify-self: end;
  width: 58%;
}

.chat-page-state--message {
  justify-items: center;
  align-content: center;
  gap: var(--vc-space-3);
  text-align: center;
}

.chat-page-state__title {
  color: var(--vc-color-ink);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
}

.chat-page-state__copy {
  color: var(--vc-color-ink-muted);
  font-size: 14px;
  line-height: 22px;
}

.chat-page-state__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--vc-space-3);
  margin: var(--vc-space-2) 0 0;
}

.chat-page-state__actions .chat-page-secondary {
  margin: 0;
}

.chat-page-primary {
  min-height: 48px;
  margin: 0;
  padding: 0 var(--vc-space-6);
  border: 0;
  border-radius: var(--vc-radius-control);
  color: var(--vc-color-surface);
  background: var(--vc-color-primary);
  font: inherit;
  font-weight: 500;
}

.chat-page-primary::after {
  border: 0;
}

.chat-page-primary:not([disabled]):active {
  background: var(--vc-color-primary-pressed);
}

.chat-page-primary:disabled {
  color: var(--vc-color-ink-muted);
  background: var(--vc-color-surface-soft);
}

.chat-page-secondary {
  min-height: 48px;
  margin: var(--vc-space-2) 0 0;
  padding: 0 var(--vc-space-5);
  border: 1px solid var(--vc-color-primary);
  border-radius: var(--vc-radius-control);
  color: var(--vc-color-primary);
  background: transparent;
  font: inherit;
  font-weight: 500;
}

.chat-page-secondary::after {
  border: 0;
}

.chat-history-frame {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.chat-back-to-latest {
  position: absolute;
  right: var(--vc-space-4);
  bottom: var(--vc-space-3);
  min-height: 40px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-full);
  color: var(--vc-color-secondary);
  background: var(--vc-color-surface);
  box-shadow: var(--vc-shadow-floating);
  font: inherit;
  font-size: 13px;
}

.chat-back-to-latest::after {
  border: 0;
}

.chat-options {
  display: grid;
}

.chat-option {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--vc-space-3);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 68px;
  margin: 0;
  padding: var(--vc-space-3) 0;
  border: 0;
  border-bottom: 1px solid var(--vc-color-hairline);
  border-radius: 0;
  color: var(--vc-color-ink);
  background: transparent;
  font: inherit;
  text-align: left;
}

.chat-option::after {
  border: 0;
}

.chat-option:active {
  background: var(--vc-color-surface-soft);
}

.chat-option__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--vc-radius-full);
  color: var(--vc-color-primary);
  background: var(--vc-color-surface-soft);
}

.chat-option__copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.chat-option__copy text:first-child {
  font-size: 15px;
  font-weight: 500;
  line-height: 22px;
}

.chat-option__copy text:last-child {
  overflow: hidden;
  color: var(--vc-color-ink-muted);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

button:focus-visible {
  outline: 2px solid var(--vc-color-primary);
  outline-offset: 2px;
}
</style>
