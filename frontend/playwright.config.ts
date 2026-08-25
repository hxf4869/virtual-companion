import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// S0-23: real-browser journeys against the local stack booted by
// scripts/dev/e2e-stack.sh (isolated Postgres + runtime + H5 dev server).
// This is an opt-in long check — never part of scripts/check.sh
// (docs/engineering/checks-principles.md R1/R3). Synthetic data only.

// DOGFOOD-09（ADR-0006 §1.4）：核心 journeys 保持单一 chromium 桌面引擎 +
// 手机尺寸视口不变；可访问性 journey（08）额外以真实设备仿真双引擎运行
// （iPhone 13 → webkit + isMobile + touch；Pixel 5 → chromium + isMobile +
// touch）。webServer 仍是单实例，workers: 1 串行防止种子状态竞争。
const ACCESSIBILITY_SPEC = /08-accessibility\.spec\.ts$/;

const PORT = process.env.E2E_H5_PORT ?? "5173";
const RELEASE_MODE = process.env.E2E_RELEASE_MODE ?? "full";
const BASE_URL = process.env.E2E_BASE_URL;
if (RELEASE_MODE !== "full" && RELEASE_MODE !== "synthetic-eval") {
  throw new Error("E2E_RELEASE_MODE must be full or synthetic-eval");
}
if (RELEASE_MODE === "synthetic-eval"
    && (process.env.E2E_REUSE_STACK === "1" || BASE_URL)) {
  throw new Error(
    "synthetic eval must start its own loopback stack; E2E_REUSE_STACK and E2E_BASE_URL are forbidden",
  );
}
if (RELEASE_MODE === "full" && BASE_URL) {
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(BASE_URL);
  } catch {
    throw new Error("full E2E_BASE_URL must be a loopback HTTP URL");
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (parsedBaseUrl.protocol !== "http:"
      || !loopbackHosts.has(parsedBaseUrl.hostname)
      || parsedBaseUrl.username !== ""
      || parsedBaseUrl.password !== "") {
    throw new Error("full E2E_BASE_URL must be a loopback HTTP URL");
  }
}
const STACK_STATE_FILE = process.env.E2E_STACK_STATE_FILE
  ?? join(tmpdir(), `vc-e2e-stack-${process.pid}.json`);
process.env.E2E_STACK_STATE_FILE = STACK_STATE_FILE;

export default defineConfig({
  testDir: "./e2e/journeys",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // One shared local stack; parallel workers would race seeded state.
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  webServer: {
    // Replace Playwright's command shell with the supervisor so termination
    // reaches its EXIT trap (and therefore every child group + container).
    command: "exec bash ../scripts/dev/e2e-stack.sh",
    // Even full mode may only target a local loopback server.
    url: BASE_URL ?? `http://127.0.0.1:${PORT}`,
    timeout: 180_000,
    reuseExistingServer:
      RELEASE_MODE !== "synthetic-eval" && process.env.E2E_REUSE_STACK === "1",
    env: {
      E2E_STACK_STATE_FILE: STACK_STATE_FILE,
      E2E_RELEASE_MODE: RELEASE_MODE,
    },
  },
  use: {
    baseURL: BASE_URL ?? `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // 现有 7 个 journey 的行为原样保留：桌面 chromium + 手机尺寸视口。
      testIgnore: ACCESSIBILITY_SPEC,
      use: {
        // Mobile-class viewport: the H5 is a phone-format product.
        viewport: { width: 390, height: 844 },
      },
    },
    {
      // iPhone Safari 近似（webkit 引擎 + isMobile + touch + iOS UA）。
      name: "webkit-iphone",
      testMatch: ACCESSIBILITY_SPEC,
      use: { ...devices["iPhone 13"] },
    },
    {
      // Android Chrome 近似（chromium 引擎 + isMobile + touch + Android UA）。
      name: "chromium-android",
      testMatch: ACCESSIBILITY_SPEC,
      use: { ...devices["Pixel 5"] },
    },
  ],
});
