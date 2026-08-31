import { describe, expect, it } from "vitest";

import { createBrowserRealtimeDeps } from "@/api/realtime-transport";
import { SseAbortedError, SseParseError } from "@/api/sse-parser";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function recorder(
  route: (call: FetchCall) => Response | Promise<Response>,
): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const call = { url: String(input), init };
    calls.push(call);
    return route(call);
  }) as typeof fetch;
  return { fn, calls };
}

const GO_STREAM = [
  'event: chat.snapshot\ndata: {"event":"chat.snapshot","text":"已有"}\n\n',
  'event: chat.delta\ndata: {"event":"chat.delta","text":"回复"}\n\n',
  'event: chat.completed\ndata: {"event":"chat.completed"}\n\n',
];

describe("Go v1 opaque-cookie realtime stream", () => {
  it("opens one credentialed GET without ticket or secret query parameters", async () => {
    const { fn, calls } = recorder(() => sseResponse(GO_STREAM));
    const deps = createBrowserRealtimeDeps(fn);

    await deps.resume({ generationId: "101", afterSeq: 7, streamEpoch: 1 });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/v1/realtime/streams/101");
    expect(calls[0].url).not.toMatch(/[?&](ticketId|secret|sessionId|origin)=/);
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.credentials).toBe("include");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers["Last-Event-ID"]).toBe("7");
  });

  it("maps Go events to a contiguous local sequence starting after the cursor", async () => {
    const { fn } = recorder(() => sseResponse(GO_STREAM));
    const result = await createBrowserRealtimeDeps(fn).resume({
      generationId: "101",
      afterSeq: 4,
      streamEpoch: 3,
    });

    expect(result.disposition).toBe("RESUMED");
    expect(result.events).toEqual([
      { eventSeq: 5, streamEpoch: 3, eventType: "chat.snapshot", payload: "已有" },
      { eventSeq: 6, streamEpoch: 3, eventType: "chat.delta", payload: "回复" },
      { eventSeq: 7, streamEpoch: 3, eventType: "chat.completed", payload: null },
    ]);
  });

  it("delivers frames through the live sink and does not return them twice", async () => {
    const delivered: string[] = [];
    const { fn } = recorder(() => sseResponse(GO_STREAM));
    const result = await createBrowserRealtimeDeps(fn).resume(
      { generationId: "101", afterSeq: 0, streamEpoch: 1 },
      undefined,
      (event) => delivered.push(event.eventType),
    );

    expect(delivered).toEqual([
      "chat.snapshot",
      "chat.delta",
      "chat.completed",
    ]);
    expect(result.events).toEqual([]);
  });

  it.each([401, 403, 404])(
    "maps hidden status %s without disclosing existence",
    async (status) => {
      const { fn } = recorder(() => jsonResponse(status, {}));
      await expect(
        createBrowserRealtimeDeps(fn).resume({
          generationId: "101",
          afterSeq: 0,
          streamEpoch: 1,
        }),
      ).resolves.toEqual({ disposition: "NOT_FOUND_OR_FORBIDDEN", events: [] });
    },
  );

  it("throws on a non-hidden transport failure", async () => {
    const { fn } = recorder(() => jsonResponse(500, {}));
    await expect(
      createBrowserRealtimeDeps(fn).resume({
        generationId: "101",
        afterSeq: 0,
        streamEpoch: 1,
      }),
    ).rejects.toThrow(/resume failed with status 500/);
  });

  it("rejects malformed SSE instead of treating it as an empty success", async () => {
    const { fn } = recorder(() => sseResponse(["event: chat.delta\ndata: nope\n\n"]));
    await expect(
      createBrowserRealtimeDeps(fn).resume({
        generationId: "101",
        afterSeq: 0,
        streamEpoch: 1,
      }),
    ).rejects.toBeInstanceOf(SseParseError);
  });

  it("propagates cancellation to a pending stream read", async () => {
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    const { fn } = recorder(() =>
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const controller = new AbortController();
    const pending = createBrowserRealtimeDeps(fn).resume(
      { generationId: "101", afterSeq: 0, streamEpoch: 1 },
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(SseAbortedError);
  });
});

describe("generation snapshot", () => {
  it("preserves the stable fault key on a durable failed terminal", async () => {
    const { fn } = recorder(() =>
      jsonResponse(200, {
        events: [{ event: "chat.failed", fault: "external-timed_out" }],
      }),
    );

    const result = await createBrowserRealtimeDeps(fn).fetchSnapshot("101");

    expect(result.events).toEqual([{
      eventSeq: 1,
      streamEpoch: 1,
      eventType: "chat.failed",
      payload: { fault: "external-timed_out" },
    }]);
  });

  it("parses explicit events and settled usage", async () => {
    const { fn, calls } = recorder(() =>
      jsonResponse(200, {
        streamEpoch: 2,
        events: [
          {
            event: "chat.completed",
            eventSeq: 3,
            streamEpoch: 2,
            payload: "",
          },
        ],
        usage: { inputTokens: 42, outputTokens: 58 },
      }),
    );
    const result = await createBrowserRealtimeDeps(fn).fetchSnapshot("101");

    expect(calls[0].url).toBe("/api/v1/generations/101/snapshot");
    expect(calls[0].init?.credentials).toBe("include");
    expect(result.ok).toBe(true);
    expect(result.events.map((event) => event.eventSeq)).toEqual([3]);
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 58 });
  });

  it("accepts the Go v1 empty event list without fabricating a terminal", async () => {
    const { fn } = recorder(() =>
      jsonResponse(200, { status: "RUNNING", events: [] }),
    );
    await expect(
      createBrowserRealtimeDeps(fn).fetchSnapshot("101"),
    ).resolves.toMatchObject({ ok: true, events: [] });
  });

  it("rejects malformed usage while keeping the valid snapshot", async () => {
    const { fn } = recorder(() =>
      jsonResponse(200, {
        events: [],
        usage: { inputTokens: -1, outputTokens: "many" },
      }),
    );
    const result = await createBrowserRealtimeDeps(fn).fetchSnapshot("101");
    expect(result.ok).toBe(true);
    expect(result.usage).toBeUndefined();
  });

  it("returns a typed failure for non-OK or malformed responses", async () => {
    const failed = recorder(() => jsonResponse(404, {}));
    await expect(
      createBrowserRealtimeDeps(failed.fn).fetchSnapshot("101"),
    ).resolves.toEqual({ ok: false, status: 404, events: [] });

    const malformed = recorder(() => jsonResponse(200, { status: "RUNNING" }));
    await expect(
      createBrowserRealtimeDeps(malformed.fn).fetchSnapshot("101"),
    ).resolves.toEqual({ ok: false, status: 200, events: [] });
  });
});
