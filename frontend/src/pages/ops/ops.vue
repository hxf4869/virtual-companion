<!-- ADMIN-OPS-RO: read-only service status, compliance, and announcement.
Reuses GET /service-mode and GET /version. Never invents provider health or
role-plays an outage. ADMIN only. -->
<template>
  <view class="ops-page">
    <view class="bar">
      <text class="title">运行与合规</text>
      <button data-testid="nav-index" class="nav-index" aria-label="返回边界台" @click="goTo('/pages/index/index')">
        返回边界台
      </button>
    </view>

    <view v-if="auth.role !== 'ADMIN'" class="notice" data-testid="ops-not-allowed" role="status">
      <text>当前账号不是管理员，无法查看运行与合规页。</text>
    </view>

    <template v-else>
      <view class="card" data-testid="ops-mode" role="status">
        <text class="label">服务状态</text>
        <text v-if="modeLine">{{ modeLine }}</text>
        <text v-else-if="modeFailed" class="error">服务状态读取失败，不编造可用状态。</text>
        <text v-else>正在读取服务状态…</text>
      </view>

      <view class="card" data-testid="ops-version" role="status">
        <text class="label">构建版本</text>
        <text v-if="version">{{ version.version }}{{ version.commit ? ` · ${version.commit}` : "" }}</text>
        <text v-else>版本信息不可用。</text>
      </view>

      <view class="card" data-testid="ops-compliance">
        <text class="label">合规边界</text>
        <text>
          Technical Alpha 只允许本地与 CI 合成数据，不对真实用户开放，不开放公开注册，
          不启用真实支付。真实 provider 凭据只允许部署配置注入。成年核验、PIA 与值班等
          Beta 前置条件未满足前不得对真实用户上线。
        </text>
      </view>

      <view class="card" data-testid="ops-announce" role="status">
        <text class="label">系统公告</text>
        <text v-if="announce">{{ announce }}</text>
        <text v-else>当前没有额外公告。服务是否可用只看上面的服务状态，不会角色化。</text>
      </view>
    </template>
  </view>
</template>

<script lang="ts">
import { computed, onMounted, ref } from "vue";

import { getServiceMode } from "@/api/chat";
import { createAuthenticatedTransport } from "@/api/transport";
import { fetchVersion, type VersionInfo } from "@/api/version";
import { useAuthStore } from "@/stores/auth";

export default {
  name: "OpsPage",
  setup() {
    const auth = useAuthStore();
    const version = ref<VersionInfo | null>(null);
    const modeLine = ref("");
    const announce = ref("");
    const modeFailed = ref(false);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    const isAdmin = computed(() => auth.role === "ADMIN");

    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      if (auth.role !== "ADMIN") return;
      try {
        const mode = await getServiceMode(transport);
        if (mode) {
          modeLine.value = `${mode.mode} · ${mode.summary}`;
          announce.value = mode.summary;
        }
      } catch {
        modeFailed.value = true;
      }
      version.value = await fetchVersion(transport);
    });

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

    return { auth, isAdmin, version, modeLine, announce, modeFailed, goTo };
  },
};
</script>

<style scoped>
.ops-page {
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
.card,
.notice {
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
.error {
  color: #f0b4b4;
}
</style>
