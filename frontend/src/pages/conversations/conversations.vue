<!-- CONV-LIST: independent conversation list (§8.2). Reuses GET/PATCH/DELETE
/conversations and POST /end. Existence hidden. Chat still owns new sessions. -->
<template>
  <view class="conv-page">
    <view class="bar">
      <text class="title">会话列表</text>
      <button data-testid="nav-chat" class="nav-index" aria-label="离线聊天" @click="goTo(chatHref())">
        离线聊天
      </button>
      <button data-testid="nav-index" class="nav-index" aria-label="返回边界台" @click="goTo('/pages/index/index')">
        返回边界台
      </button>
    </view>

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
      <text>还没有会话。打开离线聊天可以开始新的对话。</text>
    </view>

    <view
      v-for="item in visibleItems"
      :key="item.conversationId"
      class="card"
      data-testid="conversation-card"
    >
      <text class="summary">{{ item.title || item.lastMessagePreview || `会话 ${item.conversationId}` }}</text>
      <text v-if="item.title && item.lastMessagePreview" class="meta">{{ item.lastMessagePreview }}</text>
      <text v-if="item.createdAt" class="meta">{{ item.createdAt }}</text>
      <text v-if="item.incognito" class="meta" data-testid="conversation-incognito">无痕</text>
      <view class="actions">
        <button data-testid="conversation-open" class="nav-index" @click="openChat(item)">
          打开
        </button>
        <button
          data-testid="conversation-rename"
          class="nav-index"
          :disabled="busy"
          @click="startRename(item)"
        >
          改名
        </button>
        <button
          data-testid="conversation-end"
          class="nav-index"
          :disabled="busy"
          @click="onEnd(item.conversationId)"
        >
          {{ confirmEndId === item.conversationId ? "确认结束？" : "结束今天的对话" }}
        </button>
        <button
          data-testid="conversation-delete"
          class="nav-index danger"
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
  </view>
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
import ErrorNotice from "@/components/ErrorNotice.vue";
import RelationshipSelector from "@/components/RelationshipSelector.vue";
import RetryButton from "@/components/RetryButton.vue";
import { buildContextHref, readContextFromLocation } from "@/domain/context-href";
import { matchesLooseText } from "@/domain/text-filter";
import { useAuthStore } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { useRelationshipStore } from "@/stores/relationship";

export default {
  name: "ConversationsPage",
  components: { ErrorNotice, RelationshipSelector, RetryButton },
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

    function startRename(item: ConversationListItem): void {
      confirmDeleteId.value = null;
      confirmEndId.value = null;
      renamingId.value = item.conversationId;
      renameInput.value = item.title ?? "";
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
.conv-page {
  padding: 24rpx;
  background-color: #14213d;
  color: #f5f5f5;
  min-height: 100vh;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 16rpx;
}
.title {
  font-size: 32rpx;
  font-weight: 600;
  margin-right: auto;
}
.filter-input {
  box-sizing: border-box;
  width: 100%;
  margin: 0 0 16rpx;
  padding: 12rpx 16rpx;
  border: 2rpx solid #2a3a5a;
  border-radius: 12rpx;
  background-color: #1c2b4a;
  color: #f5f5f5;
  font-size: 24rpx;
}
.nav-index {
  background-color: #2a3a5a;
  color: #ffffff;
  font-size: 24rpx;
}
.danger {
  background-color: #5a1a1a;
}
.card,
.notice,
.error {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 16rpx;
  padding: 20rpx;
  border-radius: 16rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  font-size: 24rpx;
  line-height: 1.6;
  color: #d5deee;
}
.error {
  background-color: #5a1a1a;
}
.summary {
  font-size: 30rpx;
  font-weight: 600;
}
.meta {
  font-size: 22rpx;
  color: #8fa0bd;
}
.actions,
.rename-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
}
.rename-input {
  flex: 1;
  min-width: 200rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #14213d;
  color: #f5f5f5;
  padding: 8rpx;
}
.wipe-zone {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10rpx;
  margin-top: 32rpx;
  padding: 20rpx;
  border-radius: 16rpx;
  border: 2rpx solid #5a2a2a;
  background-color: #2a1c1c;
}
.wipe-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #f2c4c4;
}
.wipe-zone .meta {
  font-size: 24rpx;
  color: #d5b0b0;
}
.wipe-preview {
  padding: 12rpx 16rpx;
  border-radius: 12rpx;
  background-color: #1a4a2a;
  color: #bfe8c6;
  font-size: 24rpx;
}
</style>
