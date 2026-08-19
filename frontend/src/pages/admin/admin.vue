<template>
  <view class="admin-page">
    <view class="admin-header">
      <text class="admin-title">账户管理（ADMIN）</text>
      <button
        data-testid="nav-index"
        class="admin-nav-index"
        aria-label="返回边界台"
        @click="goTo('/pages/index/index')"
      >
        返回边界台
      </button>
    </view>

    <view
      v-if="auth.role !== 'ADMIN'"
      class="admin-notice"
      data-testid="admin-not-allowed"
      role="status"
    >
      <text>当前账号不是管理员，无法开通账户。</text>
    </view>

    <template v-else>
      <view class="admin-form">
        <input
          v-model="username"
          class="admin-input"
          data-testid="account-username"
          placeholder="用户名"
          aria-label="用户名"
          :disabled="busy"
        />
        <input
          v-model="password"
          class="admin-input"
          data-testid="account-password"
          placeholder="密码"
          aria-label="密码"
          type="password"
          :disabled="busy"
        />
        <input
          v-model="displayName"
          class="admin-input"
          data-testid="account-display-name"
          placeholder="显示名"
          aria-label="显示名"
          :disabled="busy"
        />
        <select
          v-model="role"
          class="admin-select"
          data-testid="account-role"
          aria-label="角色"
          :disabled="busy"
        >
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
        <button
          data-testid="create-account"
          class="admin-submit"
          :disabled="busy || !canSubmit"
          @click="onCreate"
        >
          {{ busy ? "开通中…" : "开通账户" }}
        </button>
      </view>

      <!-- ADMIN-ACCTS: the account registry with per-account disable. -->
      <view class="account-list">
        <view class="account-list-head">
          <text class="account-list-title">账户列表</text>
          <button
            data-testid="refresh-accounts"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshAccounts"
          >
            刷新
          </button>
        </view>
        <view v-if="loadFailed" class="admin-error" data-testid="account-load-failed" role="alert">
          <text>账户列表加载失败，请重试。</text>
        </view>
        <view
          v-for="account in accounts"
          :key="account.accountId"
          class="account-row"
          data-testid="account-row"
        >
          <text class="account-cell">{{ account.username }}</text>
          <text class="account-cell">{{ account.role }}</text>
          <text class="account-cell">{{ account.status }}</text>
          <text class="account-cell">{{ account.displayName }}</text>
          <button
            v-if="account.status === 'ACTIVE' && account.accountId !== auth.accountId"
            size="mini"
            data-testid="disable-account"
            :disabled="busy"
            @click="onDisable(account)"
          >
            禁用
          </button>
        </view>
      </view>

      <view v-if="result" class="admin-result" data-testid="account-result" role="status">
        <text>已开通：{{ result.username }}（{{ result.role }}，状态 {{ result.status }}）</text>
      </view>
      <view v-if="failed" class="admin-error" data-testid="account-failed" role="alert">
        <text>开通失败，请检查输入或权限（不会披露用户名是否存在）。</text>
      </view>

      <!-- ADMIN-OPS: per-day usage/cost summary -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">用量与成本（近 14 天）</text>
          <button
            data-testid="refresh-usage"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshUsage"
          >
            刷新
          </button>
        </view>
        <view v-if="usageFailed" class="admin-error" data-testid="usage-failed" role="alert">
          <text>用量统计加载失败，请重试。</text>
        </view>
        <view v-if="usageRows.length > 0" class="usage-table" data-testid="usage-table">
          <view v-for="row in usageRows" :key="row.day" class="usage-row" data-testid="usage-row">
            <text class="usage-cell">{{ row.day }}</text>
            <text class="usage-cell">{{ row.generations }} 轮</text>
            <text class="usage-cell">{{ row.inputTokens }} / {{ row.outputTokens }} tokens</text>
            <text class="usage-cell">{{ row.cost.toFixed(6) }}</text>
          </view>
        </view>
        <view v-else-if="!usageFailed" class="admin-empty" data-testid="usage-empty">
          <text>暂无已结算的生成用量。</text>
        </view>
      </view>

      <!-- ADMIN-OPS: append-only audit trail -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">审计日志</text>
          <button
            data-testid="refresh-audit"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshAudit"
          >
            刷新
          </button>
        </view>
        <view v-if="auditFailed" class="admin-error" data-testid="audit-failed" role="alert">
          <text>审计日志加载失败，请重试。</text>
        </view>
        <view
          v-for="event in auditEvents"
          :key="event.id"
          class="audit-row"
          data-testid="audit-row"
        >
          <text class="audit-cell">{{ event.eventType }}</text>
          <text class="audit-cell">{{ event.username }}</text>
          <text class="audit-cell">{{ event.occurredAt }}</text>
        </view>
        <button
          v-if="auditHasMore"
          data-testid="audit-load-more"
          class="admin-nav-index"
          :disabled="busy"
          @click="onLoadMoreAudit"
        >
          加载更早
        </button>
      </view>

      <!-- SAFETY-QUEUE (V59): read-only deterministic safety queue; triage
           stays a human action outside this page. -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">安全事件队列（只读）</text>
          <button
            data-testid="refresh-safety"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshSafety"
          >
            刷新
          </button>
        </view>
        <view v-if="safetyFailed" class="admin-error" data-testid="safety-failed" role="alert">
          <text>安全事件加载失败，请重试。</text>
        </view>
        <view
          v-else-if="safetyEvents.length === 0"
          class="admin-empty"
          data-testid="safety-empty"
        >
          <text>暂无安全事件。</text>
        </view>
        <view
          v-for="event in safetyEvents"
          :key="event.id"
          class="audit-row"
          data-testid="safety-row"
        >
          <text class="audit-cell">{{ event.riskLevel }}</text>
          <text class="audit-cell">{{ event.stage }}</text>
          <text class="audit-cell">{{ event.ruleId }}</text>
          <text class="audit-cell">账号 {{ event.ownerId }}</text>
          <text class="audit-cell">{{ event.createdAt }}</text>
        </view>
      </view>

      <!-- ENT-SNAP (V40): simulated service-class assignment -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">权益分配（模拟 ECONOMY / PREMIUM）</text>
          <button
            data-testid="refresh-service-classes"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshServiceClasses"
          >
            刷新
          </button>
        </view>
        <view v-if="scFailed" class="admin-error" data-testid="service-class-failed" role="alert">
          <text>权益分配加载失败，请重试。</text>
        </view>
        <view class="sc-form">
          <select
            v-model="scAccountId"
            class="admin-select"
            data-testid="sc-account"
            aria-label="目标账户"
            :disabled="busy"
          >
            <option value="">选择账户</option>
            <option v-for="acc in accounts" :key="acc.accountId" :value="acc.accountId">
              {{ acc.username }}
            </option>
          </select>
          <select
            v-model="scClass"
            class="admin-select"
            data-testid="sc-class"
            aria-label="权益等级"
            :disabled="busy"
          >
            <option value="ECONOMY">ECONOMY</option>
            <option value="PREMIUM">PREMIUM</option>
          </select>
          <button
            data-testid="sc-assign"
            class="admin-nav-index"
            :disabled="busy || !scAccountId"
            @click="onAssignServiceClass"
          >
            分配
          </button>
        </view>
        <view
          v-for="row in scAssignments"
          :key="row.accountId"
          class="audit-row"
          data-testid="sc-row"
        >
          <text class="audit-cell">{{ row.username }}</text>
          <text class="audit-cell">{{ row.serviceClass }}</text>
        </view>
        <view v-if="scResult" class="admin-result" data-testid="sc-result" role="status">
          <text>{{ `已分配：${scResult.username} → ${scResult.serviceClass}` }}</text>
        </view>
      </view>
    </template>
  </view>
</template>

<script lang="ts">
// ADMIN-UI: internal account provisioning page. Backed by POST
// /api/v1/auth/admin/accounts (ADMIN only). A non-OK response maps to null via
// the typed auth client and the page shows one generic failure message — it
// never discloses whether a username already exists (INV-TENANT-001). The
// backend rejects non-ADMIN callers; the page additionally gates the form on
// the local role for honest UX. Passwords are sent once over the authenticated
// transport and never persisted or logged.
import { computed, defineComponent, onMounted, ref } from "vue";

import {
  assignServiceClass,
  createAccount,
  disableAccount,
  listAccounts,
  listAuditEvents,
  listSafetyEvents,
  listServiceClassAssignments,
  usageSummary,
  type AccountListItem,
  type AuditEventListItem,
  type SafetyEventItem,
  type ServiceClassAssignmentItem,
  type UsageSummaryItem,
} from "@/api/auth";
import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";

/** ADMIN-OPS: audit page size (the server clamps its own band). */
const AUDIT_PAGE_SIZE = 50;

export default defineComponent({
  name: "AdminPage",
  setup() {
    const auth = useAuthStore();
    const username = ref("");
    const password = ref("");
    const displayName = ref("");
    const role = ref("USER");
    const busy = ref(false);
    const result = ref<{
      accountId: string;
      username: string;
      role: string;
      status: string;
    } | null>(null);
    const failed = ref(false);
    // ADMIN-ACCTS: the account registry loaded on mount and after mutations.
    const accounts = ref<AccountListItem[]>([]);
    const loadFailed = ref(false);
    // ADMIN-OPS: usage summary + audit trail state.
    const usageRows = ref<UsageSummaryItem[]>([]);
    const usageFailed = ref(false);
    const auditEvents = ref<AuditEventListItem[]>([]);
    const auditFailed = ref(false);
    const auditHasMore = ref(false);
    // SAFETY-QUEUE (V59): read-only deterministic safety queue.
    const safetyEvents = ref<SafetyEventItem[]>([]);
    const safetyFailed = ref(false);
    // ENT-SNAP: simulated service-class assignments.
    const scAssignments = ref<ServiceClassAssignmentItem[]>([]);
    const scFailed = ref(false);
    const scAccountId = ref("");
    const scClass = ref<"ECONOMY" | "PREMIUM">("ECONOMY");
    const scResult = ref<{ username: string; serviceClass: string } | null>(null);

    // SESS-REVIVE: a 401 first tries one silent refresh and replays the request.
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    // SESS-REVIVE: restore the session from the HttpOnly refresh cookie on mount.
    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      // ADMIN-ACCTS: the registry is loaded once the session state is known.
      await refreshAccounts();
      // ADMIN-OPS: usage + audit load only for admins.
      if (auth.role === "ADMIN") {
        await refreshUsage();
        await refreshAudit();
        await refreshSafety();
        await refreshServiceClasses();
      }
    });

    /** ADMIN-OPS: reload the usage summary (non-fatal failure keeps rows). */
    async function refreshUsage(): Promise<void> {
      usageFailed.value = false;
      try {
        usageRows.value = await usageSummary(transport, 14);
      } catch {
        usageFailed.value = true;
      }
    }

    async function onRefreshUsage(): Promise<void> {
      busy.value = true;
      try {
        await refreshUsage();
      } finally {
        busy.value = false;
      }
    }

    /** ADMIN-OPS: reload the first audit page (newest first). */
    async function refreshAudit(): Promise<void> {
      auditFailed.value = false;
      try {
        const page = await listAuditEvents(transport, undefined, AUDIT_PAGE_SIZE);
        auditEvents.value = page;
        auditHasMore.value = page.length >= AUDIT_PAGE_SIZE;
      } catch {
        auditFailed.value = true;
      }
    }

    async function onRefreshAudit(): Promise<void> {
      busy.value = true;
      try {
        await refreshAudit();
      } finally {
        busy.value = false;
      }
    }

    /** ADMIN-OPS: append an older audit page (exclusive after cursor). */
    async function onLoadMoreAudit(): Promise<void> {
      if (busy.value || !auditHasMore.value) return;
      const last = auditEvents.value[auditEvents.value.length - 1];
      if (!last) return;
      busy.value = true;
      try {
        const page = await listAuditEvents(transport, last.id, AUDIT_PAGE_SIZE);
        auditEvents.value = [...auditEvents.value, ...page];
        auditHasMore.value = page.length >= AUDIT_PAGE_SIZE;
      } catch {
        auditFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    /** SAFETY-QUEUE (V59): reload the newest safety queue page (read-only). */
    async function refreshSafety(): Promise<void> {
      safetyFailed.value = false;
      try {
        safetyEvents.value = await listSafetyEvents(transport, undefined, 50);
      } catch {
        safetyFailed.value = true;
      }
    }

    async function onRefreshSafety(): Promise<void> {
      busy.value = true;
      try {
        await refreshSafety();
      } finally {
        busy.value = false;
      }
    }

    /** ENT-SNAP: reload the assignment registry (non-fatal). */
    async function refreshServiceClasses(): Promise<void> {
      scFailed.value = false;
      try {
        scAssignments.value = await listServiceClassAssignments(transport);
      } catch {
        scFailed.value = true;
      }
    }

    async function onRefreshServiceClasses(): Promise<void> {
      busy.value = true;
      try {
        await refreshServiceClasses();
      } finally {
        busy.value = false;
      }
    }

    /** ENT-SNAP: assign a simulated service class and refresh the registry. */
    async function onAssignServiceClass(): Promise<void> {
      if (busy.value || !scAccountId.value) return;
      busy.value = true;
      scResult.value = null;
      try {
        const applied = await assignServiceClass(
          transport,
          scAccountId.value,
          scClass.value,
        );
        if (applied) {
          const account = accounts.value.find((a) => a.accountId === scAccountId.value);
          scResult.value = {
            username: account?.username ?? scAccountId.value,
            serviceClass: applied,
          };
          await refreshServiceClasses();
        } else {
          scFailed.value = true;
        }
      } catch {
        scFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    /** ADMIN-ACCTS: reload the registry (non-fatal failure keeps the list). */
    async function refreshAccounts(): Promise<void> {
      loadFailed.value = false;
      try {
        accounts.value = await listAccounts(transport);
      } catch {
        loadFailed.value = true;
      }
    }

    async function onRefreshAccounts(): Promise<void> {
      busy.value = true;
      try {
        await refreshAccounts();
      } finally {
        busy.value = false;
      }
    }

    /** ADMIN-ACCTS: disable one account; the row flips on a confirmed result. */
    async function onDisable(account: AccountListItem): Promise<void> {
      busy.value = true;
      try {
        const disabled = await disableAccount(transport, account.accountId);
        if (disabled) {
          accounts.value = accounts.value.map((a) =>
            a.accountId === account.accountId ? { ...a, status: "DISABLED" } : a,
          );
        } else {
          loadFailed.value = true;
        }
      } catch {
        loadFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    const canSubmit = computed(
      () =>
        username.value.trim().length > 0 &&
        password.value.length > 0 &&
        displayName.value.trim().length > 0,
    );

    async function onCreate(): Promise<void> {
      if (!canSubmit.value || busy.value) return;
      busy.value = true;
      failed.value = false;
      result.value = null;
      try {
        const created = await createAccount(
          transport,
          username.value.trim(),
          password.value,
          displayName.value.trim(),
          role.value,
        );
        if (created) {
          result.value = created;
          password.value = "";
        } else {
          failed.value = true;
        }
      } catch {
        failed.value = true;
      } finally {
        busy.value = false;
      }
    }

    function goTo(url: string): void {
      try {
        const uniApi = (globalThis as Record<string, unknown>).uni as
          | { navigateTo?: (options: { url: string }) => void }
          | undefined;
        if (uniApi?.navigateTo) {
          uniApi.navigateTo({ url });
        } else if (typeof location !== "undefined") {
          location.href = url;
        }
      } catch {
        // Presentation-only navigation.
      }
    }

    return {
      auth,
      username,
      password,
      displayName,
      role,
      busy,
      result,
      failed,
      accounts,
      loadFailed,
      usageRows,
      usageFailed,
      auditEvents,
      auditFailed,
      auditHasMore,
      safetyEvents,
      safetyFailed,
      onRefreshSafety,
      scAssignments,
      scFailed,
      scAccountId,
      scClass,
      scResult,
      canSubmit,
      onCreate,
      onRefreshAccounts,
      onDisable,
      onRefreshUsage,
      onRefreshAudit,
      onLoadMoreAudit,
      onRefreshServiceClasses,
      onAssignServiceClass,
      goTo,
    };
  },
});
</script>

<style scoped>
.admin-page {
  padding: 24rpx;
  background-color: #14213d;
  color: #f5f5f5;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-bottom: 24rpx;
}
.admin-title {
  font-size: 32rpx;
  font-weight: 600;
}
.admin-nav-index {
  flex: 0 0 auto;
  background-color: #2a3a5a;
  color: #ffffff;
  font-size: 24rpx;
  font-weight: 600;
}
.admin-notice {
  padding: 24rpx;
  background-color: #5a1a1a;
  border-radius: 12rpx;
}
.admin-form {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  max-width: 640rpx;
}
.admin-input,
.admin-select {
  padding: 16rpx;
  border-radius: 12rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  color: #f5f5f5;
  font-size: 28rpx;
}
.admin-submit {
  background-color: #2a6a9a;
  color: #ffffff;
}
.account-list {
  margin-top: 32rpx;
  max-width: 800rpx;
}
.account-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}
.account-list-title {
  font-size: 28rpx;
  font-weight: 600;
}
.account-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 12rpx;
  border-radius: 12rpx;
  background-color: #1c2b4a;
  margin-bottom: 8rpx;
  font-size: 24rpx;
}
.account-cell {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.admin-result {
  margin-top: 24rpx;
  padding: 16rpx;
  background-color: #1a3a2a;
  border-radius: 12rpx;
  font-size: 26rpx;
}
.admin-error {
  margin-top: 24rpx;
  padding: 16rpx;
  background-color: #5a1a1a;
  border-radius: 12rpx;
  font-size: 26rpx;
}
/* ADMIN-OPS: usage + audit sections */
.ops-section {
  margin-top: 32rpx;
}
.usage-table {
  margin-top: 12rpx;
  border-radius: 12rpx;
  overflow: hidden;
  border: 2rpx solid #2a3a5a;
}
.usage-row,
.audit-row {
  display: flex;
  gap: 12rpx;
  padding: 12rpx 16rpx;
  background-color: #1c2b4a;
  font-size: 24rpx;
  border-bottom: 2rpx solid #2a3a5a;
}
.usage-row:last-child,
.audit-row:last-child {
  border-bottom: none;
}
.usage-cell,
.audit-cell {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.admin-empty {
  margin-top: 12rpx;
  padding: 16rpx;
  background-color: #1c2b4a;
  border-radius: 12rpx;
  font-size: 24rpx;
  color: #8fa0bd;
}
/* ENT-SNAP: assignment form row */
.sc-form {
  display: flex;
  gap: 12rpx;
  margin-top: 12rpx;
  flex-wrap: wrap;
}
</style>
