<template>
  <view class="chat-page">
    <view class="chat-header">
      <text>Technical Alpha · 离线聊天</text>
      <view class="chat-header-nav">
        <button
          data-testid="nav-memory"
          class="chat-nav-index"
          aria-label="记忆管理"
          @click="goTo(memoryHref())"
        >
          记忆管理
        </button>
        <button
          data-testid="nav-companion"
          class="chat-nav-index"
          aria-label="角色设置"
          @click="goTo('/pages/companion/companion')"
        >
          角色设置
        </button>
        <button
          data-testid="nav-reminder"
          class="chat-nav-index"
          aria-label="提醒管理"
          @click="goTo('/pages/reminder/reminder')"
        >
          提醒管理
        </button>
        <button
          data-testid="nav-index"
          class="chat-nav-index"
          aria-label="返回边界台"
          @click="goTo('/pages/index/index')"
        >
          返回边界台
        </button>
        <button
          data-testid="nav-login"
          class="chat-nav-index"
          aria-label="登录"
          @click="goTo('/pages/login/login')"
        >
          登录
        </button>
        <button
          v-if="auth.isAuthenticated"
          data-testid="logout"
          class="chat-nav-index logout-btn"
          aria-label="登出"
          @click="onLogout"
        >
          登出
        </button>
      </view>
    </view>

    <!-- SVC-MODE (FR-RES-005): the service mode is an ops fact, shown plainly
         and never role-played. -->
    <view
      v-if="serviceModeSummary"
      class="service-mode"
      data-testid="service-mode"
      role="status"
    >
      <text>服务状态：{{ serviceModeSummary }}</text>
    </view>

    <view
      v-if="relStore.status === 'ready'"
      class="current-relationship"
      data-testid="current-relationship"
      role="status"
    >
      <text>{{
        relStore.current
          ? `当前关系：${personaDisplayName(relStore.current.personaRef)}`
          : "还没有当前关系。"
      }}</text>
      <button
        v-if="relStore.currentRelationshipId"
        data-testid="deactivate-relationship"
        class="chat-nav-index deactivate-btn"
        :aria-busy="confirmDeactivate"
        @click="onDeactivate"
      >
        {{ confirmDeactivate ? "确认解除？" : "解除关系" }}
      </button>
    </view>
    <view
      v-else-if="relStore.status === 'error'"
      class="current-relationship"
      data-testid="relationship-load-error"
      role="status"
    >
      <text>关系列表加载失败。</text>
    </view>

    <view v-if="initError" class="chat-error" role="alert">
      <text>初始化失败，请刷新重试</text>
    </view>

    <template v-else>
      <!-- INC-MODE (FR-CHAT-005): incognito is not "no records at all" and
           the UI says so plainly while the conversation is incognito. -->
      <view
        v-if="store.activeIncognito"
        class="incognito-notice"
        data-testid="incognito-notice"
        role="status"
      >
        <text>当前为无痕会话：不会产生长期记忆候选；必要的安全与法定记录仍会保留。</text>
      </view>

      <RelationshipSelector
        v-if="!hasRelationship"
        :relationships="relStore.relationships"
        :current-id="relStore.currentRelationshipId"
        :status="relStore.status"
        :busy="relStore.status === 'loading'"
        @activate="onRelActivate"
        @create="onRelCreate"
      />

      <template v-else>
        <!-- CONV-HIST: conversation list / switch / new conversation -->
        <view class="conversation-panel" data-testid="conversation-panel">
          <scroll-view scroll-x class="conversation-list">
            <button
              v-for="conv in conversations"
              :key="conv.conversationId"
              class="conversation-item"
              :class="{ active: conv.conversationId === store.conversationId }"
              data-testid="conversation-item"
              :disabled="isStreaming"
              @click="onOpenConversation(conv.conversationId)"
            >
              {{ conversationLabel(conv) }}<text v-if="conv.incognito" class="incognito-badge">无痕</text>
            </button>
          </scroll-view>
          <button
            data-testid="new-conversation"
            class="chat-nav-index"
            :disabled="isStreaming"
            @click="onNewConversation"
          >
            新会话
          </button>
          <!-- INC-MODE: creation-time incognito toggle (chosen knowingly). -->
          <button
            data-testid="incognito-toggle"
            class="chat-nav-index conv-mgmt-btn"
            :class="{ 'incognito-toggle-on': incognitoNext }"
            :aria-pressed="incognitoNext"
            :disabled="isStreaming"
            @click="incognitoNext = !incognitoNext"
          >
            {{ incognitoNext ? "无痕：开" : "无痕：关" }}
          </button>
          <!-- CONV-MGMT: per-conversation rename + two-step delete -->
          <button
            data-testid="conversation-rename"
            class="chat-nav-index conv-mgmt-btn"
            :disabled="isStreaming || !store.conversationId"
            @click="startRename"
          >
            改名
          </button>
          <button
            data-testid="conversation-delete"
            class="chat-nav-index conv-mgmt-btn conv-delete-btn"
            :disabled="isStreaming || !store.conversationId"
            @click="onDeleteConversation"
          >
            {{ confirmDeleteId ? "确认删除？" : "删除" }}
          </button>
          <button
            data-testid="end-today"
            class="chat-nav-index conv-mgmt-btn"
            :disabled="isStreaming || !store.conversationId"
            @click="onEndToday"
          >
            {{ confirmEndToday ? "确认结束？" : "结束今天的对话" }}
          </button>
        </view>

        <!-- CONV-MGMT: inline rename row -->
        <view v-if="renaming" class="rename-row" data-testid="rename-row">
          <input
            v-model="renameInput"
            class="rename-input"
            data-testid="rename-input"
            placeholder="会话标题（留空清除）"
            aria-label="会话标题"
            :disabled="isStreaming"
          />
          <button
            data-testid="rename-apply"
            class="chat-nav-index"
            :disabled="isStreaming"
            @click="onRenameConversation"
          >
            保存
          </button>
          <button
            data-testid="rename-cancel"
            class="chat-nav-index"
            :disabled="isStreaming"
            @click="cancelRename"
          >
            取消
          </button>
        </view>

        <view class="chat-history" data-testid="history">
          <view
            v-if="showEmptyHistory"
            class="chat-empty"
            data-testid="empty-history"
            role="status"
          >
            <text>还没有消息。输入一句话开始倾听。</text>
          </view>
          <!-- VIRT-LIST: the render window bound (older loaded rows are
               dropped from the DOM with a plain notice, §18.6). -->
          <view
            v-if="truncatedCount > 0"
            class="history-truncated"
            data-testid="history-truncated"
            role="note"
          >
            <text>已隐藏更早的 {{ truncatedCount }} 条消息（性能保护，可继续加载更早）。</text>
          </view>
          <view
            v-for="msg in renderedMessages"
            :key="msg.messageId"
            class="chat-message"
            :class="msg.role"
          >
            <text class="role-tag">{{ roleLabel(msg.role) }}</text>
            <text class="msg-content">{{ msg.content }}</text>
            <!-- MSG-COPY: copy this message's text (best effort, no server
                 call; the label flips briefly as visual feedback). -->
            <button
              v-if="!msg.messageId.startsWith('__') && !isStreaming"
              class="msg-copy"
              :data-testid="`msg-copy-${msg.messageId}`"
              :aria-label="copiedMsgId === msg.messageId ? '已复制这条消息' : '复制这条消息'"
              @click="onCopyMessage(msg.messageId, msg.content)"
            >
              {{ copiedMsgId === msg.messageId ? "已复制" : "复制" }}
            </button>
            <!-- MEM-NEG (V44): 不记住 negative-memory marker, user messages
                 only (assistant text is never an extraction source). -->
            <button
              v-if="
                msg.role === 'user' &&
                !msg.messageId.startsWith('__') &&
                !isStreaming
              "
              class="msg-no-memory"
              :class="{ 'msg-no-memory--on': msg.noMemory }"
              :data-testid="`msg-no-memory-${msg.messageId}`"
              :aria-label="msg.noMemory ? '恢复这条消息的记忆提取' : '不记住这条消息'"
              @click="onToggleNoMemory(msg)"
            >
              {{ msg.noMemory ? "恢复记忆" : "不记住" }}
            </button>
            <!-- MSG-DELETE: two-step delete for persisted messages only
                 (the streaming/pending placeholders are not deletable). -->
            <button
              v-if="!msg.messageId.startsWith('__') && !isStreaming"
              class="msg-delete"
              :data-testid="`msg-delete-${msg.messageId}`"
              :aria-label="confirmDeleteMsgId === msg.messageId ? '确认删除这条消息' : '删除这条消息'"
              @click="onDeleteMessage(msg.messageId)"
            >
              {{ confirmDeleteMsgId === msg.messageId ? "确认删除" : "删除" }}
            </button>
          </view>
          <view v-if="showLoadMore" class="history-more">
            <button
              data-testid="load-more"
              class="chat-nav-index"
              :disabled="isStreaming"
              @click="onLoadMore"
            >
              加载更多
            </button>
          </view>
        </view>

        <view v-if="draft" class="chat-draft" data-testid="draft">
          <text>{{ draft }}</text>
        </view>

        <view class="chat-status" data-testid="status" role="status" aria-live="polite">
          <text>{{ statusText }}</text>
        </view>

        <!-- USAGE-VIZ: settled token usage of the last completed turn -->
        <view
          v-if="usage"
          class="chat-usage"
          data-testid="usage"
          role="status"
        >
          <text>{{ `本轮用量：输入 ${usage.inputTokens} / 输出 ${usage.outputTokens} tokens` }}</text>
        </view>

        <!-- FEEDBACK (FR-CHAT-003): one-tap feedback on the finished reply -->
        <view
          v-if="showFeedback"
          class="chat-feedback-row"
          data-testid="feedback-row"
          role="group"
          aria-label="回复反馈"
        >
          <text class="chat-feedback-label">这条回复有问题吗？</text>
          <button
            v-for="opt in FEEDBACK_OPTIONS"
            :key="opt.value"
            class="chat-feedback-chip"
            :data-testid="`feedback-${opt.value}`"
            :disabled="feedbackKinds.includes(opt.value)"
            @click="onFeedback(opt.value)"
          >
            {{ feedbackKinds.includes(opt.value) ? `已反馈：${opt.label}` : opt.label }}
          </button>
        </view>

        <!-- MEM-PROMPT: pending candidates surfaced after a completed turn -->
        <view
          v-if="pendingMemoryCount > 0"
          class="memory-prompt"
          data-testid="memory-prompt"
          role="status"
        >
          <text>{{ `有 ${pendingMemoryCount} 条新的记忆候选待确认` }}</text>
          <button
            data-testid="memory-prompt-link"
            class="chat-nav-index"
            @click="goTo(memoryHref())"
          >
            去确认
          </button>
        </view>

        <!-- CHAT-MODE: turn-level interaction mode quick switcher (AUTO keeps
             the persona default; explicit modes ride the next send). -->
        <view
          class="chat-mode-row"
          data-testid="mode-row"
          role="group"
          aria-label="选择对话模式"
        >
          <button
            v-for="opt in MODE_OPTIONS"
            :key="opt.value"
            class="chat-mode-chip"
            :class="{ 'chat-mode-chip-active': selectedMode === opt.value }"
            :data-testid="`mode-${opt.value.toLowerCase()}`"
            :aria-pressed="selectedMode === opt.value"
            :disabled="isStreaming"
            @click="onSelectMode(opt.value)"
          >
            {{ opt.label }}
          </button>
        </view>

        <view class="chat-input-area">
          <input
            v-model="inputText"
            class="chat-input"
            data-testid="message-input"
            placeholder="输入消息…"
            :disabled="isStreaming"
            @keydown.enter="onSend"
          />
          <button
            data-testid="send"
            class="chat-send"
            :disabled="isStreaming || !canSend"
            @click="onSend"
          >
            发送
          </button>
          <button
            v-if="isStreaming"
            data-testid="cancel"
            class="chat-cancel"
            :aria-busy="isStreaming"
            @click="onCancel"
          >
            取消
          </button>
          <button
            v-if="canRetry"
            data-testid="retry"
            class="chat-retry"
            @click="onRetry"
          >
            重试
          </button>
        </view>
      </template>
    </template>
  </view>
</template>

<script lang="ts">
// TASK-0026/TASK-0104/TASK-0186 H5 chat page. Presentation only; the load-bearing
// stream logic lives in the tested domain/api/stores modules. The realtime
// transport (ticket mint + resume + snapshot) is the tested realtime-transport
// module wired here via an authenticated fetch wrapper. No WebSocket, no media,
// no long-lived token in localStorage (per realtime-contract h5Security).
//
// TASK-0186: replaces the demo auto-start stream with a real send flow — the
// page creates a conversation, loads message history, and lets the user type +
// send idempotent chat turns. sessionId is a client-generated UUID
// (crypto.randomUUID) — the real source TASK-0025 deferred. The realtime
// transport now carries the Bearer token + CSRF via createAuthedFetch so ticket
// mint and stream resume authenticate against the server.
//
// TASK-0187: removes the hardcoded DEMO_RELATIONSHIP_ID. The page loads the
// owner's relationships on mount (relationship store + typed relationship API
// client) and creates the conversation under the active relationship. When no
// relationship is active, the RelationshipSelector lets the user activate or
// create one; the chat UI renders only after a relationship is selected. The
// shared authenticated transport satisfies both the relationship and chat API
// clients by structural typing.
//
// The status region carries role="status" + aria-live="polite" and the cancel
// button aria-busy while streaming, so async phase changes are announced to
// assistive technology.
import { computed, defineComponent, onMounted, onUnmounted, ref } from "vue";

import { createAuthedFetch } from "@/api/authed-fetch";
import { personaDisplayName } from "@/domain/persona";
import { createAuthenticatedTransport } from "@/api/transport";
import { createBrowserRealtimeDeps } from "@/api/realtime-transport";
import type { RealtimeDeps } from "@/api/realtime";
import { asFeedbackKind } from "@/api/chat";
import type { ConversationListItem } from "@/api/chat";
import RelationshipSelector from "@/components/RelationshipSelector.vue";
import { useAuthStore } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { useRelationshipStore } from "@/stores/relationship";

/**
 * VIRT-LIST (§18.6): the DOM renders at most this many message rows. History
 * is loaded in pages (load-more), so the bound only ever bites for long
 * conversations; older loaded rows are dropped from the DOM with a plain
 * notice instead of the precise virtual-scroller (Alpha keeps the page-level
 * scrolling model — the scroll container refactor is a beta UI concern).
 */
const MAX_RENDERED_MESSAGES = 200;

function resolveOrigin(): string {
  return typeof window !== "undefined" && window.location && window.location.origin
    ? window.location.origin
    : "http://localhost:5173";
}

export default defineComponent({
  name: "ChatPage",
  components: { RelationshipSelector },
  setup() {
    const store = useChatStore();
    const relStore = useRelationshipStore();
    const auth = useAuthStore();
    const inputText = ref("");
    const initError = ref(false);
    // REL-DEACT: two-step confirm state for the deactivate button (no modal).
    const confirmDeactivate = ref(false);
    // CONV-MGMT: two-step delete confirm + inline rename state.
    const confirmDeleteId = ref<string | null>(null);
    const confirmEndToday = ref(false);
    const renaming = ref(false);
    const renameInput = ref("");
    // MSG-DELETE: two-step confirm state for per-message deletion.
    const confirmDeleteMsgId = ref<string | null>(null);
    // MSG-COPY: the message currently shown as "已复制" (brief visual feedback).
    const copiedMsgId = ref<string | null>(null);
    let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
    // INC-MODE: creation-time incognito decision for the next new conversation.
    const incognitoNext = ref(false);
    // CHAT-MODE: approved quick-mode options; AUTO keeps the persona default,
    // LISTEN/DISCUSS override it for the next turn (FR-CHAT-002).
    const MODE_OPTIONS = [
      { value: "AUTO", label: "自动" },
      { value: "LISTEN", label: "只听我说" },
      { value: "DISCUSS", label: "一起聊聊" },
      { value: "CASUAL", label: "轻松日常" },
    ] as const;
    // FEEDBACK (FR-CHAT-003): approved feedback kinds with stable labels.
    const FEEDBACK_OPTIONS = [
      { value: "TOO_MECHANICAL", label: "太机械" },
      { value: "FORGOT_CONTEXT", label: "忘记了" },
      { value: "CROSSED_BOUNDARY", label: "越界" },
      { value: "FACTUAL_ERROR", label: "事实错误" },
      { value: "UNSAFE", label: "不安全" },
    ] as const;

    // sessionId: client-generated UUID per chat session — the real source for
    // the realtime ticket binding (mint body carries it).
    const sessionId = crypto.randomUUID();

    // One authenticated transport serves both the relationship and chat API
    // clients (identical {request → {ok,status,json}} structural shape).
    // SESS-REVIVE: a 401 first tries one silent refresh (from the HttpOnly
    // cookie) and replays the request, so a mid-session token expiry no longer
    // boots the user; a rejected refresh clears + redirects as before.
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });
    // RT-REVIVE: the realtime fetch shares the same silent-refresh session so a
    // mid-session token expiry refreshes once and replays instead of surfacing
    // "未找到或无权访问" on every ticket mint / resume / snapshot.
    const authedFetch = createAuthedFetch(() => auth.accessToken, {
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });
    const deps: RealtimeDeps = createBrowserRealtimeDeps(
      { sessionId, origin: resolveOrigin() },
      authedFetch,
    );

    const messages = computed(() => store.messages);
    // VIRT-LIST: the render window is the newest MAX_RENDERED_MESSAGES rows;
    // older rows are replaced by a plain notice (DOM-size bound for long
    // histories, §18.6 虚拟滚动 intent).
    const renderedMessages = computed(() =>
      messages.value.length > MAX_RENDERED_MESSAGES
        ? messages.value.slice(-MAX_RENDERED_MESSAGES)
        : messages.value,
    );
    const truncatedCount = computed(
      () => messages.value.length - renderedMessages.value.length,
    );
    const conversations = computed(() => store.conversations);
    const pendingMemoryCount = computed(() => store.pendingMemoryCount);
    const draft = computed(() => store.draft);
    const usage = computed(() => store.usage);
    // FEEDBACK: kinds already submitted for the current generation.
    const feedbackKinds = computed(() => store.feedbackKinds);
    // SVC-MODE: plain summary of the current service mode (null hides the line).
    const serviceModeSummary = computed(() => store.serviceMode?.summary ?? "");
    // FEEDBACK: offer feedback only when the turn produced a visible reply
    // (completed) or refused one (blocked) — never mid-stream or for pure
    // transport failures with nothing to judge.
    const showFeedback = computed(
      () => store.phase === "completed" || store.phase === "blocked",
    );
    const isStreaming = computed(() => store.isStreaming);
    const canSend = computed(() => inputText.value.trim().length > 0);
    // CHAT-MODE: mirrors the store's sticky selection for the chip highlight.
    const selectedMode = computed(() => store.selectedMode);
    const hasRelationship = computed(() => relStore.currentRelationshipId !== null);
    const showEmptyHistory = computed(
      () =>
        hasRelationship.value &&
        !isStreaming.value &&
        !draft.value &&
        messages.value.length === 0,
    );
    // CONV-HIST: manual load-more shows only when the auto-advance cap left
    // more pages behind (and there is something on screen).
    const showLoadMore = computed(
      () => store.historyHasMore && messages.value.length > 0 && !isStreaming.value,
    );

    function roleLabel(role: string): string {
      if (role === "assistant") return "AI";
      if (role === "user") return "我";
      return role;
    }

    /** CONV-HIST: short label — the rename title wins, else the preview. */
    function conversationLabel(conv: ConversationListItem): string {
      const title = (conv.title ?? "").trim();
      if (title) {
        return title.length > 16 ? `${title.slice(0, 16)}…` : title;
      }
      const preview = (conv.lastMessagePreview ?? "").trim();
      if (preview) {
        return preview.length > 16 ? `${preview.slice(0, 16)}…` : preview;
      }
      return `会话 #${conv.conversationId}`;
    }

    /**
     * FAIL-REASON: map the server's internal fault string to stable, friendly
     * copy. Unknown faults fall back to the generic wording; the raw diagnostic
     * is never rendered.
     */
    function faultText(fault: string): string {
      const map: Record<string, string> = {
        "model-providers-disabled": "模型服务未启用",
        "external-blocked_by_safety": "回复未通过安全审查",
        "external-timed-out": "模型响应超时",
        "external-failed": "模型服务失败",
        "external-no_eligible_deployment": "当前没有可用的模型部署",
        "external-dead-lettered": "模型服务多次失败，本轮已放弃",
        "reconcile-stale-in-progress": "生成中断，系统已自动回收本轮",
      };
      return map[fault] ?? "生成失败";
    }

    const statusText = computed(() => {
      switch (store.phase) {
        case "idle":
          return store.conversationId ? "等待发送消息" : "正在初始化对话…";
        case "streaming":
          if (store.stream.status === "gap") {
            return "检测到 Gap，正在经 snapshot 恢复（不补齐缺失 delta）";
          }
          if (store.stream.status === "reset_required") {
            return "Epoch 变更，正在重置并重新同步";
          }
          return "流式接收中";
        case "completed":
          return "已完成（安全终态）";
        case "cancelled":
          return "已取消";
        case "blocked":
          // TERM-SEM: server OUTPUT_BLOCKED terminal, not a transport failure.
          return "回复未通过安全审查（已阻断）";
        case "failed":
          if (store.outcome === "not_found_or_forbidden") {
            return "未找到或无权访问（存在性不披露）";
          }
          if (store.terminalFault) {
            return faultText(store.terminalFault);
          }
          return "连接中断，请重试";
        default:
          return "";
      }
    });

    /** STREAM-ECHO: one-click retry of the last failed turn (new idempotency key). */
    const canRetry = computed(
      () => store.phase === "failed" && store.pendingUserContent.trim().length > 0,
    );

    async function onRetry(): Promise<void> {
      if (!canRetry.value) return;
      const text = store.pendingUserContent;
      await store.send(transport, deps, text);
      if (store.phase === "completed") {
        await scheduleMemoryPrompt();
      }
    }

    async function onSend(): Promise<void> {
      const text = inputText.value.trim();
      if (!text || store.isStreaming) return;
      inputText.value = "";
      await store.send(transport, deps, text);
      if (store.phase === "failed" && !store.generationId) {
        inputText.value = text;
      }
      if (store.phase === "completed") {
        await scheduleMemoryPrompt();
      }
    }

    /**
     * MEM-PROMPT: the extraction worker runs asynchronously (worker poll
     * cadence ~5s), so the pending-candidate count is checked once right away
     * and once again after the extraction delay; a hit shows the confirm link.
     */
    let memoryPollTimer: ReturnType<typeof setTimeout> | null = null;

    function clearMemoryPoll(): void {
      if (memoryPollTimer) {
        clearTimeout(memoryPollTimer);
        memoryPollTimer = null;
      }
    }

    async function scheduleMemoryPrompt(): Promise<void> {
      clearMemoryPoll();
      const relationshipId = relStore.currentRelationshipId;
      if (!relationshipId) return;
      await store.refreshPendingMemoryCount(transport, relationshipId);
      memoryPollTimer = setTimeout(() => {
        void store.refreshPendingMemoryCount(transport, relationshipId);
      }, 8000);
    }

    function onCancel(): void {
      store.cancel();
    }

    /** CHAT-MODE: select a quick mode for the next turn (ignored mid-stream). */
    function onSelectMode(mode: string): void {
      if (isStreaming.value) return;
      store.setMode(mode);
    }

    /** FEEDBACK: submit one feedback kind for the finished turn. */
    async function onFeedback(kind: string): Promise<void> {
      const narrowed = asFeedbackKind(kind);
      if (!narrowed) return;
      await store.sendFeedback(transport, narrowed);
    }

    /** MSG-DELETE: two-step confirm, then delete through the store. */
    async function onDeleteMessage(messageId: string): Promise<void> {
      if (confirmDeleteMsgId.value === messageId) {
        confirmDeleteMsgId.value = null;
        await store.removeMessage(transport, messageId);
        return;
      }
      confirmDeleteMsgId.value = messageId;
    }

    /**
     * MEM-NEG (V44): flip the 不记住 marker of one user message through the
     * store (which only mutates on a confirmed server response).
     */
    async function onToggleNoMemory(msg: {
      messageId: string;
      noMemory?: boolean;
    }): Promise<void> {
      await store.setMessageNoMemory(transport, msg.messageId, !msg.noMemory);
    }

    /**
     * MSG-COPY: copy the message text to the clipboard (best effort — never
     * breaks the chat). The label flips to "已复制" for a moment as feedback;
     * the timer is cleared on unmount.
     */
    function onCopyMessage(messageId: string, content: string): void {
      const text = (content ?? "").trim();
      if (!text) return;
      try {
        const clipboard = (globalThis.navigator as
          | (Navigator & { clipboard?: { writeText(t: string): Promise<void> } })
          | undefined)?.clipboard;
        if (clipboard?.writeText) {
          void clipboard.writeText(text);
        } else {
          legacyCopy(text);
        }
        copiedMsgId.value = messageId;
        if (copyResetTimer !== undefined) {
          globalThis.clearTimeout(copyResetTimer);
        }
        copyResetTimer = globalThis.setTimeout(() => {
          copiedMsgId.value = null;
        }, 1600);
      } catch {
        // Presentation-only copy; the chat must keep working either way.
      }
    }

    /** MSG-COPY fallback for browsers without the async clipboard API. */
    function legacyCopy(text: string): void {
      const textarea = globalThis.document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      globalThis.document.body.appendChild(textarea);
      textarea.select();
      try {
        globalThis.document.execCommand("copy");
      } finally {
        globalThis.document.body.removeChild(textarea);
      }
    }

    /** SESS-REVIVE: revoke the refresh cookie server-side and go to login. */
    async function onLogout(): Promise<void> {
      await auth.logout(transport);
      goTo("/pages/login/login");
    }

    function goTo(url: string): void {
      try {
        const uniApi = (globalThis as Record<string, unknown>).uni as
          | { navigateTo?: (options: { url: string }) => void }
          | undefined;
        if (uniApi?.navigateTo) {
          uniApi.navigateTo({ url });
        } else if (typeof location !== "undefined") {
          location.href = url;
        }
      } catch {
        // Presentation-only navigation; never break send/cancel.
      }
    }

    function memoryHref(): string {
      const id = relStore.currentRelationshipId;
      if (!id) return "/pages/memory/memory";
      return `/pages/memory/memory?relationshipId=${encodeURIComponent(id)}`;
    }

    function readQueryRelationshipId(): string {
      try {
        if (typeof location === "undefined") return "";
        return (
          new URLSearchParams(String(location.search || ""))
            .get("relationshipId")
            ?.trim() ?? ""
        );
      } catch {
        return "";
      }
    }

    /**
     * Reset the chat store and create a fresh conversation under the currently
     * selected relationship. Used on mount (when no conversation exists yet)
     * and whenever the user activates/creates a relationship.
     */
    async function startConversation(): Promise<void> {
      const relationshipId = relStore.currentRelationshipId;
      if (!relationshipId) return;
      store.reset();
      try {
        // INC-MODE: the creation-time toggle decides the new conversation.
        const result = await store.initConversation(
          transport,
          relationshipId,
          incognitoNext.value,
        );
        if (result) {
          await refreshConversationList();
        }
      } catch {
        initError.value = true;
      }
    }

    /** CONV-HIST: load the first page of conversations for the active relationship. */
    async function refreshConversationList(): Promise<void> {
      const relationshipId = relStore.currentRelationshipId;
      if (!relationshipId) return;
      await store.loadConversations(transport, relationshipId);
    }

    async function onOpenConversation(id: string): Promise<void> {
      await store.openConversation(transport, id);
      // INC-MODE: the toggle mirrors the opened conversation's frozen flag.
      const opened = store.conversations.find((c) => c.conversationId === id);
      incognitoNext.value = opened?.incognito === true;
    }

    async function onNewConversation(): Promise<void> {
      confirmDeleteId.value = null;
      cancelRename();
      await startConversation();
    }

    /**
     * END-TODAY: two-step confirm, then end the open conversation. Does not
     * delete the Companion or the conversation row; a new conversation is
     * opened so the user is no longer in that turn's input/stream.
     */
    async function onEndToday(): Promise<void> {
      const id = store.conversationId;
      if (!id) return;
      if (!confirmEndToday.value) {
        confirmEndToday.value = true;
        return;
      }
      confirmEndToday.value = false;
      const ended = await store.endToday(transport, id);
      if (ended) {
        await refreshConversationList();
        await startConversation();
      }
    }

    /** CONV-MGMT: two-step delete of the open conversation. */
    async function onDeleteConversation(): Promise<void> {
      const id = store.conversationId;
      if (!id) return;
      if (confirmDeleteId.value !== id) {
        confirmDeleteId.value = id;
        return;
      }
      confirmDeleteId.value = null;
      const deleted = await store.removeConversation(transport, id);
      if (deleted && !store.conversationId) {
        // The deleted conversation was the open one: open or create a fresh one.
        await refreshConversationList();
        const latest = store.conversations[store.conversations.length - 1];
        if (latest) {
          await store.openConversation(transport, latest.conversationId);
        } else {
          await startConversation();
        }
      }
    }

    function startRename(): void {
      const id = store.conversationId;
      if (!id) return;
      const current = store.conversations.find((c) => c.conversationId === id);
      renameInput.value = current?.title ?? "";
      renaming.value = true;
    }

    function cancelRename(): void {
      renaming.value = false;
      renameInput.value = "";
    }

    async function onRenameConversation(): Promise<void> {
      const id = store.conversationId;
      if (!id) return;
      const renamed = await store.renameConversation(transport, id, renameInput.value.trim());
      if (renamed) {
        cancelRename();
      }
    }

    async function onLoadMore(): Promise<void> {
      await store.loadMoreHistory(transport);
    }

    async function onRelActivate(relationshipId: string): Promise<void> {
      const result = await relStore.activate(transport, relationshipId);
      if (result) {
        initError.value = false;
        confirmDeactivate.value = false;
        await startConversation();
      }
    }

    async function onRelCreate(personaRef: string): Promise<void> {
      const result = await relStore.create(transport, personaRef);
      if (result) {
        initError.value = false;
        confirmDeactivate.value = false;
        await startConversation();
      }
    }

    /**
     * REL-DEACT: two-step confirm, then deactivate the current relationship
     * server-side (the store reloads and clears the current selection). On
     * success the chat context is reset; the selector takes over because no
     * relationship is selected anymore.
     */
    async function onDeactivate(): Promise<void> {
      const id = relStore.currentRelationshipId;
      if (!id) return;
      if (!confirmDeactivate.value) {
        confirmDeactivate.value = true;
        return;
      }
      const result = await relStore.deactivate(transport, id);
      confirmDeactivate.value = false;
      if (result) {
        store.reset();
      }
    }

    onMounted(async () => {
      // SESS-REVIVE: restore the session from the HttpOnly refresh cookie
      // before any authenticated call, so a page reload stays logged in.
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      // SVC-MODE: surface the current service mode (non-fatal, ops fact).
      await store.loadServiceMode(transport);
      // load() catches its own failures (status="error", no throw); the
      // selector surfaces them without faking success.
      await relStore.load(transport);
      const queryId = readQueryRelationshipId();
      if (
        queryId &&
        relStore.relationships.some((rel) => rel.relationshipId === queryId)
      ) {
        relStore.currentRelationshipId = queryId;
      }
      if (relStore.currentRelationshipId) {
        // CONV-HIST: resume the newest conversation when one exists, otherwise
        // create a fresh one (the pre-CONV-HIST behavior).
        await refreshConversationList();
        const latest = store.conversations[store.conversations.length - 1];
        if (latest) {
          await store.openConversation(transport, latest.conversationId);
        } else {
          await startConversation();
        }
        // MEM-PROMPT: surface candidates from earlier turns on entry too.
        await store.refreshPendingMemoryCount(
          transport,
          relStore.currentRelationshipId,
        );
      }
    });

    onUnmounted(() => {
      clearMemoryPoll();
      store.cancel();
      store.reset();
      // MSG-COPY: never let the feedback timer fire after unmount.
      if (copyResetTimer !== undefined) {
        globalThis.clearTimeout(copyResetTimer);
      }
    });

    return {
      relStore,
      store,
      auth,
      messages,
      renderedMessages,
      truncatedCount,
      conversations,
      pendingMemoryCount,
      draft,
      usage,
      isStreaming,
      showEmptyHistory,
      showLoadMore,
      canSend,
      hasRelationship,
      inputText,
      initError,
      confirmDeactivate,
      confirmEndToday,
      onEndToday,
      confirmDeleteId,
      confirmDeleteMsgId,
      copiedMsgId,
      onCopyMessage,
      onToggleNoMemory,
      incognitoNext,
      renaming,
      renameInput,
      MODE_OPTIONS,
      selectedMode,
      onSelectMode,
      FEEDBACK_OPTIONS,
      feedbackKinds,
      showFeedback,
      onFeedback,
      onDeleteMessage,
      serviceModeSummary,
      statusText,
      canRetry,
      roleLabel,
      personaDisplayName,
      conversationLabel,
      onSend,
      onRetry,
      onCancel,
      onLogout,
      onDeactivate,
      onOpenConversation,
      onNewConversation,
      onDeleteConversation,
      startRename,
      cancelRename,
      onRenameConversation,
      onLoadMore,
      goTo,
      memoryHref,
      onRelActivate,
      onRelCreate,
    };
  },
});
</script>

<style scoped>
.chat-page {
  padding: 24rpx;
  background-color: #14213d;
  color: #f5f5f5;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  font-size: 32rpx;
  font-weight: 600;
  margin-bottom: 24rpx;
}
.chat-header-nav {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.chat-nav-index {
  flex: 0 0 auto;
  background-color: #2a3a5a;
  color: #ffffff;
  font-size: 24rpx;
  font-weight: 600;
}
.current-relationship {
  margin: -8rpx 0 24rpx;
  font-size: 24rpx;
  font-weight: 400;
  opacity: 0.78;
}
.chat-error {
  padding: 24rpx;
  background-color: #5a1a1a;
  border-radius: 12rpx;
}
.chat-history {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 24rpx;
}
.conversation-panel {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 24rpx;
}
.conversation-list {
  flex: 1;
  white-space: nowrap;
}
.conversation-item {
  flex: 0 0 auto;
  display: inline-block;
  max-width: 280rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 12rpx;
  background-color: #2a3a5a;
  color: #ffffff;
  font-size: 24rpx;
}
.conversation-item.active {
  background-color: #2a6a9a;
}
.conv-mgmt-btn {
  margin-left: 4rpx;
}
.conv-delete-btn {
  background-color: #5a1a1a;
}
.rename-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 24rpx;
}
.rename-input {
  flex: 1;
  padding: 12rpx;
  border-radius: 12rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  color: #f5f5f5;
  font-size: 26rpx;
}
.deactivate-btn {
  margin-left: 16rpx;
  background-color: #5a1a1a;
  color: #ffffff;
}
.history-more {
  display: flex;
  justify-content: center;
  padding: 12rpx 0;
}
/* VIRT-LIST: plain notice replacing older loaded rows (DOM-size bound). */
.history-truncated {
  margin: 4rpx 0 12rpx;
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  background-color: #1c2b4a;
  border: 2rpx solid #2a3a5a;
  color: #8fa0bd;
  font-size: 20rpx;
  text-align: center;
}
.chat-empty {
  padding: 24rpx;
  opacity: 0.75;
  font-size: 26rpx;
}
.chat-message {
  padding: 16rpx;
  margin-bottom: 12rpx;
  border-radius: 12rpx;
  background-color: #1c2b4a;
}
.chat-message.assistant {
  background-color: #1a3a2a;
}
.role-tag {
  font-size: 22rpx;
  opacity: 0.6;
  margin-right: 12rpx;
}
.msg-content {
  font-size: 28rpx;
}
.chat-draft {
  min-height: 80rpx;
  padding: 24rpx;
  background-color: #1c2b4a;
  border-radius: 12rpx;
  margin-bottom: 24rpx;
}
.chat-status {
  font-size: 26rpx;
  opacity: 0.85;
  margin-bottom: 24rpx;
}
.chat-usage {
  font-size: 24rpx;
  opacity: 0.7;
  margin-bottom: 24rpx;
}
.memory-prompt {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx;
  margin-bottom: 24rpx;
  background-color: #1a3a2a;
  border-radius: 12rpx;
  font-size: 26rpx;
}
.chat-input-area {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
/* CHAT-MODE: quick-mode chips above the input row. */
.chat-mode-row {
  display: flex;
  gap: 12rpx;
  margin-bottom: 12rpx;
}
.chat-mode-chip {
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  color: #b8c4d8;
  font-size: 24rpx;
}
.chat-mode-chip-active {
  background-color: #2a6a9a;
  border-color: #2a6a9a;
  color: #ffffff;
}
.chat-mode-chip[disabled] {
  opacity: 0.5;
}
/* SVC-MODE: plain service-mode status line (never role-played). */
.service-mode {
  margin: 0 24rpx 16rpx;
  padding: 12rpx 16rpx;
  border-radius: 12rpx;
  background-color: #1c2b4a;
  border: 2rpx solid #2a3a5a;
  font-size: 24rpx;
  color: #b8c4d8;
}
/* FEEDBACK: one-tap feedback chips on the finished reply. */
.chat-feedback-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10rpx;
  margin-bottom: 16rpx;
}
.chat-feedback-label {
  font-size: 24rpx;
  color: #8fa0bd;
  margin-right: 4rpx;
}
.chat-feedback-chip {
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  color: #b8c4d8;
  font-size: 22rpx;
}
.chat-feedback-chip[disabled] {
  opacity: 0.6;
  border-color: #2a6a9a;
  color: #ffffff;
}
/* MSG-DELETE: per-message two-step delete control. */
.msg-delete {
  margin-top: 8rpx;
  align-self: flex-start;
  padding: 4rpx 14rpx;
  font-size: 22rpx;
  border-radius: 999rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  color: #b8c4d8;
}
/* MSG-COPY: same pill as delete, next to it. */
.msg-copy {
  margin-top: 8rpx;
  margin-left: 8rpx;
  align-self: flex-start;
  padding: 4rpx 14rpx;
  font-size: 22rpx;
  border-radius: 999rpx;
  border: 2rpx solid #16503e;
  background-color: #16503e;
  color: #d8f2ea;
}
/* MEM-NEG (V44): 不记住 marker pill; the on state is visually distinct. */
.msg-no-memory {
  margin-top: 8rpx;
  margin-left: 8rpx;
  align-self: flex-start;
  padding: 4rpx 14rpx;
  font-size: 22rpx;
  border-radius: 999rpx;
  border: 2rpx solid #5a4a1a;
  background-color: #4a3d16;
  color: #e4b96d;
}
.msg-no-memory--on {
  border-color: #8a6a1a;
  color: #f5d78e;
}
/* INC-MODE: incognito badge, notice and toggle. */
.incognito-badge {
  margin-left: 8rpx;
  padding: 0 10rpx;
  border-radius: 999rpx;
  background-color: #5a4a1a;
  color: #f5d9a0;
  font-size: 20rpx;
}
.incognito-notice {
  margin: 0 24rpx 16rpx;
  padding: 12rpx 16rpx;
  border-radius: 12rpx;
  background-color: #3a2f12;
  border: 2rpx solid #5a4a1a;
  font-size: 24rpx;
  color: #f5d9a0;
}
.incognito-toggle-on {
  background-color: #5a4a1a;
  color: #f5d9a0;
}
.chat-input {
  flex: 1;
  padding: 16rpx;
  border-radius: 12rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  color: #f5f5f5;
  font-size: 28rpx;
}
.chat-send {
  background-color: #2a6a9a;
  color: #ffffff;
}
.chat-cancel {
  background-color: #e63946;
  color: #ffffff;
}
.logout-btn {
  background-color: #5a1a1a;
  color: #ffffff;
}
.chat-retry {
  background-color: #2a6a9a;
  color: #ffffff;
}
</style>
