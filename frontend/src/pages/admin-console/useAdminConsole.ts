import { ref, type Ref } from "vue";

import type { AuthTransport } from "@/api/auth";
import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";

export type AdminAccessState = "checking" | "ready" | "forbidden" | "unavailable";

export interface AdminConsoleAccess {
  accessState: Ref<AdminAccessState>;
  transport: AuthTransport;
  ensureAccess(): Promise<boolean>;
  goTo(url: string, replace?: boolean): void;
}

export function useAdminConsoleAccess(): AdminConsoleAccess {
  const auth = useAuthStore();
  const accessState = ref<AdminAccessState>("checking");
  const transport = createAuthenticatedTransport({
    getAccessToken: () => auth.accessToken,
    renewAccessToken: () => auth.renewAccessToken(transport),
    getAccountId: () => auth.accountId,
    getSessionRevision: () => auth.getSessionRevision(),
    onUnauthorized: () => auth.onUnauthorized(),
    // VC-R52 期望账号失配恢复：先作废旧本地归属再读当前 Cookie 身份，不
    // 自动重放动作（共享入口见 stores/auth.ts reconcileAccountContext）。
    onAccountContextChanged: () => {
      void auth.reconcileAccountContext(transport);
    },
  });

  async function ensureAccess(): Promise<boolean> {
    accessState.value = "checking";
    if (!auth.isAuthenticated) {
      const restored = await auth.tryRefresh(transport);
      if (!restored && auth.error === "refresh-failed") {
        accessState.value = "unavailable";
        return false;
      }
    }
    accessState.value = auth.isAuthenticated && auth.role === "ADMIN"
      ? "ready"
      : "forbidden";
    return accessState.value === "ready";
  }

  function goTo(url: string, replace = true): void {
    try {
      const uniApi = (globalThis as Record<string, unknown>).uni as
        | {
          redirectTo?: (options: { url: string }) => void;
          navigateTo?: (options: { url: string }) => void;
        }
        | undefined;
      if (replace && uniApi?.redirectTo) {
        uniApi.redirectTo({ url });
      } else if (uniApi?.navigateTo) {
        uniApi.navigateTo({ url });
      } else if (typeof location !== "undefined") {
        location.href = url.startsWith("/pages/") ? `/#${url}` : url;
      }
    } catch {
      // Navigation must never break status rendering or a confirmed write.
    }
  }

  return { accessState, transport, ensureAccess, goTo };
}
