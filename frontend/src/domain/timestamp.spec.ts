import { describe, expect, it } from "vitest";

import { formatTimestamp } from "./timestamp";

describe("formatTimestamp", () => {
  it("keeps the calendar day of an ISO instant", () => {
    expect(formatTimestamp("2026-08-19T12:00:00Z")).toContain("2026-08-19");
  });

  it("returns empty when the value is missing", () => {
    expect(formatTimestamp(undefined)).toBe("");
  });

  it("returns the original string when it is not a date", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
  });
});
