// Go v1 浏览器 Fetch-SSE transport。实时流直接使用同源 HttpOnly opaque
// session cookie；不再铸造 ticket，也不把 secret、sessionId 或 origin 放进
// URL。服务端不公开 SSE id/epoch，本模块只在当前浏览器运行期为 reducer
// 分配连续序号；重连时服务端先发送 chat.snapshot 全量草稿，再继续 delta。

import type {
  RealtimeDeps,
  ResumeRequest,
  ResumeResult,
  SnapshotResult,
  SnapshotUsage,
} from "@/api/realtime";
import { parseStreamEvent } from "@/api/realtime-envelope";
import {
  consumeSseFrames,
  SseAbortedError,
  SseParseError,
  type SseFrame,
} from "@/api/sse-parser";
import type { StreamEvent } from "@/domain/stream-reducer";

const STREAMS_ENDPOINT = "/api/v1/realtime/streams";
const GENERATIONS_ENDPOINT = "/api/v1/generations";
const EXISTENCE_HIDDEN_STATUS = new Set([401, 403, 404]);
const PUBLIC_EVENTS = new Set([
  "chat.accepted",
  "chat.snapshot",
  "chat.delta",
  "chat.completed",
  "chat.blocked",
  "chat.failed",
  "chat.cancelled",
]);

type FetchImpl = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Build production Fetch-SSE and snapshot dependencies. */
export function createBrowserRealtimeDeps(fetchImpl?: FetchImpl): RealtimeDeps {
  const doFetch = fetchImpl ?? fetch;
  return {
    resume: (request, signal, onDurableEvent) =>
      resumeWithCookie(doFetch, request, signal, onDurableEvent),
    fetchSnapshot: (generationId, signal) =>
      fetchSnapshot(doFetch, generationId, signal),
  };
}

async function resumeWithCookie(
  doFetch: FetchImpl,
  request: ResumeRequest,
  signal?: AbortSignal,
  onDurableEvent?: (event: StreamEvent) => void,
): Promise<ResumeResult> {
  const response = await doFetch(
    `${STREAMS_ENDPOINT}/${encodeURIComponent(request.generationId)}`,
    {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        // Go v1 当前不把它当持久化游标；保留标准头便于代理诊断，并让
        // 浏览器本地伪序号在重连时从已有 cursor 继续。
        "Last-Event-ID": String(request.afterSeq),
      },
      credentials: "include",
      signal,
    },
  );
  if (EXISTENCE_HIDDEN_STATUS.has(response.status)) {
    return { disposition: "NOT_FOUND_OR_FORBIDDEN", events: [] };
  }
  if (!response.ok) {
    throw new Error(`resume failed with status ${response.status}`);
  }

  let nextSeq = request.afterSeq;
  const batch: StreamEvent[] = [];
  try {
    await consumeSseFrames(response.body, signal, (frame) => {
      const parsed = parseRealtimeFrame(frame, request.streamEpoch, nextSeq);
      if (!parsed) return;
      nextSeq = parsed.nextSeq;
      if (onDurableEvent) {
        onDurableEvent(parsed.event);
      } else {
        batch.push(parsed.event);
      }
    });
  } catch (error) {
    if (error instanceof SseAbortedError || error instanceof SseParseError) {
      throw error;
    }
    throw new SseParseError("resume stream failed");
  }
  return { disposition: "RESUMED", events: onDurableEvent ? [] : batch };
}

interface ParsedRealtimeFrame {
  event: StreamEvent;
  nextSeq: number;
}

function parseRealtimeFrame(
  frame: SseFrame,
  fallbackEpoch: number,
  previousSeq: number,
): ParsedRealtimeFrame | null {
  if (!isRecord(frame.data)) return null;

  // 接受带显式序号的通用事件，方便 snapshot 响应和 reducer 单测继续使用
  // 同一解析器；Go 实时流走下方无序号分支。
  const sequenced = parseStreamEvent(frame.data, fallbackEpoch);
  if (sequenced) {
    return {
      event: sequenced,
      nextSeq: Math.max(previousSeq, sequenced.eventSeq),
    };
  }

  const payloadEvent =
    typeof frame.data.event === "string" ? frame.data.event : "";
  const frameEvent = frame.event ?? "";
  if (payloadEvent && frameEvent && payloadEvent !== frameEvent) return null;
  const eventType = payloadEvent || frameEvent;
  if (!PUBLIC_EVENTS.has(eventType)) return null;

  const eventSeq = previousSeq + 1;
  let payload: unknown = null;
  if (eventType === "chat.delta" || eventType === "chat.snapshot") {
    payload = typeof frame.data.text === "string" ? frame.data.text : "";
  } else if (
    (eventType === "chat.failed" || eventType === "chat.blocked") &&
    typeof frame.data.fault === "string" &&
    frame.data.fault.trim()
  ) {
    // Only the stable, user-copy mapping key crosses into the reducer. Raw
    // provider diagnostics and work-item details remain server-side.
    payload = { fault: frame.data.fault };
  }
  return {
    event: {
      eventSeq,
      streamEpoch: fallbackEpoch,
      eventType,
      payload,
    },
    nextSeq: eventSeq,
  };
}

async function fetchSnapshot(
  doFetch: FetchImpl,
  generationId: string,
  signal?: AbortSignal,
): Promise<SnapshotResult> {
  const response = await doFetch(
    `${GENERATIONS_ENDPOINT}/${encodeURIComponent(generationId)}/snapshot`,
    { method: "GET", credentials: "include", signal },
  );
  if (!response.ok) {
    return { ok: false, status: response.status, events: [] };
  }
  const data = (await response.json().catch(() => null)) as unknown;
  if (!isRecord(data) || !Array.isArray(data.events)) {
    return { ok: false, status: response.status, events: [] };
  }

  const epoch = Number(data.streamEpoch ?? 1);
  let nextSeq = 0;
  const events: StreamEvent[] = [];
  for (const candidate of data.events) {
    const parsed = parseRealtimeFrame(
      { data: candidate },
      Number.isFinite(epoch) ? epoch : 1,
      nextSeq,
    );
    if (!parsed) continue;
    nextSeq = parsed.nextSeq;
    events.push(parsed.event);
  }
  const usage = parseUsage(data.usage);
  return usage
    ? { ok: true, status: response.status, events, usage }
    : { ok: true, status: response.status, events };
}

function parseUsage(raw: unknown): SnapshotUsage | null {
  if (!isRecord(raw)) return null;
  const inputTokens = Number(raw.inputTokens);
  const outputTokens = Number(raw.outputTokens);
  if (!Number.isInteger(inputTokens) || inputTokens < 0) return null;
  if (!Number.isInteger(outputTokens) || outputTokens < 0) return null;
  return { inputTokens, outputTokens };
}
