import { describe, expect, it } from "vitest";

import { publicAgeMethodLabel } from "./public-age-display";

describe("publicAgeMethodLabel", () => {
  it("maps simulated provider refs to a friendly method and never returns the raw ref", () => {
    expect(publicAgeMethodLabel("alpha-simulated")).toBe("模拟核验");
    expect(publicAgeMethodLabel("vendor-prod-xyz")).toBe("已通过成年核验渠道");
    expect(publicAgeMethodLabel(null)).toBeNull();
    expect(publicAgeMethodLabel("alpha-simulated")).not.toContain("alpha-simulated");
  });
});
