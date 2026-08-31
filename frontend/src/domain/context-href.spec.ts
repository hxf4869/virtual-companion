import { describe, expect, it } from "vitest";

import {
  buildContextHref,
  parseContextQuery,
  readContextFromLocation,
  sanitizeRelationshipId,
} from "./context-href";

describe("sanitizeRelationshipId", () => {
  it("drops blank and unknown ids so a stale selection cannot be reused", () => {
    expect(sanitizeRelationshipId("  ")).toBeNull();
    expect(sanitizeRelationshipId("gone", ["7"])).toBeNull();
    expect(sanitizeRelationshipId("7", ["7", "8"])).toBe("7");
    expect(sanitizeRelationshipId("7")).toBe("7");
    expect(sanitizeRelationshipId("7", [])).toBeNull();
  });
});

describe("buildContextHref", () => {
  it("carries relationship and conversation, preferring the conversation's own relationship", () => {
    expect(
      buildContextHref("chat", {
        relationshipId: "7",
        conversationId: "11",
        knownRelationshipIds: ["7"],
      }),
    ).toBe("/pages/chat/chat?relationshipId=7&conversationId=11");
    expect(
      buildContextHref("memory", { relationshipId: "7", knownRelationshipIds: ["7"] }),
    ).toBe("/pages/memory/memory?relationshipId=7");
    expect(
      buildContextHref("companion", { relationshipId: "7", knownRelationshipIds: ["7"] }),
    ).toBe("/pages/companion/companion?relationshipId=7");
    expect(
      buildContextHref("memory-detail", {
        relationshipId: "7",
        memoryId: "3",
        knownRelationshipIds: ["7"],
      }),
    ).toBe("/pages/memory-detail/memory-detail?relationshipId=7&memoryId=3");
  });

  it("omits a relationship id that is no longer in the known set", () => {
    expect(
      buildContextHref("chat", {
        relationshipId: "stale",
        conversationId: "11",
        knownRelationshipIds: ["7"],
      }),
    ).toBe("/pages/chat/chat?conversationId=11");
  });
});

describe("parseContextQuery / readContextFromLocation", () => {
  it("reads hash-mode and search-mode query strings", () => {
    expect(parseContextQuery("/pages/chat/chat?relationshipId=7&conversationId=11")).toEqual({
      relationshipId: "7",
      conversationId: "11",
      memoryId: null,
      messageId: null,
    });
    expect(
      readContextFromLocation({
        pathname: "/",
        search: "",
        hash: "#/pages/memory/memory?relationshipId=4",
      }).relationshipId,
    ).toBe("4");
    expect(
      readContextFromLocation({ search: "?relationshipId=1&conversationId=9" }).conversationId,
    ).toBe("9");
  });
});
