// VC-R79：E2E TLS 真实栈模式的前端侧纯逻辑单测（栈模式解析、BASE_URL
// 派生、独立 request context 的自签放行决策、loopback 校验、version 3
// state 严格校验）与 teardown 生命周期 mock 回归（进程所有权、收据兜底、
// 本地文件生命周期）。可测逻辑直接 import ../e2e/ 的导出，不复制实现。
import { spawnSync } from "node:child_process";
import { unlink } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  httpBaseUrlProblem,
  parseE2EStackKind,
  resolveE2EApiBaseUrl,
  standaloneRequestOptions,
  tlsBaseUrlProblem,
} from "../e2e/helpers";
import {
  parseTlsStackState,
  teardownTlsStack,
  type TlsStackState,
} from "../e2e/global-teardown";

// 生命周期回归需要 mock 子进程/文件系统；纯函数部分不触碰它们。
vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(), realpath: vi.fn(),
  rename: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
}));

const LSTART = "Thu Oct 23 04:00:00 2026";

/** 启动器 write_state（version 3 契约）的一个最小合法样例。 */
function tlsStateFixture(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 3,
    stackKind: "tls",
    supervisorPid: 4242,
    supervisorStartedAt: LSTART,
    runDir: "/tmp/vc-e2e-tls.XXXXXX",
    nonce: "0123456789abcdef0123456789abcdef",
    project: "vce2etls-20261023",
    httpsPort: 18457,
    domain: "localhost",
    dockerContext: "orbstack",
    keep: false,
    creating: true,
    started: true,
    releaseMode: "full",
    releasePolicyVersion: "e2e-synthetic-v1",
    containers: { db: "cid-db", runtime: "cid-runtime", caddy: "cid-caddy", provider: null },
    providerLogPath: "/tmp/vc-e2e-provider-requests-19090.log",
    receipts: {
      capture: "/run/created-resources.json",
      built: "/run/built-images.json",
      compose: "/run/stack.compose.json",
      leftoversOut: "/run/cleanup.leftovers.json",
      collectors: "/run/collectors.json",
      resourcesPy: "/repo/scripts/measure/g12-go-capacity/resources.py",
    },
    caCert: "/run/caddy-local-ca.crt",
    ...overrides,
  });
}

function makeTlsState(overrides: Record<string, unknown> = {}): TlsStackState {
  return parseTlsStackState(tlsStateFixture(overrides));
}

describe("VC-R79 E2E 栈模式与 BASE_URL 派生", () => {
  it("E2E_STACK_KIND 未设置默认 http，仅接受 http/tls，其它值报错", () => {
    expect(parseE2EStackKind(undefined)).toBe("http");
    expect(parseE2EStackKind("tls")).toBe("tls");
    expect(parseE2EStackKind("http")).toBe("http");
    expect(() => parseE2EStackKind("h2")).toThrow(/E2E_STACK_KIND/);
    expect(() => parseE2EStackKind("")).toThrow(/E2E_STACK_KIND/);
  });

  it("BASE_URL 派生：显式值优先，其次 TLS https（默认 18457）或 H5 http", () => {
    expect(resolveE2EApiBaseUrl({ E2E_BASE_URL: "https://localhost:18457" }))
      .toBe("https://localhost:18457");
    expect(resolveE2EApiBaseUrl({ E2E_STACK_KIND: "tls" })).toBe("https://localhost:18457");
    expect(resolveE2EApiBaseUrl({ E2E_STACK_KIND: "tls", E2E_TLS_PORT: "18999" }))
      .toBe("https://localhost:18999");
    expect(resolveE2EApiBaseUrl({ E2E_STACK_KIND: "http", E2E_H5_PORT: "5273" }))
      .toBe("http://127.0.0.1:5273");
    expect(resolveE2EApiBaseUrl({})).toBe("http://127.0.0.1:5173");
  });

  it("独立 request context 仅在 TLS 模式放行自签证书", () => {
    expect(standaloneRequestOptions("http")).toStrictEqual({});
    expect(standaloneRequestOptions("tls")).toStrictEqual({ ignoreHTTPSErrors: true });
  });
});

describe("VC-R79 E2E_BASE_URL loopback 校验", () => {
  it("HTTP 栈沿用既有语义：仅 loopback http 合法", () => {
    expect(httpBaseUrlProblem("http://127.0.0.1:5173")).toBeNull();
    expect(httpBaseUrlProblem("http://localhost:5173")).toBeNull();
    expect(httpBaseUrlProblem("https://127.0.0.1:5173"))
      .toBe("full E2E_BASE_URL must be a loopback HTTP URL");
    expect(httpBaseUrlProblem("http://example.com:5173"))
      .toBe("full E2E_BASE_URL must be a loopback HTTP URL");
  });

  it("TLS 栈只接受恰为 localhost 的 https，且 origin 与派生栈一致", () => {
    expect(tlsBaseUrlProblem("https://localhost:18457", "18457")).toBeNull();
    // 夹具只服务/allowlist localhost：127.0.0.1 与 [::1] 会被拒。
    expect(tlsBaseUrlProblem("https://127.0.0.1:18457", "18457"))
      .toMatch(/exactly localhost/);
    expect(tlsBaseUrlProblem("https://[::1]:18457", "18457")).toMatch(/exactly localhost/);
    expect(tlsBaseUrlProblem("http://localhost:18457", "18457")).toMatch(/must be https/);
    expect(tlsBaseUrlProblem("https://example.com:18457", "18457"))
      .toMatch(/exactly localhost/);
    expect(tlsBaseUrlProblem("https://user@localhost:18457", "18457")).toMatch(/userinfo/);
    // 端口比较走规范 origin：错端口拒绝，https 默认 443 与 E2E_TLS_PORT=443 等价。
    expect(tlsBaseUrlProblem("https://localhost:18458", "18457")).toMatch(/stack origin/);
    expect(tlsBaseUrlProblem("https://localhost", "18457")).toMatch(/stack origin/);
    expect(tlsBaseUrlProblem("https://localhost:443", "443")).toBeNull();
  });
});

describe("VC-R79 TLS stack state（version 3）严格校验", () => {
  it("契约样例完整解析，containers 允许 null", () => {
    const state = makeTlsState();
    expect(state.version).toBe(3);
    expect(state.supervisorPid).toBe(4242);
    expect(state.supervisorStartedAt).toBe(LSTART);
    expect(state.containers).toStrictEqual({
      db: "cid-db",
      runtime: "cid-runtime",
      caddy: "cid-caddy",
      provider: null,
    });
    expect(state.receipts.resourcesPy).toContain("resources.py");
  });

  it("坏 version、containers 缺键、nonce 非 hex、坏 PID、空 receipt 必须失败", () => {
    expect(() => parseTlsStackState(tlsStateFixture({ version: 2 }))).toThrow(/version/);
    expect(() => parseTlsStackState(tlsStateFixture({ stackKind: "http" }))).toThrow(/version/);
    expect(() => parseTlsStackState(tlsStateFixture({
      containers: { db: "cid-db", runtime: "cid-runtime", caddy: "cid-caddy" },
    }))).toThrow(/provider container/);
    expect(() => parseTlsStackState(tlsStateFixture({ nonce: "not-hex-nonce" })))
      .toThrow(/nonce/);
    expect(() => parseTlsStackState(tlsStateFixture({ supervisorPid: 0 })))
      .toThrow(/supervisor PID/);
    expect(() => parseTlsStackState(tlsStateFixture({ supervisorStartedAt: "" })))
      .toThrow(/supervisor start time/);
    expect(() => parseTlsStackState(tlsStateFixture({
      receipts: {
        capture: "/run/created-resources.json",
        built: "/run/built-images.json",
        compose: "",
        leftoversOut: "/run/cleanup.leftovers.json",
        collectors: "/run/collectors.json",
        resourcesPy: "/repo/scripts/measure/g12-go-capacity/resources.py",
      },
    }))).toThrow(/compose receipt/);
    expect(() => parseTlsStackState(tlsStateFixture({ keep: "no" })))
      .toThrow(/keep\/creating\/started/);
    expect(() => parseTlsStackState(tlsStateFixture({ httpsPort: 18457.5 })))
      .toThrow(/https port/);
    expect(() => parseTlsStackState(tlsStateFixture({ dockerContext: "default" })))
      .toThrow(/orbstack/);
  });
});

// —— teardown 生命周期 mock 回归：只测真实路径，不测 schema ——
// spawnSync 扮演 ps（lstart）与 python3（resources.py 清理引擎）；process.kill
// 扮演进程表；unlink 记录被删除的本地文件。
type FakeSpawnResult = { status: number; stdout: string; stderr: string };

const STATE_FILE = "/tmp/vc-e2e-stack-4242.json";
const SESSION_FILES = [
  `${STATE_FILE}.auth.json`,
  `${STATE_FILE}.shared-chat.json`,
  `${STATE_FILE}.shared-memory.json`,
  `${STATE_FILE}.shared-admin.json`,
];

function makeHarness() {
  const state = makeTlsState();
  const engineCalls: string[][] = [];
  const deletedFiles: string[] = [];

  function install(options: { lstart?: string | null; engineStatus?: number } = {}): void {
    const { lstart = LSTART, engineStatus = 0 } = options;
    const spawnSyncMock = spawnSync as unknown as {
      mockImplementation(impl: (command: string, args: string[]) => FakeSpawnResult): void;
    };
    spawnSyncMock.mockImplementation((command, args) => {
      if (command === "ps") {
        return lstart === null
          ? { status: 1, stdout: "", stderr: "no such process" }
          : { status: 0, stdout: lstart, stderr: "" };
      }
      if (command === "python3") {
        engineCalls.push(args);
        return {
          status: engineStatus,
          stdout: "",
          stderr: engineStatus === 0 ? "" : "cleanup leftover",
        };
      }
      return { status: 1, stdout: "", stderr: "" };
    });
  }

  function mockProcess(exitsAfterTerm: boolean) {
    let alive = true;
    return vi.spyOn(process, "kill").mockImplementation(((target: number, signal?:
      number | NodeJS.Signals) => {
      void target;
      if (!alive) {
        throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" }) as NodeJS.ErrnoException;
      }
      if (signal === "SIGTERM" && exitsAfterTerm) {
        alive = false;
      }
    }) as unknown as typeof process.kill);
  }

  const unlinkMock = unlink as unknown as {
    mockImplementation(impl: (path: string) => Promise<void>): void;
  };
  unlinkMock.mockImplementation(async (path: string) => {
    deletedFiles.push(path);
  });

  return { state, stateFile: STATE_FILE, sessionFiles: SESSION_FILES, engineCalls, deletedFiles, install, mockProcess };
}

describe("VC-R79 TLS teardown 生命周期（mock 进程/引擎/文件系统）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("(i) 身份匹配→SIGTERM→引擎 rc0→五个本地文件全删", async () => {
    const h = makeHarness();
    h.install({ engineStatus: 0 });
    const killSpy = h.mockProcess(true);
    await teardownTlsStack(h.state, h.stateFile);
    expect(killSpy).toHaveBeenCalledWith(h.state.supervisorPid, "SIGTERM");
    expect(h.engineCalls.length).toBe(1);
    const engineArgs = h.engineCalls[0];
    expect(engineArgs).toEqual(expect.arrayContaining([
      h.state.receipts.resourcesPy,
      "cleanup",
      "--capture", h.state.receipts.capture,
      "--built", h.state.receipts.built,
      "--collectors", h.state.receipts.collectors,
      "--leftovers-out", h.state.receipts.leftoversOut,
      "--project", h.state.project,
      "--deadline-seconds", "90",
    ]));
    expect([...h.deletedFiles].sort())
      .toStrictEqual([h.stateFile, ...h.sessionFiles].sort());
  });

  it("(ii) 引擎 rc≠0：抛错、auth/shared 已删、state 文件保留", async () => {
    const h = makeHarness();
    h.install({ engineStatus: 1 });
    h.mockProcess(true);
    await expect(teardownTlsStack(h.state, h.stateFile))
      .rejects.toThrow(/receipt cleanup failed/);
    expect(h.deletedFiles).toEqual(expect.arrayContaining(h.sessionFiles));
    expect(h.deletedFiles).not.toContain(h.stateFile);
    expect(h.engineCalls.length).toBe(1);
  });

  it("(iii) 启动时间不一致：绝不向该 pid 发信号，兜底清理仍执行", async () => {
    const h = makeHarness();
    h.install({ lstart: "Mon Jan  1 00:00:00 2024", engineStatus: 0 });
    const killSpy = h.mockProcess(false);
    await teardownTlsStack(h.state, h.stateFile);
    const signalled = killSpy.mock.calls.filter((call) => call[1] === "SIGTERM");
    expect(signalled).toStrictEqual([]);
    expect(h.engineCalls.length).toBe(1);
    expect(h.deletedFiles).toContain(h.stateFile);
  });

  it("(iv) 等待超时仍存活：抛错、引擎未被调用、会话材料仍被删", async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    h.install({ engineStatus: 0 });
    const killSpy = h.mockProcess(false);
    const settled = teardownTlsStack(h.state, h.stateFile).then(
      () => new Error("expected teardownTlsStack to reject"),
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(110_000 + 2_000);
    const error = await settled;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/still alive/);
    expect(killSpy).toHaveBeenCalledWith(h.state.supervisorPid, "SIGTERM");
    expect(h.engineCalls.length).toBe(0);
    expect(h.deletedFiles).not.toContain(h.stateFile);
    expect(h.deletedFiles).toEqual(expect.arrayContaining(h.sessionFiles));
  });
});
