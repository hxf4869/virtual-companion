import { describe, expect, it } from "vitest";

import { computeVirtualWindow } from "./virtual-list-window";

describe("computeVirtualWindow", () => {
  it("returns an empty window for no items", () => {
    expect(
      computeVirtualWindow({
        count: 0,
        scrollTop: 0,
        viewportHeight: 640,
        estimateHeight: 96,
      }),
    ).toEqual({
      startIndex: 0,
      endIndex: 0,
      offsetTop: 0,
      totalHeight: 0,
    });
  });

  it("shows every row when the list fits the viewport", () => {
    const win = computeVirtualWindow({
      count: 3,
      scrollTop: 0,
      viewportHeight: 640,
      estimateHeight: 96,
    });
    expect(win.startIndex).toBe(0);
    expect(win.endIndex).toBe(3);
    expect(win.offsetTop).toBe(0);
    expect(win.totalHeight).toBe(288);
  });

  it("windows a long list to the visible slice plus overscan", () => {
    const win = computeVirtualWindow({
      count: 250,
      scrollTop: 0,
      viewportHeight: 640,
      estimateHeight: 96,
      overscan: 4,
    });
    // 640/96 ≈ 6.6 visible rows; overscan 4 on each side, clamped at 0.
    expect(win.startIndex).toBe(0);
    expect(win.endIndex).toBeLessThan(250);
    expect(win.endIndex).toBe(11); // 7 visible + 4 trailing overscan
    expect(win.totalHeight).toBe(250 * 96);
    expect(win.offsetTop).toBe(0);
  });

  it("moves the window when scrolled into the middle", () => {
    const win = computeVirtualWindow({
      count: 250,
      scrollTop: 96 * 40,
      viewportHeight: 640,
      estimateHeight: 96,
      overscan: 2,
    });
    expect(win.startIndex).toBe(38); // 40 - 2 overscan
    expect(win.endIndex).toBe(49); // 40 + 7 visible + 2 overscan
    expect(win.offsetTop).toBe(38 * 96);
  });

  it("clamps the last window to the list tail", () => {
    const win = computeVirtualWindow({
      count: 20,
      scrollTop: 96 * 18,
      viewportHeight: 640,
      estimateHeight: 96,
      overscan: 2,
    });
    expect(win.endIndex).toBe(20);
    expect(win.startIndex).toBeGreaterThanOrEqual(0);
    expect(win.startIndex).toBeLessThan(20);
  });

  it("uses measured heights when provided", () => {
    const heights = [40, 80, 120, 200, 40];
    const win = computeVirtualWindow({
      count: 5,
      scrollTop: 40 + 80,
      viewportHeight: 120,
      estimateHeight: 96,
      overscan: 0,
      heights,
    });
    expect(win.totalHeight).toBe(480);
    expect(win.startIndex).toBe(2);
    expect(win.endIndex).toBe(3);
    expect(win.offsetTop).toBe(120);
  });
});
