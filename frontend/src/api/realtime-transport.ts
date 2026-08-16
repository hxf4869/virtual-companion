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
import { parseStreamEvent } from "@/api/realtime-envelope";
import { readSseFrames, SseAbortedError, SseParseError, type SseFrame } from "@/api/sse-parser";
import type { SnapshotUsage } from "@/api/realtime";
import type { StreamEvent } from "@/domain/stream-reducer";

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
    resume: (request, signal) => resumeWithTicket(doFetch, context, request, signal),
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
 */
async function resumeWithTicket(
  doFetch: FetchImpl,
  context: BrowserRealtimeContext,
  request: ResumeRequest,
  signal?: AbortSignal,
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

  let frames: SseFrame[];
  try {
    frames = await readSseFrames(response.body, signal);
  } catch (error) {
    if (error instanceof SseAbortedError) {
      throw error; // cancellation surfaces through the handle
    }
    throw error instanceof SseParseError ? error : new SseParseError("resume stream failed");
  }
  return mapFrames(frames, request.streamEpoch);
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

/**
 * Map the parsed SSE frames back onto a {@link ResumeResult}. The 0184
 * controller encodes the disposition as the SSE event name; a legacy
 * {disposition, events} envelope shape is still honoured for robustness. Durable
 * event envelopes are parsed via the catalog `event` field (realtime-envelope).
 */
function mapFrames(frames: SseFrame[], fallbackEpoch: number): ResumeResult {
  let disposition: ResumeDisposition = "RESUMED";
  let nextEpoch: number | undefined;
  let snapshotEvents: StreamEvent[] | null = null;
  const events: StreamEvent[] = [];

  for (const frame of frames) {
    const eventName = frame.event;
    if (eventName === EVENT_GAP) {
      disposition = "GAP_EXPIRED";
      continue;
    }
    if (eventName === EVENT_RESET) {
      disposition = "RESET_REQUIRED";
      const data = frame.data;
      if (isRecord(data) && typeof data.nextEpoch === "number") {
        nextEpoch = data.nextEpoch;
      }
      continue;
    }
    if (eventName === EVENT_DENIED) {
      disposition = "NOT_FOUND_OR_FORBIDDEN";
      continue;
    }
    if (eventName === EVENT_SNAPSHOT) {
      // TERMINAL_SNAPSHOT: the authoritative committed snapshot. Its events
      // replace the draft (applyTerminalSnapshot); extract them here.
      disposition = "TERMINAL_SNAPSHOT";
      snapshotEvents = extractSnapshotEvents(frame.data, fallbackEpoch);
      continue;
    }
    // Durable event envelope (event: <type>, data: {event,eventSeq,...}) or the
    // legacy {disposition, events:[...]} envelope shape. A control event with
    // no data line (data === null) carries no durable event and is skipped.
    if (frame.data === null) {
      continue;
    }
    const payload = frame.data as Record<string, unknown>;
    if (typeof payload.disposition === "string") {
      disposition = payload.disposition as ResumeDisposition;
    }
    const candidates = Array.isArray(payload.events) ? payload.events : [payload];
    for (const candidate of candidates) {
      const event = parseStreamEvent(candidate, fallbackEpoch);
      if (event) {
        events.push(event);
      }
    }
  }

  if (disposition === "TERMINAL_SNAPSHOT" && snapshotEvents !== null) {
    return { disposition, events: snapshotEvents };
  }
  const result: ResumeResult = { disposition, events };
  if (nextEpoch !== undefined) {
    result.nextEpoch = nextEpoch;
  }
  return result;
}

function extractSnapshotEvents(data: unknown, fallbackEpoch: number): StreamEvent[] {
  if (!isRecord(data) || !Array.isArray(data.events)) {
    return [];
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
