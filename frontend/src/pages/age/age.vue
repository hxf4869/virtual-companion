<!-- AGE-UI (FR-AUTH-002): adult-verification status and Alpha simulated
verify. The page never offers a “I am an adult” checkbox as the gate.
Technical Alpha uses the simulated port; no identity document is stored.
AGE-APPEAL: a wrong verdict can be appealed from an appealable state — the
appeal is recorded and reviewed by a human; the page never rewrites results. -->
<template>
  <ConsumerShell route="/pages/age/age">
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
      <button data-testid="age-retry" class="action-btn" :disabled="store.busy" @click="onRetry">
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
        <text v-if="methodLabel" class="meta" data-testid="age-method">
          核验方式：{{ methodLabel }}
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
          class="action-btn primary"
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
      <view v-else-if="appealResult === 'network-error'" class="error" data-testid="age-appeal-network-error" role="alert">
        <text>网络或服务暂不可用，申诉尚未提交，请稍后重试。</text>
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
        class="action-btn primary"
        :disabled="store.busy"
        @click="onVerify"
      >
        运行模拟成年核验
      </button>
      <text v-if="store.ageState === 'ADULT_VERIFIED'" class="done" data-testid="age-verified">
        已完成成年核验。模拟核验对已核验账号是幂等的，本页不再发起写入。
      </text>
    </template>
  </ConsumerShell>
</template>

<script lang="ts">
import { computed, onMounted, ref } from "vue";

import { AgeHttpError } from "@/api/age";
import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { publicAgeMethodLabel } from "@/domain/public-age-display";
import { useAgeStore } from "@/stores/age";
import { useAuthStore } from "@/stores/auth";

export default {
  name: "AgePage",
  setup() {
    const auth = useAuthStore();
    const store = useAgeStore();
    const actionError = ref("");
    const appealReason = ref("");
    const appealResult = ref<"idle" | "ok" | "rejected" | "network-error">("idle");

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    const canSubmitAppeal = computed(() => appealReason.value.trim().length > 0);
    const methodLabel = computed(() => publicAgeMethodLabel(store.record.providerRef));

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
          // Transport/5xx: not a content rejection — a retry may succeed.
          appealResult.value = "network-error";
        }
      }
    }

    return {
      store,
      actionError,
      appealReason,
      appealResult,
      canSubmitAppeal,
      methodLabel,
      onRetry,
      onVerify,
      onSubmitAppeal,
    };
  },
};
</script>

<style scoped>
.intro,
.blocked {
  margin: 0 0 var(--vc-space-4);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  line-height: 1.7;
}

.state-card {
  display: flex;
  flex-direction: column;
  gap: var(--vc-space-1);
  margin-top: var(--vc-space-3);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
}

.label {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.state {
  font-size: var(--vc-text-lg);
  font-weight: 650;
}

.meta {
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  overflow-wrap: anywhere;
}

.action-btn {
  min-height: 44px;
  margin: var(--vc-space-2) 0 0;
  padding: 0 var(--vc-space-5);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.action-btn::after {
  border: 0;
}

.action-btn.primary {
  border: 0;
  background: var(--vc-primary);
  color: var(--vc-on-primary);
}

.appeal-card {
  display: flex;
  flex-direction: column;
  gap: var(--vc-space-2);
  align-items: flex-start;
  margin-top: var(--vc-space-3);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
}

.appeal-input {
  width: 100%;
  min-height: 96px;
  box-sizing: border-box;
  padding: var(--vc-space-2);
  background-color: var(--vc-sunken);
  color: var(--vc-ink);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  font-size: var(--vc-text-md);
}

.appeal-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--vc-space-2) 0;
  border-bottom: 1px solid var(--vc-border);
}

.done {
  display: block;
  margin-top: var(--vc-space-3);
  color: var(--vc-success);
  font-size: var(--vc-text-sm);
}

.error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-3);
  padding: var(--vc-space-3) var(--vc-space-4);
  border-radius: var(--vc-radius-m);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
}
</style>
