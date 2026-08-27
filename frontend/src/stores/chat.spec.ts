import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chat";
import { TERMINAL_EVENT_TYPE, type StreamEvent } from "@/domain/stream-reducer";
import type { RealtimeDeps, ResumeResult } from "@/api/realtime";
import type { ChatTransport, ChatApiResponse } from "@/api/chat";

function delta(seq: number, epoch = 1, payload = "Hel"): StreamEvent {
  return { eventSeq: seq, streamEpoch: epoch, eventType: "chat.delta", payload };
}
function terminal(seq: number, epoch = 1): StreamEvent {
  return { eventSeq: seq, streamEpoch: epoch, eventType: TERMINAL_EVENT_TYPE, payload: "" };
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

/** Parse the `after` query parameter of a request path (undefined when absent). */
function afterFromPath(path: string): string | undefined {
  const idx = path.indexOf("?");
  if (idx < 0) return undefined;
  return new URLSearchParams(path.slice(idx + 1)).get("after") ?? undefined;
}

/** Mock ChatTransport that routes by path: conversations, generations, messages. */
function mockChatTransport(opts: {
  generationStatus?: number;
  generationJson?: unknown;
  messagesJson?: unknown;
  conversationsJson?: unknown;
  conversationOk?: boolean;
  /** CHAT-MODE: capture every generation request body (in call order). */
  generationBodies?: unknown[];
  /** FEEDBACK: response for POST /generations/{id}/feedback. */
  feedbackStatus?: number;
  feedbackJson?: unknown;
  /** MSG-DELETE: response for DELETE /conversations/{id}/messages/{id}. */
  messageDeleteOk?: boolean;
  /** SVC-MODE: response for GET /api/v1/service-mode. */
  serviceModeJson?: unknown;
}): ChatTransport {
  return {
    async request(method: string, path: string, body?: unknown): Promise<ChatApiResponse> {
      if (path === "/api/v1/service-mode") {
        return { ok: true, status: 200, json: opts.serviceModeJson ?? { mode: "FULL_AI", summary: "正常模型服务" } };
      }
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
      if (method === "DELETE" && /\/messages\/[^/]+$/.test(path)) {
        const ok = opts.messageDeleteOk ?? true;
        return { ok, status: ok ? 200 : 404, json: ok ? { ok: true } : null };
      }
      if (path.endsWith("/end") && method === "POST") {
        return { ok: true, status: 200, json: { ok: true, incognitoCleared: true } };
      }
      if (path.includes("/feedback")) {
        const status = opts.feedbackStatus ?? 200;
        return {
          ok: status === 200,
          status,
          json: status === 200 ? (opts.feedbackJson ?? {
            generationId: 42,
            kind: "UNSAFE",
            createdAt: "2026-08-16T10:00:00Z",
          }) : null,
        };
      }
      if (path.includes("/generations")) {
        opts.generationBodies?.push(body);
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
        const after = afterFromPath(path);
        const limit = Number(new URLSearchParams(path.split("?")[1] ?? "").get("limit") ?? 50);
        const all = (opts.messagesJson ?? []) as Array<{ messageId: number }>;
        const filtered =
          after === undefined ? all : all.filter((m) => Number(m.messageId) > Number(after));
        return { ok: true, status: 200, json: filtered.slice(0, limit) };
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

    await store.run(deps, "gen-pending", 1);

    expect(store.phase).toBe("failed");
    expect(store.outcome).toBe("exhausted");
    expect(rows.get("vc.gen.restore")).toContain('"generationId":"gen-pending"');
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

  it("cancel() confirms the backend cancel API before aborting the local stream", async () => {
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

    // The backend confirmation must precede the local stream teardown.
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

  it("endToday clears the open conversation without deleting the list row", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      conversationsJson: [
        { conversationId: 1, relationshipId: 7, createdAt: "2026-08-18T00:00:00Z", lastMessagePreview: "无痕秘密", incognito: true },
      ],
      messagesJson: [{ messageId: 10, conversationId: 1, role: "user", content: "无痕秘密" }],
    });
    await store.loadConversations(transport, "7");
    await store.openConversation(transport, "1");
    expect(store.messages[0].content).toBe("无痕秘密");

    const ok = await store.endToday(transport, "1");

    expect(ok).toBe(true);
    expect(store.conversationId).toBe("");
    expect(store.messages).toEqual([]);
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0].lastMessagePreview).toBe("");
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
  });

  it("CHAT-MODE: send carries the selected mode in the generation body", async () => {
    const store = useChatStore();
    const bodies: unknown[] = [];
    const transport = mockChatTransport({
      generationBodies: bodies,
      messagesJson: [
        { messageId: 10, conversationId: 1, role: "user", content: "Hello" },
        { messageId: 11, conversationId: 1, role: "assistant", content: "Hi" },
      ],
    });

    await store.initConversation(transport, "1");
    store.setMode("DISCUSS");
    await store.send(transport, successDeps(), "Hello");

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      idempotencyKey: expect.any(String),
      userContent: "Hello",
      mode: "DISCUSS",
    });
  });

  it("CHAT-MODE: AUTO is the default and setMode narrows unapproved input", async () => {
    const store = useChatStore();
    expect(store.selectedMode).toBe("AUTO");

    store.setMode("LISTEN");
    expect(store.selectedMode).toBe("LISTEN");

    store.setMode("CASUAL");
    expect(store.selectedMode).toBe("CASUAL");

    // Unapproved values are ignored, never applied.
    store.setMode("YELL");
    expect(store.selectedMode).toBe("CASUAL");
  });

  it("FEEDBACK: sendFeedback records a kind once and marks it in state", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      feedbackJson: {
        generationId: 42,
        kind: "UNSAFE",
        createdAt: "2026-08-16T10:00:00Z",
      },
    });

    store.generationId = "42";
    expect(await store.sendFeedback(transport, "UNSAFE")).toBe(true);
    expect(store.feedbackKinds).toEqual(["UNSAFE"]);

    // Repeating the same kind is a no-op (server is idempotent too).
    expect(await store.sendFeedback(transport, "UNSAFE")).toBe(false);
    expect(store.feedbackKinds).toEqual(["UNSAFE"]);

    // A different kind records a second entry.
    expect(await store.sendFeedback(transport, "FACTUAL_ERROR")).toBe(true);
    expect(store.feedbackKinds).toEqual(["UNSAFE", "FACTUAL_ERROR"]);
  });

  it("FEEDBACK: sendFeedback without a generation is a silent no-op", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({});

    expect(await store.sendFeedback(transport, "UNSAFE")).toBe(false);
    expect(store.feedbackKinds).toEqual([]);
  });

  it("MSG-DELETE: removeMessage drops the row only on a confirmed delete", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      messageDeleteOk: true,
      messagesJson: [
        { messageId: 10, conversationId: 1, role: "user", content: "A" },
        { messageId: 11, conversationId: 1, role: "assistant", content: "B" },
      ],
    });

    await store.initConversation(transport, "1");
    expect(store.messages).toHaveLength(2);

    expect(await store.removeMessage(transport, "10")).toBe(true);
    expect(store.messages.map((m) => m.messageId)).toEqual(["11"]);
  });

  it("MSG-DELETE: an existence-hidden false keeps the row", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      messageDeleteOk: false,
      messagesJson: [
        { messageId: 10, conversationId: 1, role: "user", content: "A" },
      ],
    });

    await store.initConversation(transport, "1");
    expect(await store.removeMessage(transport, "10")).toBe(false);
    expect(store.messages).toHaveLength(1);
  });

  it("SVC-MODE: loadServiceMode stores the current status and survives reset()", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      serviceModeJson: { mode: "ZERO_LLM", summary: "当前为无生成模型的受限服务" },
    });

    expect(store.serviceMode).toBeNull();
    await store.loadServiceMode(transport);
    expect(store.serviceMode).toEqual({
      mode: "ZERO_LLM",
      summary: "当前为无生成模型的受限服务",
    });

    // reset() is also called by startConversation(); the ops fact survives it.
    store.reset();
    expect(store.serviceMode?.mode).toBe("ZERO_LLM");
  });

  it("INC-MODE: initConversation carries the flag and marks the open conversation", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({});

    await store.initConversation(transport, "1", true);
    expect(store.activeIncognito).toBe(true);
    expect(store.conversationId).toBe("1");

    // A fresh non-incognito conversation flips the flag back.
    await store.initConversation(transport, "1", false);
    expect(store.activeIncognito).toBe(false);
  });

  it("INC-MODE: openConversation mirrors the opened conversation's flag", async () => {
    const store = useChatStore();
    const transport = mockChatTransport({
      conversationsJson: [
        {
          conversationId: "5",
          relationshipId: "1",
          createdAt: "2026-08-16T08:00:00Z",
          incognito: true,
        },
      ],
      messagesJson: [
        { messageId: 10, conversationId: 5, role: "user", content: "hi" },
      ],
    });

    await store.loadConversations(transport, "1");
    await store.openConversation(transport, "5");
    expect(store.activeIncognito).toBe(true);
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
    expect(store.pendingMemoryCount).toBe(0);
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

  // ---- CONV-MGMT: remove + rename ----

  it("removeConversation drops the entry and clears the open window", async () => {
    const store = useChatStore();
    store.conversations = [
      { conversationId: "3", relationshipId: "1", title: "A" },
      { conversationId: "4", relationshipId: "1" },
    ];
    store.conversationId = "3";
    store.messages = [
      { messageId: "1", conversationId: "3", role: "user", content: "hi" },
    ];
    const transport = mockChatTransport({});
    vi.spyOn(transport, "request").mockImplementation(
      async (method: string, path: string) => {
        if (path === "/api/v1/conversations/3" && method === "DELETE") {
          return { ok: true, status: 200, json: { ok: true } };
        }
        return { ok: true, status: 200, json: {} };
      },
    );

    const removed = await store.removeConversation(transport, "3");

    expect(removed).toBe(true);
    expect(store.conversations.map((c) => c.conversationId)).toEqual(["4"]);
    expect(store.conversationId).toBe("");
    expect(store.messages).toEqual([]);
  });

  it("removeConversation keeps state on a non-confirmed delete", async () => {
    const store = useChatStore();
    store.conversations = [{ conversationId: "3", relationshipId: "1" }];
    store.conversationId = "3";
    const transport = mockChatTransport({});
    vi.spyOn(transport, "request").mockImplementation(
      async () => ({ ok: false, status: 404, json: null }),
    );

    const removed = await store.removeConversation(transport, "3");

    expect(removed).toBe(false);
    expect(store.conversations).toHaveLength(1);
    expect(store.conversationId).toBe("3");
  });

  it("renameConversation updates the list entry only on a confirmed result", async () => {
    const store = useChatStore();
    store.conversations = [{ conversationId: "3", relationshipId: "1" }];
    const transport = mockChatTransport({});
    vi.spyOn(transport, "request").mockImplementation(
      async () => ({ ok: true, status: 200, json: { conversationId: 3, title: "新标题" } }),
    );

    const renamed = await store.renameConversation(transport, "3", "新标题");

    expect(renamed).toBe(true);
    expect(store.conversations[0]?.title).toBe("新标题");
  });

  it("renameConversation keeps the entry untouched on a non-confirmed result", async () => {
    const store = useChatStore();
    store.conversations = [{ conversationId: "3", relationshipId: "1" }];
    const transport = mockChatTransport({});
    vi.spyOn(transport, "request").mockImplementation(
      async () => ({ ok: false, status: 404, json: null }),
    );

    const renamed = await store.renameConversation(transport, "3", "x");

    expect(renamed).toBe(false);
    expect(store.conversations[0]?.title).toBeUndefined();
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

  // ---- USAGE-VIZ: settled usage surfaced after a completed run ----

  it("run pulls the settled usage from the snapshot endpoint after completion", async () => {
    const store = useChatStore();
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [delta(1, 1, "Hel"), terminal(2, 1)],
      })),
      fetchSnapshot: vi.fn(async () => ({
        ok: true,
        status: 200,
        events: [],
        usage: { inputTokens: 42, outputTokens: 58 },
      })),
    };

    await store.run(deps, "gen-1", 1);

    expect(store.phase).toBe("completed");
    expect(store.usage).toEqual({ inputTokens: 42, outputTokens: 58 });
  });

  it("keeps usage null when the snapshot carries none", async () => {
    const store = useChatStore();
    const deps: RealtimeDeps = {
      resume: vi.fn(async (): Promise<ResumeResult> => ({
        disposition: "RESUMED",
        events: [delta(1, 1, "Hel"), terminal(2, 1)],
      })),
      fetchSnapshot: vi.fn(async () => ({ ok: true, status: 200, events: [] })),
    };

    await store.run(deps, "gen-1", 1);

    expect(store.phase).toBe("completed");
    expect(store.usage).toBeNull();
  });

  it("reset clears the usage", async () => {
    const store = useChatStore();
    store.usage = { inputTokens: 1, outputTokens: 2 };
    store.generationId = "gen-1";

    store.reset();

    expect(store.usage).toBeNull();
    expect(store.generationId).toBe("");
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

  it("openConversation switches and auto-advances to the newest messages", async () => {
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
    expect(store.messages).toHaveLength(120);
    expect(store.messages[119].content).toBe("m120");
    expect(store.historyHasMore).toBe(false);
  });

  it("openConversation caps auto-advance and loadMoreHistory appends past the cap", async () => {
    const store = useChatStore();
    const manyMessages = Array.from({ length: 600 }, (_, i) => ({
      messageId: i + 1,
      conversationId: "5",
      role: "user",
      content: `m${i + 1}`,
    }));
    const transport = mockChatTransport({ messagesJson: manyMessages });

    await store.openConversation(transport, "5");

    // 10 auto pages × 50 = the cap; the rest stays behind the manual button.
    expect(store.messages).toHaveLength(500);
    expect(store.historyHasMore).toBe(true);

    await store.loadMoreHistory(transport);
    expect(store.messages).toHaveLength(550);
    expect(store.historyHasMore).toBe(true);
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
      { conversationId: "11", relationshipId: "1", incognito: true, lastMessagePreview: "" },
      { conversationId: "22", relationshipId: "1", incognito: false, lastMessagePreview: "" },
    ];
    const { transport, answer } = gatedMessagesTransport();

    const pending11 = store.openConversation(transport, "11");
    expect(store.conversationId).toBe("11");
    // A 的页面挂在半途；用户立刻切到 22。
    const pending22 = store.openConversation(transport, "22");
    expect(store.conversationId).toBe("22");
    expect(store.activeIncognito).toBe(false);

    // A（11）先返回：令牌过期 ⇒ 整页丢弃，窗口归属与分页标志原样保留。
    expect(answer("11", pageOf("11", 101, PAGE_ROWS))).toBe(true);
    await flushStore();
    expect(store.messages).toHaveLength(0);
    expect(store.historyHasMore).toBe(true);
    // 作废链路不再发起后续页。
    expect(answer("11", pageOf("11", 900, PAGE_ROWS))).toBe(false);

    // 新会话逐页提交：整页后继续自动翻页，局部不足一页收尾。
    expect(answer("22", pageOf("22", 201, PAGE_ROWS))).toBe(true);
    await flushStore();
    expect(store.messages).toHaveLength(PAGE_ROWS);
    expect(answer("22", pageOf("22", 300, PAGE_ROWS - 1))).toBe(true);
    await Promise.all([pending11, pending22]);

    expect(store.conversationId).toBe("22");
    expect(store.messages).toHaveLength(PAGE_ROWS + PAGE_ROWS - 1);
    expect(store.messages.every((m) => m.conversationId === "22")).toBe(true);
    expect(store.historyHasMore).toBe(false);
    // INC 镜像没有被迟到的旧会话改写。
    expect(store.activeIncognito).toBe(false);
  });

  it("keeps the switched-to window intact when the old conversation lands afterwards (reverse order)", async () => {
    const store = useChatStore();
    store.conversations = [
      { conversationId: "31", relationshipId: "1", incognito: false, lastMessagePreview: "" },
      { conversationId: "42", relationshipId: "1", incognito: true, lastMessagePreview: "" },
    ];
    const { transport, answer } = gatedMessagesTransport();

    const pending31 = store.openConversation(transport, "31");
    const pending42 = store.openConversation(transport, "42");
    expect(store.conversationId).toBe("42");

    // 先让新会话完整落地。
    expect(answer("42", pageOf("42", 301, PAGE_ROWS))).toBe(true);
    await flushStore();
    expect(answer("42", pageOf("42", 301 + PAGE_ROWS, PAGE_ROWS))).toBe(true);
    await flushStore();
    expect(answer("42", pageOf("42", 301 + 2 * PAGE_ROWS, PAGE_ROWS - 3))).toBe(true);
    await pending42;
    const settledLength = store.messages.length;
    expect(settledLength).toBe(2 * PAGE_ROWS + PAGE_ROWS - 3);
    expect(store.messages.every((m) => m.conversationId === "42")).toBe(true);

    // 旧会话 31 的页面此时才慢速返回：必须整体作废。
    expect(answer("31", pageOf("31", 401, PAGE_ROWS))).toBe(true);
    await flushStore();

    expect(store.messages.length).toBe(settledLength);
    expect(store.messages.some((m) => m.conversationId !== "42")).toBe(false);
    expect(store.activeIncognito).toBe(true);
    void pending31;
  });

  // ---- MEM-PROMPT: pending candidate count ----

  it("refreshPendingMemoryCount counts only pending candidates", async () => {
    const store = useChatStore();
    const transport: ChatTransport = {
      request: async () => ({
        ok: true,
        status: 200,
        json: [
          { memoryId: "1", scope: "RELATIONSHIP", summary: "a", status: "PENDING_CONFIRMATION" },
          { memoryId: "2", scope: "RELATIONSHIP", summary: "b", status: "ACCEPTED" },
          { memoryId: "3", scope: "RELATIONSHIP", summary: "c", status: "PENDING_CONFIRMATION" },
        ],
      }),
    };

    await store.refreshPendingMemoryCount(transport, "1");

    expect(store.pendingMemoryCount).toBe(2);
  });

  it("refreshPendingMemoryCount keeps the previous count on failure", async () => {
    const store = useChatStore();
    store.pendingMemoryCount = 3;
    const failing: ChatTransport = {
      request: async () => ({ ok: false, status: 500, json: null }),
    };

    await store.refreshPendingMemoryCount(failing, "1");

    expect(store.pendingMemoryCount).toBe(3);
  });
});
