import { describe, expect, it } from "vitest";

import {
  formatConversationActivity,
  formatLocalDateTime,
  formatTimestamp,
} from "./timestamp";

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

describe("formatLocalDateTime", () => {
  it("renders the instant in the local timezone, not a raw ISO string", () => {
    const iso = "2026-08-18T01:00:00Z";
    const expected = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(formatLocalDateTime(iso)).toBe(
      `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())} ` +
        `${pad(expected.getHours())}:${pad(expected.getMinutes())}`,
    );
    expect(formatLocalDateTime(iso)).not.toContain("T");
    expect(formatLocalDateTime(iso)).not.toContain("Z");
  });

  it("matches the local YYYY-MM-DD HH:mm shape", () => {
    expect(formatLocalDateTime("2026-08-18T01:00:00Z")).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
  });

  it("returns empty for a missing value and keeps non-dates as-is", () => {
    expect(formatLocalDateTime(undefined)).toBe("");
    expect(formatLocalDateTime("not-a-date")).toBe("not-a-date");
  });
});

describe("formatConversationActivity", () => {
  const now = new Date(2026, 8, 1, 12, 0).getTime();

  it("uses time for today and a natural label for yesterday", () => {
    expect(formatConversationActivity(new Date(2026, 8, 1, 9, 7).toISOString(), now))
      .toBe("09:07");
    expect(formatConversationActivity(new Date(2026, 7, 31, 22, 18).toISOString(), now))
      .toBe("昨天 22:18");
  });

  it("uses a compact calendar date for older activity", () => {
    expect(formatConversationActivity(new Date(2026, 7, 29, 8, 0).toISOString(), now))
      .toBe("8 月 29 日");
    expect(formatConversationActivity(new Date(2025, 11, 30, 8, 0).toISOString(), now))
      .toBe("2025 年 12 月 30 日");
  });

  it("keeps missing or malformed values out of the interface", () => {
    expect(formatConversationActivity(undefined, now)).toBe("");
    expect(formatConversationActivity("not-a-date", now)).toBe("");
  });
});
