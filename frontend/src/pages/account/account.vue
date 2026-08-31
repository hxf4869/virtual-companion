<!-- ACCT-PAGE: account identity, logout, and self-service deletion.
Reuses POST /auth/logout and DELETE /auth/account. No register, no payment. -->
<template>
  <!-- DOGFOOD-09：页面容器声明 main landmark，页面标题声明一级标题语义。 -->
  <ConsumerShell route="/pages/account/account">



    <view v-if="!auth.isAuthenticated" class="notice" data-testid="account-signed-out" role="status">
      <text>当前未登录。登录后再查看账号或注销。</text>
      <button data-testid="nav-login" class="nav-index" @click="goTo('/pages/login/login')">登录</button>
    </view>

    <template v-else>
      <view class="account-overview">
        <text class="account-overview__title">你的陪伴空间</text>
        <text class="account-overview__copy">关系、记忆与数据始终由你决定如何保留。</text>
      </view>

      <!-- "我的"分组导航枢纽：每行一个清楚任务；分组名独立分隔行。 -->
      <nav class="hub" data-testid="me-hub" aria-label="我的分组入口">
        <template v-for="group in groupedHubEntries" :key="group.name">
          <text class="hub-group" role="presentation">{{ group.name }}</text>
          <button
            v-for="entry in group.entries"
            :key="entry.href"
            class="row-link"
            :data-testid="`me-${entry.testid}`"
            @click="goTo(entry.href)"
          >
            <text class="hub-copy">
              <text class="hub-label">{{ entry.label }}</text>
            </text>
            <text class="hub-note">{{ entry.note }}</text>
            <AppIcon class="hub-chevron" name="chevron-right" :size="18" />
          </button>
        </template>
      </nav>

      <!-- Internal Shell 入口：仅操作者角色可见；普通用户看不到入口与
           内部数据轮廓。 -->
      <nav
        v-if="operatorVisible"
        class="hub hub--internal"
        data-testid="me-internal"
        aria-label="内部入口"
      >
        <text class="hub-group" role="presentation">内部</text>
        <button
          v-for="entry in visibleInternalEntries"
          :key="entry.href"
          class="row-link"
          :data-testid="`me-${entry.testid}`"
          @click="goTo(entry.href)"
        >
          <text class="hub-copy">
            <text class="hub-label">{{ entry.label }}</text>
          </text>
          <text class="hub-note">{{ entry.note }}</text>
          <AppIcon class="hub-chevron" name="chevron-right" :size="18" />
        </button>
      </nav>

      <!-- 账号与安全：改密、会话管理、登出；账号编号与角色是次要信息。 -->
      <text class="hub-group" role="presentation">账号与安全</text>
      <view class="card" data-testid="password-card">
        <text class="label">修改密码</text>
        <text v-if="auth.passwordMustChange" class="error" data-testid="password-required">
          管理员设置了临时密码。完成修改前只能修改密码、刷新或登出。
        </text>
        <input
          v-model="currentPassword"
          data-testid="current-password"
          class="account-input"
          type="password"
          autocomplete="current-password"
          placeholder="当前密码"
          aria-label="当前密码"
        />
        <input
          v-model="newPassword"
          data-testid="new-password"
          class="account-input"
          type="password"
          autocomplete="new-password"
          placeholder="新密码"
          aria-label="新密码"
        />
        <input
          v-model="confirmPassword"
          data-testid="confirm-password"
          class="account-input"
          type="password"
          autocomplete="new-password"
          placeholder="再次输入新密码"
          aria-label="确认新密码"
        />
        <button
          data-testid="change-password"
          class="nav-index"
          :disabled="busy || !canChangePassword"
          @click="onChangePassword"
        >
          修改并撤销全部旧会话
        </button>
        <text v-if="passwordMessage" class="meta" data-testid="password-message">
          {{ passwordMessage }}
        </text>
      </view>

      <view v-if="!auth.passwordMustChange" class="card" data-testid="sessions-card">
        <view class="actions">
          <button class="nav-index" data-testid="sessions-refresh" :disabled="busy" @click="loadSessions">
            刷新会话
          </button>
          <button class="nav-index danger-btn" data-testid="sessions-revoke-all" :disabled="busy" @click="onRevokeAll">
            撤销全部会话
          </button>
        </view>
        <text v-if="sessionsFailed" class="error" data-testid="sessions-error" role="alert">
          会话加载失败，当前列表已保留。请点击“刷新会话”重试。
        </text>
        <view v-if="sessionsActionError" class="error" data-testid="sessions-action-error" role="alert">
          <text>{{ sessionsActionError }}</text>
        </view>
        <text v-if="!sessionsFailed && !sessionsActionError && sessions.length === 0" class="meta">
          暂无有效会话。
        </text>
        <view v-for="session in sessions" :key="session.id" class="session-row" data-testid="session-row">
          <text>{{ session.clientLabel || "客户端" }}{{ session.current ? "（当前）" : "" }}</text>
          <text class="meta">最近使用：{{ formatLocalDateTime(session.lastSeenAt) }}；到期：{{ formatLocalDateTime(session.expiresAt) }}</text>
          <button
            class="nav-index"
            data-testid="session-revoke"
            :disabled="busy"
            @click="onRevokeSession(session.id)"
          >
            撤销该会话
          </button>
        </view>
      </view>

      <button data-testid="account-logout" class="nav-index" :disabled="busy" @click="onLogout">
        登出
      </button>

      <view class="card" data-testid="public-computer-hint">
        <text class="label">公共电脑提示</text>
        <text class="meta">在公共或共用电脑上使用后，请「登出」并关闭页面；建议使用浏览器无痕模式。登出会清除本机缓存的会话数据。</text>
      </view>

      <view class="account-meta" data-testid="account-card">
        <text class="meta">账号编号 <text data-testid="account-id">{{ auth.accountId ?? "未知" }}</text></text>
        <text class="meta">角色 <text data-testid="account-role">{{ accountRoleLabel(auth.role) }}</text></text>
      </view>

      <view class="danger">
        <text class="label">注销账号</text>
        <text class="meta">注销会删除本账号的业务数据，且无法恢复登录。合规审计日志按既定保留期留存。</text>
        <button
          data-testid="delete-account-open"
          class="nav-index danger-btn"
          :disabled="busy"
          @click="deleteOpen = true"
        >
          注销账号
        </button>
        <view v-if="deleteOpen" class="card" data-testid="delete-account-confirm">
          <text>
            注销后：业务数据（聊天、记忆、同意记录、导出）将立即删除；
            合规审计日志无法立即清除，将按既定保留期留存；注销后无法恢复登录。
          </text>
          <input
            v-model="deletePassword"
            data-testid="delete-account-password"
            class="account-input"
            type="password"
            autocomplete="current-password"
            placeholder="当前密码（注销前需重新输入）"
            aria-label="注销确认当前密码"
          />
          <view class="actions">
            <button data-testid="delete-account-cancel" class="nav-index" :disabled="busy" @click="closeDelete">
              取消
            </button>
            <button
              data-testid="delete-account-confirm-btn"
              class="nav-index danger-btn"
              :disabled="busy"
              @click="onConfirmDelete"
            >
              {{ busy ? "注销中…" : "确认注销" }}
            </button>
          </view>
          <text v-if="deleteError" class="error" data-testid="delete-account-error">{{ deleteError }}</text>
        </view>
      </view>
    </template>
  </ConsumerShell>
</template>

<script lang="ts">
import { computed, onMounted, ref } from "vue";

import {
  changeAuthPassword,
  deleteAccount,
  listAuthSessions,
  revokeAllAuthSessions,
  revokeAuthSession,
  type AuthSession,
} from "@/api/auth";
import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { goTo } from "@/app/navigate";
import { isVisibleToRole, routeSpecOf } from "@/app/navigation";
import AppIcon from "@/design-system/AppIcon.vue";
import { accountRoleLabel } from "@/domain/account-display";
import { formatLocalDateTime } from "@/domain/timestamp";
import { useAuthStore } from "@/stores/auth";

export default {
  name: "AccountPage",
  components: { AppIcon, ConsumerShell },
  setup() {
    // "我的"分组导航（静态 IA 数据；运行时消费导航模型的分组）。
    const HUB_ENTRIES = [
      { group: "陪伴", label: "陪伴设置", note: "称呼、偏好与危险操作", href: "/pages/companion/companion", testid: "companion" },
      { group: "隐私与 AI", label: "无痕默认", note: "下次新会话是否默认无痕", href: "/pages/incognito/incognito", testid: "incognito" },
      { group: "隐私与 AI", label: "成年状态", note: "查看与运行模拟核验", href: "/pages/age/age", testid: "age" },
      { group: "隐私与 AI", label: "同意管理", note: "版本化同意与撤回", href: "/pages/consent/consent", testid: "consent" },
      { group: "隐私与 AI", label: "AI 说明", note: "模型与 AI 标识", href: "/pages/ai-notice/ai-notice", testid: "ai-notice" },
      { group: "数据", label: "我的数据", note: "账号数据汇总", href: "/pages/data/data", testid: "data" },
      { group: "数据", label: "数据导出", note: "二次认证后异步导出", href: "/pages/export/export", testid: "export" },
      { group: "帮助", label: "帮助与反馈", note: "边界说明与支持", href: "/pages/help/help", testid: "help" },
      { group: "帮助", label: "举报和申诉", note: "人工处理，不编造工单", href: "/pages/report/report", testid: "report" },
    ] as const;
    const INTERNAL_ENTRIES = [
      { group: "内部", label: "后台控制台", note: "运行状态、模型服务与路由策略", href: "/pages/admin/admin", testid: "admin" },
    ] as const;
    // 账号页只显示当前角色真正可进入的内部入口（route-specific allowedRoles）。
    const groupedHubEntries = computed(() => {
      const groups: Array<{ name: string; entries: typeof HUB_ENTRIES[number][] }> = [];
      for (const entry of HUB_ENTRIES) {
        const last = groups[groups.length - 1];
        if (last && last.name === entry.group) {
          last.entries.push(entry);
        } else {
          groups.push({ name: entry.group, entries: [entry] });
        }
      }
      return groups;
    });
    const visibleInternalEntries = computed(() =>
      INTERNAL_ENTRIES.filter((entry) => {
        const spec = routeSpecOf(entry.href);
        return spec ? isVisibleToRole(spec, auth.role) : false;
      }),
    );
    const operatorVisible = computed(() => visibleInternalEntries.value.length > 0);

    const auth = useAuthStore();
    const deleteOpen = ref(false);
    const deleteError = ref("");
    // ADR-0006 §7.7 (DOGFOOD-08): the destructive deletion requires the
    // freshly re-entered CURRENT password; the server verifies it fail-closed.
    const deletePassword = ref("");
    const busy = ref(false);
    const sessions = ref<AuthSession[]>([]);
    const sessionsFailed = ref(false);
    const sessionsActionError = ref("");
    const currentPassword = ref("");
    const newPassword = ref("");
    const confirmPassword = ref("");
    const passwordMessage = ref("");
    const canChangePassword = computed(() =>
      currentPassword.value.length > 0
      && newPassword.value.length >= 12
      && newPassword.value === confirmPassword.value);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      if (auth.isAuthenticated && !auth.passwordMustChange) {
        await loadSessions();
      }
    });


    async function loadSessions(): Promise<void> {
      sessionsFailed.value = false;
      sessionsActionError.value = "";
      try {
        sessions.value = await listAuthSessions(transport);
      } catch {
        sessionsFailed.value = true;
      }
    }

    async function onRevokeSession(sessionId: string): Promise<void> {
      if (busy.value) return;
      busy.value = true;
      sessionsActionError.value = "";
      const revokedSession = sessions.value.find((session) => session.id === sessionId);
      try {
        const ok = await revokeAuthSession(transport, sessionId);
        if (!ok) {
          // A refusal or server error is not proof that the current login is
          // invalid. Keep both the identity and the last known list so the
          // user can retry without losing context.
          if (auth.isAuthenticated) {
            sessionsActionError.value = "撤销该会话失败，当前登录和会话列表已保留。请再次点击“撤销该会话”重试。";
          }
          return;
        }

        if (revokedSession?.current) {
          // Only revoking the browser's current session can invalidate this
          // page's login. Read the real post-revoke state before deciding
          // whether to stay or go to login.
          try {
            const latestSessions = await listAuthSessions(transport);
            if (latestSessions.length === 0) {
              auth.clear();
              goTo("/pages/login/login");
              return;
            }
            sessions.value = latestSessions;
            sessionsFailed.value = false;
          } catch {
            if (!auth.isAuthenticated) {
              goTo("/pages/login/login");
              return;
            }
            sessionsActionError.value = "当前会话已撤销，但暂时无法确认剩余会话状态。请点击“刷新会话”重试。";
          }
          return;
        }

        await loadSessions();
      } catch {
        if (auth.isAuthenticated) {
          sessionsActionError.value = "撤销该会话失败，当前登录和会话列表已保留。请再次点击“撤销该会话”重试。";
        }
      } finally {
        busy.value = false;
      }
    }

    async function onRevokeAll(): Promise<void> {
      if (busy.value) return;
      busy.value = true;
      sessionsActionError.value = "";
      try {
        await revokeAllAuthSessions(transport);
        auth.clear();
        goTo("/pages/login/login");
      } catch {
        if (auth.isAuthenticated) {
          sessionsActionError.value = "撤销全部会话失败，当前登录和会话列表已保留。请再次点击“撤销全部会话”重试。";
        }
      } finally {
        busy.value = false;
      }
    }

    async function onChangePassword(): Promise<void> {
      if (busy.value || !canChangePassword.value) return;
      busy.value = true;
      passwordMessage.value = "";
      try {
        const ok = await changeAuthPassword(
          transport, currentPassword.value, newPassword.value,
        );
        if (!ok) {
          passwordMessage.value = "修改失败：请检查当前密码和新密码要求。";
          return;
        }
        currentPassword.value = "";
        newPassword.value = "";
        confirmPassword.value = "";
        auth.clear();
        goTo("/pages/login/login");
      } catch {
        passwordMessage.value = "修改失败，请重试。";
      } finally {
        busy.value = false;
      }
    }

    async function onLogout(): Promise<void> {
      if (busy.value) return;
      busy.value = true;
      try {
        await auth.logout(transport);
        goTo("/pages/login/login");
      } finally {
        busy.value = false;
      }
    }

    function closeDelete(): void {
      deleteOpen.value = false;
      deleteError.value = "";
      deletePassword.value = "";
    }

    async function onConfirmDelete(): Promise<void> {
      if (busy.value) return;
      // Empty re-entry never leaves the page: no request, keep the form.
      if (!deletePassword.value) {
        deleteError.value = "请输入当前密码以确认注销。";
        return;
      }
      busy.value = true;
      deleteError.value = "";
      try {
        const ok = await deleteAccount(transport, deletePassword.value);
        if (!ok) {
          // Wrong password (or server refusal): keep the form + input so the
          // caller can retry; the session stays alive.
          deleteError.value = "当前密码不正确，注销未执行。";
          return;
        }
        auth.clear();
        deleteOpen.value = false;
        deletePassword.value = "";
        goTo("/pages/login/login");
      } catch {
        deleteError.value = "注销失败，请重试。";
      } finally {
        busy.value = false;
      }
    }

    return {
      accountRoleLabel,
      formatLocalDateTime,
      HUB_ENTRIES,
      INTERNAL_ENTRIES,
      operatorVisible,
      groupedHubEntries,
      visibleInternalEntries,
      auth,
      deleteOpen,
      deleteError,
      deletePassword,
      busy,
      sessions,
      sessionsFailed,
      sessionsActionError,
      currentPassword,
      newPassword,
      confirmPassword,
      passwordMessage,
      canChangePassword,
      loadSessions,
      onRevokeSession,
      onRevokeAll,
      onChangePassword,
      onLogout,
      onConfirmDelete,
      closeDelete,
      goTo,
    };
  },
};
</script>

<style scoped>
.intro {
  margin: 0 0 var(--vc-space-4);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  line-height: 1.75;
}

.section {
  margin-bottom: var(--vc-space-5);
}

.section-title {
  display: block;
  margin-bottom: var(--vc-space-2);
  font-size: var(--vc-text-md);
  font-weight: 600;
}

.section-subtitle {
  display: block;
  margin: var(--vc-space-2) 0 var(--vc-space-1);
  font-size: var(--vc-text-sm);
  font-weight: 600;
  color: var(--vc-muted);
}

.label {
  display: block;
  margin: var(--vc-space-3) 0 var(--vc-space-1);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.meta {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.row {
  display: block;
  margin-bottom: var(--vc-space-2);
  font-size: var(--vc-text-sm);
  line-height: 1.7;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-3);
}

.nav-index {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.nav-index::after {
  border: 0;
}

.page-act {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-env-strong);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-on-env);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.page-act::after {
  border: 0;
}

.error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  margin: var(--vc-space-3) 0;
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 1px solid var(--vc-danger);
  border-radius: var(--vc-radius-m);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
}

.empty {
  display: block;
  margin: var(--vc-space-3) 0;
  padding: var(--vc-space-4);
  border: 1px dashed var(--vc-border-strong);
  border-radius: var(--vc-radius-m);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-1);
  margin-bottom: var(--vc-space-4);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
  font-size: var(--vc-text-sm);
}

.input,
.reminder-input,
.export-input,
.account-input,
.note-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-ink);
  font-size: 16px;
}
.account-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-3);
  margin: var(--vc-space-4) 0 0;
}

.danger {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-6);
  padding: var(--vc-space-4);
  border-top: 1px solid var(--vc-danger);
  border-bottom: 1px solid var(--vc-danger);
  border-radius: 0;
  background: transparent;
}

.danger-title {
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.danger-lead,
.danger-copy {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  line-height: 1.7;
}

.danger-btn {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-danger);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-danger);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.danger-btn::after {
  border: 0;
}

.danger-confirm {
  display: flex;
  flex-direction: column;
  gap: var(--vc-space-2);
  width: 100%;
}
.hub {
  margin: var(--vc-space-5) 0;
}

.hub .row-link {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--vc-space-3);
  width: 100%;
  min-height: 60px;
  margin: 0;
  padding: var(--vc-space-3) var(--vc-space-1) var(--vc-space-3) 0;
  border: 0;
  border-bottom: 1px solid var(--vc-border);
  border-radius: 0;
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
  text-align: left;
}

.hub .row-link::after {
  border: 0;
}

.hub-chevron {
  color: var(--vc-muted);
}

.hub-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
}

.hub-group {
  display: block;
  margin-top: var(--vc-space-6);
  margin-bottom: var(--vc-space-1);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.hub-group:first-child {
  margin-top: 0;
}

.hub-label {
  font-size: var(--vc-text-md);
  font-weight: 650;
}

.hub-note {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  text-align: right;
}

.hub--internal {
  padding: var(--vc-space-2) 0;
  border-top: 1px dashed var(--vc-border-strong);
  border-bottom: 1px dashed var(--vc-border-strong);
  border-radius: 0;
}

.card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-1);
  padding: var(--vc-space-4);
  border-top: 1px solid var(--vc-border);
  border-bottom: 1px solid var(--vc-border);
  border-radius: 0;
  background: var(--vc-card);
}

.session-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-2);
  padding: var(--vc-space-2) 0;
  border-bottom: 1px solid var(--vc-border);
  font-size: var(--vc-text-sm);
}

.notice {
  display: block;
  margin: var(--vc-space-2) 0;
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.account-overview {
  position: relative;
  display: grid;
  gap: var(--vc-space-1);
  padding: var(--vc-space-5) var(--vc-space-4);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  overflow: hidden;
}

.account-overview::before {
  position: absolute;
  inset: 0;
  background: url("/static/quiet-loom/woven-field.png") repeat;
  background-size: 512px 512px;
  content: "";
  mix-blend-mode: multiply;
  opacity: 0.08;
  pointer-events: none;
}

.account-overview > * {
  position: relative;
  z-index: 1;
}

.account-overview__title {
  color: var(--vc-ink);
  font-size: var(--vc-text-xl);
  font-weight: 700;
}

.account-overview__copy {
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}
</style>
