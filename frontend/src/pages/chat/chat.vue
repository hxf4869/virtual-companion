<template>
  <view class="chat-page">
    <view class="chat-header">Technical Alpha · 离线聊天</view>

    <view v-if="initError" class="chat-error" role="alert">
      <text>初始化失败，请刷新重试</text>
    </view>

    <template v-else>
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
        <view class="chat-history" data-testid="history">
          <view
            v-if="showEmptyHistory"
            class="chat-empty"
            data-testid="empty-history"
            role="status"
          >
            <text>还没有消息。输入一句话开始倾听。</text>
          </view>
          <view
            v-for="msg in messages"
            :key="msg.messageId"
            class="chat-message"
            :class="msg.role"
          >
            <text class="role-tag">{{ roleLabel(msg.role) }}</text>
            <text class="msg-content">{{ msg.content }}</text>
          </view>
        </view>

        <view v-if="draft" class="chat-draft" data-testid="draft">
          <text>{{ draft }}</text>
        </view>

        <view class="chat-status" data-testid="status" role="status" aria-live="polite">
          <text>{{ statusText }}</text>
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
import { createAuthenticatedTransport } from "@/api/transport";
import { createBrowserRealtimeDeps } from "@/api/realtime-transport";
import type { RealtimeDeps } from "@/api/realtime";
import RelationshipSelector from "@/components/RelationshipSelector.vue";
import { useAuthStore } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { useRelationshipStore } from "@/stores/relationship";

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

    // sessionId: client-generated UUID per chat session — the real source for
    // the realtime ticket binding (mint body carries it).
    const sessionId = crypto.randomUUID();

    // One authenticated transport serves both the relationship and chat API
    // clients (identical {request → {ok,status,json}} structural shape).
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      onUnauthorized: () => auth.onUnauthorized(),
    });
    const authedFetch = createAuthedFetch(() => auth.accessToken);
    const deps: RealtimeDeps = createBrowserRealtimeDeps(
      { sessionId, origin: resolveOrigin() },
      authedFetch,
    );

    const messages = computed(() => store.messages);
    const draft = computed(() => store.draft);
    const isStreaming = computed(() => store.isStreaming);
    const canSend = computed(() => inputText.value.trim().length > 0);
    const hasRelationship = computed(() => relStore.currentRelationshipId !== null);
    const showEmptyHistory = computed(
      () =>
        hasRelationship.value &&
        !isStreaming.value &&
        !draft.value &&
        messages.value.length === 0,
    );

    function roleLabel(role: string): string {
      if (role === "assistant") return "AI";
      if (role === "user") return "我";
      return role;
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
          return store.stream.terminal ? "已完成（安全终态）" : "已结束";
        case "cancelled":
          return "已取消";
        case "failed":
          return store.outcome === "not_found_or_forbidden"
            ? "未找到或无权访问（存在性不披露）"
            : "发送失败，请重试";
        default:
          return "";
      }
    });

    async function onSend(): Promise<void> {
      const text = inputText.value.trim();
      if (!text || store.isStreaming) return;
      inputText.value = "";
      await store.send(transport, deps, text);
    }

    function onCancel(): void {
      store.cancel();
    }

    /**
     * Reset the chat store and create a fresh conversation under the currently
     * selected relationship. Used on mount (when an active relationship exists)
     * and whenever the user activates/creates a relationship.
     */
    async function startConversation(): Promise<void> {
      const relationshipId = relStore.currentRelationshipId;
      if (!relationshipId) return;
      store.reset();
      try {
        await store.initConversation(transport, relationshipId);
      } catch {
        initError.value = true;
      }
    }

    async function onRelActivate(relationshipId: string): Promise<void> {
      const result = await relStore.activate(transport, relationshipId);
      if (result) {
        initError.value = false;
        await startConversation();
      }
    }

    async function onRelCreate(personaRef: string): Promise<void> {
      const result = await relStore.create(transport, personaRef);
      if (result) {
        initError.value = false;
        await startConversation();
      }
    }

    onMounted(async () => {
      // load() catches its own failures (status="error", no throw); the
      // selector surfaces them without faking success.
      await relStore.load(transport);
      if (relStore.currentRelationshipId) {
        await startConversation();
      }
    });

    onUnmounted(() => {
      store.cancel();
      store.reset();
    });

    return {
      relStore,
      messages,
      draft,
      isStreaming,
      showEmptyHistory,
      canSend,
      hasRelationship,
      inputText,
      initError,
      statusText,
      roleLabel,
      onSend,
      onCancel,
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
  font-size: 32rpx;
  font-weight: 600;
  margin-bottom: 24rpx;
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
.chat-input-area {
  display: flex;
  align-items: center;
  gap: 12rpx;
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
</style>
