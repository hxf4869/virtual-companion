<!-- HELP (safety support): read-only boundaries. Reports & appeals go through
     the real /pages/report/report intake (submission form + own status list).
     No invented hotline, ticket numbers or SLA wording. -->
<template>
  <ConsumerShell route="/pages/help/help">

    

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
  </ConsumerShell>
</template>

<script lang="ts">
import ConsumerShell from "@/app/ConsumerShell.vue";

export default {
  name: "HelpPage",
  components: { ConsumerShell },
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
/* The Lit Window 语义 token（Phase 5 迁移）。 */
.intro {
  margin: 0 0 var(--vc-space-4);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  line-height: 1.75;
}

.section {
  margin-bottom: var(--vc-space-5);
}

.section-title {
  display: block;
  margin-bottom: var(--vc-space-2);
  font-size: var(--vc-text-md);
  font-weight: 650;
}

.section-subtitle {
  display: block;
  margin: var(--vc-space-2) 0 var(--vc-space-1);
  font-size: var(--vc-text-sm);
  font-weight: 600;
  color: var(--vc-muted);
}

.label {
  display: block;
  margin: var(--vc-space-3) 0 var(--vc-space-1);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.meta {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.row {
  display: block;
  margin-bottom: var(--vc-space-2);
  font-size: var(--vc-text-sm);
  line-height: 1.7;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-3);
}

.nav-index {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.nav-index::after {
  border: 0;
}

.page-act {
  min-height: 40px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-env);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-on-env);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.page-act::after {
  border: 0;
}

.error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  margin: var(--vc-space-3) 0;
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 1px solid var(--vc-danger);
  border-radius: var(--vc-radius-m);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
}

.empty {
  display: block;
  margin: var(--vc-space-3) 0;
  padding: var(--vc-space-4);
  border: 1px dashed var(--vc-border-strong);
  border-radius: var(--vc-radius-m);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-1);
  margin-bottom: var(--vc-space-4);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
  font-size: var(--vc-text-sm);
}

.input,
.reminder-input,
.export-input,
.account-input,
.note-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-ink);
  font-size: var(--vc-text-md);
}
</style>
