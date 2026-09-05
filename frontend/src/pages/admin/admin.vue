<template>
  <AdminConsoleShell
    active="review"
    title="注册审核"
    subtitle="审核已完成邮箱验证的注册申请"
    :access-state="accessState"
    @retry-access="retryAccess"
  >
    <template #actions>
      <button
        class="ac-button"
        data-testid="review-refresh"
        :disabled="loading || acting"
        @click="loadAccounts"
      >
        <AppIcon name="refresh" :size="18" :spin="loading" />
        <text class="ac-button__label">刷新</text>
      </button>
    </template>

    <view v-if="loading && accounts.length === 0" class="review-state" role="status">
      正在读取待审核申请…
    </view>
    <view v-else-if="loadFailed" class="review-state" role="alert">
      <text class="review-state__title">申请列表没有加载出来</text>
      <text>检查网络后再试一次。</text>
      <button class="ac-button" data-testid="review-load-retry" @click="loadAccounts">
        重新加载
      </button>
    </view>
    <view v-else-if="pendingAccounts.length === 0" class="review-empty" data-testid="review-empty">
      <view class="review-empty__icon"><AppIcon name="check" :size="26" /></view>
      <text class="review-empty__title">暂时没有待审核申请</text>
      <text class="review-empty__copy">
        注册开放后，完成邮箱验证的申请会出现在这里。
      </text>
    </view>
    <view v-else class="review-layout" data-testid="admin-review">
      <aside class="review-queue" aria-label="待审核申请">
        <view class="review-queue__head">
          <text>待审核</text>
          <text>{{ pendingAccounts.length }} 项</text>
        </view>
        <button
          v-for="account in pendingAccounts"
          :key="account.accountId"
          class="review-account"
          :class="{ 'review-account--active': account.accountId === selectedId }"
          :aria-current="account.accountId === selectedId ? 'true' : undefined"
          data-testid="review-account-row"
          @click="selectAccount(account.accountId)"
        >
          <span class="review-account__copy">
            <text class="review-account__email">{{ accountLabel(account) }}</text>
            <text class="review-account__meta">
              {{ account.emailVerified ? "邮箱已验证" : "邮箱未验证" }} · {{ formatLocalDateTime(account.createdAt) }}
            </text>
          </span>
          <AppIcon name="chevron-right" :size="18" />
        </button>
      </aside>

      <section v-if="selected" class="review-detail" aria-labelledby="review-detail-title">
        <view class="review-detail__head">
          <view>
            <text id="review-detail-title" class="review-detail__title">{{ accountLabel(selected) }}</text>
            <text class="review-detail__subtitle">注册申请详情</text>
          </view>
          <text class="review-badge">待审核</text>
        </view>

        <dl class="review-facts">
          <view class="review-fact">
            <dt>邮箱验证</dt>
            <dd :class="selected.emailVerified ? 'review-fact--ok' : 'review-fact--warn'">
              {{ selected.emailVerified ? "已完成" : "未完成" }}
            </dd>
          </view>
          <view class="review-fact">
            <dt>申请时间</dt>
            <dd>{{ formatLocalDateTime(selected.createdAt) }}</dd>
          </view>
          <view class="review-fact">
            <dt>申请账号</dt>
            <dd>{{ selected.displayName || selected.username }}</dd>
          </view>
        </dl>

        <view class="review-impact">
          <AppIcon name="info" :size="18" />
          <text>
            通过后账号可以登录；首次登录仍需绑定身份验证器，完成后才能进入聊天。
          </text>
        </view>

        <view v-if="pendingDecision" class="review-confirm" data-testid="review-confirm">
          <text class="review-confirm__title">
            {{ pendingDecision === "APPROVE" ? "确认通过这项申请" : "确认拒绝这项申请" }}
          </text>
          <text class="review-confirm__copy">输入当前管理员密码确认本次操作。</text>
          <input
            v-model="password"
            class="review-input"
            type="password"
            autocomplete="current-password"
            aria-label="当前管理员密码"
            placeholder="当前管理员密码"
            data-testid="review-password"
            :disabled="acting"
            @keyup.enter="confirmDecision"
          />
          <text v-if="actionMessage" class="review-error" role="alert">{{ actionMessage }}</text>
          <view class="review-confirm__actions">
            <button class="ac-button" :disabled="acting" @click="cancelDecision">取消</button>
            <button
              class="ac-button"
              :class="pendingDecision === 'APPROVE' ? 'ac-button--primary' : 'ac-button--danger'"
              data-testid="review-confirm-submit"
              :disabled="acting || !password"
              @click="confirmDecision"
            >
              {{ acting ? "处理中…" : "确认" }}
            </button>
          </view>
        </view>

        <view v-else class="review-actions">
          <button
            class="ac-button ac-button--primary"
            data-testid="review-approve"
            :disabled="acting || !selected.emailVerified"
            @click="startDecision('APPROVE')"
          >
            通过审核
          </button>
          <button
            class="ac-button ac-button--danger"
            data-testid="review-reject"
            :disabled="acting"
            @click="startDecision('REJECT')"
          >
            拒绝申请
          </button>
        </view>
      </section>
    </view>
  </AdminConsoleShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import {
  listAdminAccounts,
  reviewAdminAccount,
  type AdminAccount,
  type AdminReviewDecision,
} from "@/api/admin-accounts";
import { reauthAuth } from "@/api/auth";
import AppIcon from "@/design-system/AppIcon.vue";
import { formatLocalDateTime } from "@/domain/timestamp";
import AdminConsoleShell from "@/pages/admin-console/AdminConsoleShell.vue";
import { useAdminConsoleAccess } from "@/pages/admin-console/useAdminConsole";

const { accessState, transport, ensureAccess } = useAdminConsoleAccess();
const accounts = ref<AdminAccount[]>([]);
const selectedId = ref("");
const loading = ref(false);
const loadFailed = ref(false);
const acting = ref(false);
const pendingDecision = ref<AdminReviewDecision | null>(null);
const password = ref("");
const actionMessage = ref("");

const pendingAccounts = computed(() => (
  accounts.value.filter((account) => account.status === "PENDING_REVIEW")
));
const selected = computed(() => (
  pendingAccounts.value.find((account) => account.accountId === selectedId.value)
  ?? pendingAccounts.value[0]
  ?? null
));

onMounted(async () => {
  if (await ensureAccess()) await loadAccounts();
});

async function retryAccess(): Promise<void> {
  if (await ensureAccess()) await loadAccounts();
}

async function loadAccounts(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  loadFailed.value = false;
  try {
    accounts.value = await listAdminAccounts(transport);
    const stillPresent = pendingAccounts.value.some((account) => account.accountId === selectedId.value);
    if (!stillPresent) selectedId.value = pendingAccounts.value[0]?.accountId ?? "";
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}

function accountLabel(account: AdminAccount): string {
  return account.email ?? account.username;
}

function selectAccount(accountId: string): void {
  selectedId.value = accountId;
  cancelDecision();
}

function startDecision(decision: AdminReviewDecision): void {
  pendingDecision.value = decision;
  password.value = "";
  actionMessage.value = "";
}

function cancelDecision(): void {
  pendingDecision.value = null;
  password.value = "";
  actionMessage.value = "";
}

async function confirmDecision(): Promise<void> {
  const account = selected.value;
  const decision = pendingDecision.value;
  if (!account || !decision || !password.value || acting.value) return;
  acting.value = true;
  actionMessage.value = "";
  try {
    if (!await reauthAuth(transport, password.value)) {
      actionMessage.value = "管理员密码不正确。";
      return;
    }
    await reviewAdminAccount(transport, account.accountId, decision);
    accounts.value = accounts.value.map((item) => (
      item.accountId === account.accountId
        ? { ...item, status: decision === "APPROVE" ? "ACTIVE" : "REJECTED" }
        : item
    ));
    selectedId.value = pendingAccounts.value[0]?.accountId ?? "";
    cancelDecision();
  } catch {
    actionMessage.value = "没有处理成功，请刷新后重试。";
  } finally {
    acting.value = false;
  }
}
</script>

<style scoped>
.review-state,
.review-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-3);
  max-width: 640px;
  padding: var(--vc-space-7) 0;
  color: var(--vc-muted);
}

.review-state__title,
.review-empty__title {
  color: var(--vc-ink);
  font-size: var(--vc-text-xl);
  font-weight: 720;
}

.review-empty {
  align-items: center;
  max-width: none;
  min-height: 420px;
  justify-content: center;
  text-align: center;
}

.review-empty__icon {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border-radius: 50%;
  background: var(--vc-success-bg);
  color: var(--vc-success);
}

.review-empty__copy {
  max-width: 42ch;
  color: var(--vc-muted);
}

.review-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: var(--vc-space-5);
  align-items: start;
}

.review-queue,
.review-detail {
  border: 1px solid var(--vc-border);
  background: var(--vc-card);
}

.review-queue__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: 0 var(--vc-space-4);
  border-bottom: 1px solid var(--vc-border);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  font-weight: 680;
}

.review-account {
  display: flex;
  align-items: center;
  gap: var(--vc-space-3);
  width: 100%;
  min-height: 76px;
  margin: 0;
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 0;
  border-bottom: 1px solid var(--vc-border);
  border-radius: 0;
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
}

.review-account::after {
  border: 0;
}

.review-account--active {
  background: var(--vc-primary-bg);
  color: var(--vc-primary);
}

.review-account__copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  text-align: left;
}

.review-account__email {
  overflow-wrap: anywhere;
  font-weight: 680;
}

.review-account__meta {
  margin-top: 2px;
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.review-detail {
  min-height: 480px;
  padding: clamp(24px, 3vw, 40px);
}

.review-detail__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--vc-space-4);
  padding-bottom: var(--vc-space-5);
  border-bottom: 1px solid var(--vc-border);
}

.review-detail__title,
.review-detail__subtitle {
  display: block;
}

.review-detail__title {
  overflow-wrap: anywhere;
  color: var(--vc-ink);
  font-size: var(--vc-text-xl);
  font-weight: 740;
}

.review-detail__subtitle {
  margin-top: var(--vc-space-1);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.review-badge {
  flex: 0 0 auto;
  padding: 4px 10px;
  background: var(--vc-warning-bg);
  color: var(--vc-warning);
  font-size: var(--vc-text-xs);
  font-weight: 680;
}

.review-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  padding: var(--vc-space-5) 0;
  border-bottom: 1px solid var(--vc-border);
}

.review-fact {
  min-width: 0;
  padding-right: var(--vc-space-4);
}

.review-fact dt {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.review-fact dd {
  margin: var(--vc-space-1) 0 0;
  overflow-wrap: anywhere;
  color: var(--vc-ink);
  font-weight: 650;
}

.review-fact .review-fact--ok {
  color: var(--vc-success);
}

.review-fact .review-fact--warn {
  color: var(--vc-warning);
}

.review-impact {
  display: flex;
  align-items: flex-start;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-5);
  padding: var(--vc-space-3) var(--vc-space-4);
  background: var(--vc-primary-bg);
  color: var(--vc-ink);
}

.review-actions,
.review-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-5);
}

.review-confirm {
  margin-top: var(--vc-space-5);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border);
  background: var(--vc-sunken);
}

.review-confirm__title,
.review-confirm__copy {
  display: block;
}

.review-confirm__title {
  color: var(--vc-ink);
  font-weight: 700;
}

.review-confirm__copy {
  margin-top: var(--vc-space-1);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.review-input {
  width: 100%;
  min-height: 44px;
  margin-top: var(--vc-space-3);
  padding: 9px var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  background: var(--vc-card);
  color: var(--vc-ink);
}

.review-error {
  display: block;
  margin-top: var(--vc-space-2);
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
}

@media (max-width: 900px) {
  .review-layout {
    grid-template-columns: 1fr;
  }

  .review-facts {
    grid-template-columns: 1fr;
    gap: var(--vc-space-3);
  }

  .review-detail {
    min-height: 0;
  }
}

@media (max-width: 520px) {
  .review-detail__head,
  .review-actions,
  .review-confirm__actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
