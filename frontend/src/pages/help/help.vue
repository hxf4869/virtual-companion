<!-- HELP (safety support): read-only boundaries. Reports & appeals go through
     the real /pages/report/report intake (submission form + own status list).
     No invented hotline, ticket numbers or SLA wording. -->
<template>
  <view class="help-page">
    <view class="bar">
      <text class="title">帮助与安全支持</text>
      <button data-testid="nav-chat" class="nav-index" aria-label="离线聊天" @click="goTo('/pages/chat/chat')">
        离线聊天
      </button>
      <button data-testid="nav-index" class="nav-index" aria-label="返回边界台" @click="goTo('/pages/index/index')">
        返回边界台
      </button>
    </view>

    <view class="intro" data-testid="help-intro">
      <text>
        这是一个 AI 虚拟陪伴服务，回复由程序生成，不是真人，也不是急诊或心理咨询机构。
      </text>
    </view>

    <view class="section" data-testid="help-boundaries">
      <text class="section-title">使用边界</text>
      <text class="row">本服务不能替代医生、律师、警察或其他专业人员。</text>
      <text class="row">Technical Alpha 仅供本地联调，不对真实用户开放，也没有公开注册或付费。</text>
      <text class="row">运维事故与故障只以平实状态展示，不会被角色化进对话。</text>
    </view>

    <view class="section" data-testid="help-when">
      <text class="section-title">何时应寻求现实帮助</text>
      <text class="row">如果你或身边的人正处于危险、急性痛苦或需要立即处置的情况，请联系当地紧急服务或你信任的真人支持。</text>
      <text class="row">本页面不会提供虚构热线号码，也不会假装已经接通了人工值班。</text>
    </view>

    <view class="section" data-testid="help-reports">
      <text class="section-title">举报和申诉</text>
      <text class="row">
        要举报内容或问题，可在「举报和申诉」页选择目录原因、填写描述后提交；提交成功或失败都会如实显示。
      </text>
      <text class="row">
        你已提交的举报与处理状态也在该页查看。该页不承诺处理时限，也不编造工单编号。
      </text>
      <button
        data-testid="nav-report"
        class="nav-index"
        aria-label="打开举报和申诉页"
        @click="goTo('/pages/report/report')"
      >
        打开举报和申诉页
      </button>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: "HelpPage",
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
.help-page {
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
