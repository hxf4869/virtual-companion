<template>
  <view class="chat-page">
    <view class="chat-header">Technical Alpha · 离线聊天恢复</view>

    <view class="chat-draft" data-testid="draft">
      <text>{{ draft || placeholder }}</text>
    </view>

    <view class="chat-status" data-testid="status" role="status" aria-live="polite">
      <text>{{ statusText }}</text>
    </view>

    <view class="chat-actions">
      <button
        class="chat-cancel"
        :disabled="!isStreaming"
        :aria-busy="isStreaming"
        data-testid="cancel"
        @click="onCancel"
      >
        取消
      </button>
    </view>
  </view>
</template>

<script lang="ts">
// TASK-0026/TASK-0104 H5 chat page. Presentation only; the load-bearing stream
// logic lives in the tested domain/api/stores modules. The realtime transport
// (ticket mint + resume + snapshot) is the tested realtime-transport module
// wired here for production. No WebSocket, no media, no long-lived token in
// localStorage (per realtime-contract h5Security).
//
// TASK-0185: the transport is aligned to the 0184 resume endpoint contract
// (POST /api/v1/realtime/tickets → GET /api/v1/realtime/streams/{id}?ticket…
// + Last-Event-ID header). sessionId is a demo placeholder until TASK-0025
// wires the generation-creation flow that mints it; origin is the page origin
// the SSE resume is opened from.
//
// TASK-0105 (P3-04): the status region carries role="status" +
// aria-live="polite" and the cancel button aria-busy while streaming, so
// async phase changes are announced to assistive technology.
import { computed, defineComponent, onUnmounted, ref } from "vue";

import { createBrowserRealtimeDeps } from "@/api/realtime-transport";
import { useChatStore } from "@/stores/chat";

// Alpha demo: sessionId is fixed until the generation-creation flow (TASK-0025)
// supplies it. origin is the H5 page origin the resume is opened from.
const DEMO_SESSION_ID = "session-alpha-1";

function resolveOrigin(): string {
  return typeof window !== "undefined" && window.location && window.location.origin
    ? window.location.origin
    : "http://localhost:5173";
}

export default defineComponent({
  name: "ChatPage",
  setup() {
    const store = useChatStore();
    const generationId = ref("gen-alpha-1");
    const deps = createBrowserRealtimeDeps({
      sessionId: DEMO_SESSION_ID,
      origin: resolveOrigin(),
    });

    const draft = computed(() => store.draft);
    const isStreaming = computed(() => store.isStreaming);

    const placeholder = computed(() =>
      store.phase === "idle" ? "等待流式响应…" : "（无连续增量可显示）",
    );

    const statusText = computed(() => {
      switch (store.phase) {
        case "idle":
          return "空闲";
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
            : "恢复失败，请重试";
        default:
          return "";
      }
    });

    async function start(): Promise<void> {
      await store.run(deps, generationId.value, 1);
    }

    function onCancel(): void {
      store.cancel();
    }

    onUnmounted(() => {
      store.cancel();
      store.reset();
    });

    // In the full H5 integration this page is opened after a generation is sent
    // (POST /api/v1/conversations/{id}/generations). For the Alpha offline demo
    // the stream is started on mount against a known generation id.
    void start();

    return {
      draft,
      placeholder,
      isStreaming,
      statusText,
      onCancel,
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
}
.chat-header {
  font-size: 32rpx;
  font-weight: 600;
  margin-bottom: 24rpx;
}
.chat-draft {
  min-height: 240rpx;
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
.chat-actions .chat-cancel {
  background-color: #e63946;
  color: #ffffff;
}
</style>
