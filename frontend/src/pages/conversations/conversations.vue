<!-- CONV-LIST: independent conversation list (§8.2). Reuses GET/PATCH/DELETE
/conversations and POST /end. Existence hidden. Chat still owns new sessions. -->
<template>
  <ConsumerShell route="/pages/conversations/conversations" title="会话">
    <template #header-actions>
      <button
        data-testid="nav-chat"
        class="conv-new-chat"
        :aria-label="primaryActionLabel"
        @click="goTo(primaryActionHref)"
      >
        <AppIcon :name="hasRelationships ? 'chats' : 'plus'" :size="18" />
        <text>{{ primaryActionLabel }}</text>
      </button>
    </template>

    <view class="conv-page">
      <RelationshipSelector
        :relationships="relStore.relationships"
        :current-id="relationshipId || null"
        :status="relStore.status"
        :busy="relStore.status === 'loading'"
        :show-create="false"
        label="筛选陪伴关系"
        all-option-label="全部陪伴"
        empty-action-label="创建陪伴"
        @activate="onPickRelationship"
        @request-create="goTo('/pages/companion/companion')"
      />

      <view v-if="items.length > 0 || filterQuery" class="conv-search">
        <input
          v-model="filterQuery"
          class="filter-input"
          data-testid="conversation-filter"
          placeholder="筛选会话标题或内容预览"
          aria-label="筛选会话标题或内容预览"
        />
        <button
          v-if="filterQuery"
          class="conv-search__clear"
          aria-label="清除会话筛选"
          @click="filterQuery = ''"
        >
          <AppIcon name="close" :size="17" />
        </button>
      </view>

      <view v-if="loaded && (items.length > 0 || hasRelationships)" class="conv-list-head">
        <text class="conv-list-head__title">会话记录</text>
        <text class="conv-list-head__count">{{ visibleItems.length }} 条</text>
      </view>

      <view v-if="loadFailed" class="error" data-testid="conversations-load-failed">
        <ErrorNotice message="会话列表加载失败，请重试。" :stale="items.length > 0" />
        <RetryButton data-testid="conversations-retry" :disabled="busy" @retry="reload" />
      </view>

      <view
        v-else-if="loaded && items.length === 0 && hasRelationships"
        class="conv-empty"
        data-testid="conversations-empty"
        role="status"
      >
        <view class="conv-empty__icon" aria-hidden="true">
          <AppIcon name="chats" :size="25" />
        </view>
        <text class="conv-empty__title">还没有会话记录</text>
        <text class="conv-empty__copy">准备好时，就从一段新的对话开始。</text>
        <button class="conv-empty__action" @click="goTo(chatHref())">
          开始聊天
          <AppIcon name="chevron-right" :size="18" />
        </button>
      </view>

      <view
        v-else-if="loaded && items.length > 0 && visibleItems.length === 0"
        class="conv-no-results"
        data-testid="conversations-no-results"
        role="status"
      >
        <text>没有匹配的会话。</text>
        <button @click="filterQuery = ''">清除筛选</button>
      </view>

      <view
        v-for="item in visibleItems"
        :key="item.conversationId"
        class="row"
        data-testid="conversation-card"
      >
        <button
          data-testid="conversation-open"
          class="row-main"
          @click="openChat(item)"
        >
          <text class="summary" data-testid="conversation-title">
            {{ readableConversationTitle(item) }}
          </text>
          <text
            v-if="readableConversationTitle(item) !== readableConversationPreview(item)"
            class="meta"
          >
            {{ readableConversationPreview(item) }}
          </text>
          <text v-if="item.createdAt" class="meta">
            {{ formatLocalDateTime(item.createdAt) }}
          </text>
        </button>
        <view class="row-side">
          <text v-if="item.incognito" class="meta" data-testid="conversation-incognito">无痕</text>
          <button
            class="conv-btn"
            :data-testid="`conversation-manage-${item.conversationId}`"
            :aria-expanded="manageId === item.conversationId ? 'true' : 'false'"
            :aria-label="`管理会话：${readableConversationTitle(item)}`"
            :disabled="busy"
            @click="toggleManage(item.conversationId)"
          >
            <AppIcon name="more" :size="19" />
          </button>
        </view>
        <view
          v-if="manageId === item.conversationId"
          class="manage-row"
          :data-testid="`conversation-manage-row-${item.conversationId}`"
        >
          <button
            data-testid="conversation-rename"
            class="conv-btn"
            :disabled="busy"
            @click="startRename(item)"
          >
            改名
          </button>
          <button
            data-testid="conversation-end"
            class="conv-btn"
            :disabled="busy"
            @click="onEnd(item.conversationId)"
          >
            {{ confirmEndId === item.conversationId ? "确认结束？" : "结束今天的对话" }}
          </button>
          <button
            data-testid="conversation-delete"
            class="conv-btn conv-btn--danger"
            :disabled="busy"
            @click="onDelete(item.conversationId)"
          >
            {{ confirmDeleteId === item.conversationId ? "确认删除？" : "删除" }}
          </button>
        </view>
        <view v-if="renamingId === item.conversationId" class="rename-row">
          <input
            v-model="renameInput"
            class="rename-input"
            data-testid="conversation-rename-input"
            aria-label="会话标题"
            :disabled="busy"
          />
          <button
            data-testid="conversation-rename-save"
            class="nav-index"
            :disabled="busy"
            @click="saveRename(item.conversationId)"
          >
            保存
          </button>
        </view>
        <view
          v-if="actionError && actionError.conversationId === item.conversationId"
          class="conversation-action-feedback"
          data-testid="conversation-action-error"
        >
          <ErrorNotice :message="actionError.message" />
          <RetryButton
            data-testid="conversation-action-retry"
            :label="
              actionError.action === 'rename'
                ? '重试改名'
                : actionError.action === 'end'
                  ? '重试结束'
                  : '重试删除'
            "
            :disabled="busy"
            @retry="retryAction"
          />
        </view>
      </view>
      <ErrorNotice
        v-if="loadMoreFailed"
        message="更多会话加载失败；已加载内容保持不变。"
        :stale="true"
      />
      <button
        v-if="hasMore"
        data-testid="conversations-load-more"
        class="nav-index conv-load-more"
        :disabled="busy"
        @click="loadMore"
      >
        {{ loadMoreFailed ? "重试加载更多" : "加载更多" }}
      </button>

      <!-- 低频破坏性操作默认折叠，避免在空列表里成为最大的视觉表面。 -->
      <section class="conv-data-tools" aria-labelledby="conv-data-tools-title">
        <button
          class="conv-data-tools__toggle"
          data-testid="chat-wipe-toggle"
          :aria-expanded="wipeZoneOpen ? 'true' : 'false'"
          aria-controls="chat-wipe-panel"
          @click="wipeZoneOpen = !wipeZoneOpen"
        >
          <view class="conv-data-tools__copy">
            <text id="conv-data-tools-title">会话数据管理</text>
            <text>预览或删除全部会话</text>
          </view>
          <AppIcon
            name="chevron-right"
            :size="19"
            :class="{ 'conv-data-tools__chevron--open': wipeZoneOpen }"
          />
        </button>

        <!-- CHAT-WIPE (FR-DATA-003): preview first, then two-step confirm. -->
        <view v-if="wipeZoneOpen" id="chat-wipe-panel" class="wipe-zone" data-testid="chat-wipe-zone">
          <view class="wipe-heading">
            <AppIcon name="warning" :size="20" />
            <text class="wipe-title">删除全部会话</text>
          </view>
          <text class="meta">删除所有陪伴的会话和消息；陪伴角色、已保存记忆、提醒和账号不会被删除。</text>
          <button
            data-testid="chat-wipe-preview"
            class="nav-index"
            :disabled="wipeBusy"
            @click="onWipePreview"
          >
            {{ wipeBusy ? "正在读取…" : "查看将删除的内容" }}
          </button>
          <view
            v-if="wipePreview"
            class="wipe-preview"
            :class="{ 'wipe-preview--empty': wipePreview.conversationCount === 0 }"
            data-testid="chat-wipe-preview-result"
            role="status"
          >
            <text v-if="wipePreview.conversationCount === 0">目前没有会话可删除。</text>
            <text v-else>
              将删除 {{ wipePreview.conversationCount }} 个会话、{{ wipePreview.messageCount }} 条消息；
              {{ wipePreview.inFlightCount }} 个进行中的生成任务将被取消。
            </text>
          </view>
          <button
            v-if="wipePreview && wipePreview.conversationCount > 0"
            data-testid="chat-wipe-confirm"
            class="nav-index danger"
            :disabled="wipeBusy"
            @click="onWipeAll"
          >
            {{ confirmWipe ? "再点一次确认删除全部" : "删除全部会话" }}
          </button>
          <view
            v-if="wipeDone"
            class="wipe-preview wipe-preview--done"
            data-testid="chat-wipe-done"
            role="status"
          >
            <text>
              已删除 {{ wipeDone.conversationsDeleted }} 个会话、{{ wipeDone.messagesDeleted }} 条消息；
              {{ wipeDone.workItemsCancelled }} 个进行中的任务已取消。
            </text>
          </view>
          <view v-else-if="wipeFailed" class="error" data-testid="chat-wipe-failed" role="alert">
            <text>删除未完成，请重试。列表保持当前状态。</text>
          </view>
        </view>
      </section>
    </view>
  </ConsumerShell>
</template>

<script lang="ts">
import { computed, onMounted, ref } from "vue";

import {
  chatWipePreview,
  deleteConversation,
  endConversation,
  listConversations,
  renameConversation,
  wipeAllChats,
  type ChatWipePreview,
  type ChatWipeResult,
  type ConversationListItem,
} from "@/api/chat";
import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { goTo } from "@/app/navigate";
import AppIcon from "@/design-system/AppIcon.vue";
import ErrorNotice from "@/design-system/ErrorNotice.vue";
import RelationshipSelector from "@/components/RelationshipSelector.vue";
import RetryButton from "@/design-system/RetryButton.vue";
import { buildContextHref, readContextFromLocation } from "@/domain/context-href";
import {
  isReadableConversationText,
  readableConversationPreview,
  readableConversationTitle,
} from "@/domain/conversation-display";
import { formatLocalDateTime } from "@/domain/timestamp";
import { matchesLooseText } from "@/domain/text-filter";
import { useAuthStore } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { useRelationshipStore } from "@/stores/relationship";

type ConversationAction = "rename" | "end" | "delete";

interface ConversationActionError {
  conversationId: string;
  action: ConversationAction;
  message: string;
}

export default {
  name: "ConversationsPage",
  components: { AppIcon, ConsumerShell, ErrorNotice, RelationshipSelector, RetryButton },
  setup() {
    const auth = useAuthStore();
    const relStore = useRelationshipStore();
    const chatStore = useChatStore();
    const items = ref<ConversationListItem[]>([]);
    const filterQuery = ref("");
    const relationshipId = ref("");
    const loadFailed = ref(false);
    const loaded = ref(false);
    const busy = ref(false);
    const renamingId = ref<string | null>(null);
    const renameInput = ref("");
    const confirmDeleteId = ref<string | null>(null);
    const manageId = ref<string | null>(null);
    const confirmEndId = ref<string | null>(null);
    const actionError = ref<ConversationActionError | null>(null);
    const hasMore = ref(false);
    const loadMoreFailed = ref(false);
    const PAGE_SIZE = 20;
    // CHAT-WIPE state: preview → two-step confirm → done/failed notice.
    const wipePreview = ref<ChatWipePreview | null>(null);
    const wipeDone = ref<ChatWipeResult | null>(null);
    const wipeFailed = ref(false);
    const wipeBusy = ref(false);
    const confirmWipe = ref(false);
    const wipeZoneOpen = ref(false);
    const hasRelationships = computed(() => relStore.relationships.length > 0);
    const primaryActionLabel = computed(() =>
      relStore.status === "ready" && !hasRelationships.value ? "创建陪伴" : "开始聊天",
    );
    const primaryActionHref = computed(() =>
      relStore.status === "ready" && !hasRelationships.value
        ? "/pages/companion/companion"
        : chatHref(),
    );
    const visibleItems = computed(() =>
      items.value.filter((item) =>
        matchesLooseText(`${item.title ?? ""} ${item.lastMessagePreview ?? ""}`, filterQuery.value),
      ),
    );

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    function readQueryRelationshipId(): string {
      try {
        if (typeof location === "undefined") return "";
        return readContextFromLocation(location).relationshipId ?? "";
      } catch {
        return "";
      }
    }

    async function reload(): Promise<void> {
      loadFailed.value = false;
      loadMoreFailed.value = false;
      loaded.value = items.value.length > 0;
      busy.value = true;
      try {
        const filter = relationshipId.value.trim();
        const page = await listConversations(transport, filter || undefined, undefined, PAGE_SIZE);
        items.value = page;
        hasMore.value = page.length === PAGE_SIZE;
        loaded.value = true;
      } catch {
        // Preserve rows from the same filter and mark them stale in the notice.
        loadFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    async function loadMore(): Promise<void> {
      if (!hasMore.value || busy.value || items.value.length === 0) return;
      loadMoreFailed.value = false;
      busy.value = true;
      try {
        const filter = relationshipId.value.trim();
        const after = items.value[items.value.length - 1]?.conversationId;
        const page = await listConversations(
          transport,
          filter || undefined,
          after,
          PAGE_SIZE,
        );
        items.value = [...items.value, ...page];
        hasMore.value = page.length === PAGE_SIZE;
      } catch {
        // Keep loaded rows and the cursor; retry repeats only this page.
        loadMoreFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    function onPickRelationship(id: string): void {
      if (relationshipId.value !== id) {
        items.value = [];
        loaded.value = false;
        hasMore.value = false;
        loadFailed.value = false;
        loadMoreFailed.value = false;
      }
      relationshipId.value = id;
      void reload();
    }

    function toggleManage(conversationId: string): void {
      manageId.value = manageId.value === conversationId ? null : conversationId;
    }

    function actionFailureMessage(action: ConversationAction): string {
      if (action === "rename") {
        return "改名未完成，服务器没有确认这次操作；当前输入已保留，请重试。";
      }
      if (action === "end") {
        return "结束未完成，服务器没有确认这次操作；会话仍保留，请重试。";
      }
      return "删除未完成，服务器没有确认这次操作；会话仍保留，请重试。";
    }

    function setActionError(action: ConversationAction, conversationId: string): void {
      actionError.value = {
        conversationId,
        action,
        message: actionFailureMessage(action),
      };
    }

    function startRename(item: ConversationListItem): void {
      confirmDeleteId.value = null;
      confirmEndId.value = null;
      renamingId.value = item.conversationId;
      // P1-B（round3）：改名输入绝不预填密文——只有可读 title 才带出 trim
      // 后的原值；enc1:/enc2:、密文长 token、空值一律预填空字符串。
      renameInput.value = isReadableConversationText(item.title)
        ? item.title!.trim()
        : "";
    }

    async function saveRename(id: string): Promise<void> {
      actionError.value = null;
      busy.value = true;
      try {
        const applied = await renameConversation(transport, id, renameInput.value.trim());
        if (applied !== null) {
          items.value = items.value.map((c) =>
            c.conversationId === id ? { ...c, title: applied } : c,
          );
          renamingId.value = null;
        } else {
          setActionError("rename", id);
        }
      } catch {
        // Keep the row and the edit field; do not fake a rename.
        setActionError("rename", id);
      } finally {
        busy.value = false;
      }
    }

    async function onDelete(id: string): Promise<void> {
      if (confirmDeleteId.value !== id) {
        confirmDeleteId.value = id;
        confirmEndId.value = null;
        return;
      }
      busy.value = true;
      actionError.value = null;
      try {
        const ok = await deleteConversation(transport, id);
        if (ok) {
          items.value = items.value.filter((c) => c.conversationId !== id);
          confirmDeleteId.value = null;
        } else {
          setActionError("delete", id);
        }
      } catch {
        // Existence stays hidden; the row remains.
        setActionError("delete", id);
      } finally {
        busy.value = false;
      }
    }

    async function onEnd(id: string): Promise<void> {
      if (confirmEndId.value !== id) {
        confirmEndId.value = id;
        confirmDeleteId.value = null;
        return;
      }
      busy.value = true;
      actionError.value = null;
      try {
        const result = await endConversation(transport, id);
        if (result && result.incognitoCleared) {
          items.value = items.value.map((c) =>
            c.conversationId === id ? { ...c, lastMessagePreview: "" } : c,
          );
        }
        if (result) {
          confirmEndId.value = null;
        } else {
          setActionError("end", id);
        }
      } catch {
        // Keep the row; do not invent an ended state.
        setActionError("end", id);
      } finally {
        busy.value = false;
      }
    }

    function retryAction(): void {
      const current = actionError.value;
      if (!current || busy.value) return;
      if (current.action === "rename") {
        void saveRename(current.conversationId);
      } else if (current.action === "end") {
        void onEnd(current.conversationId);
      } else {
        void onDelete(current.conversationId);
      }
    }

    function openChat(item: ConversationListItem): void {
      goTo(
        buildContextHref("chat", {
          relationshipId: item.relationshipId,
          conversationId: item.conversationId,
          knownRelationshipIds: relStore.relationships.map((row) => row.relationshipId),
        }),
      );
    }

    async function onWipePreview(): Promise<void> {
      wipeFailed.value = false;
      wipeBusy.value = true;
      try {
        wipePreview.value = await chatWipePreview(transport);
        wipeDone.value = null;
        confirmWipe.value = false;
      } catch {
        wipePreview.value = null;
        wipeFailed.value = true;
      } finally {
        wipeBusy.value = false;
      }
    }

    async function onWipeAll(): Promise<void> {
      if (!confirmWipe.value) {
        confirmWipe.value = true;
        return;
      }
      confirmWipe.value = false;
      wipeFailed.value = false;
      wipeBusy.value = true;
      try {
        const result = await wipeAllChats(transport);
        wipeDone.value = result;
        wipePreview.value = null;
        items.value = [];
        hasMore.value = false;
        loaded.value = true;
        // The chat page's in-memory conversation state is stale after a wipe
        // (§18.7 clear semantics without dropping the auth session).
        chatStore.reset();
        chatStore.conversations = [];
      } catch {
        wipeFailed.value = true;
      } finally {
        wipeBusy.value = false;
      }
    }

    function chatHref(): string {
      return buildContextHref("chat", {
        relationshipId: relationshipId.value,
        knownRelationshipIds: relStore.relationships.map((row) => row.relationshipId),
      });
    }

    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      await relStore.load(transport);
      const prefill = readQueryRelationshipId();
      if (prefill && relStore.relationships.some((row) => row.relationshipId === prefill)) {
        relationshipId.value = prefill;
      }
      await reload();
    });

    return {
      relStore,
      readableConversationTitle,
      formatLocalDateTime,
      readableConversationPreview,
      items,
      visibleItems,
      hasRelationships,
      primaryActionLabel,
      primaryActionHref,
      filterQuery,
      relationshipId,
      loadFailed,
      loaded,
      busy,
      renamingId,
      renameInput,
      confirmDeleteId,
      manageId,
      toggleManage,
      confirmEndId,
      actionError,
      reload,
      onPickRelationship,
      startRename,
      saveRename,
      onDelete,
      onEnd,
      retryAction,
      openChat,
      chatHref,
      goTo,
      hasMore,
      loadMoreFailed,
      loadMore,
      wipePreview,
      wipeDone,
      wipeFailed,
      wipeBusy,
      confirmWipe,
      wipeZoneOpen,
      onWipePreview,
      onWipeAll,
    };
  },
};
</script>

<style scoped>
.conv-page {
  display: flex;
  flex-direction: column;
}

.conv-new-chat {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--vc-space-1);
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-2);
  border: 0;
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-primary);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 700;
  white-space: nowrap;
}

.conv-new-chat::after {
  border: 0;
}

.conv-new-chat:active {
  background: var(--vc-primary-bg);
}

.conv-search {
  position: relative;
  margin-bottom: var(--vc-space-5);
}

.filter-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 48px;
  margin: 0;
  padding: 0 48px 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font-size: 16px;
}

.conv-search__clear {
  position: absolute;
  top: 2px;
  right: 2px;
  display: grid;
  width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--vc-muted);
}

.conv-search__clear::after {
  border: 0;
}

.conv-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  border-bottom: 1px solid var(--vc-border-strong);
}

.conv-list-head__title {
  font-size: var(--vc-text-lg);
  font-weight: 720;
}

.conv-list-head__count {
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

/* 会话保持开放列表，不用重复卡片或无意义的“正常”状态点。 */
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  padding: var(--vc-space-4) 0;
  border-bottom: 1px solid var(--vc-border);
}

.row-main {
  display: flex;
  flex: 1 1 220px;
  min-width: 0;
  min-height: 44px;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
  text-align: left;
}

.row-main::after {
  border: 0;
}

.row-side {
  display: flex;
  align-items: center;
  gap: var(--vc-space-1);
  margin-left: auto;
}

.conv-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-sm);
}

.row-side .conv-btn {
  width: 44px;
  padding: 0;
  border-color: transparent;
  background: transparent;
  color: var(--vc-muted);
}

.conv-btn::after {
  border: 0;
}

.conv-btn--danger {
  border-color: var(--vc-danger);
  background: var(--vc-card);
  color: var(--vc-danger);
}

.notice,
.error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-1);
  margin-top: var(--vc-space-3);
  padding: var(--vc-space-4);
  border-radius: var(--vc-radius-m);
  border: 1px solid var(--vc-border);
  background: var(--vc-card);
  font-size: var(--vc-text-sm);
  line-height: 1.6;
  color: var(--vc-ink);
}

.error {
  border-color: var(--vc-danger-border);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
}

.conv-empty {
  display: flex;
  min-height: 230px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--vc-space-7) var(--vc-space-4);
  border-bottom: 1px solid var(--vc-border);
  color: var(--vc-ink);
  text-align: center;
}

.conv-empty__icon {
  display: grid;
  width: 52px;
  height: 52px;
  margin-bottom: var(--vc-space-3);
  place-items: center;
  border: 1px solid var(--vc-primary-border);
  border-radius: 50%;
  background: var(--vc-primary-bg);
  color: var(--vc-primary);
}

.conv-empty__title,
.conv-empty__copy {
  display: block;
}

.conv-empty__title {
  font-size: var(--vc-text-xl);
  font-weight: 720;
}

.conv-empty__copy {
  margin-top: var(--vc-space-1);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.conv-empty__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--vc-space-2);
  min-height: 48px;
  margin: var(--vc-space-5) 0 0;
  padding: 0 var(--vc-space-5);
  border: 0;
  border-radius: var(--vc-radius-s);
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font: inherit;
  font-weight: 700;
}

.conv-empty__action::after {
  border: 0;
}

.conv-no-results {
  display: flex;
  min-height: 120px;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-4);
  border-bottom: 1px solid var(--vc-border);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.conv-no-results button {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 0;
  background: transparent;
  color: var(--vc-primary);
  font: inherit;
  font-weight: 700;
}

.conv-no-results button::after {
  border: 0;
}

.summary {
  font-size: var(--vc-text-md);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.meta {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.manage-row,
.rename-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
  width: 100%;
}

.manage-row {
  padding-top: var(--vc-space-2);
}

.manage-row .conv-btn {
  flex: 1 1 auto;
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

.conversation-action-feedback {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-2);
}

.conversation-action-feedback :deep(.error-notice) {
  flex: 1 1 18rem;
  min-width: 0;
}

.conversation-action-feedback :deep(.retry-button) {
  margin: 0;
}

.nav-index {
  min-height: 44px;
  margin: var(--vc-space-3) 0 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-sm);
}

.nav-index::after {
  border: 0;
}

.nav-index.danger {
  border-color: var(--vc-danger);
  color: var(--vc-danger);
}

.conv-load-more {
  align-self: center;
}

.conv-data-tools {
  margin-top: var(--vc-space-8);
}

.conv-data-tools__toggle {
  display: flex;
  width: 100%;
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-3);
  margin: 0;
  padding: var(--vc-space-3) 0;
  border: 0;
  border-top: 1px solid var(--vc-border);
  border-bottom: 1px solid var(--vc-border);
  border-radius: 0;
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
  text-align: left;
}

.conv-data-tools__toggle::after {
  border: 0;
}

.conv-data-tools__copy,
.conv-data-tools__copy text {
  display: block;
}

.conv-data-tools__copy text:first-child {
  font-weight: 680;
}

.conv-data-tools__copy text:last-child {
  margin-top: 1px;
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.conv-data-tools__toggle .vc-icon {
  color: var(--vc-muted);
  transition: transform var(--vc-motion-fast) var(--vc-ease-out);
}

.conv-data-tools__chevron--open {
  transform: rotate(90deg);
}

/* 破坏性操作保持折叠；展开后仍先预览、再双重确认。 */
.wipe-zone {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-3);
  padding: var(--vc-space-5) var(--vc-space-4);
  border-bottom: 1px solid var(--vc-danger-border);
  border-radius: 0;
  background: var(--vc-danger-bg);
}

.wipe-heading {
  display: flex;
  align-items: center;
  gap: var(--vc-space-2);
  color: var(--vc-danger);
}

.wipe-title {
  font-size: var(--vc-text-md);
  font-weight: 700;
  color: var(--vc-danger);
}

.wipe-zone .meta {
  color: var(--vc-muted);
}

.wipe-preview {
  width: 100%;
  padding: var(--vc-space-3);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font-size: var(--vc-text-sm);
}

.wipe-preview--empty {
  color: var(--vc-muted);
}

.wipe-preview--done {
  border-color: var(--vc-success-border);
  background: var(--vc-success-bg);
  color: var(--vc-success);
}

@media (max-width: 360px) {
  .conv-new-chat {
    padding: 0 var(--vc-space-1);
  }

  .conv-new-chat .vc-icon {
    display: none;
  }

  .manage-row .conv-btn,
  .rename-row .nav-index,
  .wipe-zone .nav-index {
    width: 100%;
  }

  .rename-input {
    flex-basis: 100%;
  }

  .wipe-zone {
    padding: var(--vc-space-4) var(--vc-space-3);
  }
}

@media (pointer: coarse) {
  .conv-btn,
  .nav-index,
  .conv-data-tools__toggle {
    min-height: 48px;
  }
}
</style>
