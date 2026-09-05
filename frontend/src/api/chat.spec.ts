import { describe, expect, it } from "vitest";

import {
  cancelGeneration,
  ChatHttpError,
  createConversation,
  getServiceMode,
  listConversations,
  listMessages,
  sendGeneration,
  type ChatTransport,
} from "./chat";

function recorder(response: { ok: boolean; status: number; json: unknown }) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const transport: ChatTransport = {
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      return response;
    },
  };
  return { transport, calls };
}

const generation = {
  generationId: 42,
  conversationId: 7,
  logicalGenerationId: "logical-1",
  status: "CREATED",
  createdAt: "2026-08-13T01:00:00Z",
};

describe("createConversation", () => {
  it("creates a conversation for the current relationship", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { conversationId: 123 },
    });

    await expect(createConversation(transport, "1")).resolves.toEqual({ conversationId: "123" });
    expect(calls).toEqual([
      { method: "POST", path: "/api/v1/conversations", body: { relationshipId: "1" } },
    ]);
  });

  it("hides a missing relationship and preserves real auth failures", async () => {
    const hidden = recorder({ ok: false, status: 404, json: null }).transport;
    await expect(createConversation(hidden, "999")).resolves.toBeNull();

    const unauthorized = recorder({ ok: false, status: 401, json: null }).transport;
    await expect(createConversation(unauthorized, "1")).rejects.toMatchObject({
      status: 401,
      kind: "unauthorized",
    });
  });
});

describe("sendGeneration", () => {
  it("sends only the content required by the chat experience", async () => {
    const { transport, calls } = recorder({ ok: true, status: 200, json: generation });

    await expect(sendGeneration(transport, "7", "key-1", "你好")).resolves.toEqual({
      generationId: "42",
      conversationId: "7",
      logicalGenerationId: "logical-1",
      status: "CREATED",
      createdAt: "2026-08-13T01:00:00Z",
    });
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/v1/conversations/7/generations",
        body: { idempotencyKey: "key-1", userContent: "你好" },
      },
    ]);
  });

  it("keeps the age gate actionable while hiding an owner miss", async () => {
    const gated = recorder({
      ok: false,
      status: 403,
      json: { code: "AGE_VERIFICATION_REQUIRED" },
    }).transport;
    await expect(sendGeneration(gated, "7", "key-1", "你好")).rejects.toMatchObject({
      status: 403,
      code: "AGE_VERIFICATION_REQUIRED",
    });

    const hidden = recorder({ ok: false, status: 404, json: null }).transport;
    await expect(sendGeneration(hidden, "999", "key-1")).resolves.toBeNull();
  });
});

describe("conversation history", () => {
  it("loads conversation summaries with their product title", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: [
        {
          conversationId: 100,
          relationshipId: 7,
          title: "周二的夜聊",
          lastMessagePreview: "我在听",
          lastActivityAt: "2026-08-16T09:00:00Z",
        },
      ],
    });

    await expect(listConversations(transport, "7", "50", 20)).resolves.toEqual([
      {
        conversationId: "100",
        relationshipId: "7",
        title: "周二的夜聊",
        lastMessageRole: undefined,
        lastMessagePreview: "我在听",
        createdAt: undefined,
        lastActivityAt: "2026-08-16T09:00:00Z",
      },
    ]);
    expect(calls[0]?.path).toBe(
      "/api/v1/conversations?relationshipId=7&after=50&limit=20",
    );
  });

  it("loads messages and drops malformed rows", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: [
        { messageId: 9, conversationId: 7, role: "user", content: "你好" },
        { messageId: 10, conversationId: 7, role: "assistant" },
      ],
    });

    await expect(listMessages(transport, "7", "8", 50)).resolves.toEqual([
      {
        messageId: "9",
        conversationId: "7",
        role: "user",
        content: "你好",
        createdAt: undefined,
      },
    ]);
    expect(calls[0]?.path).toBe("/api/v1/conversations/7/messages?after=8&limit=50");
  });

  it("does not turn a server failure into an empty successful history", async () => {
    const transport = recorder({ ok: false, status: 503, json: null }).transport;
    await expect(listMessages(transport, "7")).rejects.toBeInstanceOf(ChatHttpError);
  });
});

describe("cancelGeneration", () => {
  it("cancels the active generation", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { ...generation, status: "CANCELLED" },
    });

    await expect(cancelGeneration(transport, "42")).resolves.toMatchObject({
      generationId: "42",
      status: "CANCELLED",
    });
    expect(calls[0]?.path).toBe("/api/v1/generations/42/cancel");
  });
});

describe("getServiceMode", () => {
  it("reads the H5 administration status", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { mode: "FULL_AI", summary: "服务正常" },
    });

    await expect(getServiceMode(transport)).resolves.toEqual({
      mode: "FULL_AI",
      summary: "服务正常",
    });
    expect(calls[0]?.path).toBe("/api/v1/service-mode");
  });

  it("does not invent an unknown service mode", async () => {
    const transport = recorder({
      ok: true,
      status: 200,
      json: { mode: "UNKNOWN", summary: "?" },
    }).transport;
    await expect(getServiceMode(transport)).resolves.toBeNull();
  });
});
