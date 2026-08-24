<!-- REMINDER (FR-NOTIFY-001): structured user-created reminders page.
Technical Alpha stores and lists reminders only — no push transport
(product-scope: 不提供主动消息). Every mutation routes through the store,
which only changes state on a confirmed API result. -->
<template>
  <view class="reminder-page">
    <view class="bar">
      <text class="title">提醒管理</text>
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

    <RelationshipSelector
      :relationships="relStore.relationships"
      :current-id="store.relationshipId || null"
      :status="relStore.status"
      :busy="relStore.status === 'loading'"
      :show-create="false"
      @activate="onPickRelationship"
    />

    <template v-if="store.relationshipId">
      <view class="reminder-form">
        <input
          v-model="text"
          class="reminder-input"
          data-testid="reminder-text"
          placeholder="提醒内容，如：明天晚上问我面试怎么样"
          aria-label="提醒内容"
          :disabled="store.busy"
        />
        <input
          v-model="remindAtLocal"
          class="reminder-input"
          data-testid="reminder-at"
          type="datetime-local"
          aria-label="提醒时间"
          :disabled="store.busy"
        />
        <select
          v-model="recurrence"
          class="reminder-select"
          data-testid="reminder-recurrence"
          aria-label="重复"
          :disabled="store.busy"
        >
          <option value="NONE">不重复</option>
          <option value="DAILY">每天</option>
          <option value="WEEKLY">每周</option>
        </select>
        <button
          data-testid="reminder-create"
          class="nav-index"
          :disabled="store.busy || !canCreate"
          @click="onCreate"
        >
          添加提醒
        </button>
      </view>

      <view
        v-if="writeStatus === 'loading' || writeStatus === 'ready'"
        class="notice"
        data-testid="reminder-write-status"
        role="status"
      >
        <text>{{ writeMessage }}</text>
      </view>
      <ErrorNotice
        v-else-if="writeStatus === 'error'"
        :message="writeMessage"
        :request-id="writeRequestId ?? undefined"
      />

      <view v-if="store.loadFailed" class="error" data-testid="reminder-load-failed" role="alert">
        <ErrorNotice
          message="提醒列表加载失败，请重试。"
          :request-id="reminderRequestId ?? undefined"
          :stale="store.reminders.length > 0"
        />
        <RetryButton :disabled="store.busy" @retry="retryReminders" />
      </view>

      <view
        v-for="reminder in store.reminders"
        :key="reminder.reminderId"
        class="reminder-row"
        data-testid="reminder-row"
      >
        <text class="reminder-text">{{ reminder.text }}</text>
        <text class="reminder-meta">{{ formatRemindAt(reminder.remindAt) }} · {{ recurrenceLabel(reminder.recurrence) }}</text>
        <button
          v-if="reminder.status === 'ACTIVE'"
          data-testid="reminder-dismiss"
          class="nav-index"
          :disabled="store.busy"
          @click="onDismiss(reminder)"
        >
          完成
        </button>
        <button
          data-testid="reminder-delete"
          class="nav-index delete-btn"
          :disabled="store.busy"
          @click="onDelete(reminder.reminderId)"
        >
          删除
        </button>
      </view>

      <view v-if="store.reminders.length === 0 && !store.loadFailed" class="empty" data-testid="reminder-empty">
        <text>还没有提醒。Alpha 阶段仅保存与展示结构化提醒，不会主动推送。</text>
      </view>
    </template>
    <view v-else class="empty" data-testid="reminder-no-rel">
      <text>请先选择一个关系。</text>
    </view>
  </view>
</template>

<script lang="ts">
// REMINDER (FR-NOTIFY-001): presentation-only page; the load-bearing flows
// live in the tested api/store modules. remindAt is edited as a local
// datetime and converted to an RFC 3339 UTC instant on submit.
import { computed, onMounted, ref } from "vue";

import type { Reminder, ReminderRecurrence } from "@/api/reminder";
import { createAuthenticatedTransport } from "@/api/transport";
import ErrorNotice from "@/components/ErrorNotice.vue";
import RelationshipSelector from "@/components/RelationshipSelector.vue";
import RetryButton from "@/components/RetryButton.vue";
import type { AsyncStatus } from "@/domain/async-state";
import { readContextFromLocation, sanitizeRelationshipId } from "@/domain/context-href";
import { lastRequestId } from "@/domain/request-id";
import { useAuthStore } from "@/stores/auth";
import { useRelationshipStore } from "@/stores/relationship";
import { useReminderStore } from "@/stores/reminder";

export default {
  name: "ReminderPage",
  components: { RelationshipSelector, ErrorNotice, RetryButton },
  setup() {
    const auth = useAuthStore();
    const relStore = useRelationshipStore();
    const store = useReminderStore();

    const text = ref("");
    const remindAtLocal = ref("");
    const recurrence = ref<ReminderRecurrence>("NONE");
    const writeStatus = ref<AsyncStatus>("idle");
    const writeMessage = ref("");
    const writeRequestId = ref<string | null>(null);

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    const canCreate = computed(
      () =>
        text.value.trim().length > 0 &&
        remindAtLocal.value.length > 0 &&
        !store.busy,
    );

    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      await relStore.load(transport);
      const known = relStore.relationships.map((row) => row.relationshipId);
      const fromQuery =
        typeof location !== "undefined"
          ? sanitizeRelationshipId(readContextFromLocation(location).relationshipId, known)
          : null;
      const id = fromQuery ?? relStore.currentRelationshipId;
      if (id) {
        await onPickRelationship(id);
      }
    });

    const reminderRequestId = computed(() => lastRequestId());

    async function onPickRelationship(relationshipId: string): Promise<void> {
      writeStatus.value = "idle";
      writeMessage.value = "";
      writeRequestId.value = null;
      await store.load(transport, relationshipId);
    }

    async function retryReminders(): Promise<void> {
      const id = store.relationshipId || relStore.currentRelationshipId;
      if (id) {
        await onPickRelationship(id);
      }
    }

    async function onCreate(): Promise<void> {
      if (!canCreate.value) return;
      writeStatus.value = "loading";
      writeMessage.value = "正在添加提醒…";
      const created = await store.create(
        transport,
        text.value.trim(),
        new Date(remindAtLocal.value).toISOString(),
        recurrence.value,
      );
      writeRequestId.value = lastRequestId();
      if (created) {
        text.value = "";
        remindAtLocal.value = "";
        recurrence.value = "NONE";
        writeStatus.value = "ready";
        writeMessage.value = "提醒已添加。";
      } else {
        writeStatus.value = "error";
        writeMessage.value = "提醒未添加，请重试。";
      }
    }

    async function onDismiss(reminder: Reminder): Promise<void> {
      writeStatus.value = "loading";
      writeMessage.value = "正在更新提醒…";
      const dismissed = await store.dismiss(transport, reminder);
      writeRequestId.value = lastRequestId();
      writeStatus.value = dismissed ? "ready" : "error";
      writeMessage.value = dismissed ? "提醒已标记完成。" : "提醒未更新，请重试。";
    }

    async function onDelete(reminderId: string): Promise<void> {
      writeStatus.value = "loading";
      writeMessage.value = "正在删除提醒…";
      const deleted = await store.remove(transport, reminderId);
      writeRequestId.value = lastRequestId();
      writeStatus.value = deleted ? "ready" : "error";
      writeMessage.value = deleted ? "提醒已删除。" : "提醒未删除，请重试。";
    }

    function formatRemindAt(instant: string): string {
      const date = new Date(instant);
      if (Number.isNaN(date.getTime())) return instant;
      return date.toLocaleString();
    }

    function recurrenceLabel(r: ReminderRecurrence): string {
      switch (r) {
        case "DAILY":
          return "每天";
        case "WEEKLY":
          return "每周";
        default:
          return "单次";
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
      auth,
      relStore,
      store,
      text,
      remindAtLocal,
      recurrence,
      canCreate,
      reminderRequestId,
      writeStatus,
      writeMessage,
      writeRequestId,
      retryReminders,
      onPickRelationship,
      onCreate,
      onDismiss,
      onDelete,
      formatRemindAt,
      recurrenceLabel,
      goTo,
    };
  },
};
</script>

<style scoped>
.reminder-page {
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
.delete-btn {
  background-color: #5a1a1a;
}
.reminder-form {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin: 16rpx 0;
}
.reminder-input {
  flex: 1 1 240rpx;
  padding: 12rpx 16rpx;
  border-radius: 12rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  color: #f5f5f5;
  font-size: 26rpx;
}
.reminder-select {
  padding: 12rpx 16rpx;
  border-radius: 12rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  color: #f5f5f5;
  font-size: 26rpx;
}
.reminder-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 16rpx;
  margin-top: 12rpx;
  border-radius: 12rpx;
  background-color: #1c2b4a;
  border: 2rpx solid #2a3a5a;
}
.reminder-text {
  flex: 1;
  font-size: 26rpx;
}
.reminder-meta {
  font-size: 22rpx;
  color: #8fa0bd;
  flex: 0 0 auto;
}
.error {
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background-color: #5a1a1a;
  font-size: 24rpx;
}
.empty {
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background-color: #1c2b4a;
  font-size: 24rpx;
  color: #8fa0bd;
}
</style>
