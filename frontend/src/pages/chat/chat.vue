<template>
  <!-- 沉浸式对话详情：无四入口底栏。结构固定为：简洁顶栏 + 唯一纵向
       滚动区（消息历史）+ 底部输入区。低频管理动作全部收进"更多"菜单。 -->
  <view class="chat-page">
    <header class="chat-header vc-chrome" role="banner">
      <button
        type="button"
        class="chat-header__icon-btn vc-tap"
        data-testid="nav-conversations"
        aria-label="返回对话列表"
        @click="goTo(conversationsHref())"
      >
        <AppIcon name="back" :size="20" />
      </button>

      <view class="chat-header__identity">
        <text class="vc-sr-only" role="heading" aria-level="1">对话</text>
        <text v-if="headerCompanionName" class="chat-header__name" data-testid="chat-companion-name">
          {{ headerCompanionName }}
        </text>
        <text v-else class="chat-header__name">对话</text>
        <text class="chat-header__ai" data-testid="chat-ai-label">AI · 非真人</text>
      </view>

      <button
        type="button"
        class="chat-header__icon-btn vc-tap"
        data-testid="chat-context-open"
        aria-label="打开更多操作"
        :aria-expanded="menuOpen ? 'true' : 'false'"
        @click="menuOpen = true"
      >
        <AppIcon name="more" :size="20" />
      </button>
    </header>

    <!-- 更多菜单：会话管理、无痕、对话模式、导航与登出。 -->
    <AppSheet :open="menuOpen" title="更多操作" @close="menuOpen = false">
      <view class="sheet-section" data-testid="conversation-panel">
        <text class="sheet-label">会话</text>
        <view class="sheet-conversations">
          <button
            v-for="conv in conversations"
            :key="conv.conversationId"
            class="sheet-conv-item"
            :class="{ 'sheet-conv-item--active': conv.conversationId === store.conversationId }"
            data-testid="conversation-item"
            :disabled="isStreaming"
            @click="onOpenConversation(conv.conversationId)"
          >
            {{ conversationLabel(conv) }}
            <text v-if="conv.incognito" class="sheet-conv-incognito">无痕</text>
          </button>
          <text v-if="conversations.length === 0" class="sheet-empty">还没有会话</text>
        </view>
        <view
          v-if="conversationOpenError"
          class="chat-block-error"
          data-testid="conversation-open-error"
          role="alert"
        >
          <text>会话加载失败，请再试一次</text>
        </view>
        <view class="sheet-row">
          <button
            class="sheet-item"
            data-testid="new-conversation"
            :disabled="isStreaming"
            @click="onNewConversation"
          >
            新建会话
          </button>
          <button
            class="sheet-item"
            data-testid="incognito-toggle"
            :aria-pressed="incognitoNext"
            :disabled="isStreaming"
            @click="incognitoNext = !incognitoNext"
          >
            {{ incognitoNext ? "无痕：开（下次新会话）" : "无痕：关（下次新会话）" }}
          </button>
        </view>
      </view>

      <view class="sheet-section">
        <text class="sheet-label">当前会话</text>
        <view class="sheet-row">
          <button
            class="sheet-item"
            data-testid="conversation-rename"
            :disabled="isStreaming || !store.conversationId"
            @click="startRename"
          >
            改名
          </button>
          <button
            class="sheet-item"
            data-testid="end-today"
            :disabled="isStreaming || !store.conversationId"
            @click="onEndToday"
          >
            {{ confirmEndToday ? "确认结束？" : "结束今天的对话" }}
          </button>
          <button
            class="sheet-item sheet-item--danger"
            data-testid="conversation-delete"
            :disabled="isStreaming || !store.conversationId"
            @click="onDeleteConversation"
          >
            {{ confirmDeleteId ? "确认删除？" : "删除会话" }}
          </button>
        </view>
      </view>

      <view class="sheet-section">
        <text class="sheet-label">对话模式</text>
        <view class="sheet-row" data-testid="mode-row" role="group" aria-label="选择对话模式">
          <button
            v-for="opt in MODE_OPTIONS"
            :key="opt.value"
            class="sheet-item"
            :class="{ 'sheet-item--active': selectedMode === opt.value }"
            :data-testid="`mode-${opt.value.toLowerCase()}`"
            :aria-pressed="selectedMode === opt.value"
            :disabled="isStreaming"
            @click="onSelectMode(opt.value)"
          >
            {{ opt.label }}
          </button>
        </view>
      </view>

      <view class="sheet-section">
        <text class="sheet-label">前往</text>
        <view class="sheet-row">
          <button
            class="sheet-item"
            data-testid="nav-memory"
            aria-label="记忆管理"
            @click="menuOpen = false; goTo(memoryHref())"
          >
            记忆管理
          </button>
          <button
            class="sheet-item"
            data-testid="nav-companion"
            aria-label="角色设置"
            @click="menuOpen = false; goTo(companionHref())"
          >
            角色设置
          </button>
        </view>
        <view class="sheet-row">
          <button
            v-if="relStore.currentRelationshipId"
            class="sheet-item sheet-item--danger"
            data-testid="chat-deactivate"
            @click="onDeactivate"
          >
            {{ confirmDeactivate ? "确认停用？" : "停用当前陪伴" }}
          </button>
          <button
            v-if="!auth.isAuthenticated"
            class="sheet-item"
            data-testid="nav-login"
            @click="menuOpen = false; goTo('/pages/login/login')"
          >
            登录
          </button>
          <button
            v-if="auth.isAuthenticated"
            class="sheet-item sheet-item--danger"
            data-testid="logout"
            @click="menuOpen = false; onLogout()"
          >
            登出
          </button>
        </view>
      </view>
    </AppSheet>

    <view class="chat-main" role="main">
      <view v-if="initError" class="chat-block-error" data-testid="chat-init-error" role="alert">
        <text>初始化失败，请刷新重试</text>
        <text v-if="initRequestId" class="chat-block-error__id">{{ initRequestId }}</text>
      </view>

      <template v-else>
        <!-- 无关系：唯一滚动容器是 chat-setup，与 chat-history 互斥。 -->
        <view v-if="!hasRelationship" class="chat-setup">
          <text
            v-if="serviceHint"
            class="context-hint"
            data-testid="service-mode-hint"
          >{{ serviceHint }}</text>
          <view class="chat-create-entry" data-testid="chat-create-companion">
            <text class="chat-create-entry__lead">还没有陪伴关系。</text>
            <button
              class="btn-primary"
              data-testid="chat-create-companion-go"
              @click="goTo('/pages/companion/companion')"
            >
              去创建陪伴
            </button>
          </view>
          <RelationshipSelector
            v-if="relStore.relationships.length > 0 || relStore.status !== 'ready'"
            :relationships="relStore.relationships"
            :current-id="relStore.currentRelationshipId"
            :status="relStore.status"
            :busy="relStore.status === 'loading'"
            :show-create="false"
            @activate="onRelActivate"
          />
          <view
            v-if="relationshipActivateError"
            class="chat-block-error"
            data-testid="relationship-activate-error"
            role="alert"
          >
            <text>切换伙伴失败，请重试</text>
          </view>
        </view>

        <template v-else>
          <!-- 唯一纵向滚动区：消息历史。回底按钮在历史与输入区之间独立占位。 -->
          <view class="history-wrap">
            <view
              ref="historyEl"
              class="chat-history"
              data-testid="history"
              role="region"
              aria-label="消息历史"
              tabindex="0"
              @wheel.passive="onHistoryUserScrollIntent"
              @touchmove.passive="onHistoryUserScrollIntent"
              @keydown="onHistoryUserScrollIntent"
            >
            <!-- 条件上下文提示：可关闭，位于滚动内容头部。 -->
            <view v-if="serviceHint" class="context-hint" data-testid="service-mode-hint">
              <text>{{ serviceHint }}</text>
              <button class="context-hint__close" aria-label="关闭服务状态提示" @click="serviceHintDismissed = true">
                <AppIcon name="close" :size="14" />
              </button>
            </view>
            <view v-if="store.activeIncognito" class="context-hint" data-testid="incognito-hint">
              <text>这是无痕会话：内容不会进入长期记忆（无痕 ≠ 无必要安全记录）。</text>
            </view>

            <view
              v-if="showEmptyHistory"
              class="chat-empty"
              data-testid="empty-history"
              role="status"
            >
              <text>还没有消息。输入一句话开始聊。</text>
            </view>

            <view
              v-for="msg in displayMessages"
              :key="msg.messageId"
              class="chat-message"
              :class="msg.role"
              :data-mid="msg.messageId"
              data-testid="chat-message"
            >
              <view
                v-if="msg.role === 'assistant'"
                class="msg-content"
                :data-testid="msg.messageId === '__streaming__' ? 'draft' : 'assistant-md'"
              >
                <view v-for="(block, bi) in markdownBlocks(msg.content)" :key="bi">
                  <view v-if="block.kind === 'p'" class="md-p">
                    <text
                      v-for="(part, pi) in block.parts"
                      :key="pi"
                      :class="part.style ? `md-${part.style}` : undefined"
                    >{{ part.text }}</text>
                    <text v-if="block.truncated" class="md-truncated">
                      回复过长，已截断
                    </text>
                  </view>
                  <view v-else-if="block.kind === 'code'" class="md-code">
                    <text>{{ block.text }}</text>
                    <text v-if="block.truncated" class="md-truncated">代码过长，已截断</text>
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

              <!-- 消息级低频操作：收进"更多"展开区。 -->
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
                <button
                  class="msg-action"
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
                <button
                  v-if="msg.role === 'user'"
                  class="msg-action"
                  :class="{ 'msg-action--warn': msg.noMemory }"
                  :data-testid="`msg-no-memory-${msg.messageId}`"
                  :aria-label="msg.noMemory ? '恢复这条消息的记忆提取' : '不记住这条消息'"
                  @click="onToggleNoMemory(msg)"
                >
                  {{ msg.noMemory ? "恢复记忆" : "不记住" }}
                </button>
                <button
                  class="msg-action msg-action--danger"
                  :data-testid="`msg-delete-${msg.messageId}`"
                  :disabled="deletingMessageIds.has(msg.messageId)"
                  :aria-label="
                    deletingMessageIds.has(msg.messageId)
                      ? '正在删除这条消息'
                      : confirmDeleteMsgId === msg.messageId
                        ? '确认删除这条消息'
                        : '删除这条消息'"
                  @click="onDeleteMessage(msg.messageId)"
                >
                  {{
                    deletingMessageIds.has(msg.messageId)
                      ? "删除中…"
                      : confirmDeleteMsgId === msg.messageId
                        ? "确认删除"
                        : "删除"
                  }}
                </button>
                <button
                  class="msg-action"
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
                  <button class="msg-action" data-testid="msg-report-open-page" @click="goTo(reportHref(msg.messageId))">
                    打开举报和申诉页提交
                  </button>
                </view>
                <button
                  v-if="canRegenerateMessage(msg)"
                  class="msg-action"
                  data-testid="regenerate"
                  aria-label="重新生成这条回复"
                  @click="onRegenerate(msg)"
                >
                  重新生成
                </button>
              </view>
            </view>

            <view v-if="showLoadMore" class="history-more">
              <button data-testid="load-more" class="btn-secondary" :disabled="isStreaming" @click="onLoadMore">
                加载更多
              </button>
            </view>

            <view class="chat-status" data-testid="status" role="status" aria-live="polite">
              <text>{{ statusText }}</text>
            </view>

            <view v-if="sendError" class="chat-block-error" data-testid="chat-send-error" role="alert">
              <text>消息发送失败，请重试</text>
            </view>
            <view v-if="actionError" class="chat-block-error" data-testid="chat-action-error" role="alert">
              <text>操作未成功，请重试</text>
            </view>

            <view v-if="usage" class="chat-usage" data-testid="usage" role="status">
              <text>{{ `本轮用量：输入 ${usage.inputTokens} / 输出 ${usage.outputTokens} 词元` }}</text>
            </view>

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
                class="msg-action"
                :data-testid="`feedback-${opt.value}`"
                :disabled="feedbackKinds.includes(opt.value)"
                @click="onFeedback(opt.value)"
              >
                {{ feedbackKinds.includes(opt.value) ? `已反馈：${opt.label}` : opt.label }}
              </button>
            </view>

            <view v-if="pendingMemoryCount > 0" class="memory-prompt" data-testid="memory-prompt" role="status">
              <text>{{ `有 ${pendingMemoryCount} 条新的记忆候选待确认` }}</text>
              <button data-testid="memory-prompt-link" class="msg-action" @click="goTo(memoryHref())">
                去确认
              </button>
            </view>
          </view>

          <!-- 滚离最新时的轻量回底按钮。 -->
          <button
            v-if="!followingLatest"
            class="back-to-latest"
            data-testid="back-to-latest"
            aria-label="回到最新消息"
            @click="onBackToLatest"
          >
            回到最新
          </button>
          </view>

          <view v-if="renaming" class="rename-row" data-testid="rename-row">
            <input
              v-model="renameInput"
              class="rename-input"
              data-testid="rename-input"
              placeholder="会话标题（留空清除）"
              aria-label="会话标题"
              :disabled="isStreaming"
            />
            <button data-testid="rename-apply" class="btn-primary" :disabled="isStreaming" @click="onRenameConversation">
              保存
            </button>
            <button data-testid="rename-cancel" class="btn-secondary" :disabled="isStreaming" @click="cancelRename">
              取消
            </button>
          </view>

          <!-- 底部输入区：布局流中的独立区域，不覆盖滚动内容。 -->
          <view class="chat-input-area" role="form" aria-label="发送消息">
            <textarea
              v-model="inputText"
              class="chat-input"
              data-testid="message-input"
              placeholder="输入消息…"
              aria-label="消息输入"
              auto-height
              :disabled="isStreaming"
              @keydown.enter="onEnterKey"
            />
            <button
              data-testid="send"
              class="btn-primary chat-send"
              :disabled="isStreaming || !canSend || !store.conversationId"
              @click="onSend"
            >
              发送
            </button>
            <button
              v-if="isStreaming"
              data-testid="cancel"
              class="btn-secondary"
              :aria-busy="isStreaming"
              @click="onCancel"
            >
              取消
            </button>
            <button v-if="canRetry" data-testid="retry" class="btn-secondary" @click="onRetry">
              重试
            </button>
          </view>
        </template>
      </template>
    </view>
  </view>
</template>

<script lang="ts">
// H5 chat page（纠偏式重写）。展示层：流逻辑在 api/realtime、stores/chat、
// domain/stream-*（已测试）。滚动方案是最小实现：唯一滚动容器 + 一个
// scroll handler + 一个合并写入的 rAF + isFollowingLatest 状态。
// 无虚拟列表、无测量缓存、无保持事务、无诊断属性。
import { computed, defineComponent, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";

import { parseSafeMarkdown } from "@/domain/safe-markdown";
import { goTo } from "@/app/navigate";

import { createAuthedFetch } from "@/api/authed-fetch";
import { companionHeaderName } from "@/domain/companion-presentation";
import { createAuthenticatedTransport } from "@/api/transport";
import { createBrowserRealtimeDeps } from "@/api/realtime-transport";
import type { RealtimeDeps } from "@/api/realtime";
import { asFeedbackKind } from "@/api/chat";
import type { ConversationListItem } from "@/api/chat";
import RelationshipSelector from "@/components/RelationshipSelector.vue";
import AppIcon from "@/design-system/AppIcon.vue";
import AppSheet from "@/design-system/AppSheet.vue";
import { useAuthStore } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { useRelationshipStore } from "@/stores/relationship";
import { useIncognitoStore } from "@/stores/incognito";
import { requestIdLabel } from "@/domain/request-id";
import { buildContextHref, readContextFromLocation } from "@/domain/context-href";
import { isReadableConversationText, readableConversationTitle } from "@/domain/conversation-display";
import { installStreamLifecycle } from "@/domain/stream-recovery";

/** 距底部不超过该值视为"在底部附近"（回到底部即恢复跟随）。 */
const RESUME_GAP_PX = 48;

export default defineComponent({
  name: "ChatPage",
  components: { RelationshipSelector, AppIcon, AppSheet },
  setup() {
    const store = useChatStore();
    const relStore = useRelationshipStore();
    const auth = useAuthStore();
    const incognitoPref = useIncognitoStore();

    const headerCompanionName = computed(() =>
      relStore.current ? companionHeaderName(relStore.current) : "",
    );

    const inputText = ref("");
    const initError = ref(false);
    const sendError = ref(false);
    const actionError = ref(false);
    const relationshipActivateError = ref(false);
    const conversationOpenError = ref(false);
    const initRequestId = ref("");
    const confirmDeactivate = ref(false);
    const confirmDeleteId = ref<string | null>(null);
    const confirmEndToday = ref(false);
    const renaming = ref(false);
    const renameInput = ref("");
    const confirmDeleteMsgId = ref<string | null>(null);
    // 同一 messageId 的删除单飞：在途期间重复确认早退，不发第二个 DELETE。
    const deletingMessageIds = reactive(new Set<string>());
    const openMsgId = ref<string | null>(null);
    const menuOpen = ref(false);
    const reportMsgId = ref<string | null>(null);
    const copiedMsgId = ref<string | null>(null);
    let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
    const incognitoNext = ref(false);
    const serviceHintDismissed = ref(false);

    const MODE_OPTIONS = [
      { value: "AUTO", label: "自动" },
      { value: "LISTEN", label: "只听我说" },
      { value: "DISCUSS", label: "一起聊聊" },
      { value: "CASUAL", label: "轻松日常" },
    ] as const;
    const FEEDBACK_OPTIONS = [
      { value: "TOO_MECHANICAL", label: "太机械" },
      { value: "FORGOT_CONTEXT", label: "忘记了" },
      { value: "CROSSED_BOUNDARY", label: "越界" },
      { value: "FACTUAL_ERROR", label: "事实错误" },
      { value: "UNSAFE", label: "不安全" },
    ] as const;

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

    // ---- 最小滚动状态：isFollowingLatest + 最多一个待执行 rAF ----
    const historyEl = ref<unknown>(null);
    const followingLatest = ref(true);
    let pendingScrollFrame = 0;

    /** 模板 ref 在 uni-h5 可能是元素或组件实例（带 $el），统一取真实节点。 */
    function historyNode(): HTMLElement | null {
      const raw: unknown = historyEl.value;
      if (raw instanceof HTMLElement) return raw;
      const el = (raw as { $el?: unknown } | null)?.$el;
      return el instanceof HTMLElement ? el : null;
    }

    function cancelPendingScrollFrame(): void {
      if (pendingScrollFrame) cancelAnimationFrame(pendingScrollFrame);
      pendingScrollFrame = 0;
    }

    /** 真实输入发生在 scroll 之前；只取消待执行落底帧，位置仍由唯一 scroll handler 判定。 */
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

    /** 跟随状态下把视图落到最新内容；同一帧内的多次更新合并为一次写入。 */
    function scheduleScrollToBottom(): void {
      if (!followingLatest.value || pendingScrollFrame) return;
      const node = historyNode();
      if (!node) return;
      const conversationId = store.conversationId;
      pendingScrollFrame = requestAnimationFrame(() => {
        pendingScrollFrame = 0;
        if (
          store.conversationId !== conversationId ||
          historyNode() !== node
        ) return;
        followingLatest.value = true;
        node.scrollTop = node.scrollHeight;
      });
    }

    /** 唯一的 scroll handler：仅维护 isFollowingLatest。scroll 事件不冒泡，
     * 且 uni-h5 的 <view> 不透传模板 @scroll（真机收不到）；在 document
     * 捕获阶段统一接收，只处理消息历史容器自身的滚动。 */
    function onHistoryScroll(event: Event): void {
      const node = historyNode();
      if (!node || event.target !== node) return;
      const nearBottom =
        node.scrollHeight <= node.clientHeight ||
        node.scrollHeight - node.clientHeight - node.scrollTop <= RESUME_GAP_PX;
      if (nearBottom && !followingLatest.value) {
        followingLatest.value = true;
      } else if (!nearBottom && followingLatest.value) {
        followingLatest.value = false;
      }
    }

    const onBackToLatest = (): void => {
      followingLatest.value = true;
      const el = historyNode();
      if (el) el.scrollTop = el.scrollHeight;
    };

    // 视口尺寸变化（旋转/软键盘）：跟随时重新落底一次；阅读时交给浏览器重排。
    function onViewportChange(): void {
      if (followingLatest.value) scheduleScrollToBottom();
    }

    const displayMessages = computed(() => store.displayMessages);
    const conversations = computed(() => store.conversations);
    const pendingMemoryCount = computed(() => store.pendingMemoryCount);
    const usage = computed(() => store.usage);
    const feedbackKinds = computed(() => store.feedbackKinds);
    const serviceModeStatus = computed(() => store.serviceMode?.mode ?? null);
    // 服务状态提示只在非正常服务档位出现（透明度：异常必须可见；正常态不打扰）。
    const serviceHint = computed(() => {
      if (serviceHintDismissed.value) return "";
      if (serviceModeStatus.value === null || serviceModeStatus.value === "FULL_AI") return "";
      return store.serviceMode?.summary || "AI 服务当前以受限模式运行。";
    });
    const isStreaming = computed(() => store.isStreaming);
    const canSend = computed(() => inputText.value.trim().length > 0);
    const selectedMode = computed(() => store.selectedMode);
    const hasRelationship = computed(() => relStore.currentRelationshipId !== null);
    // 新消息、流式草稿与尾部状态行到达时跟随；写入由 rAF 合并。
    // （放在 statusText 声明之后，watch 源立即求值。）
    // 会话切换：取消旧帧、回到跟随态。不手写 scrollTop=0——消息清空/替换
    // 时浏览器会把 scrollTop 自动 clamp，而手写会派发一次伪 scroll 事件把
    // following 翻 false，吞掉随后的落底帧。
    watch(
      () => store.conversationId,
      () => {
        cancelPendingScrollFrame();
        followingLatest.value = true;
      },
    );

    const showEmptyHistory = computed(
      () =>
        hasRelationship.value &&
        !isStreaming.value &&
        !store.draft &&
        store.messages.length === 0,
    );
    const showLoadMore = computed(
      () => store.historyHasMore && store.messages.length > 0 && !isStreaming.value,
    );
    const showFeedback = computed(
      () => store.phase === "completed" || store.phase === "blocked",
    );
    /** STREAM-ECHO: one-click retry of the last failed turn (new idempotency key). */
    const canRetry = computed(
      () => store.phase === "failed" && store.pendingUserContent.trim().length > 0,
    );

    function markdownBlocks(content: string) {
      return parseSafeMarkdown(content ?? "");
    }

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
          return store.conversationId ? "" : "正在初始化对话…";
        case "streaming":
          if (store.stream.status === "gap") {
            return "连接中断，正在恢复（不补齐缺失内容）";
          }
          if (store.stream.status === "reset_required") {
            return "正在重新同步";
          }
          return "正在输入…";
        case "completed":
          return "";
        case "cancelled":
          return "已取消";
        case "blocked":
          return "这条内容没有通过安全审查，本轮不会继续。如果你正处于紧急危险，请联系当地紧急服务或你信任的真人。";
        case "failed":
          if (store.outcome === "not_found_or_forbidden" || store.lastDisconnect === "permission") {
            return "未找到或无权访问";
          }
          if (store.terminalFault) {
            return faultText(store.terminalFault);
          }
          if (
            store.stream.terminalEventType === "chat.failed" ||
            store.lastDisconnect === "terminal"
          ) {
            return "模型服务失败，请稍后重试";
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

    // 新消息、流式草稿与尾部状态行到达时跟随；写入由 rAF 合并。
    watch(
      () => [
        displayMessages.value.length,
        store.draft,
        statusText.value,
        usage.value,
        pendingMemoryCount.value,
      ],
      () => scheduleScrollToBottom(),
    );

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
        // 请求未被接受：恢复草稿，给出可重试的显式失败。
        inputText.value = text;
        sendError.value = true;
        return;
      }
      if (store.phase === "failed" && !store.generationId) {
        inputText.value = text;
      }
      if (store.phase === "completed") {
        await scheduleMemoryPrompt();
      }
    }

    /** Enter 发送、Shift+Enter 换行。 */
    function onEnterKey(event: KeyboardEvent): void {
      if (event.shiftKey) return;
      event.preventDefault();
      void onSend();
    }

    function lastUserMessage(): { messageId: string; content: string } | null {
      const users = store.messages.filter(
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

    async function onRegenerate(msg: { messageId: string; content: string }): Promise<void> {
      await guarded(() => store.regenerate(transport, deps, msg.messageId, msg.content));
    }

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

    const onCancel = () => store.cancel();

    function onSelectMode(mode: string): void {
      if (!isStreaming.value) store.setMode(mode);
    }

    async function onFeedback(kind: string): Promise<void> {
      const narrowed = asFeedbackKind(kind);
      if (!narrowed) return;
      await store.sendFeedback(transport, narrowed);
    }

    const toggleMsgMenu = (messageId: string) => {
      openMsgId.value = openMsgId.value === messageId ? null : messageId;
    };

    const onReportMessage = (messageId: string) => {
      reportMsgId.value = reportMsgId.value === messageId ? null : messageId;
    };

    /** 两步确认后删除；同一 messageId 单飞（在途期间重复确认早退）。 */
    async function onDeleteMessage(messageId: string): Promise<void> {
      if (deletingMessageIds.has(messageId)) return;
      if (!store.messages.some((m) => m.messageId === messageId)) return;
      if (confirmDeleteMsgId.value === messageId) {
        confirmDeleteMsgId.value = null;
        deletingMessageIds.add(messageId);
        try {
          await guarded(() => store.removeMessage(transport, messageId));
        } finally {
          deletingMessageIds.delete(messageId);
        }
        return;
      }
      confirmDeleteMsgId.value = messageId;
    }

    async function onToggleNoMemory(msg: {
      messageId: string;
      noMemory?: boolean;
    }): Promise<void> {
      await guarded(() =>
        store.setMessageNoMemory(transport, msg.messageId, !msg.noMemory));
    }

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
            // 呈现层提示；复制本身已成功。
          }
        }
        if (copyResetTimer !== undefined) {
          globalThis.clearTimeout(copyResetTimer);
        }
        copyResetTimer = globalThis.setTimeout(() => {
          copiedMsgId.value = null;
        }, 1600);
      } catch {
        // 呈现层复制；聊天必须不受影响。
      }
    }

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

    async function onLogout(): Promise<void> {
      await auth.logout(transport);
      goTo("/pages/login/login");
    }

    const knownRelationshipIds = (): string[] =>
      relStore.relationships.map((row) => row.relationshipId);

    function contextHref(page: "memory" | "conversations" | "companion"): string {
      return buildContextHref(page, {
        relationshipId: relStore.currentRelationshipId,
        knownRelationshipIds: knownRelationshipIds(),
      });
    }

    const memoryHref = () => contextHref("memory");
    const conversationsHref = () => contextHref("conversations");
    const companionHref = () => contextHref("companion");
    const reportHref = (messageId: string) => buildContextHref("report", { messageId });

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

    async function startConversation(): Promise<void> {
      const relationshipId = relStore.currentRelationshipId;
      if (!relationshipId) return;
      store.reset();
      try {
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

    async function refreshConversationList(): Promise<void> {
      const id = relStore.currentRelationshipId;
      if (id) await store.loadConversations(transport, id);
    }

    async function onOpenConversation(id: string): Promise<void> {
      conversationOpenError.value = false;
      const didOpen = await store.openConversation(transport, id);
      if (!didOpen) {
        conversationOpenError.value = true;
        return;
      }
      menuOpen.value = false;
      const conversation = store.conversations.find((c) => c.conversationId === id);
      incognitoNext.value = conversation?.incognito === true;
    }

    async function onNewConversation(): Promise<void> {
      menuOpen.value = false;
      confirmDeleteId.value = null;
      cancelRename();
      await startConversation();
    }

    async function onEndToday(): Promise<void> {
      const id = store.conversationId;
      if (!id) return;
      if (!confirmEndToday.value) {
        confirmEndToday.value = true;
        return;
      }
      confirmEndToday.value = false;
      menuOpen.value = false;
      const ended = await guarded(() => store.endToday(transport, id));
      if (ended) {
        await guarded(async () => {
          await refreshConversationList();
          await startConversation();
        });
      }
    }

    async function onDeleteConversation(): Promise<void> {
      const id = store.conversationId;
      if (!id) return;
      if (confirmDeleteId.value !== id) {
        confirmDeleteId.value = id;
        return;
      }
      confirmDeleteId.value = null;
      menuOpen.value = false;
      await guarded(async () => {
        const deleted = await store.removeConversation(transport, id);
        if (deleted && !store.conversationId) {
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
      menuOpen.value = false;
      const current = store.conversations.find((c) => c.conversationId === id);
      // 改名输入绝不预填密文：enc1:/enc2:/空值一律预填空字符串。
      renameInput.value = isReadableConversationText(current?.title)
        ? current!.title!.trim()
        : "";
      renaming.value = true;
    }

    const cancelRename = (): void => {
      renaming.value = false;
      renameInput.value = "";
    };

    async function onRenameConversation(): Promise<void> {
      const id = store.conversationId;
      if (!id) return;
      const renamed = await guarded(() =>
        store.renameConversation(transport, id, renameInput.value.trim()));
      if (renamed) {
        cancelRename();
      }
    }

    const onLoadMore = () => guarded(() => store.loadMoreHistory(transport));

    async function onRelActivate(relationshipId: string): Promise<void> {
      relationshipActivateError.value = false;
      try {
        const result = await relStore.activate(transport, relationshipId);
        if (!result) {
          relationshipActivateError.value = true;
          return;
        }
        initError.value = false;
        confirmDeactivate.value = false;
        await guarded(async () => {
          await startConversation();
        });
      } catch {
        relationshipActivateError.value = true;
      }
    }

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
        menuOpen.value = false;
        store.reset();
      }
    }

    function conversationLabel(conv: ConversationListItem): string {
      const safe = readableConversationTitle(conv);
      return safe.length > 16 ? `${safe.slice(0, 16)}…` : safe;
    }

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
        document.addEventListener("scroll", onHistoryScroll, {
          capture: true,
          passive: true,
        });
        window.addEventListener("resize", onViewportChange);
        window.visualViewport?.addEventListener("resize", onViewportChange);
      }
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      if (auth.isAuthenticated) {
        await incognitoPref.load(transport);
        incognitoNext.value = incognitoPref.defaultIncognito;
      }
      await store.loadServiceMode(transport);
      await relStore.load(transport);
      const queryId = readQueryRelationshipId();
      if (
        queryId &&
        relStore.relationships.some((rel) => rel.relationshipId === queryId)
      ) {
        relStore.currentRelationshipId = queryId;
      }
      if (relStore.currentRelationshipId) {
        await refreshConversationList();
        const requested = readQueryConversationId();
        const fromQuery = requested
          ? store.conversations.find((c) => c.conversationId === requested)
          : undefined;
        const latest = store.conversations[store.conversations.length - 1];
        const target = fromQuery ?? latest;
        if (target) {
          await store.openConversation(transport, target.conversationId);
        } else {
          await startConversation();
        }
        store.bindGenerationContext(
          auth.accountId ?? "",
          relStore.currentRelationshipId,
        );
        const restored = await store.tryRestoreAfterReload(deps, {
          accountId: auth.accountId ?? "",
          relationshipId: relStore.currentRelationshipId,
        });
        if (restored) {
          await store.loadHistory(transport);
        }
        await store.refreshPendingMemoryCount(
          transport,
          relStore.currentRelationshipId,
        );
      }
    });

    onUnmounted(() => {
      stopLifecycle?.();
      cancelPendingScrollFrame();
      if (typeof document !== "undefined" && typeof window !== "undefined") {
        document.removeEventListener("scroll", onHistoryScroll, true);
        window.removeEventListener("resize", onViewportChange);
        window.visualViewport?.removeEventListener("resize", onViewportChange);
      }
      clearMemoryPoll();
      if (copyResetTimer !== undefined) {
        globalThis.clearTimeout(copyResetTimer);
      }
      store.detachInFlight();
    });

    return {
      relStore,
      store,
      auth,
      historyEl,
      followingLatest,
      onHistoryUserScrollIntent,
      onBackToLatest,
      headerCompanionName,
      displayMessages,
      conversations,
      pendingMemoryCount,
      markdownBlocks,
      usage,
      isStreaming,
      showEmptyHistory,
      showLoadMore,
      canSend,
      hasRelationship,
      inputText,
      initError,
      initRequestId,
      serviceHintDismissed,
      confirmDeactivate,
      confirmEndToday,
      onEndToday,
      confirmDeleteId,
      confirmDeleteMsgId,
      deletingMessageIds,
      reportMsgId,
      openMsgId,
      menuOpen,
      toggleMsgMenu,
      onReportMessage,
      copiedMsgId,
      onCopyMessage,
      onToggleNoMemory,
      onDeleteMessage,
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
      serviceHint,
      statusText,
      sendError,
      actionError,
      relationshipActivateError,
      conversationOpenError,
      canRetry,
      onSend,
      onEnterKey,
      onRegenerate,
      canRegenerateMessage,
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
      reportHref,
      onRelActivate,
      conversationLabel,
    };
  },
});
</script>

<style scoped>
/* 沉浸式对话：浅色。外壳只做 flex 分配（顶栏 / chat-main / 输入栏），自身
   永不滚动；有关系时唯一纵向滚动容器是 chat-history，无关系时是 chat-setup。
   输入栏在布局流中，不 fixed、不覆盖内容。 */
.chat-page {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
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

.chat-setup {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--vc-space-4);
}

/* 顶栏 */
.chat-header {
  flex: none;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--vc-space-2);
  box-sizing: border-box;
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  min-height: 52px;
  padding: calc(var(--vc-space-1) + env(safe-area-inset-top, 0px)) var(--vc-space-2);
  background: var(--vc-env-raised);
  border-bottom: 1px solid var(--vc-border-env);
}

.chat-header__icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--vc-on-env);
}

.chat-header__icon-btn::after {
  border: 0;
}

.chat-header__identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--vc-space-2);
}

.chat-header__name {
  overflow: hidden;
  color: var(--vc-on-env);
  font-size: var(--vc-text-md);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-header__ai {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-xs);
  white-space: nowrap;
}

/* 通用按钮（主/次/危险/选中/小号） */
.btn-primary,
.btn-secondary,
.msg-action,
.sheet-item,
.hint-btn,
.msg-more {
  margin: 0;
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  font: inherit;
  text-align: left;
}

.btn-primary,
.btn-secondary {
  min-height: 44px;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-strong);
  color: var(--vc-ink);
  font-size: var(--vc-text-sm);
}

.btn-primary {
  border: 0;
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font-weight: 600;
  padding: 0 var(--vc-space-5);
}

.btn-primary[disabled] {
  opacity: 0.55;
}

.btn-primary::after,
.btn-secondary::after,
.msg-action::after,
.sheet-item::after,
.hint-btn::after,
.msg-more::after {
  border: 0;
}

.msg-action,
.sheet-item {
  min-height: 44px;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  color: var(--vc-ink);
  font-size: var(--vc-text-sm);
}

.msg-more,
.hint-btn {
  min-width: 44px;
  min-height: 44px;
  padding: 0 var(--vc-space-2);
  border: 0;
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.hint-btn {
  border: 1px solid var(--vc-border-strong);
}

.msg-action--warn {
  color: var(--vc-warning);
  border-color: var(--vc-warning);
}

.msg-action--danger,
.sheet-item--danger {
  color: var(--vc-danger);
  border-color: var(--vc-danger);
}

.msg-action--active,
.sheet-item--active {
  color: var(--vc-primary);
  border-color: var(--vc-primary);
  font-weight: 600;
}

/* 更多菜单 */
.sheet-section {
  margin-bottom: var(--vc-space-4);
}

.sheet-label {
  display: block;
  margin-bottom: var(--vc-space-2);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.sheet-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
}

.sheet-conversations {
  display: flex;
  flex-direction: column;
  gap: var(--vc-space-1);
  max-height: 200px;
  margin-bottom: var(--vc-space-2);
  overflow-y: auto;
}

.sheet-conv-item {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 0;
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-sm);
  text-align: left;
}

.sheet-conv-item::after {
  border: 0;
}

.sheet-conv-item--active {
  background: var(--vc-sunken);
  color: var(--vc-primary);
  font-weight: 700;
}

.sheet-conv-incognito {
  margin-left: var(--vc-space-2);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.sheet-empty {
  padding: var(--vc-space-2) 0;
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

/* 条件上下文提示：滚动内容头部的可关闭细行。 */
.context-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  margin: var(--vc-space-2) 0 0;
  padding: var(--vc-space-2) 0;
  border: 0;
  border-bottom: 1px solid var(--vc-border);
  border-radius: 0;
  background: transparent;
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.context-hint__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
}

.context-hint__close {
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
  color: var(--vc-muted);
}

.context-hint__close::after {
  border: 0;
}

/* 无关系分支 */
.chat-create-entry {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-3);
  margin: var(--vc-space-4) 0;
  padding: var(--vc-space-5);
  border-top: 1px solid var(--vc-border);
  border-bottom: 1px solid var(--vc-border);
  border-radius: 0;
  background: var(--vc-card);
}

.chat-create-entry__lead {
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

/* 消息历史：唯一纵向滚动区。wrap 负责历史与回底按钮的纵向布局。 */
.history-wrap {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-history {
  flex: 1 1 auto;
  min-height: 96px;
  box-sizing: border-box;
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  padding: var(--vc-space-3) var(--vc-space-4) var(--vc-space-4);
  overflow-y: auto;
  overscroll-behavior-y: contain;
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
  padding: var(--vc-space-3) 0;
}

.chat-message.user {
  align-items: flex-end;
}

.msg-content {
  max-width: 88%;
  padding: var(--vc-space-3) var(--vc-space-4);
  border-radius: var(--vc-radius-s) var(--vc-radius-l) var(--vc-radius-l) var(--vc-radius-l);
  background: var(--vc-card);
  border: 0;
  font-size: var(--vc-text-md);
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.chat-message.user .msg-content {
  background: var(--vc-primary);
  border-radius: var(--vc-radius-l) var(--vc-radius-s) var(--vc-radius-l) var(--vc-radius-l);
  color: var(--vc-on-primary);
}

.md-p {
  margin: 0 0 var(--vc-space-1);
}

.md-code {
  padding: var(--vc-space-2);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-ink);
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

.msg-more {
  margin-top: var(--vc-space-1);
  border-radius: var(--vc-radius-s);
  background: transparent;
}

.msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-1);
  justify-content: flex-start;
}

.chat-message.user .msg-actions {
  justify-content: flex-end;
}

.msg-report-notice {
  flex: 1 1 100%;
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
  align-items: center;
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.history-more {
  display: flex;
  justify-content: center;
  padding: var(--vc-space-3) 0;
}

/* 尾部状态行 */
.chat-status,
.chat-usage,
.memory-prompt {
  margin: var(--vc-space-2) 0 0;
  padding: var(--vc-space-1) var(--vc-space-2);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.chat-usage {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
}

.memory-prompt {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  border-top: 1px solid var(--vc-primary);
  border-bottom: 1px solid var(--vc-primary);
  border-radius: 0;
  background: transparent;
  color: var(--vc-ink);
}

.chat-block-error {
  margin: var(--vc-space-2) 0 0;
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chat-block-error__id {
  font-family: var(--vc-font-mono);
  font-size: var(--vc-text-xs);
}

.chat-feedback-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  margin: var(--vc-space-2) 0 0;
}

.chat-feedback-label {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

/* 回到底部：在历史与输入区之间占位，避免遮挡消息。 */
.back-to-latest {
  flex: none;
  align-self: center;
  min-width: 44px;
  min-height: 44px;
  margin: var(--vc-space-2) 0;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-pill);
  background: var(--vc-card);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-xs);
}

.back-to-latest::after {
  border: 0;
}

/* 改名行与输入区 */
.rename-row {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
  box-sizing: border-box;
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  padding: var(--vc-space-2) var(--vc-space-3);
  background: var(--vc-env-raised);
  border-top: 1px solid var(--vc-border-env);
}

.rename-input {
  flex: 1 1 12em;
  box-sizing: border-box;
  min-height: 44px;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font-size: 16px;
}

.chat-input-area {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: var(--vc-space-2);
  box-sizing: border-box;
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  padding: var(--vc-space-3)
    calc(var(--vc-space-3) + env(safe-area-inset-right, 0px))
    calc(var(--vc-space-2) + env(safe-area-inset-bottom, 0px))
    calc(var(--vc-space-3) + env(safe-area-inset-left, 0px));
  background: var(--vc-env-raised);
  border-top: 1px solid var(--vc-border-env);
}

.chat-input {
  flex: 1 1 auto;
  min-width: 0;
  box-sizing: border-box;
  min-height: 44px;
  max-height: 120px;
  padding: 0;
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font-family: var(--vc-font);
  font-size: 16px;
  line-height: 1.5;
  overflow-y: auto;
  resize: none;
}

.chat-input :deep(.uni-textarea-placeholder),
.chat-input :deep(.uni-textarea-compute),
.chat-input :deep(.uni-textarea-textarea) {
  box-sizing: border-box;
  padding: 10px var(--vc-space-3);
}

.chat-send {
  flex: 0 0 auto;
}

.chat-page > .chat-main > .chat-block-error {
  margin: var(--vc-space-3) auto 0;
  width: calc(100% - var(--vc-space-6));
  max-width: 520px;
}

@media (min-width: 768px) {
  .chat-page {
    border-right: 1px solid var(--vc-border-env);
    border-left: 1px solid var(--vc-border-env);
  }
}

/* 横屏 / 短视口：压缩固定行留白，history 依旧保持真实可用高度。 */
@media (max-height: 480px) {
  .chat-header {
    padding-top: calc(var(--vc-space-1) + env(safe-area-inset-top, 0px));
    padding-bottom: var(--vc-space-1);
  }

  .chat-input-area {
    padding-top: var(--vc-space-1);
  }

  .chat-input,
  .btn-primary,
  .btn-secondary {
    min-height: 44px;
  }

}
</style>
