import { describe, expect, it, vi } from "vitest";

import {
  listRelationships,
  prefsOfRelationship,
  RelationshipHttpError,
  RelationshipProtocolError,
  updateRelationshipPrefs,
  type Relationship,
  type RelationshipTransport,
} from "./relationship";

function transport(response: { ok: boolean; status: number; json: unknown; parseFailed?: boolean }): RelationshipTransport {
  return { request: vi.fn(async () => response) };
}

function fullRelationshipRow(): Record<string, unknown> {
  return {
    relationshipId: 42,
    personaRef: "gentle-listener",
    active: true,
    companionName: "林夏",
    userAddressAs: "小安",
    replyLength: "MEDIUM",
    initiative: "LOW",
    humor: "LIGHT",
    advicePref: "ASK_FIRST",
    remindersAllowed: true,
    memoryShareScope: "RELATIONSHIP",
    avoidTopics: ["WORK", "POLITICS"],
    gender: "NEUTRAL",
    avatarRef: "AVATAR_NEUTRAL_01",
  };
}

describe("listRelationships", () => {
  it("reads the server-created relationship and normalizes its id", async () => {
    const client = transport({ ok: true, status: 200, json: [fullRelationshipRow()] });

    await expect(listRelationships(client)).resolves.toEqual([{
      relationshipId: "42",
      personaRef: "gentle-listener",
      active: true,
      createdAt: undefined,
      companionName: "林夏",
      userAddressAs: "小安",
      replyLength: "MEDIUM",
      initiative: "LOW",
      humor: "LIGHT",
      advicePref: "ASK_FIRST",
      remindersAllowed: true,
      memoryShareScope: "RELATIONSHIP",
      avoidTopics: ["WORK", "POLITICS"],
      gender: "NEUTRAL",
      avatarRef: "AVATAR_NEUTRAL_01",
    }]);
    expect(client.request).toHaveBeenCalledWith(
      "GET",
      "/api/v1/relationships",
      undefined,
      { timeoutMs: 15_000 },
    );
  });

  it("skips malformed rows and hides 403/404 existence", async () => {
    await expect(listRelationships(transport({
      ok: true,
      status: 200,
      json: [{ personaRef: "missing-id" }, null],
    }))).resolves.toEqual([]);
    await expect(listRelationships(transport({ ok: false, status: 404, json: null })))
      .resolves.toEqual([]);
  });

  it("keeps authentication and service failures distinct from an empty list", async () => {
    await expect(listRelationships(transport({ ok: false, status: 401, json: null })))
      .rejects.toBeInstanceOf(RelationshipHttpError);
    await expect(listRelationships(transport({ ok: false, status: 503, json: null })))
      .rejects.toMatchObject({ kind: "server" });
  });
});

describe("prefsOfRelationship", () => {
  it("builds a complete prefs model from a fully populated relationship", () => {
    const row = fullRelationshipRow() as unknown as Relationship;
    expect(prefsOfRelationship(row)).toEqual({
      companionName: "林夏",
      userAddressAs: "小安",
      replyLength: "MEDIUM",
      initiative: "LOW",
      humor: "LIGHT",
      advicePref: "ASK_FIRST",
      remindersAllowed: true,
      memoryShareScope: "RELATIONSHIP",
      avoidTopics: ["WORK", "POLITICS"],
      gender: "NEUTRAL",
      avatarRef: "AVATAR_NEUTRAL_01",
    });
  });

  it("returns null when structured fields are missing", () => {
    expect(prefsOfRelationship({
      relationshipId: "42",
      personaRef: "gentle-listener",
      active: true,
    })).toBeNull();
  });

  it("treats unknown catalog values as absent so the prefs model stays null", async () => {
    const client = transport({
      ok: true,
      status: 200,
      json: [{ ...fullRelationshipRow(), replyLength: "NOT_A_LENGTH" }],
    });
    const [relationship] = await listRelationships(client);
    expect(relationship?.replyLength).toBeUndefined();
    expect(prefsOfRelationship(relationship as Relationship)).toBeNull();
  });
});

describe("updateRelationshipPrefs", () => {
  const prefs = prefsOfRelationship(fullRelationshipRow() as unknown as Relationship)!;

  it("patch-sends the full replacement body and returns the server-read baseline", async () => {
    const client = transport({ ok: true, status: 200, json: fullRelationshipRow() });

    const updated = await updateRelationshipPrefs(client, "42", prefs);
    expect(updated.relationshipId).toBe("42");
    expect(client.request).toHaveBeenCalledWith(
      "PATCH",
      "/api/v1/relationships/42",
      {
        companionName: "林夏",
        userAddressAs: "小安",
        replyLength: "MEDIUM",
        initiative: "LOW",
        humor: "LIGHT",
        advicePref: "ASK_FIRST",
        remindersAllowed: true,
        memoryShareScope: "RELATIONSHIP",
        avoidTopics: ["WORK", "POLITICS"],
        gender: "NEUTRAL",
        avatarRef: "AVATAR_NEUTRAL_01",
      },
      { timeoutMs: 15_000 },
    );
  });

  it("sends null names and empty topics as explicit clears", async () => {
    const client = transport({ ok: true, status: 200, json: {
      ...fullRelationshipRow(),
      companionName: null,
      userAddressAs: null,
      avoidTopics: [],
    } });
    await updateRelationshipPrefs(client, "42", { ...prefs, companionName: null, userAddressAs: null, avoidTopics: [] });
    const body = vi.mocked(client.request).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(body.companionName).toBeNull();
    expect(body.userAddressAs).toBeNull();
    expect(body.avoidTopics).toEqual([]);
  });

  it("keeps http failures distinct from protocol failures", async () => {
    await expect(updateRelationshipPrefs(
      transport({ ok: false, status: 400, json: { code: "INVALID_REQUEST" } }),
      "42",
      prefs,
    )).rejects.toMatchObject({ kind: "client" });
    await expect(updateRelationshipPrefs(
      transport({ ok: true, status: 200, json: "not-an-object", parseFailed: true }),
      "42",
      prefs,
    )).rejects.toBeInstanceOf(RelationshipProtocolError);
    await expect(updateRelationshipPrefs(
      transport({ ok: true, status: 200, json: { personaRef: "gentle-listener" } }),
      "42",
      prefs,
    )).rejects.toBeInstanceOf(RelationshipProtocolError);
  });
});
