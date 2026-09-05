<template>
  <AdminConsoleShell
    active="accounts"
    title="账号"
    subtitle="查看准入与安全状态，处理必要的身份验证器重置"
    :access-state="accessState"
    @retry-access="retryAccess"
  >
    <template #actions>
      <button class="ac-button" :disabled="loading || acting" data-testid="accounts-refresh" @click="loadAccounts">
        <AppIcon name="refresh" :size="18" :spin="loading" />
        <text class="ac-button__label">刷新</text>
      </button>
    </template>

    <view v-if="loading && accounts.length === 0" class="accounts-state" role="status">
      正在读取账号…
    </view>
    <view v-else-if="loadFailed" class="accounts-state" role="alert">
      <text class="accounts-state__title">账号列表没有加载出来</text>
      <text>检查网络后再试一次。</text>
      <button class="ac-button" data-testid="accounts-load-retry" @click="loadAccounts">重新加载</button>
    </view>
    <view v-else-if="accounts.length === 0" class="accounts-state" data-testid="accounts-empty">
      <text class="accounts-state__title">暂无账号</text>
    </view>
    <view v-else class="accounts-layout" data-testid="admin-accounts">
      <aside class="accounts-list" aria-label="账号列表">
        <view class="accounts-list__head">
          <text>全部账号</text>
          <text>{{ accounts.length }} 个</text>
        </view>
        <button
          v-for="account in accounts"
          :key="account.accountId"
          class="accounts-row"
          :class="{ 'accounts-row--active': account.accountId === selectedId }"
          :aria-current="account.accountId === selectedId ? 'true' : undefined"
          data-testid="admin-account-row"
          @click="selectAccount(account.accountId)"
        >
          <span class="accounts-row__copy">
            <text class="accounts-row__name">{{ accountLabel(account) }}</text>
            <text class="accounts-row__meta">{{ roleLabel(account.role) }} · {{ statusLabel(account.status) }}</text>
          </span>
          <AppIcon name="chevron-right" :size="18" />
        </button>
      </aside>

      <section v-if="selected" class="account-detail" aria-labelledby="account-detail-title">
        <view class="account-detail__head">
          <view>
            <text id="account-detail-title" class="account-detail__title">{{ accountLabel(selected) }}</text>
            <text class="account-detail__subtitle">{{ selected.displayName }}</text>
          </view>
          <text class="account-status" :class="statusClass(selected.status)">
            {{ statusLabel(selected.status) }}
          </text>
        </view>

        <view class="account-facts">
          <view class="account-fact">
            <text class="account-fact__label">账号类型</text>
            <text class="account-fact__value">{{ roleLabel(selected.role) }}</text>
          </view>
          <view class="account-fact">
            <text class="account-fact__label">邮箱验证</text>
            <text class="account-fact__value">{{ selected.emailVerified ? "已完成" : "未完成" }}</text>
          </view>
          <view class="account-fact">
            <text class="account-fact__label">创建时间</text>
            <text class="account-fact__value">{{ formatLocalDateTime(selected.createdAt) }}</text>
          </view>
          <view v-if="selected.reviewedAt" class="account-fact">
            <text class="account-fact__label">审核时间</text>
            <text class="account-fact__value">{{ formatLocalDateTime(selected.reviewedAt) }}</text>
          </view>
        </view>

        <section class="account-security" aria-labelledby="account-security-title">
          <view class="account-security__head">
            <view>
              <text id="account-security-title" class="account-security__title">身份验证器</text>
              <text class="account-security__state">
                {{ selected.authenticatorEnabled ? "已开启" : "需要设置" }}
              </text>
            </view>
            <button
              v-if="selected.authenticatorEnabled && selected.status === 'ACTIVE' && !resetOpen"
              class="ac-button ac-button--danger"
              data-testid="authenticator-reset-open"
              :disabled="acting"
              @click="openReset"
            >
              重置身份验证器
            </button>
          </view>

          <view v-if="resetOpen" class="account-reset" data-testid="authenticator-reset-confirm">
            <text class="account-reset__title">这会让该账号从所有设备退出</text>
            <text class="account-reset__copy">
              现有身份验证器、恢复码、登录会话和信任设备都会失效。该用户下次登录时必须重新绑定身份验证器。
            </text>
            <input
              v-model="password"
              class="account-reset__input"
              type="password"
              autocomplete="current-password"
              aria-label="当前管理员密码"
              placeholder="当前管理员密码"
              data-testid="authenticator-reset-password"
              :disabled="acting"
              @keyup.enter="confirmReset"
            />
            <text v-if="actionMessage" class="account-reset__error" role="alert">{{ actionMessage }}</text>
            <view class="account-reset__actions">
              <button class="ac-button" :disabled="acting" @click="closeReset">取消</button>
              <button
                class="ac-button ac-button--danger"
                data-testid="authenticator-reset-submit"
                :disabled="acting || !password"
                @click="confirmReset"
              >
                {{ acting ? "重置中…" : "确认重置" }}
              </button>
            </view>
          </view>

          <view v-else-if="actionMessage" class="ac-message" role="status">
            <AppIcon name="check" :size="18" />
            <text>{{ actionMessage }}</text>
          </view>
        </section>
      </section>
    </view>
  </AdminConsoleShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import {
  listAdminAccounts,
  resetAdminAuthenticator,
  type AdminAccount,
  type AdminAccountStatus,
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
const resetOpen = ref(false);
const password = ref("");
const actionMessage = ref("");
const acting = ref(false);

const selected = computed(() => (
  accounts.value.find((account) => account.accountId === selectedId.value)
  ?? accounts.value[0]
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
    if (!accounts.value.some((account) => account.accountId === selectedId.value)) {
      selectedId.value = accounts.value[0]?.accountId ?? "";
    }
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}

function accountLabel(account: AdminAccount): string {
  return account.email ?? account.username;
}

function roleLabel(role: AdminAccount["role"]): string {
  return role === "ADMIN" ? "管理员" : "用户";
}

function statusLabel(status: AdminAccountStatus): string {
  return ({
    EMAIL_UNVERIFIED: "等待邮箱验证",
    PENDING_REVIEW: "待审核",
    ACTIVE: "正常",
    DISABLED: "已停用",
    REJECTED: "已拒绝",
  } as const)[status];
}

function statusClass(status: AdminAccountStatus): string {
  if (status === "ACTIVE") return "account-status--ok";
  if (status === "PENDING_REVIEW" || status === "EMAIL_UNVERIFIED") return "account-status--warn";
  return "account-status--muted";
}

function selectAccount(accountId: string): void {
  selectedId.value = accountId;
  closeReset();
}

function openReset(): void {
  resetOpen.value = true;
  password.value = "";
  actionMessage.value = "";
}

function closeReset(): void {
  resetOpen.value = false;
  password.value = "";
  actionMessage.value = "";
}

async function confirmReset(): Promise<void> {
  const account = selected.value;
  if (!account || !password.value || acting.value) return;
  acting.value = true;
  actionMessage.value = "";
  try {
    if (!await reauthAuth(transport, password.value)) {
      actionMessage.value = "管理员密码不正确。";
      return;
    }
    if (!await resetAdminAuthenticator(transport, account.accountId)) {
      actionMessage.value = "没有重置成功，请稍后重试。";
      return;
    }
    accounts.value = accounts.value.map((item) => (
      item.accountId === account.accountId
        ? { ...item, authenticatorEnabled: false }
        : item
    ));
    resetOpen.value = false;
    password.value = "";
    actionMessage.value = "身份验证器已重置。";
  } catch {
    actionMessage.value = "没有重置成功，请刷新后重试。";
  } finally {
    acting.value = false;
  }
}
</script>

<style scoped>
.accounts-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-3);
  padding: var(--vc-space-7) 0;
  color: var(--vc-muted);
}

.accounts-state__title {
  color: var(--vc-ink);
  font-size: var(--vc-text-xl);
  font-weight: 720;
}

.accounts-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: var(--vc-space-5);
  align-items: start;
}

.accounts-list,
.account-detail {
  border: 1px solid var(--vc-border);
  background: var(--vc-card);
}

.accounts-list__head {
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

.accounts-row {
  display: flex;
  align-items: center;
  gap: var(--vc-space-3);
  width: 100%;
  min-height: 72px;
  margin: 0;
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 0;
  border-bottom: 1px solid var(--vc-border);
  border-radius: 0;
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
}

.accounts-row::after {
  border: 0;
}

.accounts-row--active {
  background: var(--vc-primary-bg);
  color: var(--vc-primary);
}

.accounts-row__copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  text-align: left;
}

.accounts-row__name {
  overflow-wrap: anywhere;
  font-weight: 680;
}

.accounts-row__meta {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.account-detail {
  min-height: 500px;
  padding: clamp(24px, 3vw, 40px);
}

.account-detail__head,
.account-security__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--vc-space-4);
}

.account-detail__head {
  padding-bottom: var(--vc-space-5);
  border-bottom: 1px solid var(--vc-border);
}

.account-detail__title,
.account-detail__subtitle,
.account-security__title,
.account-security__state,
.account-reset__title,
.account-reset__copy {
  display: block;
}

.account-detail__title {
  overflow-wrap: anywhere;
  font-size: var(--vc-text-xl);
  font-weight: 740;
}

.account-detail__subtitle,
.account-security__state,
.account-reset__copy {
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.account-status {
  flex: 0 0 auto;
  padding: 4px 10px;
  font-size: var(--vc-text-xs);
  font-weight: 680;
}

.account-status--ok {
  background: var(--vc-success-bg);
  color: var(--vc-success);
}

.account-status--warn {
  background: var(--vc-warning-bg);
  color: var(--vc-warning);
}

.account-status--muted {
  background: var(--vc-sunken);
  color: var(--vc-muted);
}

.account-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--vc-space-4);
  padding: var(--vc-space-5) 0;
  border-bottom: 1px solid var(--vc-border);
}

.account-fact {
  min-width: 0;
}

.account-fact__label,
.account-fact__value {
  display: block;
}

.account-fact__label {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.account-fact__value {
  margin-top: var(--vc-space-1);
  overflow-wrap: anywhere;
  font-weight: 650;
}

.account-security {
  margin-top: var(--vc-space-5);
  padding: var(--vc-space-5);
  border: 1px solid var(--vc-border);
  background: var(--vc-sunken);
}

.account-security__title,
.account-reset__title {
  font-weight: 720;
}

.account-reset {
  margin-top: var(--vc-space-4);
  padding-top: var(--vc-space-4);
  border-top: 1px solid var(--vc-border);
}

.account-reset__input {
  width: 100%;
  min-height: 44px;
  margin-top: var(--vc-space-3);
  padding: 9px var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  background: var(--vc-card);
  color: var(--vc-ink);
}

.account-reset__error {
  display: block;
  margin-top: var(--vc-space-2);
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
}

.account-reset__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-4);
}

@media (max-width: 900px) {
  .accounts-layout {
    grid-template-columns: 1fr;
  }

  .account-detail {
    min-height: 0;
  }
}

@media (max-width: 520px) {
  .account-detail__head,
  .account-security__head,
  .account-reset__actions {
    align-items: stretch;
    flex-direction: column;
  }

  .account-facts {
    grid-template-columns: 1fr;
  }
}
</style>
