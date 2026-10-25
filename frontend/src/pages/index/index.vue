<template>
  <!-- Direction contract: Warm Familiarity + Stitch 58a3b21f. The home page
       exists to resume a real conversation, not to expose product internals. -->
  <ConsumerShell route="/pages/index/index" :show-header="false">
    <view class="home-page">
      <!-- No banner role here: the shell already owns top-level landmarks and
           a nested banner is an axe landmark-banner-is-top-level violation. -->
      <view class="home-topbar">
        <text class="home-topbar__greeting">
          {{ auth.sessionStatus === "authenticated" ? "回来啦" : "虚拟陪伴" }}
        </text>
        <view class="home-brand" aria-label="虚拟陪伴">
          <view class="home-brand__ring" aria-hidden="true">
            <view class="home-brand__dot" />
          </view>
        </view>
      </view>

      <view
        v-if="auth.sessionStatus === 'unknown'"
        class="home-status home-status--loading"
        data-testid="home-pending"
        :data-state="auth.error === 'refresh-failed' ? 'error' : 'loading'"
        :role="auth.error === 'refresh-failed' ? 'alert' : 'status'"
      >
        <template v-if="auth.error === 'refresh-failed'">
          <text class="home-status__title" role="heading" aria-level="1">
            暂时没能打开首页
          </text>
          <text class="home-status__copy">检查网络后再试一次。</text>
          <button
            class="home-secondary-action"
            data-testid="session-retry"
            :disabled="busy"
            @click="restoreSessionAndHome"
          >
            重新加载
          </button>
        </template>
        <template v-else>
          <text class="vc-sr-only" role="heading" aria-level="1">首页</text>
          <view class="home-skeleton__avatar" aria-hidden="true" />
          <view class="home-skeleton__line home-skeleton__line--short" aria-hidden="true" />
          <view class="home-skeleton__line" aria-hidden="true" />
          <text class="vc-sr-only">正在打开首页</text>
        </template>
      </view>

      <view
        v-else-if="auth.sessionStatus === 'anonymous'"
        class="home-public"
        data-testid="home-hero"
      >
        <text class="home-public__title" role="heading" aria-level="1">
          有些话，可以慢慢说
        </text>
        <text class="home-public__copy">
          登录后继续与同一个 AI 陪伴者对话。AI 陪伴者 · 非真人。
        </text>
        <button
          class="home-primary-action"
          data-testid="home-login"
          @click="goTo('/pages/login/login')"
        >
          登录后继续
        </button>
      </view>

      <view
        v-else-if="homeState === 'loading'"
        class="home-status home-status--loading"
        data-testid="home-loading"
        role="status"
      >
        <text class="vc-sr-only" role="heading" aria-level="1">首页</text>
        <view class="home-skeleton__avatar" aria-hidden="true" />
        <view class="home-skeleton__line home-skeleton__line--short" aria-hidden="true" />
        <view class="home-skeleton__line" aria-hidden="true" />
        <text class="vc-sr-only">正在加载最近对话</text>
      </view>

      <view
        v-else-if="homeState === 'error' || homeState === 'missing'"
        class="home-status home-status--error"
        data-testid="home-load-error"
        role="alert"
      >
        <text class="home-status__title" role="heading" aria-level="1">
          {{ homeState === "missing" ? "你的陪伴还没准备好" : "最近对话没有加载出来" }}
        </text>
        <text class="home-status__copy">
          {{ homeState === "missing" ? "请重新加载，我们会继续为你准备。" : "已经登录，可以直接重试。" }}
        </text>
        <button
          class="home-secondary-action"
          data-testid="home-retry"
          :disabled="busy"
          @click="loadHome()"
        >
          重新加载
        </button>
      </view>

      <template v-else-if="displayRelationship">
        <!-- VC-R203：等待/失败/成功共用同一反馈区与同一按钮节点，键盘焦点才能
             留在原位。等待期间不用原生 disabled（会把焦点掉到 body），用
             aria-disabled 表意，重复请求由 loadHome 的 busy 门控挡住。 -->
        <view
          v-if="refreshNotice"
          class="home-refresh-notice"
          role="status"
          data-testid="home-refresh-notice"
          :data-state="refreshNotice"
        >
          <view class="home-refresh-notice__copy">
            <text class="home-refresh-notice__title">{{ refreshNoticeCopy.title }}</text>
            <text class="home-refresh-notice__text">{{ refreshNoticeCopy.text }}</text>
          </view>
          <button
            class="home-refresh-notice__retry"
            type="button"
            data-testid="home-refresh-retry"
            :aria-disabled="refreshNotice === 'pending'"
            @click="loadHome(true)"
          >
            {{ refreshNotice === "success" ? "再次刷新" : "重试" }}
          </button>
        </view>
        <VcHomeHero
          :companion-name="companionName"
          :conversation-copy="heroConversationCopy"
          :activity-time="latestActivityTime"
          :has-conversation="Boolean(latestConversation)"
          @primary="openPrimaryConversation"
        />

        <view
          v-if="conversations.length > 0"
          class="home-recent"
          role="region"
          aria-labelledby="recent-title"
        >
          <view class="home-section-heading">
            <text id="recent-title" class="home-section-heading__title">最近对话</text>
            <button
              class="home-section-heading__action"
              type="button"
              data-testid="home-view-all"
              @click="goTo(conversationsHref())"
            >
              查看全部
            </button>
          </view>

          <view class="home-session-list" data-testid="home-recent-conversations">
            <VcSessionPreview
              v-for="conversation in conversations"
              :key="conversation.conversationId"
              :title="conversationTitle(conversation)"
              :preview="conversationPreview(conversation)"
              :time="conversationTime(conversation)"
              @open="openConversation(conversation)"
            />
          </view>
        </view>
      </template>
    </view>
  </ConsumerShell>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from "vue";

import type { AuthTransport } from "@/api/auth";
import { listConversations, type ConversationListItem } from "@/api/chat";
import type { Relationship } from "@/api/relationship";
import { createAuthenticatedTransport } from "@/api/transport";
import { goTo } from "@/app/navigate";
import ConsumerShell from "@/app/ConsumerShell.vue";
import VcHomeHero from "@/components/home/VcHomeHero.vue";
import VcSessionPreview from "@/components/home/VcSessionPreview.vue";
import { buildContextHref } from "@/domain/context-href";
import { companionHeaderName } from "@/domain/companion-presentation";
import {
  readableConversationPreview,
  readableConversationTitle,
} from "@/domain/conversation-display";
import { formatConversationActivity } from "@/domain/timestamp";
import { useAuthStore } from "@/stores/auth";
import { useRelationshipStore } from "@/stores/relationship";

type HomeState = "loading" | "ready" | "error" | "missing";

// VC-R203：缓存内容仍在展示时的内嵌刷新反馈阶段文案；null 为无反馈。
// 普通初载与自动返回刷新沿用 R202：等待与成功都不挂反馈，失败才挂；
// 只有用户在反馈区主动点击重试/再次刷新才经历 pending → failed | success，
// 成功反馈保留到下一次页面激活的自动刷新把它收回。
const REFRESH_NOTICE_COPY = {
  pending: { title: "正在刷新", text: "正在获取最新的对话内容。" },
  failed: { title: "刚才没有刷新成功", text: "显示的是上次加载的内容。" },
  success: { title: "已更新", text: "现在显示的是最新的对话内容。" },
} as const;
type RefreshNotice = keyof typeof REFRESH_NOTICE_COPY;

// VC-R202：上次成功加载时由服务端确认的关系上下文（仅本页内存，不回写
// relationship store）。返回刷新失败会把全局 store 清空，这里保住展示与
// 导航所需的最小上下文：陪伴本身 + 当时已知的全部关系 id（深链校验用）。
interface HomeRelationshipContext {
  relationship: Relationship;
  knownRelationshipIds: string[];
}

const auth = useAuthStore();
const relStore = useRelationshipStore();
const homeState = ref<HomeState>("loading");
const conversations = ref<ConversationListItem[]>([]);
const busy = ref(false);
const refreshNotice = ref<RefreshNotice | null>(null);
const refreshNoticeCopy = computed(() => (
  refreshNotice.value ? REFRESH_NOTICE_COPY[refreshNotice.value] : { title: "", text: "" }
));
const cachedContext = ref<HomeRelationshipContext | null>(null);
// VC-R11：页面私有请求代次。不用 auth 的会话代次做写入门控——同账号的
// 重新登录/续期也会推进它，会把合法的在途加载判过期并永久挂住 busy。
// 这里只在「发起新加载」与「换号清理」时递增。
let loadSeq = 0;

const transport: AuthTransport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  getAccountId: () => auth.accountId,
      getSessionId: () => auth.getSessionId(),
  getSessionRevision: () => auth.getSessionRevision(),
  onUnauthorized: () => auth.clear(),
  // VC-R52 期望账号失配恢复：先作废旧本地归属再读当前 Cookie 身份，
  // 不自动重放动作（共享入口见 stores/auth.ts reconcileAccountContext）。
  onAccountContextChanged: () => {
    void auth.reconcileAccountContext(transport);
  },
});

// 展示与导航用关系：优先全局 store 的最新确认值；读取失败被清空时退回
// 本页缓存的上次已验证关系，链接仍按本账号拥有的关系构建。
const displayRelationship = computed<Relationship | null>(() => (
  relStore.current ?? cachedContext.value?.relationship ?? null
));

const companionName = computed(() => (
  displayRelationship.value ? companionHeaderName(displayRelationship.value) : ""
));
const latestConversation = computed(() => conversations.value[0] ?? null);
const heroConversationCopy = computed(() => {
  const latest = latestConversation.value;
  if (!latest) return "想说什么都可以，我们从这里开始。";
  const preview = readableConversationPreview(latest) ?? readableConversationTitle(latest);
  return `上次我们聊到：${preview}`;
});
const latestActivityTime = computed(() => (
  latestConversation.value ? conversationTime(latestConversation.value) : ""
));

function knownRelationshipIds(): string[] {
  if (relStore.current) {
    return relStore.relationships.map((relationship) => relationship.relationshipId);
  }
  return cachedContext.value?.knownRelationshipIds ?? [];
}

function chatHref(conversationId?: string): string {
  return buildContextHref("chat", {
    relationshipId: displayRelationship.value?.relationshipId ?? null,
    conversationId,
    knownRelationshipIds: knownRelationshipIds(),
  });
}

function conversationsHref(): string {
  return buildContextHref("conversations", {
    relationshipId: displayRelationship.value?.relationshipId ?? null,
    knownRelationshipIds: knownRelationshipIds(),
  });
}

function conversationTitle(conversation: ConversationListItem): string {
  const title = readableConversationTitle(conversation);
  return title === "未命名会话" ? "一段还没开始的对话" : title;
}

function conversationPreview(conversation: ConversationListItem): string | null {
  const preview = readableConversationPreview(conversation);
  return preview === conversationTitle(conversation) ? null : preview;
}

function conversationTime(conversation: ConversationListItem): string {
  return formatConversationActivity(conversation.lastActivityAt ?? conversation.createdAt);
}

function openPrimaryConversation(): void {
  goTo(chatHref(latestConversation.value?.conversationId));
}

function openConversation(conversation: ConversationListItem): void {
  goTo(chatHref(conversation.conversationId));
}

// VC-R11：换号身份交接。KeepAlive 缓存的隐藏首页不得保留旧账号的私有预览，
// 也不得被旧账号的在途请求回填。仅在「已知账号 → 不同账号/退出」时清理；
// null→X（初次恢复、匿名后登录）时本地状态本就是初始值，不清理、不当作过期。
// 清理只重置本地状态并作废在途请求（loadSeq++），绝不发起新请求——隐藏
// 缓存页不抢跑新账号的读取。
watch(() => auth.accountId, (next, prev) => {
  if (prev === null || next === prev) return;
  conversations.value = [];
  cachedContext.value = null;
  refreshNotice.value = null;
  homeState.value = "loading";
  busy.value = false;
  loadSeq++;
});

async function loadHome(manual = false): Promise<void> {
  if (!auth.isAuthenticated || busy.value) return;
  busy.value = true;
  // VC-R202：已有成功首页时，返回刷新不撤下内容：等待与失败期间上次内容
  // 保持可见可操作，失败只挂内嵌反馈；无缓存的首次加载才走整页骨架。
  // VC-R203：manual 表示用户在反馈区主动点击重试/再次刷新——等待期间
  // 反馈区切到“正在刷新”而不卸载，成功后显示“已更新”；自动刷新不提示。
  if (cachedContext.value) {
    refreshNotice.value = manual ? "pending" : null;
  } else {
    homeState.value = "loading";
    refreshNotice.value = null;
  }
  // VC-R11：本次加载的请求代次。每次 await 之后与 finally 的收尾都以
  // mySeq === loadSeq 为门控：换号清理或更新的加载已接管时静默丢弃
  // （不回填旧账号内容，也不动新请求的 busy）；同账号重新登录不递增
  // 代次，旧请求正常落地并收尾，不会把页面永久挂在加载态。
  const mySeq = ++loadSeq;
  const isStale = () => mySeq !== loadSeq;
  try {
    await relStore.load(transport);
    if (isStale()) return;
    if (relStore.status === "error") {
      // 关系读取失败只清空了全局 store；本页按缓存的上次已验证关系继续
      // 展示与导航，不落入空关系。
      if (cachedContext.value) refreshNotice.value = "failed";
      else homeState.value = "error";
      return;
    }
    const currentRelationship = relStore.current;
    if (!currentRelationship) {
      // 服务端确认默认陪伴缺失：旧关系缓存随之作废，走缺失分支。
      cachedContext.value = null;
      homeState.value = "missing";
      return;
    }
    if (
      cachedContext.value &&
      cachedContext.value.relationship.relationshipId !== currentRelationship.relationshipId
    ) {
      // 服务端确认默认陪伴已变化：旧关系的内容不挂到新陪伴名下，缓存
      // 作废，按新关系整页加载（新关系读取失败即整页错误）。
      cachedContext.value = null;
      homeState.value = "loading";
    }
    const knownIds = relStore.relationships.map((row) => row.relationshipId);
    const rows = await listConversations(
      transport,
      currentRelationship.relationshipId,
      undefined,
      3,
    );
    if (isStale()) return;
    conversations.value = rows;
    cachedContext.value = {
      relationship: currentRelationship,
      knownRelationshipIds: knownIds,
    };
    homeState.value = "ready";
    refreshNotice.value = manual ? "success" : null;
  } catch {
    if (!isStale()) {
      if (cachedContext.value) refreshNotice.value = "failed";
      else homeState.value = "error";
    }
  } finally {
    if (!isStale()) busy.value = false;
  }
}

// VC-R202 追加：返回首页时与全局 store 的已确认上下文对账。其他页面（如
// 会话列表）可能已用同一 store 确认默认陪伴变化或缺失；旧缓存属于上一个
// 关系上下文，必须在等待下一次请求前失效并进入新上下文整页加载/缺失，
// 不让新陪伴名配旧关系的会话或链接。status 不是 ready（loading/error/
// idle）时结果未知，不动已成功缓存。
function reconcileConfirmedContext(): boolean {
  if (relStore.status !== "ready" || !cachedContext.value) return false;
  const currentId = relStore.currentRelationshipId;
  if (currentId === cachedContext.value.relationship.relationshipId) return false;
  conversations.value = [];
  cachedContext.value = null;
  refreshNotice.value = null;
  homeState.value = currentId ? "loading" : "missing";
  return true;
}

async function restoreSessionAndHome(): Promise<void> {
  if (busy.value) return;
  if (!auth.isAuthenticated) {
    busy.value = true;
    await auth.tryRefresh(transport);
    busy.value = false;
  }
  if (auth.isAuthenticated) await loadHome();
}

onMounted(() => {
  void restoreSessionAndHome();
});

// 返回缓存首页时更新最近对话；首次挂载与在途加载由 busy 去重。
onActivated(() => {
  if (!auth.isAuthenticated) return;
  // VC-R202 追加：其他页面已确认默认关系变化/缺失时，旧上下文（含仍在途
  // 的旧刷新请求）立即失效：递增代次作废旧请求（迟到响应按既有 loadSeq
  // 语义静默丢弃），再按新上下文重新加载。
  if (reconcileConfirmedContext()) {
    loadSeq++;
    busy.value = false;
  }
  if (busy.value) return;
  void loadHome();
});
</script>

<style scoped>
.home-page {
  display: grid;
  gap: var(--vc-space-5);
  min-width: 0;
}

.home-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  min-height: 36px;
}

.home-topbar__greeting {
  color: var(--vc-color-ink-muted);
  font-size: 14px;
  line-height: 22px;
}

.home-brand {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
}

.home-brand__ring {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 30px;
  height: 30px;
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface);
}

.home-brand__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-primary);
  box-shadow: var(--vc-shadow-brand-mark);
}

.home-public,
.home-status {
  display: grid;
  justify-items: start;
  gap: var(--vc-space-4);
  box-sizing: border-box;
  min-width: 0;
  padding: var(--vc-space-7) var(--vc-space-5);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-hero);
  background: var(--vc-color-surface);
}

.home-public__title,
.home-status__title {
  color: var(--vc-color-ink);
  font-size: 28px;
  font-weight: 600;
  line-height: 36px;
}

.home-public__copy,
.home-status__copy {
  max-width: 30em;
  color: var(--vc-color-ink-muted);
  font-size: 16px;
  line-height: 26px;
}

.home-primary-action,
.home-secondary-action {
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

.home-primary-action {
  width: 100%;
  border: 0;
  color: var(--vc-color-surface);
  background: var(--vc-color-primary);
}

.home-secondary-action {
  border: 1px solid var(--vc-color-primary);
  color: var(--vc-color-primary);
  background: transparent;
}

.home-primary-action::after,
.home-secondary-action::after,
.home-section-heading__action::after {
  border: 0;
}

.home-primary-action:active {
  background: var(--vc-color-primary-pressed);
}

.home-secondary-action:active,
.home-section-heading__action:active {
  background: var(--vc-color-surface-soft);
}

.home-status--loading {
  justify-items: center;
  min-height: 280px;
  align-content: center;
}

.home-status--error {
  align-content: center;
  min-height: 260px;
}

.home-skeleton__avatar,
.home-skeleton__line {
  background: var(--vc-color-surface-soft);
}

.home-skeleton__avatar {
  width: 56px;
  height: 56px;
  border-radius: var(--vc-radius-full);
}

.home-skeleton__line {
  width: min(100%, 260px);
  height: 14px;
  border-radius: var(--vc-radius-full);
}

.home-skeleton__line--short {
  width: 112px;
}

.home-recent {
  min-width: 0;
}

.home-refresh-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-4);
  box-sizing: border-box;
  min-width: 0;
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface-soft);
}

.home-refresh-notice__copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.home-refresh-notice__title {
  color: var(--vc-color-ink);
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}

.home-refresh-notice__text {
  color: var(--vc-color-ink-muted);
  font-size: 12px;
  line-height: 18px;
}

.home-refresh-notice__retry {
  flex-shrink: 0;
  min-height: 36px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-color-primary);
  border-radius: var(--vc-radius-control);
  color: var(--vc-color-primary);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 20px;
}

.home-refresh-notice__retry::after {
  border: 0;
}

.home-refresh-notice__retry:active {
  background: var(--vc-color-surface);
}

.home-refresh-notice__retry[aria-disabled="true"] {
  opacity: 0.6;
}

.home-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-4);
  min-height: 44px;
}

.home-section-heading__title {
  color: var(--vc-color-ink);
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}

.home-section-heading__action {
  min-width: 72px;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 0;
  border-radius: var(--vc-radius-control);
  color: var(--vc-color-secondary);
  background: transparent;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
}

.home-session-list {
  display: grid;
  min-width: 0;
}

@media (max-width: 359px) {
  .home-page {
    gap: var(--vc-space-4);
  }

  .home-public,
  .home-status {
    padding: var(--vc-space-6) var(--vc-space-4);
  }
}
</style>
