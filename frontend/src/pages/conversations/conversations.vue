<!-- CONV-LIST: independent conversation list (§8.2). Reuses GET/PATCH/DELETE
/conversations and POST /end. Existence hidden. Chat still owns new sessions. -->
<template>
  <ConsumerShell route="/pages/conversations/conversations">
    <template #header-actions>
      <button
        data-testid="nav-chat"
        class="conv-new-chat"
        aria-label="去聊天"
        @click="goTo(chatHref())"
      >
        去聊天
      </button>
    </template>

    <RelationshipSelector
      :relationships="relStore.relationships"
      :current-id="relationshipId || null"
      :status="relStore.status"
      :busy="relStore.status === 'loading'"
      :show-create="false"
      @activate="onPickRelationship"
    />

    <input
      v-model="filterQuery"
      class="filter-input"
      data-testid="conversation-filter"
      placeholder="按标题或预览筛选"
      aria-label="按标题或预览筛选"
    />

    <view v-if="loadFailed" class="error" data-testid="conversations-load-failed">
      <ErrorNotice message="会话列表加载失败，请重试。" :stale="items.length > 0" />
      <RetryButton data-testid="conversations-retry" :disabled="busy" @retry="reload" />
    </view>

    <view
      v-else-if="loaded && items.length === 0"
      class="notice"
      data-testid="conversations-empty"
      role="status"
    >
      <text>还没有会话。点右上角"去聊天"开始新的对话。</text>
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
        <text class="summary" data-testid="conversation-title">{{ readableConversationTitle(item) }}</text>
        <text
          v-if="readableConversationTitle(item) !== readableConversationPreview(item)"
          class="meta"
        >{{ readableConversationPreview(item) }}</text>
        <text v-if="item.createdAt" class="meta">{{ formatLocalDateTime(item.createdAt) }}</text>
      </button>
      <view class="row-side">
        <text v-if="item.incognito" class="meta" data-testid="conversation-incognito">无痕</text>
        <button
          class="conv-btn"
          :data-testid="`conversation-manage-${item.conversationId}`"
          :aria-expanded="manageId === item.conversationId ? 'true' : 'false'"
          :disabled="busy"
          @click="toggleManage(item.conversationId)"
        >
          管理
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
    </view>
    <ErrorNotice
      v-if="loadMoreFailed"
      message="更多会话加载失败；已加载内容保持不变。"
      :stale="true"
    />
    <button
      v-if="hasMore"
      data-testid="conversations-load-more"
      class="nav-index"
      :disabled="busy"
      @click="loadMore"
    >
      {{ loadMoreFailed ? "重试加载更多" : "加载更多" }}
    </button>

    <!-- CHAT-WIPE (FR-DATA-003 全部聊天删除): preview first, then a two-step
         confirm. Plain wording — counts only, no emotional framing. -->
    <view class="wipe-zone" data-testid="chat-wipe-zone">
      <text class="wipe-title">危险区：删除全部会话</text>
      <text class="meta">删除所有角色的全部会话和消息；角色、已保存记忆、提醒和账号不会被删除。</text>
      <button
        data-testid="chat-wipe-preview"
        class="nav-index"
        :disabled="wipeBusy"
        @click="onWipePreview"
      >
        查看将删除的内容
      </button>
      <view v-if="wipePreview" class="wipe-preview" data-testid="chat-wipe-preview-result" role="status">
        <text>
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
      <view v-if="wipeDone" class="wipe-preview" data-testid="chat-wipe-done" role="status">
        <text>
          已删除 {{ wipeDone.conversationsDeleted }} 个会话、{{ wipeDone.messagesDeleted }} 条消息；
          {{ wipeDone.workItemsCancelled }} 个进行中的任务已取消。
        </text>
      </view>
      <view v-else-if="wipeFailed" class="error" data-testid="chat-wipe-failed" role="alert">
        <text>删除未完成，请重试。列表保持当前状态。</text>
      </view>
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

export default {
  name: "ConversationsPage",
  components: { ConsumerShell, ErrorNotice, RelationshipSelector, RetryButton },
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
    const hasMore = ref(false);
    const loadMoreFailed = ref(false);
    const PAGE_SIZE = 20;
    // CHAT-WIPE state: preview → two-step confirm → done/failed notice.
    const wipePreview = ref<ChatWipePreview | null>(null);
    const wipeDone = ref<ChatWipeResult | null>(null);
    const wipeFailed = ref(false);
    const wipeBusy = ref(false);
    const confirmWipe = ref(false);
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
      if (!id) return;
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
      busy.value = true;
      try {
        const applied = await renameConversation(transport, id, renameInput.value.trim());
        if (applied !== null) {
          items.value = items.value.map((c) =>
            c.conversationId === id ? { ...c, title: applied } : c,
          );
          renamingId.value = null;
        }
      } catch {
        // Keep the row and the edit field; do not fake a rename.
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
      confirmDeleteId.value = null;
      busy.value = true;
      try {
        const ok = await deleteConversation(transport, id);
        if (ok) {
          items.value = items.value.filter((c) => c.conversationId !== id);
        }
      } catch {
        // Existence stays hidden; the row remains.
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
      confirmEndId.value = null;
      busy.value = true;
      try {
        const result = await endConversation(transport, id);
        if (result && result.incognitoCleared) {
          items.value = items.value.map((c) =>
            c.conversationId === id ? { ...c, lastMessagePreview: "" } : c,
          );
        }
      } catch {
        // Keep the row; do not invent an ended state.
      } finally {
        busy.value = false;
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
        // Presentation-only.
      }
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
      reload,
      onPickRelationship,
      startRename,
      saveRename,
      onDelete,
      onEnd,
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
      onWipePreview,
      onWipeAll,
    };
  },
};
</script>

<style scoped>
.filter-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  margin: 0 0 var(--vc-space-2);
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font-size: 16px;
}

.conv-new-chat {
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 0;
  border-radius: var(--vc-radius-s);
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.conv-new-chat::after {
  border: 0;
}

/* 正常移动端列表：细线分隔的行，不是卡片网格。 */
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  padding: var(--vc-space-3) 0;
  border-bottom: 1px solid var(--vc-border);
}

.row-main {
  display: flex;
  flex: 1 1 auto;
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
  gap: var(--vc-space-2);
  margin-left: auto;
}

.conv-btn {
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
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
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

/* 危险区：与普通操作明显分离，放列表底部；预览 → 两步确认，文案只陈述数量。 */
.wipe-zone {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-7);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
}

.wipe-title {
  font-size: var(--vc-text-sm);
  font-weight: 600;
  color: var(--vc-danger);
}

.wipe-zone .meta {
  color: var(--vc-muted);
}

.wipe-preview {
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-success-bg);
  color: var(--vc-success);
  font-size: var(--vc-text-sm);
}
</style>
