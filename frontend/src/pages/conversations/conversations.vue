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

    <view v-if="loadFailed" class="error" data-testid="conversations-load-failed" role="alert">
      <text>会话列表加载失败，请重试。</text>
      <button data-testid="conversations-retry" class="nav-index" :disabled="busy" @click="reload">
        重试
      </button>
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
      v-for="item in items"
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
    <button
      v-if="hasMore"
      data-testid="conversations-load-more"
      class="nav-index"
      :disabled="busy"
      @click="loadMore"
    >
      加载更多
    </button>
  </view>
</template>

<script lang="ts">
import { onMounted, ref } from "vue";

import {
  deleteConversation,
  endConversation,
  listConversations,
  renameConversation,
  type ConversationListItem,
} from "@/api/chat";
import { createAuthenticatedTransport } from "@/api/transport";
import RelationshipSelector from "@/components/RelationshipSelector.vue";
import { useAuthStore } from "@/stores/auth";
import { useRelationshipStore } from "@/stores/relationship";

export default {
  name: "ConversationsPage",
  components: { RelationshipSelector },
  setup() {
    const auth = useAuthStore();
    const relStore = useRelationshipStore();
    const items = ref<ConversationListItem[]>([]);
    const relationshipId = ref("");
    const loadFailed = ref(false);
    const loaded = ref(false);
    const busy = ref(false);
    const renamingId = ref<string | null>(null);
    const renameInput = ref("");
    const confirmDeleteId = ref<string | null>(null);
    const confirmEndId = ref<string | null>(null);
    const hasMore = ref(false);
    const PAGE_SIZE = 20;

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    function readQueryRelationshipId(): string {
      try {
        if (typeof location === "undefined") return "";
        return new URLSearchParams(String(location.search || "")).get("relationshipId")?.trim() ?? "";
      } catch {
        return "";
      }
    }

    async function reload(): Promise<void> {
      loadFailed.value = false;
      loaded.value = false;
      busy.value = true;
      try {
        const filter = relationshipId.value.trim();
        const page = await listConversations(transport, filter || undefined, undefined, PAGE_SIZE);
        items.value = page;
        hasMore.value = page.length === PAGE_SIZE;
        loaded.value = true;
      } catch {
        items.value = [];
        hasMore.value = false;
        loadFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    async function loadMore(): Promise<void> {
      if (!hasMore.value || busy.value || items.value.length === 0) return;
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
        // Keep the loaded rows; do not invent a next page.
      } finally {
        busy.value = false;
      }
    }

    function onPickRelationship(id: string): void {
      if (!id) return;
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
      const params = new URLSearchParams({
        relationshipId: item.relationshipId,
        conversationId: item.conversationId,
      });
      goTo(`/pages/chat/chat?${params.toString()}`);
    }

    function chatHref(): string {
      const id = relationshipId.value.trim();
      if (!id) return "/pages/chat/chat";
      return `/pages/chat/chat?relationshipId=${encodeURIComponent(id)}`;
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
      if (prefill) {
        relationshipId.value = prefill;
      }
      await reload();
    });

    return {
      relStore,
      items,
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
      loadMore,
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
</style>
