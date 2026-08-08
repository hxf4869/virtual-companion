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
// logic lives in the tested domain/api/stores modules. The transport factory
// below wires the Fetch-SSE resume + snapshot endpoints for production. No
// WebSocket, no media, no long-lived token in localStorage (per
// realtime-contract h5Security).
//
// TASK-0104 (P2-14/P2-15): the SSE frame parser is the tested
// sse-parser module (LF/CRLF, tail flush, typed SseParseError); resume and
// snapshot fetches receive the per-run AbortSignal from the stream handle, so
// cancel / new run / unmount truly abort the underlying fetch. 5xx / network
// failures surface as typed exhausted failures instead of empty streams or
// fake terminal snapshots.
//
// TASK-0105 (P3-04): the status region carries role="status" +
// aria-live="polite" and the cancel button aria-busy while streaming, so
// async phase changes are announced to assistive technology.
import { computed, defineComponent, onUnmounted, ref } from "vue";

import { useChatStore } from "@/stores/chat";
import type {
  RealtimeDeps,
  ResumeDisposition,
  ResumeRequest,
  ResumeResult,
  SnapshotResult,
} from "@/api/realtime";
import { readSseFrames, SseParseError, SseAbortedError } from "@/api/sse-parser";
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

function createBrowserRealtimeDeps(): RealtimeDeps {
  return {
    resume: async (request: ResumeRequest, signal?: AbortSignal): Promise<ResumeResult> => {
      const url = `${RESUME_ENDPOINT}?generationId=${encodeURIComponent(
        request.generationId,
      )}&afterSeq=${request.afterSeq}&streamEpoch=${request.streamEpoch}`;
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal,
      });
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        // Existence is never disclosed.
        return { disposition: "NOT_FOUND_OR_FORBIDDEN", events: [] };
      }
      if (!response.ok) {
        // 5xx and other failures are typed transport failures (exhausted),
        // never an empty stream that looks like a disconnect.
        throw new Error(`resume failed with status ${response.status}`);
      }
      let frames;
      try {
        frames = await readSseFrames(response.body, signal);
      } catch (error) {
        if (error instanceof SseAbortedError) {
          throw error; // cancellation surfaces through the handle
        }
        throw error instanceof SseParseError
          ? error
          : new SseParseError("resume stream failed");
      }
      const events: StreamEvent[] = [];
      let disposition: ResumeDisposition = "RESUMED";
      for (const frame of frames) {
        if (frame.disposition) {
          disposition = frame.disposition as ResumeDisposition;
        }
        // Envelope frames carry {"disposition":...,"events":[...]}; a bare
        // event object is treated as a single-event frame (R1 P2: restore the
        // envelope shape so TERMINAL_SNAPSHOT event batches are not dropped).
        const payload = frame.data as Record<string, unknown>;
        const candidates = Array.isArray(payload.events) ? payload.events : [frame.data];
        for (const candidate of candidates) {
          const event = parseEvent(candidate, request.streamEpoch);
          if (event) {
            events.push(event);
          }
        }
      }
      return { disposition, events };
    },
    fetchSnapshot: async (generationId: string, signal?: AbortSignal): Promise<SnapshotResult> => {
      const response = await fetch(
        `${SNAPSHOT_ENDPOINT}/${encodeURIComponent(generationId)}/snapshot`,
        { method: "GET", signal },
      );
      if (!response.ok) {
        // P1-07: a failed snapshot is a typed failure, never a fake terminal.
        return { ok: false, status: response.status, events: [] };
      }
      const data = (await response.json().catch(() => null)) as unknown;
      if (!isRecord(data) || !Array.isArray(data.events)) {
        return { ok: false, status: response.status, events: [] };
      }
      const epoch = Number((data as { streamEpoch?: unknown }).streamEpoch ?? 1);
      const events: StreamEvent[] = [];
      for (const candidate of data.events) {
        const event = parseEvent(candidate, epoch);
        if (event) {
          events.push(event);
        }
      }
      return { ok: true, status: response.status, events };
    },
  };
}

export default defineComponent({
  name: "ChatPage",
  setup() {
    const store = useChatStore();
    const generationId = ref("gen-alpha-1");
    const deps = createBrowserRealtimeDeps();

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
