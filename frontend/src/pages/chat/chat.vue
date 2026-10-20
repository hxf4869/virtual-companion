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
      <button class="chat-page-secondary" data-testid="chat-retry-init" @click="initPage">
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
          @click="initPage"
        >
          打开所选会话
        </button>
        <button class="chat-page-secondary" data-testid="chat-waiting-back" @click="onBack">
          返回
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
        v-model="inputText"
        :busy="generationBusy"
        :streaming="store.isStreaming"
        :disabled="!relStore.currentRelationshipId"
        :error-text="sendErrorText"
        :can-retry="canRetry"
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
            :disabled="store.isStreaming || generationBusy"
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
import { createAuthenticatedTransport } from "@/api/transport";
import { goBack, goTo } from "@/app/navigate";
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

type PageState = "loading" | "ready" | "waiting" | "error" | "missing";
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
const directSendError = ref(false);
const initBusy = ref(false);
// WP-D（缺口1）：覆盖"建会话（如需要）+ 发送"的页面级提交互斥——任何
// await 之前同步置位，await ensureConversation 期间第二次 onSend 无法穿过。
let submitInFlight = false;
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
onActivated(() => {
  instanceActive = true;
});
onDeactivated(() => {
  instanceActive = false;
});

const transport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  renewAccessToken: () => auth.renewAccessToken(transport),
  getSessionRevision: () => auth.getSessionRevision(),
  onUnauthorized: () => auth.onUnauthorized(),
});
const authedFetch = createAuthedFetch(() => auth.accessToken, {
  renewAccessToken: () => auth.renewAccessToken(transport),
  getSessionRevision: () => auth.getSessionRevision(),
  onUnauthorized: () => auth.onUnauthorized(),
});
const deps: RealtimeDeps = createBrowserRealtimeDeps(authedFetch);

const companionName = computed(() => (
  relStore.current ? companionHeaderName(relStore.current) : ""
));
const displayMessages = computed(() => store.displayMessages);
const generationBusy = computed(() => store.generationStarting);
const showEmptyHistory = computed(() => (
  pageState.value === "ready" &&
  displayMessages.value.length === 0 &&
  !store.isStreaming
));
const showLoadMore = computed(() => (
  store.historyHasMore && store.messages.length > 0 && !store.isStreaming
));
const canRetry = computed(() => (
  !generationBusy.value &&
  ((directSendError.value && inputText.value.trim().length > 0) ||
    (store.phase === "failed" && store.pendingUserContent.trim().length > 0))
));
/**
 * N-05：发送结果未确认——directSendError（POST 结果未知抛错）或 POST 失败
 * 轮（phase 失败且本轮未确认持有 generation，存在性隐藏 403/404 的 null
 * 返回也落在这里）。文案与重试动作的第一分流：原请求结局未知，只做同键
 * 普通重发，不取快照 source。
 */
const sendUnconfirmed = computed(() => (
  directSendError.value || (store.phase === "failed" && !store.turnHasGeneration)
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
const statusText = computed(() => {
  // N-06：仅完成结果使用"回复已完成"文案（finalSyncFailed 只在完成路径
  // 置位，新一轮 send 开始即清除；phase 不符时不抢占其他文案位）。
  if (store.finalSyncFailed && store.phase === "completed") {
    return "回复已完成，记录同步暂未成功。";
  }
  if (store.recentLoadFailed) return "最近的记录没有同步完整，可以重新加载。";
  if (store.historyLoadFailed) return "更早的消息没有加载出来，可以再试一次。";
  if (store.cancelUnconfirmed && store.phase === "cancelled") {
    return "已停止显示这条回复，生成状态待确认。";
  }
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
    store.historyLoadFailed ||
    store.recentLoadFailed ||
    (store.finalSyncFailed && store.phase === "completed")
  ) {
    return "error";
  }
  if (store.phase === "streaming") return "progress";
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

function openAllConversations(): void {
  menuOpen.value = false;
  goTo(conversationsHref());
}

function bindGenerationContext(): void {
  const relationshipId = relStore.currentRelationshipId;
  if (!relationshipId) return;
  store.bindGenerationContext(auth.accountId ?? "", relationshipId);
}

async function initPage(): Promise<void> {
  if (initBusy.value) return;
  initBusy.value = true;
  pageState.value = "loading";
  directSendError.value = false;
  store.historyLoadFailed = false;
  try {
    if (!auth.isAuthenticated) await auth.tryRefresh(transport);
    if (!auth.isAuthenticated) {
      pageState.value = "error";
      return;
    }

    await relStore.load(transport);
    if (relStore.status === "error") {
      pageState.value = "error";
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
      pageState.value = "missing";
      return;
    }

    const conversationsLoaded = await store.loadConversations(transport, relationshipId);
    if (!conversationsLoaded) {
      pageState.value = "error";
      return;
    }

    const targetConversationId = query.conversationId || store.conversations[0]?.conversationId || "";
    if (targetConversationId) {
      const opened = await store.openConversation(transport, targetConversationId);
      if (opened === "busy-streaming") {
        // VC-R02：其他会话的回复仍在生成——正常等待状态，不是网络错误；
        // 等待期间不清空/中断 store 里进行中的流。
        pageState.value = "waiting";
        return;
      }
      if (opened !== "opened") {
        pageState.value = "error";
        return;
      }
    } else if (store.conversationId) {
      if (store.isStreaming) {
        // VC-R02：无目标会话但另一实例的流仍在生成——同样不清空窗口。
        pageState.value = "waiting";
        return;
      }
      store.reset();
    }

    // VC-R04：记录本实例的目标会话归属（含空会话——等待态在上方已返回，
    // 不会走到这里）。此后本实例的恢复核对都以此为准。
    owningConversationId = store.conversationId;
    bindGenerationContext();
    if (store.conversationId) {
      const restored = await store.tryRestoreAfterReload(
        deps,
        { accountId: auth.accountId ?? "", relationshipId },
        instanceToken,
      );
      if (restored) await store.loadHistory(transport);
    }
    pageState.value = "ready";
    await nextTick();
    scheduleScrollToBottom();
  } catch {
    pageState.value = "error";
  } finally {
    initBusy.value = false;
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
  bindGenerationContext();
  void store.loadConversations(transport, relationshipId);
  return true;
}

/**
 * WP-D（缺口1+2）：提交路径。互斥在任何 await 之前同步置位，覆盖
 * "建会话（如需要）+ 发送"整体；返回 false 表示正被上一笔提交占用。
 * 输入框草稿与提交快照分离：只在"当前输入内容 === 提交快照"时清空；
 * 失败恢复同样绝不触碰用户后来输入的新草稿。
 */
async function sendText(text: string, sourceUserMessageId?: string): Promise<boolean> {
  if (submitInFlight || store.isStreaming || generationBusy.value) return false;
  submitInFlight = true;
  directSendError.value = false;
  if (inputText.value.trim() === text) inputText.value = "";
  // 缺陷6：提交归属锚点。建会话成功后锚点更新为提交时的会话；失败回调
  // 只在提交身份仍是当前上下文时回填输入/错误文案——用户在 await 期间
  // 切换会话后，晚到的失败响应静默丢弃，不覆盖新会话的输入与 UI。
  const anchorBeforeEnsure = store.conversationId;
  let submittedConversationId: string | null = null;
  try {
    const ready = await ensureConversation();
    if (!ready) throw new Error("conversation unavailable");
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
    const expectedConversationId = submittedConversationId ?? anchorBeforeEnsure;
    if (store.conversationId !== expectedConversationId) return false;
    if (inputText.value.trim() === "") inputText.value = text;
    directSendError.value = true;
    return true;
  } finally {
    submitInFlight = false;
  }
}

async function onSend(): Promise<void> {
  const text = inputText.value.trim();
  if (!text || store.isStreaming || generationBusy.value) return;
  await sendText(text);
}

async function onRetry(): Promise<void> {
  if (!canRetry.value) return;
  // N-05：按事实分流。已确认 generation、仅输出未确认（exhausted/断网）时，
  // 重试＝重新连接原流/快照，绝不新建 generation、不重复用户消息；
  // not_found_or_forbidden 不重连循环也不新键发送——一次有界核对，草稿保留。
  if (reconnectFailed.value || turnUnverifiable.value) {
    void store.recoverInFlight(deps, instanceToken, owningConversationId);
    return;
  }
  // N-05：发送结果未确认＝普通同键重发：不调用 resolveTurnSource、不传
  // sourceUserMessageId——原请求结局未知，复制用户消息或按旧 generation
  // 的快照重发都可能造成重复。
  if (sendUnconfirmed.value) {
    const text = directSendError.value
      ? inputText.value.trim()
      : store.pendingUserContent.trim();
    if (!text) return;
    await sendText(text);
    return;
  }
  // 该分支仅在发送结果已确认时可达（sendUnconfirmed 为 false ⇒
  // directSendError 恒为 false）：即已确认 generation 的明确终态失败重试，
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
  void store.recoverInFlight(deps, instanceToken, owningConversationId);
}

/**
 * WP-D（缺口6）：手动加载更早消息，prepend 后做阅读锚点补偿——记录插入
 * 前的 scrollTop/scrollHeight，插入渲染后按高度差补偿，视口内容不跳动。
 */
async function onLoadMore(): Promise<void> {
  store.historyLoadFailed = false;
  const node = historyNode();
  const anchor = node ? { top: node.scrollTop, height: node.scrollHeight } : null;
  try {
    await store.loadMoreHistory(transport);
  } catch {
    store.historyLoadFailed = true;
    return;
  }
  await nextTick();
  if (!anchor) return;
  const after = historyNode();
  if (after) {
    after.scrollTop = anchor.top + Math.max(0, after.scrollHeight - anchor.height);
  }
}

function startNewConversation(): void {
  if (store.isStreaming || generationBusy.value) return;
  menuOpen.value = false;
  store.reset();
  owningConversationId = ""; // VC-R04：本实例转入空会话，归属同步清空。
  bindGenerationContext();
  inputText.value = "";
  directSendError.value = false;
  store.historyLoadFailed = false;
  followingLatest.value = true;
}

const historyEl = ref<unknown>(null);
const followingLatest = ref(true);
let pendingScrollFrame = 0;

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
    node.scrollTop = node.scrollHeight;
    return;
  }
  pendingScrollFrame = requestAnimationFrame(() => {
    pendingScrollFrame = 0;
    if (historyNode() !== node || store.conversationId !== conversationId) return;
    node.scrollTop = node.scrollHeight;
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
  cancelPendingScrollFrame();
}

function onHistoryScroll(event: Event): void {
  const node = historyNode();
  if (!node || event.target !== node) return;
  const nearBottom =
    node.scrollHeight <= node.clientHeight ||
    node.scrollHeight - node.clientHeight - node.scrollTop <= RESUME_GAP_PX;
  followingLatest.value = nearBottom;
}

function onBackToLatest(): void {
  followingLatest.value = true;
  const node = historyNode();
  if (node) node.scrollTop = node.scrollHeight;
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
  if (initBusy.value || pageState.value === "loading") return;
  if (typeof location === "undefined") return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (!/^#\/pages\/chat\/chat(\?|$)/.test(location.hash)) return;
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
        void store.recoverInFlight(deps, instanceToken, owningConversationId);
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
