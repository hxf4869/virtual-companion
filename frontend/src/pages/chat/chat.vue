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

<script setup lang="ts">
import {
  computed,
  nextTick,
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

type PageState = "loading" | "ready" | "error" | "missing";
type StatusTone = "progress" | "muted" | "error";

const RESUME_GAP_PX = 48;

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

const transport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  renewAccessToken: () => auth.renewAccessToken(transport),
  onUnauthorized: () => auth.onUnauthorized(),
});
const authedFetch = createAuthedFetch(() => auth.accessToken, {
  renewAccessToken: () => auth.renewAccessToken(transport),
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
const sendErrorText = computed(() => (
  directSendError.value || store.phase === "failed"
    ? "没发出去，点此重试"
    : ""
));
const statusText = computed(() => {
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
const statusAction = computed(() => (
  store.cancelUnconfirmed && store.phase === "cancelled" ? "核对生成状态" : ""
));
const statusTone = computed<StatusTone>(() => {
  if (store.historyLoadFailed) return "error";
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
      if (!opened) {
        pageState.value = "error";
        return;
      }
    } else if (store.conversationId) {
      store.reset();
    }

    bindGenerationContext();
    if (store.conversationId) {
      const restored = await store.tryRestoreAfterReload(deps, {
        accountId: auth.accountId ?? "",
        relationshipId,
      });
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
async function sendText(text: string): Promise<boolean> {
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
    await store.send(transport, deps, text);
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

function onRetry(): void {
  if (!canRetry.value) return;
  const text = directSendError.value
    ? inputText.value.trim()
    : store.pendingUserContent.trim();
  if (!text) return;
  void sendText(text);
}

function onCancel(): void {
  void store.cancel();
}

function onStatusAction(): void {
  // WP-D（缺口3）：手动核对"已停止待确认"的生成，快照为权威。
  void store.recoverInFlight(deps);
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

onMounted(() => {
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    stopLifecycle = installStreamLifecycle({
      addEventListener: (name, handler) => window.addEventListener(name, handler),
      removeEventListener: (name, handler) => window.removeEventListener(name, handler),
      getVisibility: () => document.visibilityState,
      onRecover: () => {
        void store.recoverInFlight(deps);
      },
    });
    document.addEventListener("scroll", onHistoryScroll, { capture: true, passive: true });
    window.addEventListener("resize", onViewportChange);
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
    window.visualViewport?.removeEventListener("resize", onViewportChange);
  }
  store.detachInFlight();
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
