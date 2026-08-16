// VERSION-UI: typed client for the public GET /api/v1/version contract
// (OpenAPI getVersion / VersionResponse). The endpoint is unauthenticated by
// contract, but the H5 边界台 requests it through the shared authenticated
// transport anyway so the call path stays uniform (and a future tightening of
// the endpoint keeps working). Any transport failure degrades to null — the
// stamp simply stays empty, never blocking the page.
import type { AuthTransport } from "@/api/auth";

export const VERSION_ENDPOINT = "/api/v1/version";

export interface VersionInfo {
  version: string;
  commit: string;
}

export async function fetchVersion(t: AuthTransport): Promise<VersionInfo | null> {
  const r = await t.request("GET", VERSION_ENDPOINT);
  if (!r.ok) {
    return null;
  }
  const json = r.json as Record<string, unknown> | null;
  if (!json || typeof json.version !== "string" || json.version.length === 0) {
    return null;
  }
  return {
    version: json.version,
    commit: typeof json.commit === "string" ? json.commit : "",
  };
}
