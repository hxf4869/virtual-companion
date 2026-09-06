import { describe, expect, it } from "vitest";

import {
  ADVICE_PREF_OPTIONS,
  AVOID_TOPIC_OPTIONS,
  HUMOR_OPTIONS,
  INITIATIVE_OPTIONS,
  REPLY_LENGTH_OPTIONS,
  labelOf,
} from "./prefs-options";

describe("companion preference options", () => {
  it("covers every backend catalog code with a distinct readable label", () => {
    expect(REPLY_LENGTH_OPTIONS.map((option) => option.value)).toEqual(["SHORT", "MEDIUM", "LONG"]);
    expect(INITIATIVE_OPTIONS.map((option) => option.value)).toEqual(["LOW", "MEDIUM", "HIGH"]);
    expect(ADVICE_PREF_OPTIONS.map((option) => option.value)).toEqual(["ASK_FIRST", "DIRECT", "RARE"]);
    expect(HUMOR_OPTIONS.map((option) => option.value)).toEqual(["NONE", "LIGHT", "WARM"]);
    expect(AVOID_TOPIC_OPTIONS.map((option) => option.value)).toEqual([
      "WORK",
      "FAMILY",
      "HEALTH",
      "ROMANCE",
      "MONEY",
      "POLITICS",
      "SUBSTANCE",
      "RELIGION",
    ]);

    const allLabels = [
      ...REPLY_LENGTH_OPTIONS,
      ...INITIATIVE_OPTIONS,
      ...ADVICE_PREF_OPTIONS,
      ...HUMOR_OPTIONS,
      ...AVOID_TOPIC_OPTIONS,
    ].map((option) => option.label);
    expect(new Set(allLabels).size).toBe(allLabels.length);
    for (const label of allLabels) {
      expect(label).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it("maps a value to its label and falls back to the raw value", () => {
    expect(labelOf(REPLY_LENGTH_OPTIONS, "SHORT")).toBe("简短一些");
    expect(labelOf(REPLY_LENGTH_OPTIONS, "MEDIUM" as never)).toBe("长短适中");
  });
});
