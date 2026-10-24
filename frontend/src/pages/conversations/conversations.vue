<template>
  <!-- 全部会话是聊天域内的二级页，只用于找到并继续过去的对话。 -->
  <ConsumerShell route="/pages/conversations/conversations">
    <view class="conversations-page">
      <text class="conversations-page__intro">
        最近聊过的内容都在这里。
      </text>

      <view
        v-if="pageState === 'loading'"
        class="conversations-state conversations-state--loading"
        data-testid="conversations-loading"
        role="status"
      >
        <text class="vc-sr-only">正在加载全部会话</text>
        <view v-for="index in 3" :key="index" class="conversations-skeleton" aria-hidden="true">
          <view class="conversations-skeleton__title" />
          <view class="conversations-skeleton__copy" />
        </view>
      </view>

      <view
        v-else-if="pageState === 'error' || pageState === 'missing'"
        class="conversations-state conversations-state--message"
        data-testid="conversations-load-failed"
        role="alert"
      >
        <text class="conversations-state__title">
          {{ pageState === "missing" ? "你的陪伴还没准备好" : "会话没有加载出来" }}
        </text>
        <text class="conversations-state__copy">
          {{ pageState === "missing" ? "重新加载后，我们会继续为你准备。" : "检查网络后再试一次。" }}
        </text>
        <button
          class="conversations-secondary-action"
          data-testid="conversations-retry"
          :disabled="busy"
          @click="loadInitial"
        >
          重新加载
        </button>
      </view>

      <view
        v-else-if="items.length === 0"
        class="conversations-state conversations-state--empty"
        data-testid="conversations-empty"
        role="status"
      >
        <view class="conversations-empty-mark" aria-hidden="true">
          <AppIcon name="chats" :size="24" />
        </view>
        <text class="conversations-state__title">还没有对话</text>
        <text class="conversations-state__copy">
          想说什么都可以，从第一句话开始。
        </text>
        <button
          class="conversations-primary-action"
          data-testid="conversations-start-chat"
          @click="startChat"
        >
          开始第一次对话
        </button>
      </view>

      <template v-else>
        <view
          class="conversations-list"
          data-testid="conversations-list"
          role="region"
          aria-label="全部会话"
        >
          <VcSessionPreview
            v-for="item in items"
            :key="item.conversationId"
            :title="conversationTitle(item)"
            :preview="conversationPreview(item)"
            :time="conversationTime(item)"
            @open="openConversation(item)"
          />
        </view>

        <view v-if="loadMoreFailed" class="conversations-more-error" role="alert">
          <text>后面的会话暂时没有加载出来。</text>
        </view>
        <button
          v-if="hasMore"
          class="conversations-load-more"
          data-testid="conversations-load-more"
          :disabled="busy"
          @click="loadMore"
        >
          {{ loadMoreFailed ? "重新加载更多" : "加载更多" }}
        </button>
      </template>
    </view>
  </ConsumerShell>
</template>

<script setup lang="ts">
import { onActivated, onMounted, ref, watch } from "vue";

import { listConversations, type ConversationListItem } from "@/api/chat";
import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { goTo } from "@/app/navigate";
import VcSessionPreview from "@/components/home/VcSessionPreview.vue";
import AppIcon from "@/design-system/AppIcon.vue";
import { buildContextHref, readContextFromLocation } from "@/domain/context-href";
import {
  readableConversationPreview,
  readableConversationTitle,
} from "@/domain/conversation-display";
import { formatConversationActivity } from "@/domain/timestamp";
import { useAuthStore } from "@/stores/auth";
import { useRelationshipStore } from "@/stores/relationship";

type PageState = "loading" | "ready" | "error" | "missing";

const PAGE_SIZE = 20;
const auth = useAuthStore();
const relStore = useRelationshipStore();
const pageState = ref<PageState>("loading");
const relationshipId = ref("");
const items = ref<ConversationListItem[]>([]);
const hasMore = ref(false);
const loadMoreFailed = ref(false);
const busy = ref(false);
// VC-R11：本实例列表内容当前所属的账号（加载确立时同步写入，惯例同
// chat.vue 的 owningConversationId）。null 表示当前没有归属任何账号的
// 内容；KeepAlive 重新激活时以此为基准决定是否重走首屏加载。
let loadedForAccountId: string | null = null;
// VC-R11：页面私有请求代次（在途请求的收尾归属凭据）。加载流程进入时
// 递增；身份清理 watch 同步递增以作废在途请求。同账号的真实重认证
// （login/tryRefresh 推进 store 代次但 accountId 不变）不推进本代次——
// 它只区分「本页发起的哪个请求」，账号数据归属由 watch 与
// loadedForAccountId 承担，因此同账号在途请求照常落地收尾。
let loadSeq = 0;

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

// VC-R11：身份交接清理。只有「已知账号 A → 不同账号（B 或 null）」才是
// 换号/退出：清空旧账号私有内容并回到加载态，并作废在途请求。null → X
// （初次恢复、匿名后登录）不清理、不当作过期。清理绝不发请求——KeepAlive
// 隐藏缓存页不得抢跑，重载交给 onActivated。
watch(() => auth.accountId, (next, prev) => {
  if (prev === null || next === prev) return;
  loadSeq++;
  items.value = [];
  relationshipId.value = "";
  hasMore.value = false;
  loadMoreFailed.value = false;
  pageState.value = "loading";
  busy.value = false;
  loadedForAccountId = null;
});

function knownRelationshipIds(): string[] {
  return relStore.relationships.map((relationship) => relationship.relationshipId);
}

function queryRelationshipId(): string {
  try {
    if (typeof location === "undefined") return "";
    return readContextFromLocation(location).relationshipId ?? "";
  } catch {
    return "";
  }
}

function chooseRelationshipId(): string {
  const requested = queryRelationshipId();
  if (requested && knownRelationshipIds().includes(requested)) return requested;
  return relStore.currentRelationshipId ?? "";
}

function chatHref(conversationId?: string): string {
  return buildContextHref("chat", {
    relationshipId: relationshipId.value,
    conversationId,
    knownRelationshipIds: knownRelationshipIds(),
  });
}

function conversationTitle(item: ConversationListItem): string {
  const title = readableConversationTitle(item);
  return title.startsWith("未命名会话") ? "一段对话" : title;
}

function conversationPreview(item: ConversationListItem): string | null {
  const preview = readableConversationPreview(item);
  return preview === conversationTitle(item) ? null : preview;
}

function conversationTime(item: ConversationListItem): string {
  return formatConversationActivity(item.lastActivityAt ?? item.createdAt);
}

function openConversation(item: ConversationListItem): void {
  goTo(chatHref(item.conversationId));
}

function startChat(): void {
  goTo(chatHref());
}

async function loadInitial(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  pageState.value = "loading";
  loadMoreFailed.value = false;
  // VC-R11：函数进入即捕获本页私有代次；此后每次 await 之后与 finally 的
  // busy 复位一律以 mySeq === loadSeq 门控——只有更新的加载流程或身份清理
  // watch 接管时才静默丢弃，旧账号的迟到结果不得回填本页状态。
  const mySeq = ++loadSeq;
  try {
    if (!auth.isAuthenticated) await auth.tryRefresh(transport);
    if (mySeq !== loadSeq) return;
    if (!auth.isAuthenticated) {
      pageState.value = "error";
      return;
    }

    await relStore.load(transport);
    if (mySeq !== loadSeq) return;
    if (relStore.status === "error") {
      pageState.value = "error";
      return;
    }

    relationshipId.value = chooseRelationshipId();
    if (!relationshipId.value) {
      items.value = [];
      hasMore.value = false;
      pageState.value = "missing";
      loadedForAccountId = auth.accountId;
      return;
    }

    const page = await listConversations(
      transport,
      relationshipId.value,
      undefined,
      PAGE_SIZE,
    );
    if (mySeq !== loadSeq) return;
    items.value = page;
    hasMore.value = page.length === PAGE_SIZE;
    pageState.value = "ready";
    loadedForAccountId = auth.accountId;
  } catch {
    if (mySeq !== loadSeq) return;
    pageState.value = "error";
  } finally {
    if (mySeq === loadSeq) busy.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (busy.value || !hasMore.value || items.value.length === 0) return;
  const after = items.value[items.value.length - 1]?.conversationId;
  if (!after) return;

  busy.value = true;
  loadMoreFailed.value = false;
  // VC-R11：分页 append 同样以本页私有代次门控，身份清理或新流程接管后
  // 静默丢弃；同账号重认证不受影响。
  const mySeq = ++loadSeq;
  try {
    const page = await listConversations(
      transport,
      relationshipId.value,
      after,
      PAGE_SIZE,
    );
    if (mySeq !== loadSeq) return;
    items.value = [...items.value, ...page];
    hasMore.value = page.length === PAGE_SIZE;
  } catch {
    if (mySeq === loadSeq) loadMoreFailed.value = true;
  } finally {
    if (mySeq === loadSeq) busy.value = false;
  }
}

// VC-R11：KeepAlive 缓存页重新激活时，仅当已认证且当前内容不属于本账号
// 才重走首屏加载；同账号返回缓存页不重载、不重复请求。与 onMounted 首次
// 同时触发由 loadInitial 同步置位的 busy 去重（在途加载不重复发起）。
onActivated(() => {
  if (!auth.isAuthenticated) return;
  if (loadedForAccountId === auth.accountId) return;
  void loadInitial();
});

onMounted(() => {
  void loadInitial();
});
</script>

<style scoped>
.conversations-page {
  display: grid;
  gap: var(--vc-space-4);
  min-width: 0;
}

.conversations-page__intro {
  color: var(--vc-color-ink-muted);
  font-size: 14px;
  line-height: 22px;
}

.conversations-list {
  display: grid;
  min-width: 0;
}

.conversations-state {
  display: grid;
  min-width: 0;
}

.conversations-state--loading {
  gap: var(--vc-space-1);
}

.conversations-skeleton {
  display: grid;
  gap: var(--vc-space-2);
  min-height: 72px;
  align-content: center;
  border-bottom: 1px solid var(--vc-color-hairline);
}

.conversations-skeleton__title,
.conversations-skeleton__copy {
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface-soft);
}

.conversations-skeleton__title {
  width: min(58%, 200px);
  height: 14px;
}

.conversations-skeleton__copy {
  width: min(82%, 286px);
  height: 10px;
}

.conversations-state--message,
.conversations-state--empty {
  justify-items: center;
  align-content: center;
  gap: var(--vc-space-3);
  min-height: 320px;
  padding: var(--vc-space-7) var(--vc-space-4);
  text-align: center;
}

.conversations-state__title {
  color: var(--vc-color-ink);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
}

.conversations-state__copy {
  max-width: 26em;
  color: var(--vc-color-ink-muted);
  font-size: 14px;
  line-height: 22px;
}

.conversations-empty-mark {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 52px;
  height: 52px;
  margin-bottom: var(--vc-space-1);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-full);
  color: var(--vc-color-primary);
  background: var(--vc-color-surface-soft);
}

.conversations-primary-action,
.conversations-secondary-action,
.conversations-load-more {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  min-height: 48px;
  margin: var(--vc-space-2) 0 0;
  padding: 0 var(--vc-space-5);
  border-radius: var(--vc-radius-control);
  font: inherit;
  font-size: 16px;
  font-weight: 500;
}

.conversations-primary-action {
  width: min(100%, 280px);
  border: 0;
  color: var(--vc-color-surface);
  background: var(--vc-color-primary);
}

.conversations-secondary-action,
.conversations-load-more {
  justify-self: center;
  border: 1px solid var(--vc-color-primary);
  color: var(--vc-color-primary);
  background: transparent;
}

.conversations-primary-action::after,
.conversations-secondary-action::after,
.conversations-load-more::after {
  border: 0;
}

.conversations-primary-action:active {
  background: var(--vc-color-primary-pressed);
}

.conversations-secondary-action:active,
.conversations-load-more:active {
  background: var(--vc-color-surface-soft);
}

.conversations-more-error {
  color: var(--vc-color-error);
  font-size: 14px;
  line-height: 22px;
  text-align: center;
}

button:focus-visible {
  outline: 2px solid var(--vc-color-primary);
  outline-offset: 3px;
}
</style>
