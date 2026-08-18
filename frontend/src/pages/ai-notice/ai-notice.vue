<!-- AI-NOTICE: model and AI-content identification (product item 19). -->
<template>
  <view class="notice-page">
    <view class="bar">
      <text class="title">模型与 AI 标识</text>
      <button data-testid="nav-index" class="nav-index" aria-label="返回边界台" @click="goTo('/pages/index/index')">
        返回边界台
      </button>
    </view>

    <view class="intro" data-testid="ai-notice-intro">
      <text>
        这是 AI 生成内容。助手回复由程序调用模型或确定性记录模式产生，不是真人在线回复。
      </text>
    </view>

    <view class="section" data-testid="ai-notice-what">
      <text class="section-title">你会看到什么</text>
      <text class="row">聊天里的助手气泡是 AI 生成内容；导出文件也会带 AI 内容标识。</text>
      <text class="row">当前服务模式（FULL_AI 或 ZERO_LLM）是运维事实，会在聊天页顶部用平实文案展示，不会被写进角色口吻。</text>
    </view>

    <view class="section" data-testid="ai-notice-limits">
      <text class="section-title">本页不提供的东西</text>
      <text class="row">不选择供应商、不切换具体模型、不展示计费套餐。</text>
      <text class="row">真实模型名称、部署和凭据只允许由部署配置注入，不会出现在这个页面。</text>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: "AiNoticePage",
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
        // Presentation-only navigation.
      }
    }
    return { goTo };
  },
};
</script>

<style scoped>
.notice-page {
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
.row {
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
  color: #f5f5f5;
}
</style>
