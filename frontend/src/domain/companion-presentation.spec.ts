import { describe, expect, it } from "vitest";

import { companionHeaderName } from "./companion-presentation";

describe("companionHeaderName", () => {
  it("uses the public name and never falls back to a persona template", () => {
    expect(companionHeaderName({ companionName: " 林夏 " })).toBe("林夏");
    expect(companionHeaderName({ companionName: null })).toBe("陪伴者");
  });
});
