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
            :data-mid="msg.messageId"
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
    /** round10（P1-3）：明确用户滚动意图先使未消费回声票据失效。 */
    const SCROLL_INTENT_KEYS = new Set([
      "Home", "End", "PageUp", "PageDown", " ", "Spacebar", "ArrowUp", "ArrowDown",
    ]);
    const userScrollIntentHandler = (): void => invalidateScrollEchoAcks();
    const keyScrollIntentHandler = (event: KeyboardEvent): void => {
      if (!SCROLL_INTENT_KEYS.has(event.key)) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        // 文本输入内的按键不是滚动意图。
        return;
      }
      invalidateScrollEchoAcks();
    };

    function bindHistoryScrollListener(el: HTMLElement): void {
      // round7（P2）：重绑定必须立刻摘掉旧节点的原生 scroll 监听——不能等
      // 最终 unmount 才统一清理，否则旧节点上的残余事件还会进状态机。
      for (const bound of Array.from(scrollBoundEls)) {
        if (bound !== el) {
          bound.removeEventListener("scroll", boundScrollHandler);
          bound.removeEventListener("wheel", userScrollIntentHandler);
          bound.removeEventListener("touchstart", userScrollIntentHandler);
          bound.removeEventListener("pointerdown", userScrollIntentHandler);
          scrollBoundEls.delete(bound);
        }
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("keydown", keyScrollIntentHandler);
        window.addEventListener("keydown", keyScrollIntentHandler, { passive: true });
      }
      if (scrollBoundEls.has(el)) return;
      el.addEventListener("scroll", boundScrollHandler);
      el.addEventListener("wheel", userScrollIntentHandler, { passive: true });
      el.addEventListener("touchstart", userScrollIntentHandler, { passive: true });
      el.addEventListener("pointerdown", userScrollIntentHandler, { passive: true });
      scrollBoundEls.add(el);
    }

    function unbindHistoryScrollListeners(): void {
      for (const el of scrollBoundEls) {
        el.removeEventListener("scroll", boundScrollHandler);
        el.removeEventListener("wheel", userScrollIntentHandler);
        el.removeEventListener("touchstart", userScrollIntentHandler);
        el.removeEventListener("pointerdown", userScrollIntentHandler);
      }
      scrollBoundEls.clear();
      if (typeof window !== "undefined") {
        window.removeEventListener("keydown", keyScrollIntentHandler);
      }
    }

    /** 模板 ref 在 uni-h5 可能是元素或组件实例（带 $el），统一取真实节点。 */
    function historyNode(): HTMLElement | null {
      const raw: unknown = historyEl.value;
      if (raw instanceof HTMLElement) return raw;
      const el = (raw as { $el?: unknown } | null)?.$el;
      return el instanceof HTMLElement ? el : null;
    }

    /**
     * LANDSCAPE/深链：historyEl 可能晚于 onMounted 出现（关系异步加载后才
     * 渲染消息区）。ref 一变化就（重）绑定 ResizeObserver，保证直接深链或
     * 刷新后虚拟窗口也用实测高度；卸载时统一断开。
     *
     * P2（round6）：RO 同时追踪 history 的宽度——宽度变化意味着换行全部
     * 重排，按行实测高度缓存整体失效并在新宽度下重测。
     */
    const observedHistorySize = { width: 0, height: 0 };
    /** P2（round6）：高度缓存失效纪元，宽度变化时递增并发布到 DOM。 */
    let heightCacheEpoch = 0;

    function bindHistoryObserver(): void {
      if (typeof ResizeObserver === "undefined") return;
      historyObserver?.disconnect();
      // 节点替换（Vue 重建容器）：先递增令牌作废旧节点上一切挂起帧，再取消
      // run——顺序保证陈旧 rAF 回调即使晚到也因 gen 不匹配而退出，绝不能
      // 取消/污染随后在新节点上启动的新 run。
      followGen += 1;
      cancelFollowRun();
      // round9（三）：旧节点上的保持机制必须完整清算——泵令牌失效、活动
      // 事务与覆盖窗释放、延迟定锚作废（followGen 已递增，attempt 闭包
      // 校验后自弃）。abandon 仍指向旧 boundPreserveHost，恰好把 idle 与
      // 清理发布到旧节点；遗留诊断属性在此一并抹除，新节点从当前真实视图
      // 重建有效事务。
      invalidatePreservePump();
      abandonPreserveTransaction();
      // round10（P1-4）：节点重建即旧 handoff 的宿主身份失效。
      invalidatePendingDeleteHandoffs();
      const stale = boundPreserveHost;
      if (stale) {
        // 生命周期终态（idle/released）保留在旧节点上供观察；锚点与
        // 世代诊断属性清空。
        delete stale.dataset.preserveGen;
        delete stale.dataset.preserveConverged;
        delete stale.dataset.preserveResidualPx;
      }
      const el = historyNode();
      if (!el) {
        boundPreserveHost = null;
        return;
      }
      boundPreserveHost = el;
      bindHistoryScrollListener(el);
      boundHistoryEl = el;
      historyObserver = new ResizeObserver((entries) => {
        const target = entries[entries.length - 1];
        const contentBox = target?.contentRect;
        const nextWidth =
          contentBox !== undefined
            ? contentBox.width
            : el.clientWidth;
        const widthChanged =
          observedHistorySize.width > 0 &&
          Math.abs(nextWidth - observedHistorySize.width) >= 1;
        observedHistorySize.width = nextWidth;
        observedHistorySize.height = contentBox?.height ?? el.clientHeight;

        measureHistory();
        if (widthChanged) {
          // 仅宽度维度变化：走事务序列（冻结锚→覆盖窗→整表失效→重测）。
          remeasureAfterWidthChange();
          return;
        }
        // 视口/布局变化（旋转、软键盘、spacer 重排）：跟随时重对锚点；
        // 用户已滚离时交由保持事务路由统一处理。
        if (followingLatest.value) {
          requestFollow();
        } else {
          // round10（P1-2）：RO 是真实外部入口——不继承前一次事务耗尽的
          // revival/stall 账本。
          resetPreserveRevival();
          routeLayoutSignalToPreserve();
        }
      });
      historyObserver.observe(el);
      observedHistorySize.width = el.clientWidth;
      observedHistorySize.height = el.clientHeight;
      measureHistory();
      // 历史容器若被 Vue 重建（新节点从 0 开始），立即恢复一次锚定，
      // 不依赖恰好还有信号在途。ownership 语义不变：离开中的用户不会被打扰。
      requestFollow();
    }

    watch(historyEl, () => bindHistoryObserver());

    // P2（round5）：逐项实测高度以 messageId 为键缓存。索引键在删除消息、
    // 切换会话时全部错位；messageId 键让删除只淘汰被删行、切换按会话重建、
    // 宽度变化整体失效重测。
    const measuredHeights = ref<Map<string, number>>(new Map());

    // 虚拟窗口的局部坐标修正：ChatContextHead 等条件系统行与消息流共用
    // 同一滚动容器，容器的 scrollTop 包含头部高度，必须扣除后再交给
    // computeVirtualWindow。头部高度由顶垫元素相对滚动内容原点的 offsetTop
    // 实时测得（.chat-history 已声明 position:relative）。
    const msgFlowTopPx = ref(0);

    function syncMsgFlowTop(host?: HTMLElement | null): void {
      const el = host ?? historyNode();
      if (!el) return;
      const flow = el.querySelector('[data-testid="virt-spacer-top"]');
      const top = flow instanceof HTMLElement ? flow.offsetTop : 0;
      if (!Number.isFinite(top) || top < 0) return;
      if (top !== msgFlowTopPx.value) msgFlowTopPx.value = top;
    }

    function measureHistory(): void {
      const el = historyNode();
      if (!el) return;
      if (el.clientHeight > 0) historyViewportPx.value = el.clientHeight;
      syncMsgFlowTop(el);
    }

    /** 消息流本地坐标下的滚动位置（虚拟窗口唯一可信的 scrollTop 输入）。 */
    const messageScrollTop = computed(() =>
      Math.max(0, historyScrollTop.value - msgFlowTopPx.value),
    );

    /** messageId 键 → 索引表：交给 computeVirtualWindow 的稠密高度表。 */
    const heightTable = computed<Array<number | undefined> | null>(() => {
      const list = messages.value;
      if (list.length === 0 || measuredHeights.value.size === 0) return null;
      const table = new Array<number | undefined>(list.length);
      let any = false;
      for (let i = 0; i < list.length; i += 1) {
        const h = measuredHeights.value.get(list[i]!.messageId);
        if (h !== undefined && h > 0) {
          table[i] = h;
          any = true;
        }
      }
      return any ? table : null;
    });

    /**
     * 实测回填：只写真实 diff（防 RO/watcher 自激循环），且每轮顺带同步
     * 头部高度与窗口尺寸。用户已接管视口时绝不为校准强制跟随——位置保持
     * 由“可见 messageId + 相对偏移”快照负责。
     */
    function recordRowHeights(): void {
      const el = historyNode();
      if (!el) return;
      syncMsgFlowTop(el);
      const next = measuredHeights.value;
      let mutated = false;
      for (const node of Array.from(
        el.querySelectorAll('[data-testid="chat-message"]'),
      )) {
        const host = node as HTMLElement & { dataset: { mid?: string } };
        const mid = host.dataset.mid;
        if (!mid) continue;
        const h = Math.ceil(host.getBoundingClientRect().height);
        if (h <= 0) continue;
        if (next.get(mid) !== h) {
          if (!mutated) {
            measuredHeights.value = new Map(next);
            mutated = true;
          }
          measuredHeights.value.set(mid, h);
        }
      }
      if (mutated && followingLatest.value) requestFollow();
    }

    function scheduleRowMeasurement(): void {
      void nextTick(() => recordRowHeights());
    }

    // 会话切换：整表清空重建；删除：淘汰被删行；宽度变化：排版全变，
    // 全部旧值失效，等新窗口重测。
    // P1-3（round6）：conversationId 变化本身就是会话边界——旧 follow run、
    // preserve 会话与旧 messageId 锚点/高度上下文全部作废，ownership 回到
    // "跟随最新"，scrollTop 归零，等新会话加载完成后重新落到最新消息。
    watch(
      () => store.conversationId,
      () => {
        if (measuredHeights.value.size > 0) measuredHeights.value = new Map();
        resetScrollOwnership();
      },
    );
    watch(
      () => messages.value.length,
      () => {
        const size = measuredHeights.value.size;
        if (size === 0) return;
        const ids = new Set(messages.value.map((m) => m.messageId));
        if (ids.size >= size) return;
        const next = new Map(measuredHeights.value);
        for (const key of next.keys()) {
          if (!ids.has(key)) next.delete(key);
        }
        measuredHeights.value = next;
      },
    );
    // 宽度变化不清空高度表：陈旧的按行实测值仍远优于整体估算，新窗口
    // 挂载后的重测会在一两帧内以新宽度下的真实值覆盖；过渡偏移由视口锚
    // 快照按 messageId+相对偏移吸收。

    // round8（二）：保持事务的窗口覆盖——把虚拟窗口强制固定在锚行邻域
    // [start,end)，保证事务全程锚行及其视口邻域持续挂载（绝不为此挂载全部
    // 消息），并把顶垫冻结在启用瞬间的像素值：锚行的绝对坐标由"冻结原点 +
    // 窗口内实测布局"唯一决定，高度缓存批量失效引起的估算漂移不再平移
    // 坐标系。仅活动事务期间生效，释放后复核校正兜底残余位移。
    const preserveWindowOverride = ref<{ start: number; end: number } | null>(null);
    const frozenTopPadPx = ref<number | null>(null);

    /** 有界覆盖窗：锚行上、下各扩到足以盖住整个视口 + overscan 的行数。 */
    function enablePreserveWindowOverride(anchorIndex: number): void {
      const count = messages.value.length;
      if (count === 0) return;
      const up =
        Math.ceil((historyViewportPx.value + 300) / VIRTUAL_ESTIMATE_HEIGHT) + 4;
      const down =
        Math.ceil(historyViewportPx.value / VIRTUAL_ESTIMATE_HEIGHT) +
        VIRTUAL_OVERSCAN +
        4;
      preserveWindowOverride.value = {
        start: Math.max(0, anchorIndex - up),
        end: Math.min(count, anchorIndex + down),
      };
      // 冻结原点必须读取【已应用 override 之后】的顶垫高度。
      frozenTopPadPx.value = virtualWindow.value.offsetTop;
      preserveOverrideArmed = true;
      publishPreserveOverrideState(true);
      mintPreserveSelfWindowToken("arm");
    }

    function releasePreserveWindowOverride(): void {
      const wasArmed = preserveOverrideArmed;
      preserveWindowOverride.value = null;
      frozenTopPadPx.value = null;
      preserveOverrideArmed = false;
      publishPreserveOverrideState(false);
      // round10（P1-2）：只有真实 open→released 转换才产生 self 令牌；
      // 重复 release（成功路径的防御性释放等）不得铸造令牌吞掉下一个
      // 外部布局信号。
      if (wasArmed) {
        mintPreserveSelfWindowToken("release");
      }
    }

    /** round9（二）：覆盖窗生命周期的诊断发布——释放必须是可外部观察的。 */
    function publishPreserveOverrideState(open: boolean): void {
      const el = boundPreserveHost ?? historyNode();
      if (!el) return;
      el.dataset.preserveOverride = open ? "open" : "released";
    }

    /**
     * round10（P1-2）：覆盖窗自身引起的窗口级联用一次性、可核对来源的
     * 令牌标识，取代旧的跨事件布尔闩锁——闩锁会在"重复 release"后残留，
     * 把下一个真实外部布局信号误判为自身级联而吞掉。
     *
     * 令牌绑定"预期窗口键"（arm：武装后的覆盖窗键；release：释放后按无
     * 覆盖窗模型推算的自然窗口键）。virtualWindow 观察者到来时核对来源：
     * 键匹配 ⇒ 覆盖窗自身动作（release 才走有界自续期，arm 静默）；不匹配
     * ⇒ 外部信号（重置追击账本并正常路由）。两种结果都消费令牌——绝不
     * 跨事件残留。
     */
    type PreserveSelfWindowTokenKind = "arm" | "release";
    interface PreserveSelfWindowToken {
      kind: PreserveSelfWindowTokenKind;
      expectedKey: string;
    }
    let preserveSelfWindowToken: PreserveSelfWindowToken | null = null;
    let preserveOverrideArmed = false;

    function preserveWindowKey(win: {
      offsetTop: number;
      totalHeight: number;
      startIndex: number;
    }): string {
      return `${Math.round(win.offsetTop)}|${Math.round(win.totalHeight)}|${win.startIndex}`;
    }

    function mintPreserveSelfWindowToken(
      kind: PreserveSelfWindowTokenKind,
    ): void {
      preserveSelfWindowToken = {
        kind,
        expectedKey: preserveWindowKey(virtualWindow.value),
      };
    }

    const PRESERVE_SELF_REVIVAL_LIMIT = 8;
    const PRESERVE_SELF_REVIVAL_TOTAL_CAP = 32;
    let preserveRevivalStalls = 0;
    let preserveRevivalTotal = 0;
    let lastBudgetFailResidualPx: number | null = null;
    /** 成功 / 外部信号 / 用户滚动 / 会话重置：追击账本清零。 */
    function resetPreserveRevival(): void {
      preserveRevivalStalls = 0;
      preserveRevivalTotal = 0;
      lastBudgetFailResidualPx = null;
    }

    function offsetForIndexInList(index: number): number {
      const table = heightTable.value;
      let off = 0;
      const limit = Math.min(index, messages.value.length);
      for (let i = 0; i < limit; i += 1) {
        const known = table?.[i];
        off += known !== undefined && known > 0 ? known : VIRTUAL_ESTIMATE_HEIGHT;
      }
      return off;
    }

    const virtualWindow = computed(() => {
      const base = computeVirtualWindow({
        count: messages.value.length,
        scrollTop: messageScrollTop.value,
        viewportHeight: historyViewportPx.value,
        estimateHeight: VIRTUAL_ESTIMATE_HEIGHT,
        overscan: VIRTUAL_OVERSCAN,
        heights: heightTable.value,
      });
      const ov = preserveWindowOverride.value;
      if (!ov || messages.value.length === 0) return base;
      const startIndex = Math.max(0, Math.min(messages.value.length - 1, ov.start));
      const endIndex = Math.max(startIndex + 1, Math.min(messages.value.length, ov.end));
      const topPad =
        frozenTopPadPx.value !== null
          ? frozenTopPadPx.value
          : offsetForIndexInList(startIndex);
      return { ...base, startIndex, endIndex, offsetTop: topPad };
    });

    const renderedMessages = computed(() =>
      messages.value.slice(virtualWindow.value.startIndex, virtualWindow.value.endIndex),
    );
    const virtualBottomPad = computed(() => {
      // 底垫按"总高−原点−真实渲染段高度"计算；估算值扣减会在短行上留下
      // 幻影空白，把最新回复顶出可视矩形上沿。事务期顶垫被冻结时底垫仍
      // 按【未冻结的自然原点】推算，与释放后的稳态一致。
      const win = virtualWindow.value;
      let renderedHeight = 0;
      for (
        let i = win.startIndex;
        i < win.startIndex + renderedMessages.value.length;
        i += 1
      ) {
        renderedHeight +=
          measuredHeights.value.get(messages.value[i]?.messageId ?? "") ??
          VIRTUAL_ESTIMATE_HEIGHT;
      }
      if (frozenTopPadPx.value !== null) {
        const naturalOffset = offsetForIndexInList(win.startIndex);
        return Math.max(0, win.totalHeight - naturalOffset - renderedHeight);
      }
      return Math.max(
        0,
        win.totalHeight - win.offsetTop - renderedHeight,
      );
    });

    // P1/P2（round5）：用户已滚离时的视口保持——校准/spacer 重排/宽度变化
    // 会平移内容，只保数值 scrollTop 不够。以“可见 messageId + 相对 history
    // 顶边偏移”为锚，在布局突变时迭代复位。
    //
    // round8（二）：单写者保持事务——任何时刻最多一个活动事务
    // （PreserveTransaction），它是 scrollTop 的唯一写入者：
    //   • 只有真实、非回声的用户滚动可以取消当前事务、转移 ownership 并
    //     重建锚点基准；
    //   • ResizeObserver、行高回填、virtualWindow/spacer 级联只把当前事务
    //     标记为 dirty 并汇入同一个泵；绝不新建轮次抢占、不把 force 降级、
    //     不重捕获锚点、没有“大位移即 rebase”旁路；
    //   • 收尾两段：事务内残差 <1px 且窗口签名连续稳定至少两个布局批次后
    //     释放覆盖窗，nextTick+布局帧复核校正，再持续稳定 ≥320ms 才发布
    //     idle/converged；预算耗尽显性失败并保留锚点与诊断。
    interface PreserveTransaction {
      /** 创建世代：单调用点递增，仅用户滚动重建/handoff 时更换对象。 */
      generation: number;
      anchorMessageId: string;
      /** 冻结的列表索引（仅诊断/覆盖窗定位用；对齐始终按真实矩形）。 */
      anchorIndex: number;
      originalViewportOffset: number;
      phase: "aligning" | "stabilizing" | "post-release" | "done";
      dirty: boolean;
      measurementVersion: number;
      ownershipGeneration: number;
    }

    /**
     * round7 起：保持事务生命周期发布到 history 的 data-preserve-run /
     * data-preserve-phase——E2E 与诊断据此观察 active→idle；数据集属性
     * 不是成功 oracle，几何才是。
     */
    let boundPreserveHost: HTMLElement | null = null;
    function publishPreserveRunState(state: "active" | "idle"): void {
      const el = boundPreserveHost ?? historyNode();
      if (!el) return;
      el.dataset.preserveRun = state;
    }
    function publishPreservePhase(phase: string | null): void {
      const el = boundPreserveHost ?? historyNode();
      if (!el) return;
      if (phase === null) delete el.dataset.preservePhase;
      else el.dataset.preservePhase = phase;
    }

    /**
     * round7：messageId 是否仍存在于当前会话消息列表——"真删除"与"暂时
     * 卸载"的权威区分：真删除把基准无跳变移交给幸存可视行或显性失败，
     * 暂时卸载原地等待重挂载，绝不偷换锚语义。
     */
    function anchorRowDeletedForever(mid: string): boolean {
      return !messages.value.some((m) => m.messageId === mid);
    }

    /**
     * round9（四）/round10（P1-4）：最终确认删除【之前】捕获确定性幸存行
     * 快照——列表序中紧邻的前一行（不存在则后一行）与其当前 history-relative
     * offset。幸存行必须此刻已挂载（覆盖窗保证锚邻域在册）；单行列表无幸存
     * 者时返回 null，删除后将显性失败而不是读取跳变后的视图。
     *
     * round10（P1-4）：快照绑定完整 ownership 身份——会话、follow 世代、
     * 泵令牌、history 宿主节点与删除请求身份。消费时全部匹配才可用；
     * 用户滚动/rebase、会话切换、节点解绑/重建、关系解除、卸载都会立即使
     * 旧快照失效。
     */
    function capturePreDeleteHandoff(
      deletedMid: string,
      requestSeq: number,
    ): PendingDeleteHandoff | null {
      const el = historyNode();
      if (!el) return null;
      const list = messages.value;
      const doomedIdx = list.findIndex((m) => m.messageId === deletedMid);
      if (doomedIdx < 0) return null;
      const survivorMid =
        list[doomedIdx - 1]?.messageId ?? list[doomedIdx + 1]?.messageId;
      if (!survivorMid) return null;
      const rect = el.getBoundingClientRect();
      const node = Array.from(
        el.querySelectorAll('[data-testid="chat-message"]'),
      ).find(
        (n) => (n as HTMLElement & { dataset: { mid?: string } }).dataset.mid ===
          survivorMid,
      );
      if (!(node instanceof HTMLElement)) return null;
      return {
        requestSeq,
        conversationId: store.conversationId,
        ownershipGeneration: followGen,
        pumpEpoch: preservePumpEpoch,
        host: el,
        deletedMid,
        survivorMid,
        offset: node.getBoundingClientRect().top - rect.top,
      };
    }

    let activePreserveTx: PreserveTransaction | null = null;
    let preserveTxCounter = 0;
    let preservePumpRunning = false;
    /**
     * round9（一）：泵取消令牌。用户真实滚动、handoff、history 节点重建、
     * 会话切换与卸载都递增它——运行中的旧泵在下一次逐帧校验时失配退出，
     * 且绝不能被新事务“借壳”继承预算与稳定状态。
     */
    let preservePumpEpoch = 0;
    function invalidatePreservePump(): void {
      preservePumpEpoch += 1;
    }
    /**
     * round9（四）/round10（P1-4/P2-1）：最终确认删除前冻结的幸存行快照，
     * 按删除请求（deletedMid + requestSeq）隔离存放——两个删除确认重叠时
     * 各自独立，较早请求迟到完成也不会污染彼此。快照携带完整 ownership
     * 身份；只有全部仍匹配时才允许消费，否则保持用户当前阅读位置，绝不
     * snap back。
     */
    interface PendingDeleteHandoff {
      /** 删除请求身份：递增序号，并发删除按请求隔离。 */
      requestSeq: number;
      conversationId: string;
      /** 捕获时的 follow/ownership 世代。 */
      ownershipGeneration: number;
      /** 捕获时的保持泵令牌。 */
      pumpEpoch: number;
      /** 捕获时的 history 宿主节点身份。 */
      host: HTMLElement;
      deletedMid: string;
      survivorMid: string;
      offset: number;
    }
    const pendingDeleteHandoffs = new Map<string, PendingDeleteHandoff>();
    let deleteRequestSeq = 0;
    const PENDING_DELETE_HANDOFF_MAX = 4;

    function storePendingDeleteHandoff(handoff: PendingDeleteHandoff): void {
      pendingDeleteHandoffs.set(handoff.deletedMid, handoff);
      if (pendingDeleteHandoffs.size > PENDING_DELETE_HANDOFF_MAX) {
        const oldest = [...pendingDeleteHandoffs.values()].sort(
          (a, b) => a.requestSeq - b.requestSeq,
        )[0];
        if (oldest) pendingDeleteHandoffs.delete(oldest.deletedMid);
      }
    }

    /** 立即作废全部挂起快照（用户滚动/切会话/节点重建/卸载/关系解除）。 */
    function invalidatePendingDeleteHandoffs(): void {
      pendingDeleteHandoffs.clear();
    }
    /**
     * 最近一次成功结算的事务基准（含原 generation）。宽度重排等新布局事
     * 件到来而当时没有活动事务时，从这里【以同一 generation】原样复活：
     * 重排绝不读取当下视图，也绝不新建世代抢占——用户阅读位置的
     * messageId+偏移语义只随真实滚动更换。
     */
    let settledPreserveBasis: {
      generation: number;
      mid: string;
      offset: number;
      index: number;
    } | null = null;

    /** 单写者事务的唯一构造尾部；generation 由调用方决定。 */
    function spawnPreserveTxWith(
      generation: number,
      mid: string,
      offset: number,
    ): void {
      const idx = Math.max(
        0,
        messages.value.findIndex((m) => m.messageId === mid),
      );
      activePreserveTx = {
        generation,
        anchorMessageId: mid,
        anchorIndex: idx,
        originalViewportOffset: offset,
        phase: "aligning",
        dirty: true,
        measurementVersion: 0,
        ownershipGeneration: followGen,
      };
      enablePreserveWindowOverride(activePreserveTx.anchorIndex);
      // round9（二）：基准在事务诞生时即记录——基准的语义是"用户的阅读
      // 位置"（messageId+偏移），不是收敛成功证书。高刷新率下 320ms 安静
      // 窗可能跨越多个预算窗，若只在 success 时记录基准，布局信号会因
      // basis=null 而把跳变后的当下视图当新真值，阅读位置被静默换掉。
      settledPreserveBasis = {
        generation,
        mid,
        offset,
        index: activePreserveTx.anchorIndex,
      };
      publishViewportPreserve(activePreserveTx);
      const host = boundPreserveHost ?? historyNode();
      if (host) host.dataset.preserveGen = String(activePreserveTx.generation);
      publishPreservePhase("aligning");
      publishPreserveRunState("active");
      schedulePreserveTxFrame();
    }

    function spawnPreserveTransaction(mid: string, offset: number): void {
      spawnPreserveTxWith(++preserveTxCounter, mid, offset);
    }

    /**
     * 以真实 DOM 捕获保持锚：首选"完整落入可视区且离开顶缘 ≥8px"的首行；
     * fallback 必须与 history 可视矩形【真实相交】——绝不允许捕获只因
     * overscan 挂载、完全位于可视区下方的行充当基准。
     */
    function capturePreserveAnchor(): { mid: string; offset: number; index: number } | null {
      const el = historyNode();
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      let best: { mid: string; offset: number; index: number; dist: number } | null = null;
      let fallback: { mid: string; offset: number; index: number } | null = null;
      for (const node of Array.from(
        el.querySelectorAll('[data-testid="chat-message"]'),
      )) {
        const row = node as HTMLElement & { dataset: { mid?: string } };
        const mid = row.dataset.mid;
        if (!mid) continue;
        const r = row.getBoundingClientRect();
        // 完全位于顶缘上方的行（部分切出）不算候选起点；完全位于底缘
        // 下方的行只有当它与可视矩形真正相交时才能成为 fallback。
        if (r.bottom <= rect.top + 1) continue;
        if (r.top >= rect.bottom - 1) break;
        const snapOf = () => ({
          mid,
          offset: Math.max(0, r.top - rect.top),
          index: Math.max(
            0,
            messages.value.findIndex((m) => m.messageId === mid),
          ),
        });
        // round8：首选改为“最接近可视区垂直中心的完整可见行”——贴近视
        // 口中心的基准行上下都保留有效内容，补偿方向的两侧行集均有意义；
        // 同时给行内操作的验收语义留出上方邻域。
        if (
          r.top >= rect.top + 8 &&
          r.bottom <= rect.bottom + 0.5 &&
          r.top >= rect.top - 0.5
        ) {
          const dist = Math.abs(r.top + r.height / 2 - centerY);
          if (!best || dist < best.dist) {
            best = { ...snapOf(), dist };
          }
          continue;
        }
        if (!fallback) fallback = snapOf();
      }
      if (best) return { mid: best.mid, offset: best.offset, index: best.index };
      return fallback;
    }

    /** 返回使锚行回到事务原始视口偏移所需的 scrollTop 增量；未挂载返回 null。 */
    function preserveDeltaFor(tx: PreserveTransaction): number | null {
      const el = historyNode();
      if (!el) return null;
      let target: HTMLElement | null = null;
      for (const node of Array.from(
        el.querySelectorAll('[data-testid="chat-message"]'),
      )) {
        const row = node as HTMLElement & { dataset: { mid?: string } };
        if (row.dataset.mid === tx.anchorMessageId) {
          target = row;
          break;
        }
      }
      if (!target) return null; // 暂时卸载：等待测量回填带回。
      return (
        target.getBoundingClientRect().top -
        el.getBoundingClientRect().top -
        tx.originalViewportOffset
      );
    }

    function publishViewportPreserve(tx: PreserveTransaction): void {
      const el = historyNode() as
        | (HTMLElement & { dataset: { preserveMid?: string; preserveOff?: string } })
        | null;
      if (!el) return;
      el.dataset.preserveMid = tx.anchorMessageId;
      el.dataset.preserveOff = tx.originalViewportOffset.toFixed(2);
    }

    function clearPreserveAnchorDataset(): void {
      const el = boundPreserveHost ?? historyNode();
      if (!el) return;
      delete el.dataset.preserveMid;
      delete el.dataset.preserveOff;
      delete el.dataset.preservePhase;
    }

    /**
     * 静默放弃事务（回到自动跟随 / ownership 全量重置）：释放覆盖窗并把
     * 生命周期发布回 idle；不做任何失败标注。
     */
    function abandonPreserveTransaction(): void {
      invalidatePreservePump();
      activePreserveTx = null;
      settledPreserveBasis = null;
      resetPreserveRevival();
      releasePreserveWindowOverride();
      clearPreserveAnchorDataset();
      publishPreserveRunState("idle");
    }

    /**
     * 用户滚动路径（真实、非回声）：唯一的取消+重建基准入口。旧事务与其
     * 覆盖窗立即作废；新基准在本轮渲染完成后定锚（deferCapture），期间
     * 不存在任何其他 scrollTop 写入者。
     */
    function rebasePreserveByUserScroll(): void {
      invalidatePreservePump();
      activePreserveTx = null;
      settledPreserveBasis = null; // 所有权转移：旧基准作废。
      resetPreserveRevival();
      releasePreserveWindowOverride();
      // round10（P1-4）：真实用户滚动立即使挂起的删除快照失效。
      invalidatePendingDeleteHandoffs();
      beginPreserveTransaction({ deferCapture: true });
    }

    /**
     * 创建新事务并启用有界覆盖窗（冻结原点随其生效）。任何旧事务在此被
     * 无条件替换——只有两条路径会走到这里：用户滚动的所有权重建，与锚行
     * 真删除时的幸存行移交。
     *
     * deferCapture：真实滚动后的首个布局批次之前，旧窗口的挂载行可能与
     * 用户的新视口完全脱节——同步捕获只会拿到"恰好可见/相交"之外的全是
     * overscan 区域的幽灵行（round7 缺陷的根源之一）。此路径把捕获推迟到
     * 本轮渲染完成之后：期间没有任何其他写入者（单一泵尚未启动），语义
     * 安全。应用自身突变（展开/改名前锁定基准）必须同步定锚，用默认值。
     */
    function beginPreserveTransaction(
      opts: { deferCapture?: boolean } = {},
    ): void {
      if (opts.deferCapture === true) {
        // 渲染完成后逐帧重试定锚：窗口行集与新视口脱节的过渡期里允许
        // 几何短暂不可用；捕获只读、单写者泵尚未启动，重试无副作用。
        // round9（三）：闭包绑定发起时的 followGen——history 节点重建/
        // 会话切换/卸载递增令牌后，尚未执行的尝试全部自弃。
        const captureGen = followGen;
        let attemptsLeft = 16;
        const attempt = (): void => {
          if (
            captureGen !== followGen ||
            followingLatest.value ||
            activePreserveTx
          ) {
            return;
          }
          const captured = capturePreserveAnchor();
          if (captured) {
            spawnPreserveTransaction(captured.mid, captured.offset);
            return;
          }
          attemptsLeft -= 1;
          if (attemptsLeft <= 0) return; // 等待下一个布局信号路径兜底。
          requestAnimationFrame(() => attempt());
        };
        void nextTick(() => attempt());
        return;
      }
      const captured = capturePreserveAnchor();
      if (!captured) return;
      spawnPreserveTransaction(captured.mid, captured.offset);
    }

    /**
     * 应用自身触发的布局突变（展开/折叠/删除行等）：若用户已接管视口，
     * 全部信号经统一路由汇入保持事务——即使位移很大也不许被误判为
     * "用户重新定位"，不存在旁路轮次。显式通知是外部入口：不继承前一次
     * 事务的 revival/stall 账本（round10 P1-2）。
     */
    function notifyLayoutMutation(): void {
      resetPreserveRevival();
      routeLayoutSignalToPreserve();
    }

    /** 布局信号统一汇入点：只把活动事务标记为 dirty 并调度同一个泵。 */
    function markPreserveLayoutDirty(): void {
      const tx = activePreserveTx;
      if (!tx) return;
      tx.dirty = true;
      tx.measurementVersion += 1;
      schedulePreserveTxFrame();
    }

    /**
     * 全部非滚动布局信号（ResizeObserver、virtualWindow/spacer watcher、
     * 应用自身突变）的唯一路由：活动事务直接标 dirty；静止期则从最近一次
     * 成功结算的基准【同 generation】复活，绝不允许布局级联读取"已被移动
     * 过的当下视图"改写用户阅读位置；完全没有基准时才同步建立新事务。
     */
    function routeLayoutSignalToPreserve(): void {
      if (followingLatest.value) return;
      if (!activePreserveTx) {
        if (
          settledPreserveBasis &&
          !anchorRowDeletedForever(settledPreserveBasis.mid)
        ) {
          spawnPreserveTxWith(
            settledPreserveBasis.generation,
            settledPreserveBasis.mid,
            settledPreserveBasis.offset,
          );
        } else {
          // 基准缺失或其锚行已被真删除：以当下视图另立新基准（用户位置
          // 的语义只随真实滚动/删除移交更换，死锚不构成可保持的基准）。
          if (settledPreserveBasis) settledPreserveBasis = null;
          beginPreserveTransaction();
        }
        return;
      }
      markPreserveLayoutDirty();
    }

    /**
     * round9（一）：泵与【具体事务对象】一一绑定。运行中的泵绝不中途改道
     * 新事务；继任事务（用户滚动重建/handoff 产生）在旧泵 finally 退出后
     * 由这里显式启动属于它自己的新泵——帧预算、稳定批次、签名与安静窗
     * 全部从零开始，不继承任何旧局部状态。
     */
    function schedulePreserveTxFrame(): void {
      if (preservePumpRunning) return;
      const tx = activePreserveTx;
      if (!tx) return;
      preservePumpRunning = true;
      void runPreserveTransactionPump(tx).finally(() => {
        preservePumpRunning = false;
        const successor = activePreserveTx;
        if (successor && successor !== tx && !followingLatest.value) {
          schedulePreserveTxFrame();
        }
      });
    }

    /**
     * round10（P1-1）：校正写入预算与安静窗墙钟时间分离。只有真实的
     * scrollTop 校正写入消耗写入预算；无写入的稳定等待帧（320ms 安静窗、
     * 暂时卸载等待测量回填）只受墙钟截止约束——120/144Hz 下安静窗需要
     * 40+ 帧，按帧数计预算会把正常事务误判为预算耗尽。任何事务都必须在
     * 墙钟截止内收敛或显性失败：持续签名扰动/持续校正写入都是真实的
     * 非收敛输入，按各自维度有界失败。
     */
    const PRESERVE_TX_WRITE_BUDGET = 36;
    const PRESERVE_TX_DEADLINE_MS = 4_000;
    /** 释放覆盖窗前要求窗口签名连续稳定的布局批次数。 */
    const PRESERVE_TX_RELEASE_STABLE_BATCHES = 3;
    /** 释放复核后要求持续静止的时长。 */
    const PRESERVE_TX_SETTLE_MS = 320;

    function succeedPreserveTransaction(tx: PreserveTransaction, residual: number): void {
      // round9（二）：成功只允许发生在 post-release 相位——任何提前路径
      // （含预算尾部的旧捷径）一律按显性失败处理，绝不让未走完
      // aligning→stabilizing→post-release 的事务宣告收敛。
      if (tx.phase !== "post-release") {
        failPreserveTransaction(`success-out-of-phase:${tx.phase}`);
        return;
      }
      // 防御性释放：任何异常路径都不允许遗留冻结窗口/顶垫。
      releasePreserveWindowOverride();
      tx.phase = "done";
      const el = historyNode();
      if (el) {
        el.dataset.preserveConverged = "true";
        el.dataset.preserveResidualPx = residual.toFixed(2);
      }
      settledPreserveBasis = {
        generation: tx.generation,
        mid: tx.anchorMessageId,
        offset: tx.originalViewportOffset,
        index: tx.anchorIndex,
      };
      resetPreserveRevival();
      publishPreservePhase(null);
      publishPreserveRunState("idle");
      activePreserveTx = null;
    }

    /**
     * 预算耗尽 / 锚点不可用的显性失败：保留锚点与诊断属性供测试取证，
     * 不做任何偷偷重基准；窗口覆盖必须释放，否则虚拟列表此后死锁在旧
     * 邻域。
     */
    function failPreserveTransaction(
      residualLabel: string,
      residualPx: number | null = null,
    ): void {
      const el = boundPreserveHost ?? historyNode();
      if (el) {
        el.dataset.preserveConverged = "false";
        el.dataset.preserveResidualPx = residualLabel;
      }
      console.warn("[chat] preserve anchor did not settle:", residualLabel);
      // round9（二）：预算耗尽的追击账本——残差已 <1px 说明钉住目标已达成
      // （只剩安静窗装不进预算窗），立即停止自续期；残差仍在收敛（有进展）
      // 不累计停转，慢级联（宽度重排）得以跨预算窗继续追击；无进展才累计，
      // 加上总量硬上限，保证任何序列下都有界。
      if (residualLabel.startsWith("budget:")) {
        if (residualPx !== null && residualPx < 1) {
          preserveRevivalStalls = PRESERVE_SELF_REVIVAL_LIMIT;
        } else if (
          lastBudgetFailResidualPx !== null &&
          residualPx !== null &&
          residualPx + 1 < lastBudgetFailResidualPx
        ) {
          preserveRevivalStalls = Math.max(0, preserveRevivalStalls - 1);
        } else {
          preserveRevivalStalls += 1;
        }
        lastBudgetFailResidualPx = residualPx;
        preserveRevivalTotal += 1;
      } else {
        resetPreserveRevival();
      }
      releasePreserveWindowOverride();
      publishPreservePhase(null);
      publishPreserveRunState("idle");
      activePreserveTx = null;
    }

    /**
     * 单写者泵：活动事务的唯一执行者。每个布局批次至多推进一帧校正
     * （一次 scrollTop 写入）；高度回填/窗口级联只通过 dirty 与窗口签名
     * 影响稳定性判定，由本泵继续补偿，绝无并行轮次。
     *
     * round9（一）：泵在启动时捕获【不可变的事务对象、泵令牌、ownership
     * 世代与 history 节点】，此后每帧四重校验——任何失配即退出，旧泵永远
     * 不能为继任事务写 scrollTop、也不能替它结算；继任事务由
     * schedulePreserveTxFrame 的 finally 显式接力，其全部局部状态从零开始。
     *
     * round10（P1-1）：帧预算拆成两个独立维度——校正写入预算（只有真实
     * scrollTop 写入消耗）与墙钟截止（安静窗/等待帧只受它约束）。
     */
    async function runPreserveTransactionPump(tx: PreserveTransaction): Promise<void> {
      const myEpoch = preservePumpEpoch;
      const hostEl = historyNode();
      let writesLeft = PRESERVE_TX_WRITE_BUDGET;
      const deadlineAt = Date.now() + PRESERVE_TX_DEADLINE_MS;
      let stableBatches = 0;
      let prevSignature = "";
      let stableSinceMs = -1;
      const waitRaf = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const waitLayoutFrame = () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      const identityValid = (el: HTMLElement | null): boolean =>
        activePreserveTx === tx &&
        preservePumpEpoch === myEpoch &&
        tx.ownershipGeneration === followGen &&
        el !== null &&
        el === hostEl;
      const deadlinePassed = (): boolean => Date.now() >= deadlineAt;
      const budgetFail = (kind: string, residualPx: number | null): void => {
        failPreserveTransaction(
          residualPx === null
            ? `budget:${kind}:anchor-unavailable`
            : `budget:${kind}:${Math.abs(residualPx).toFixed(2)}px`,
          residualPx === null ? null : Math.abs(residualPx),
        );
      };
      const correctionWrite = (el: HTMLElement, delta: number): boolean => {
        if (writesLeft <= 0) {
          budgetFail("writes", delta);
          return false;
        }
        if (deadlinePassed()) {
          budgetFail("deadline", delta);
          return false;
        }
        writesLeft -= 1;
        stableBatches = 0;
        setProgrammaticScroll(el, el.scrollTop + delta);
        return true;
      };
      try {
        await nextTick();
        await waitLayoutFrame();
        for (;;) {
          if (followingLatest.value) return;
          const el = historyNode();
          if (el === null || !identityValid(el)) return; // 身份/令牌/ownership/节点失配。

          // 锚行真删除：以【删除前冻结的幸存行快照】无跳变移交——先释放
          // 覆盖窗让布局落到自然原点，再按快照偏移重建事务；快照身份与
          // 当下不完全匹配（请求挂起期间用户滚动/切会话/节点重建/卸载）
          // 时绝不消费旧快照，保持当前阅读位置并显性失败。
          if (anchorRowDeletedForever(tx.anchorMessageId)) {
            releasePreserveWindowOverride();
            clearPreserveAnchorDataset();
            await nextTick();
            await waitLayoutFrame();
            if (!identityValid(historyNode())) return;
            const handoff = pendingDeleteHandoffs.get(tx.anchorMessageId) ?? null;
            pendingDeleteHandoffs.delete(tx.anchorMessageId);
            const consumable =
              handoff !== null &&
              handoff.conversationId === store.conversationId &&
              handoff.ownershipGeneration === followGen &&
              handoff.pumpEpoch === myEpoch &&
              handoff.host === hostEl;
            if (!consumable) {
              failPreserveTransaction(
                handoff === null ? "anchor-unavailable" : "handoff-stale",
              );
              return;
            }
            activePreserveTx = null;
            // spawnPreserveTxWith 会立即记录幸存行基准：若 handoff 事务也
            // 因预算耗尽失败，自续期从幸存行基准继续追击，绝不回退到已
            // 删除锚行。
            spawnPreserveTransaction(handoff.survivorMid, handoff.offset);
            return; // 旧泵到此为止；继任事务由 finally 显式接力。
          }

          // 窗口签名：scrollHeight + 虚拟窗口边界共同构成"布局批次"判定；
          // 回填导致的任何再排都会翻转签名并重置稳定计数。
          const win = virtualWindow.value;
          const signature = `${Math.round(el.scrollHeight)}|${win.startIndex}|${win.endIndex}|${Math.round(win.offsetTop)}`;
          if (signature !== prevSignature) {
            prevSignature = signature;
            stableBatches = 0;
          } else {
            stableBatches += 1;
          }

          const delta = preserveDeltaFor(tx);
          if (delta === null) {
            // 暂时卸载（测量回填中）：等待锚行被覆盖窗带回挂载——等待帧
            // 不消耗校正写入预算，只受墙钟截止约束。
            if (deadlinePassed()) {
              budgetFail("deadline", null);
              return;
            }
            await waitRaf();
            continue;
          }
          const absDelta = Math.abs(delta);

          if (tx.phase === "aligning") {
            if (absDelta < 1) {
              if (stableBatches >= PRESERVE_TX_RELEASE_STABLE_BATCHES - 1) {
                tx.phase = "stabilizing";
                publishPreservePhase("stabilizing");
              }
              if (deadlinePassed()) {
                budgetFail("deadline", delta);
                return;
              }
              await waitRaf();
              continue;
            }
            if (!correctionWrite(el, delta)) return;
            await waitRaf();
            continue;
          }
          if (tx.phase === "stabilizing") {
            if (absDelta < 1 && stableBatches >= PRESERVE_TX_RELEASE_STABLE_BATCHES) {
              releasePreserveWindowOverride();
              prevSignature = "";
              stableBatches = 0;
              tx.phase = "post-release";
              publishPreservePhase("post-release");
              await nextTick();
              await waitLayoutFrame();
              continue;
            }
            // stabilizing 不写 scrollTop：等布局批次自行稳定或墙钟截止。
            if (deadlinePassed()) {
              budgetFail("deadline", delta);
              return;
            }
            await waitRaf();
            continue;
          }
          // post-release：覆盖窗已释放、正常虚拟窗口模型回归。残余位移仍
          // 由同一事务用真实矩形校正，随后连续静止 ≥320ms 才允许结算；
          // 安静窗从本事务自己进入 post-release 起算，不继承任何旧计时。
          if (absDelta < 1) {
            if (stableSinceMs < 0) stableSinceMs = Date.now();
            if (Date.now() - stableSinceMs >= PRESERVE_TX_SETTLE_MS) {
              succeedPreserveTransaction(tx, absDelta);
              return;
            }
          } else {
            stableSinceMs = -1;
            if (!correctionWrite(el, delta)) return;
          }
          if (deadlinePassed()) {
            budgetFail("deadline", delta);
            return;
          }
          await waitRaf();
        }
      } finally {
        if (!activePreserveTx) publishPreserveRunState("idle");
      }
    }

    // 布局突变（虚拟 spacer / 窗口边界）只把活动保持事务标记为 dirty——
    // round8（二）：这些内部级联绝不允许新建轮次抢占事务或重捕获锚点。
    watch(
      () => [
        virtualWindow.value.offsetTop,
        virtualWindow.value.totalHeight,
        virtualWindow.value.startIndex,
      ],
      () => {
        if (followingLatest.value) {
          abandonPreserveTransaction();
          return;
        }
        // round10（P1-2）：来源核对的一次性 self 令牌。键匹配 ⇒ 覆盖窗自身
        // 的 arm/release 级联（release 仅在最近一次事务预算耗尽后于硬上限内
        // 自续期同一基准；arm 静默）；不匹配或无令牌 ⇒ 外部信号，追击账本
        // 清零后正常路由——绝不继承前一次事务的耗尽状态。
        const token = preserveSelfWindowToken;
        preserveSelfWindowToken = null;
        if (
          token !== null &&
          preserveWindowKey(virtualWindow.value) === token.expectedKey
        ) {
          if (token.kind === "release") {
            if (
              !activePreserveTx &&
              settledPreserveBasis &&
              preserveRevivalStalls < PRESERVE_SELF_REVIVAL_LIMIT &&
              preserveRevivalTotal < PRESERVE_SELF_REVIVAL_TOTAL_CAP
            ) {
              routeLayoutSignalToPreserve();
            }
          }
          return;
        }
        resetPreserveRevival();
        routeLayoutSignalToPreserve();
      },
    );

    // 测量时机观察最终渲染窗口（含已测高度参与计算的结果）：估算→实测的
    // 重排会把窗口推到新的边界，只有观察最终输出才不会漏测新挂载行；展开/
    // 折叠等行内状态变化也会改变行高，同样进入测量。
    watch(
      () => [
        virtualWindow.value.startIndex,
        virtualWindow.value.endIndex,
        virtualWindow.value.totalHeight,
        openMsgId.value,
        reportMsgId.value,
        confirmDeleteMsgId.value,
      ],
      () => scheduleRowMeasurement(),
    );


    function onHistoryScroll(event: Event): void {
      const target = event.target as
        | { scrollTop?: number; scrollHeight?: number; clientHeight?: number }
        | null;
      if (!target || typeof target.scrollTop !== "number") return;
      historyScrollTop.value = target.scrollTop;
      // round10（P1-3）：引擎自身写入的迟到回声——按落点一次性消费票据后
      // 忽略。票据被用户意图失效或已消费/过期时，即使读数恰好等于最近一
      // 次程序写入落点，也是真实用户语义（ownership 转移/回底恢复跟随/
      // 重定基准），绝不无限承认同一落点。
      if (consumeScrollEchoAck(target.scrollTop)) return;
      if (followingLatest.value) {
        transferOwnership();
      } else if (resumeFollowFromLayout()) {
        abandonPreserveTransaction();
        requestFollow();
      } else {
        // 已离开状态下的又一次真实滚动：唯一允许的取消+重建基准路径
        // （round8（二））——旧事务连同覆盖窗一并作废，新基准取当前视图。
        rebasePreserveByUserScroll();
      }
    }

    // P1/P2（round6）：跟随状态机。跟随目标是"最新流式草稿 / 最新正式消息"
    // 的底边，而不是尾部元数据行的绝对底部。
    //
    // 三阶段一次性收敛（禁止绝对底 ↔ 锚点对齐来回振荡）：
    //   materialize-latest —— 虚拟窗口尚未挂载到尾部时向估算尾部推进；
    //     这是唯一允许写 scrollHeight 绝对底的阶段，锚点一旦挂载即离开。
    //   align-anchor —— 以锚点矩形为唯一目标做纯对齐：delta =
    //     anchorBottom - containerBottom；尾部元数据造成的 gapToMax 与本
    //     阶段无关，绝不构成再次跳绝对底的理由。
    //   verify-stable —— 进入时用当前真实几何初始化采样基线；此后逐帧比对，
    //     scrollTop / scrollHeight / 锚点矩形连续多帧一致且持续 ≥VERIFY_MIN_MS，
    //     且期间无新的 dirty 信号，才结算为 idle；结算后状态机停止，
    //     不排队任何帧、不读写布局。
    //
    // 合并规则：进行中的 run 只把后续 delta 标记为 dirty（结算前只触发一次
    // 重新对齐），不递增令牌；用户手势（非回声滚动）才递增 followGen 作废全部帧。
    const followingLatest = ref(true);
    /** ownership 取消令牌：任何一次真实接管都会使未执行的帧作废。 */
    let followGen = 0;
    let activeFollowRun: FollowRun | null = null;

    type FollowPhaseName = "materialize-latest" | "align-anchor" | "verify-stable";

    interface FollowRun {
      phase: FollowPhaseName;
      dirty: boolean;
      /** 本轮已消耗的 dirty 重对齐次数（dirty 只允许触发一次）。 */
      realignsUsed: number;
      materializeWrites: number;
      /** P1-2：对齐写入预算属于当前 run，跨 run 不残留。 */
      alignWrites: number;
      stallFrames: number;
      prevAbsDelta: number;
      lastScrollHeight: number;
      stableFrames: number;
      stableSinceMs: number;
      lastSample: string;
    }

    const VERIFY_FRAMES = 3;
    const VERIFY_MIN_MS = 250;
    const MAX_MATERIALIZE_WRITES = 240;
    const RESUME_GAP_PX = 48;
    const STALL_FRAME_LIMIT = 120;
    const MAX_ALIGN_WRITES = 400;

    /**
     * P1-2：run 生命周期可观察状态发布到 history 的 data-follow-run 属性——
     * 单元测试 / E2E / 诊断共用同一事实源，idle 即"activeFollowRun=null 且
     * 不再排队任何帧"。卸载时模板 ref 会先于 unmounted 钩子清空，这里用
     * 绑定期缓存的节点兜底，保证卸载路径也能把 idle 发布出去。
     */
    let boundHistoryEl: HTMLElement | null = null;

    function publishFollowRunState(): void {
      const el = boundHistoryEl ?? historyNode();
      if (!el) return;
      el.dataset.followRun = activeFollowRun ? "active" : "idle";
    }

    /** 取消挂起的 follow run（节点替换 / 卸载 / ownership 重置）。不递增令牌。 */
    function cancelFollowRun(): void {
      if (!activeFollowRun) return;
      activeFollowRun = null;
      publishFollowRunState();
    }

    /** 结算当前 run：回到 idle，不再排队任何帧。 */
    function finishFollowRun(): void {
      activeFollowRun = null;
      publishFollowRunState();
    }

    /** P2（round6）→ round8（二）：宽度变化 ⇒ 换行全变 ⇒ 按事务序列处理：
     * 用户接管态下先确认冻结锚与有界覆盖窗就位（缺失则以当前视图补建，
     * 冻结发生在高度缓存失效之前），随后才整表失效并批量重测；此后所有
     * 布局批次都汇入同一事务的泵。epoch 发布到 history 的
     * data-height-cache-epoch，供测试与诊断确认失效确实发生。 */
    function remeasureAfterWidthChange(): void {
      if (followingLatest.value) {
        measuredHeights.value = new Map();
        heightCacheEpoch += 1;
        const followHost = boundHistoryEl ?? historyNode();
        if (followHost) followHost.dataset.heightCacheEpoch = String(heightCacheEpoch);
        requestFollow();
        scheduleRowMeasurement();
        return;
      }
      // round8（二）序列：先冻结不可变基准（messageId/index/history-relative
      // offset），并启用覆盖窗保证锚邻域持续挂载；然后才失效旧宽度的高度
      // 缓存并触发批量重测。基准续期走统一路由；宽度变化是真实外部入口，
      // 不继承前一次事务的 revival/stall 账本（round10 P1-2）。
      resetPreserveRevival();
      routeLayoutSignalToPreserve();
      measuredHeights.value = new Map();
      heightCacheEpoch += 1;
      const host = boundHistoryEl ?? historyNode();
      if (host) host.dataset.heightCacheEpoch = String(heightCacheEpoch);
      markPreserveLayoutDirty();
      scheduleRowMeasurement();
    }

    /**
     * P1-3 会话级 ownership 重置：切会话 / 新会话 / 关系解除后重新激活时——
     * 取消旧 follow run 与 preserve 会话、清理旧 messageId 锚点和高度上下文、
     * 恢复 followingLatest=true 并把旧会话遗留的 scrollTop 归零；新会话加载
     * 完成后由三阶段状态机落到最新消息（两个长会话间互不沿用）。
     */
    function resetScrollOwnership(): void {
      followingLatest.value = true;
      followGen += 1;
      cancelFollowRun();
      abandonPreserveTransaction();
      invalidatePendingDeleteHandoffs();
      measuredHeights.value = new Map();
      msgFlowTopPx.value = 0;
      const el = historyNode();
      if (el) {
        delete el.dataset.preserveConverged;
        delete el.dataset.preserveResidualPx;
        el.dataset.followRun = "idle";
        setProgrammaticScroll(el, 0);
        measureHistory();
      }
    }


    /**
     * round10（P1-3）：程序滚动回声的一次性确认票据。每次引擎写 scrollTop
     * 都铸造一张票据（落点=读回钳制后的值）；一个真实 scroll 事件按落点
     * 匹配并【消费一张】后立即失效——同一落点绝不允许被无限承认。票据有
     * 有界 TTL：布局卡顿下浏览器回声事件可能迟到数帧，仍被容忍；但禁止
     * 以"事务仍 active"为理由无限期承认。用户滚动意图（wheel/touchstart/
     * pointerdown、Home/End/PageUp/PageDown/Space/方向键）先使全部未消费
     * 票据失效。
     */
    interface ScrollEchoAck {
      top: number;
      mintedAt: number;
    }
    const SCROLL_ECHO_ACK_TTL_MS = 800;
    const SCROLL_ECHO_ACK_POOL_MAX = 4;
    let pendingScrollEchoAcks: ScrollEchoAck[] = [];

    function mintScrollEchoAck(top: number): void {
      pendingScrollEchoAcks.push({ top, mintedAt: Date.now() });
      if (pendingScrollEchoAcks.length > SCROLL_ECHO_ACK_POOL_MAX) {
        pendingScrollEchoAcks.splice(
          0,
          pendingScrollEchoAcks.length - SCROLL_ECHO_ACK_POOL_MAX,
        );
      }
    }

    function invalidateScrollEchoAcks(): void {
      pendingScrollEchoAcks = [];
    }

    /** 一次性消费：事件落点匹配一张未过期票据即消费该票据。 */
    function consumeScrollEchoAck(top: number): boolean {
      const now = Date.now();
      pendingScrollEchoAcks = pendingScrollEchoAcks.filter(
        (ack) => now - ack.mintedAt <= SCROLL_ECHO_ACK_TTL_MS,
      );
      const idx = pendingScrollEchoAcks.findIndex(
        (ack) => Math.abs(top - ack.top) <= ECHO_TOLERANCE_PX,
      );
      if (idx < 0) return false;
      pendingScrollEchoAcks.splice(idx, 1);
      return true;
    }

    const ECHO_TOLERANCE_PX = 1;

    /** 跟随锚点：流式时是草稿元素，否则是最后一条真实消息行。 */
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

    /** 最后一个挂载消息行的虚拟索引；无挂载返回 -1。 */
    function lastMountedVindex(el: HTMLElement): number {
      const nodes = el.querySelectorAll('[data-testid="chat-message"]');
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const node = nodes[i] as HTMLElement & { dataset: { vindex?: string } };
        const idx = Number(node.dataset.vindex);
        if (Number.isInteger(idx)) return idx;
      }
      return -1;
    }

    function transferOwnership(): void {
      followingLatest.value = false;
      followGen += 1;
      // round7（P2）：不能只把内部指针置空——必须同步发布 data-follow-run
      // "idle"，外部观察者与测试才看得到状态机已停止。
      activeFollowRun = null;
      publishFollowRunState();
      // 接管瞬间锁定“用户看到的视图”为后续引擎自纠错的唯一基准：
      // round8（二）——真实滚动是唯一允许取消旧事务并重建锚点的路径；
      // 锚在本轮渲染完成后定基（用户滚动后旧窗口挂载行可能整体脱节）。
      invalidatePreservePump();
      activePreserveTx = null;
      releasePreserveWindowOverride();
      resetPreserveRevival();
      // round10（P1-4）：接管即旧 handoff 的 ownership 世代失效。
      invalidatePendingDeleteHandoffs();
      beginPreserveTransaction({ deferCapture: true });
    }

    /** 已离开后是否回到了“底部附近”（回到阈值内即恢复自动跟随）。 */
    function resumeFollowFromLayout(): boolean {
      const el = historyNode();
      if (!el) return false;
      if (el.scrollHeight <= el.clientHeight) {
        followingLatest.value = true;
        return true;
      }
      const gap = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (gap > RESUME_GAP_PX) return false;
      followingLatest.value = true;
      return true;
    }

    function setProgrammaticScroll(el: HTMLElement, top: number): void {
      el.scrollTop = top;
      // 读回浏览器钳制后的实际值：回声票据绑定真实落点，而非请求值。
      const landed = el.scrollTop;
      mintScrollEchoAck(landed);
      historyScrollTop.value = landed;
    }

    function sampleGeometry(el: HTMLElement): string {
      const anchor = currentAnchorNode();
      if (!anchor) return `s${el.scrollTop}h${el.scrollHeight}`;
      const r = anchor.getBoundingClientRect();
      return `${el.scrollTop}:${el.scrollHeight}:${Math.round(r.top)}:${Math.round(r.height)}`;
    }

    function followTick(gen: number, el: HTMLElement): void {
      // 每帧执行前重新校验：令牌、ownership、当前节点同一性。
      if (gen !== followGen || !followingLatest.value || !activeFollowRun) {
        return;
      }
      if (historyNode() !== el) {
        // 节点被替换/卸载：本轮作废并释放 idle，允许新节点创建全新 run。
        cancelFollowRun();
        return;
      }
      const run = activeFollowRun;

      if (run.phase === "materialize-latest") {
        const count = messages.value.length;
        const mounted = isStreaming.value && paintedDraft.value
          ? count - 1 // 流式期锚点是草稿节点，永远位于内容尾端之后
          : lastMountedVindex(el);
        if (count === 0 || mounted >= count - 1) {
          run.phase = "align-anchor";
        } else if (run.materializeWrites >= MAX_MATERIALIZE_WRITES) {
          finishFollowRun();
          return;
        } else {
          run.materializeWrites += 1;
          setProgrammaticScroll(el, el.scrollHeight);
          requestAnimationFrame(() => followTick(gen, el));
          return;
        }
      }

      if (run.phase === "align-anchor") {
        const unstable = run.lastScrollHeight !== el.scrollHeight;
        run.lastScrollHeight = el.scrollHeight;
        if (!unstable) {
          const anchor = currentAnchorNode();
          if (anchor) {
            const delta =
              Math.ceil(
                anchor.getBoundingClientRect().bottom -
                  el.getBoundingClientRect().bottom,
              );
            if (Math.abs(delta) > 1) {
              if (run.alignWrites >= MAX_ALIGN_WRITES) {
                finishFollowRun();
                return;
              }
              // 停滞保护：写入未能实质缩短距离 → 计数，超过限次放弃本轮
              // （等待下一个真实信号重新发起），绝不空转振荡。
              if (Math.abs(delta) + 1 >= run.prevAbsDelta) {
                run.stallFrames += 1;
              } else {
                run.stallFrames = 0;
              }
              run.prevAbsDelta = Math.abs(delta);
              if (run.stallFrames > STALL_FRAME_LIMIT) {
                finishFollowRun();
                return;
              }
              run.alignWrites += 1;
              setProgrammaticScroll(el, el.scrollTop + delta);
              requestAnimationFrame(() => followTick(gen, el));
              return;
            }
            run.prevAbsDelta = 0;
            run.stallFrames = 0;
            // P1-2：进入 verify-stable 即用当前真实几何初始化采样基线，
            // 首帧不再因空基线退回 align（旧实现因此永久振荡、rAF 不休）。
            run.phase = "verify-stable";
            run.stableFrames = 0;
            run.stableSinceMs = Date.now();
            run.lastSample = sampleGeometry(el);
            requestAnimationFrame(() => followTick(gen, el));
            return;
          }
          // 无锚点可对齐（空会话）：无事可做，直接结束。
          finishFollowRun();
          return;
        }
        requestAnimationFrame(() => followTick(gen, el));
        return;
      }

      // verify-stable：物理采样逐项一致才推进；与进入时的基线不同即真实
      // 几何变化，回到 align 做一次重对齐。dirty 只触发一次额外重对齐；
      // 连续稳定 ≥VERIFY_FRAMES 且持续 ≥VERIFY_MIN_MS 才结算为 idle——
      // 结算后不再排队任何 rAF、不读写布局，直到新信号发起新的 run。
      const sample = sampleGeometry(el);
      if (sample !== run.lastSample) {
        run.phase = "align-anchor";
        run.stableFrames = 0;
        requestAnimationFrame(() => followTick(gen, el));
        return;
      }
      run.stableFrames += 1;
      if (
        run.stableFrames < VERIFY_FRAMES ||
        Date.now() - run.stableSinceMs < VERIFY_MIN_MS
      ) {
        requestAnimationFrame(() => followTick(gen, el));
        return;
      }
      if (run.dirty && run.realignsUsed < 1) {
        // 新内容标记只换来一次重对齐机会；绝不形成永久循环。
        run.dirty = false;
        run.realignsUsed += 1;
        run.phase = "align-anchor";
        run.stableFrames = 0;
        run.lastSample = "";
        requestAnimationFrame(() => followTick(gen, el));
        return;
      }
      finishFollowRun();
    }

    /**
     * 发起/合并一次跟随机运行。已有活动 run 时只标记 dirty——快速连续的
     * 流式 delta 共享同一条收敛循环；新的合法工作顺带解除停滞预算，
     * 因为调用者本身证明内容仍在推进。
     */
    function requestFollow(): void {
      if (!followingLatest.value) return;
      const el = historyNode();
      // 无布局环境（happy-dom）scrollHeight 为 0：跳过，不覆盖测试设置的
      // scrollTop；真实浏览器 scrollHeight ≥ clientHeight > 0。
      if (!el || el.scrollHeight <= 0) return;
      if (activeFollowRun) {
        activeFollowRun.dirty = true;
        return;
      }
      activeFollowRun = {
        phase: "materialize-latest",
        dirty: false,
        realignsUsed: 0,
        materializeWrites: 0,
        alignWrites: 0,
        stallFrames: 0,
        prevAbsDelta: 0,
        lastScrollHeight: el.scrollHeight,
        stableFrames: 0,
        stableSinceMs: 0,
        lastSample: "",
      };
      publishFollowRunState();
      const gen = followGen;
      void nextTick(() => {
        if (gen !== followGen || !followingLatest.value || historyNode() !== el) {
          // 作废路径同样释放 idle（节点替换由 cancelFollowRun 兜底）。
          if (activeFollowRun && historyNode() !== el) cancelFollowRun();
          return;
        }
        followTick(gen, el);
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
      notifyLayoutMutation();
    }

    function onReportMessage(messageId: string): void {
      reportMsgId.value = reportMsgId.value === messageId ? null : messageId;
      notifyLayoutMutation();
    }

    /** MSG-DELETE: two-step confirm, then delete through the store. */
    async function onDeleteMessage(messageId: string): Promise<void> {
      if (confirmDeleteMsgId.value === messageId) {
        confirmDeleteMsgId.value = null;
        // round10（P1-4/P2-1）：确认前冻结完整身份绑定的幸存行快照；只有
        // guarded 的真实返回值 deleted === true 才保留快照——false（403/404
        // 存在性隐藏）、undefined 与异常（actionError）一律清除，绝不留下
        // 可能被迟到的泵消费的旧落点。
        const requestSeq = ++deleteRequestSeq;
        const handoff = capturePreDeleteHandoff(messageId, requestSeq);
        if (handoff) storePendingDeleteHandoff(handoff);
        const deleted = await guarded(() => store.removeMessage(transport, messageId));
        if (deleted !== true) {
          pendingDeleteHandoffs.delete(messageId);
        }
        notifyLayoutMutation();
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
      // P1（round5 状态机）：切到会话即发起一次三阶段锚定收敛。
      requestFollow();
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
      // P1-3（round6）：打开改名行是应用发起的布局突变——变更前先把
      // "用户此刻看到的视图"定为保持基准，变更引起的视口收缩由保持引擎
      // 按基准精确复原（无会话时这里补建，防止无基准可依的失控位移）。
      if (!followingLatest.value && !activePreserveTx) {
        beginPreserveTransaction();
      }
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
          // P1（round5 状态机）：进入页面直接锚定最新消息，短视口也能读到
          // 当前轮。
          requestFollow();
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
      // P1-2：卸载即取消挂起的 follow run，不让任何帧在拆卸后的节点上运行。
      cancelFollowRun();
      followGen += 1;
      // round9（三）：卸载即清算保持机制——泵令牌失效、活动事务与覆盖窗
      // 释放、延迟定锚作废（followGen 已递增）；此后任何迟到的 rAF 都因
      // 身份校验退出，不再写 DOM。
      invalidatePreservePump();
      abandonPreserveTransaction();
      invalidatePendingDeleteHandoffs();
      boundPreserveHost = null;
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
  /* P2（round5）：滚动容器声明为定位上下文，消息行的 offsetTop 才是"相对
     滚动内容原点"的局部坐标——虚拟窗口用它扣除头部条件行高度。 */
  position: relative;
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
