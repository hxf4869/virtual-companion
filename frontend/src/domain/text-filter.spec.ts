import { describe, expect, it } from "vitest";

import { matchesLooseText } from "./text-filter";

describe("matchesLooseText", () => {
  it("keeps every row when the query is blank", () => {
    expect(matchesLooseText("夜聊", "  ")).toBe(true);
  });

  it("matches case-insensitively against the haystack", () => {
    expect(matchesLooseText("周二夜聊", "夜聊")).toBe(true);
    expect(matchesLooseText("周二夜聊", "周三")).toBe(false);
  });
});
