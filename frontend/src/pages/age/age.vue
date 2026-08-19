<!-- AGE-UI (FR-AUTH-002): adult-verification status and Alpha simulated
verify. The page never offers a “I am an adult” checkbox as the gate.
Technical Alpha uses the simulated port; no identity document is stored.
AGE-APPEAL: a wrong verdict can be appealed from an appealable state — the
appeal is recorded and reviewed by a human; the page never rewrites results. -->
<template>
  <view class="age-page">
    <view class="bar">
      <text class="title">成年核验</text>
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

    <view class="intro">
      <text>
        服务默认面向 18 岁以上用户。本页读取成年核验结果，并可运行 Technical
        Alpha 的模拟核验。系统只保存结果、年龄段、时间和供应商凭证，不保存身份证件。
        模拟核验供本地联调，不能当作公开上线的成年证明；真实供应商只替换端口实现，
        不改本页调用。认为核验结果有误时，可以从本页提交申诉，由人工处理。
      </text>
    </view>

    <view v-if="store.loadFailed" class="error" data-testid="age-load-failed" role="alert">
      <text>成年核验状态加载失败，请重试。</text>
      <button data-testid="age-retry" class="nav-index" :disabled="store.busy" @click="onRetry">
        重试
      </button>
    </view>
    <view v-if="actionError" class="error" data-testid="age-action-failed" role="alert">
      <text>{{ actionError }}</text>
    </view>

    <template v-if="!store.loadFailed">
      <view class="state-card" data-testid="age-state">
        <text class="label">当前状态</text>
        <text class="state" data-testid="age-state-label">{{ store.label }}</text>
        <text class="meta" data-testid="age-state-code">{{ store.ageState }}</text>
        <text v-if="store.record.providerRef" class="meta" data-testid="age-provider">
          供应商凭证：{{ store.record.providerRef }}
        </text>
        <text v-if="store.record.verifiedAt" class="meta" data-testid="age-verified-at">
          记录时间：{{ store.record.verifiedAt }}
        </text>
      </view>

      <view v-if="store.blocked" class="blocked" data-testid="age-blocked">
        <text>
          当前状态无法完成成年核验。本页只展示状态，不会改写结果。
        </text>
      </view>

      <!-- AGE-APPEAL: submission is only offered from a catalog-appealable
           state; the server re-checks the same rule (fail closed). -->
      <view v-if="store.canAppeal" class="appeal-card" data-testid="age-appeal-form">
        <text class="label">提交年龄申诉</text>
        <text class="meta">申诉会交给人工处理。提交后状态变为「申诉处理中」，期间不能重复提交。</text>
        <textarea
          v-model="appealReason"
          class="appeal-input"
          data-testid="age-appeal-reason"
          aria-label="申诉理由"
          :maxlength="500"
          placeholder="请说明为什么认为核验结果有误（必填，最多 500 字）"
        />
        <button
          data-testid="age-appeal-submit"
          class="nav-index verify-btn"
          :disabled="store.busy || !canSubmitAppeal"
          @click="onSubmitAppeal"
        >
          提交申诉
        </button>
      </view>

      <!-- The result notices live outside the form card: on success the state
           flips to AGE_APPEAL_PENDING and the card itself disappears. -->
      <view v-if="appealResult === 'ok'" class="done" data-testid="age-appeal-ok" role="status">
        <text>申诉已提交，等待人工处理。</text>
      </view>
      <view v-else-if="appealResult === 'rejected'" class="error" data-testid="age-appeal-rejected" role="alert">
        <text>当前状态不能提交申诉，或理由不符合要求。结果不会被改写。</text>
      </view>

      <view
        v-if="store.ageState === 'AGE_APPEAL_PENDING'"
        class="state-card"
        data-testid="age-appeal-pending"
        role="status"
      >
        <text class="label">申诉处理中</text>
        <text class="meta">已提交的申诉会由人工处理。处理完成前模拟核验保持关闭。</text>
      </view>

      <view v-if="store.appealsLoaded && store.appeals.length > 0" class="state-card">
        <text class="label">我的申诉</text>
        <view v-for="a in store.appeals" :key="a.id" class="appeal-row" :data-testid="`age-appeal-row-${a.id}`">
          <text class="meta">
            {{ a.status === "SUBMITTED" ? "已提交，等待人工处理" : "已处理" }} · {{ a.createdAt }}
          </text>
          <text class="meta">{{ a.reason }}</text>
          <text v-if="a.resolutionNote" class="meta">处理说明：{{ a.resolutionNote }}</text>
        </view>
      </view>

      <button
        v-if="store.canVerify"
        data-testid="age-verify"
        class="nav-index verify-btn"
        :disabled="store.busy"
        @click="onVerify"
      >
        运行模拟成年核验
      </button>
      <text v-if="store.ageState === 'ADULT_VERIFIED'" class="done" data-testid="age-verified">
        已完成成年核验。模拟核验对已核验账号是幂等的，本页不再发起写入。
      </text>
    </template>
  </view>
</template>

<script lang="ts">
import { computed, onMounted, ref } from "vue";

import { AgeHttpError } from "@/api/age";
import { createAuthenticatedTransport } from "@/api/transport";
import { useAgeStore } from "@/stores/age";
import { useAuthStore } from "@/stores/auth";

export default {
  name: "AgePage",
  setup() {
    const auth = useAuthStore();
    const store = useAgeStore();
    const actionError = ref("");
    const appealReason = ref("");
    const appealResult = ref<"idle" | "ok" | "rejected">("idle");

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    const canSubmitAppeal = computed(() => appealReason.value.trim().length > 0);

    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      await store.load(transport);
      await store.loadAppeals(transport);
    });

    async function onRetry(): Promise<void> {
      actionError.value = "";
      await store.load(transport);
      await store.loadAppeals(transport);
    }

    async function onVerify(): Promise<void> {
      actionError.value = "";
      try {
        const ok = await store.runVerification(transport);
        if (!ok) {
          actionError.value = "当前状态不能发起模拟核验。";
        }
      } catch (e) {
        if (e instanceof AgeHttpError && e.status === 400) {
          actionError.value = "当前状态无法完成成年核验。";
        } else {
          actionError.value = "模拟核验失败，请重试。";
        }
      }
    }

    async function onSubmitAppeal(): Promise<void> {
      appealResult.value = "idle";
      try {
        const ok = await store.submitAppeal(transport, appealReason.value.trim());
        appealResult.value = ok ? "ok" : "rejected";
        if (ok) {
          appealReason.value = "";
        }
      } catch (e) {
        if (e instanceof AgeHttpError && e.status === 400) {
          appealResult.value = "rejected";
        } else {
          appealResult.value = "rejected";
        }
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
      appealReason,
      appealResult,
      canSubmitAppeal,
      onRetry,
      onVerify,
      onSubmitAppeal,
      goTo,
    };
  },
};
</script>

<style scoped>
.age-page {
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
.blocked {
  margin: 16rpx 0;
  font-size: 24rpx;
  color: #8fa0bd;
  line-height: 1.6;
}
.state-card {
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
.verify-btn {
  margin-top: 20rpx;
}
.appeal-card {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 16rpx;
  padding: 20rpx;
  border-radius: 16rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
}
.appeal-input {
  width: 100%;
  min-height: 120rpx;
  box-sizing: border-box;
  background-color: #14213d;
  color: #f5f5f5;
  border: 2rpx solid #2a3a5a;
  border-radius: 12rpx;
  padding: 12rpx;
  font-size: 24rpx;
}
.appeal-row {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  padding: 10rpx 0;
  border-bottom: 2rpx solid #24365c;
}
.done {
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #8fd18f;
}
.error {
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background-color: #5a1a1a;
  font-size: 24rpx;
}
</style>
