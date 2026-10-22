import { spawnSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHttpStackState, teardownHttpStack, type HttpStackState } from "../e2e/global-teardown";
vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn(), stat: vi.fn(), unlink: vi.fn() }));
const START = "Fri Oct 23 06:00:00 2026";
const FILE = "/tmp/http-owned/state.json";
function fixture(overrides: Record<string, unknown> = {}): HttpStackState {
  return parseHttpStackState(JSON.stringify({
    version: 4, stackKind: "http", supervisorPid: 4242, supervisorStartedAt: START,
    runDir: "/tmp/http-owned/run", nonce: "0123456789abcdef0123456789abcdef", project: "http-owned",
    dockerContext: "orbstack", keep: false, creating: true,
    container: "a".repeat(64), containers: ["a".repeat(64), "b".repeat(64)],
    processGroups: { provider: null, runtime: null, h5: null },
    processStarts: { provider: null, runtime: null, h5: null },
    releaseMode: "full", releasePolicyVersion: "e2e-synthetic-v1",
    providerLogPath: "/tmp/http-owned/run/provider-requests.jsonl",
    receipts: { capture: "/tmp/http-owned/run/created-resources.json", built: "/tmp/http-owned/run/built-images.json",
      collectors: "/tmp/http-owned/run/collectors.json", leftoversOut: "/tmp/http-owned/run/cleanup.leftovers.json",
      resourcesPy: "/repo/scripts/measure/g12-go-capacity/resources.py" },
    ...overrides,
  }));
}
function harness(options: { alive?: number[]; starts?: Record<number, string>; engineStatus?: number; restoreStatus?: number; zombie?: boolean } = {}) {
  const alive = new Set(options.alive ?? [4242]);
  const removed: string[] = [];
  const engineCalls: string[][] = [];
  const dockerCalls: string[][] = [];
  let snapshots = 0;
  const kill = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
    if (!alive.has(pid)) throw Object.assign(new Error("absent"), { code: "ESRCH" });
    if (signal === "SIGTERM" || signal === "SIGKILL") { alive.delete(pid); alive.delete(Math.abs(pid)); }
    return true;
  }) as typeof process.kill);
  const spawn = spawnSync as unknown as { mockImplementation(fn: (command: string, args: string[]) => { status: number; stdout: string; stderr: string }): void };
  spawn.mockImplementation((command, args) => {
    if (command === "ps") {
      const pid = Number(args[args.length - 1]);
      if (!alive.has(pid)) return { status: 1, stdout: "", stderr: "absent" };
      if (args.includes("stat=")) return { status: 0, stdout: options.zombie ? "Z" : "S", stderr: "" };
      return { status: 0, stdout: args.includes("pgid=") ? String(pid) : (options.starts?.[pid] ?? START), stderr: "" };
    }
    if (command === "python3") {
      engineCalls.push(args);
      return { status: options.engineStatus ?? 0, stdout: "", stderr: "receipt cleanup rejected" };
    }
    if (command === "docker") {
      dockerCalls.push(args);
      if (args.includes("-tAc")) return { status: 0, stdout: snapshots++ === 0 ? "BETA|true|e2e-synthetic-v1" : "SYNTHETIC|false|e2e-synthetic-v1", stderr: "" };
      return { status: options.restoreStatus ?? 0, stdout: "", stderr: "restore rejected" };
    }
    return { status: 1, stdout: "", stderr: "unexpected command" };
  });
  vi.mocked(unlink).mockImplementation(async (path) => { removed.push(String(path)); });
  return { kill, alive, removed, engineCalls, dockerCalls };
}
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
describe("HTTP v4 ownership contract", () => {
  it("rejects legacy names, missing start times and foreign Docker contexts before side effects", () => {
    expect(() => fixture({ version: 2 })).toThrow(/legacy/);
    expect(() => fixture({ containers: ["vc-e2e-pg-4242"] })).toThrow(/actual container IDs/);
    expect(() => fixture({ processGroups: { provider: 4343, runtime: null, h5: null } })).toThrow(/identity/);
    expect(() => fixture({ dockerContext: "remote" })).toThrow(/orbstack/);
  });
  it("stops the matched supervisor and delegates only to the receipt engine", async () => {
    const h = harness(); await teardownHttpStack(fixture(), FILE);
    expect(h.kill).toHaveBeenCalledWith(4242, "SIGTERM");
    expect(h.engineCalls).toHaveLength(1);
    expect(h.engineCalls[0]).toContain("/tmp/http-owned/run/created-resources.json");
    expect(h.engineCalls[0].slice(-2)).toEqual(["--deadline-seconds", "90"]);
    expect(h.dockerCalls).toEqual([]);
    expect(h.removed).toContain(FILE);
    expect(h.removed).toContain(FILE + ".auth.json");
    expect(h.removed).toContain("/tmp/http-owned/run/companiond");
    expect(h.removed).toContain("/tmp/http-owned/run/minio-tools.iid");
    expect(h.removed).toContain("/tmp/http-owned/run/.stack-creating");
  });
  it("does not wait for or signal an exited but unreaped supervisor", async () => {
    const h = harness({ zombie: true });
    await teardownHttpStack(fixture(), FILE);
    expect(h.kill.mock.calls.filter((c) => c[1] === "SIGTERM" || c[1] === "SIGKILL")).toEqual([]);
    expect(h.alive.has(4242)).toBe(true);
    expect(h.engineCalls).toHaveLength(1);
    expect(h.removed).toContain(FILE);
  });
  it("does not signal a reused supervisor PID and can clean its proven Docker receipts", async () => {
    const h = harness({ starts: { 4242: "different kernel start time" } });
    await teardownHttpStack(fixture(), FILE);
    expect(h.kill.mock.calls.filter((c) => c[1] === "SIGTERM")).toEqual([]);
    expect(h.alive.has(4242)).toBe(true); expect(h.engineCalls).toHaveLength(1);
  });
  it("recovers an orphaned but identity-matched child group after its supervisor is gone", async () => {
    const h = harness({ alive: [4343, -4343] });
    const s = fixture({ processGroups: { provider: 4343, runtime: null, h5: null }, processStarts: { provider: START, runtime: null, h5: null } });
    await teardownHttpStack(s, FILE);
    expect(h.kill).toHaveBeenCalledWith(-4343, "SIGTERM"); expect(h.engineCalls).toHaveLength(1);
  });
  it("preserves a mismatched process group without sending any signal or deleting the state", async () => {
    const h = harness({ alive: [4343, -4343], starts: { 4343: "different kernel start time" } });
    const s = fixture({ processGroups: { provider: 4343, runtime: null, h5: null }, processStarts: { provider: START, runtime: null, h5: null } });
    await expect(teardownHttpStack(s, FILE)).rejects.toThrow(/ownership is unverified/);
    expect(h.kill.mock.calls.filter((c) => c[1] === "SIGTERM" || c[1] === "SIGKILL")).toEqual([]);
    expect(h.engineCalls).toEqual([]); expect(h.removed).not.toContain(FILE);
    expect(h.removed).toContain(FILE + ".shared-chat.json");
  });
  it("does not kill a group whose leader identity can no longer be read", async () => {
    const h = harness({ alive: [-4343] });
    const s = fixture({ processGroups: { provider: 4343, runtime: null, h5: null }, processStarts: { provider: START, runtime: null, h5: null } });
    await expect(teardownHttpStack(s, FILE)).rejects.toThrow(/ownership is unverified/);
    expect(h.kill.mock.calls.filter((c) => c[1] === "SIGTERM" || c[1] === "SIGKILL")).toEqual([]);
    expect(h.engineCalls).toEqual([]);
  });
  it("retains state on receipt cleanup failure while removing session files", async () => {
    const h = harness({ engineStatus: 1 });
    await expect(teardownHttpStack(fixture(), FILE)).rejects.toThrow(/cleanup failed/);
    expect(h.removed).not.toContain(FILE); expect(h.removed).toContain(FILE + ".auth.json");
  });
  it("skips Docker writes for a run that never attempted creation", async () => {
    const h = harness(); await teardownHttpStack(fixture({ creating: false, container: null, containers: [] }), FILE);
    expect(h.engineCalls).toEqual([]); expect(h.removed).toContain(FILE);
  });
  it("keeps full-mode stacks intact", async () => {
    const h = harness(); await teardownHttpStack(fixture({ keep: true }), FILE);
    expect(h.kill.mock.calls).toEqual([]); expect(h.engineCalls).toEqual([]); expect(h.removed).toEqual([]);
  });
  it("restores synthetic-eval before preserving a kept stack", async () => {
    const h = harness(); await teardownHttpStack(fixture({ keep: true, releaseMode: "synthetic-eval" }), FILE);
    expect(h.dockerCalls).toHaveLength(3); expect(h.kill.mock.calls).toEqual([]);
    expect(h.engineCalls).toEqual([]); expect(h.removed).toEqual(["/tmp/http-owned/run/.preserve-stack"]);
  });
  it("leaves the stack intact if synthetic-eval restoration fails", async () => {
    const h = harness({ restoreStatus: 1 });
    await expect(teardownHttpStack(fixture({ releaseMode: "synthetic-eval" }), FILE)).rejects.toThrow(/restore/);
    expect(h.kill.mock.calls).toEqual([]); expect(h.engineCalls).toEqual([]); expect(h.removed).toEqual([]);
  });
});
