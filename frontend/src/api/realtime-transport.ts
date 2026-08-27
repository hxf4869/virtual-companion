// TASK-0185: browser Fetch-SSE realtime transport aligned to the 0184 resume
// endpoint contract. RealtimeDeps (resume + fetchSnapshot) is the injected
// transport surface consumed by the tested streamGeneration orchestrator
// (api/realtime.ts). This module is the single place that knows the wire shape
// of POST /api/v1/realtime/tickets + GET /api/v1/realtime/streams/{generationId}
// + GET /api/v1/generations/{generationId}/snapshot, so the orchestration stays
// fully mockable and the contract glue is unit-tested in isolation.
//
// The 0184 RealtimeStreamController encodes the resume disposition as the SSE
// event name: durable events carry their type (chat.delta, ...), the terminal
// snapshot carries "snapshot", and the control events stream.gap / stream.reset
// / stream.denied carry no data line. This module maps those back onto the
// ResumeDisposition union the orchestrator consumes, never fabricating deltas
// (INV-RT-001 lives in the reducer; this module only routes).
//
// h5Security (realtime-contract): the ticket secret is a 45s single-use
// credential carried in the resume query, NOT the long-lived token forbidden
// there; the long-lived access token stays in the Authorization header attached
// by the authenticated transport (api/transport.ts). No credential is written to
// localStorage. A foreign or absent generation, or any ticket-consume failure,
// fails closed as NOT_FOUND_OR_FORBIDDEN so existence is never disclosed.

import type {
  RealtimeDeps,
  ResumeDisposition,
  ResumeRequest,
  ResumeResult,
  SnapshotResult,
} from "@/api/realtime";
import type { StreamEvent } from "@/domain/stream-reducer";
import { parseStreamEvent } from "@/api/realtime-envelope";
import {
  consumeSseFrames,
  SseAbortedError,
  SseParseError,
  type SseFrame,
} from "@/api/sse-parser";
import type { SnapshotUsage } from "@/api/realtime";

const TICKETS_ENDPOINT = "/api/v1/realtime/tickets";
const STREAMS_ENDPOINT = "/api/v1/realtime/streams";
const GENERATIONS_ENDPOINT = "/api/v1/generations";

/** Control SSE event names emitted by the 0184 controller. */
const EVENT_SNAPSHOT = "snapshot";
const EVENT_GAP = "stream.gap";
const EVENT_RESET = "stream.reset";
const EVENT_DENIED = "stream.denied";

/** Statuses that must never disclose resource existence. */
const EXISTENCE_HIDDEN_STATUS = new Set([401, 403, 404]);

export interface BrowserRealtimeContext {
  /** The caller's realtime session id (bound to the minted ticket). */
  sessionId: string;
  /** The origin the SSE resume is opened from (bound to the minted ticket). */
  origin: string;
}

type FetchImpl = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Build the {@link RealtimeDeps} that drive the Fetch-SSE resume + snapshot
 * endpoints for production. {@link BrowserRealtimeContext} supplies the
 * per-session sessionId/origin the ticket is bound to; the per-resume cursor
 * (generationId/afterSeq/streamEpoch) comes from each {@link ResumeRequest}.
 *
 * A `fetchImpl` is accepted for testing so the spec can stub the network
 * without global mocking; production leaves it unset to use the ambient fetch.
 */
export function createBrowserRealtimeDeps(
  context: BrowserRealtimeContext,
  fetchImpl?: FetchImpl,
): RealtimeDeps {
  const doFetch = fetchImpl ?? fetch;
  return {
    resume: (request, signal, onDurableEvent) =>
      resumeWithTicket(doFetch, context, request, signal, onDurableEvent),
    fetchSnapshot: (generationId, signal) => fetchSnapshot(doFetch, generationId, signal),
  };
}

interface MintedTicket {
  ticketId: string;
  secret: string;
}

/**
 * Mint a single-use ticket then open the resume stream. The ticket is bound to
 * the seven-tuple (owner, generation, session, origin, transport, streamEpoch,
 * afterSeq); owner and transport are server-fixed and never sent in the body.
 * Each resume opens a fresh ticket because the ticket is single-use with a 45s
 * TTL, so the orchestrator's reconnect loop mints one per attempt.
 *
 * P1（round6）：连接内流式。每个完整解析的 durable event 帧到达时立即通过
 * {@link onDurableEvent} 派发（同一连接内不等 EOF）；已派发的事件不再进入
 * 返回的 ResumeResult——最终结果只携带 disposition/nextEpoch 与未被流式
 * 派发的内容（snapshot 事件、未提供回调时的整批事件）。
 */
async function resumeWithTicket(
  doFetch: FetchImpl,
  context: BrowserRealtimeContext,
  request: ResumeRequest,
  signal?: AbortSignal,
  onDurableEvent?: (event: StreamEvent) => void,
): Promise<ResumeResult> {
  const ticket = await mintTicket(doFetch, context, request, signal);
  if (ticket === null) {
    // Existence hidden at mint time (foreign/absent generation): surface the
    // typed outcome instead of a thrown transport failure.
    return { disposition: "NOT_FOUND_OR_FORBIDDEN", events: [] };
  }

  const params = new URLSearchParams({
    ticketId: ticket.ticketId,
    secret: ticket.secret,
    sessionId: context.sessionId,
    origin: context.origin,
    streamEpoch: String(request.streamEpoch),
  });
  const url = `${STREAMS_ENDPOINT}/${encodeURIComponent(request.generationId)}?${params}`;
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "Last-Event-ID": String(request.afterSeq),
  };
  const response = await doFetch(url, { method: "GET", headers, signal });

  if (EXISTENCE_HIDDEN_STATUS.has(response.status)) {
    // Existence is never disclosed.
    return { disposition: "NOT_FOUND_OR_FORBIDDEN", events: [] };
  }
  if (!response.ok) {
    // 5xx and other failures are typed transport failures (exhausted), never an
    // empty stream that looks like a disconnect.
    throw new Error(`resume failed with status ${response.status}`);
  }

  const mapper = createFrameMapper(request.streamEpoch, onDurableEvent);
  try {
    await consumeSseFrames(response.body, signal, mapper.onFrame);
  } catch (error) {
    if (error instanceof SseAbortedError) {
      throw error; // cancellation surfaces through the handle
    }
    throw error instanceof SseParseError ? error : new SseParseError("resume stream failed");
  }
  return mapper.result();
}

type DurableEventSink = ((event: StreamEvent) => void) | undefined;

interface FrameMapperState {
  onFrame(frame: SseFrame): void;
  result(): ResumeResult;
}

/**
 * P1（round6）：把 SSE 帧序列状态化地映射为 disposition + 事件交付路径。
 * durable 帧 → parseStreamEvent → 有回调就即时派发（不回填 result.events，
 * 保证最终 ResumeResult 不重复应用）；无回调时保留旧的整批累积语义。
 * snapshot 元数据帧切 TERMINAL_SNAPSHOT；其后到达的 durable 帧属于快照的
 * 权威内容（0184 runtime 的"元数据后随有序事件帧"格式），逐个缓冲、EOF 后
 * 整体返回，由调用方以 applyTerminalSnapshot 原子替换草稿——绝不作为流式
 * 增量发布。control 帧（gap/reset/denied）裁定后仍会流出的 durable 帧不再
 * 应用——与旧 mapFrames 中"orchestrator 忽略非 RESUMED 批次事件"等价。
 */
function createFrameMapper(fallbackEpoch: number, sink: DurableEventSink): FrameMapperState {
  let disposition: ResumeDisposition = "RESUMED";
  let nextEpoch: number | undefined;
  let snapshotEvents: StreamEvent[] | null = null;
  // EVENT_SNAPSHOT 元数据缺 events 数组时为 true：其后到达的 durable 帧就是
  // 快照内容（0184 runtime 格式），逐个吸收；元数据已权威则为 false，后到
  // 内容整体丢弃。
  let acceptSnapshotFrames = false;
  // 未提供回调时的旧批量语义：事件累积进 result.events。
  const batchEvents: StreamEvent[] = [];

  function pushCandidate(candidate: unknown): void {
    const event = parseStreamEvent(candidate, fallbackEpoch);
    if (!event) return;
    if (sink) {
      // 连接内即时派发；不回填 result——最终 ResumeResult 不重复应用。
      sink(event);
    } else {
      batchEvents.push(event);
    }
  }

  function absorbSnapshotCandidate(candidate: unknown): void {
    const event = parseStreamEvent(candidate, fallbackEpoch);
    if (!event) return;
    if (snapshotEvents === null) snapshotEvents = [];
    snapshotEvents.push(event);
  }

  function handleCandidates(payload: Record<string, unknown>): void {
    const isEnvelopeList = Array.isArray(payload.events);
    if (disposition === "TERMINAL_SNAPSHOT") {
      if (!acceptSnapshotFrames) return; // 元数据已权威：丢弃同样位置的内容
      for (const candidate of isEnvelopeList ? (payload.events as unknown[]) : [payload]) {
        absorbSnapshotCandidate(candidate);
      }
      return;
    }
    if (disposition !== "RESUMED") {
      // gap/reset/denied 已裁定：durable 流出物不再应用（单一应用不变量），
      // 与旧批量实现中 orchestrator 忽略非 RESUMED 批次事件的语义一致。
      return;
    }
    for (const candidate of isEnvelopeList ? (payload.events as unknown[]) : [payload]) {
      pushCandidate(candidate);
    }
  }

  return {
    onFrame(frame) {
      const eventName = frame.event;
      if (eventName === EVENT_GAP) {
        disposition = "GAP_EXPIRED";
        return;
      }
      if (eventName === EVENT_RESET) {
        disposition = "RESET_REQUIRED";
        const data = frame.data;
        if (data !== null && typeof data === "object" && !Array.isArray(data)) {
          const next = (data as { nextEpoch?: unknown }).nextEpoch;
          if (typeof next === "number") nextEpoch = next;
        }
        return;
      }
      if (eventName === EVENT_DENIED) {
        disposition = "NOT_FOUND_OR_FORBIDDEN";
        return;
      }
      if (eventName === EVENT_SNAPSHOT) {
        disposition = "TERMINAL_SNAPSHOT";
        snapshotEvents = extractSnapshotEvents(frame.data, fallbackEpoch);
        acceptSnapshotFrames = snapshotEvents === null;
        return;
      }
      // 无 data 行的控制帧（无载荷）跳过；其余按 durable 处理。
      if (frame.data === null) return;
      const payload = frame.data as Record<string, unknown>;
      if (typeof payload.disposition === "string") {
        disposition = payload.disposition as ResumeDisposition;
      }
      handleCandidates(payload);
    },
    result() {
      if (disposition === "TERMINAL_SNAPSHOT" && snapshotEvents !== null) {
        return { disposition, events: snapshotEvents };
      }
      const result: ResumeResult = { disposition, events: sink ? [] : batchEvents };
      if (nextEpoch !== undefined) {
        result.nextEpoch = nextEpoch;
      }
      return result;
    },
  };
}

/**
 * Mint a single-use resume ticket. Returns null when the generation is foreign
 * or absent (401/403/404) so existence is never disclosed; throws on any other
 * non-OK status or malformed payload.
 */
async function mintTicket(
  doFetch: FetchImpl,
  context: BrowserRealtimeContext,
  request: ResumeRequest,
  signal?: AbortSignal,
): Promise<MintedTicket | null> {
  // Owner and transport are server-fixed (server-verified principal +
  // FETCH_SSE); only the bindable client fields are sent.
  const body = {
    generationId: String(request.generationId),
    sessionId: context.sessionId,
    origin: context.origin,
    streamEpoch: String(request.streamEpoch),
    afterSeq: String(request.afterSeq),
  };
  const response = await doFetch(TICKETS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (EXISTENCE_HIDDEN_STATUS.has(response.status)) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`ticket mint failed with status ${response.status}`);
  }
  const data = (await response.json().catch(() => null)) as unknown;
  if (
    !isRecord(data) ||
    typeof data.ticketId !== "string" ||
    typeof data.secret !== "string"
  ) {
    throw new Error("ticket mint returned an invalid ticket payload");
  }
  return { ticketId: data.ticketId, secret: data.secret };
}

/** Extract a snapshot frame's authoritative `events` array (null when absent). */
function extractSnapshotEvents(data: unknown, fallbackEpoch: number): StreamEvent[] | null {
  if (!isRecord(data) || !Array.isArray(data.events)) {
    // The runtime emits snapshot metadata followed by the ordered durable
    // event frames. Missing `events` means "use those frames", not an
    // authoritative empty terminal snapshot.
    return null;
  }
  const events: StreamEvent[] = [];
  for (const candidate of data.events) {
    const event = parseStreamEvent(candidate, fallbackEpoch);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

async function fetchSnapshot(
  doFetch: FetchImpl,
  generationId: string,
  signal?: AbortSignal,
): Promise<SnapshotResult> {
  const url = `${GENERATIONS_ENDPOINT}/${encodeURIComponent(generationId)}/snapshot`;
  const response = await doFetch(url, { method: "GET", signal });
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
    const event = parseStreamEvent(candidate, epoch);
    if (event) {
      events.push(event);
    }
  }
  // USAGE-VIZ: settled provider tokens, present only after finalize.
  const usage = parseUsage(data.usage);
  return usage
    ? { ok: true, status: response.status, events, usage }
    : { ok: true, status: response.status, events };
}

/** USAGE-VIZ: strict parse of the snapshot usage object (absent → null). */
function parseUsage(raw: unknown): SnapshotUsage | null {
  if (!isRecord(raw)) return null;
  const inputTokens = Number(raw.inputTokens);
  const outputTokens = Number(raw.outputTokens);
  if (!Number.isInteger(inputTokens) || inputTokens < 0) return null;
  if (!Number.isInteger(outputTokens) || outputTokens < 0) return null;
  return { inputTokens, outputTokens };
}
