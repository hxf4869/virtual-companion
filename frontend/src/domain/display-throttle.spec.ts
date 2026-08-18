import { describe, expect, it } from "vitest";

import { createDisplayThrottle } from "./display-throttle";

describe("createDisplayThrottle", () => {
  it("publishes the first update immediately", () => {
    const t = createDisplayThrottle(50, () => 1000);
    expect(t.push("A")).toBe("A");
  });

  it("holds updates inside the interval and flushes the latest", () => {
    let now = 1000;
    const t = createDisplayThrottle(50, () => now);
    expect(t.push("A")).toBe("A");
    expect(t.push("AB")).toBeNull();
    expect(t.push("ABC")).toBeNull();
    now = 1049;
    expect(t.flush()).toBeNull();
    now = 1050;
    expect(t.flush()).toBe("ABC");
  });

  it("publishes immediately once the interval has elapsed", () => {
    let now = 1000;
    const t = createDisplayThrottle(50, () => now);
    expect(t.push("A")).toBe("A");
    now = 1060;
    expect(t.push("B")).toBe("B");
  });
});
