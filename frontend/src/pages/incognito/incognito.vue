<!-- INC-PREF (FR-CHAT-005): dedicated incognito settings. Creation-time flag
stays frozen on the conversation. This page only sets the default for the
next new conversation and states that 无痕 ≠ 无必要安全记录. -->
<template>
  <view class="incognito-page">
    <view class="bar">
      <text class="title">无痕模式</text>
      <button data-testid="nav-chat" class="nav-index" aria-label="离线聊天" @click="goTo('/pages/chat/chat')">
        离线聊天
      </button>
      <button data-testid="nav-index" class="nav-index" aria-label="返回边界台" @click="goTo('/pages/index/index')">
        返回边界台
      </button>
    </view>

    <view class="intro" data-testid="incognito-intro">
      <text>
        无痕必须在进入新会话前明确开启。无痕会话不产生长期记忆候选，结束后会清掉
        已落库的消息正文；必要的安全与法定记录仍会保留。无痕不等于完全不产生必要
        安全记录。已有会话的无痕标志创建后不能事后翻转。
      </text>
    </view>

    <view v-if="store.loadFailed" class="error" data-testid="incognito-load-failed" role="alert">
      <text>无痕默认设置加载失败，请重试。</text>
      <button data-testid="incognito-retry" class="nav-index" :disabled="store.busy" @click="onRetry">
        重试
      </button>
    </view>

    <template v-if="!store.loadFailed">
      <view class="state-card" data-testid="incognito-status">
        <text class="label">下次新会话</text>
        <text class="state" data-testid="incognito-label">{{ store.label }}</text>
      </view>
      <button
        data-testid="incognito-default-toggle"
        class="nav-index"
        :class="{ on: store.defaultIncognito }"
        :aria-pressed="store.defaultIncognito"
        :disabled="store.busy"
        @click="onToggle"
      >
        {{ store.defaultIncognito ? "关闭默认无痕" : "开启默认无痕" }}
      </button>
    </template>
  </view>
</template>

<script lang="ts">
import { onMounted } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";
import { useIncognitoStore } from "@/stores/incognito";

export default {
  name: "IncognitoPage",
  setup() {
    const auth = useAuthStore();
    const store = useIncognitoStore();
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      await store.load(transport);
    });

    async function onRetry(): Promise<void> {
      await store.load(transport);
    }

    async function onToggle(): Promise<void> {
      await store.save(transport, !store.defaultIncognito);
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

    return { store, onRetry, onToggle, goTo };
  },
};
</script>

<style scoped>
.incognito-page {
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
.nav-index.on {
  background-color: #3d5a80;
}
.intro {
  margin: 16rpx 0;
  font-size: 24rpx;
  color: #8fa0bd;
  line-height: 1.6;
}
.state-card {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin: 16rpx 0;
  padding: 20rpx;
  border-radius: 16rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
}
.label {
  font-size: 24rpx;
  color: #8fa0bd;
}
.state {
  font-size: 30rpx;
  font-weight: 600;
}
.error {
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background-color: #5a1a1a;
  font-size: 24rpx;
}
</style>
