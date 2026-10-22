import { spawnSync } from "node:child_process";
import { readFile, realpath, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STATE_VERSION = 4;
const MAX_STATE_BYTES = 4096;
const TERM_GRACE_MS = 5_000;
const POLL_MS = 100;
// VC-R79 TLS 栈（state version 3）：supervisor 收 SIGTERM 后同步执行有界
// 收据清理（含 docker rm）。等待上限 110s（> 引擎 90s 时限、< Playwright
// gracefulShutdown 120s）、250ms 轮询；ESRCH 视为已退出。
const TLS_TERM_GRACE_MS = 110_000;
const TLS_POLL_MS = 250;
// 兜底清理引擎自身带 90s 总时限（--deadline-seconds），子进程超时留余量。
const TLS_CLEANUP_TIMEOUT_MS = 105_000;

type ProcessGroupName = "provider" | "runtime" | "h5";

interface StackState extends OwnedStackState {
  version: 4;
  stackKind: "http";
  processGroups: Record<ProcessGroupName, number | null>;
  processStarts: Record<ProcessGroupName, string | null>;
  runDir: string;
  nonce: string;
  container: string | null;
  containers: string[];
  keep: boolean;
  creating: boolean;
  releaseMode: "full" | "synthetic-eval";
  releasePolicyVersion: string;
  providerLogPath: string;
}
export type HttpStackState = StackState;

/** VC-R79 TLS 真实栈的 state 契约（version 3，由
 * scripts/dev/e2e-tls-stack.sh 写入）。containers 是 compose 各服务的
 * 容器 ID（或 null）；receipts 是 resources.py 清理引擎的收据路径，
 * 其中 collectors 从不创建（无 collector）。 */
export interface TlsStackState {
  version: 3;
  stackKind: "tls";
  supervisorPid: number;
  /** launcher 自记录的 ps -o lstart= 输出（已去首尾空白）；发信号前逐字
   * 比对，防止陈旧 state / PID 复用误杀无关进程。 */
  supervisorStartedAt: string;
  runDir: string;
  nonce: string;
  project: string;
  httpsPort: number;
  domain: string;
  dockerContext: string;
  keep: boolean;
  creating: boolean;
  started: boolean;
  releaseMode: string;
  releasePolicyVersion: string;
  containers: Record<"db" | "runtime" | "caddy" | "provider", string | null>;
  providerLogPath: string;
  receipts: {
    capture: string;
    built: string;
    compose: string;
    leftoversOut: string;
    collectors: string;
    resourcesPy: string;
  };
  caCert: string;
}

// Both real launcher modes use the same receipt cleanup and OS supervisor
// check. Their state parsers and process shapes remain explicit.
type OwnedStackState = Pick<TlsStackState,
  "supervisorPid" | "supervisorStartedAt" | "dockerContext" | "project"> & {
  receipts: Omit<TlsStackState["receipts"], "compose">;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nonEmptyStringOrNull(value: unknown): value is string | null {
  return value === null || nonEmptyString(value);
}

/** version 3 state 的严格校验（纯函数，供 vitest 覆盖）。任何字段缺失、
 * 类型不符或格式非法都抛错：teardown 宁可显式失败，也不带着可疑元数据
 * 去执行 docker 写操作。 */
export function parseTlsStackState(raw: string): TlsStackState {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) {
    throw new Error("E2E TLS stack state must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 3 || candidate.stackKind !== "tls") {
    throw new Error("E2E TLS stack state has an unsupported version or stack kind");
  }
  // 先取局部常量再做谓词/typeof 校验，让控制流收窄落到返回对象上。
  const supervisorPid = candidate.supervisorPid;
  const supervisorStartedAt = candidate.supervisorStartedAt;
  const runDir = candidate.runDir;
  const nonce = candidate.nonce;
  const project = candidate.project;
  const httpsPort = candidate.httpsPort;
  const domain = candidate.domain;
  const dockerContext = candidate.dockerContext;
  const keep = candidate.keep;
  const creating = candidate.creating;
  const started = candidate.started;
  const releasePolicyVersion = candidate.releasePolicyVersion;
  const providerLogPath = candidate.providerLogPath;
  const caCert = candidate.caCert;
  if (!positivePid(supervisorPid)) {
    throw new Error("E2E TLS stack state has an invalid supervisor PID");
  }
  if (!nonEmptyString(supervisorStartedAt)) {
    throw new Error("E2E TLS stack state has an invalid supervisor start time");
  }
  if (!nonEmptyString(runDir) || !runDir.startsWith("/")) {
    throw new Error("E2E TLS stack state has an invalid run directory");
  }
  if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/u.test(nonce)) {
    throw new Error("E2E TLS stack state has an invalid nonce");
  }
  if (!nonEmptyString(project)) {
    throw new Error("E2E TLS stack state has an invalid compose project");
  }
  if (typeof httpsPort !== "number" || !Number.isSafeInteger(httpsPort) || httpsPort <= 0) {
    throw new Error("E2E TLS stack state has an invalid https port");
  }
  if (!nonEmptyString(domain)) {
    throw new Error("E2E TLS stack state has an invalid domain");
  }
  // launcher 侧已严格限定 orbstack；teardown 绝不向其它 context 发
  // daemon 请求。
  if (dockerContext !== "orbstack") {
    throw new Error("E2E TLS stack state must use the orbstack Docker context");
  }
  if (typeof keep !== "boolean" || typeof creating !== "boolean"
      || typeof started !== "boolean") {
    throw new Error("E2E TLS stack state has an invalid keep/creating/started flag");
  }
  if (candidate.releaseMode !== "full") {
    throw new Error("E2E TLS stack state must use the full release mode");
  }
  if (typeof releasePolicyVersion !== "string"
      || !/^[A-Za-z0-9_.-]{1,64}$/.test(releasePolicyVersion)) {
    throw new Error("E2E TLS stack state has an invalid release policy version");
  }
  const containers = candidate.containers;
  if (typeof containers !== "object" || containers === null) {
    throw new Error("E2E TLS stack state has no container map");
  }
  const containersRecord = containers as Record<string, unknown>;
  for (const name of ["db", "runtime", "caddy", "provider"] as const) {
    if (!(name in containersRecord) || !nonEmptyStringOrNull(containersRecord[name])) {
      throw new Error(`E2E TLS stack state has an invalid ${name} container`);
    }
  }
  if (!nonEmptyString(providerLogPath)) {
    throw new Error("E2E TLS stack state has an invalid provider log path");
  }
  const receipts = candidate.receipts;
  if (typeof receipts !== "object" || receipts === null) {
    throw new Error("E2E TLS stack state has no receipt paths");
  }
  const receiptsRecord = receipts as Record<string, unknown>;
  for (const name of ["capture", "built", "compose", "leftoversOut", "collectors", "resourcesPy"] as const) {
    if (!nonEmptyString(receiptsRecord[name])) {
      throw new Error(`E2E TLS stack state has an invalid ${name} receipt path`);
    }
  }
  if (!nonEmptyString(caCert)) {
    throw new Error("E2E TLS stack state has an invalid CA certificate path");
  }
  return {
    version: 3,
    stackKind: "tls",
    supervisorPid,
    supervisorStartedAt,
    runDir,
    nonce,
    project,
    httpsPort,
    domain,
    dockerContext,
    keep,
    creating,
    started,
    releaseMode: "full",
    releasePolicyVersion,
    containers: {
      db: containersRecord.db as string | null,
      runtime: containersRecord.runtime as string | null,
      caddy: containersRecord.caddy as string | null,
      provider: containersRecord.provider as string | null,
    },
    providerLogPath,
    receipts: {
      capture: receiptsRecord.capture as string,
      built: receiptsRecord.built as string,
      compose: receiptsRecord.compose as string,
      leftoversOut: receiptsRecord.leftoversOut as string,
      collectors: receiptsRecord.collectors as string,
      resourcesPy: receiptsRecord.resourcesPy as string,
    },
    caCert,
  };
}

function positivePid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 1;
}

export function parseHttpStackState(raw: string): HttpStackState {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) throw new Error("HTTP E2E state must be an object");
  const c = value as Record<string, unknown>;
  if (c.version !== STATE_VERSION || c.stackKind !== "http") {
    throw new Error("HTTP E2E requires state v4 ownership records; legacy state is preserved without automatic cleanup");
  }
  if (!positivePid(c.supervisorPid) || c.supervisorPid === process.pid
      || !nonEmptyString(c.supervisorStartedAt)) throw new Error("HTTP E2E supervisor identity is invalid");
  if (!nonEmptyString(c.runDir) || !c.runDir.startsWith("/")
      || typeof c.nonce !== "string" || !/^[a-f0-9]{32}$/u.test(c.nonce)
      || !nonEmptyString(c.project)) throw new Error("HTTP E2E run ownership is invalid");
  if (c.dockerContext !== "orbstack") throw new Error("HTTP E2E requires the orbstack Docker context");
  if (typeof c.keep !== "boolean" || typeof c.creating !== "boolean") throw new Error("HTTP E2E lifecycle flags are invalid");
  if (c.releaseMode !== "full" && c.releaseMode !== "synthetic-eval") throw new Error("HTTP E2E release mode is invalid");
  if (typeof c.releasePolicyVersion !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/u.test(c.releasePolicyVersion)) {
    throw new Error("HTTP E2E release policy is invalid");
  }
  const isCid = (x: unknown): x is string => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x);
  if (!Array.isArray(c.containers) || c.containers.length > 3 || !c.containers.every(isCid)
      || new Set(c.containers).size !== c.containers.length
      || (c.container !== null && (!isCid(c.container) || !c.containers.includes(c.container)))) {
    throw new Error("HTTP E2E requires actual container IDs from this run");
  }
  if (!nonEmptyString(c.providerLogPath) || !c.providerLogPath.startsWith("/")) throw new Error("HTTP E2E provider log path is invalid");
  const groups = c.processGroups;
  const starts = c.processStarts;
  if (typeof groups !== "object" || groups === null || typeof starts !== "object" || starts === null) {
    throw new Error("HTTP E2E process ownership records are missing");
  }
  const g = groups as Record<string, unknown>;
  const t = starts as Record<string, unknown>;
  for (const name of ["provider", "runtime", "h5"] as const) {
    if (!(name in g) || !(name in t)
        || (g[name] === null ? t[name] !== null : !positivePid(g[name]) || !nonEmptyString(t[name]))) {
      throw new Error("HTTP E2E process identity is invalid: " + name);
    }
  }
  const ids = Object.values(g).filter((x): x is number => x !== null) as number[];
  if (ids.includes(c.supervisorPid) || ids.includes(process.pid) || new Set(ids).size !== ids.length) {
    throw new Error("HTTP E2E process targets must be distinct");
  }
  const receipts = c.receipts;
  if (typeof receipts !== "object" || receipts === null) throw new Error("HTTP E2E receipts are missing");
  const r = receipts as Record<string, unknown>;
  for (const key of ["capture", "built", "collectors", "leftoversOut", "resourcesPy"]) {
    const path = r[key];
    if (!nonEmptyString(path) || !path.startsWith("/")) throw new Error("HTTP E2E receipt path is invalid: " + key);
  }
  return c as unknown as HttpStackState;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function targetAlive(target: number): boolean {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
}

function signal(target: number, signalName: NodeJS.Signals): void {
  try {
    process.kill(target, signalName);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ESRCH") {
      throw error;
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stopProcesses(state: StackState): Promise<void> {
  await stopOwnedSupervisor(state);
  for (const name of ["h5", "runtime", "provider"] as const) {
    const pid = state.processGroups[name];
    if (pid === null || !targetAlive(-pid)) continue;
    const matches = () => {
      if (processLstart(pid) !== state.processStarts[name]) return false;
      const r = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8", timeout: 5_000 });
      return r.status === 0 && r.stdout.trim() === String(pid);
    };
    if (!matches()) throw new Error("HTTP process group ownership is unverified; no signal sent: " + name);
    signal(-pid, "SIGTERM");
    const deadline = Date.now() + TERM_GRACE_MS;
    while (Date.now() < deadline && targetAlive(-pid)) await delay(POLL_MS);
    if (targetAlive(-pid)) {
      if (!matches()) throw new Error("HTTP process group identity changed; no escalation: " + name);
      signal(-pid, "SIGKILL");
      const killDeadline = Date.now() + TERM_GRACE_MS;
      while (Date.now() < killDeadline && targetAlive(-pid)) await delay(POLL_MS);
      if (targetAlive(-pid)) throw new Error("HTTP owned process group remains alive: " + name);
    }
  }
}

function releaseGateSnapshot(state: StackState): string {
  if (state.releaseMode !== "synthetic-eval" || state.container === null) {
    throw new Error("release-gate snapshot requires the synthetic-eval database CID");
  }
  const result = spawnSync(
    "docker",
    [
      "--context",
      state.dockerContext,
      "exec",
      "-i",
      state.container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "vc",
      "-tAc",
      "SELECT out_stage || '|' || CASE WHEN out_eval_passed THEN 'true' ELSE 'false' END || '|' || out_policy_version FROM vc.release_gate_snapshot()",
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (result.status !== 0) {
    throw new Error("failed to read the synthetic-eval release gate snapshot");
  }
  return result.stdout.trim();
}

function assertSyntheticReleaseGate(state: StackState, expected: string): void {
  if (releaseGateSnapshot(state) !== expected) {
    throw new Error(
      `synthetic eval release gate mismatch; expected ${expected}`,
    );
  }
}

function restoreSyntheticReleaseGate(state: StackState): void {
  if (state.container === null) throw new Error("synthetic-eval database CID is unavailable");
  const result = spawnSync(
    "docker",
    [
      "--context",
      state.dockerContext,
      "exec",
      "-i",
      state.container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "vc",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-c",
      `SELECT vc.advance_release_gate('SYNTHETIC', false, '${state.releasePolicyVersion}');`,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (result.status !== 0) {
    throw new Error("failed to restore the synthetic-eval release gate");
  }
  const expected = `SYNTHETIC|false|${state.releasePolicyVersion}`;
  assertSyntheticReleaseGate(state, expected);
}

function stateVersionOf(raw: string): unknown {
  const value: unknown = JSON.parse(raw);
  if (typeof value === "object" && value !== null) {
    return (value as { version?: unknown }).version;
  }
  return undefined;
}

/** TLS 使用 v3，HTTP 使用 v4；旧版缺少归属记录时显式失败并保留现场。 */
function parseStackStateFile(raw: string): StackState | TlsStackState {
  return stateVersionOf(raw) === 3 ? parseTlsStackState(raw) : parseHttpStackState(raw);
}

/** 读 supervisor 的 ps lstart 启动时间；ps 失败或输出为空返回 null。 */
function processLstart(pid: number): string | null {
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0) return null;
  const startedAt = result.stdout.trim();
  return startedAt || null;
}

async function stopOwnedSupervisor(state: OwnedStackState): Promise<void> {
  // kill(pid, 0) also succeeds for an exited but unreaped child. Kernel Z
  // state is terminal: no supervisor cleanup can still be running there.
  const active = () => {
    if (!targetAlive(state.supervisorPid)) return false;
    const status = spawnSync("ps", ["-o", "stat=", "-p", String(state.supervisorPid)], {
      encoding: "utf8", timeout: 5_000,
    });
    // A failed observation never proves exit.
    return status.status !== 0 || !status.stdout.trim().startsWith("Z");
  };
  // 进程所有权：仅当 pid 存活且 ps 读到的 lstart 与 state 记录逐字一致
  // 才发 SIGTERM。ps 失败、pid 已死或时间不一致（陈旧 state / PID 复用）
  // 绝不向其它进程发信号，直接落到收据兜底清理。
  if (!active()) return;
  const startedAt = processLstart(state.supervisorPid);
  if (startedAt === null || startedAt !== state.supervisorStartedAt) return;
  signal(state.supervisorPid, "SIGTERM");
  // 110s 有界等待（> 引擎 90s 时限、< Playwright gracefulShutdown 120s）；
  // 其 SIGTERM trap 同步执行一轮有界收据清理，ESRCH 视为已退出。
  const deadline = Date.now() + TLS_TERM_GRACE_MS;
  while (Date.now() < deadline && active()) {
    await delay(TLS_POLL_MS);
  }
  if (active()) {
    // supervisor 的同一轮清理仍在进行：不得并发再开兜底清理。抛错并
    // 保留全部记录（state、收据、leftovers），可见失败。
    throw new Error(
      `E2E stack supervisor (pid ${state.supervisorPid}) is still alive `
        + `${TLS_TERM_GRACE_MS}ms after SIGTERM; refusing to run a concurrent receipt cleanup (all records preserved)`,
    );
  }
}

/** <repo>/scripts/measure/g12-go-capacity/resources.py → <repo> */
function ownedRepoRoot(state: OwnedStackState): string {
  return resolve(state.receipts.resourcesPy, "..", "..", "..", "..");
}

/** resources.py 是唯一清理引擎；supervisor 的 trap 已先清过一轮，这里
 * 无论其是否如期退出都做幂等兜底（creating!==true 表示从未尝试 compose
 * create，不做任何 docker 写）。rc!==0 直接抛错：可见失败并保留收据记录。 */
function cleanupOwnedReceipts(state: OwnedStackState): void {
  const result = spawnSync(
    "python3",
    [
      state.receipts.resourcesPy,
      "cleanup",
      "--capture", state.receipts.capture,
      "--built", state.receipts.built,
      "--collectors", state.receipts.collectors,
      "--collectors-required", "no",
      "--leftovers-out", state.receipts.leftoversOut,
      "--project", state.project,
      // 清理引擎自身的总时限（G12 默认行为不受影响）。
      "--deadline-seconds", "90",
    ],
    {
      cwd: ownedRepoRoot(state),
      encoding: "utf8",
      timeout: TLS_CLEANUP_TIMEOUT_MS,
      // 仅本子进程注入 DOCKER_CONTEXT，不改全局设置。
      env: { ...process.env, DOCKER_CONTEXT: state.dockerContext },
    },
  );
  if (result.status !== 0) {
    const detail = result.error
      ? String(result.error)
      : result.stderr.trim().split("\n").slice(-5).join("; ");
    throw new Error(
      `E2E stack receipt cleanup failed (rc=${String(result.status)}): ${detail}`,
    );
  }
}

/** TLS 栈的收尾（导出供 vitest 做 mock 生命周期回归）。收据生命周期与
 * launcher 对齐：CAPTURE/BUILT 收据由 launcher 在成功后保留给这里的幂等
 * 兜底；auth/shared 会话材料无论如何都删（finally 语义）；state 文件只在
 * 整体成功后删除，任何失败都保留它作为恢复入口。 */
export async function teardownTlsStack(state: TlsStackState, stateFile: string): Promise<void> {
  if (state.keep) {
    // 与 v2 keep 语义一致：栈保留（不 SIGTERM、不清理），本地文件也保留。
    return;
  }
  try {
    await stopOwnedSupervisor(state);
    if (state.creating) {
      cleanupOwnedReceipts(state);
    }
    try {
      await unlink(stateFile);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  } finally {
    for (const localStateFile of [
      `${stateFile}.auth.json`,
      `${stateFile}.shared-chat.json`,
      `${stateFile}.shared-memory.json`,
      `${stateFile}.shared-admin.json`,
    ]) {
      try {
        await unlink(localStateFile);
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
      }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function combineErrors(primary: unknown, secondary: unknown): Error {
  return new Error(
    `${errorMessage(primary)}; release-gate restoration also failed: ${errorMessage(secondary)}`,
  );
}

async function dischargeHttpRestoreObligation(state: HttpStackState): Promise<void> {
  try { await unlink(resolve(state.runDir, ".preserve-stack")); }
  catch (e) { if (!isMissing(e)) throw e; }
}

async function restoreHttpReleaseGate(state: HttpStackState): Promise<void> {
  restoreSyntheticReleaseGate(state);
  await dischargeHttpRestoreObligation(state);
}

async function destroyHttpStack(state: HttpStackState, stateFile: string): Promise<void> {
  try {
    await stopProcesses(state);
    if (state.creating) cleanupOwnedReceipts(state);
    for (const name of ["companiond", "minio-tools.iid", ".stack-creating"]) {
      try { await unlink(resolve(state.runDir, name)); }
      catch (e) { if (!isMissing(e)) throw e; }
    }
    try { await unlink(stateFile); } catch (e) { if (!isMissing(e)) throw e; }
  } finally {
    for (const suffix of [".auth.json", ".shared-chat.json", ".shared-memory.json", ".shared-admin.json"]) {
      try { await unlink(stateFile + suffix); } catch (e) { if (!isMissing(e)) throw e; }
    }
  }
}

export async function teardownHttpStack(state: HttpStackState, stateFile: string): Promise<void> {
  let validationError: unknown;
  let restorationError: unknown;
  if (state.releaseMode === "synthetic-eval") {
    try { assertSyntheticReleaseGate(state, "BETA|true|" + state.releasePolicyVersion); }
    catch (e) { validationError = e; }
    try { await restoreHttpReleaseGate(state); } catch (e) { restorationError = e; }
  }
  if (restorationError) throw validationError ? combineErrors(validationError, restorationError) : restorationError;
  if (!state.keep) await destroyHttpStack(state, stateFile);
  if (validationError) throw validationError;
}

type CloseReceipt = Record<string, unknown>;
async function readCloseReceipt(path: string, runDir: string): Promise<CloseReceipt> {
  const actual = await realpath(path);
  const metadata = await stat(actual);
  if (dirname(actual) !== runDir || !metadata.isFile() || metadata.size > 65_536) {
    throw new Error("HTTP close receipt must be a bounded file in this run directory");
  }
  let value: unknown;
  try { value = JSON.parse(await readFile(actual, "utf8")); }
  catch { throw new Error("HTTP close receipt is not valid JSON"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("HTTP close receipt must be an object");
  return value as CloseReceipt;
}

async function httpCloseState(state: HttpStackState): Promise<HttpStackState> {
  if (!state.creating || state.container === null || state.containers.length !== 3
      || state.project !== "vce2ehttp-" + state.nonce) {
    throw new Error("HTTP close requires a complete v4 creation record; incomplete state is preserved");
  }
  const runDir = await realpath(state.runDir);
  const receiptPaths = [state.receipts.capture, state.receipts.built, state.receipts.collectors, state.receipts.leftoversOut];
  if (new Set(receiptPaths.map((p) => resolve(p))).size !== receiptPaths.length) throw new Error("HTTP close receipt paths must be distinct");
  for (const path of receiptPaths) {
    if (await realpath(dirname(path)) !== runDir) throw new Error("HTTP close receipt path leaves this run directory");
  }
  try {
    await stat(state.receipts.collectors);
    throw new Error("HTTP close found an unexpected collector record; preserved");
  } catch (e) { if (!isMissing(e)) throw e; }
  try {
    if (dirname(await realpath(state.receipts.leftoversOut)) !== runDir) throw new Error("HTTP close output path leaves this run directory");
  } catch (e) { if (!isMissing(e)) throw e; }
  const capture = await readCloseReceipt(state.receipts.capture, runDir);
  const built = await readCloseReceipt(state.receipts.built, runDir);
  const ownRef = "virtual-companion-e2e-minio:" + state.nonce;
  const imageId = built[ownRef];
  if (Object.keys(built).length !== 1 || typeof imageId !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(imageId)) {
    throw new Error("HTTP close tools-image receipt does not match this run");
  }
  if (capture.nonce !== state.nonce || capture.project !== state.project
      || !Array.isArray(capture.containers) || capture.containers.length !== 3
      || !Array.isArray(capture.volumes) || capture.volumes.length !== 1
      || !Array.isArray(capture.networks) || capture.networks.length !== 0) {
    throw new Error("HTTP close creation receipt does not match this run");
  }
  const entries = capture.containers as CloseReceipt[];
  const wanted = new Set(state.containers);
  const services = new Set(["pg", "minio", "minio-init"]);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || typeof entry.cid !== "string"
        || !wanted.has(entry.cid) || entry.nonce !== state.nonce || typeof entry.service !== "string"
        || !services.delete(entry.service) || seen.has(entry.cid)) {
      throw new Error("HTTP close container receipt is incomplete or mismatched");
    }
    seen.add(entry.cid);
    const live = spawnSync("docker", ["--context", "orbstack", "inspect", "--format",
      "{{json .Config.Labels}}\n{{json .Mounts}}", entry.cid], { encoding: "utf8", timeout: 10_000 });
    if (live.status !== 0) throw new Error("HTTP close cannot confirm a recorded container; preserved");
    let labels: CloseReceipt;
    let mounts: CloseReceipt[];
    try {
      const lines = live.stdout.trim().split("\n");
      labels = JSON.parse(lines[0]) as CloseReceipt;
      mounts = JSON.parse(lines[1]) as CloseReceipt[];
    } catch { throw new Error("HTTP close container identity response is invalid"); }
    if (!labels || labels["vc.g12.nonce"] !== state.nonce || labels["com.docker.compose.project"] !== state.project
        || labels["com.docker.compose.service"] !== entry.service || !Array.isArray(mounts)) {
      throw new Error("HTTP close live container ownership differs; no shutdown performed");
    }
    if (entry.service === "pg" && entry.cid !== state.container) throw new Error("HTTP close database CID differs from the creation receipt");
    if (entry.service === "minio-init") {
      const config = mounts.find((m) => m.Type === "bind" && m.Destination === "/mc-config/config.json" && m.RW === false);
      if (!config || typeof config.Source !== "string" || await realpath(resolve(config.Source, "..", "..")) !== runDir) {
        throw new Error("HTTP close run directory is not the original fixture bind directory");
      }
    }
  }
  if (services.size !== 0) throw new Error("HTTP close service creation records are incomplete");
  const volume = capture.volumes[0] as CloseReceipt;
  if (!volume || volume.name !== state.project + "_db-data" || volume.nonce !== state.nonce) {
    throw new Error("HTTP close database-volume receipt does not match this run");
  }
  // Public CLI input never chooses the Python program to execute. Reuse the
  // current repository's existing cleanup engine with the verified receipts.
  return { ...state, receipts: { ...state.receipts, resourcesPy:
    fileURLToPath(new URL("../../scripts/measure/g12-go-capacity/resources.py", import.meta.url)) } };
}

/** Explicit resource closure is separate from the evaluation's BETA check. */
export async function closeHttpStack(state: HttpStackState, stateFile: string): Promise<void> {
  const owned = await httpCloseState(state);
  if (owned.releaseMode === "synthetic-eval") {
    const snapshot = releaseGateSnapshot(owned);
    if (snapshot === "SYNTHETIC|false|" + owned.releasePolicyVersion) {
      await dischargeHttpRestoreObligation(owned);
    } else if (snapshot === "BETA|true|" + owned.releasePolicyVersion) {
      await restoreHttpReleaseGate(owned);
    } else {
      throw new Error("HTTP close release gate differs from this run policy; preserved");
    }
  }
  await destroyHttpStack(owned, stateFile);
}

export async function readStackStateFile(stateFile: string): Promise<HttpStackState | TlsStackState> {
  const metadata = await stat(stateFile);
  if (!metadata.isFile() || metadata.size > MAX_STATE_BYTES) throw new Error("E2E stack state file is not a small regular file");
  const raw = await readFile(stateFile, "utf8");
  try { return parseStackStateFile(raw); }
  catch (e) {
    if (e instanceof SyntaxError) throw new Error("E2E stack state is not valid JSON");
    throw e;
  }
}

export default async function globalTeardown(): Promise<void> {
  const stateFile = process.env.E2E_STACK_STATE_FILE;
  if (!stateFile) {
    return;
  }

  let state: StackState | TlsStackState;
  try {
    state = await readStackStateFile(stateFile);
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw error;
  }

  if (state.version === 3) {
    await teardownTlsStack(state, stateFile);
    return;
  }

  await teardownHttpStack(state, stateFile);
}
