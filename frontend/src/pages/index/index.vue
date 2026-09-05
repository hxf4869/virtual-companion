<template>
  <!-- Direction contract: Warm Familiarity + Stitch 58a3b21f. The home page
       exists to resume a real conversation, not to expose product internals. -->
  <ConsumerShell route="/pages/index/index" :show-header="false">
    <view class="home-page">
      <view class="home-topbar" role="banner">
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
          @click="loadHome"
        >
          重新加载
        </button>
      </view>

      <template v-else-if="relStore.current">
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
import { computed, onMounted, ref } from "vue";

import type { AuthTransport } from "@/api/auth";
import { listConversations, type ConversationListItem } from "@/api/chat";
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

const auth = useAuthStore();
const relStore = useRelationshipStore();
const homeState = ref<HomeState>("loading");
const conversations = ref<ConversationListItem[]>([]);
const busy = ref(false);

const transport: AuthTransport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  onUnauthorized: () => auth.clear(),
});

const companionName = computed(() => (
  relStore.current ? companionHeaderName(relStore.current) : ""
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
  return relStore.relationships.map((relationship) => relationship.relationshipId);
}

function chatHref(conversationId?: string): string {
  return buildContextHref("chat", {
    relationshipId: relStore.currentRelationshipId,
    conversationId,
    knownRelationshipIds: knownRelationshipIds(),
  });
}

function conversationsHref(): string {
  return buildContextHref("conversations", {
    relationshipId: relStore.currentRelationshipId,
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

async function loadHome(): Promise<void> {
  if (!auth.isAuthenticated || busy.value) return;
  busy.value = true;
  homeState.value = "loading";
  try {
    await relStore.load(transport);
    if (relStore.status === "error") {
      homeState.value = "error";
      return;
    }
    if (!relStore.currentRelationshipId) {
      homeState.value = "missing";
      return;
    }
    conversations.value = await listConversations(
      transport,
      relStore.currentRelationshipId,
      undefined,
      3,
    );
    homeState.value = "ready";
  } catch {
    homeState.value = "error";
  } finally {
    busy.value = false;
  }
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
