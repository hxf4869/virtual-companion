// TASK-0104 (P2-15): Fetch-SSE frame parser extracted from the chat page so the
// transport glue is unit-testable in the node vitest environment.
//
// Contract (specs/contracts/realtime-contract.yaml + the resume endpoint):
//   - Frames are separated by a blank line; both LF ("\n\n") and CRLF
//     ("\r\n\r\n") boundaries are supported (P2-15: CRLF frames were silently
//     lost before, surfacing as an empty stream).
//   - Each frame carries one or more "data:" lines joined by "\n" and parsed as
//     JSON; an optional top-level "disposition" field is surfaced.
//   - A final unclosed frame at stream end is flushed (SSE EOF dispatch).
//   - A frame without a data: line (comment/keepalive, e.g. ": ping") carries
//     no event and is skipped; a frame whose data is non-JSON or a non-object
//     payload throws SseParseError -- a typed failure, never a silent empty
//     stream.
//   - An aborted signal throws SseAbortedError so the caller can distinguish
//     cancellation from a transport failure.

export interface SseFrame {
  /** Optional top-level disposition field of the parsed payload. */
  disposition?: string;
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
  const dataLines = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^\s+/, ""));
  if (dataLines.length === 0) {
    // Comment/keepalive frames (": ping") carry no event; they are valid SSE
    // and must not fail the stream (R1 P3).
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
