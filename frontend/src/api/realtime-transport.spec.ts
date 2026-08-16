// TASK-0185: realtime-transport contract glue tests. The fetch is stubbed per
// call so the wire shape of POST /tickets + GET /streams/{id} +
// GET /generations/{id}/snapshot and the five-disposition SSE mapping are
// verified without any network. The orchestrator (streamGeneration) is already
// covered in api/realtime.spec.ts; this spec pins the transport layer that was
// previously an untested inline function in chat.vue.
import { describe, expect, it } from "vitest";

import { createBrowserRealtimeDeps } from "@/api/realtime-transport";
import { SseAbortedError } from "@/api/sse-parser";

const CONTEXT = { sessionId: "sess-1", origin: "http://localhost:5173" };

interface FetchCall {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function recorder(route: (call: FetchCall) => Response | Promise<Response>): {
  fn: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const call: FetchCall = {
      url,
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
      headers: init?.headers as Record<string, string> | undefined,
      signal: init?.signal as AbortSignal | undefined,
    };
    calls.push(call);
    return route(call);
  }) as typeof fetch;
  return { fn, calls };
}

/** Route: POST /tickets -> mint response; GET /streams/ -> SSE chunks. */
function mintThenStream(
  mintStatus: number,
  mintBody: unknown,
  streamChunks: string[],
): ReturnType<typeof recorder> {
  return recorder((c) => {
    if (c.method === "POST" && c.url.includes("/tickets")) {
      return jsonResponse(mintStatus, mintBody);
    }
    if (c.method === "GET" && c.url.includes("/streams/")) {
      return sseResponse(streamChunks);
    }
    return jsonResponse(404, {});
  });
}

const RESUMED_CHUNKS = [
  "event: chat.delta\n",
  'id: 1\ndata: {"event":"chat.delta","eventSeq":1,"streamEpoch":1,"payload":"d1"}\n\n',
  "event: chat.completed\n",
  'id: 2\ndata: {"event":"chat.completed","eventSeq":2,"streamEpoch":1,"payload":"done"}\n\n',
];

describe("resume: ticket mint wire", () => {
  it("POSTs the bindable client fields and omits owner/transport", async () => {
    const { fn, calls } = mintThenStream(200, { ticketId: "t1", secret: "s1" }, RESUMED_CHUNKS);
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    await deps.resume({ generationId: "101", afterSeq: 2, streamEpoch: 1 });

    const mint = calls.find((c) => c.method === "POST")!;
    expect(mint.url).toBe("/api/v1/realtime/tickets");
    expect(mint.headers?.["Content-Type"]).toBe("application/json");
    const body = JSON.parse(mint.body!);
    expect(body).toEqual({
      generationId: "101",
      sessionId: "sess-1",
      origin: CONTEXT.origin,
      streamEpoch: "1",
      afterSeq: "2",
    });
    expect(body.ownerUserId).toBeUndefined();
    expect(body.transport).toBeUndefined();
  });

  it("mints a fresh ticket each resume (single-use, one per attempt)", async () => {
    const { fn, calls } = mintThenStream(200, { ticketId: "t1", secret: "s1" }, RESUMED_CHUNKS);
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    await deps.resume({ generationId: "101", afterSeq: 0, streamEpoch: 1 });
    await deps.resume({ generationId: "101", afterSeq: 2, streamEpoch: 1 });

    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });
});

describe("resume: stream request wire", () => {
  it("opens GET streams/{generationId} with ticket query and Last-Event-ID header", async () => {
    const { fn, calls } = mintThenStream(200, { ticketId: "t1", secret: "s1" }, RESUMED_CHUNKS);
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    await deps.resume({ generationId: "101", afterSeq: 2, streamEpoch: 1 });

    const stream = calls.find((c) => c.method === "GET" && c.url.includes("/streams/"))!;
    expect(stream.url.startsWith("/api/v1/realtime/streams/101?")).toBe(true);
    const params = new URL(stream.url, "http://localhost").searchParams;
    expect(params.get("ticketId")).toBe("t1");
    expect(params.get("secret")).toBe("s1");
    expect(params.get("sessionId")).toBe("sess-1");
    expect(params.get("origin")).toBe(CONTEXT.origin);
    expect(params.get("streamEpoch")).toBe("1");
    expect(stream.headers?.["Last-Event-ID"]).toBe("2");
    expect(stream.headers?.Accept).toBe("text/event-stream");
  });
});

describe("resume: SSE disposition mapping", () => {
  it("maps RESUMED durable events to parsed StreamEvents", async () => {
    const { fn } = mintThenStream(200, { ticketId: "t1", secret: "s1" }, RESUMED_CHUNKS);
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    const result = await deps.resume({ generationId: "101", afterSeq: 0, streamEpoch: 1 });

    expect(result.disposition).toBe("RESUMED");
    expect(result.events.map((e) => e.eventSeq)).toEqual([1, 2]);
    expect(result.events.map((e) => e.eventType)).toEqual(["chat.delta", "chat.completed"]);
  });

  it("maps a snapshot event to TERMINAL_SNAPSHOT with the snapshot events", async () => {
    const chunks = [
      "event: snapshot\n",
      'data: {"streamEpoch":1,"events":[{"event":"chat.completed","eventSeq":3,"streamEpoch":1,"payload":"done"}]}\n\n',
    ];
    const { fn } = mintThenStream(200, { ticketId: "t1", secret: "s1" }, chunks);
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    const result = await deps.resume({ generationId: "101", afterSeq: 0, streamEpoch: 1 });

    expect(result.disposition).toBe("TERMINAL_SNAPSHOT");
    expect(result.events.map((e) => e.eventSeq)).toEqual([3]);
    expect(result.events[0].eventType).toBe("chat.completed");
  });

  it("maps stream.gap to GAP_EXPIRED", async () => {
    const { fn } = mintThenStream(200, { ticketId: "t1", secret: "s1" }, ["event: stream.gap\n\n"]);
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    const result = await deps.resume({ generationId: "101", afterSeq: 0, streamEpoch: 1 });

    expect(result.disposition).toBe("GAP_EXPIRED");
    expect(result.events).toEqual([]);
  });

  it("maps stream.reset to RESET_REQUIRED", async () => {
    const { fn } = mintThenStream(200, { ticketId: "t1", secret: "s1" }, ["event: stream.reset\n\n"]);
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    const result = await deps.resume({ generationId: "101", afterSeq: 0, streamEpoch: 1 });

    expect(result.disposition).toBe("RESET_REQUIRED");
  });

  it("maps stream.denied to NOT_FOUND_OR_FORBIDDEN", async () => {
    const { fn } = mintThenStream(200, { ticketId: "t1", secret: "s1" }, ["event: stream.denied\n\n"]);
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    const result = await deps.resume({ generationId: "101", afterSeq: 0, streamEpoch: 1 });

    expect(result.disposition).toBe("NOT_FOUND_OR_FORBIDDEN");
  });
});

describe("resume: existence hidden and failures", () => {
  it("returns NOT_FOUND_OR_FORBIDDEN when mint yields 404 (no stream call)", async () => {
    const { fn, calls } = mintThenStream(404, {}, RESUMED_CHUNKS);
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    const result = await deps.resume({ generationId: "101", afterSeq: 0, streamEpoch: 1 });

    expect(result.disposition).toBe("NOT_FOUND_OR_FORBIDDEN");
    expect(calls.some((c) => c.url.includes("/streams/"))).toBe(false);
  });

  it("returns NOT_FOUND_OR_FORBIDDEN when the stream yields 403", async () => {
    const { fn } = recorder((c) => {
      if (c.method === "POST") return jsonResponse(200, { ticketId: "t1", secret: "s1" });
      return jsonResponse(403, {});
    });
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    const result = await deps.resume({ generationId: "101", afterSeq: 0, streamEpoch: 1 });

    expect(result.disposition).toBe("NOT_FOUND_OR_FORBIDDEN");
  });

  it("throws on a 5xx mint failure", async () => {
    const { fn } = mintThenStream(500, {}, []);
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    await expect(
      deps.resume({ generationId: "101", afterSeq: 0, streamEpoch: 1 }),
    ).rejects.toThrow(/ticket mint failed with status 500/);
  });

  it("throws on a 5xx stream failure (typed exhausted, never an empty stream)", async () => {
    const { fn } = recorder((c) => {
      if (c.method === "POST") return jsonResponse(200, { ticketId: "t1", secret: "s1" });
      return jsonResponse(500, {});
    });
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    await expect(
      deps.resume({ generationId: "101", afterSeq: 0, streamEpoch: 1 }),
    ).rejects.toThrow(/resume failed with status 500/);
  });

  it("throws on a malformed ticket payload", async () => {
    const { fn } = mintThenStream(200, { ticketId: "t1" }, RESUMED_CHUNKS);
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    await expect(
      deps.resume({ generationId: "101", afterSeq: 0, streamEpoch: 1 }),
    ).rejects.toThrow(/invalid ticket payload/);
  });

  it("propagates an abort from the mint fetch", async () => {
    const fn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.signal as AbortSignal)?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      return jsonResponse(200, { ticketId: "t1", secret: "s1" });
    }) as typeof fetch;
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);
    const controller = new AbortController();
    controller.abort();

    await expect(
      deps.resume({ generationId: "101", afterSeq: 0, streamEpoch: 1 }, controller.signal),
    ).rejects.toThrow();
  });
});

describe("fetchSnapshot", () => {
  it("parses a committed terminal snapshot", async () => {
    const { fn, calls } = recorder(() =>
      jsonResponse(200, {
        streamEpoch: 1,
        events: [
          { event: "chat.completed", eventSeq: 5, streamEpoch: 1, payload: "done" },
        ],
      }),
    );
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    const result = await deps.fetchSnapshot("101");

    expect(calls[0].url).toBe("/api/v1/generations/101/snapshot");
    expect(result.ok).toBe(true);
    expect(result.events.map((e) => e.eventSeq)).toEqual([5]);
  });

  it("parses the settled usage when the snapshot carries it (USAGE-VIZ)", async () => {
    const { fn } = recorder(() =>
      jsonResponse(200, {
        events: [{ event: "chat.completed", eventSeq: 1, streamEpoch: 1, payload: "done" }],
        usage: { inputTokens: 42, outputTokens: 58 },
      }),
    );
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    const result = await deps.fetchSnapshot("101");

    expect(result.ok).toBe(true);
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 58 });
  });

  it("leaves usage absent for a snapshot without settled usage", async () => {
    const { fn } = recorder(() =>
      jsonResponse(200, {
        events: [{ event: "chat.accepted", eventSeq: 1, streamEpoch: 1, payload: "done" }],
      }),
    );
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    const result = await deps.fetchSnapshot("101");

    expect(result.ok).toBe(true);
    expect(result.usage).toBeUndefined();
  });

  it("rejects a malformed usage object (USAGE-VIZ strict parse)", async () => {
    const { fn } = recorder(() =>
      jsonResponse(200, {
        events: [{ event: "chat.completed", eventSeq: 1, streamEpoch: 1, payload: "done" }],
        usage: { inputTokens: -1, outputTokens: "many" },
      }),
    );
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    const result = await deps.fetchSnapshot("101");

    expect(result.ok).toBe(true);
    expect(result.usage).toBeUndefined();
  });

  it("returns a typed failure on a non-OK status (no fake terminal)", async () => {
    const { fn } = recorder(() => jsonResponse(404, {}));
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    const result = await deps.fetchSnapshot("101");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.events).toEqual([]);
  });

  it("returns a typed failure on a malformed snapshot body", async () => {
    const { fn } = recorder(() => jsonResponse(200, { streamEpoch: 1 }));
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);

    const result = await deps.fetchSnapshot("101");

    expect(result.ok).toBe(false);
  });

  it("propagates an abort signal to the snapshot fetch", async () => {
    const fn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.signal as AbortSignal)?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      return jsonResponse(200, { events: [] });
    }) as typeof fetch;
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);
    const controller = new AbortController();
    controller.abort();

    await expect(deps.fetchSnapshot("101", controller.signal)).rejects.toThrow();
  });
});

describe("readSseFrames abort surfaces as SseAbortedError", () => {
  it("propagates SseAbortedError when the stream read is aborted", async () => {
    const neverClosing = new ReadableStream<Uint8Array>({
      start() {
        // never close; the aborted signal stops the read
      },
    });
    const { fn } = recorder((c) => {
      if (c.method === "POST") return jsonResponse(200, { ticketId: "t1", secret: "s1" });
      return new Response(neverClosing, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    const deps = createBrowserRealtimeDeps(CONTEXT, fn);
    const controller = new AbortController();
    const pending = deps.resume({ generationId: "101", afterSeq: 0, streamEpoch: 1 }, controller.signal);
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(SseAbortedError);
  });
});
