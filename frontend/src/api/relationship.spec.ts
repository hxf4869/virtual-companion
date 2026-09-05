import { describe, expect, it, vi } from "vitest";

import {
  listRelationships,
  RelationshipHttpError,
  type RelationshipTransport,
} from "./relationship";

function transport(response: { ok: boolean; status: number; json: unknown }): RelationshipTransport {
  return { request: vi.fn(async () => response) };
}

describe("listRelationships", () => {
  it("reads the server-created relationship and normalizes its id", async () => {
    const client = transport({
      ok: true,
      status: 200,
      json: [{
        relationshipId: 42,
        personaRef: "gentle-listener",
        active: true,
        companionName: "林夏",
      }],
    });

    await expect(listRelationships(client)).resolves.toEqual([{
      relationshipId: "42",
      personaRef: "gentle-listener",
      active: true,
      createdAt: undefined,
      companionName: "林夏",
    }]);
    expect(client.request).toHaveBeenCalledWith("GET", "/api/v1/relationships");
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
