<!-- DATA-VIEW (FR-DATA-001): read-only overview of stored account data.
Uses existing list APIs. Report/appeal has no Alpha endpoint. -->
<template>
  <view class="data-page">
    <view class="bar">
      <text class="title">我的数据</text>
      <button data-testid="nav-export" class="nav-index" aria-label="数据导出" @click="goTo('/pages/export/export')">
        数据导出
      </button>
      <button data-testid="nav-index" class="nav-index" aria-label="返回边界台" @click="goTo('/pages/index/index')">
        返回边界台
      </button>
    </view>

    <view class="intro">
      <text>
        这里只查看已经保存在本服务中的数据。导出请走「数据导出」。
        举报和申诉状态没有独立接口，本页不会编造记录。
      </text>
    </view>

    <view v-if="store.loadFailed" class="error" data-testid="data-load-failed" role="alert">
      <text>数据加载失败，请重试。</text>
      <button data-testid="data-retry" class="nav-index" :disabled="store.busy" @click="onRetry">重试</button>
    </view>

    <template v-if="!store.loadFailed">
      <view class="section" data-testid="data-account">
        <text class="section-title">账号</text>
        <text class="row">账号编号：{{ auth.accountId ?? "未登录" }}</text>
        <text class="row">角色：{{ auth.role ?? "未知" }}</text>
      </view>

      <view class="section" data-testid="data-relationships">
        <text class="section-title">角色与关系（{{ store.relationships.length }}）</text>
        <text v-for="rel in store.relationships" :key="rel.relationshipId" class="row">
          {{ rel.companionName || rel.personaRef }} · {{ rel.active ? "当前使用" : "未使用" }}
        </text>
        <text v-if="store.relationships.length === 0" class="empty">没有关系记录。</text>
      </view>

      <view class="section" data-testid="data-conversations">
        <text class="section-title">聊天记录（{{ store.conversations.length }}）</text>
        <text v-for="item in store.conversations.slice(0, 8)" :key="item.conversationId" class="row">
          {{ item.title || item.lastMessagePreview || `会话 ${item.conversationId}` }}
        </text>
        <text v-if="store.conversations.length === 0" class="empty">没有会话记录。</text>
      </view>

      <view class="section" data-testid="data-memories">
        <text class="section-title">长期记忆（{{ store.memories.length }}）</text>
        <text v-for="item in store.memories.slice(0, 8)" :key="item.memoryId" class="row">
          {{ item.summary }}（{{ item.status }}）
        </text>
        <text v-if="store.memories.length === 0" class="empty">没有记忆记录。</text>
      </view>

      <view class="section" data-testid="data-reminders">
        <text class="section-title">提醒（{{ store.reminders.length }}）</text>
        <text v-for="item in store.reminders.slice(0, 8)" :key="item.reminderId" class="row">
          {{ item.text }}
        </text>
        <text v-if="store.reminders.length === 0" class="empty">没有提醒记录。</text>
      </view>

      <view class="section" data-testid="data-consents">
        <text class="section-title">同意记录（{{ store.consents.length }}）</text>
        <text v-for="item in store.consents" :key="item.consentId" class="row">
          {{ item.consentType }} · {{ item.granted ? "已同意" : "已撤回" }}
        </text>
        <text v-if="store.consents.length === 0" class="empty">没有同意记录。</text>
      </view>

      <view class="section" data-testid="data-model">
        <text class="section-title">当前使用的模型说明</text>
        <text class="row">{{ store.serviceMode?.summary ?? "服务状态尚未读取。" }}</text>
        <text v-if="store.serviceMode" class="meta">模式 {{ store.serviceMode.mode }}</text>
      </view>

      <view class="section" data-testid="data-appeals">
        <text class="section-title">举报和申诉状态</text>
        <text class="empty">尚未接通。本页不会显示虚构的工单。</text>
      </view>
    </template>
  </view>
</template>

<script lang="ts">
import { onMounted } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";
import { useDataStore } from "@/stores/data";

export default {
  name: "DataPage",
  setup() {
    const auth = useAuthStore();
    const store = useDataStore();
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

    return { auth, store, onRetry, goTo };
  },
};
</script>

<style scoped>
.data-page {
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
  flex: 0 0 auto;
  background-color: #2a3a5a;
  color: #ffffff;
  font-size: 24rpx;
}
.intro,
.empty,
.meta {
  font-size: 24rpx;
  color: #8fa0bd;
  line-height: 1.6;
}
.section {
  margin-top: 20rpx;
  padding: 16rpx;
  border-radius: 16rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.section-title {
  font-size: 26rpx;
  font-weight: 600;
}
.row {
  font-size: 24rpx;
}
.error {
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background-color: #5a1a1a;
  font-size: 24rpx;
}
</style>
