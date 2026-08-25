<!-- REMINDER (FR-NOTIFY-001): structured user-created reminders page.
Technical Alpha stores and lists reminders only — no push transport
(product-scope: 不提供主动消息). Every mutation routes through the store,
which only changes state on a confirmed API result. -->
<template>
  <ConsumerShell route="/pages/reminder/reminder">

    

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
  </ConsumerShell>
</template>

<script lang="ts">
// REMINDER (FR-NOTIFY-001): presentation-only page; the load-bearing flows
// live in the tested api/store modules. remindAt is edited as a local
// datetime and converted to an RFC 3339 UTC instant on submit.
import { computed, onMounted, ref } from "vue";

import type { Reminder, ReminderRecurrence } from "@/api/reminder";
import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import ErrorNotice from "@/design-system/ErrorNotice.vue";
import RelationshipSelector from "@/components/RelationshipSelector.vue";
import RetryButton from "@/design-system/RetryButton.vue";
import type { AsyncStatus } from "@/domain/async-state";
import { readContextFromLocation, sanitizeRelationshipId } from "@/domain/context-href";
import { lastRequestId } from "@/domain/request-id";
import { useAuthStore } from "@/stores/auth";
import { useRelationshipStore } from "@/stores/relationship";
import { useReminderStore } from "@/stores/reminder";

export default {
  name: "ReminderPage",
  components: { ConsumerShell, RelationshipSelector, ErrorNotice, RetryButton },
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
.primary-btn,
.save-btn,
.submit-btn {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-5);
  border: 0;
  border-radius: var(--vc-radius-s);
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 650;
}

.primary-btn::after,
.save-btn::after,
.submit-btn::after {
  border: 0;
}

.primary-btn[disabled],
.save-btn[disabled],
.submit-btn[disabled] {
  color: var(--vc-muted);
}
.danger-zone {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-6);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-danger);
  border-radius: var(--vc-radius-m);
  background: var(--vc-danger-bg);
}

.danger-title {
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
  font-weight: 650;
}

.danger-lead,
.danger-copy {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  line-height: 1.7;
}

.danger-btn {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-danger);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-danger);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 650;
}

.danger-btn::after {
  border: 0;
}

.danger-confirm {
  display: flex;
  flex-direction: column;
  gap: var(--vc-space-2);
  width: 100%;
}
.reminder-form {
  display: grid;
  gap: var(--vc-space-2);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
}

.reminder-text {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: var(--vc-space-2) var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-ink);
  font-size: var(--vc-text-md);
}

.reminder-select {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-md);
}

.reminder-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-2);
  padding: var(--vc-space-3) var(--vc-space-4);
  border-bottom: 1px solid var(--vc-border);
}

.reminder-row:last-child {
  border-bottom: 0;
}

.reminder-meta {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.delete-btn {
  min-height: 40px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-muted);
  font: inherit;
  font-size: var(--vc-text-xs);
}

.delete-btn::after {
  border: 0;
}
</style>
