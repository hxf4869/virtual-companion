import { spawnSync } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";

const STATE_VERSION = 2;
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

interface StackState {
  version: 2;
  supervisorPid: number;
  processGroups: Record<ProcessGroupName, number | null>;
  container: string;
  containers: string[];
  dockerContext: string;
  keep: boolean;
  releaseMode: "full" | "synthetic-eval";
  releasePolicyVersion: string;
}

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

function parseState(raw: string): StackState {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) {
    throw new Error("E2E stack state must be an object");
  }
  const candidate = value as Partial<StackState>;
  if (candidate.version !== STATE_VERSION || !positivePid(candidate.supervisorPid)) {
    throw new Error("E2E stack state has an unsupported version or supervisor PID");
  }
  const groups = candidate.processGroups;
  if (typeof groups !== "object" || groups === null) {
    throw new Error("E2E stack state has no process-group list");
  }
  for (const name of ["provider", "runtime", "h5"] as const) {
    const pgid = groups[name];
    if (pgid !== null && !positivePid(pgid)) {
      throw new Error(`E2E stack state has an invalid ${name} process group`);
    }
  }
  const groupIds = Object.values(groups).filter((pgid): pgid is number => pgid !== null);
  if (candidate.supervisorPid === process.pid
      || groupIds.includes(candidate.supervisorPid)
      || new Set(groupIds).size !== groupIds.length) {
    throw new Error("E2E stack state process targets are not distinct");
  }
  const pgContainer = `vc-e2e-pg-${candidate.supervisorPid}`;
  const minioContainer = `vc-e2e-minio-${candidate.supervisorPid}`;
  if (candidate.container !== pgContainer) {
    throw new Error("E2E stack state container does not match its supervisor");
  }
  const containers = candidate.containers ?? [candidate.container];
  if (!Array.isArray(containers)
      || containers.length < 1
      || containers.length > 2
      || containers[0] !== pgContainer
      || new Set(containers).size !== containers.length
      || containers.some((container) => container !== pgContainer && container !== minioContainer)) {
    throw new Error("E2E stack state has an invalid container list");
  }
  if (typeof candidate.dockerContext !== "string"
      || !/^[A-Za-z0-9_.-]+$/.test(candidate.dockerContext)) {
    throw new Error("E2E stack state has an invalid Docker context");
  }
  if (typeof candidate.keep !== "boolean") {
    throw new Error("E2E stack state has an invalid keep flag");
  }
  if (candidate.releaseMode !== "full"
      && candidate.releaseMode !== "synthetic-eval") {
    throw new Error("E2E stack state has an invalid release mode");
  }
  if (typeof candidate.releasePolicyVersion !== "string"
      || !/^[A-Za-z0-9_.-]{1,64}$/.test(candidate.releasePolicyVersion)) {
    throw new Error("E2E stack state has an invalid release policy version");
  }
  return { ...candidate, containers } as StackState;
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
  const groups = Object.values(state.processGroups)
    .filter((pgid): pgid is number => pgid !== null)
    .map((pgid) => -pgid);
  const targets = [state.supervisorPid, ...groups];

  for (const target of targets) {
    signal(target, "SIGTERM");
  }
  const deadline = Date.now() + TERM_GRACE_MS;
  while (Date.now() < deadline && targets.some(targetAlive)) {
    await delay(POLL_MS);
  }
  for (const target of targets) {
    if (targetAlive(target)) {
      signal(target, "SIGKILL");
    }
  }
}

function removeContainers(state: StackState): void {
  for (const container of state.containers) {
    // -v removes the container's anonymous volumes; the pinned PG image's
    // data volume would otherwise outlive every E2E run.
    spawnSync(
      "docker",
      ["--context", state.dockerContext, "rm", "-f", "-v", container],
      { stdio: "ignore" },
    );
  }
}

function releaseGateSnapshot(state: StackState): string {
  if (state.releaseMode !== "synthetic-eval") {
    throw new Error("release-gate snapshot is only valid for synthetic eval");
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

/** version 3 走 TLS 契约；其余（含非法版本号）仍交给 v2 parseState 抛出
 * 既有错误，保持 HTTP 模式行为不变。 */
function parseStackStateFile(raw: string): StackState | TlsStackState {
  return stateVersionOf(raw) === 3 ? parseTlsStackState(raw) : parseState(raw);
}

/** 读 supervisor 的 ps lstart 启动时间；ps 失败或输出为空返回 null。 */
function supervisorLstart(pid: number): string | null {
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0) return null;
  const startedAt = result.stdout.trim();
  return startedAt || null;
}

async function stopTlsSupervisor(state: TlsStackState): Promise<void> {
  // 进程所有权：仅当 pid 存活且 ps 读到的 lstart 与 state 记录逐字一致
  // 才发 SIGTERM。ps 失败、pid 已死或时间不一致（陈旧 state / PID 复用）
  // 绝不向其它进程发信号，直接落到收据兜底清理。
  if (!targetAlive(state.supervisorPid)) return;
  const startedAt = supervisorLstart(state.supervisorPid);
  if (startedAt === null || startedAt !== state.supervisorStartedAt) return;
  signal(state.supervisorPid, "SIGTERM");
  // 110s 有界等待（> 引擎 90s 时限、< Playwright gracefulShutdown 120s）；
  // 其 SIGTERM trap 同步执行一轮有界收据清理，ESRCH 视为已退出。
  const deadline = Date.now() + TLS_TERM_GRACE_MS;
  while (Date.now() < deadline && targetAlive(state.supervisorPid)) {
    await delay(TLS_POLL_MS);
  }
  if (targetAlive(state.supervisorPid)) {
    // supervisor 的同一轮清理仍在进行：不得并发再开兜底清理。抛错并
    // 保留全部记录（state、收据、leftovers），可见失败。
    throw new Error(
      `TLS stack supervisor (pid ${state.supervisorPid}) is still alive `
        + `${TLS_TERM_GRACE_MS}ms after SIGTERM; refusing to run a concurrent receipt cleanup (all records preserved)`,
    );
  }
}

/** <repo>/scripts/measure/g12-go-capacity/resources.py → <repo> */
function tlsRepoRoot(state: TlsStackState): string {
  return resolve(state.receipts.resourcesPy, "..", "..", "..", "..");
}

/** resources.py 是唯一清理引擎；supervisor 的 trap 已先清过一轮，这里
 * 无论其是否如期退出都做幂等兜底（creating!==true 表示从未尝试 compose
 * create，不做任何 docker 写）。rc!==0 直接抛错：可见失败并保留收据记录。 */
function cleanupTlsReceipts(state: TlsStackState): void {
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
      cwd: tlsRepoRoot(state),
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
      `TLS stack receipt cleanup failed (rc=${String(result.status)}): ${detail}`,
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
    await stopTlsSupervisor(state);
    if (state.creating) {
      cleanupTlsReceipts(state);
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

export default async function globalTeardown(): Promise<void> {
  const stateFile = process.env.E2E_STACK_STATE_FILE;
  if (!stateFile) {
    return;
  }

  let state: StackState | TlsStackState;
  try {
    const metadata = await stat(stateFile);
    if (!metadata.isFile() || metadata.size > MAX_STATE_BYTES) {
      throw new Error("E2E stack state file is not a small regular file");
    }
    state = parseStackStateFile(await readFile(stateFile, "utf8"));
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

  let validationError: unknown;
  let restorationError: unknown;
  if (state.releaseMode === "synthetic-eval") {
    const expectedBeta = `BETA|true|${state.releasePolicyVersion}`;
    try {
      assertSyntheticReleaseGate(state, expectedBeta);
    } catch (error) {
      validationError = error;
    }
    try {
      // Restore even when the pre-destroy BETA assertion failed. If restore or
      // its terminal check fails, leave the stack intact for investigation.
      restoreSyntheticReleaseGate(state);
    } catch (error) {
      restorationError = error;
    }
  }

  if (restorationError) {
    throw validationError ? combineErrors(validationError, restorationError) : restorationError;
  }

  if (!state.keep) {
    await stopProcesses(state);
    removeContainers(state);
    const localStateFiles = [
      stateFile,
      `${stateFile}.auth.json`,
      `${stateFile}.shared-chat.json`,
      `${stateFile}.shared-memory.json`,
      `${stateFile}.shared-admin.json`,
    ];
    for (const localStateFile of localStateFiles) {
      try {
        await unlink(localStateFile);
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
      }
    }
  }

  if (validationError) {
    throw validationError;
  }
}
