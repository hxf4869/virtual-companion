import { describe, expect, it } from "vitest";

import {
  buildContextHref,
  parseContextQuery,
  readContextFromLocation,
  sanitizeRelationshipId,
} from "./context-href";

describe("current chat context links", () => {
  it("builds chat and conversation-list links with supported ids only", () => {
    expect(buildContextHref("chat", { relationshipId: "7", conversationId: "11" }))
      .toBe("/pages/chat/chat?relationshipId=7&conversationId=11");
    expect(buildContextHref("conversations", { relationshipId: "7", conversationId: "11" }))
      .toBe("/pages/conversations/conversations?relationshipId=7");
  });

  it("rejects relationship ids outside the known account set", () => {
    expect(sanitizeRelationshipId("7", ["8"])).toBeNull();
    expect(buildContextHref("chat", {
      relationshipId: "7",
      knownRelationshipIds: ["8"],
      conversationId: "11",
    })).toBe("/pages/chat/chat?conversationId=11");
  });

  it("reads hash-router query before the browser search string", () => {
    expect(readContextFromLocation({
      pathname: "/",
      search: "?relationshipId=old",
      hash: "#/pages/chat/chat?relationshipId=7&conversationId=11",
    })).toEqual({ relationshipId: "7", conversationId: "11" });
  });

  it("normalizes blank ids to null", () => {
    expect(parseContextQuery("?relationshipId=%20&conversationId=")).toEqual({
      relationshipId: null,
      conversationId: null,
    });
  });
});
