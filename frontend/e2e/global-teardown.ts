import { spawnSync } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";

const STATE_VERSION = 2;
const MAX_STATE_BYTES = 4096;
const TERM_GRACE_MS = 5_000;
const POLL_MS = 100;

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
    spawnSync(
      "docker",
      ["--context", state.dockerContext, "rm", "-f", container],
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

  let state: StackState;
  try {
    const metadata = await stat(stateFile);
    if (!metadata.isFile() || metadata.size > MAX_STATE_BYTES) {
      throw new Error("E2E stack state file is not a small regular file");
    }
    state = parseState(await readFile(stateFile, "utf8"));
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw error;
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
    for (const localStateFile of [stateFile, `${stateFile}.auth.json`]) {
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
