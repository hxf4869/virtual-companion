<!-- USAGE-HEALTH (§20.7 / 21.3.3): continuous-use reminder prefs. The backend
computes continuous minutes; this page only reads status and writes approved
intervals. Reminders are system-layer facts — no role-play, no 挽留 copy. -->
<template>
  <ConsumerShell route="/pages/health/health">



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

      <!-- ENT-TRIAL (V61): the live simulated trial budget, if any.
           P2（round5）：remainingTurns/expiresAt 是可空字段——缺失时渲染
           中性文案，绝不出现“剩余  轮”“到期时间 。”这类空值残句。 -->
      <view v-if="trial && trial.active" class="state-card" data-testid="trial-status" role="status">
        <text class="label">试用权益进行中</text>
        <text class="state" data-testid="trial-remaining">
          {{ trial.remainingTurns === null ? "剩余轮次暂不可知" : `剩余 ${trial.remainingTurns} 轮` }}
        </text>
        <text class="meta" data-testid="trial-expires">
          {{
            trial.expiresAt === null
              ? "到期时间以系统记录为准。"
              : `到期时间 ${formatLocalDateTime(trial.expiresAt)}。`
          }}
          到期或用尽后自动回到原等级，不删除任何数据。
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
  </ConsumerShell>
</template>

<script lang="ts">
import { onMounted, ref } from "vue";

import { getTrialStatus, type TrialStatus } from "@/api/entitlement";

import {
  APPROVED_GAP_MINUTES,
  APPROVED_REMINDER_MINUTES,
  UsageHealthHttpError,
  type ReminderAfterMinutes,
  type SessionGapMinutes,
} from "@/api/usage-health";
import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { formatLocalDateTime } from "@/domain/timestamp";
import { useAuthStore } from "@/stores/auth";
import { useUsageHealthStore } from "@/stores/usage-health";

export default {
  name: "HealthPage",
  components: { ConsumerShell },
  setup() {
    const auth = useAuthStore();
    const store = useUsageHealthStore();
    const actionError = ref("");
    const reminderOptions = APPROVED_REMINDER_MINUTES;
    const gapOptions = APPROVED_GAP_MINUTES;
    // ENT-TRIAL (V61): supplementary read; a failure keeps it hidden.
    const trial = ref<TrialStatus | null>(null);

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
      try {
        trial.value = await getTrialStatus(transport);
      } catch {
        trial.value = null;
      }
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
      trial,
      actionError,
      reminderOptions,
      gapOptions,
      formatLocalDateTime,
      onRetry,
      onSaveReminder,
      onSaveGap,
      goTo,
    };
  },
};
</script>

<style scoped>
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
  font-weight: 600;
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
  min-width: 44px;
  min-height: 44px;
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
  font-size: 16px;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
}

.chip {
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-pill);
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-sm);
}

.chip::after {
  border: 0;
}

.chip.chip-on {
  border: 0;
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font-weight: 600;
}

.minutes {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}
</style>
