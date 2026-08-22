// S0-18 runtime wiring: uni interceptors + first-load enforce after session
// resolution. Pure routing rules live in nav-guard.ts.

import { createAuthenticatedTransport } from "@/api/transport";
import {
  applyInterceptorUrl,
  hrefFromLocation,
  installNavigationGuards,
  type GateSnapshot,
} from "@/domain/nav-guard";
import { useAuthStore } from "@/stores/auth";

export function currentAuthSnapshot(): GateSnapshot {
  const auth = useAuthStore();
  return {
    session: auth.sessionStatus,
    role: auth.role,
    ageKnown: false,
    ageLoadFailed: false,
    ageState: null,
    consentKnown: false,
    consentLoadFailed: false,
    grantedTypes: [],
  };
}

function redirectTo(url: string): void {
  try {
    const uniApi = (globalThis as Record<string, unknown>).uni as
      | { redirectTo?: (options: { url: string }) => void }
      | undefined;
    if (uniApi?.redirectTo) {
      uniApi.redirectTo({ url });
    } else if (typeof location !== "undefined") {
      location.href = url;
    }
  } catch {
    // Presentation-only navigation.
  }
}

export function enforceAppRoute(): void {
  if (typeof location === "undefined") return;
  const current = hrefFromLocation(location);
  const next = applyInterceptorUrl(current, currentAuthSnapshot());
  if (next !== current) {
    redirectTo(next);
  }
}

export function attachAppNavigationGuards(): void {
  const uniApi = (globalThis as Record<string, unknown>).uni as
    | {
        addInterceptor?: (
          name: string,
          hooks: { invoke: (args: { url: string }) => void },
        ) => void;
      }
    | undefined;
  if (!uniApi?.addInterceptor) return;
  installNavigationGuards({
    addInterceptor: (name, hooks) => {
      uniApi.addInterceptor?.(name, hooks);
    },
    getSnapshot: currentAuthSnapshot,
  });
}

export function bootstrapAuthSession(): void {
  const auth = useAuthStore();
  const transport = createAuthenticatedTransport({
    getAccessToken: () => auth.accessToken,
    renewAccessToken: () => auth.renewAccessToken(transport),
    onUnauthorized: () => auth.onUnauthorized(),
  });
  void auth.tryRefresh(transport).then(() => enforceAppRoute());
}
