// TASK-0104 (P2-15): Fetch-SSE frame parser extracted from the chat page so the
// transport glue is unit-testable in the node vitest environment.
//
// Contract (specs/contracts/realtime-contract.yaml + the resume endpoint):
//   - Frames are separated by a blank line; both LF ("\n\n") and CRLF
//     ("\r\n\r\n") boundaries are supported (P2-15: CRLF frames were silently
//     lost before, surfacing as an empty stream).
//   - Each frame carries one or more "data:" lines joined by "\n" and parsed as
//     JSON; an optional "event:" line is surfaced as SseFrame.event and an
//     optional top-level "disposition" field as SseFrame.disposition.
//   - A final unclosed frame at stream end is flushed (SSE EOF dispatch).
//   - TASK-0185: a control event frame with an "event:" line but no data: line
//     (stream.gap / stream.reset / stream.denied, as the 0184 controller emits)
//     is surfaced as { event, data: null }; only a frame with neither an event
//     nor a data line (comment/keepalive, e.g. ": ping") is skipped. A frame
//     whose data is non-JSON or a non-object payload throws SseParseError -- a
//     typed failure, never a silent empty stream.
//   - An aborted signal throws SseAbortedError so the caller can distinguish
//     cancellation from a transport failure.

export interface SseFrame {
  /**
   * Optional SSE event name (the `event:` field). TASK-0185: the 0184
   * RealtimeStreamController encodes the resume disposition as the SSE event
   * name — durable events carry their type (chat.delta, ...), the terminal
   * snapshot carries "snapshot", and the control events stream.gap /
   * stream.reset / stream.denied carry no data: line at all.
   */
  event?: string;
  /** Optional top-level disposition field of the parsed payload (legacy shape). */
  disposition?: string;
  /** The parsed JSON payload, or null for a control event with no data: line. */
  data: unknown;
}

/** A malformed SSE frame: non-JSON data or a non-object payload. Frames without a data: line are valid comment/keepalive frames and are skipped. */
export class SseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SseParseError";
  }
}

/** The stream was aborted (signal fired) before it finished. */
export class SseAbortedError extends Error {
  constructor() {
    super("SSE stream aborted");
    this.name = "SseAbortedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flushFrame(raw: string, frames: SseFrame[]): void {
  const lines = raw.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^\s+/, ""));
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const eventName = eventLine ? eventLine.slice(6).replace(/^\s+/, "") : undefined;

  if (dataLines.length === 0) {
    // TASK-0185: a control event frame (event: stream.gap / stream.reset /
    // stream.denied, as emitted by the 0184 RealtimeStreamController) carries an
    // SSE event name but no data: line. It is a real event and must be surfaced
    // so the transport can map it to a resume disposition. Only a frame with
    // neither an event nor a data line (a comment/keepalive, e.g. ": ping")
    // carries no event and is skipped (R1 P3).
    if (eventName) {
      frames.push({ event: eventName, data: null });
    }
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    throw new SseParseError("SSE frame data is not valid JSON");
  }
  if (!isRecord(payload)) {
    throw new SseParseError("SSE frame data is not a JSON object");
  }
  const frame: SseFrame = { data: payload };
  if (eventName) {
    frame.event = eventName;
  }
  if (typeof payload.disposition === "string") {
    frame.disposition = payload.disposition;
  }
  frames.push(frame);
}

/**
 * Read an SSE byte stream into frames. Supports LF and CRLF boundaries,
 * multi-line data payloads, tail-frame flush at EOF, typed malformed errors
 * and abort signalling. Returns [] for a null body only when the caller
 * treats it as an empty-but-valid stream; a body that is not a readable
 * stream is a typed parse error.
 */
export async function readSseFrames(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
): Promise<SseFrame[]> {
  if (body === null) {
    return [];
  }
  if (typeof body.getReader !== "function") {
    throw new SseParseError("SSE response body is not a readable stream");
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: SseFrame[] = [];

  for (;;) {
    if (signal?.aborted) {
      throw new SseAbortedError();
    }
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    // Both "\n\n" and "\r\n\r\n" boundaries; consume the exact separator.
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/);
      buffer = buffer.slice(boundary + (separator ? separator[0].length : 2));
      flushFrame(raw, frames);
      boundary = buffer.search(/\r?\n\r?\n/);
    }
  }
  // Tail flush: an unclosed final frame is a real event (SSE EOF dispatch).
  if (buffer.trim() !== "") {
    flushFrame(buffer, frames);
  }
  return frames;
}
