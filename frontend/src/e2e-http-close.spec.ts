import { spawnSync } from "node:child_process";
import { readFile, realpath, stat, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeHttpStack, parseHttpStackState, type HttpStackState } from "../e2e/global-teardown";
vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn(), realpath: vi.fn(), stat: vi.fn(), unlink: vi.fn() }));
const ENGINE = fileURLToPath(new URL("../../scripts/measure/g12-go-capacity/resources.py", import.meta.url));
const RUN = "/tmp/http-close-run";
const FILE = "/tmp/http-close-state.json";
const NONCE = "0123456789abcdef0123456789abcdef";
const PROJECT = "vce2ehttp-" + NONCE;
const IDS = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
const SERVICES = ["pg", "minio", "minio-init"];
const missing = () => Object.assign(new Error("absent"), { code: "ENOENT" });
function fixture(overrides: Record<string, unknown> = {}): HttpStackState {
  return parseHttpStackState(JSON.stringify({
    version: 4, stackKind: "http", supervisorPid: 4242, supervisorStartedAt: "Fri Oct 23 06:00:00 2026",
    runDir: RUN, nonce: NONCE, project: PROJECT, dockerContext: "orbstack", keep: true, creating: true,
    container: IDS[0], containers: IDS, processGroups: { provider: null, runtime: null, h5: null },
    processStarts: { provider: null, runtime: null, h5: null }, releaseMode: "full", releasePolicyVersion: "e2e-synthetic-v1",
    providerLogPath: RUN + "/provider-requests.jsonl", receipts: {
      capture: RUN + "/created-resources.json", built: RUN + "/built-images.json", collectors: RUN + "/collectors.json",
      leftoversOut: RUN + "/cleanup.leftovers.json", resourcesPy: "/untrusted/metadata/program.py",
    }, ...overrides,
  }));
}
function harness(options: { gate?: string; restoreFails?: boolean; foreignLive?: boolean; bindSource?: string; engineFails?: boolean } = {}) {
  const capture = { nonce: NONCE, project: PROJECT,
    containers: IDS.map((cid, i) => ({ cid, name: PROJECT + "-" + SERVICES[i], service: SERVICES[i], nonce: NONCE })),
    volumes: [{ name: PROJECT + "_db-data", nonce: NONCE }], networks: [],
  };
  const built: Record<string, string> = { ["virtual-companion-e2e-minio:" + NONCE]: "sha256:" + "d".repeat(64) };
  let gate = options.gate ?? "BETA|true|e2e-synthetic-v1";
  const events: string[] = [];
  const calls: { command: string; args: string[] }[] = [];
  vi.mocked(realpath).mockImplementation(async (path) => {
    const p = String(path);
    if (p.endsWith("/collectors.json") || p.endsWith("/cleanup.leftovers.json")) throw missing();
    return p;
  });
  vi.mocked(stat).mockImplementation(async (path) => {
    if (String(path).endsWith("/collectors.json")) throw missing();
    return { isFile: () => true, size: 1000 } as Awaited<ReturnType<typeof stat>>;
  });
  vi.mocked(readFile).mockImplementation(async (path) => JSON.stringify(String(path).endsWith("created-resources.json") ? capture : built));
  vi.mocked(unlink).mockImplementation(async (path) => { events.push("unlink:" + String(path)); });
  const kill = vi.spyOn(process, "kill").mockImplementation((() => { throw Object.assign(new Error("absent"), { code: "ESRCH" }); }) as typeof process.kill);
  vi.mocked(spawnSync).mockImplementation(((command: string, args: string[]) => {
    calls.push({ command, args });
    if (command === "docker" && args.includes("inspect")) {
      const service = SERVICES[IDS.indexOf(args[args.length - 1])];
      const labels = { "vc.g12.nonce": options.foreignLive ? "foreign" : NONCE,
        "com.docker.compose.project": PROJECT, "com.docker.compose.service": service };
      const mounts = service === "minio-init" ? [{ Type: "bind", Destination: "/mc-config/config.json", RW: false,
        Source: options.bindSource ?? RUN + "/mc-config/config.json" }] : [];
      return { status: 0, stdout: JSON.stringify(labels) + "\n" + JSON.stringify(mounts), stderr: "" };
    }
    if (command === "docker" && args.includes("-tAc")) return { status: 0, stdout: gate, stderr: "" };
    if (command === "docker" && args.includes("-c")) {
      events.push("restore");
      if (options.restoreFails) return { status: 1, stdout: "", stderr: "restore refused" };
      gate = "SYNTHETIC|false|e2e-synthetic-v1";
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "python3") {
      events.push("cleanup");
      return { status: options.engineFails ? 1 : 0, stdout: "", stderr: "receipt cleanup refused" };
    }
    throw new Error("unexpected command: " + command);
  }) as typeof spawnSync);
  return { capture, built, calls, events, kill };
}
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("explicit retained HTTP v4 closure", () => {
  it("uses the recorded CI default context for HTTP ownership checks", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    vi.stubEnv("RUNNER_OS", "Linux");
    const h = harness();
    await closeHttpStack(fixture({ dockerContext: "default" }), FILE, ENGINE);
    const inspectCalls = h.calls.filter((call) => call.command === "docker" && call.args.includes("inspect"));
    expect(inspectCalls).toHaveLength(3);
    expect(inspectCalls.every((call) => call.args[1] === "default")).toBe(true);
  });
  it("closes KEEP stacks with the trusted repository cleanup engine", async () => {
    const h = harness(); await closeHttpStack(fixture(), FILE, ENGINE);
    const cleanup = h.calls.find((c) => c.command === "python3");
    expect(cleanup?.args[0]).toBe(ENGINE);
    expect(cleanup?.args).not.toContain("/untrusted/metadata/program.py");
    expect(cleanup?.args.slice(-2)).toEqual(["--deadline-seconds", "90"]);
    expect(h.events).toContain("unlink:" + FILE);
    expect(h.events).toContain("unlink:" + FILE + ".auth.json");
    expect(h.events).toContain("unlink:" + RUN + "/companiond");
    expect(h.events).not.toContain("restore");
  });
  it("closes already-restored synthetic stacks without updating the release gate", async () => {
    const h = harness({ gate: "SYNTHETIC|false|e2e-synthetic-v1" });
    await closeHttpStack(fixture({ releaseMode: "synthetic-eval" }), FILE, ENGINE);
    expect(h.calls.filter((c) => c.command === "docker" && c.args.includes("-c"))).toEqual([]);
    expect(h.events.indexOf("unlink:" + RUN + "/.preserve-stack")).toBeLessThan(h.events.indexOf("cleanup"));
    expect(h.events).toContain("unlink:" + FILE);
  });
  it("restores a pending BETA stack before releasing its preservation marker and resources", async () => {
    const h = harness(); await closeHttpStack(fixture({ releaseMode: "synthetic-eval" }), FILE, ENGINE);
    expect(h.events.slice(0, 3)).toEqual(["restore", "unlink:" + RUN + "/.preserve-stack", "cleanup"]);
    expect(h.calls.find((c) => c.args.includes("-c"))?.args.join(" ")).toContain("'SYNTHETIC', false");
  });
  it("preserves every resource and file when restoration is refused", async () => {
    const h = harness({ restoreFails: true });
    await expect(closeHttpStack(fixture({ releaseMode: "synthetic-eval" }), FILE, ENGINE)).rejects.toThrow(/restore/);
    expect(h.events).toEqual(["restore"]); expect(h.kill).not.toHaveBeenCalled();
  });
  it("rejects an unexpected release policy before shutdown", async () => {
    const h = harness({ gate: "SYNTHETIC|false|foreign-policy" });
    await expect(closeHttpStack(fixture({ releaseMode: "synthetic-eval" }), FILE, ENGINE)).rejects.toThrow(/policy/);
    expect(h.events).toEqual([]); expect(h.kill).not.toHaveBeenCalled();
  });
  it("rejects mismatched creation records before any Docker or process calls", async () => {
    const h = harness(); h.capture.nonce = "foreign";
    await expect(closeHttpStack(fixture(), FILE, ENGINE)).rejects.toThrow(/creation receipt/);
    expect(h.calls).toEqual([]); expect(h.events).toEqual([]); expect(h.kill).not.toHaveBeenCalled();
  });
  it("rejects live foreign containers and a substituted fixture directory before shutdown", async () => {
    const h = harness({ foreignLive: true });
    await expect(closeHttpStack(fixture(), FILE, ENGINE)).rejects.toThrow(/live container ownership/);
    expect(h.events).toEqual([]); expect(h.kill).not.toHaveBeenCalled();
    const other = harness({ bindSource: "/tmp/other-run/mc-config/config.json" });
    await expect(closeHttpStack(fixture(), FILE, ENGINE)).rejects.toThrow(/original fixture bind/);
    expect(other.events).toEqual([]); expect(other.kill).not.toHaveBeenCalled();
  });
  it("rejects foreign image tags and receipt paths before Docker writes", async () => {
    const h = harness(); h.built["foreign:tag"] = "sha256:" + "e".repeat(64);
    await expect(closeHttpStack(fixture(), FILE, ENGINE)).rejects.toThrow(/tools-image/);
    expect(h.calls).toEqual([]);
    const state = fixture(); state.receipts.capture = "/tmp/other/created-resources.json";
    await expect(closeHttpStack(state, FILE, ENGINE)).rejects.toThrow(/leaves this run directory/);
    expect(h.calls).toEqual([]); expect(h.events).toEqual([]);
  });
  it("keeps the recovery state when the receipt engine rejects cleanup", async () => {
    const h = harness({ engineFails: true });
    await expect(closeHttpStack(fixture(), FILE, ENGINE)).rejects.toThrow(/cleanup failed/);
    expect(h.events).not.toContain("unlink:" + FILE);
    expect(h.events).toContain("unlink:" + FILE + ".auth.json");
    expect(h.events).not.toContain("unlink:" + RUN + "/companiond");
  });
});
