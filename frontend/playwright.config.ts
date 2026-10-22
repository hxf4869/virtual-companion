import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  httpBaseUrlProblem,
  parseE2EStackKind,
  tlsBaseUrl,
  tlsBaseUrlProblem,
} from "./e2e/helpers";

// S0-23: real-browser journeys against the local stack booted by
// scripts/dev/e2e-stack.sh (isolated Postgres + runtime + H5 dev server).
// This is an opt-in long check — never part of scripts/check.sh
// (docs/engineering/checks-principles.md R1/R3). Synthetic data only.
//
// VC-R79: E2E_STACK_KIND=tls switches the whole suite onto the TLS 真实栈
// (scripts/dev/e2e-tls-stack.sh：Caddy 自签 HTTPS + 生产 runtime/前端镜像，
// 默认 https://localhost:18457)。HTTP 模式（默认）行为与项目结构不变。

// DOGFOOD-09（ADR-0006 §1.4）：核心 journeys 保持单一 chromium 桌面引擎 +
// 手机尺寸视口不变；可访问性 journey（08）与副本下载 journey（13）额外以
// 真实设备仿真双引擎运行（iPhone 13 → webkit + isMobile + touch；
// Pixel 5 → chromium + isMobile + touch）。webServer 仍是单实例，
// workers: 1 串行防止种子状态竞争。
const DUAL_ENGINE_SPECS = /(?:08-accessibility|13-data-export-download)\.spec\.ts$/;

const STACK_KIND = parseE2EStackKind(process.env.E2E_STACK_KIND);
const TLS_PORT = process.env.E2E_TLS_PORT ?? "18457";
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
if (STACK_KIND === "tls") {
  // TLS 栈只跑 full 发布策略：synthetic-eval 仍仅属 HTTP 栈。
  if (RELEASE_MODE !== "full") {
    throw new Error(
      'TLS stack (E2E_STACK_KIND=tls) requires E2E_RELEASE_MODE="full"; synthetic-eval stays HTTP-only',
    );
  }
  // TLS 栈每次冷启动（前端 build + 镜像 build 都在 webServer 内完成），
  // 复用旧栈会绕过本轮收据链，禁止。
  if (process.env.E2E_REUSE_STACK === "1") {
    throw new Error(
      "TLS stack cannot reuse an existing server; E2E_REUSE_STACK is forbidden",
    );
  }
}
if (RELEASE_MODE === "full" && BASE_URL) {
  // Even full mode may only target a local loopback server; the TLS stack
  // additionally pins the URL to https on the E2E_TLS_PORT-derived port.
  const problem = STACK_KIND === "tls"
    ? tlsBaseUrlProblem(BASE_URL, TLS_PORT)
    : httpBaseUrlProblem(BASE_URL);
  if (problem) {
    throw new Error(problem);
  }
}
const STACK_STATE_FILE = process.env.E2E_STACK_STATE_FILE
  ?? join(tmpdir(), `vc-e2e-stack-${process.pid}.json`);
process.env.E2E_STACK_STATE_FILE = STACK_STATE_FILE;

const RESOLVED_BASE_URL = BASE_URL
  ?? (STACK_KIND === "tls" ? tlsBaseUrl(TLS_PORT) : `http://127.0.0.1:${PORT}`);

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
  webServer: STACK_KIND === "tls" ? {
    // TLS 真实栈启动器：exec bash 让 supervisor 即进程组长，
    // gracefulShutdown 向整组发 SIGTERM，启动器 trap 后同步执行有界收据
    // 清理（resources.py cleanup）。600s 覆盖前端 build 与镜像 build。
    command: "exec bash ../scripts/dev/e2e-tls-stack.sh",
    // 不设 url：Caddy up 后即对任意路径返回 200，而账号播种与 TLS 真实
    // 自证（curl --cacert + ALPN h2）在其后完成，url readiness 会提前放
    // 行 globalSetup。就绪以启动器打印的 STACK_READY 行为准；url 与
    // wait 并存时 Playwright 是 Promise.race（任一先成），故必须去掉 url。
    wait: { stdout: /STACK_READY kind=tls\b/ },
    reuseExistingServer: false,
    timeout: 600_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 120_000 },
    env: {
      E2E_STACK_STATE_FILE: STACK_STATE_FILE,
      E2E_STACK_KIND: "tls",
      E2E_RELEASE_MODE: RELEASE_MODE,
      E2E_TLS_PORT: TLS_PORT,
    },
  } : {
    // Replace Playwright's command shell with the supervisor so termination
    // reaches its EXIT trap (and therefore every child group + container).
    command: "exec bash ../scripts/dev/e2e-stack.sh",
    // A new run waits for its state and all process identities to settle.
    // Explicit reuse still checks the existing loopback server by URL.
    ...(RELEASE_MODE !== "synthetic-eval" && process.env.E2E_REUSE_STACK === "1"
      ? { url: RESOLVED_BASE_URL, reuseExistingServer: true }
      : { wait: { stdout: /STACK_READY\b/ }, reuseExistingServer: false }),
    timeout: 180_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 120_000 },
    env: {
      E2E_STACK_STATE_FILE: STACK_STATE_FILE,
      E2E_RELEASE_MODE: RELEASE_MODE,
    },
  },
  use: {
    baseURL: RESOLVED_BASE_URL,
    trace: "retain-on-failure",
    // TLS 模式：三项目（chromium/webkit-iphone/chromium-android）继承
    // context 级 ignoreHTTPSErrors（WebKit 亦支持），仅放行本轮 Caddy
    // local CA 合成栈；真实 TLS 校验由启动器 curl --cacert 完成。
    ...(STACK_KIND === "tls" ? { ignoreHTTPSErrors: true } : {}),
  },
  projects: [
    {
      name: "chromium",
      // 其余 journey 的行为原样保留：桌面 chromium + 手机尺寸视口
      // （08/13 仅由下方双引擎设备仿真项目运行）。
      testIgnore: DUAL_ENGINE_SPECS,
      use: {
        // Mobile-class viewport: the H5 is a phone-format product.
        viewport: { width: 390, height: 844 },
      },
    },
    {
      // iPhone Safari 近似（webkit 引擎 + isMobile + touch + iOS UA）。
      name: "webkit-iphone",
      testMatch: DUAL_ENGINE_SPECS,
      use: { ...devices["iPhone 13"] },
    },
    {
      // Android Chrome 近似（chromium 引擎 + isMobile + touch + Android UA）。
      name: "chromium-android",
      testMatch: DUAL_ENGINE_SPECS,
      use: { ...devices["Pixel 5"] },
    },
  ],
});
