// TASK-0186: Chat / Generation / History API client unit tests. The transport
// is mocked so every wire shape (method, path, body, query) and response-parsing
// / existence-hidden / typed-error path is exercised in isolation.
import { describe, expect, it } from "vitest";

import {
  cancelGeneration,
  ChatHttpError,
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  renameConversation,
  sendGeneration,
  type ChatTransport,
} from "./chat";

/** Build a transport that returns a fixed response and records all calls. */
function recorder(
  response: { ok: boolean; status: number; json: unknown },
): { transport: ChatTransport; calls: { method: string; path: string; body?: unknown }[] } {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const transport: ChatTransport = {
    request: async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return { ...response };
    },
  };
  return { transport, calls };
}

const GENERATION_JSON = {
  generationId: 42,
  conversationId: 7,
  logicalGenerationId: "gen-logical-1",
  status: "CREATED",
  createdAt: "2026-08-13T01:00:00Z",
};

const MESSAGE_JSON = {
  messageId: 99,
  conversationId: 7,
  role: "user",
  content: "Hello",
  createdAt: "2026-08-13T01:00:00Z",
};

describe("createConversation", () => {
  it("POSTs to /api/v1/conversations with relationshipId body", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { conversationId: 123 },
    });

    const result = await createConversation(transport, "1");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/v1/conversations");
    expect(calls[0].body).toEqual({ relationshipId: "1" });
    expect(result).toEqual({ conversationId: "123" });
  });

  it("normalises numeric conversationId to string", async () => {
    const { transport } = recorder({
      ok: true,
      status: 200,
      json: { conversationId: 456 },
    });

    const result = await createConversation(transport, "1");

    expect(result).toEqual({ conversationId: "456" });
  });

  it("returns null on 404 (existence hidden)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    const result = await createConversation(transport, "999");

    expect(result).toBeNull();
  });

  it("throws ChatHttpError on 401 (unauthorized)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 401,
      json: { code: "AUTH_REQUIRED", message: "no session" },
    });

    await expect(createConversation(transport, "1")).rejects.toThrow(ChatHttpError);
  });

  it("throws ChatHttpError on 500 (server)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 503,
      json: null,
    });

    await expect(createConversation(transport, "1")).rejects.toThrow(ChatHttpError);
  });
});

describe("sendGeneration", () => {
  it("POSTs to conversations/{id}/generations with idempotencyKey + userContent", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: GENERATION_JSON,
    });

    const result = await sendGeneration(transport, "7", "key-abc", "Hello");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/v1/conversations/7/generations");
    expect(calls[0].body).toEqual({ idempotencyKey: "key-abc", userContent: "Hello" });
    expect(result).toEqual({
      generationId: "42",
      conversationId: "7",
      logicalGenerationId: "gen-logical-1",
      status: "CREATED",
      createdAt: "2026-08-13T01:00:00Z",
    });
  });

  it("omits userContent from body when undefined", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: GENERATION_JSON,
    });

    await sendGeneration(transport, "7", "key-abc");

    expect(calls[0].body).toEqual({ idempotencyKey: "key-abc" });
  });

  it("returns null on 404 (foreign conversation, existence hidden)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    const result = await sendGeneration(transport, "999", "key");

    expect(result).toBeNull();
  });

  it("throws on 500", async () => {
    const { transport } = recorder({
      ok: false,
      status: 500,
      json: null,
    });

    await expect(sendGeneration(transport, "7", "key")).rejects.toThrow(ChatHttpError);
  });
});

describe("listMessages", () => {
  it("GETs conversations/{id}/messages with after + limit query", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: [MESSAGE_JSON],
    });

    const result = await listMessages(transport, "7", "50", 20);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toBe("/api/v1/conversations/7/messages?after=50&limit=20");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      messageId: "99",
      conversationId: "7",
      role: "user",
      content: "Hello",
      createdAt: "2026-08-13T01:00:00Z",
    });
  });

  it("omits query when no after or limit", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: [],
    });

    await listMessages(transport, "7");

    expect(calls[0].path).toBe("/api/v1/conversations/7/messages");
  });

  it("returns empty array for foreign conversation (200 empty, no disclosure)", async () => {
    const { transport } = recorder({
      ok: true,
      status: 200,
      json: [],
    });

    const result = await listMessages(transport, "999");

    expect(result).toEqual([]);
  });

  it("returns empty array on 404 (existence hidden, no throw)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    const result = await listMessages(transport, "999");

    expect(result).toEqual([]);
  });

  it("throws ChatHttpError on 401", async () => {
    const { transport } = recorder({
      ok: false,
      status: 401,
      json: null,
    });

    await expect(listMessages(transport, "7")).rejects.toThrow(ChatHttpError);
  });
});

describe("cancelGeneration", () => {
  it("POSTs to generations/{id}/cancel", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { ...GENERATION_JSON, status: "CANCELLED" },
    });

    const result = await cancelGeneration(transport, "42");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/v1/generations/42/cancel");
    expect(result?.status).toBe("CANCELLED");
  });

  it("returns null on 404 (existence hidden)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    const result = await cancelGeneration(transport, "999");

    expect(result).toBeNull();
  });

  it("throws on 500", async () => {
    const { transport } = recorder({
      ok: false,
      status: 500,
      json: null,
    });

    await expect(cancelGeneration(transport, "42")).rejects.toThrow(ChatHttpError);
  });
});

describe("deleteConversation/renameConversation (CONV-MGMT)", () => {
  it("DELETE returns true on OK", async () => {
    const { transport, calls } = recorder({ ok: true, status: 200, json: { ok: true } });

    expect(await deleteConversation(transport, "100")).toBe(true);
    expect(calls).toEqual([{ method: "DELETE", path: "/api/v1/conversations/100", body: undefined }]);
  });

  it("DELETE maps 403/404 to false (existence never disclosed)", async () => {
    const t404 = recorder({ ok: false, status: 404, json: null }).transport;
    expect(await deleteConversation(t404, "100")).toBe(false);

    const t403 = recorder({ ok: false, status: 403, json: null }).transport;
    expect(await deleteConversation(t403, "100")).toBe(false);
  });

  it("DELETE throws a typed error on 5xx", async () => {
    const { transport } = recorder({ ok: false, status: 500, json: null });

    await expect(deleteConversation(transport, "100")).rejects.toBeInstanceOf(ChatHttpError);
  });

  it("PATCH sends the title and returns the applied title", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { conversationId: 100, title: "周二的夜聊" },
    });

    expect(await renameConversation(transport, "100", "周二的夜聊")).toBe("周二的夜聊");
    expect(calls).toEqual([
      { method: "PATCH", path: "/api/v1/conversations/100", body: { title: "周二的夜聊" } },
    ]);
  });

  it("PATCH maps 403/404 to null", async () => {
    const { transport } = recorder({ ok: false, status: 404, json: null });

    expect(await renameConversation(transport, "100", "x")).toBeNull();
  });

  it("parses the title into the conversation list item", async () => {
    const { transport } = recorder({
      ok: true,
      status: 200,
      json: [
        {
          conversationId: "100",
          relationshipId: "7",
          createdAt: "2026-08-16T08:00:00Z",
          title: "周二的夜聊",
        },
      ],
    });

    const list = await listConversations(transport);
    expect(list[0]?.title).toBe("周二的夜聊");
  });
});

describe("listConversations (CONV-HIST)", () => {
  const CONVERSATION_JSON = {
    conversationId: 100,
    relationshipId: 7,
    lastMessageRole: "assistant",
    lastMessagePreview: "好的，我在听",
    createdAt: "2026-08-16T08:00:00Z",
  };

  it("GETs /api/v1/conversations with relationshipId + after + limit query", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: [CONVERSATION_JSON],
    });

    const result = await listConversations(transport, "7", "50", 20);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toBe("/api/v1/conversations?relationshipId=7&after=50&limit=20");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      conversationId: "100",
      relationshipId: "7",
      lastMessageRole: "assistant",
      lastMessagePreview: "好的，我在听",
      createdAt: "2026-08-16T08:00:00Z",
    });
  });

  it("omits query when no parameters", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: [],
    });

    await listConversations(transport);

    expect(calls[0].path).toBe("/api/v1/conversations");
  });

  it("maps a conversation without messages to undefined preview fields", async () => {
    const { transport } = recorder({
      ok: true,
      status: 200,
      json: [{ conversationId: 101, relationshipId: 7, createdAt: "2026-08-16T08:00:00Z" }],
    });

    const result = await listConversations(transport);

    expect(result).toHaveLength(1);
    expect(result[0].lastMessageRole).toBeUndefined();
    expect(result[0].lastMessagePreview).toBeUndefined();
  });

  it("drops rows missing required ids instead of faking entries", async () => {
    const { transport } = recorder({
      ok: true,
      status: 200,
      json: [{ conversationId: 102 }],
    });

    expect(await listConversations(transport)).toEqual([]);
  });

  it("returns empty array for a foreign relationship (404, existence hidden)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    expect(await listConversations(transport, "999")).toEqual([]);
  });

  it("throws ChatHttpError on 401", async () => {
    const { transport } = recorder({
      ok: false,
      status: 401,
      json: null,
    });

    await expect(listConversations(transport)).rejects.toThrow(ChatHttpError);
  });
});
