<!-- ACCT-PAGE: account identity, logout, and self-service deletion.
Reuses POST /auth/logout and DELETE /auth/account. No register, no payment. -->
<template>
  <view class="account-page">
    <view class="bar">
      <text class="title">账号与注销</text>
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

      <button data-testid="account-logout" class="nav-index" :disabled="busy" @click="onLogout">
        登出
      </button>

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
          <view class="actions">
            <button data-testid="delete-account-cancel" class="nav-index" :disabled="busy" @click="deleteOpen = false">
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
import { onMounted, ref } from "vue";

import { deleteAccount } from "@/api/auth";
import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";

export default {
  name: "AccountPage",
  setup() {
    const auth = useAuthStore();
    const deleteOpen = ref(false);
    const deleteError = ref("");
    const busy = ref(false);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
    });

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

    async function onConfirmDelete(): Promise<void> {
      if (busy.value) return;
      busy.value = true;
      deleteError.value = "";
      try {
        const ok = await deleteAccount(transport);
        if (!ok) {
          deleteError.value = "注销请求未获确认，请重试。";
          return;
        }
        auth.clear();
        deleteOpen.value = false;
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

    return { auth, deleteOpen, deleteError, busy, onLogout, onConfirmDelete, goTo };
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
.error {
  color: #f0b4b4;
}
</style>
