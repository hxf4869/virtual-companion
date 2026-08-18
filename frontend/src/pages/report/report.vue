<!-- REPORT-PAGE: dedicated report/appeal page. Ticket API is not wired.
No form, no invented case numbers, no hotline role-play. -->
<template>
  <view class="report-page">
    <view class="bar">
      <text class="title">举报和申诉</text>
      <button data-testid="nav-help" class="nav-index" aria-label="帮助与安全支持" @click="goTo('/pages/help/help')">
        帮助
      </button>
      <button data-testid="nav-index" class="nav-index" aria-label="返回边界台" @click="goTo('/pages/index/index')">
        返回边界台
      </button>
    </view>

    <view class="section" data-testid="report-status" role="status">
      <text>
        举报和申诉受理接口尚未接通。本页没有可提交的表单，也不会编造工单状态或回复时限。
      </text>
    </view>

    <view class="section">
      <text class="section-title">现在可以做什么</text>
      <text class="row">可以结束今天的对话、删除单条消息，或在账号页注销。</text>
      <text class="row">需要现实紧急帮助时，请联系当地紧急服务或你信任的真人支持。本页不提供虚构热线。</text>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: "ReportPage",
  setup() {
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
    return { goTo };
  },
};
</script>

<style scoped>
.report-page {
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
.section {
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
.section-title {
  font-weight: 600;
}
.row {
  color: #d5deee;
}
</style>
