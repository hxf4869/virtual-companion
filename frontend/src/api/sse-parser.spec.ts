import { describe, expect, it } from "vitest";

import {
  consumeSseFrames,
  readSseFrames,
  SseAbortedError,
  SseParseError,
  type SseFrame,
} from "@/api/sse-parser";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function streamThatNeverEnds(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"eventSeq":1}\n\n'));
      // never close
    },
  });
}

describe("readSseFrames (P2-15)", () => {
  it("parses LF-delimited frames with a disposition and events", async () => {
    const body = streamOf([
      'data: {"disposition":"RESUMED","events":[{"eventSeq":1}]}\n\n',
      'data: {"eventSeq":2}\n\n',
    ]);

    const frames = await readSseFrames(body);

    expect(frames).toHaveLength(2);
    expect(frames[0].disposition).toBe("RESUMED");
    expect(frames[1].data).toEqual({ eventSeq: 2 });
  });

  it("parses CRLF-delimited frames (was silently lost before)", async () => {
    const body = streamOf([
      'data: {"eventSeq":1}\r\n\r\n',
      'data: {"eventSeq":2}\r\n\r\n',
    ]);

    const frames = await readSseFrames(body);

    expect(frames.map((f) => (f.data as { eventSeq: number }).eventSeq)).toEqual([1, 2]);
  });

  it("joins multi-line data: payloads into one JSON document", async () => {
    const body = streamOf([
      'data: {"events":[\n',
      'data: {"eventSeq":1},\n',
      'data: {"eventSeq":2}]}\n\n',
    ]);

    const frames = await readSseFrames(body);

    expect(frames).toHaveLength(1);
    expect((frames[0].data as { events: unknown[] }).events).toHaveLength(2);
  });

  it("flushes a final unclosed frame at stream end (tail flush)", async () => {
    const body = streamOf(['data: {"eventSeq":9}']);

    const frames = await readSseFrames(body);

    expect(frames).toHaveLength(1);
    expect((frames[0].data as { eventSeq: number }).eventSeq).toBe(9);
  });

  it("handles data split across byte chunks", async () => {
    const body = streamOf(['data: {"event', 'Seq":3}\n\n']);

    const frames = await readSseFrames(body);

    expect(frames).toHaveLength(1);
    expect((frames[0].data as { eventSeq: number }).eventSeq).toBe(3);
  });

  it("skips comment/keepalive frames without a data: line (no event, no error)", async () => {
    const body = streamOf([
      ": ping\n\n",
      'data: {"eventSeq":1}\n\n',
    ]);

    const frames = await readSseFrames(body);

    expect(frames).toHaveLength(1);
    expect((frames[0].data as { eventSeq: number }).eventSeq).toBe(1);
  });

  it("throws a typed SseParseError for non-JSON data", async () => {
    const body = streamOf(["data: not-json\n\n"]);

    await expect(readSseFrames(body)).rejects.toBeInstanceOf(SseParseError);
  });

  it("throws a typed SseParseError for a non-object payload", async () => {
    const body = streamOf(["data: 42\n\n"]);

    await expect(readSseFrames(body)).rejects.toBeInstanceOf(SseParseError);
  });

  it("surfaces the SSE event: name alongside the data (TASK-0185)", async () => {
    const body = streamOf([
      "event: chat.delta\n",
      'data: {"event":"chat.delta","eventSeq":1}\n\n',
    ]);

    const frames = await readSseFrames(body);

    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("chat.delta");
    expect(frames[0].data).toEqual({ event: "chat.delta", eventSeq: 1 });
  });

  it("keeps a control event frame that has event: but no data: line (TASK-0185)", async () => {
    const body = streamOf([
      "event: stream.gap\n\n",
      "event: stream.reset\n\n",
      "event: stream.denied\n\n",
    ]);

    const frames = await readSseFrames(body);

    expect(frames.map((f) => f.event)).toEqual(["stream.gap", "stream.reset", "stream.denied"]);
    expect(frames.every((f) => f.data === null)).toBe(true);
  });

  it("keeps a snapshot control frame with its data payload (TASK-0185)", async () => {
    const body = streamOf(["event: snapshot\n", 'data: {"streamEpoch":1,"events":[]}\n\n']);

    const frames = await readSseFrames(body);

    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("snapshot");
    expect((frames[0].data as { streamEpoch: number }).streamEpoch).toBe(1);
  });

  it("returns [] for a null body (empty-but-valid)", async () => {
    expect(await readSseFrames(null)).toEqual([]);
  });

  it("throws SseAbortedError when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(readSseFrames(streamThatNeverEnds(), controller.signal)).rejects.toBeInstanceOf(
      SseAbortedError,
    );
  });
});
// ---- round7（P2）：consumeSseFrames 的资源释放契约 ----

describe("consumeSseFrames resource release (round7 P2)", () => {
  it("releases the reader lock on normal EOF", async () => {
    const body = streamOf(['data: {"eventSeq":1}\n\n']);
    await consumeSseFrames(body);
    expect(body.locked).toBe(false);
  });

  it("releases the lock and stops when the onFrame callback throws mid-stream", async () => {
    const body = streamOf([
      'data: {"eventSeq":1}\n\n',
      'data: {"eventSeq":2}\n\n',
      'data: {"eventSeq":3}\n\n',
    ]);
    const seen: number[] = [];
    await expect(
      consumeSseFrames(body, undefined, (frame) => {
        seen.push((frame.data as { eventSeq: number }).eventSeq);
        if ((frame.data as { eventSeq: number }).eventSeq === 2) {
          throw new Error("callback blew up");
        }
      }),
    ).rejects.toThrow(/callback blew up/);
    expect(seen).toEqual([1, 2]);
    expect(body.locked).toBe(false);
  });

  it("releases the lock when a frame fails to parse", async () => {
    const body = streamOf(["data: not-json-at-all\n\n"]);
    await expect(consumeSseFrames(body)).rejects.toBeInstanceOf(SseParseError);
    expect(body.locked).toBe(false);
  });

  it("cancels the underlying read and releases the lock when aborted while waiting", async () => {
    const held = new ReadableStream<Uint8Array>({
      start() {
        // never enqueues, never closes
      },
    });
    const ac = new AbortController();
    const pending = consumeSseFrames(held, ac.signal);
    await Promise.resolve();
    ac.abort();
    await expect(pending).rejects.toBeInstanceOf(SseAbortedError);
    expect(held.locked).toBe(false);
  });
});
