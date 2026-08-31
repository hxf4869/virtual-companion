<!-- AGE-UI (FR-AUTH-002): adult-verification status and Alpha simulated
verify. The page never offers a “I am an adult” checkbox as the gate.
Technical Alpha uses the simulated port; no identity document is stored.
The page only reflects the authoritative state returned by the runtime. -->
<template>
  <ConsumerShell route="/pages/age/age">
    <view class="intro">
      <text>
        服务默认面向 18 岁以上用户。当前为内部测试，使用模拟核验；只保存核验
        结果、年龄段与时间，不保存任何身份证件。
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
          记录时间：{{ formatLocalDateTime(store.record.verifiedAt) }}
        </text>
      </view>

      <view v-if="store.blocked" class="blocked" data-testid="age-blocked">
        <text>
          当前状态无法完成成年核验。本页只展示状态，不会改写结果。
        </text>
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
import { formatLocalDateTime } from "@/domain/timestamp";
import { useAgeStore } from "@/stores/age";
import { useAuthStore } from "@/stores/auth";

export default {
  name: "AgePage",
  components: { ConsumerShell },
  setup() {
    const auth = useAuthStore();
    const store = useAgeStore();
    const actionError = ref("");

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    const methodLabel = computed(() => publicAgeMethodLabel(store.record.providerRef));

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

    return {
      store,
      actionError,
      methodLabel,
      formatLocalDateTime,
      onRetry,
      onVerify,
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
  border-top: 1px solid var(--vc-border);
  border-bottom: 1px solid var(--vc-border);
  border-radius: 0;
  background: var(--vc-card);
}

.label {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.state {
  color: var(--vc-success);
  font-size: var(--vc-text-xl);
  font-weight: 700;
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
  border-radius: 0;
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
