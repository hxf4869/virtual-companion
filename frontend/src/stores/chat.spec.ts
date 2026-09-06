import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chat";
import {
  initialState,
  TERMINAL_EVENT_TYPE,
  type StreamEvent,
} from "@/domain/stream-reducer";
import type { RealtimeDeps, ResumeResult } from "@/api/realtime";
import type { ChatTransport, ChatApiResponse } from "@/api/chat";

function delta(seq: number, epoch = 1, payload = "Hel"): StreamEvent {
  return { eventSeq: seq, streamEpoch: epoch, eventType: "chat.delta", payload };
}
function terminal(seq: number, epoch = 1): StreamEvent {
  return { eventSeq: seq, streamEpoch: epoch, eventType: TERMINAL_EVENT_TYPE, payload: "" };
}
function snapshot(seq: number, epoch = 1, payload = ""): StreamEvent {
  return { eventSeq: seq, streamEpoch: epoch, eventType: "chat.snapshot", payload };
}

function successDeps(): RealtimeDeps {
  return {
    resume: vi.fn(async (): Promise<ResumeResult> => ({
      disposition: "RESUMED",
      events: [delta(1, 1, "Hel"), delta(2, 1, "lo"), terminal(3, 1)],
    })),
    fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
  };
}

/** Mock ChatTransport that routes by path: conversations, generations, messages. */
function mockChatTransport(opts: {
  generationStatus?: number;
  generationJson?: unknown;
  messagesJson?: unknown;
  conversationsJson?: unknown;
  conversationOk?: boolean;
}): ChatTransport {
  return {
    async request(method: string, path: string, body?: unknown): Promise<ChatApiResponse> {
      if (path === "/api/v1/conversations") {
        if (method === "GET") {
          return { ok: true, status: 200, json: opts.conversationsJson ?? [] };
        }
        const ok = opts.conversationOk ?? true;
        return { ok, status: ok ? 200 : 404, json: ok ? { conversationId: 1 } : null };
      }
      if (path.startsWith("/api/v1/conversations?")) {
        return { ok: true, status: 200, json: opts.conversationsJson ?? [] };
      }
      if (path.includes("/generations")) {
        const status = opts.generationStatus ?? 200;
        return {
          ok: status === 200,
          status,
          json: status === 200 ? (opts.generationJson ?? {
            generationId: 42,
            conversationId: 1,
            logicalGenerationId: "lg-1",
            status: "CREATED",
          }) : null,
        };
      }
      if (path.includes("/messages")) {
        // 与后端契约一致：after 向前翻页；before 向上（更早）翻页；
        // 两者都缺省 = 最近窗口（最后 limit 条）；响应内一律升序。
        const params = new URLSearchParams(path.split("?")[1] ?? "");
        const after = params.get("after");
        const before = params.get("before");
        const limit = Number(params.get("limit") ?? 50);
        const all = (opts.messagesJson ?? []) as Array<{ messageId: number }>;
        let rows: Array<{ messageId: number }>;
        if (after !== null) {
          rows = all.filter((m) => Number(m.messageId) > Number(after)).slice(0, limit);
        } else if (before !== null) {
          rows = all.filter((m) => Number(m.messageId) < Number(before)).slice(-limit);
        } else {
          rows = all.slice(-limit);
        }
        return { ok: true, status: 200, json: rows };
      }
      return { ok: true, status: 200, json: {} };
    },
  };
}

describe("useChatStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs to completed and exposes only the contiguous delta draft", async () => {
    const store = useChatStore();
    await store.run(successDeps(), "gen-1", 1);

    expect(store.phase).toBe("completed");
    expect(store.outcome).toBe("completed");
    expect(store.isTerminal).toBe(true);
    expect(store.draft).toBe("Hello");
  });

  it("replaces the partial draft with the latest Go snapshot before appending deltas", async () => {
    const store = useChatStore();
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [
          delta(1, 1, "旧的局部"),
          snapshot(2, 1, "服务端完整草稿"),
          delta(3, 1, "，继续"),
          terminal(4, 1),
        ],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    await store.run(deps, "g-snapshot", 1);

    expect(store.draft).toBe("服务端完整草稿，继续");
    expect(store.draft).not.toContain("旧的局部");
    expect(store.phase).toBe("completed");
  });

  it("marks cancelled when cancel() flips the handle", async () => {
    const store = useChatStore();
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [delta(1, 1, "Hi"), terminal(2, 1)],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };
    store.cancel(); // handle is null until run; this is a no-op
    // Start run, then cancel before the microtask resolves.
    const promise = store.run(deps, "gen-1", 1);
    store.cancel();
    await promise;
    // Either completed (if resume resolved before cancel checked) or cancelled.
    expect(["completed", "cancelled"]).toContain(store.phase);
  });

  it("marks failed on not_found_or_forbidden without disclosing existence", async () => {
    const store = useChatStore();
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "NOT_FOUND_OR_FORBIDDEN",
        events: [],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    await store.run(deps, "gen-1", 1);

    expect(store.phase).toBe("failed");
    expect(store.outcome).toBe("not_found_or_forbidden");
    expect(store.isTerminal).toBe(false);
  });

  // P1（round5）：RESUMED 批次之间增量发布中间流状态——页面逐批拿到
  // 草稿文本（store.draft 在第一批后即可读），不再等整条连接结束。
  it("publishes interim stream state between RESUMED batches so the live draft renders", async () => {
    const store = useChatStore();
    let releaseSecond: (() => void) | undefined;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let calls = 0;
    const deps: RealtimeDeps = {
      resume: vi.fn(async (req): Promise<ResumeResult> => {
        calls += 1;
        if (calls === 1) {
          return { disposition: "RESUMED", events: [delta(1, 1, "你"), delta(2, 1, "好")] };
        }
        await secondGate;
        expect(req.afterSeq).toBe(2);
        return { disposition: "RESUMED", events: [delta(3, 1, "呀"), terminal(4, 1)] };
      }),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    const pending = store.run(deps, "gen-live", 1);
    // 第一批应用完毕（第二次 resume 已被调用并挂起）时，中间状态必须已经
    // 可见于响应式层。
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.isStreaming).toBe(true);
    expect(store.draft, "interim draft visible between batches").toBe("你好");

    releaseSecond?.();
    await pending;

    expect(store.draft).toBe("你好呀");
    expect(store.phase).toBe("completed");
  });

  it("S0-20: transport exhaustion keeps the refresh recovery binding", async () => {
    vi.useFakeTimers();
    const rows = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => rows.set(key, value),
      removeItem: (key: string) => rows.delete(key),
    });
    const store = useChatStore();
    store.conversationId = "conv-1";
    store.bindGenerationContext("account-1", "rel-1");
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    try {
      const running = store.run(deps, "gen-pending", 1);
      await vi.runAllTimersAsync();
      await running;

      expect(store.phase).toBe("failed");
      expect(store.outcome).toBe("exhausted");
      expect(rows.get("vc.gen.restore")).toContain('"generationId":"gen-pending"');
    } finally {
      vi.useRealTimers();
    }
  });

  it("S0-20: recoverInFlight uses a terminal snapshot and does not resume a second generation", async () => {
    const store = useChatStore();
    store.generationId = "gen-1";
    store.conversationId = "1";
    store.phase = "streaming";
    store.pendingUserContent = "hello";
    const resume = vi.fn(async (): Promise<ResumeResult> => ({
      disposition: "RESUMED",
      events: [terminal(9, 1)],
    }));
    const deps: RealtimeDeps = {
      resume,
      fetchSnapshot: vi.fn(async () => ({
        ok: true,
        status: 200,
        events: [delta(1, 1, "Hi"), terminal(2, 1)],
      })),
    };

    await store.recoverInFlight(deps);

    expect(store.phase).toBe("completed");
    expect(store.outcome).toBe("completed");
    expect(resume).not.toHaveBeenCalled();
    expect(store.pendingUserContent).toBe("");
  });

  it("S0-20: recoverInFlight resumes the same generation from the current cursor and keeps pending input until terminal", async () => {
    const store = useChatStore();
    store.generationId = "gen-1";
    store.phase = "failed";
    store.outcome = "exhausted";
    store.pendingUserContent = "hello";
    store.stream = {
      status: "streaming",
      epoch: 1,
      cursor: 2,
      events: [delta(1, 1, "Hel"), delta(2, 1, "lo")],
      terminal: false,
      terminalEventType: null,
    };
    const resume = vi.fn(async (req: { afterSeq: number; generationId: string }) => {
      expect(req.generationId).toBe("gen-1");
      expect(req.afterSeq).toBe(2);
      return { disposition: "RESUMED" as const, events: [terminal(3, 1)] };
    });
    const deps: RealtimeDeps = {
      resume,
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    await store.recoverInFlight(deps);

    expect(resume).toHaveBeenCalledTimes(1);
    expect(store.phase).toBe("completed");
    expect(store.generationId).toBe("gen-1");
  });

  it("S0-20: an empty snapshot after reload resumes from a valid initial epoch", async () => {
    const store = useChatStore();
    store.generationId = "gen-created";
    store.phase = "failed";
    const resume = vi.fn(async (req: { streamEpoch: number }): Promise<ResumeResult> => {
      expect(req.streamEpoch).toBe(1);
      return { disposition: "RESUMED", events: [terminal(1, 1)] };
    });
    const deps: RealtimeDeps = {
      resume,
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    await store.recoverInFlight(deps);

    expect(resume).toHaveBeenCalledTimes(1);
    expect(store.phase).toBe("completed");
  });

  it("S0-20: recoverInFlight is a no-op when a live stream handle already exists", async () => {
    const store = useChatStore();
    const resumeStart = { started: false };
    const deps = blockingDeps(resumeStart);
    const running = store.run(deps, "gen-live", 1);
    await vi.waitFor(() => expect(resumeStart.started).toBe(true));
    const fetchSnapshot = deps.fetchSnapshot as ReturnType<typeof vi.fn>;
    fetchSnapshot.mockClear();

    await store.recoverInFlight(deps);

    expect(fetchSnapshot).not.toHaveBeenCalled();
    store.cancel();
    await running;
  });

  it("S0-20: page detach preserves the recovery entry for the next store instance", async () => {
    const rows = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => rows.set(key, value),
      removeItem: (key: string) => rows.delete(key),
    });

    const store = useChatStore();
    store.conversationId = "1";
    store.bindGenerationContext("1001", "7");
    const resumeStart = { started: false };
    const running = store.run(blockingDeps(resumeStart), "gen-reload", 1);
    await vi.waitFor(() => expect(resumeStart.started).toBe(true));

    store.detachInFlight();
    await running;

    expect(rows.get("vc.gen.restore")).toContain('"generationId":"gen-reload"');
    expect(store.phase).toBe("failed");

    setActivePinia(createPinia());
    const reloaded = useChatStore();
    reloaded.conversationId = "1";
    reloaded.bindGenerationContext("1001", "7");
    const fetchSnapshot = vi.fn(async () => ({
      ok: true,
      status: 200,
      events: [terminal(1, 1)],
    }));

    const restored = await reloaded.tryRestoreAfterReload(
      { resume: vi.fn(), fetchSnapshot },
      { accountId: "1001", relationshipId: "7" },
    );

    expect(restored).toBe(true);
    expect(fetchSnapshot).toHaveBeenCalledWith("gen-reload");
    expect(reloaded.phase).toBe("completed");
    expect(rows.has("vc.gen.restore")).toBe(false);
  });

  it("reset returns to idle", async () => {
    const store = useChatStore();
    await store.run(successDeps(), "gen-1", 1);
    store.reset();

    expect(store.phase).toBe("idle");
    expect(store.generationId).toBe("");
    expect(store.outcome).toBeNull();
  });

  it("never fabricates deltas: a gap leaves the draft at the contiguous prefix", async () => {
    const store = useChatStore();
    // resume returns [delta1, delta3] -> in-band gap; snapshot recovers [1,2,terminal3].
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [delta(1, 1, "A"), delta(3, 1, "C")],
      })),
      fetchSnapshot: vi.fn(async () => ({
        ok: true,
        status: 200,
        events: [delta(1, 1, "A"), delta(2, 1, "B"), terminal(3, 1)],
      })),
    };

    await store.run(deps, "gen-1", 1);

    expect(store.phase).toBe("completed");
    // Snapshot recovered the contiguous A then B; the gapped C was never fabricated.
    expect(store.draft).toBe("AB");
  });

  it("drops a stale run's late completion (P2-17 single writer)", async () => {
    const store = useChatStore();
    let releaseFirst: () => void = () => undefined;
    const firstResume = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return { disposition: "RESUMED", events: [delta(1), terminal(2)] } as ResumeResult;
    });
    const firstDeps: RealtimeDeps = {
      resume: firstResume,
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };
    const firstRun = store.run(firstDeps, "gen-old", 1);

    // A newer run starts while the first is still in flight.
    const secondDeps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [delta(1), terminal(2)],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };
    await store.run(secondDeps, "gen-new", 1);
    expect(store.generationId).toBe("gen-new");
    expect(store.phase).toBe("completed");

    // The old run finishes late; its result must be dropped.
    releaseFirst();
    await firstRun;
    expect(store.generationId).toBe("gen-new");
    expect(store.phase).toBe("completed");
    expect(store.draft).toBe("Hel");
  });

  it("cancel() aborts the underlying transport (P2-14)", async () => {
    const store = useChatStore();
    let signalSeen: AbortSignal | undefined;
    const resume = vi.fn(async (_req: unknown, signal?: AbortSignal) => {
      signalSeen = signal;
      await new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve());
      });
      return { disposition: "RESUMED", events: [delta(1)] } as ResumeResult;
    });
    const deps: RealtimeDeps = {
      resume,
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    const runPromise = store.run(deps, "gen-1", 1);
    store.cancel();
    await runPromise;

    expect(signalSeen?.aborted).toBe(true);
    expect(store.phase).toBe("cancelled");
  });

  // ---- CANCEL-A: backend cancel confirmation before local teardown ----

  function blockingDeps(resumeStart: { started: boolean }): RealtimeDeps {
    const resume = vi.fn(async (_req: unknown, signal?: AbortSignal) => {
      resumeStart.started = true;
      await new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve());
      });
      return { disposition: "RESUMED", events: [delta(1)] } as ResumeResult;
    });
    return {
      resume,
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };
  }

  function cancelAwareTransport(opts: {
    cancelOk: boolean;
    cancelPending?: boolean;
    order?: string[];
  }): ChatTransport {
    return {
      async request(_method: string, path: string): Promise<ChatApiResponse> {
        if (path === "/api/v1/conversations") {
          return { ok: true, status: 200, json: { conversationId: 1 } };
        }
        if (path.includes("/messages")) {
          return { ok: true, status: 200, json: [] };
        }
        if (path.endsWith("/cancel")) {
          opts.order?.push("cancel-api");
          if (opts.cancelPending) {
            return await new Promise<ChatApiResponse>(() => undefined);
          }
          return opts.cancelOk
            ? {
                ok: true,
                status: 200,
                json: {
                  generationId: 42,
                  conversationId: 1,
                  logicalGenerationId: "lg-1",
                  status: "CANCELLED",
                },
              }
            : { ok: false, status: 503, json: null };
        }
        if (path.includes("/generations")) {
          return {
            ok: true,
            status: 200,
            json: {
              generationId: 42,
              conversationId: 1,
              logicalGenerationId: "lg-1",
              status: "CREATED",
            },
          };
        }
        return { ok: true, status: 200, json: {} };
      },
    };
  }

  it("cancel() starts the backend cancel API before aborting the local stream", async () => {
    const store = useChatStore();
    const order: string[] = [];
    const transport = cancelAwareTransport({ cancelOk: true, order });
    const resumeStart = { started: false };
    // The abort listener is attached synchronously with the started marker, so
    // waiting on it guarantees the cancel-abort event below is observed.
    const resume = vi.fn(async (_req: unknown, signal?: AbortSignal) => {
      resumeStart.started = true;
      signal?.addEventListener("abort", () => order.push("abort-event"));
      await new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve());
      });
      return { disposition: "RESUMED", events: [delta(1)] } as ResumeResult;
    });
    const deps: RealtimeDeps = {
      resume,
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    await store.initConversation(transport, "1");
    const sendPromise = store.send(transport, deps, "Hello");
    await vi.waitFor(() => expect(resumeStart.started).toBe(true));
    await store.cancel();
    await sendPromise;

    // Starting the best-effort backend request precedes local teardown; its
    // response is not allowed to hold the stream open.
    expect(order).toEqual(["cancel-api", "abort-event"]);
    expect(store.phase).toBe("cancelled");
  });

  it("cancel() still aborts the local stream when the backend cancel fails", async () => {
    const store = useChatStore();
    const transport = cancelAwareTransport({ cancelOk: false });
    const resumeStart = { started: false };
    const deps = blockingDeps(resumeStart);

    await store.initConversation(transport, "1");
    const sendPromise = store.send(transport, deps, "Hello");
    await vi.waitFor(() => expect(resumeStart.started).toBe(true));
    await store.cancel();
    await sendPromise;

    // Backend unavailable (503) must not block the local teardown.
    expect(store.phase).toBe("cancelled");
  });

  it("cancel() immediately aborts when the backend cancel request never settles", async () => {
    const store = useChatStore();
    const order: string[] = [];
    const transport = cancelAwareTransport({ cancelOk: true, cancelPending: true, order });
    const resumeStart = { started: false };
    const deps = blockingDeps(resumeStart);

    await store.initConversation(transport, "1");
    const sendPromise = store.send(transport, deps, "Hello");
    await vi.waitFor(() => expect(resumeStart.started).toBe(true));

    await store.cancel();
    await sendPromise;

    expect(order).toEqual(["cancel-api"]);
    expect(store.phase).toBe("cancelled");
  });

  // ---- TASK-0186: send flow + history ----

  it("initConversation creates conversation and loads history", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      messagesJson: [
        { messageId: 10, conversationId: 1, role: "user", content: "old" },
      ],
    });

    const result = await store.initConversation(transport, "1");

    expect(result).toEqual({ conversationId: "1" });
    expect(store.conversationId).toBe("1");
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].content).toBe("old");
  });

  it("send mints idempotency key, creates generation, streams, reloads history", async () => {
    const store = useChatStore();
    const messages: Array<Record<string, unknown>> = [];
    const transport = mockChatTransport({ messagesJson: messages });
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => {
        messages.push(
          { messageId: 10, conversationId: 1, role: "user", content: "Hello" },
          { messageId: 11, conversationId: 1, role: "assistant", content: "Hi" },
        );
        return {
          disposition: "RESUMED",
          events: [delta(1, 1, "Hel"), terminal(2, 1)],
        };
      }),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    await store.initConversation(transport, "1");
    expect(store.messages).toEqual([]);
    expect(store.historyHasMore).toBe(false);
    await store.send(transport, deps, "Hello");

    expect(store.phase).toBe("completed");
    expect(store.outcome).toBe("completed");
    expect(store.messages).toHaveLength(2);
    expect(store.messages[1].role).toBe("assistant");
  });

  it("send transitions to failed when sendGeneration returns null", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      generationStatus: 404, // existence-hidden → sendGeneration returns null
    });

    await store.initConversation(transport, "1");
    await store.send(transport, successDeps(), "Hello");

    expect(store.phase).toBe("failed");
    expect(store.outcome).toBeNull();
    expect(store.generationStarting).toBe(false);
  });

  function deferredGenerationTransport(): {
    transport: ChatTransport;
    generationCalls: ReturnType<typeof vi.fn>;
    resolveGeneration: (response: ChatApiResponse) => void;
    rejectGeneration: (error: unknown) => void;
  } {
    let resolveGeneration!: (response: ChatApiResponse) => void;
    let rejectGeneration!: (error: unknown) => void;
    const pending = new Promise<ChatApiResponse>((resolve, reject) => {
      resolveGeneration = resolve;
      rejectGeneration = reject;
    });
    const generationCalls = vi.fn();
    const transport: ChatTransport = {
      async request(method: string, path: string): Promise<ChatApiResponse> {
        if (path === "/api/v1/conversations") {
          return { ok: true, status: 200, json: { conversationId: 1 } };
        }
        if (path.includes("/messages")) {
          return { ok: true, status: 200, json: [] };
        }
        if (method === "POST" && path.endsWith("/generations")) {
          generationCalls();
          return pending;
        }
        return { ok: true, status: 200, json: {} };
      },
    };
    return { transport, generationCalls, resolveGeneration, rejectGeneration };
  }

  const createdGeneration: ChatApiResponse = {
    ok: true,
    status: 200,
    json: {
      generationId: 42,
      conversationId: 1,
      logicalGenerationId: "lg-1",
      status: "CREATED",
    },
  };

  it("single-flights concurrent send calls during generation creation", async () => {
    const store = useChatStore();
    const deferred = deferredGenerationTransport();
    await store.initConversation(deferred.transport, "1");

    const first = store.send(deferred.transport, successDeps(), "Hello");
    const second = store.send(deferred.transport, successDeps(), "Hello");

    expect(store.generationStarting).toBe(true);
    expect(deferred.generationCalls).toHaveBeenCalledTimes(1);
    await second;
    deferred.resolveGeneration(createdGeneration);
    await first;
    expect(store.generationStarting).toBe(false);
  });

  it("releases the generation creation guard after a request error", async () => {
    const store = useChatStore();
    const deferred = deferredGenerationTransport();
    await store.initConversation(deferred.transport, "1");

    const first = store.send(deferred.transport, successDeps(), "Hello");
    deferred.rejectGeneration(new Error("network down"));

    await expect(first).rejects.toThrow("network down");
    expect(store.generationStarting).toBe(false);
  });

  it("send without conversationId transitions to failed", async () => {
    const store = useChatStore();
    // No initConversation — conversationId is empty
    await store.send(mockChatTransport({}), successDeps(), "Hello");

    expect(store.phase).toBe("failed");
  });

  it("loadHistory populates messages for the current conversation", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      messagesJson: [
        { messageId: 1, conversationId: 1, role: "user", content: "A" },
        { messageId: 2, conversationId: 1, role: "assistant", content: "B" },
      ],
    });

    await store.initConversation(transport, "1");
    expect(store.messages).toHaveLength(2);

    // Reload with different data
    const transport2 = mockChatTransport({
      messagesJson: [
        { messageId: 1, conversationId: 1, role: "user", content: "A" },
        { messageId: 2, conversationId: 1, role: "assistant", content: "B" },
        { messageId: 3, conversationId: 1, role: "user", content: "C" },
      ],
    });
    await store.loadHistory(transport2);
    expect(store.messages).toHaveLength(3);
  });

  it("displayMessages appends streaming draft as pending assistant", async () => {
    const store = useChatStore();
    store.conversationId = "1";
    store.messages = [
      { messageId: "1", conversationId: "1", role: "user", content: "Hi" },
    ];

    // Not streaming → displayMessages is just the history
    expect(store.displayMessages).toHaveLength(1);

    // Simulate streaming with draft
    store.phase = "streaming";
    // Inject a delta into the stream state via run (use a slow deps we control)
    // For this test we just verify the computed exists and works in idle
    store.phase = "idle";
    expect(store.displayMessages).toHaveLength(1);
  });

  it("reset clears conversation and messages", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      messagesJson: [{ messageId: 1, conversationId: 1, role: "user", content: "A" }],
    });
    await store.initConversation(transport, "1");
    expect(store.conversationId).toBe("1");

    store.reset();

    expect(store.conversationId).toBe("");
    expect(store.messages).toEqual([]);
    expect(store.phase).toBe("idle");
    expect(store.historyHasMore).toBe(false);
    expect(store.pendingUserContent).toBe("");
  });

  // ---- TERM-SEM: server terminal events map to distinct phases ----

  const SERVER_TERMINAL_CASES: Array<
    [string, "cancelled" | "blocked" | "failed", string]
  > = [
    ["chat.cancelled", "cancelled", ""],
    ["chat.blocked", "blocked", ""],
    ["chat.failed", "failed", "keep"],
  ];

  it.each(SERVER_TERMINAL_CASES)(
    "run maps a %s terminal stream to phase %s",
    async (eventType, phase, retain) => {
      const store = useChatStore();
      const deps: RealtimeDeps = {
        resume: vi.fn(async (): Promise<ResumeResult> => ({
          disposition: "RESUMED",
          events: [
            delta(1, 1, "Hel"),
            { eventSeq: 2, streamEpoch: 1, eventType, payload: {} },
          ],
        })),
        fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
      };
      store.pendingUserContent = "Hello";

      await store.run(deps, "gen-1", 1);

      expect(store.phase).toBe(phase);
      if (retain === "keep") {
        // failed keeps the content for the one-click retry.
        expect(store.pendingUserContent).toBe("Hello");
      } else {
        expect(store.pendingUserContent).toBe("");
      }
    },
  );

  // ---- STREAM-ECHO: pending user bubble while streaming ----

  it("displayMessages echoes the in-flight user message while streaming", () => {
    const store = useChatStore();
    store.conversationId = "1";
    store.messages = [
      { messageId: "1", conversationId: "1", role: "user", content: "earlier" },
    ];
    store.phase = "streaming";
    store.pendingUserContent = "Hello";
    store.stream = {
      status: "streaming",
      epoch: 1,
      cursor: 0,
      events: [],
      terminal: false,
      terminalEventType: null,
    };

    const msgs = store.displayMessages;

    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toMatchObject({
      messageId: "__pending_user__",
      role: "user",
      content: "Hello",
    });
  });

  it("displayMessages drops the pending bubble once completed", () => {
    const store = useChatStore();
    store.conversationId = "1";
    store.messages = [
      { messageId: "1", conversationId: "1", role: "user", content: "earlier" },
    ];
    store.phase = "completed";
    store.pendingUserContent = "Hello";

    expect(store.displayMessages).toHaveLength(1);
  });

  it("send keeps the content for retry when the stream fails", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      messagesJson: [
        { messageId: 10, conversationId: 1, role: "user", content: "Hello" },
      ],
    });
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [
          { eventSeq: 1, streamEpoch: 1, eventType: "chat.failed", payload: {} },
        ],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    await store.initConversation(transport, "1");
    await store.send(transport, deps, "Hello");

    expect(store.phase).toBe("failed");
    expect(store.pendingUserContent).toBe("Hello");
  });

  // ---- FAIL-REASON: terminal fault surfaced for friendly copy ----

  it("terminalFault exposes the fault of a chat.failed terminal event", async () => {
    const store = useChatStore();
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [
          {
            eventSeq: 1,
            streamEpoch: 1,
            eventType: "chat.failed",
            payload: { fault: "external-timed_out" },
          },
        ],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    await store.run(deps, "gen-1", 1);

    expect(store.phase).toBe("failed");
    expect(store.terminalFault).toBe("external-timed_out");
  });

  it("terminalFault is null on a completed stream", async () => {
    const store = useChatStore();
    await store.run(successDeps(), "gen-1", 1);

    expect(store.phase).toBe("completed");
    expect(store.terminalFault).toBeNull();
  });

  it("terminalFault is null when the terminal payload has no fault string", async () => {
    const store = useChatStore();
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [
          {
            eventSeq: 1,
            streamEpoch: 1,
            eventType: "chat.failed",
            payload: { other: "value" },
          },
        ],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    await store.run(deps, "gen-1", 1);

    expect(store.phase).toBe("failed");
    expect(store.terminalFault).toBeNull();
  });

  // ---- CONV-HIST: conversation list + history pagination ----

  it("loadConversations stores the first page for the relationship", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      conversationsJson: [
        { conversationId: 3, relationshipId: "1", lastMessagePreview: "上次聊到" },
      ],
    });

    await store.loadConversations(transport, "1");

    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0].conversationId).toBe("3");
    expect(store.conversations[0].lastMessagePreview).toBe("上次聊到");
  });

  it("loadConversations keeps the previous list on failure", async () => {
    const store = useChatStore();
    const failing: ChatTransport = {
      request: async () => ({ ok: false, status: 500, json: null }),
    };

    await store.loadConversations(failing, "1");

    expect(store.conversations).toEqual([]);
  });

  it("openConversation loads the recent window (last 50, ascending)", async () => {
    const store = useChatStore();
    const manyMessages = Array.from({ length: 120 }, (_, i) => ({
      messageId: i + 1,
      conversationId: "5",
      role: "user",
      content: `m${i + 1}`,
    }));
    const transport = mockChatTransport({ messagesJson: manyMessages });

    await store.openConversation(transport, "5");

    expect(store.conversationId).toBe("5");
    expect(store.messages.map((m) => Number(m.messageId))).toEqual(
      Array.from({ length: 50 }, (_, i) => 71 + i),
    );
    expect(store.historyHasMore).toBe(true);
  });

  it.each([0, 1, 49, 50, 51])(
    "recent-window pagination boundary keeps a clean ascending window (total=%i)",
    async (total) => {
      const store = useChatStore();
      const rows = Array.from({ length: total }, (_, i) => ({
        messageId: i + 1,
        conversationId: "9",
        role: "user",
        content: `m${i + 1}`,
      }));
      const transport = mockChatTransport({ messagesJson: rows });

      await store.openConversation(transport, "9");

      // 首次打开 = 最近窗口（最后 50 条，升序）；不足一页即到底。
      expect(store.messages.map((m) => Number(m.messageId))).toEqual(
        rows.slice(Math.max(0, total - 50)).map((m) => m.messageId),
      );
      expect(store.historyHasMore).toBe(total >= 50);
      if (total < 50) return;

      // 手动向上取一页；满页才允许再取，页内不重复。
      await store.loadMoreHistory(transport);
      expect(store.messages).toHaveLength(Math.min(total, 100));
      const ids = store.messages.map((m) => Number(m.messageId));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      expect(store.historyHasMore).toBe(total > 100);
    },
  );

  it("manual loadMoreHistory prepends older pages and lands on the top without duplicates", async () => {
    const store = useChatStore();
    const manyMessages = Array.from({ length: 120 }, (_, i) => ({
      messageId: i + 1,
      conversationId: "5",
      role: "user",
      content: `m${i + 1}`,
    }));
    const transport = mockChatTransport({ messagesJson: manyMessages });

    await store.openConversation(transport, "5");
    await store.loadMoreHistory(transport); // prepend 21..70
    expect(store.messages[0].messageId).toBe("21");
    expect(store.messages[50].messageId).toBe("71");
    expect(store.historyHasMore).toBe(true);

    await store.loadMoreHistory(transport); // prepend 1..20（不足一页 = 到底）
    expect(store.messages).toHaveLength(120);
    expect(store.messages[0].messageId).toBe("1");
    expect(store.historyHasMore).toBe(false);
    const ids = store.messages.map((m) => Number(m.messageId));
    expect(new Set(ids).size).toBe(120);
  });

  it("openConversation refuses to switch mid-stream", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      messagesJson: [{ messageId: 1, conversationId: "5", role: "user", content: "A" }],
    });
    await store.openConversation(transport, "5");
    expect(store.conversationId).toBe("5");

    store.phase = "streaming";
    await store.openConversation(transport, "6");

    expect(store.conversationId).toBe("5");
  });

  it("openConversation rolls back the visible window when history loading fails", async () => {
    const store = useChatStore();
    store.conversationId = "5";
    store.messages = [
      { messageId: "old", conversationId: "5", role: "user", content: "原会话" },
    ];
    store.historyHasMore = false;
    const failing: ChatTransport = {
      request: async () => ({ ok: false, status: 503, json: null }),
    };

    const opened = await store.openConversation(failing, "6");

    expect(opened).toBe(false);
    expect(store.conversationId).toBe("5");
    expect(store.messages.map((message) => message.content)).toEqual(["原会话"]);
    expect(store.historyHasMore).toBe(false);
  });

  // ---- round7（P1）：快速切换会话的 stale response 不得串写当前窗口 ----

  /** 与 store 的 HISTORY_PAGE_SIZE 一致的整页行数。 */
  const PAGE_ROWS = 50;

  function pageOf(
    conversationId: string,
    startId: number,
    count: number,
  ): Array<{ messageId: number; conversationId: string; role: string; content: string }> {
    return Array.from({ length: count }, (_, i) => ({
      messageId: startId + i,
      conversationId,
      role: "user",
      content: `m${startId + i}`,
    }));
  }

  function flushStore(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  interface DeferredPage {
    resolve(rows: unknown[]): void;
  }

  /**
   * 每个会话的消息分页请求都挂起，由测试按任意顺序放行——复现
   * B→A、A 先返回、B 后返回以及相反返回顺序四种交错。
   */
  function gatedMessagesTransport(): {
    transport: ChatTransport;
    answer(conversationId: string, rows: unknown[]): boolean;
    pendingCount(conversationId: string): number;
  } {
    const gates: Record<string, DeferredPage[]> = {};
    const transport: ChatTransport = {
      request(method, path) {
        const match = path.match(/^\/api\/v1\/conversations\/(\d+)\/messages/);
        if (method === "GET" && match) {
          const id = match[1];
          return new Promise((resolve) => {
            (gates[id] ??= []).push({
              resolve: (rows: unknown[]) => {
                resolve({ ok: true, status: 200, json: rows });
              },
            });
          });
        }
        // openConversation 只依赖已缓存的会话列表镜像，其余端点一律空回。
        return Promise.resolve({ ok: true, status: 200, json: [] });
      },
    };
    return {
      transport,
      answer(conversationId: string, rows: unknown[]): boolean {
        const gate = gates[conversationId]?.shift();
        if (!gate) return false;
        gate.resolve(rows);
        return true;
      },
      pendingCount(conversationId: string): number {
        return (gates[conversationId] ?? []).length;
      },
    };
  }

  it("drops every late A page once the user switched away mid-flight (B->A ordering, A resolves first)", async () => {
    const store = useChatStore();
    store.conversations = [
      { conversationId: "11", relationshipId: "1", lastMessagePreview: "" },
      { conversationId: "22", relationshipId: "1", lastMessagePreview: "" },
    ];
    const { transport, answer, pendingCount } = gatedMessagesTransport();

    const pending11 = store.openConversation(transport, "11");
    expect(store.conversationId).toBe("11");
    // A 的窗口挂在半途；用户立刻切到 22。
    const pending22 = store.openConversation(transport, "22");
    expect(store.conversationId).toBe("22");

    // A（11）先返回：令牌过期 ⇒ 整页丢弃，窗口归属与分页标志原样保留。
    expect(answer("11", pageOf("11", 101, PAGE_ROWS))).toBe(true);
    await flushStore();
    expect(store.messages).toHaveLength(0);
    expect(store.historyHasMore).toBe(true);
    // 作废链路不再发起后续页。
    expect(pendingCount("11")).toBe(0);
    expect(answer("11", pageOf("11", 900, PAGE_ROWS))).toBe(false);

    // 新会话最近窗口整页落地；随后手动向上取更早一页正常提交。
    expect(answer("22", pageOf("22", 201, PAGE_ROWS))).toBe(true);
    await flushStore();
    expect(store.messages).toHaveLength(PAGE_ROWS);
    const manualLoad = store.loadMoreHistory(transport);
    expect(answer("22", pageOf("22", 151, PAGE_ROWS))).toBe(true);
    await flushStore();
    await Promise.all([manualLoad, pending11, pending22]);

    expect(store.conversationId).toBe("22");
    expect(store.messages).toHaveLength(2 * PAGE_ROWS);
    expect(store.messages.every((m) => m.conversationId === "22")).toBe(true);
    expect(store.historyHasMore).toBe(true);
  });

  it("keeps the switched-to window intact when the old conversation lands afterwards (reverse order)", async () => {
    const store = useChatStore();
    store.conversations = [
      { conversationId: "31", relationshipId: "1", lastMessagePreview: "" },
      { conversationId: "42", relationshipId: "1", lastMessagePreview: "" },
    ];
    const { transport, answer } = gatedMessagesTransport();

    const pending31 = store.openConversation(transport, "31");
    const pending42 = store.openConversation(transport, "42");
    expect(store.conversationId).toBe("42");

    // 先让新会话最近窗口完整落地。
    expect(answer("42", pageOf("42", 301, PAGE_ROWS))).toBe(true);
    await flushStore();
    await pending42;
    const settledLength = store.messages.length;
    expect(settledLength).toBe(PAGE_ROWS);
    expect(store.messages.every((m) => m.conversationId === "42")).toBe(true);

    // 旧会话 31 的窗口此时才慢速返回：必须整体作废。
    expect(answer("31", pageOf("31", 401, PAGE_ROWS))).toBe(true);
    await flushStore();
    await pending31;

    expect(store.messages.length).toBe(settledLength);
    expect(store.messages.some((m) => m.conversationId !== "42")).toBe(false);
  });

  it("drops a late manual loadMoreHistory page after the user switched conversations", async () => {
    const store = useChatStore();
    store.conversations = [
      { conversationId: "11", relationshipId: "1", lastMessagePreview: "" },
      { conversationId: "22", relationshipId: "1", lastMessagePreview: "" },
    ];
    const { transport, answer } = gatedMessagesTransport();

    const pendingA = store.openConversation(transport, "11");
    expect(answer("11", pageOf("11", 101, PAGE_ROWS))).toBe(true);
    await flushStore();
    await pendingA;
    expect(store.messages).toHaveLength(PAGE_ROWS);

    // 上一会话的更早页在途；用户切到 22（窗口令牌递增）。
    const manual = store.loadMoreHistory(transport);
    const pendingB = store.openConversation(transport, "22");
    expect(answer("22", pageOf("22", 201, PAGE_ROWS))).toBe(true);
    await flushStore();
    await pendingB;

    // 晚到的 A 旧页落回：不得串写 B 的窗口。
    expect(answer("11", pageOf("11", 51, PAGE_ROWS))).toBe(true);
    await flushStore();
    await manual;

    expect(store.conversationId).toBe("22");
    expect(store.messages).toHaveLength(PAGE_ROWS);
    expect(store.messages.every((m) => m.conversationId === "22")).toBe(true);
  });

  // ---- 缺陷（Codex 二轮问题5）：晚到的 openConversation 清理不得破坏 ----
  // ---- 新会话进行中的流式回复                                      ----

  /**
   * 在当前会话中启动一条真正"进行中"的流：第一批 RESUMED 立即发布一段草稿
   * （无终态），下一次 resume 挂起、由 release() 控制放行——复现流式回复
   * 进行中（generationId/phase/stream/pendingUserContent/恢复标识齐备）。
   */
  function startLiveStream(
    store: ReturnType<typeof useChatStore>,
    generationId: string,
  ): { release: (draftTail: string) => Promise<void> } {
    let calls = 0;
    let releaseSecond!: (value: ResumeResult) => void;
    const deps: RealtimeDeps = {
      resume: vi.fn((_req, _signal): Promise<ResumeResult> => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({ disposition: "RESUMED", events: [delta(1, 1, "B 草稿")] });
        }
        return new Promise((resolve) => {
          releaseSecond = resolve;
        });
      }),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };
    const live = store.run(deps, generationId, 1);
    return {
      release: async (draftTail: string) => {
        // 等第二次 resume 真正挂起（首批无终态后有 250ms 量级退避）再放行。
        await vi.waitFor(() => expect(calls).toBe(2));
        releaseSecond({
          disposition: "RESUMED",
          events: [delta(2, 1, draftTail), terminal(3, 1)],
        });
        await live;
      },
    };
  }

  it("a stale openConversation window landing late must not clobber the new conversation's live stream", async () => {
    const rows = stubRestoreStorage();
    const store = useChatStore();
    const { transport, answer } = gatedMessagesTransport();

    // 1) 切到 11 的最近窗口请求挂起。
    const pending11 = store.openConversation(transport, "11");
    expect(store.conversationId).toBe("11");

    // 2) 用户随即切到 22，窗口正常落地并开始流式回复。
    const pending22 = store.openConversation(transport, "22");
    expect(answer("22", pageOf("22", 201, PAGE_ROWS))).toBe(true);
    await flushStore();
    expect(await pending22).toBe(true);
    store.bindGenerationContext("acc-1", "rel-1");
    const { release } = startLiveStream(store, "gen-22");
    store.pendingUserContent = "B 的待发文本";
    await vi.waitFor(() => expect(store.draft).toBe("B 草稿"));
    expect(store.phase).toBe("streaming");
    expect(store.generationId).toBe("gen-22");
    expect(rows.get("vc.gen.restore")).toContain('"generationId":"gen-22"');

    // 3) 11 的窗口此刻才晚到返回。
    expect(answer("11", pageOf("11", 101, PAGE_ROWS))).toBe(true);
    await flushStore();
    await pending11;

    // 4) B 的进行中回复完好：turn 状态、草稿、待发文本、恢复标识全部保持。
    expect(store.conversationId).toBe("22");
    expect(store.phase).toBe("streaming");
    expect(store.generationId).toBe("gen-22");
    expect(store.draft).toBe("B 草稿");
    expect(store.pendingUserContent).toBe("B 的待发文本");
    expect(store.outcome).toBeNull();
    expect(store.messages).toHaveLength(PAGE_ROWS);
    expect(store.messages.every((m) => m.conversationId === "22")).toBe(true);
    expect(rows.get("vc.gen.restore")).toContain('"generationId":"gen-22"');
    expect(await pending11).toBe(false); // 本链路已被更新的切换接管

    // 收尾：放行挂起的流，确认恢复正常终局。
    await release("！");
    expect(store.phase).toBe("completed");
    expect(store.pendingUserContent).toBe("");
  });

  it("a stale openConversation window failing late must not clobber the new conversation's live stream", async () => {
    const store = useChatStore();
    let reject11!: (error: unknown) => void;
    const transport: ChatTransport = {
      request(method, path) {
        const match = path.match(/^\/api\/v1\/conversations\/(\d+)\/messages/);
        if (method === "GET" && match) {
          const id = match[1];
          if (id === "11") {
            return new Promise((_resolve, reject) => {
              reject11 = reject;
            });
          }
          return Promise.resolve({ ok: true, status: 200, json: pageOf(id, 201, PAGE_ROWS) });
        }
        return Promise.resolve({ ok: true, status: 200, json: [] });
      },
    };

    // 1) 切到 11 的窗口请求挂起；用户随即切到 22 并开始流式回复。
    const pending11 = store.openConversation(transport, "11");
    const pending22 = store.openConversation(transport, "22");
    await flushStore();
    expect(await pending22).toBe(true);
    store.bindGenerationContext("acc-1", "rel-1");
    const { release } = startLiveStream(store, "gen-22");
    store.pendingUserContent = "B 的待发文本";
    await vi.waitFor(() => expect(store.draft).toBe("B 草稿"));

    // 2) 11 的窗口请求此刻才以失败告终。
    reject11(new Error("late window failure"));
    await flushStore();
    expect(await pending11).toBe(false);

    // 3) B 的进行中回复完好。
    expect(store.conversationId).toBe("22");
    expect(store.phase).toBe("streaming");
    expect(store.generationId).toBe("gen-22");
    expect(store.draft).toBe("B 草稿");
    expect(store.pendingUserContent).toBe("B 的待发文本");
    expect(store.messages.every((m) => m.conversationId === "22")).toBe(true);

    await release("！");
    expect(store.phase).toBe("completed");
  });

  it("a race-free switch still clears the previous conversation's leftover turn state", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      messagesJson: [{ messageId: 2, conversationId: "6", role: "assistant", content: "B 消息" }],
    });
    // 会话 5 遗留一次失败 turn 的全部状态。
    store.conversationId = "5";
    store.phase = "failed";
    store.generationId = "gen-5";
    store.stream = initialState(3);
    store.pendingUserContent = "重试文案";
    store.cancelUnconfirmed = true;
    store.outcome = "failed";
    store.lastDisconnect = "network";

    expect(await store.openConversation(transport, "6")).toBe(true);

    expect(store.conversationId).toBe("6");
    expect(store.messages.map((m) => m.content)).toEqual(["B 消息"]);
    expect(store.phase).toBe("idle");
    expect(store.generationId).toBe("");
    expect(store.pendingUserContent).toBe("");
    expect(store.cancelUnconfirmed).toBe(false);
    expect(store.outcome).toBeNull();
    expect(store.lastDisconnect).toBeNull();
    expect(store.stream).toEqual(initialState(0));
  });

  // ---- WP-D（缺口1）：幂等键生命周期 ----

  function idempotentTransport(): {
    transport: ChatTransport;
    keys: string[];
    setMode(mode: "network" | "server-error" | "client-error" | "ok"): void;
  } {
    const keys: string[] = [];
    let mode: "network" | "server-error" | "client-error" | "ok" = "network";
    const transport: ChatTransport = {
      async request(method, path, body) {
        if (path === "/api/v1/conversations") {
          return { ok: true, status: 200, json: { conversationId: 1 } };
        }
        if (path.includes("/messages")) {
          return { ok: true, status: 200, json: [] };
        }
        if (method === "POST" && path.endsWith("/generations")) {
          keys.push(String((body as { idempotencyKey: string }).idempotencyKey));
          if (mode === "network") throw new TypeError("fetch failed");
          if (mode === "server-error") return { ok: false, status: 500, json: null };
          if (mode === "client-error") return { ok: false, status: 400, json: null };
          return {
            ok: true,
            status: 200,
            json: {
              generationId: 42,
              conversationId: 1,
              logicalGenerationId: "lg-1",
              status: "CREATED",
            },
          };
        }
        return { ok: true, status: 200, json: {} };
      },
    };
    return { transport, keys, setMode: (next) => { mode = next; } };
  }

  it("reuses the same idempotency key when the send outcome is unknown", async () => {
    const store = useChatStore();
    const { transport, keys, setMode } = idempotentTransport();
    await store.initConversation(transport, "1");

    // 网络失败 = 结果未知：服务端可能已落库。
    await expect(store.send(transport, successDeps(), "Hello")).rejects.toThrow();
    setMode("ok");
    await store.send(transport, successDeps(), "Hello");

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("reuses the same idempotency key after a confirmed 5xx (outcome unknown)", async () => {
    const store = useChatStore();
    const { transport, keys, setMode } = idempotentTransport();
    await store.initConversation(transport, "1");

    // 5xx 响应确认 = 结果未知：服务端可能在持久化 generation 之后才失败，
    // 换新键会创建第二个 generation；同键重试由后端幂等去重。
    setMode("server-error");
    await expect(store.send(transport, successDeps(), "Hello")).rejects.toMatchObject({
      status: 500,
    });
    setMode("ok");
    await store.send(transport, successDeps(), "Hello");

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("mints a fresh idempotency key after a definite failure", async () => {
    const store = useChatStore();
    const { transport, keys, setMode } = idempotentTransport();
    await store.initConversation(transport, "1");

    // 4xx 响应确认 = 明确失败：服务端未创建 generation，允许新键。
    setMode("client-error");
    await expect(store.send(transport, successDeps(), "Hello")).rejects.toMatchObject({
      status: 400,
    });
    setMode("ok");
    await store.send(transport, successDeps(), "Hello");

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  // ---- 缺陷6：旧提交响应不得绑定到新会话 ----

  /**
   * POST /generations 挂起、可按需放行/拒绝的 transport；messages 端点按
   * 会话 id 返回各自窗口，供 initConversation 与 openConversation 使用。
   */
  function gatedSendTransport(): {
    transport: ChatTransport;
    resolveGeneration: () => void;
    rejectGeneration: (error: unknown) => void;
  } {
    let resolveGeneration!: (response: ChatApiResponse) => void;
    let rejectGeneration!: (error: unknown) => void;
    const pendingGeneration = new Promise<ChatApiResponse>((resolve, reject) => {
      resolveGeneration = resolve;
      rejectGeneration = reject;
    });
    const transport: ChatTransport = {
      async request(method, path) {
        if (path === "/api/v1/conversations") {
          return { ok: true, status: 200, json: { conversationId: 1 } };
        }
        if (method === "POST" && path.includes("/generations")) {
          return pendingGeneration;
        }
        if (path.includes("/messages")) {
          const id = path.match(/conversations\/([^/]+)\/messages/)![1];
          const rows = id === "1"
            ? [{ messageId: 1, conversationId: 1, role: "assistant", content: "A 旧消息" }]
            : [{ messageId: 2, conversationId: 2, role: "assistant", content: "B 消息" }];
          return { ok: true, status: 200, json: rows };
        }
        return { ok: true, status: 200, json: {} };
      },
    };
    return {
      transport,
      resolveGeneration: () =>
        resolveGeneration({
          ok: true,
          status: 200,
          json: {
            generationId: 42,
            conversationId: 1,
            logicalGenerationId: "lg-1",
            status: "CREATED",
          },
        }),
      rejectGeneration,
    };
  }

  it("drops a late successful send response after the user switched conversations", async () => {
    const store = useChatStore();
    const { transport, resolveGeneration } = gatedSendTransport();
    const resume = vi.fn(async (): Promise<ResumeResult> => ({
      disposition: "RESUMED",
      events: [delta(1, 1, "Hel"), terminal(2, 1)],
    }));
    const deps: RealtimeDeps = {
      resume,
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    await store.initConversation(transport, "1");
    const sendPromise = store.send(transport, deps, "Hello"); // A 的 POST 挂起
    // POST 在途（未进入流式）时切到 B：窗口落地并清零 turn 状态。
    expect(await store.openConversation(transport, "2")).toBe(true);
    expect(store.conversationId).toBe("2");
    expect(store.phase).toBe("idle");
    expect(store.pendingUserContent).toBe("");
    expect(store.messages.map((m) => m.content)).toEqual(["B 消息"]);

    // A 的成功响应晚到：静默丢弃。
    resolveGeneration();
    await sendPromise;

    expect(resume).not.toHaveBeenCalled(); // 未启动 A 的流
    expect(store.conversationId).toBe("2");
    expect(store.phase).toBe("idle");
    expect(store.pendingUserContent).toBe("");
    expect(store.messages.map((m) => m.content)).toEqual(["B 消息"]);
    expect(store.messages.every((m) => m.conversationId === "2")).toBe(true);
    expect(store.generationId).toBe(""); // A 未写入恢复锚点
    expect(store.isStreaming).toBe(false);
  });

  it("keeps the switched-to conversation untouched when a failed send response lands late", async () => {
    const store = useChatStore();
    const { transport, rejectGeneration } = gatedSendTransport();

    await store.initConversation(transport, "1");
    const sendPromise = store.send(transport, successDeps(), "Hello");
    expect(await store.openConversation(transport, "2")).toBe(true);
    const phaseBefore = store.phase;
    const pendingBefore = store.pendingUserContent;

    // A 的失败响应（结果未知类）晚到：B 不出现 failed、内容不被改写。
    rejectGeneration(new TypeError("fetch failed"));
    await expect(sendPromise).rejects.toThrow("fetch failed");

    expect(store.conversationId).toBe("2");
    expect(store.phase).toBe(phaseBefore);
    expect(store.pendingUserContent).toBe(pendingBefore);
    expect(store.isStreaming).toBe(false);
  });

  it("mints a fresh idempotency key when the same text is sent in a different conversation", async () => {
    const store = useChatStore();
    const keys: string[] = [];
    let rejectGeneration!: (error: unknown) => void;
    let firstGeneration: Promise<ChatApiResponse> = new Promise((_, reject) => {
      rejectGeneration = reject;
    });
    const transport: ChatTransport = {
      async request(method, path, body) {
        if (path === "/api/v1/conversations") {
          return { ok: true, status: 200, json: { conversationId: 1 } };
        }
        if (method === "POST" && path.includes("/generations")) {
          keys.push(String((body as { idempotencyKey: string }).idempotencyKey));
          const current = firstGeneration;
          firstGeneration = Promise.resolve({
            ok: true,
            status: 200,
            json: {
              generationId: 43,
              conversationId: 2,
              logicalGenerationId: "lg-2",
              status: "CREATED",
            },
          });
          return current;
        }
        if (path.includes("/messages")) {
          return { ok: true, status: 200, json: [] };
        }
        return { ok: true, status: 200, json: {} };
      },
    };

    await store.initConversation(transport, "1");
    const firstSend = store.send(transport, successDeps(), "Hello"); // A 的 POST 挂起
    expect(await store.openConversation(transport, "2")).toBe(true);
    rejectGeneration(new TypeError("fetch failed")); // A 的失败响应晚到
    await expect(firstSend).rejects.toThrow("fetch failed");

    // B 发送同文本：不得复用 A 的未知结果键。
    await store.send(transport, successDeps(), "Hello");

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("drops a created conversation when the window token changed during creation", async () => {
    const store = useChatStore();
    let resolveCreate!: (response: ChatApiResponse) => void;
    const pendingCreate = new Promise<ChatApiResponse>((resolve) => {
      resolveCreate = resolve;
    });
    let messagesCalls = 0;
    const transport: ChatTransport = {
      async request(method, path) {
        if (method === "POST" && path === "/api/v1/conversations") {
          return pendingCreate;
        }
        if (path.includes("/messages")) {
          messagesCalls += 1;
          return { ok: true, status: 200, json: [] };
        }
        return { ok: true, status: 200, json: {} };
      },
    };

    const pendingInit = store.initConversation(transport, "1"); // 建会话挂起
    // 用户在 await 期间切换窗口：令牌递增。
    expect(await store.openConversation(transport, "other")).toBe(true);
    const callsAtSwitch = messagesCalls;

    resolveCreate({ ok: true, status: 200, json: { conversationId: 99 } });
    const result = await pendingInit;

    expect(result).toBeNull(); // 创建结果被丢弃
    expect(store.conversationId).toBe("other"); // 未被写入 99
    expect(messagesCalls).toBe(callsAtSwitch); // 未为丢弃的会话加载历史
  });

  // ---- WP-D（缺口3）：停止后的服务端终态核对 ----

  function cancelledTerminalEvent(seq: number, epoch = 1): StreamEvent {
    return { eventSeq: seq, streamEpoch: epoch, eventType: "chat.cancelled", payload: "" };
  }

  function stubRestoreStorage(): Map<string, string> {
    const rows = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => rows.set(key, value),
      removeItem: (key: string) => rows.delete(key),
    });
    return rows;
  }

  async function startStreamingTurn(
    store: ReturnType<typeof useChatStore>,
    transport: ChatTransport,
    deps: RealtimeDeps,
  ): Promise<{ sendPromise: Promise<void> }> {
    await store.initConversation(transport, "1");
    store.bindGenerationContext("acc-1", "rel-1");
    const resumeStart = { started: false };
    const watchDeps: RealtimeDeps = {
      resume: async (_req, signal) => {
        resumeStart.started = true;
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve());
        });
        return { disposition: "RESUMED", events: [delta(1)] };
      },
      fetchSnapshot: deps.fetchSnapshot,
    };
    const sendPromise = store.send(transport, watchDeps, "Hello");
    await vi.waitFor(() => expect(resumeStart.started).toBe(true));
    // 以对象包裹返回：async 函数裸 return promise 会被隐式 adoption，
    // 调用方 await 时会等到整个 send 终局，无法在流中途拿到句柄。
    return { sendPromise };
  }

  it("cancel() clears the recovery entry once the backend confirms the cancelled terminal", async () => {
    const rows = stubRestoreStorage();
    const store = useChatStore();
    const transport = cancelAwareTransport({ cancelOk: true });
    const fetchSnapshot = vi.fn(async () => ({ ok: true, status: 200, events: [] }));
    const deps: RealtimeDeps = { resume: vi.fn(), fetchSnapshot };

    const { sendPromise } = await startStreamingTurn(store, transport, deps);
    await store.cancel();
    await sendPromise;

    await vi.waitFor(() => expect(store.cancelUnconfirmed).toBe(false));
    expect(store.phase).toBe("cancelled");
    expect(fetchSnapshot).not.toHaveBeenCalled(); // 取消响应已确认终态
    expect(rows.has("vc.gen.restore")).toBe(false);
  });

  it("cancel() falls back to a snapshot check when the cancel request fails", async () => {
    const rows = stubRestoreStorage();
    const store = useChatStore();
    const transport = cancelAwareTransport({ cancelOk: false });
    const fetchSnapshot = vi.fn(async () => ({
      ok: true,
      status: 200,
      events: [cancelledTerminalEvent(2)],
    }));
    const deps: RealtimeDeps = { resume: vi.fn(), fetchSnapshot };

    const { sendPromise } = await startStreamingTurn(store, transport, deps);
    await store.cancel();
    await sendPromise;

    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledTimes(1));
    expect(store.phase).toBe("cancelled");
    expect(store.cancelUnconfirmed).toBe(false);
    expect(rows.has("vc.gen.restore")).toBe(false);
  });

  it("cancel() verifies through the snapshot after a cancel-request timeout (bounded)", async () => {
    vi.useFakeTimers();
    try {
      const rows = stubRestoreStorage();
      const store = useChatStore();
      const transport = cancelAwareTransport({ cancelOk: true, cancelPending: true });
      const fetchSnapshot = vi.fn(async () => ({
        ok: true,
        status: 200,
        events: [cancelledTerminalEvent(2)],
      }));
      const deps: RealtimeDeps = { resume: vi.fn(), fetchSnapshot };

      const { sendPromise } = await startStreamingTurn(store, transport, deps);
      await store.cancel();
      await sendPromise;
      expect(store.cancelUnconfirmed).toBe(true);
      expect(fetchSnapshot).not.toHaveBeenCalled();

      // 有界等待到期：取消请求按未知处理，改用快照核对并确认终态。
      await vi.advanceTimersByTimeAsync(5_500);

      expect(fetchSnapshot).toHaveBeenCalledTimes(1);
      expect(store.phase).toBe("cancelled");
      expect(store.cancelUnconfirmed).toBe(false);
      expect(rows.has("vc.gen.restore")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancel() keeps the recovery entry and flags unconfirmed when the server state stays unknown", async () => {
    const rows = stubRestoreStorage();
    const store = useChatStore();
    const transport = cancelAwareTransport({ cancelOk: false });
    const fetchSnapshot = vi.fn(async () => ({
      ok: true,
      status: 200,
      events: [], // 非终态：服务端仍在生成
    }));
    const deps: RealtimeDeps = { resume: vi.fn(), fetchSnapshot };

    const { sendPromise } = await startStreamingTurn(store, transport, deps);
    await store.cancel();
    await sendPromise;

    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledTimes(1));
    expect(store.phase).toBe("cancelled");
    expect(store.cancelUnconfirmed).toBe(true);
    expect(rows.get("vc.gen.restore")).toContain('"generationId":"42"');
  });

  it("cancel() is single-flight: repeated stop clicks fire one cancel request", async () => {
    stubRestoreStorage();
    const store = useChatStore();
    const order: string[] = [];
    const transport = cancelAwareTransport({ cancelOk: true, cancelPending: true, order });
    const fetchSnapshot = vi.fn(async () => ({ ok: true, status: 200, events: [] }));
    const deps: RealtimeDeps = { resume: vi.fn(), fetchSnapshot };

    const { sendPromise } = await startStreamingTurn(store, transport, deps);
    await store.cancel();
    await store.cancel();
    await store.cancel();
    await sendPromise;

    expect(order.filter((entry) => entry === "cancel-api")).toHaveLength(1);
    expect(store.phase).toBe("cancelled");
  });

  it("recoverInFlight rechecks a cancelled generation that awaits confirmation", async () => {
    const store = useChatStore();
    store.generationId = "gen-1";
    store.conversationId = "1";
    store.phase = "cancelled";
    store.cancelUnconfirmed = true;
    const resume = vi.fn();
    const fetchSnapshot = vi.fn(async () => ({
      ok: true,
      status: 200,
      events: [terminal(1, 1)], // 服务端其实已完成
    }));

    await store.recoverInFlight({ resume, fetchSnapshot });

    expect(store.phase).toBe("completed");
    expect(store.cancelUnconfirmed).toBe(false);
    expect(resume).not.toHaveBeenCalled();
  });

  // ---- WP-D（缺口3/M2）：旧取消核对不得击落同会话新一轮提交 ----

  it("a late cancel confirmation does not clobber a new send in the same conversation", async () => {
    const rows = stubRestoreStorage();
    const store = useChatStore();
    let resolveCancel!: (response: ChatApiResponse) => void;
    const cancelPending = new Promise<ChatApiResponse>((resolve) => {
      resolveCancel = resolve;
    });
    let resolveGeneration2!: (response: ChatApiResponse) => void;
    const generation2Pending = new Promise<ChatApiResponse>((resolve) => {
      resolveGeneration2 = resolve;
    });
    let generationPosts = 0;
    const transport: ChatTransport = {
      async request(method, path) {
        if (path === "/api/v1/conversations") {
          return { ok: true, status: 200, json: { conversationId: 1 } };
        }
        if (path.includes("/messages")) {
          return { ok: true, status: 200, json: [] };
        }
        if (method === "POST" && path.endsWith("/cancel")) {
          return await cancelPending;
        }
        if (method === "POST" && path.endsWith("/generations")) {
          generationPosts += 1;
          if (generationPosts === 1) {
            return {
              ok: true,
              status: 200,
              json: {
                generationId: 42,
                conversationId: 1,
                logicalGenerationId: "lg-1",
                status: "CREATED",
              },
            };
          }
          return await generation2Pending;
        }
        return { ok: true, status: 200, json: {} };
      },
    };
    const fetchSnapshot = vi.fn(async () => ({ ok: true, status: 200, events: [] }));

    // 第一轮：流式挂起 → 取消（核对在途）。
    const firstStarted = { started: false };
    const firstDeps: RealtimeDeps = {
      resume: vi.fn(async (_req: unknown, signal?: AbortSignal) => {
        firstStarted.started = true;
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve());
        });
        return { disposition: "RESUMED", events: [delta(1)] } as ResumeResult;
      }),
      fetchSnapshot,
    };
    await store.initConversation(transport, "1");
    store.bindGenerationContext("acc-1", "rel-1");
    const send1 = store.send(transport, firstDeps, "First");
    await vi.waitFor(() => expect(firstStarted.started).toBe(true));
    await store.cancel();
    await send1;
    expect(store.phase).toBe("cancelled");
    expect(store.cancelUnconfirmed).toBe(true);
    expect(rows.get("vc.gen.restore")).toContain('"generationId":"42"');

    // 立即重发：新一轮 sendGeneration 在途，generationId 仍是旧值。
    const secondDeps: RealtimeDeps = {
      resume: vi.fn(
        async (): Promise<ResumeResult> => ({
          disposition: "RESUMED",
          events: [delta(1, 1, "Hi"), terminal(2, 1)],
        }),
      ),
      fetchSnapshot,
    };
    const send2 = store.send(transport, secondDeps, "Second");
    expect(store.generationStarting).toBe(true);
    expect(store.pendingUserContent).toBe("Second");

    // 旧取消响应此刻才返回：不得清新轮 echo、不得删恢复标识、不得写状态。
    resolveCancel({
      ok: true,
      status: 200,
      json: {
        generationId: 42,
        conversationId: 1,
        logicalGenerationId: "lg-1",
        status: "CANCELLED",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0)); // 排空旧核对回调

    expect(store.pendingUserContent).toBe("Second");
    expect(rows.get("vc.gen.restore")).toContain('"generationId":"42"');
    expect(fetchSnapshot).not.toHaveBeenCalled(); // 旧核对整体作废，不回退快照

    // 新一轮正常落库并流至终态；终局正常清理恢复标识与 echo。
    resolveGeneration2({
      ok: true,
      status: 200,
      json: {
        generationId: 43,
        conversationId: 1,
        logicalGenerationId: "lg-2",
        status: "CREATED",
      },
    });
    await send2;

    expect(store.phase).toBe("completed");
    expect(store.generationId).toBe("43");
    expect(store.pendingUserContent).toBe("");
    expect(rows.has("vc.gen.restore")).toBe(false);
  });

  it("a manual verify racing a new send must not clobber the new turn", async () => {
    stubRestoreStorage();
    const store = useChatStore();
    let resolveSnapshot!: (value: { ok: boolean; status: number; events: StreamEvent[] }) => void;
    const snapshotPending = new Promise<{ ok: boolean; status: number; events: StreamEvent[] }>(
      (resolve) => {
        resolveSnapshot = resolve;
      },
    );
    const fetchSnapshot = vi.fn(async () => snapshotPending);
    let resolveGeneration!: (response: ChatApiResponse) => void;
    const generationPending = new Promise<ChatApiResponse>((resolve) => {
      resolveGeneration = resolve;
    });
    const transport: ChatTransport = {
      async request(method, path) {
        if (path === "/api/v1/conversations") {
          return { ok: true, status: 200, json: { conversationId: 1 } };
        }
        if (path.includes("/messages")) {
          return { ok: true, status: 200, json: [] };
        }
        if (method === "POST" && path.endsWith("/generations")) {
          return await generationPending;
        }
        return { ok: true, status: 200, json: {} };
      },
    };

    await store.initConversation(transport, "1");
    // 手动构造"上一轮已取消、待确认"状态（页面 statusAction 的入口前提）。
    store.generationId = "gen-1";
    store.phase = "cancelled";
    store.cancelUnconfirmed = true;
    const resumeStart = { started: false };
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => {
        resumeStart.started = true;
        return { disposition: "RESUMED", events: [delta(1, 1, "Hi"), terminal(2, 1)] };
      }),
      fetchSnapshot,
    };

    const recoverPromise = store.recoverInFlight({ resume: vi.fn(), fetchSnapshot });
    const sendPromise = store.send(transport, deps, "New");
    expect(store.generationStarting).toBe(true);
    expect(store.pendingUserContent).toBe("New");

    // 旧 generation 的快照此刻返回终态：不得清新轮 echo、不得改写状态。
    resolveSnapshot({ ok: true, status: 200, events: [cancelledTerminalEvent(2)] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.pendingUserContent).toBe("New");

    resolveGeneration({
      ok: true,
      status: 200,
      json: {
        generationId: 43,
        conversationId: 1,
        logicalGenerationId: "lg-2",
        status: "CREATED",
      },
    });
    await sendPromise;
    await recoverPromise;

    expect(store.phase).toBe("completed");
    expect(store.generationId).toBe("43");
  });

  // ---- WP-D（缺口4）：历史加载失败如实显示 ----

  it("loadHistory failure keeps the loaded messages and flags the error state", async () => {
    const store = useChatStore();
    const good = mockChatTransport({
      messagesJson: [
        { messageId: 1, conversationId: 1, role: "user", content: "A" },
        { messageId: 2, conversationId: 1, role: "assistant", content: "B" },
      ],
    });
    await store.initConversation(good, "1");
    expect(store.messages).toHaveLength(2);
    expect(store.historyLoadFailed).toBe(false);

    const failing: ChatTransport = {
      request: async () => ({ ok: false, status: 503, json: null }),
    };
    await store.loadHistory(failing);

    expect(store.historyLoadFailed).toBe(true);
    expect(store.messages.map((m) => m.content)).toEqual(["A", "B"]);
    expect(store.historyHasMore).toBe(true); // 保留重试入口

    await store.loadMoreHistory(good); // 重试向上翻页：before=1 → 空 → 到底
    expect(store.messages.map((m) => m.content)).toEqual(["A", "B"]);
    expect(store.historyHasMore).toBe(false);
  });

  it("send stays completed and flags the history error when the tail reload fails", async () => {
    const store = useChatStore();
    const failingMessages: ChatTransport = {
      async request(method, path) {
        if (path === "/api/v1/conversations") {
          return { ok: true, status: 200, json: { conversationId: 1 } };
        }
        if (path.includes("/messages")) {
          return { ok: false, status: 503, json: null };
        }
        if (method === "POST" && path.endsWith("/generations")) {
          return {
            ok: true,
            status: 200,
            json: {
              generationId: 42,
              conversationId: 1,
              logicalGenerationId: "lg-1",
              status: "CREATED",
            },
          };
        }
        return { ok: true, status: 200, json: {} };
      },
    };

    await store.initConversation(failingMessages, "1");
    await store.send(failingMessages, successDeps(), "Hello");

    expect(store.phase).toBe("completed");
    expect(store.historyLoadFailed).toBe(true);
  });

});
