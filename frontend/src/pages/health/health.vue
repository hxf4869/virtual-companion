<!-- USAGE-HEALTH (§20.7 / 21.3.3): continuous-use reminder prefs. The backend
computes continuous minutes; this page only reads status and writes approved
intervals. Reminders are system-layer facts — no role-play, no 挽留 copy. -->
<template>
  <view class="health-page">
    <view class="bar">
      <text class="title">使用时长</text>
      <button
        data-testid="nav-chat"
        class="nav-index"
        aria-label="离线聊天"
        @click="goTo('/pages/chat/chat')"
      >
        离线聊天
      </button>
      <button
        data-testid="nav-index"
        class="nav-index"
        aria-label="返回边界台"
        @click="goTo('/pages/index/index')"
      >
        返回边界台
      </button>
    </view>

    <view class="intro" data-testid="health-intro">
      <text>
        连续使用由服务端计算，本页只设置提醒间隔和会话中断间隔。达到设定时长后，
        系统会以系统层事实提醒你可以结束今天的对话、休息或继续使用，不会用角色口吻挽留。
      </text>
    </view>

    <view v-if="store.loadFailed" class="error" data-testid="health-load-failed" role="alert">
      <text>使用时长设置加载失败，请重试。</text>
      <button data-testid="health-retry" class="nav-index" :disabled="store.busy" @click="onRetry">
        重试
      </button>
    </view>
    <view v-if="actionError" class="error" data-testid="health-action-failed" role="alert">
      <text>{{ actionError }}</text>
    </view>

    <template v-if="!store.loadFailed && store.status">
      <view class="state-card" data-testid="health-status">
        <text class="label">当前连续使用</text>
        <text class="state" data-testid="health-continuous">
          {{ store.status.continuousMinutes }} 分钟
        </text>
        <text class="meta" data-testid="health-due">
          {{ store.status.reminderDue ? "已到提醒时间" : "尚未到提醒时间" }}
        </text>
      </view>

      <view class="section" data-testid="health-reminder-section">
        <text class="label">连续使用多久后提醒</text>
        <view class="chip-row">
          <button
            v-for="minutes in reminderOptions"
            :key="minutes"
            class="chip"
            :class="{ 'chip-on': store.status.reminderAfterMinutes === minutes }"
            :data-testid="`health-after-${minutes}`"
            :aria-pressed="store.status.reminderAfterMinutes === minutes"
            :disabled="store.busy"
            @click="onSaveReminder(minutes)"
          >
            {{ minutes }} 分钟
          </button>
        </view>
      </view>

      <view class="section" data-testid="health-gap-section">
        <text class="label">间隔多久算新的连续会话</text>
        <view class="chip-row">
          <button
            v-for="minutes in gapOptions"
            :key="minutes"
            class="chip"
            :class="{ 'chip-on': store.status.sessionGapMinutes === minutes }"
            :data-testid="`health-gap-${minutes}`"
            :aria-pressed="store.status.sessionGapMinutes === minutes"
            :disabled="store.busy"
            @click="onSaveGap(minutes)"
          >
            {{ minutes }} 分钟
          </button>
        </view>
      </view>
    </template>
  </view>
</template>

<script lang="ts">
import { onMounted, ref } from "vue";

import {
  APPROVED_GAP_MINUTES,
  APPROVED_REMINDER_MINUTES,
  UsageHealthHttpError,
  type ReminderAfterMinutes,
  type SessionGapMinutes,
} from "@/api/usage-health";
import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";
import { useUsageHealthStore } from "@/stores/usage-health";

export default {
  name: "HealthPage",
  setup() {
    const auth = useAuthStore();
    const store = useUsageHealthStore();
    const actionError = ref("");
    const reminderOptions = APPROVED_REMINDER_MINUTES;
    const gapOptions = APPROVED_GAP_MINUTES;

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
      actionError.value = "";
      await store.load(transport);
    }

    async function onSaveReminder(minutes: ReminderAfterMinutes): Promise<void> {
      if (!store.status || store.status.reminderAfterMinutes === minutes) return;
      actionError.value = "";
      try {
        const ok = await store.savePrefs(transport, minutes, store.status.sessionGapMinutes);
        if (!ok) {
          actionError.value = "设置未保存，请重试。";
        }
      } catch (e) {
        actionError.value =
          e instanceof UsageHealthHttpError && e.status === 400
            ? "未批准的提醒间隔。"
            : "设置保存失败，请重试。";
      }
    }

    async function onSaveGap(minutes: SessionGapMinutes): Promise<void> {
      if (!store.status || store.status.sessionGapMinutes === minutes) return;
      actionError.value = "";
      try {
        const ok = await store.savePrefs(transport, store.status.reminderAfterMinutes, minutes);
        if (!ok) {
          actionError.value = "设置未保存，请重试。";
        }
      } catch (e) {
        actionError.value =
          e instanceof UsageHealthHttpError && e.status === 400
            ? "未批准的会话间隔。"
            : "设置保存失败，请重试。";
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
      store,
      actionError,
      reminderOptions,
      gapOptions,
      onRetry,
      onSaveReminder,
      onSaveGap,
      goTo,
    };
  },
};
</script>

<style scoped>
.health-page {
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
.intro {
  margin: 16rpx 0;
  font-size: 24rpx;
  color: #8fa0bd;
  line-height: 1.6;
}
.state-card,
.section {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 16rpx;
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
.meta {
  font-size: 22rpx;
  color: #8fa0bd;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 8rpx;
}
.chip {
  background-color: #2a3a5a;
  color: #ffffff;
  font-size: 24rpx;
}
.chip-on {
  background-color: #3d5a80;
}
.error {
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background-color: #5a1a1a;
  font-size: 24rpx;
}
</style>
