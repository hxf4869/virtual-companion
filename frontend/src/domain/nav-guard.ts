// S0-18: unified H5 navigation guard. Server Admission Gate remains the
// security source; this module only restores the intended page after login
// and keeps frontend gate copy honest (unknown/blocked/ready).

import { REQUIRED_CONSENT_TYPES } from "./next-step";

export type PageClass = "public" | "login" | "age" | "consent" | "admin" | "protected";

export type SessionStatus = "unknown" | "anonymous" | "authenticated";

export type AdmissionGate = "unknown" | "blocked" | "ready";

export const OPERATOR_ROLES: ReadonlySet<string> = new Set([
  "ADMIN",
  "SAFETY_REVIEWER",
  "PRIVACY_OPERATOR",
  "OPS_VIEWER",
]);

export interface GateSnapshot {
  session: SessionStatus;
  role: string | null;
  ageKnown: boolean;
  ageLoadFailed: boolean;
  ageState: string | null;
  consentKnown: boolean;
  consentLoadFailed: boolean;
  grantedTypes: ReadonlyArray<string>;
}

const PUBLIC_PATHS = new Set([
  "/pages/index/index",
  "/pages/help/help",
  "/pages/ai-notice/ai-notice",
  "/pages/health/health",
]);

export function classifyPage(href: string): PageClass {
  const path = pathOf(href);
  if (path === "/pages/login/login") return "login";
  if (path === "/pages/age/age") return "age";
  if (path === "/pages/consent/consent") return "consent";
  if (path === "/pages/admin/admin" || path === "/pages/ops/ops") return "admin";
  if (PUBLIC_PATHS.has(path)) return "public";
  return "protected";
}

export function hrefFromLocation(loc: {
  pathname?: string;
  search?: string;
  hash?: string;
}): string {
  const hash = loc.hash ?? "";
  if (hash.startsWith("#/pages/")) {
    return hash.slice(1);
  }
  const pathname = loc.pathname ?? "";
  const idx = pathname.indexOf("/pages/");
  if (idx >= 0) {
    return pathname.slice(idx) + (loc.search ?? "");
  }
  if ((loc.search ?? "").includes("return=")) {
    return "/pages/login/login" + (loc.search ?? "");
  }
  return "/pages/index/index";
}

export function normalizeInternalHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) || value.startsWith("//")) {
    return null;
  }
  if (value.startsWith("#/pages/")) {
    value = value.slice(1);
  }
  if (!value.startsWith("/pages/")) return null;
  if (value.includes("..")) return null;
  const path = pathOf(value);
  if (path === "/pages/login/login") return null;
  return value;
}

export function buildLoginHref(fromHref: string): string {
  const internal = normalizeInternalHref(fromHref);
  if (!internal) return "/pages/login/login";
  if (classifyPage(internal) === "public") return "/pages/login/login";
  return `/pages/login/login?return=${encodeURIComponent(internal)}`;
}

export function parseReturnHref(loginHref: string): string | null {
  const query = queryOf(loginHref);
  return normalizeInternalHref(query.get("return"));
}

export function resolvePostLoginHref(
  loginHref: string,
  options: { fallback: string },
): string {
  return parseReturnHref(loginHref) ?? options.fallback;
}

export function resolveAdmissionGate(snapshot: GateSnapshot): AdmissionGate {
  if (snapshot.session === "unknown") return "unknown";
  if (snapshot.session === "anonymous") return "blocked";
  if (snapshot.ageLoadFailed || snapshot.consentLoadFailed) return "unknown";
  if (!snapshot.ageKnown || !snapshot.consentKnown) return "unknown";
  if (snapshot.ageState !== "ADULT_VERIFIED") return "blocked";
  const granted = new Set(snapshot.grantedTypes);
  if (REQUIRED_CONSENT_TYPES.some((type) => !granted.has(type))) return "blocked";
  return "ready";
}

export function applyInterceptorUrl(targetHref: string, snapshot: GateSnapshot): string {
  const href = targetHref.startsWith("/pages/") ? targetHref : normalizeInternalHref(targetHref) ?? targetHref;
  if (snapshot.session === "unknown") return href;
  const page = classifyPage(href);
  if (page === "public" || page === "login") return href;
  if (snapshot.session === "anonymous") {
    return buildLoginHref(href);
  }
  return href;
}

export function shouldRenderPageData(href: string, snapshot: GateSnapshot): boolean {
  const page = classifyPage(href);
  if (snapshot.session !== "authenticated") return false;
  if (page === "admin") {
    return snapshot.role !== null && OPERATOR_ROLES.has(snapshot.role);
  }
  return true;
}

export function installNavigationGuards(deps: {
  addInterceptor: (
    name: string,
    hooks: { invoke: (args: { url: string }) => void },
  ) => void;
  getSnapshot: () => GateSnapshot;
}): void {
  const hook = {
    invoke(args: { url: string }): void {
      args.url = applyInterceptorUrl(args.url, deps.getSnapshot());
    },
  };
  for (const name of ["navigateTo", "redirectTo", "reLaunch", "switchTab"] as const) {
    deps.addInterceptor(name, hook);
  }
}

function pathOf(href: string): string {
  const cut = href.indexOf("?");
  return cut >= 0 ? href.slice(0, cut) : href;
}

function queryOf(href: string): URLSearchParams {
  const cut = href.indexOf("?");
  return new URLSearchParams(cut >= 0 ? href.slice(cut + 1) : "");
}
