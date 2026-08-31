import type { AuthTransport } from "@/api/auth";
import { getServiceMode, type ServiceModeStatus } from "@/api/chat";
import { listModelProviders, type ModelProvider } from "@/api/providers";
import { fetchVersion, type VersionInfo } from "@/api/version";

export type ProbeKind = "liveness" | "readiness";
export type ProbeState = "up" | "down" | "unavailable";

export interface RuntimeProbe {
  kind: ProbeKind;
  path: string;
  state: ProbeState;
  httpStatus: number | null;
  durationMs: number | null;
  checkedAt: string;
}

export interface AdminRuntimeSnapshot {
  checkedAt: string;
  providers: ModelProvider[] | null;
  serviceMode: ServiceModeStatus | null;
  version: VersionInfo | null;
  liveness: RuntimeProbe;
  readiness: RuntimeProbe;
}

const PROBE_PATHS: Record<ProbeKind, string> = {
  liveness: "/actuator/health/liveness",
  readiness: "/actuator/health/readiness",
};

export async function fetchRuntimeProbe(
  t: AuthTransport,
  kind: ProbeKind,
): Promise<RuntimeProbe> {
  const path = PROBE_PATHS[kind];
  const started = now();
  const checkedAt = new Date().toISOString();
  try {
    const response = await t.request("GET", path);
    const body = response.json as Record<string, unknown> | null;
    const status = body && typeof body.status === "string" ? body.status : "";
    return {
      kind,
      path,
      state: response.ok && status === "UP" ? "up" : status === "DOWN" ? "down" : "unavailable",
      httpStatus: response.status,
      durationMs: Math.max(0, Math.round(now() - started)),
      checkedAt,
    };
  } catch {
    return {
      kind,
      path,
      state: "unavailable",
      httpStatus: null,
      durationMs: null,
      checkedAt,
    };
  }
}

export async function loadAdminRuntimeSnapshot(
  t: AuthTransport,
): Promise<AdminRuntimeSnapshot> {
  const [providers, serviceMode, version, liveness, readiness] = await Promise.allSettled([
    listModelProviders(t),
    getServiceMode(t),
    fetchVersion(t),
    fetchRuntimeProbe(t, "liveness"),
    fetchRuntimeProbe(t, "readiness"),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    providers: providers.status === "fulfilled" ? providers.value : null,
    serviceMode: serviceMode.status === "fulfilled" ? serviceMode.value : null,
    version: version.status === "fulfilled" ? version.value : null,
    liveness: liveness.status === "fulfilled" ? liveness.value : unavailableProbe("liveness"),
    readiness: readiness.status === "fulfilled" ? readiness.value : unavailableProbe("readiness"),
  };
}

function unavailableProbe(kind: ProbeKind): RuntimeProbe {
  return {
    kind,
    path: PROBE_PATHS[kind],
    state: "unavailable",
    httpStatus: null,
    durationMs: null,
    checkedAt: new Date().toISOString(),
  };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
