<template>
  <view class="chat-page">
    <view class="chat-header">Technical Alpha · 离线聊天恢复</view>

    <view class="chat-draft" data-testid="draft">
      <text>{{ draft || placeholder }}</text>
    </view>

    <view class="chat-status" data-testid="status">
      <text>{{ statusText }}</text>
    </view>

    <view class="chat-actions">
      <button
        class="chat-cancel"
        :disabled="!isStreaming"
        data-testid="cancel"
        @click="onCancel"
      >
        取消
      </button>
    </view>
  </view>
</template>

<script lang="ts">
// TASK-0026 H5 chat page. Presentation only; the load-bearing stream logic lives
// in the tested domain/api/stores modules. The transport factory below wires the
// Fetch-SSE resume + snapshot endpoints for production. No WebSocket, no media,
// no long-lived token in localStorage (per realtime-contract h5Security).
import { computed, defineComponent, onUnmounted, ref } from "vue";

import { useChatStore } from "@/stores/chat";
import {
  createStreamHandle,
  type RealtimeDeps,
  type ResumeDisposition,
  type ResumeRequest,
  type ResumeResult,
} from "@/api/realtime";
import type { StreamEvent } from "@/domain/stream-reducer";

const RESUME_ENDPOINT = "/api/v1/realtime/resume";
const SNAPSHOT_ENDPOINT = "/api/v1/generations";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvent(value: unknown, epoch: number): StreamEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const eventSeq = Number(value.eventSeq);
  const streamEpoch = Number(value.streamEpoch ?? epoch);
  const eventType = String(value.eventType ?? "");
  if (!Number.isFinite(eventSeq) || !Number.isFinite(streamEpoch) || eventType === "") {
    return null;
  }
  return { eventSeq, streamEpoch, eventType, payload: value.payload };
}

/**
 * Parse an SSE byte/chunk stream into events. Kept here as the H5 transport
 * glue; the reducer (tested) is what guarantees no delta is fabricated.
 */
async function readSseEvents(
  body: ReadableStream<Uint8Array> | null,
  epoch: number,
): Promise<{ disposition: ResumeDisposition; events: StreamEvent[] }> {
  if (!body || !body.getReader) {
    return { disposition: "RESUMED", events: [] };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: StreamEvent[] = [];
  let disposition: ResumeDisposition = "RESUMED";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLines = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) {
        boundary = buffer.indexOf("\n\n");
        continue;
      }
      try {
        const payload = JSON.parse(dataLines.join("\n"));
        if (isRecord(payload) && typeof payload.disposition === "string") {
          disposition = payload.disposition as ResumeDisposition;
        }
        const candidates = Array.isArray(payload.events) ? payload.events : [payload];
        for (const candidate of candidates) {
          const event = parseEvent(candidate, epoch);
          if (event) {
            events.push(event);
          }
        }
      } catch {
        // Ignore a malformed frame; the reducer only advances contiguous data.
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  return { disposition, events };
}

function createBrowserRealtimeDeps(): RealtimeDeps {
  return {
    resume: async (request: ResumeRequest): Promise<ResumeResult> => {
      const url = `${RESUME_ENDPOINT}?generationId=${encodeURIComponent(
        request.generationId,
      )}&afterSeq=${request.afterSeq}&streamEpoch=${request.streamEpoch}`;
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
      });
      if (response.status === 401) {
        return { disposition: "NOT_FOUND_OR_FORBIDDEN", events: [] };
      }
      if (response.status === 404) {
        // Existence is never disclosed.
        return { disposition: "NOT_FOUND_OR_FORBIDDEN", events: [] };
      }
      const parsed = await readSseEvents(response.body, request.streamEpoch);
      return parsed;
    },
    fetchSnapshot: async (generationId: string): Promise<StreamEvent[]> => {
      const response = await fetch(
        `${SNAPSHOT_ENDPOINT}/${encodeURIComponent(generationId)}/snapshot`,
        { method: "GET" },
      );
      if (!response.ok) {
        return [];
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data) || !Array.isArray(data.events)) {
        return [];
      }
      const events: StreamEvent[] = [];
      for (const candidate of data.events) {
        const event = parseEvent(candidate, Number((data as { streamEpoch?: unknown }).streamEpoch ?? 1));
        if (event) {
          events.push(event);
        }
      }
      return events;
    },
  };
}

export default defineComponent({
  name: "ChatPage",
  setup() {
    const store = useChatStore();
    const generationId = ref("gen-alpha-1");
    const deps = createBrowserRealtimeDeps();
    const handle = createStreamHandle();

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
