// TASK-0187: Relationship API client unit tests. The transport is mocked so
// every wire shape (method, path, body) and response-parsing /
// existence-hidden / typed-error path is exercised in isolation.
import { describe, expect, it } from "vitest";

import {
  activateRelationship,
  createRelationship,
  deactivateRelationship,
  DEFAULT_COMPANION_PREFS,
  getRelationship,
  listRelationships,
  RelationshipHttpError,
  deleteRelationship,
  previewRelationshipClearance,
  resetRelationship,
  updateRelationshipPrefs,
  type RelationshipTransport,
} from "./relationship";

/** Build a transport that returns a fixed response and records all calls. */
function recorder(
  response: { ok: boolean; status: number; json: unknown },
): { transport: RelationshipTransport; calls: { method: string; path: string; body?: unknown }[] } {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const transport: RelationshipTransport = {
    request: async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return { ...response };
    },
  };
  return { transport, calls };
}

const RELATIONSHIP_JSON = {
  relationshipId: 42,
  personaRef: "gentle-listener",
  active: true,
  createdAt: "2026-08-13T01:00:00Z",
};

describe("createRelationship", () => {
  it("POSTs to /api/v1/relationships with personaRef body", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: RELATIONSHIP_JSON,
    });

    const result = await createRelationship(transport, "gentle-listener");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/v1/relationships");
    expect(calls[0].body).toEqual({ personaRef: "gentle-listener" });
    expect(result).toEqual({
      relationshipId: "42",
      personaRef: "gentle-listener",
      active: true,
      createdAt: "2026-08-13T01:00:00Z",
      ...DEFAULT_COMPANION_PREFS,
    });
  });

  it("normalises numeric relationshipId to string", async () => {
    const { transport } = recorder({
      ok: true,
      status: 200,
      json: { relationshipId: 777, personaRef: "p", active: false },
    });

    const result = await createRelationship(transport, "p");

    expect(result?.relationshipId).toBe("777");
  });

  it("returns null when the body fails to parse", async () => {
    const { transport } = recorder({ ok: true, status: 200, json: null });

    const result = await createRelationship(transport, "p");

    expect(result).toBeNull();
  });

  it("throws RelationshipHttpError on 401 (unauthorized)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 401,
      json: { code: "AUTH_REQUIRED", message: "no session" },
    });

    await expect(createRelationship(transport, "p")).rejects.toThrow(RelationshipHttpError);
  });

  it("throws RelationshipHttpError on 500 (server)", async () => {
    const { transport } = recorder({ ok: false, status: 503, json: null });

    await expect(createRelationship(transport, "p")).rejects.toThrow(RelationshipHttpError);
  });
});

describe("listRelationships", () => {
  it("GETs /api/v1/relationships and normalises numeric ids", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: [
        { relationshipId: 1, personaRef: "a", active: true },
        { relationshipId: 2, personaRef: "b", active: false },
      ],
    });

    const result = await listRelationships(transport);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toBe("/api/v1/relationships");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      relationshipId: "1",
      personaRef: "a",
      active: true,
      createdAt: undefined,
      ...DEFAULT_COMPANION_PREFS,
    });
    expect(result[1].active).toBe(false);
  });

  it("skips malformed entries without throwing", async () => {
    const { transport } = recorder({
      ok: true,
      status: 200,
      json: [
        { relationshipId: 1, personaRef: "a", active: true },
        { personaRef: "no-id" },
        "not-an-object",
      ],
    });

    const result = await listRelationships(transport);

    expect(result).toHaveLength(1);
    expect(result[0].relationshipId).toBe("1");
  });

  it("returns empty array on 404 (existence hidden, no throw)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    const result = await listRelationships(transport);

    expect(result).toEqual([]);
  });

  it("returns empty array on 403 (existence hidden, no throw)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 403,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    const result = await listRelationships(transport);

    expect(result).toEqual([]);
  });

  it("throws RelationshipHttpError on 401", async () => {
    const { transport } = recorder({ ok: false, status: 401, json: null });

    await expect(listRelationships(transport)).rejects.toThrow(RelationshipHttpError);
  });
});

describe("getRelationship", () => {
  it("GETs /api/v1/relationships/{id}", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: RELATIONSHIP_JSON,
    });

    const result = await getRelationship(transport, "42");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toBe("/api/v1/relationships/42");
    expect(result?.relationshipId).toBe("42");
  });

  it("returns null on 404 (existence hidden)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    const result = await getRelationship(transport, "999");

    expect(result).toBeNull();
  });

  it("throws on 500", async () => {
    const { transport } = recorder({ ok: false, status: 500, json: null });

    await expect(getRelationship(transport, "42")).rejects.toThrow(RelationshipHttpError);
  });
});

describe("activateRelationship", () => {
  it("POSTs to /api/v1/relationships/{id}", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { ...RELATIONSHIP_JSON, active: true },
    });

    const result = await activateRelationship(transport, "42");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/v1/relationships/42");
    expect(result?.active).toBe(true);
  });

  it("returns null on 404 (existence hidden)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    const result = await activateRelationship(transport, "999");

    expect(result).toBeNull();
  });

  it("throws on 401", async () => {
    const { transport } = recorder({ ok: false, status: 401, json: null });

    await expect(activateRelationship(transport, "42")).rejects.toThrow(RelationshipHttpError);
  });
});

describe("deactivateRelationship", () => {
  it("POSTs to /api/v1/relationships/{id}/deactivate", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { ...RELATIONSHIP_JSON, active: false },
    });

    const result = await deactivateRelationship(transport, "42");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/v1/relationships/42/deactivate");
    expect(result?.active).toBe(false);
  });

  it("returns null on 404 (existence hidden)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    const result = await deactivateRelationship(transport, "999");

    expect(result).toBeNull();
  });

  it("throws on 500", async () => {
    const { transport } = recorder({ ok: false, status: 500, json: null });

    await expect(deactivateRelationship(transport, "42")).rejects.toThrow(RelationshipHttpError);
  });
});

describe("updateRelationshipPrefs", () => {
  it("PATCHes /api/v1/relationships/{id} with the preference body", async () => {
    const prefs = {
      ...DEFAULT_COMPANION_PREFS,
      companionName: "小安",
      replyLength: "SHORT" as const,
      avoidTopics: ["WORK"] as const,
    };
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { ...RELATIONSHIP_JSON, ...prefs },
    });

    const result = await updateRelationshipPrefs(transport, "42", { ...prefs, avoidTopics: ["WORK"] });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].path).toBe("/api/v1/relationships/42");
    expect(result?.companionName).toBe("小安");
    expect(result?.replyLength).toBe("SHORT");
    expect(result?.avoidTopics).toEqual(["WORK"]);
  });

  it("returns null on 404 (existence hidden)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    const result = await updateRelationshipPrefs(transport, "999", DEFAULT_COMPANION_PREFS);

    expect(result).toBeNull();
  });

  it("throws on 400 (unapproved catalog code)", async () => {
    const { transport } = recorder({ ok: false, status: 400, json: null });

    await expect(updateRelationshipPrefs(transport, "42", DEFAULT_COMPANION_PREFS)).rejects.toThrow(
      RelationshipHttpError,
    );
  });
});

describe("previewRelationshipClearance", () => {
  it("GETs /api/v1/relationships/{id}/clearance-preview and normalises ids", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { relationshipId: 42, conversationCount: 2, memoryCount: 3, reminderCount: 1 },
    });

    const result = await previewRelationshipClearance(transport, "42");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toBe("/api/v1/relationships/42/clearance-preview");
    expect(result).toEqual({
      relationshipId: "42",
      conversationCount: 2,
      memoryCount: 3,
      reminderCount: 1,
    });
  });

  it("returns null on 404 (existence hidden)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    const result = await previewRelationshipClearance(transport, "999");

    expect(result).toBeNull();
  });

  it("throws on 500", async () => {
    const { transport } = recorder({ ok: false, status: 500, json: null });

    await expect(previewRelationshipClearance(transport, "42")).rejects.toThrow(RelationshipHttpError);
  });
});

describe("resetRelationship", () => {
  it("POSTs to /api/v1/relationships/{id}/reset", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: RELATIONSHIP_JSON,
    });

    const result = await resetRelationship(transport, "42");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/v1/relationships/42/reset");
    expect(result?.relationshipId).toBe("42");
  });

  it("returns null on 404 (existence hidden)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    const result = await resetRelationship(transport, "999");

    expect(result).toBeNull();
  });
});

describe("deleteRelationship", () => {
  it("DELETEs /api/v1/relationships/{id}", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { ok: true },
    });

    const result = await deleteRelationship(transport, "42");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].path).toBe("/api/v1/relationships/42");
    expect(result).toBe(true);
  });

  it("returns false on 404 (existence hidden)", async () => {
    const { transport } = recorder({
      ok: false,
      status: 404,
      json: { code: "NOT_FOUND_OR_FORBIDDEN", message: "hidden" },
    });

    const result = await deleteRelationship(transport, "999");

    expect(result).toBe(false);
  });

  it("throws on 401", async () => {
    const { transport } = recorder({ ok: false, status: 401, json: null });

    await expect(deleteRelationship(transport, "42")).rejects.toThrow(RelationshipHttpError);
  });
});
