// VIRT-SCROLL (§18.6): compute which rows a fixed-height scroller should
// mount. Heights may be estimated (uniform) or measured per index.

export const VIRTUAL_ESTIMATE_HEIGHT = 96;
export const VIRTUAL_VIEWPORT_HEIGHT = 640;
export const VIRTUAL_OVERSCAN = 4;

export interface VirtualWindowInput {
  count: number;
  scrollTop: number;
  viewportHeight: number;
  estimateHeight: number;
  overscan?: number;
  heights?: ReadonlyArray<number | undefined> | null;
}

export interface VirtualWindow {
  startIndex: number;
  endIndex: number;
  offsetTop: number;
  totalHeight: number;
}

type HeightTable = ReadonlyArray<number | undefined> | null | undefined;

function heightAt(index: number, estimateHeight: number, heights: HeightTable): number {
  const measured = heights?.[index];
  return measured !== undefined && measured > 0 ? measured : estimateHeight;
}

function offsetAt(index: number, estimateHeight: number, heights: HeightTable): number {
  if (!heights || heights.length === 0) {
    return index * estimateHeight;
  }
  let offset = 0;
  const limit = Math.min(index, heights.length);
  for (let i = 0; i < limit; i += 1) {
    offset += heightAt(i, estimateHeight, heights);
  }
  if (index > heights.length) {
    offset += (index - heights.length) * estimateHeight;
  }
  return offset;
}

export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const count = Math.max(0, Math.floor(input.count));
  const estimateHeight = Math.max(1, input.estimateHeight);
  const viewportHeight = Math.max(0, input.viewportHeight);
  const overscan = Math.max(0, Math.floor(input.overscan ?? 0));
  const scrollTop = Math.max(0, input.scrollTop);
  const heights = input.heights;

  const totalHeight = offsetAt(count, estimateHeight, heights);
  if (count === 0) {
    return { startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight: 0 };
  }

  const viewportBottom = scrollTop + viewportHeight;
  let startIndex = 0;
  while (startIndex < count && offsetAt(startIndex + 1, estimateHeight, heights) <= scrollTop) {
    startIndex += 1;
  }
  let endIndex = startIndex;
  while (endIndex < count && offsetAt(endIndex, estimateHeight, heights) < viewportBottom) {
    endIndex += 1;
  }
  if (endIndex === startIndex) {
    endIndex = Math.min(count, startIndex + 1);
  }

  startIndex = Math.max(0, startIndex - overscan);
  endIndex = Math.min(count, endIndex + overscan);

  return {
    startIndex,
    endIndex,
    offsetTop: offsetAt(startIndex, estimateHeight, heights),
    totalHeight,
  };
}
