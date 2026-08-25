<!-- ACCT-PAGE: account identity, logout, and self-service deletion.
Reuses POST /auth/logout and DELETE /auth/account. No register, no payment. -->
<template>
  <!-- DOGFOOD-09：页面容器声明 main landmark，页面标题声明一级标题语义。 -->
  <view class="account-page" role="main">
    <view class="bar">
      <text class="title" role="heading" aria-level="1">账号与注销</text>
      <button data-testid="nav-index" class="nav-index" aria-label="返回边界台" @click="goTo('/pages/index/index')">
        返回边界台
      </button>
    </view>

    <view v-if="!auth.isAuthenticated" class="notice" data-testid="account-signed-out" role="status">
      <text>当前未登录。登录后再查看账号或注销。</text>
      <button data-testid="nav-login" class="nav-index" @click="goTo('/pages/login/login')">登录</button>
    </view>

    <template v-else>
      <view class="card" data-testid="account-card">
        <text class="label">账号编号</text>
        <text data-testid="account-id">{{ auth.accountId ?? "未知" }}</text>
        <text class="label">角色</text>
        <text data-testid="account-role">{{ auth.role ?? "未知" }}</text>
      </view>

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
        <text v-if="sessionsFailed" class="error" data-testid="sessions-error">会话加载失败，请重试。</text>
        <text v-else-if="sessions.length === 0" class="meta">暂无有效会话。</text>
        <view v-for="session in sessions" :key="session.id" class="session-row" data-testid="session-row">
          <text>{{ session.clientLabel || "客户端" }}{{ session.current ? "（当前）" : "" }}</text>
          <text class="meta">最近使用：{{ session.lastSeenAt }}；到期：{{ session.expiresAt }}</text>
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

      <view class="card" data-testid="survey-card">
        <text class="label">本期体验评分</text>
        <text class="meta">这段对话让你感到「被理解」了吗？1 分完全没被理解，5 分非常被理解。每天可评一次。</text>
        <view class="actions" data-testid="survey-buttons">
          <button
            v-for="s in [1, 2, 3, 4, 5]"
            :key="s"
            class="nav-index"
            :data-testid="'survey-score-' + s"
            :disabled="busy"
            @click="onSurvey(s)"
          >
            {{ s }}
          </button>
        </view>
        <text v-if="surveyMsg" class="meta" data-testid="survey-msg">{{ surveyMsg }}</text>
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
            注销后：业务数据（聊天、记忆、提醒、同意记录、导出）将立即删除；
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
  </view>
</template>

<script lang="ts">
import { computed, onMounted, ref } from "vue";

import {
  changeAuthPassword,
  deleteAccount,
  listAuthSessions,
  recordSurvey,
  revokeAllAuthSessions,
  revokeAuthSession,
  type AuthSession,
} from "@/api/auth";
import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";

export default {
  name: "AccountPage",
  setup() {
    const auth = useAuthStore();
    const deleteOpen = ref(false);
    const deleteError = ref("");
    // ADR-0006 §7.7 (DOGFOOD-08): the destructive deletion requires the
    // freshly re-entered CURRENT password; the server verifies it fail-closed.
    const deletePassword = ref("");
    const busy = ref(false);
    const surveyMsg = ref("");
    const sessions = ref<AuthSession[]>([]);
    const sessionsFailed = ref(false);
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
      try {
        sessions.value = await listAuthSessions(transport);
      } catch {
        sessionsFailed.value = true;
      }
    }

    async function onRevokeSession(sessionId: string): Promise<void> {
      if (busy.value) return;
      busy.value = true;
      try {
        const ok = await revokeAuthSession(transport, sessionId);
        const renewed = ok && await auth.tryRefresh(transport);
        if (!renewed) {
          auth.clear();
          goTo("/pages/login/login");
          return;
        }
        await loadSessions();
      } finally {
        busy.value = false;
      }
    }

    async function onRevokeAll(): Promise<void> {
      if (busy.value) return;
      busy.value = true;
      try {
        await revokeAllAuthSessions(transport);
        auth.clear();
        goTo("/pages/login/login");
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

    async function onSurvey(score: number): Promise<void> {
      if (busy.value) return;
      busy.value = true;
      try {
        const accepted = await recordSurvey(transport, score);
        surveyMsg.value = accepted
          ? "已记录今天的评分，谢谢你的反馈。"
          : "今天已经评过分了，明天再来吧。";
      } catch {
        surveyMsg.value = "评分提交失败，请稍后重试。";
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
        // Presentation-only.
      }
    }

    return {
      auth,
      deleteOpen,
      deleteError,
      deletePassword,
      busy,
      surveyMsg,
      sessions,
      sessionsFailed,
      currentPassword,
      newPassword,
      confirmPassword,
      passwordMessage,
      canChangePassword,
      loadSessions,
      onRevokeSession,
      onRevokeAll,
      onChangePassword,
      onSurvey,
      onLogout,
      onConfirmDelete,
      closeDelete,
      goTo,
    };
  },
};
</script>

<style scoped>
.account-page {
  padding: 24rpx;
  background-color: #14213d;
  color: #f5f5f5;
  min-height: 100vh;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 16rpx;
}
.title {
  font-size: 32rpx;
  font-weight: 600;
  margin-right: auto;
}
.nav-index {
  background-color: #2a3a5a;
  color: #ffffff;
  font-size: 24rpx;
}
.danger-btn {
  background-color: #5a1a1a;
}
.card,
.notice,
.danger {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 16rpx;
  padding: 20rpx;
  border-radius: 16rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  font-size: 24rpx;
  line-height: 1.6;
  color: #d5deee;
}
.label {
  font-size: 22rpx;
  color: #8fa0bd;
}
.meta {
  font-size: 22rpx;
  color: #8fa0bd;
}
.actions {
  display: flex;
  gap: 8rpx;
}
.account-input {
  padding: 12rpx;
  border: 2rpx solid #425579;
  border-radius: 8rpx;
  color: #f5f5f5;
}

.session-row {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  padding-top: 10rpx;
  border-top: 1rpx solid #425579;
}

.error {
  color: #f0b4b4;
}
</style>
