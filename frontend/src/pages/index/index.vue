<template>
  <ConsumerShell route="/pages/index/index">
    <!-- 匿名：一盏还没点亮的窗。唯一主动作是登录。 -->
    <view v-if="auth.sessionStatus === 'anonymous'" class="home-hero home-hero--entry" data-testid="home-hero">
      <view class="home-hero__glow" aria-hidden="true"></view>
      <text class="home-hero__title">虚拟陪伴</text>
      <text class="home-hero__lead">
        这里是一段安静的陪伴关系：文字对话、透明可控的长期记忆。
        AI 陪伴 · 非真人。
      </text>
      <button
        class="home-hero__primary"
        data-testid="home-login"
        @click="goTo('/pages/login/login')"
      >
        登录后继续
      </button>
    </view>

    <!-- 会话未知：不编造任何状态。 -->
    <view
      v-else-if="auth.sessionStatus === 'unknown'"
      class="home-pending"
      data-testid="home-pending"
      role="status"
    >
      <text>正在确认访问条件…</text>
    </view>

    <template v-else>
      <!-- 准入未就绪：线性准入（登录 → 成年 → 同意 → 建立陪伴）。 -->
      <view
        v-if="admissionGate === 'unknown'"
        class="home-admission"
        data-testid="admission-gate"
        data-state="unknown"
        role="status"
      >
        <text>正在确认访问条件，尚未就绪。</text>
      </view>

      <view
        v-else-if="admissionGate === 'blocked' && nextStep"
        class="home-admission home-admission--blocked"
        data-testid="next-step"
        role="status"
      >
        <text class="home-admission__copy">{{ nextStep.copy }}</text>
        <button
          class="home-admission__go"
          data-testid="next-step-go"
          :aria-label="nextStep.action"
          @click="goTo(nextStepHref)"
        >
          {{ nextStep.action }}
        </button>
      </view>

      <view
        v-else-if="relStore.status === 'error'"
        class="home-load-error"
        data-testid="relationship-load-error"
        role="status"
      >
        <text>关系列表加载失败。</text>
        <button class="home-link-btn" data-testid="relationship-retry" @click="reloadRelationships">
          重试
        </button>
      </view>

      <template v-else>
        <!-- 首屏：当前陪伴 + 唯一主动作。 -->
        <view class="home-hero" data-testid="home-hero" :class="{ 'home-hero--dim': !relStore.current }">
          <view class="home-hero__glow" aria-hidden="true"></view>
          <text
            v-if="relStore.current"
            class="home-hero__companion"
            data-testid="current-relationship"
          >
            {{ homeCompanionName }}
          </text>
          <text v-else class="home-hero__companion">还没有陪伴</text>
          <text class="home-hero__lead">{{ heroLead }}</text>
          <button
            v-if="relStore.current"
            class="home-hero__primary"
            data-testid="home-continue-chat"
            @click="goTo(chatHref())"
          >
            继续聊聊
          </button>
          <button
            v-else
            class="home-hero__primary"
            data-testid="home-create-companion"
            @click="goTo('/pages/companion/companion')"
          >
            开始创建陪伴
          </button>
        </view>

        <!-- 窄摘要：最近会话 / 待确认记忆 / 提醒。与当前关系相关，不平铺功能。 -->
        <view class="home-summaries" data-testid="home-summaries">
          <view class="home-row-wrap">
            <button
              v-if="relStore.current"
              class="home-row"
              data-testid="home-row-conversations"
              :data-state="conversationChannel.state.value"
              @click="goTo(conversationsHref())"
            >
              <text class="home-row__label">会话</text>
              <text class="home-row__value" data-testid="home-latest-conversation">
                {{ conversationSummary }}
              </text>
            </button>
          </view>

          <view class="home-row-wrap">
            <button
              v-if="relStore.current"
              class="home-row"
              data-testid="home-row-memory"
              :data-state="memoryChannel.state.value"
              @click="goTo(memoryHref())"
            >
              <text class="home-row__label">待确认记忆</text>
              <text class="home-row__value" data-testid="home-pending-memory">
                {{ memorySummary }}
              </text>
            </button>
          </view>

          <view class="home-row-wrap">
            <button
              v-if="relStore.current"
              class="home-row"
              data-testid="home-row-reminder"
              :data-state="reminderChannel.state.value"
              @click="goTo(reminderHref())"
            >
              <text class="home-row__label">提醒</text>
              <text class="home-row__value" data-testid="home-next-reminder">
                {{ reminderSummary }}
              </text>
            </button>
          </view>
        </view>
      </template>
    </template>
  </ConsumerShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, type Ref } from "vue";

import type { AuthTransport } from "@/api/auth";
import { createAuthenticatedTransport } from "@/api/transport";
import { listConversations, type ConversationListItem } from "@/api/chat";
import { goTo } from "@/app/navigate";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { buildContextHref } from "@/domain/context-href";
import { readableConversationTitle } from "@/domain/conversation-display";
import { resolveAdmissionGate, type AdmissionGate } from "@/domain/nav-guard";
import { resolveNextStep, type NextStep } from "@/domain/next-step";
import { personaDisplayName } from "@/domain/persona";
import { useAgeStore } from "@/stores/age";
import { useAuthStore } from "@/stores/auth";
import { useConsentStore } from "@/stores/consent";
import { useMemoryStore } from "@/stores/memory";
import { useReminderStore } from "@/stores/reminder";
import { useRelationshipStore } from "@/stores/relationship";

const auth = useAuthStore();
const relStore = useRelationshipStore();
const age = useAgeStore();
const consent = useConsentStore();
const memoryStore = useMemoryStore();
const reminderStore = useReminderStore();
const nextStep = ref<NextStep | null>(null);
const admissionGate = ref<AdmissionGate>("unknown");
const conversations = ref<ConversationListItem[]>([]);

// 三路摘要各自的真实状态：单路失败只标记自己，成功路不受污染；
// 失败但已有一轮成功数据时显示旧值并标注"较早数据"，不冒充成功空态。
type SummaryState = "idle" | "loading" | "ready" | "stale" | "error";

interface SummaryChannel {
  state: Ref<SummaryState>;
  loadedOnce: Ref<boolean>;
}

function createChannel(): SummaryChannel {
  return { state: ref<SummaryState>("idle"), loadedOnce: ref(false) };
}

const conversationChannel = createChannel();
const memoryChannel = createChannel();
const reminderChannel = createChannel();

// SESS-REVIVE: a 401 first tries one silent refresh and replays the request.
const transport: AuthTransport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  renewAccessToken: () => auth.renewAccessToken(transport),
  onUnauthorized: () => auth.onUnauthorized(),
});

const nextStepHref = computed(() => nextStep.value?.href ?? "/pages/index/index");

const homeCompanionName = computed(() => {
  const rel = relStore.current;
  if (!rel) return "";
  const persona = personaDisplayName(rel.personaRef);
  return rel.companionName?.trim() ? `${rel.companionName} · ${persona}` : persona;
});

const heroLead = computed(() => {
  if (!relStore.current) {
    return "创建一段陪伴关系后，这里会一直为你留一盏灯。";
  }
  return conversations.value.length > 0
    ? "上次聊到的事，随时可以接着说。"
    : "第一次对话随时可以开始。";
});

// CONV-HIST：列表按 id 升序整页返回（默认页 50）。未满页即该关系全部
// 会话，可取最大 id 为最新；满页无法断言最新，退化为计数，不误称"最近"。
const CONVERSATION_PAGE_LIMIT = 50;

const STALE_SUFFIX = "（较早数据）";

function channelText(channel: SummaryChannel, readyText: string): string {
  if (channel.state.value === "loading" || channel.state.value === "idle") {
    return "正在加载…";
  }
  if (channel.state.value === "error") return "加载失败，点开可重试";
  if (channel.state.value === "stale") return `${readyText}${STALE_SUFFIX}`;
  return readyText;
}

function latestConversation(): ConversationListItem | null {
  const list = conversations.value;
  if (list.length === 0) return null;
  if (list.length >= CONVERSATION_PAGE_LIMIT) return null;
  const sorted = [...list].sort((a, b) => compareConversationId(b, a));
  return sorted[0] ?? null;
}

function compareConversationId(a: ConversationListItem, b: ConversationListItem): number {
  const na = Number(a.conversationId);
  const nb = Number(b.conversationId);
  if (Number.isSafeInteger(na) && Number.isSafeInteger(nb)) return na - nb;
  return a.conversationId.localeCompare(b.conversationId);
}

const conversationSummary = computed(() => {
  const latest = latestConversation();
  if (!latest) {
    if (conversations.value.length >= CONVERSATION_PAGE_LIMIT) {
      return channelText(conversationChannel, `${conversations.value.length}+ 个会话`);
    }
    return channelText(conversationChannel, "还没有会话");
  }
  // P1-5：enc2 密文/空值不直接展示，统一走用户可读标题 helper。
  const base =
    readableConversationTitle(latest) === "未命名会话"
      ? "未发送消息的会话"
      : readableConversationTitle(latest);
  return channelText(conversationChannel, latest.incognito ? `无痕 · ${base}` : base);
});

const memorySummary = computed(() => {
  const count = memoryStore.pendingCount;
  return channelText(
    memoryChannel,
    count > 0 ? `${count} 条记忆等你确认` : "没有待确认的记忆",
  );
});

const reminderSummary = computed(() => {
  const next = reminderStore.reminders.find((row) => row.status === "ACTIVE");
  return channelText(
    reminderChannel,
    next ? next.text : "没有待处理的提醒（不会主动推送）",
  );
});

function knownRelationshipIds(): string[] {
  return relStore.relationships.map((row) => row.relationshipId);
}

function chatHref(): string {
  return buildContextHref("chat", {
    relationshipId: relStore.currentRelationshipId,
    knownRelationshipIds: knownRelationshipIds(),
  });
}

function conversationsHref(): string {
  return buildContextHref("conversations", {
    relationshipId: relStore.currentRelationshipId,
    knownRelationshipIds: knownRelationshipIds(),
  });
}

function memoryHref(): string {
  return buildContextHref("memory", {
    relationshipId: relStore.currentRelationshipId,
    knownRelationshipIds: knownRelationshipIds(),
  });
}

function reminderHref(): string {
  return buildContextHref("reminder", {
    relationshipId: relStore.currentRelationshipId,
    knownRelationshipIds: knownRelationshipIds(),
  });
}

async function reloadRelationships(): Promise<void> {
  await relStore.load(transport);
}

async function refreshNextStep(): Promise<void> {
  if (!auth.isAuthenticated) {
    nextStep.value = null;
    admissionGate.value =
      auth.sessionStatus === "anonymous" ? "blocked" : "unknown";
    return;
  }
  await Promise.all([age.load(transport), consent.load(transport)]);
  const grantedTypes = consent.records
    .filter((row) => row.granted)
    .map((row) => row.consentType);
  admissionGate.value = resolveAdmissionGate({
    session: "authenticated",
    role: auth.role,
    ageKnown: !age.loadFailed,
    ageLoadFailed: age.loadFailed,
    ageState: age.ageState,
    consentKnown: !consent.loadFailed,
    consentLoadFailed: consent.loadFailed,
    grantedTypes,
  });
  if (admissionGate.value === "unknown") {
    nextStep.value = null;
    return;
  }
  nextStep.value = resolveNextStep({
    authenticated: true,
    ageKnown: !age.loadFailed,
    ageState: age.ageState,
    consentKnown: !consent.loadFailed,
    grantedTypes,
    hasCompanion: relStore.relationships.length > 0,
  });
}

/** 关系就绪后并行加载三份摘要；单路失败只标记该路，不拖垮其他路。 */
async function loadSummaries(): Promise<void> {
  const relId = relStore.currentRelationshipId;
  if (!relId) return;

  conversationChannel.state.value = "loading";
  memoryChannel.state.value = "loading";
  reminderChannel.state.value = "loading";

  const conversationsTask = listConversations(transport, relId, undefined, CONVERSATION_PAGE_LIMIT)
    .then((list) => {
      conversations.value = list;
      conversationChannel.state.value = "ready";
      conversationChannel.loadedOnce.value = true;
    })
    .catch(() => {
      // 失败保留旧列表，仅在曾成功过时以 stale 展示旧值。
      conversationChannel.state.value = conversationChannel.loadedOnce.value
        ? "stale"
        : "error";
    });

  // memory/reminder store 内部捕获异常并以状态位暴露，Promise 永不 reject。
  const memoryTask = memoryStore.load(transport, relId).then(() => {
    const failed = memoryStore.error === "load-failed" || memoryStore.error === "session-expired";
    if (failed) {
      memoryChannel.state.value = memoryChannel.loadedOnce.value ? "stale" : "error";
      return;
    }
    memoryChannel.state.value = "ready";
    memoryChannel.loadedOnce.value = true;
  });

  const reminderTask = reminderStore.load(transport, relId).then(() => {
    if (reminderStore.loadFailed) {
      reminderChannel.state.value = reminderChannel.loadedOnce.value ? "stale" : "error";
      return;
    }
    reminderChannel.state.value = "ready";
    reminderChannel.loadedOnce.value = true;
  });

  await Promise.all([conversationsTask, memoryTask, reminderTask]);
}

onMounted(async () => {
  // SESS-REVIVE: restore the session from the HttpOnly refresh cookie first.
  if (!auth.isAuthenticated) {
    await auth.tryRefresh(transport);
  }
  await relStore.load(transport);
  await refreshNextStep();
  if (auth.isAuthenticated && admissionGate.value !== "unknown") {
    await loadSummaries();
  }
});

// 组件测试需要驱动第二轮加载以验证 stale 语义（保留旧数据 + 失败标注）。
defineExpose({ loadSummaries });
</script>

<style scoped>
/* 首屏：亮着的窗。暖光从右上角落进纸面，其余层级安静退后。 */
.home-hero {
  position: relative;
  display: grid;
  gap: var(--vc-space-3);
  overflow: hidden;
  padding: var(--vc-space-6);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-l);
  background: var(--vc-card);
}

.home-hero__glow {
  position: absolute;
  top: -40%;
  right: -18%;
  width: 78%;
  height: 110%;
  pointer-events: none;
  background: radial-gradient(
    closest-side,
    rgba(232, 180, 92, 0.34),
    rgba(232, 180, 92, 0) 78%
  );
}

.home-hero--entry .home-hero__glow {
  opacity: 0.5;
}

.home-hero--dim .home-hero__glow {
  opacity: 0.4;
}

.home-hero__companion {
  position: relative;
  font-size: var(--vc-text-2xl);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--vc-ink);
  overflow-wrap: anywhere;
}

.home-hero__lead {
  position: relative;
  max-width: 34em;
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  line-height: 1.7;
}

.home-hero__primary {
  position: relative;
  justify-self: start;
  min-height: 52px;
  margin: var(--vc-space-2) 0 0;
  padding: 0 var(--vc-space-7);
  border: 0;
  border-radius: var(--vc-radius-m);
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font: inherit;
  font-size: var(--vc-text-lg);
  font-weight: 650;
  transition: background-color var(--vc-motion-fast) var(--vc-ease-out),
    transform var(--vc-motion-fast) var(--vc-ease-out);
}

.home-hero__primary::after {
  border: 0;
}

.home-hero__primary:not([disabled]):active {
  background: var(--vc-primary-hover);
  transform: translateY(1px);
}

.home-hero--entry {
  margin-top: var(--vc-space-7);
  text-align: left;
}

.home-pending,
.home-admission {
  display: flex;
  align-items: center;
  gap: var(--vc-space-3);
  padding: var(--vc-space-4);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
  border: 1px solid var(--vc-border);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.home-admission--blocked {
  flex-wrap: wrap;
  justify-content: space-between;
  color: var(--vc-ink);
}

.home-admission__copy {
  flex: 1 1 16em;
  min-width: 0;
}

.home-admission__go {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-5);
  border: 0;
  border-radius: var(--vc-radius-s);
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 650;
}

.home-admission__go::after {
  border: 0;
}

.home-load-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-3);
  padding: var(--vc-space-4);
  border-radius: var(--vc-radius-m);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
}

.home-link-btn {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--vc-text-sm);
}

.home-link-btn::after {
  border: 0;
}

/* 摘要行：窄行，不是卡片网格；行内左侧类别、右侧状态。 */
.home-summaries {
  display: grid;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-5);
}

.home-row-wrap {
  display: grid;
}

.home-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--vc-space-3);
  min-height: 56px;
  margin: 0;
  padding: var(--vc-space-2) var(--vc-space-4);
  border: 0;
  border-bottom: 1px solid var(--vc-border);
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
  text-align: left;
}

.home-row::after {
  border: 0;
}

.home-row__label {
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  white-space: nowrap;
}

.home-row__value {
  min-width: 0;
  overflow: hidden;
  font-size: var(--vc-text-sm);
  font-weight: 600;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-row .home-row__value {
  grid-column: 3;
}

.home-row:focus-visible {
  outline-offset: -2px;
}

/* LANDSCAPE / 短视口：压缩首屏信息优先级——伴侣名与主动作保留，
   摘要行收窄，保证四入口底栏之上能看到完整主动作与至少一行摘要。 */
@media (max-height: 480px) {
  .home-hero {
    gap: var(--vc-space-2);
    padding: var(--vc-space-4);
  }

  .home-hero__companion {
    font-size: var(--vc-text-xl);
  }

  .home-hero__lead {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    overflow: hidden;
  }

  .home-hero__primary {
    min-height: 44px;
    margin-top: var(--vc-space-1);
  }

  .home-hero--entry {
    margin-top: var(--vc-space-4);
  }

  .home-summaries {
    gap: var(--vc-space-1);
    margin-top: var(--vc-space-3);
  }

  .home-row {
    min-height: 44px;
    padding: var(--vc-space-1) var(--vc-space-3);
  }
}
</style>
