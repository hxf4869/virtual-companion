<template>
  <!-- DOGFOOD-09：页面容器声明 main landmark。沉浸式对话详情：无四入口
       底栏，自带头部（返回 + 当前陪伴 + AI 标识 + 上下文菜单）。 -->
  <view class="chat-page">
    <header class="chat-header vc-chrome" role="banner">
      <button
        type="button"
        class="chat-header__back vc-tap"
        data-testid="nav-conversations"
        aria-label="返回对话列表"
        @click="goTo(conversationsHref())"
      >
        <AppIcon name="back" :size="20" />
      </button>

      <view class="chat-header__identity">
        <text class="vc-sr-only" role="heading" aria-level="1">对话</text>
        <view v-if="relStore.current" class="chat-header-companion">
          <text
            class="chat-companion-avatar"
            :class="`chat-companion-avatar--${headerAvatar.theme}`"
            data-testid="chat-companion-avatar"
            :aria-label="headerAvatar.name"
          >
            {{ headerAvatar.glyph }}
          </text>
          <text class="chat-companion-name" data-testid="chat-companion-name">
            {{ headerCompanionName }}
          </text>
        </view>
        <text v-else class="chat-companion-name">对话</text>
        <text
          v-if="headerConversationTitle"
          class="chat-conversation-title"
          data-testid="chat-conversation-title"
        >
          {{ headerConversationTitle }}
        </text>
        <text class="chat-ai-label" data-testid="chat-ai-label">AI 陪伴 · 非真人</text>
      </view>

      <button
        type="button"
        class="chat-header__more vc-tap"
        data-testid="chat-context-open"
        aria-label="打开更多操作"
        :aria-expanded="contextSheetOpen ? 'true' : 'false'"
        @click="contextSheetOpen = true"
      >
        <AppIcon name="more" :size="20" />
      </button>
    </header>

    <AppSheet
      :open="contextSheetOpen"
      title="更多操作"
      @close="contextSheetOpen = false"
    >
      <view class="chat-sheet-list" role="menu">
        <button
          data-testid="nav-memory"
          class="chat-sheet-item"
          role="menuitem"
          aria-label="记忆管理"
          @click="contextSheetOpen = false; goTo(memoryHref())"
        >
          记忆管理
        </button>
        <button
          data-testid="nav-companion"
          class="chat-sheet-item"
          role="menuitem"
          aria-label="角色设置"
          @click="contextSheetOpen = false; goTo(companionHref())"
        >
          角色设置
        </button>
        <button
          data-testid="nav-reminder"
          class="chat-sheet-item"
          role="menuitem"
          aria-label="提醒管理"
          @click="contextSheetOpen = false; goTo(reminderHref())"
        >
          提醒管理
        </button>
        <button
          data-testid="nav-index"
          class="chat-sheet-item"
          role="menuitem"
          aria-label="返回首页"
          @click="contextSheetOpen = false; goTo('/pages/index/index')"
        >
          返回首页
        </button>
        <button
          v-if="!auth.isAuthenticated"
          data-testid="nav-login"
          class="chat-sheet-item"
          role="menuitem"
          aria-label="登录"
          @click="contextSheetOpen = false; goTo('/pages/login/login')"
        >
          登录
        </button>
        <button
          v-if="auth.isAuthenticated"
          data-testid="logout"
          class="chat-sheet-item chat-sheet-item--danger"
          role="menuitem"
          aria-label="登出"
          @click="contextSheetOpen = false; onLogout()"
        >
          登出
        </button>
      </view>
    </AppSheet>

    <view class="chat-main" role="main">
    <view v-if="initError" class="chat-error" data-testid="chat-init-error" role="alert">
      <text>初始化失败，请刷新重试</text>
      <text v-if="initRequestId">{{ initRequestId }}</text>
    </view>

    <template v-else>
      <template v-if="!hasRelationship">
        <!-- P1-A（round3）：无关系分支同样只有这一个滚动容器（chat-setup），
             与有关系分支的 chat-history 互斥——任何渲染路径下纵向滚动
             ownership 都是唯一的。 -->
        <view class="chat-setup">
        <!-- P1（round4）：无关系分支同样把条件系统行放进自己的滚动内容，
             避免横屏下多行提示压扁滚动区。 -->
        <ChatContextHead
          :service-mode-summary="serviceModeSummary"
          :reminder-due="usageHealth.reminderDue"
          :continuous-minutes="usageHealth.continuousMinutes"
          :reminder-busy="usageHealth.busy"
          :end-today-available="false"
          :active-incognito="false"
          :import-count="0"
          :relationship-text="relationshipContextLine"
          :relationship-error="relStore.status === 'error'"
          :deactivate-visible="!!relStore.currentRelationshipId"
          :confirm-deactivate="confirmDeactivate"
          @usage-continue="onUsageContinue"
          @usage-end="onUsageEnd"
          @deactivate="onDeactivate"
        />
        <!-- 统一创建流程在陪伴设置页；聊天空态只保留入口与既有关系的
             激活，不复制一份创建表单。 -->
        <view class="chat-create-entry" data-testid="chat-create-companion">
          <text class="chat-create-entry__lead">还没有陪伴关系。</text>
          <button
            class="chat-create-entry__btn"
            data-testid="chat-create-companion-go"
            @click="goTo('/pages/companion/companion')"
          >
            去创建陪伴
          </button>
        </view>
        <RelationshipSelector
          :relationships="relStore.relationships"
          :current-id="relStore.currentRelationshipId"
          :status="relStore.status"
          :busy="relStore.status === 'loading'"
          :show-create="false"
          @activate="onRelActivate"
        />
        </view>
      </template>

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
          <button
            data-testid="conversation-manage"
            class="conv-mgmt-btn"
            :disabled="isStreaming || !store.conversationId"
            :aria-expanded="convSheetOpen ? 'true' : 'false'"
            @click="convSheetOpen = true"
          >
            管理
          </button>
        </view>

        <!-- CONV-MGMT: rename + two-step delete + end-today, collected into
             one action sheet instead of a flat button row. -->
        <AppSheet
          :open="convSheetOpen"
          title="会话管理"
          @close="convSheetOpen = false"
        >
          <view class="chat-sheet-list" role="menu">
            <button
              data-testid="conversation-rename"
              class="chat-sheet-item"
              role="menuitem"
              :disabled="isStreaming || !store.conversationId"
              @click="startRename"
            >
              改名
            </button>
            <button
              data-testid="end-today"
              class="chat-sheet-item"
              role="menuitem"
              :disabled="isStreaming || !store.conversationId"
              @click="onEndToday"
            >
              {{ confirmEndToday ? "确认结束？" : "结束今天的对话" }}
            </button>
            <button
              data-testid="conversation-delete"
              class="chat-sheet-item chat-sheet-item--danger"
              role="menuitem"
              :disabled="isStreaming || !store.conversationId"
              @click="onDeleteConversation"
            >
              {{ confirmDeleteId ? "确认删除？" : "删除会话" }}
            </button>
          </view>
        </AppSheet>

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

        <view
          ref="historyEl"
          class="chat-history"
          data-testid="history"
          :data-following="followingLatest ? 'true' : 'false'"
        >
          <!-- P1（round4）：条件系统行进入唯一滚动内容头部。它们仍然可达、
               按钮 ≥44px，但不再占用 history 外的固定高度——横屏叠加改名行/
               使用提醒/导入提示时 history 依旧保持真实可用高度，不会发生
               overflow:hidden 式的外层裁切。 -->
          <ChatContextHead
            :service-mode-summary="serviceModeSummary"
            :reminder-due="usageHealth.reminderDue"
            :continuous-minutes="usageHealth.continuousMinutes"
            :reminder-busy="usageHealth.busy"
            :end-today-available="!!store.conversationId"
            :active-incognito="store.activeIncognito"
            :import-count="importCount"
            :relationship-text="relationshipContextLine"
            :relationship-error="relStore.status === 'error'"
            :deactivate-visible="!!relStore.currentRelationshipId"
            :confirm-deactivate="confirmDeactivate"
            @usage-continue="onUsageContinue"
            @usage-end="onUsageEnd"
            @import-confirm="onImportMemories"
            @import-discard="onDiscardImport"
            @deactivate="onDeactivate"
          />
          <view
            v-if="showEmptyHistory"
            class="chat-empty"
            data-testid="empty-history"
            role="status"
          >
            <text>还没有消息。输入一句话开始倾听。</text>
          </view>
          <!-- VIRT-SCROLL (§18.6): only the visible slice is mounted. -->
          <view
            v-if="messages.length > 0"
            class="virt-spacer"
            data-testid="virt-spacer-top"
            :style="{ height: virtualWindow.offsetTop + 'px' }"
          />
          <view
            v-for="(msg, vi) in renderedMessages"
            :key="msg.messageId"
            class="chat-message"
            :class="msg.role"
            :data-vindex="String(virtualWindow.startIndex + vi)"
            data-testid="chat-message"
          >
            <text class="role-tag">{{ roleLabel(msg.role) }}</text>
            <view v-if="msg.role === 'assistant'" class="msg-content" data-testid="assistant-md">
              <view v-for="(block, bi) in markdownBlocks(msg.content)" :key="bi">
                <view v-if="block.kind === 'p'" class="md-p">
                  <text
                    v-for="(part, pi) in block.parts"
                    :key="pi"
                    :class="part.style ? `md-${part.style}` : undefined"
                  >{{ part.text }}</text>
                  <text v-if="block.truncated" class="md-truncated" data-testid="md-truncated">
                    回复过长，已截断
                  </text>
                </view>
                <view v-else-if="block.kind === 'code'" class="md-code" data-testid="md-code">
                  <text>{{ block.text }}</text>
                  <text v-if="block.truncated" class="md-truncated" data-testid="md-truncated">
                    代码过长，已截断
                  </text>
                </view>
                <view v-else-if="block.kind === 'ul'" class="md-ul">
                  <view v-for="(item, ii) in block.items" :key="ii" class="md-li">
                    <text
                      v-for="(part, pi) in item"
                      :key="pi"
                      :class="part.style ? `md-${part.style}` : undefined"
                    >{{ part.text }}</text>
                  </view>
                </view>
              </view>
            </view>
            <text v-else class="msg-content">{{ msg.content }}</text>
            <!-- 消息级低频操作收进"更多"展开区，不再整行平铺；两步确认
                 与版本切换仍在原 testid 上。 -->
            <button
              v-if="!msg.messageId.startsWith('__') && !isStreaming"
              class="msg-more"
              :data-testid="`msg-more-${msg.messageId}`"
              :aria-expanded="openMsgId === msg.messageId ? 'true' : 'false'"
              :aria-label="openMsgId === msg.messageId ? '收起这条消息的操作' : '展开这条消息的操作'"
              @click="toggleMsgMenu(msg.messageId)"
            >
              更多
            </button>
            <view
              v-if="openMsgId === msg.messageId"
              class="msg-actions"
              :data-testid="`msg-actions-${msg.messageId}`"
            >
            <!-- MSG-COPY: copy this message's text (best effort, no server
                 call; the label flips briefly as visual feedback). Assistant
                 copies carry the AI-content notice (COPY-LABEL / §21.4.1). -->
            <button
              class="msg-copy"
              :data-testid="`msg-copy-${msg.messageId}`"
              :aria-label="copiedMsgId === msg.messageId
                ? (msg.role === 'assistant' ? '已复制（内容由 AI 生成，请核实后使用）' : '已复制这条消息')
                : '复制这条消息'"
              @click="onCopyMessage(msg.messageId, msg.content, msg.role)"
            >
              {{ copiedMsgId === msg.messageId
                ? (msg.role === 'assistant' ? '已复制 · AI 生成' : '已复制')
                : '复制' }}
            </button>
            <!-- MEM-NEG (V44): 不记住 negative-memory marker, user messages
                 only (assistant text is never an extraction source). -->
            <button
              v-if="msg.role === 'user'"
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
              class="msg-delete"
              :data-testid="`msg-delete-${msg.messageId}`"
              :aria-label="confirmDeleteMsgId === msg.messageId ? '确认删除这条消息' : '删除这条消息'"
              @click="onDeleteMessage(msg.messageId)"
            >
              {{ confirmDeleteMsgId === msg.messageId ? "确认删除" : "删除" }}
            </button>
            <!-- MSG-REPORT (REPORT-BE): the intake page takes the submission;
                 no invented tickets, statuses or SLA wording inline. -->
            <button
              class="msg-copy"
              :data-testid="`msg-report-${msg.messageId}`"
              :aria-label="reportMsgId === msg.messageId ? '收起举报说明' : '举报这条消息'"
              @click="onReportMessage(msg.messageId)"
            >
              举报
            </button>
            <view
              v-if="reportMsgId === msg.messageId"
              class="msg-report-notice"
              :data-testid="`msg-report-notice-${msg.messageId}`"
              role="status"
            >
              <text>提交后会进入人工处理队列。这里不编造工单编号或处理时限。</text>
              <button
                class="msg-copy"
                data-testid="msg-report-open-page"
                @click="goTo(reportHref(msg.messageId))"
              >
                打开举报和申诉页提交
              </button>
            </view>
            <button
              v-if="canRegenerateMessage(msg)"
              class="msg-copy"
              data-testid="regenerate"
              aria-label="重新生成这条回复"
              @click="onRegenerate(msg)"
            >
              重新生成
            </button>
            <view
              v-if="versionsFor(msg).length > 1"
              class="version-row"
              data-testid="version-row"
              role="group"
              aria-label="生成版本"
            >
              <button
                v-for="(ver, index) in versionsFor(msg)"
                :key="ver.generationId"
                class="chat-mode-chip"
                :class="{ 'chat-mode-chip-active': ver.selected }"
                :data-testid="`version-${index + 1}`"
                :aria-pressed="ver.selected"
                :disabled="isStreaming"
                @click="onSelectVersion(msg, ver.generationId)"
              >
                版本 {{ index + 1 }}
              </button>
            </view>
            </view>
          </view>
          <view
            v-if="messages.length > 0"
            class="virt-spacer"
            data-testid="virt-spacer-bottom"
            :style="{ height: virtualBottomPad + 'px' }"
          />
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

          <!-- P1（round4）：流式草稿只在真实流式阶段渲染一次；正式消息提交
               并加载后该元素必须消失——completed/blocked/cancelled/failed
               终态都只有一份明确的助手回复或结果呈现。 -->
          <view v-if="isStreaming && paintedDraft" class="chat-draft" data-testid="draft">
            <text>{{ paintedDraft }}</text>
          </view>

          <view class="chat-status" data-testid="status" role="status" aria-live="polite">
            <text>{{ statusText }}</text>
          </view>

          <!-- SEND-FAIL: transport/5xx throw during send — restore the draft and
               surface a retryable failure instead of a silent unhandled rejection. -->
          <view v-if="sendError" class="chat-error" data-testid="chat-send-error" role="alert">
            <text>消息发送失败，请重试</text>
          </view>

          <view v-if="actionError" class="chat-error" data-testid="chat-action-error" role="alert">
            <text>操作未成功，请重试</text>
          </view>

          <!-- USAGE-VIZ: settled token usage of the last completed turn -->
          <view
            v-if="usage"
            class="chat-usage"
            data-testid="usage"
            role="status"
          >
            <text>{{ `本轮用量：输入 ${usage.inputTokens} / 输出 ${usage.outputTokens} 词元` }}</text>
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
        </view>
      </template>
    </template>
    </view>

    <!-- P1-A（round3）：输入栏是 chat-main 之外的独立区域——不 fixed、
         不覆盖任何滚动内容；视口再挤，先压缩的也是 chat-main 内部，
         输入框与发送/取消/重试按钮始终完整落在视口内。 -->
    <view
      v-if="!initError && hasRelationship"
      class="chat-input-area"
      role="form"
      aria-label="发送消息"
    >
      <input
        v-model="inputText"
        class="chat-input"
        data-testid="message-input"
        placeholder="输入消息…"
        aria-label="消息输入"
        :disabled="isStreaming"
        @keydown.enter="onSend"
      />
      <button
        data-testid="send"
        class="chat-send"
        :disabled="isStreaming || !canSend || !store.conversationId"
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
import { computed, defineComponent, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  computeVirtualWindow,
  VIRTUAL_ESTIMATE_HEIGHT,
  VIRTUAL_OVERSCAN,
  VIRTUAL_VIEWPORT_HEIGHT,
} from "@/domain/virtual-list-window";
import { parseSafeMarkdown } from "@/domain/safe-markdown";
import { createDisplayThrottle } from "@/domain/display-throttle";

import { createAuthedFetch } from "@/api/authed-fetch";
import {
  companionAvatarOption,
  companionHeaderName,
} from "@/domain/companion-presentation";
import { personaDisplayName } from "@/domain/persona";
import { createAuthenticatedTransport } from "@/api/transport";
import { createBrowserRealtimeDeps } from "@/api/realtime-transport";
import type { RealtimeDeps } from "@/api/realtime";
import { asFeedbackKind } from "@/api/chat";
import type { ConversationListItem } from "@/api/chat";
import RelationshipSelector from "@/components/RelationshipSelector.vue";
import ChatContextHead from "@/pages/chat/ChatContextHead.vue";
import AppIcon from "@/design-system/AppIcon.vue";
import AppSheet from "@/design-system/AppSheet.vue";
import { useAuthStore } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { useRelationshipStore } from "@/stores/relationship";
import { useUsageHealthStore } from "@/stores/usage-health";
import { useIncognitoStore } from "@/stores/incognito";
import type { MemoryImportPreview } from "@/api/relationship";
import { requestIdLabel } from "@/domain/request-id";
import { buildContextHref, readContextFromLocation } from "@/domain/context-href";
import { isReadableConversationText, readableConversationTitle } from "@/domain/conversation-display";
import { installStreamLifecycle } from "@/domain/stream-recovery";

function resolveOrigin(): string {
  return typeof window !== "undefined" && window.location && window.location.origin
    ? window.location.origin
    : "http://localhost:5173";
}

export default defineComponent({
  name: "ChatPage",
  components: { RelationshipSelector, AppIcon, AppSheet, ChatContextHead },
  setup() {
    const store = useChatStore();
    const relStore = useRelationshipStore();
    const auth = useAuthStore();
    const usageHealth = useUsageHealthStore();
    const incognitoPref = useIncognitoStore();
    const importPreview = ref<MemoryImportPreview | null>(null);
    const headerCompanionName = computed(() =>
      relStore.current ? companionHeaderName(relStore.current) : "",
    );
    const headerAvatar = computed(() => companionAvatarOption(relStore.current?.avatarRef));
    const headerConversationTitle = computed(() => {
      const id = store.conversationId;
      if (!id) return "";
      const item = store.conversations.find((row) => row.conversationId === id);
      // P1-2：头部不直接读原始 title/preview，统一走安全展示 helper，
      // 密文/空值回落到产品文案或真实日期，绝不露出内部值。
      return item ? readableConversationTitle(item) : "";
    });
    const inputText = ref("");
    const initError = ref(false);
    // SEND-FAIL: transport/5xx throw during send (see onSend).
    const sendError = ref(false);
    // ACTION-FAIL: transport/5xx throw during conversation/message/
    // relationship management ops (see guarded()).
    const actionError = ref(false);
    const initRequestId = ref("");
    // REL-DEACT: two-step confirm state for the deactivate button (no modal).
    const confirmDeactivate = ref(false);
    // CONV-MGMT: two-step delete confirm + inline rename state.
    const confirmDeleteId = ref<string | null>(null);
    const confirmEndToday = ref(false);
    const renaming = ref(false);
    const renameInput = ref("");
    // MSG-DELETE: two-step confirm state for per-message deletion.
    const confirmDeleteMsgId = ref<string | null>(null);
    // 消息级"更多"展开状态与上下文/会话管理 Action Sheet。
    const openMsgId = ref<string | null>(null);
    const contextSheetOpen = ref(false);
    const convSheetOpen = ref(false);
    // MSG-REPORT: local disclosure only — no ticket API in Alpha.
    const reportMsgId = ref<string | null>(null);
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
    const historyScrollTop = ref(0);
    // LANDSCAPE: 消息区高度由外壳按真实可用高度分配（flex），虚拟窗口用
    // 实测 clientHeight 计算；测不到（happy-dom）时退回常量，测试仍确定。
    const historyEl = ref<unknown>(null);
    const historyViewportPx = ref(VIRTUAL_VIEWPORT_HEIGHT);
    let historyObserver: { disconnect(): void; observe(target: Element): void } | null = null;
    // P2（round4）：模板 @scroll 在 uni-h5 包装层下可能落不到真实滚动节点；
    // 直接对 historyNode() 做原生监听，保证滚动手势一定进入跟随状态机。
    const boundScrollHandler = (event: Event): void => onHistoryScroll(event);
    const scrollBoundEls = new Set<HTMLElement>();

    function bindHistoryScrollListener(el: HTMLElement): void {
      if (scrollBoundEls.has(el)) return;
      el.addEventListener("scroll", boundScrollHandler);
      scrollBoundEls.add(el);
    }

    function unbindHistoryScrollListeners(): void {
      for (const el of scrollBoundEls) {
        el.removeEventListener("scroll", boundScrollHandler);
      }
      scrollBoundEls.clear();
    }

    /** 模板 ref 在 uni-h5 可能是元素或组件实例（带 $el），统一取真实节点。 */
    function historyNode(): HTMLElement | null {
      const raw: unknown = historyEl.value;
      if (raw instanceof HTMLElement) return raw;
      const el = (raw as { $el?: unknown } | null)?.$el;
      return el instanceof HTMLElement ? el : null;
    }

    function measureHistory(): void {
      const el = historyNode();
      const height = el ? el.clientHeight : 0;
      if (height > 0) historyViewportPx.value = height;
    }

    /**
     * LANDSCAPE/深链：historyEl 可能晚于 onMounted 出现（关系异步加载后才
     * 渲染消息区）。ref 一变化就（重）绑定 ResizeObserver，保证直接深链或
     * 刷新后虚拟窗口也用实测高度；卸载时统一断开。
     */
    function bindHistoryObserver(): void {
      if (typeof ResizeObserver === "undefined") return;
      historyObserver?.disconnect();
      const el = historyNode();
      if (!el) return;
      bindHistoryScrollListener(el);
      historyObserver = new ResizeObserver(() => {
        measureHistory();
        // P1/P2（round4）：视口/布局变化（旋转、软键盘、spacer 重排）时按
        // 跟随意图重对锚点；用户已滚离时绝不动 scrollTop。
        if (followingLatest.value) requestFollow();
      });
      historyObserver.observe(el);
      measureHistory();
      // 历史容器若被 Vue 重建（新节点从 0 开始），立即恢复一次锚定，
      // 不依赖恰好还有信号在途。
      requestFollow(undefined, { ignoreIntent: true });
    }

    watch(historyEl, () => bindHistoryObserver());

    // P1（round4）：逐项实测高度回填。估算值与真实行高的累积偏差会在长
    // 列表里制造“空白死带”（spacer 覆盖住真实内容带），逐条校准后虚拟
    // 窗口与滚动位置重新对齐。
    const measuredRowHeights = ref<Array<number | undefined>>([]);

    /** 校准前的估算窗口：供测量时机观察 startIndex/endIndex 变化。 */
    const virtualWindowSource = computed(() =>
      computeVirtualWindow({
        count: messages.value.length,
        scrollTop: historyScrollTop.value,
        viewportHeight: historyViewportPx.value,
        estimateHeight: VIRTUAL_ESTIMATE_HEIGHT,
        overscan: VIRTUAL_OVERSCAN,
        heights: null,
      }),
    );

    function recordRowHeights(): void {
      const el = historyNode();
      if (!el) return;
      let mutated = false;
      for (const node of Array.from(
        el.querySelectorAll('[data-testid="chat-message"]'),
      )) {
        const host = node as HTMLElement & { dataset: { vindex?: string } };
        const idx = Number(host.dataset.vindex);
        if (!Number.isInteger(idx) || idx < 0) continue;
        const h = Math.ceil(host.getBoundingClientRect().height);
        if (h <= 0) continue;
        if (measuredRowHeights.value[idx] !== h) {
          if (!mutated) {
            measuredRowHeights.value = [...measuredRowHeights.value];
            mutated = true;
          }
          measuredRowHeights.value[idx] = h;
        }
      }
      // 校准改变内容几何后：短暂静默重排引发的杂散滚动事件（不得误判为
      // 用户手势），并强制跟随机重新收敛一次——先前的收敛结果可能已被
      // 估算偏差的连锁重排推翻。
      if (mutated) {
        reflowQuietUntil = Date.now() + 120;
        requestFollow(undefined, { ignoreIntent: true });
      }
    }

    function scheduleRowMeasurement(): void {
      void nextTick(() => recordRowHeights());
    }

    watch(
      () => [
        messages.value.length,
        virtualWindowSource.value.startIndex,
        virtualWindowSource.value.endIndex,
      ],
      () => scheduleRowMeasurement(),
    );

    const virtualWindow = computed(() =>
      computeVirtualWindow({
        count: messages.value.length,
        scrollTop: historyScrollTop.value,
        viewportHeight: historyViewportPx.value,
        estimateHeight: VIRTUAL_ESTIMATE_HEIGHT,
        overscan: VIRTUAL_OVERSCAN,
        heights: measuredRowHeights.value,
      }),
    );

    const renderedMessages = computed(() =>
      messages.value.slice(virtualWindow.value.startIndex, virtualWindow.value.endIndex),
    );
    const virtualBottomPad = computed(() => {
      // P1（round4）：底垫按“总高−上垫−真实渲染段高度”计算；旧公式对渲染
      // 段整段按估算值扣减，会在短内容行上留下幻影空白，把最新回复顶出
      // 可视矩形上沿。
      const win = virtualWindow.value;
      let renderedHeight = 0;
      for (
        let i = win.startIndex;
        i < win.startIndex + renderedMessages.value.length;
        i += 1
      ) {
        renderedHeight += measuredRowHeights.value[i] ?? VIRTUAL_ESTIMATE_HEIGHT;
      }
      return Math.max(
        0,
        win.totalHeight - win.offsetTop - renderedHeight,
      );
    });

    function onHistoryScroll(event: Event): void {
      const target = event.target as
        | { scrollTop?: number; scrollHeight?: number; clientHeight?: number }
        | null;
      if (!target || typeof target.scrollTop !== "number") return;
      historyScrollTop.value = target.scrollTop;
      if (
        (Date.now() < programmaticScrollUntil &&
          Math.abs(target.scrollTop - lastProgrammaticTop) <= 2) ||
        Date.now() < reflowQuietUntil
      ) {
        return;
      }
      syncFollowFromLayout();
    }

    // P1/P2（round4）：跟随状态机。跟随目标是“最新流式草稿 / 最新正式消息”
    // 的底边，而不是尾部元数据行（status/usage/feedback/memory/mode）的绝对
    // 底部——否则小视口初始态会被尾部行把最新回复顶出可视区。
    //
    // 令牌规则：每次排入一帧就递增 followSeq；每个延迟 rAF / ResizeObserver
    // 动作执行前重新校验（令牌、followingLatest、当前 history 节点）——用户
    // 滚离底部后，已排队帧、后续 delta、ResizeObserver、虚拟 spacer 重排都
    // 不再写入 scrollTop；只有重新滚回锚点附近才恢复跟随。
    const followingLatest = ref(true);
    let followSeq = 0;
    /** 程序性滚动后的静默窗口与最近写入的实际落点：窗口内的回声事件用于
     * 与写入值比对——一致视为自己的回声，不一致（或窗外）一律按几何重新
     * 判定用户意图。校准/收敛引起的重排也各自开一个更短的静默窗。 */
    let programmaticScrollUntil = 0;
    let lastProgrammaticTop = Number.NaN;
    let reflowQuietUntil = 0;

    /** 跟随锚点：流式时是草稿元素，否则是最后一条真实消息。 */
    function currentAnchorNode(): HTMLElement | null {
      const el = historyNode();
      if (!el) return null;
      if (isStreaming.value && paintedDraft.value) {
        const draftNode = el.querySelector('[data-testid="draft"]');
        if (draftNode instanceof HTMLElement) return draftNode;
      }
      const nodes = el.querySelectorAll('[data-testid="chat-message"]');
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const node = nodes[i];
        if (node instanceof HTMLElement) return node;
      }
      return null;
    }

    /**
     * 由滚动位置推断用户意图：与最近一次收敛后的“静止间隙”比较——
     * 虚拟列表里“最后挂载的节点”不代表最新消息，不能用它的可视位置做判据；
     * 距内容底间隙回落到静止带内即视为回到跟随位。
     */
    let classificationArmed = false;

    function syncFollowFromLayout(): void {
      // 基线未建立（本轮尚未收敛过）时不做意图判定：挂载/翻页期的布局微滚
      // 一旦被误判为“用户离开”，跟随会被永久饿死。收敛本身会把布防打开。
      if (!classificationArmed) {
        followingLatest.value = true;
        return;
      }
      const el = historyNode();
      if (!el || el.scrollHeight <= el.clientHeight) {
        followingLatest.value = true;
        return;
      }
      const gap = el.scrollHeight - el.clientHeight - el.scrollTop;
      followingLatest.value = gap <= restGapPx.value + 40;
    }

    /** 最近一次锚定收敛时的“距内容底间隙”，跟随静止带的基准。 */
    const restGapPx = ref(48);

    function setProgrammaticScroll(el: HTMLElement, top: number): void {
      programmaticScrollUntil = Date.now() + 120;
      el.scrollTop = top;
      // 读回浏览器钳制后的实际值：回声比对用它，而非请求值。
      lastProgrammaticTop = el.scrollTop;
      historyScrollTop.value = el.scrollTop;
    }

    /**
     * 两阶段锚定收敛（round4 重写）：第一阶段持续强制绝对底跳——估算高度与
     * 真实行高的偏差会让虚拟窗口在贴近底部时发生“回流缩水”，把已到底的
     * 视口再甩回列表中段，因此必须逐帧复核「是否仍在最大滚动位」直到连续
     * 两帧稳定；第二阶段基于真实矩形把最新内容的底边精确对齐。 */
    interface FollowPhase {
      enforcedBottomFrames: number;
      lastScrollHeight: number;
      stableFrames: number;
      confirmed: boolean;
    }

    function applyAnchorOnce(el: HTMLElement, state: FollowPhase): boolean {
      // 布局稳定性闸门：校准回填会让 scrollHeight 逐帧变化；在连续两帧
      // 稳定之前，任何“看起来已对齐”的读数都不可信——直接回到绝对底。
      const stableLayout = state.lastScrollHeight === el.scrollHeight;
      state.lastScrollHeight = el.scrollHeight;
      if (!stableLayout) {
        state.stableFrames = 0;
        setProgrammaticScroll(el, el.scrollHeight);
        return false;
      }
      state.stableFrames += 1;
      const gapToMax =
        el.scrollHeight - el.clientHeight - el.scrollTop;
      if (state.stableFrames < 2) {
        setProgrammaticScroll(el, el.scrollHeight);
        return false;
      }

      // —— 第一阶段：强制贴底直到连续两帧站稳（防估高回流甩出）——
      if (state.enforcedBottomFrames < 2) {
        if (gapToMax > 6) {
          setProgrammaticScroll(el, el.scrollHeight);
          state.enforcedBottomFrames = 0;
          return false;
        }
        state.enforcedBottomFrames += 1;
        return false;
      }
      if (state.enforcedBottomFrames >= 2) {
        // 站稳两帧：贴底基线成立，允许此后开始意图分类；仍继续精调。
        classificationArmed = true;
      }
      if (gapToMax > 8) {
        // 贴底期间又被重排推走：重新计时强制。
        state.enforcedBottomFrames = 0;
        return false;
      }

      // —— 第二阶段：真实矩形精调锚点对齐 ——
      const anchor = currentAnchorNode();
      if (!anchor) {
        restGapPx.value = 24;
        return true;
      }
      if (anchor.getBoundingClientRect().height > el.clientHeight) {
        // 锚点高于可视区：静止在绝对底部兜底。
        setProgrammaticScroll(el, el.scrollHeight);
        restGapPx.value = Math.max(24, gapToMax);
        return true;
      }
      const overflowing =
        anchor.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
      if (Math.abs(overflowing) <= 1) {
        restGapPx.value = Math.max(24, gapToMax);
        classificationArmed = true;
        return true;
      }
      classificationArmed = true;
      setProgrammaticScroll(el, el.scrollTop + Math.ceil(overflowing));
      return false;
    }

    function stepFollow(
      seq: number,
      el: HTMLElement,
      framesLeft: number,
      state: FollowPhase,
    ): void {
      requestAnimationFrame(() => {
        // 每帧执行前重新校验；spacer 重排可能再次改变 scrollHeight。
        if (seq !== followSeq || !followingLatest.value || historyNode() !== el) return;
        const settled = applyAnchorOnce(el, state);
        if (!settled) {
          // 任何位移之后都需要一次“下帧复核”，防止读到过渡中的矩形。
          state.confirmed = false;
          if (framesLeft > 0) {
            stepFollow(seq, el, framesLeft - 1, state);
          }
          return;
        }
        if (!state.confirmed && framesLeft > 0) {
          state.confirmed = true;
          stepFollow(seq, el, framesLeft - 1, state);
        }
      });
    }

    function requestFollow(
      maxFrames = 24,
      opts: { ignoreIntent?: boolean } = {},
    ): void {
      // ignoreIntent：校准重排后的“恢复锚定”是机器自身的职责，即便用户
      // 此刻被判定为离开也必须把内容重新收拢（用户下一次滚动仍会生效）。
      if (!followingLatest.value && !opts.ignoreIntent) return;
      const el = historyNode();
      // 无布局环境（happy-dom）scrollHeight 为 0：跳过，不覆盖测试设置的
      // scrollTop；真实浏览器 scrollHeight ≥ clientHeight > 0。
      if (!el || el.scrollHeight <= 0) return;
      const seq = ++followSeq;
      void nextTick(() => {
        if (seq !== followSeq || !followingLatest.value || historyNode() !== el) return;
        stepFollow(seq, el, maxFrames, {
          enforcedBottomFrames: 0,
          lastScrollHeight: -1,
          stableFrames: 0,
          confirmed: false,
        });
      });
    }

    const conversations = computed(() => store.conversations);
    const pendingMemoryCount = computed(() => store.pendingMemoryCount);
    const draft = computed(() => store.draft);
    const paintedDraft = ref("");
    const draftThrottle = createDisplayThrottle(50);
    let draftFlushTimer: ReturnType<typeof setInterval> | undefined;
    watch(
      () => store.draft,
      (next) => {
        if (!store.isStreaming) {
          paintedDraft.value = next;
          return;
        }
        const published = draftThrottle.push(next);
        if (published !== null) {
          paintedDraft.value = published;
        }
      },
    );
    watch(
      () => store.isStreaming,
      (streaming) => {
        if (!streaming) {
          paintedDraft.value = store.draft;
        }
      },
    );

    function markdownBlocks(content: string) {
      return parseSafeMarkdown(content ?? "");
    }
    const usage = computed(() => store.usage);
    // FEEDBACK: kinds already submitted for the current generation.
    const feedbackKinds = computed(() => store.feedbackKinds);
    // SVC-MODE: plain summary of the current service mode (null hides the line).
    const serviceModeSummary = computed(() => store.serviceMode?.summary ?? "");
    // P1（round4）：条件系统行统一由 ChatContextHead 渲染在滚动内容头部。
    const importCount = computed(() =>
      importPreview.value &&
      importPreview.value.acceptedCount > 0 &&
      hasRelationship.value
        ? importPreview.value.acceptedCount
        : 0,
    );
    const relationshipContextLine = computed(() => {
      if (relStore.status === "error") return "关系列表加载失败。";
      if (relStore.status === "ready") {
        return relStore.current
          ? `当前关系：${personaDisplayName(relStore.current.personaRef)}`
          : "还没有当前关系。";
      }
      return "";
    });
    // FEEDBACK: offer feedback only when the turn produced a visible reply
    // (completed) or refused one (blocked) — never mid-stream or for pure
    // transport failures with nothing to judge.
    const showFeedback = computed(
      () => store.phase === "completed" || store.phase === "blocked",
    );
    // P1（round4）：新消息、流式草稿与完成后的尾部状态行到达，以及相位切换
    //（草稿移除/终态呈现）都触发一次锚定跟随；是否真的滚动由令牌机决定。
    watch(
      () => [
        messages.value.length,
        paintedDraft.value,
        showFeedback.value,
        usage.value,
        pendingMemoryCount.value,
        store.phase,
      ],
      () => requestFollow(),
    );
    // P1（round4）：固定结构与滚动内容头部的变化都会平移锚点的可视位置，
    // 显式触发一次重锚定（不等 ResizeObserver 的异步去重）。
    watch(
      () => [
        renaming.value,
        serviceModeSummary.value,
        usageHealth.reminderDue,
        importCount.value,
        store.activeIncognito,
      ],
      () => {
        if (followingLatest.value) requestFollow();
      },
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

    /**
     * CONV-HIST: short label — 统一走安全展示 helper（title → preview → 带真实
     * 日期的“未命名会话”），截断只发生在密文过滤之后，绝不拼接内部 ID。
     */
    function conversationLabel(conv: ConversationListItem): string {
      const safe = readableConversationTitle(conv);
      return safe.length > 16 ? `${safe.slice(0, 16)}…` : safe;
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
        "external-timed_out": "模型响应超时",
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
          // TERM-SEM: server OUTPUT_BLOCKED/INPUT_BLOCKED terminal, not a
          // transport failure. SAFETY-QUEUE (§20.5): plain reality-help line —
          // never a role-voiced crisis reply.
          return "这条内容没有通过安全审查，本轮不会继续。如果你正处于紧急危险，请联系当地紧急服务或你信任的真人。";
        case "failed":
          if (store.outcome === "not_found_or_forbidden" || store.lastDisconnect === "permission") {
            return "未找到或无权访问（存在性不披露）";
          }
          if (store.terminalFault) {
            return faultText(store.terminalFault);
          }
          if (store.lastDisconnect === "network") {
            return "网络中断，未确认的输入仍保留";
          }
          if (store.lastDisconnect === "service") {
            return "服务暂时不可用，请稍后重试";
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

    /**
     * ACTION-FAIL wrapper: management writes (conversation/message/relationship
     * ops) map a transport/5xx throw to a visible failure state instead of an
     * unhandled rejection; a rejected write keeps its store semantics.
     */
    async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
      actionError.value = false;
      try {
        return await fn();
      } catch {
        actionError.value = true;
        return undefined;
      }
    }

    async function onRetry(): Promise<void> {
      if (!canRetry.value) return;
      const text = store.pendingUserContent;
      sendError.value = false;
      try {
        await store.send(transport, deps, text);
      } catch {
        sendError.value = true;
        return;
      }
      if (store.phase === "completed") {
        await scheduleMemoryPrompt();
      }
    }

    async function onSend(): Promise<void> {
      const text = inputText.value.trim();
      // 会话尚未初始化完成时不得发送：轮次无法被接受，静默丢草稿是
      // 不诚实状态（Phase 7 harden，E2E 03 在新 IA 下暴露）。
      if (!text || store.isStreaming) return;
      if (!store.conversationId) {
        sendError.value = true;
        return;
      }
      inputText.value = "";
      sendError.value = false;
      try {
        await store.send(transport, deps, text);
      } catch {
        // Transport/5xx throw (ChatHttpError or fetch rejection): the turn was
        // never accepted, so restore the draft for an explicit retry instead
        // of losing it silently.
        inputText.value = text;
        sendError.value = true;
        return;
      }
      void usageHealth.heartbeat(transport);
      if (store.phase === "failed" && !store.generationId) {
        inputText.value = text;
      }
      if (store.phase === "completed") {
        await scheduleMemoryPrompt();
        await refreshVersions();
      }
    }

    async function onUsageContinue(): Promise<void> {
      await usageHealth.record(transport, "CONTINUED");
    }

    function lastUserMessage(): { messageId: string; content: string } | null {
      const users = messages.value.filter(
        (m) => m.role === "user" && !m.messageId.startsWith("__"),
      );
      const last = users[users.length - 1];
      return last ? { messageId: last.messageId, content: last.content } : null;
    }

    function canRegenerateMessage(msg: { role: string; messageId: string }): boolean {
      const last = lastUserMessage();
      return (
        msg.role === "user" &&
        !!last &&
        last.messageId === msg.messageId &&
        !isStreaming.value &&
        (store.phase === "completed" || store.phase === "idle")
      );
    }

    function versionsFor(msg: { role: string; messageId: string }) {
      if (msg.role !== "user") return [];
      return store.versionsByUserMessage[msg.messageId] ?? [];
    }

    async function onRegenerate(msg: { messageId: string; content: string }): Promise<void> {
      await guarded(() => store.regenerate(transport, deps, msg.messageId, msg.content));
    }

    async function onSelectVersion(
      msg: { messageId: string },
      generationId: string,
    ): Promise<void> {
      await guarded(() => store.selectVersion(transport, generationId, msg.messageId));
    }

    async function refreshVersions(): Promise<void> {
      const last = lastUserMessage();
      if (last) {
        await store.loadVersions(transport, last.messageId);
      }
    }

    async function onUsageEnd(): Promise<void> {
      await usageHealth.record(transport, "ENDED");
      const id = store.conversationId;
      if (!id) return;
      const ended = await guarded(() => store.endToday(transport, id));
      if (ended) {
        confirmEndToday.value = false;
        await guarded(async () => {
          await refreshConversationList();
          await startConversation();
        });
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

    /** MSG-REPORT: toggle the "not wired" notice. Never calls an API. */
    function toggleMsgMenu(messageId: string): void {
      openMsgId.value = openMsgId.value === messageId ? null : messageId;
    }

    function onReportMessage(messageId: string): void {
      reportMsgId.value = reportMsgId.value === messageId ? null : messageId;
    }

    /** MSG-DELETE: two-step confirm, then delete through the store. */
    async function onDeleteMessage(messageId: string): Promise<void> {
      if (confirmDeleteMsgId.value === messageId) {
        confirmDeleteMsgId.value = null;
        await guarded(() => store.removeMessage(transport, messageId));
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
      await guarded(() =>
        store.setMessageNoMemory(transport, msg.messageId, !msg.noMemory));
    }

    /**
     * MSG-COPY: copy the message text to the clipboard (best effort — never
     * breaks the chat). The label flips for a moment as feedback; assistant
     * copies carry the AI-content notice (COPY-LABEL / §21.4.1: 复制时提示
     * 「内容由 AI 生成，请核实后使用」— the export already labels every AI
     * message). The timer is cleared on unmount.
     */
    async function onCopyMessage(messageId: string, content: string, role: string): Promise<void> {
      const text = (content ?? "").trim();
      if (!text) return;
      try {
        const clipboard = (globalThis.navigator as
          | (Navigator & { clipboard?: { writeText(t: string): Promise<void> } })
          | undefined)?.clipboard;
        let copied = false;
        try {
          if (clipboard?.writeText) {
            await clipboard.writeText(text);
            copied = true;
          } else {
            copied = legacyCopy(text);
          }
        } catch {
          copied = false;
        }
        if (!copied) return;
        copiedMsgId.value = messageId;
        if (role === "assistant") {
          const uniApi = (globalThis as Record<string, unknown>).uni as
            | { showToast?: (options: { title: string; icon: string; duration: number }) => void }
            | undefined;
          try {
            uniApi?.showToast?.({
              title: "内容由 AI 生成，请核实后使用",
              icon: "none",
              duration: 1600,
            });
          } catch {
            // Presentation-only notice; the copy itself already succeeded.
          }
        }
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
    function legacyCopy(text: string): boolean {
      const textarea = globalThis.document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      globalThis.document.body.appendChild(textarea);
      textarea.select();
      try {
        return globalThis.document.execCommand("copy");
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

    function knownRelationshipIds(): string[] {
      return relStore.relationships.map((row) => row.relationshipId);
    }

    function memoryHref(): string {
      return buildContextHref("memory", {
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

    function companionHref(): string {
      return buildContextHref("companion", {
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

    function reportHref(messageId: string): string {
      return buildContextHref("report", { messageId });
    }

    function readQueryRelationshipId(): string {
      try {
        if (typeof location === "undefined") return "";
        return readContextFromLocation(location).relationshipId ?? "";
      } catch {
        return "";
      }
    }

    function readQueryConversationId(): string {
      try {
        if (typeof location === "undefined") return "";
        return readContextFromLocation(location).conversationId ?? "";
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
        initRequestId.value = requestIdLabel();
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
      // P1（round4）：切到会话即锚定最新消息（812×375 初始态可读）。
      requestFollow(2);
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
      const ended = await guarded(() => store.endToday(transport, id));
      if (ended) {
        await guarded(async () => {
          await refreshConversationList();
          await startConversation();
        });
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
      await guarded(async () => {
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
      });
    }

    function startRename(): void {
      const id = store.conversationId;
      if (!id) return;
      // 管理面板是选择器：选中"改名"即回到会话流内的改名行。
      convSheetOpen.value = false;
      const current = store.conversations.find((c) => c.conversationId === id);
      // P1-B（round3）：改名输入绝不预填密文——title 经可读性判定通过才带出
      // trim 后的原值；enc1:/enc2:、密文长 token、空值一律预填空字符串，
      // preview/日期 fallback/内部 ID 从不进入可编辑输入框。
      renameInput.value = isReadableConversationText(current?.title)
        ? current!.title!.trim()
        : "";
      renaming.value = true;
    }

    function cancelRename(): void {
      renaming.value = false;
      renameInput.value = "";
    }

    async function onRenameConversation(): Promise<void> {
      const id = store.conversationId;
      if (!id) return;
      const renamed = await guarded(() =>
        store.renameConversation(transport, id, renameInput.value.trim()));
      if (renamed) {
        cancelRename();
      }
    }

    async function onLoadMore(): Promise<void> {
      await guarded(() => store.loadMoreHistory(transport));
    }

    async function onRelActivate(relationshipId: string): Promise<void> {
      const result = await guarded(() => relStore.activate(transport, relationshipId));
      if (result) {
        initError.value = false;
        confirmDeactivate.value = false;
        await guarded(async () => {
          await startConversation();
          await refreshImportPreview();
        });
      }
    }

    async function refreshImportPreview(): Promise<void> {
      const persona = relStore.current?.personaRef;
      if (!persona) {
        importPreview.value = null;
        return;
      }
      try {
        importPreview.value = await relStore.listMemoryImports(transport, persona);
      } catch {
        importPreview.value = null;
      }
    }

    async function onImportMemories(): Promise<void> {
      const id = relStore.currentRelationshipId;
      if (!id) return;
      try {
        await relStore.importMemories(transport, id);
        importPreview.value = null;
      } catch {
        // Keep the prompt; do not invent a successful import.
      }
    }

    async function onDiscardImport(): Promise<void> {
      const persona = relStore.current?.personaRef;
      if (!persona) return;
      try {
        await relStore.discardMemoryImport(transport, persona);
        importPreview.value = null;
      } catch {
        // Keep the prompt.
      }
    }

    async function onRelCreate(personaRef: string): Promise<void> {
      const result = await guarded(() => relStore.create(transport, personaRef));
      if (result) {
        initError.value = false;
        confirmDeactivate.value = false;
        await guarded(async () => {
          await startConversation();
          await refreshImportPreview();
        });
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
      const result = await guarded(() => relStore.deactivate(transport, id));
      confirmDeactivate.value = false;
      if (result) {
        store.reset();
      }
    }

    let usagePulseTimer: ReturnType<typeof setInterval> | undefined;

    watch(
      () => usageHealth.reminderDue,
      (due) => {
        if (due) {
          void usageHealth.markShown(transport);
        }
      },
    );

    let stopLifecycle: (() => void) | undefined;
    onMounted(async () => {
      if (typeof document !== "undefined" && typeof window !== "undefined") {
        stopLifecycle = installStreamLifecycle({
          addEventListener: (name, handler) => window.addEventListener(name, handler),
          removeEventListener: (name, handler) => window.removeEventListener(name, handler),
          getVisibility: () => document.visibilityState,
          onRecover: () => {
            void store.recoverInFlight(deps);
          },
        });
      }
      // LANDSCAPE: 首次与后续尺寸变化都重测消息区真实高度，驱动虚拟窗口；
      // historyEl 晚出现时由 ref watch 兜底（深链/刷新场景）。
      bindHistoryObserver();
      // SESS-REVIVE: restore the session from the HttpOnly refresh cookie
      // before any authenticated call, so a page reload stays logged in.
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      // USAGE-HEALTH: client-assist heartbeat; the backend owns the clock.
      if (auth.isAuthenticated) {
        await usageHealth.heartbeat(transport);
        usagePulseTimer = setInterval(() => {
          void usageHealth.heartbeat(transport);
        }, 60_000);
        await incognitoPref.load(transport);
        incognitoNext.value = incognitoPref.defaultIncognito;
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
        // create a fresh one (the pre-CONV-HIST behavior). CONV-LIST can pin
        // a specific conversation via ?conversationId=.
        await refreshConversationList();
        const requested = readQueryConversationId();
        const fromQuery = requested
          ? store.conversations.find((c) => c.conversationId === requested)
          : undefined;
        const latest = store.conversations[store.conversations.length - 1];
        const target = fromQuery ?? latest;
        if (target) {
          await store.openConversation(transport, target.conversationId);
          // P1（round4）：进入页面直接锚定最新消息，短视口也能读到当前轮。
          requestFollow(2);
        } else {
          await startConversation();
        }
        // S0-20 review-fix: bind the recovery entry to this account +
        // relationship, then re-anchor any pending generation from the server
        // snapshot after a full page reload. Mismatches/expiry drop silently.
        store.bindGenerationContext(
          auth.accountId ?? "",
          relStore.currentRelationshipId,
        );
        const restored = await store.tryRestoreAfterReload(deps, {
          accountId: auth.accountId ?? "",
          relationshipId: relStore.currentRelationshipId,
        });
        // The conversation history was loaded before recovery. A generation
        // may commit while the snapshot/resume call is in flight, so refresh
        // once after a restored turn settles to include its durable assistant
        // message instead of leaving only the pre-terminal user row onscreen.
        if (restored) {
          await store.loadHistory(transport);
        }
        // MEM-PROMPT: surface candidates from earlier turns on entry too.
        await store.refreshPendingMemoryCount(
          transport,
          relStore.currentRelationshipId,
        );
        await refreshVersions();
        await refreshImportPreview();
      }
      draftFlushTimer = setInterval(() => {
        const published = draftThrottle.flush();
        if (published !== null) {
          paintedDraft.value = published;
        }
      }, 50);
    });

    onUnmounted(() => {
      stopLifecycle?.();
      unbindHistoryScrollListeners();
      historyObserver?.disconnect();
      historyObserver = null;
      clearMemoryPoll();
      // A page teardown is not an explicit user cancellation. Keep the
      // non-sensitive recovery binding so a reload can resume this generation.
      store.detachInFlight();
      usageHealth.reset();
      if (usagePulseTimer !== undefined) {
        clearInterval(usagePulseTimer);
      }
      if (draftFlushTimer !== undefined) {
        clearInterval(draftFlushTimer);
      }
      // MSG-COPY: never let the feedback timer fire after unmount.
      if (copyResetTimer !== undefined) {
        globalThis.clearTimeout(copyResetTimer);
      }
    });

    return {
      relStore,
      store,
      auth,
      historyEl,
      headerCompanionName,
      headerAvatar,
      headerConversationTitle,
      importPreview,
      initRequestId,
      onImportMemories,
      onDiscardImport,
      messages,
      renderedMessages,
      virtualWindow,
      virtualBottomPad,
      historyViewportPx,
      onHistoryScroll,
      followingLatest,
      conversations,
      pendingMemoryCount,
      draft,
      paintedDraft,
      markdownBlocks,
      usage,
      isStreaming,
      showEmptyHistory,
      showLoadMore,
      canSend,
      hasRelationship,
      importCount,
      relationshipContextLine,
      inputText,
      initError,
      confirmDeactivate,
      confirmEndToday,
      onEndToday,
      confirmDeleteId,
      confirmDeleteMsgId,
      reportMsgId,
      openMsgId,
      contextSheetOpen,
      convSheetOpen,
      toggleMsgMenu,
      onReportMessage,
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
      usageHealth,
      onUsageContinue,
      onUsageEnd,
      statusText,
      sendError,
      actionError,
      canRetry,
      roleLabel,
      personaDisplayName,
      conversationLabel,
      onSend,
      onRegenerate,
      onSelectVersion,
      canRegenerateMessage,
      versionsFor,
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
      conversationsHref,
      companionHref,
      reminderHref,
      reportHref,
      onRelActivate,
      onRelCreate,
    };
  },
});
</script>

<style scoped>
/* 沉浸式对话：暮色头部 + 暖纸对话面。P1-A（round3）单一滚动 ownership：
   页面外壳只做 flex 分配（header / chat-main / 独立输入栏），自身永不滚动；
   有关系时唯一纵向滚动容器是 chat-history（含状态/反馈/模式行），无关系时
   是 chat-setup。输入栏不是 fixed 覆盖层，而是布局流中的独立区域——无论
   内容多挤，被压缩的只会是 chat-main 内部，输入栏与按钮始终完整可见。 */
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--vc-env);
}

.chat-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* 无关系分支的滚动容器（与 chat-history 互斥，保持唯一滚动 ownership）。 */
.chat-setup {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.chat-header {
  flex: none;
  position: static;
  z-index: var(--vc-z-header);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--vc-space-2);
  box-sizing: border-box;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: calc(var(--vc-space-2) + env(safe-area-inset-top, 0px))
    calc(var(--vc-space-2) + env(safe-area-inset-right, 0px))
    var(--vc-space-2)
    calc(var(--vc-space-2) + env(safe-area-inset-left, 0px));
  background: var(--vc-env-raised);
  border-bottom: 1px solid var(--vc-border-env);
}

.chat-header__back,
.chat-header__more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-on-env);
}

.chat-header__back::after,
.chat-header__more::after {
  border: 0;
}

.chat-header__identity {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: var(--vc-space-2);
  flex-wrap: wrap;
}

.chat-header-companion {
  display: flex;
  align-items: center;
  gap: var(--vc-space-2);
  min-width: 0;
}

.chat-companion-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: var(--vc-radius-s);
  font-size: var(--vc-text-sm);
  font-weight: 700;
}

.chat-companion-name {
  overflow: hidden;
  color: var(--vc-on-env);
  font-size: var(--vc-text-md);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-conversation-title {
  overflow: hidden;
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-ai-label {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--vc-border-env);
  border-radius: var(--vc-radius-pill);
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-xs);
  white-space: nowrap;
}

/* Action Sheet 内的菜单行 */
.chat-sheet-list {
  display: grid;
}

.chat-sheet-item {
  min-height: 48px;
  margin: 0;
  padding: var(--vc-space-3) var(--vc-space-2);
  border: 0;
  border-bottom: 1px solid var(--vc-border);
  border-radius: 0;
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-md);
  text-align: left;
}

.chat-sheet-item::after {
  border: 0;
}

.chat-sheet-item--danger {
  color: var(--vc-danger);
}

/* P1-A（round3）：以下低频状态行位于唯一滚动容器（chat-history）内部，
   宽度即滚动内容宽度（history 自身已有水平留白），随消息一起滚动，
   永远不会停在固定输入栏后方。条件系统行（service-mode / usage-health /
   incognito / 导入提示 / 当前关系）同样在滚动容器内，样式归属
   ChatContextHead.vue。 */

/* P1-A（round3）：以下低频状态行位于唯一滚动容器（chat-history）内部，
   宽度即滚动内容宽度（history 自身已有水平留白），随消息一起滚动，
   永远不会停在固定输入栏后方。 */
.chat-usage,
.memory-prompt {
  flex: none;
  box-sizing: border-box;
  width: 100%;
  margin: var(--vc-space-2) 0 0;
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
  border: 1px solid var(--vc-border);
  color: var(--vc-ink);
  font-size: var(--vc-text-sm);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
}

.chat-create-entry {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-3);
  width: calc(100% - var(--vc-space-6));
  max-width: 720px;
  margin: var(--vc-space-5) auto 0;
  padding: var(--vc-space-5);
  border: 1px dashed var(--vc-border-strong);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
}

.chat-create-entry__lead {
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.chat-create-entry__btn {
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

.chat-create-entry__btn::after {
  border: 0;
}

/* 会话切换条 */
.conversation-panel {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  width: calc(100% - var(--vc-space-6));
  max-width: 720px;
  margin: var(--vc-space-3) auto 0;
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
  border: 1px solid var(--vc-border);
}

.conversation-list {
  display: flex;
  gap: var(--vc-space-1);
  flex: 1 1 100%;
  white-space: nowrap;
}

.conversation-item {
  flex: 0 0 auto;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-pill);
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-xs);
}

.conversation-item::after {
  border: 0;
}

.conversation-item.active {
  background: var(--vc-primary);
  border-color: var(--vc-primary);
  color: var(--vc-on-primary);
  font-weight: 600;
}

.incognito-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: var(--vc-radius-pill);
  background: var(--vc-sunken);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.conversation-item.active .incognito-badge {
  background: rgba(36, 26, 8, 0.16);
  color: var(--vc-on-primary);
}

.chat-nav-index {
  flex: 0 0 auto;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.chat-nav-index::after {
  border: 0;
}

.conv-mgmt-btn {
  flex: 0 0 auto;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-xs);
}

.conv-mgmt-btn::after {
  border: 0;
}

.incognito-toggle-on {
  background: var(--vc-sunken);
  border-color: var(--vc-border-strong);
  font-weight: 600;
}

.rename-row {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
  width: calc(100% - var(--vc-space-6));
  max-width: 720px;
  margin: var(--vc-space-2) auto 0;
}

.rename-input {
  flex: 1 1 12em;
  box-sizing: border-box;
  min-height: 44px;
  padding: 0 var(--vc-space-3);
  /* 暗面（chat env）上的真实控件边界 ≥3:1，不用装饰级 border。 */
  border: 1px solid var(--vc-border-env-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-ink);
  font-size: 16px;
}

/* 对话历史：暖纸面上的安静滚动区。高度由外壳 flex 分配（不再固定 640px），
   虚拟窗口用实测 clientHeight 对齐。 */
.chat-history {
  flex: 1 1 auto;
  min-height: 96px;
  box-sizing: border-box;
  width: calc(100% - var(--vc-space-6));
  max-width: 720px;
  margin: var(--vc-space-3) auto 0;
  padding: var(--vc-space-3) 0;
  overflow-y: auto;
  /* P2（round4）：关闭浏览器的 scroll anchoring——锚定跟随由跟随状态机
     独家负责，虚拟 spacer 重排不得借浏览器之手挪动 scrollTop。 */
  overflow-anchor: none;
  border-radius: var(--vc-radius-l);
  background: var(--vc-paper);
  border: 1px solid var(--vc-border);
}

.chat-empty {
  padding: var(--vc-space-7) var(--vc-space-4);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  text-align: center;
}

.chat-message {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--vc-space-2) var(--vc-space-4);
}

.chat-message.user {
  align-items: flex-end;
}

.role-tag {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  margin-bottom: 2px;
}

.msg-content {
  max-width: 86%;
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
  border: 1px solid var(--vc-border);
  font-size: var(--vc-text-md);
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.chat-message.user .msg-content {
  background: var(--vc-sunken);
}

.md-p {
  margin: 0 0 var(--vc-space-1);
}

.md-code {
  padding: var(--vc-space-2);
  border-radius: var(--vc-radius-s);
  background: var(--vc-env);
  color: var(--vc-on-env);
  font-family: var(--vc-font-mono);
  font-size: var(--vc-text-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.md-ul {
  margin: 0 0 var(--vc-space-1);
  padding-left: var(--vc-space-5);
}

.md-li {
  margin-bottom: 2px;
}

.md-strong {
  font-weight: 700;
}

.md-truncated {
  display: block;
  margin-top: var(--vc-space-1);
  color: var(--vc-warning);
  font-size: var(--vc-text-xs);
}

/* 消息级"更多"与展开操作区 */
.msg-more {
  min-height: 44px;
  margin: var(--vc-space-1) 0 0;
  padding: 0 var(--vc-space-3);
  border: 0;
  border-radius: var(--vc-radius-pill);
  background: transparent;
  color: var(--vc-muted);
  font: inherit;
  font-size: var(--vc-text-xs);
}

.msg-more::after {
  border: 0;
}

.msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-1);
  margin-top: var(--vc-space-1);
  justify-content: flex-start;
}

.chat-message.user .msg-actions {
  justify-content: flex-end;
}

.msg-copy,
.msg-no-memory,
.msg-delete {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-pill);
  background: var(--vc-card);
  color: var(--vc-muted);
  font: inherit;
  font-size: var(--vc-text-xs);
}

.msg-copy::after,
.msg-no-memory::after,
.msg-delete::after {
  border: 0;
}

.msg-no-memory--on {
  color: var(--vc-warning);
  border-color: var(--vc-warning);
}

.msg-delete {
  color: var(--vc-danger);
  border-color: var(--vc-danger);
}

.msg-report-notice {
  flex: 1 1 100%;
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
  align-items: center;
}

.version-row {
  flex: 1 1 100%;
  display: flex;
  gap: var(--vc-space-1);
  flex-wrap: wrap;
}

.history-more {
  display: flex;
  justify-content: center;
  padding: var(--vc-space-3) 0;
}

/* 草稿与状态行（P1-A round3：位于 chat-history 内部，随消息滚动） */
.chat-draft,
.chat-status,
.chat-error,
.chat-feedback-row,
.chat-mode-row {
  flex: none;
  box-sizing: border-box;
  width: 100%;
  margin: var(--vc-space-2) 0 0;
  font-size: var(--vc-text-xs);
}

.chat-draft {
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-muted);
  overflow-wrap: anywhere;
}

.chat-status {
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  border: 1px solid var(--vc-border);
  color: var(--vc-muted);
}

.chat-error {
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
}

.chat-feedback-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  border: 1px solid var(--vc-border);
}

.chat-feedback-label {
  color: var(--vc-muted);
}

.chat-feedback-chip {
  flex: none;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-pill);
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-xs);
}

.chat-feedback-chip::after {
  border: 0;
}

.chat-feedback-chip[disabled] {
  color: var(--vc-muted);
}

.memory-prompt {
  border-color: var(--vc-primary);
}

/* 模式切换与输入区 */
.chat-mode-row {
  display: flex;
  gap: var(--vc-space-1);
  flex-wrap: wrap;
}

.chat-mode-chip {
  flex: none;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-pill);
  background: var(--vc-card);
  color: var(--vc-muted);
  font: inherit;
  font-size: var(--vc-text-xs);
}

.chat-mode-chip::after {
  border: 0;
}

.chat-mode-chip-active {
  background: var(--vc-primary);
  border-color: var(--vc-primary);
  color: var(--vc-on-primary);
  font-weight: 600;
}

/* 输入区（P1-A round3）：chat-page 直接子级的独立区域，flex:none 常驻
   视口底部；正确处理 safe-area；永不 fixed、永不覆盖滚动内容。 */
.chat-input-area {
  flex: none;
  display: flex;
  gap: var(--vc-space-2);
  box-sizing: border-box;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: var(--vc-space-2)
    calc(var(--vc-space-3) + env(safe-area-inset-right, 0px))
    calc(var(--vc-space-2) + env(safe-area-inset-bottom, 0px))
    calc(var(--vc-space-3) + env(safe-area-inset-left, 0px));
  background: var(--vc-env-raised);
  border-top: 1px solid var(--vc-border-strong);
}

.chat-input {
  flex: 1 1 auto;
  min-width: 0;
  box-sizing: border-box;
  min-height: 48px;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-paper);
  color: var(--vc-ink);
  /* iOS Safari 聚焦自动缩放阈值：输入字号不小于 16px。 */
  font-size: 16px;
}

.chat-send {
  min-height: 48px;
  flex: 0 0 auto;
  margin: 0;
  padding: 0 var(--vc-space-5);
  border: 0;
  border-radius: var(--vc-radius-s);
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font: inherit;
  font-weight: 650;
}

.chat-send::after {
  border: 0;
}

.chat-cancel,
.chat-retry {
  min-height: 48px;
  flex: 0 0 auto;
  margin: 0;
  padding: 0 var(--vc-space-4);
  /* 真实控件边界 ≥3:1：暗面上的操作按钮不用装饰级 border-env。 */
  border: 1px solid var(--vc-glow);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-on-env);
  font: inherit;
  font-size: var(--vc-text-sm);
}

.chat-cancel::after,
.chat-retry::after {
  border: 0;
}

/* initError 整页错误仍在 chat-main 固定区（history 尚未渲染）。 */
.chat-init-error {
  width: calc(100% - var(--vc-space-6));
  max-width: 720px;
  margin: var(--vc-space-2) auto 0;
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
  font-size: var(--vc-text-xs);
}

/* LANDSCAPE / 短视口（≤480px 高）：结构不变——单一滚动容器 + 独立输入栏。
   这里只压缩固定行与消息区的留白，让 812×375 初始态也读得到真实消息；
   输入栏仍是布局流区域（上一轮的 fixed 覆盖方案已移除）。 */
@media (max-height: 480px) {
  .chat-header {
    padding-top: var(--vc-space-1);
    padding-bottom: var(--vc-space-1);
  }

  .chat-usage,
  .memory-prompt,
  .chat-status,
  .chat-draft,
  .chat-error {
    margin-top: var(--vc-space-1);
    padding: var(--vc-space-1) var(--vc-space-2);
    font-size: var(--vc-text-xs);
  }

  .conversation-panel {
    /* 横屏单行：横滑会话列表与操作按钮同排（宽度足够），给消息区让出
       一整行高度；竖屏保持列表独占一行的两行布局。 */
    flex-wrap: nowrap;
    align-items: center;
    margin-top: var(--vc-space-1);
    padding: var(--vc-space-1) var(--vc-space-2);
  }

  .conversation-list {
    flex: 1 1 auto;
    min-width: 0;
  }

  .chat-history {
    margin-top: var(--vc-space-1);
    padding: var(--vc-space-2) 0;
  }

  .chat-feedback-row,
  .chat-mode-row {
    margin-top: var(--vc-space-1);
  }

  .chat-input-area {
    padding-top: var(--vc-space-1);
  }

  .chat-input,
  .chat-send,
  .chat-cancel,
  .chat-retry {
    min-height: 44px;
  }

  /* uni-input 宿主有内建内距：46px 宿主让原生 input 达到 ≥44px 触控高。 */
  .chat-input {
    min-height: 46px;
  }
}
</style>
