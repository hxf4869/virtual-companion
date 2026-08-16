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

      <view v-if="result" class="admin-result" data-testid="account-result" role="status">
        <text>已开通：{{ result.username }}（{{ result.role }}，状态 {{ result.status }}）</text>
      </view>
      <view v-if="failed" class="admin-error" data-testid="account-failed" role="alert">
        <text>开通失败，请检查输入或权限（不会披露用户名是否存在）。</text>
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

import { createAccount } from "@/api/auth";
import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";

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
    });

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
      canSubmit,
      onCreate,
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
</style>
