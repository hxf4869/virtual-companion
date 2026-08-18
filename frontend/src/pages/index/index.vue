<template>
  <view class="page">
    <view class="console" role="main">
      <view class="masthead">
        <view class="masthead__copy">
          <text class="eyebrow">INTERNAL · TECHNICAL ALPHA</text>
          <text class="title" role="heading" aria-level="1">
            夜间预检边界台
          </text>
          <text class="description">
            只核对本地 Runtime 连通性与冻结的关闭边界，不代表模型、身份或真实用户能力可用。
          </text>
        </view>

        <button
          class="retry"
          :disabled="state === 'loading'"
          role="button"
          :tabindex="state === 'loading' ? -1 : 0"
          :aria-disabled="state === 'loading' ? 'true' : 'false'"
          :aria-label="state === 'loading' ? '正在校验 Runtime' : '重新校验 Runtime'"
          @click="retryLoad"
          @keydown.enter.prevent="retryLoad"
          @keydown.space.prevent="retryLoad"
        >
          <text class="retry__mark" aria-hidden="true">↻</text>
          <text>{{ state === "loading" ? "校验中…" : "重新校验" }}</text>
        </button>
      </view>

      <view
        class="alpha-nav"
        data-testid="alpha-nav"
        role="navigation"
        aria-label="内部页面"
      >
        <button
          data-testid="nav-chat"
          class="alpha-nav__link"
          role="button"
          aria-label="离线聊天"
          @click="goTo(chatHref())"
        >
          <text>离线聊天</text>
        </button>
        <button
          data-testid="nav-memory"
          class="alpha-nav__link"
          role="button"
          aria-label="记忆管理"
          @click="goTo(memoryHref())"
        >
          <text>记忆管理</text>
        </button>
        <button
          data-testid="nav-companion"
          class="alpha-nav__link"
          role="button"
          aria-label="角色设置"
          @click="goTo('/pages/companion/companion')"
        >
          <text>角色设置</text>
        </button>
        <button
          data-testid="nav-reminder"
          class="alpha-nav__link"
          role="button"
          aria-label="提醒管理"
          @click="goTo('/pages/reminder/reminder')"
        >
          <text>提醒管理</text>
        </button>
        <button
          data-testid="nav-consent"
          class="alpha-nav__link"
          role="button"
          aria-label="同意管理"
          @click="goTo('/pages/consent/consent')"
        >
          <text>同意管理</text>
        </button>
        <button
          data-testid="nav-age"
          class="alpha-nav__link"
          role="button"
          aria-label="成年核验"
          @click="goTo('/pages/age/age')"
        >
          <text>成年核验</text>
        </button>
        <button
          data-testid="nav-export"
          class="alpha-nav__link"
          role="button"
          aria-label="数据导出"
          @click="goTo('/pages/export/export')"
        >
          <text>数据导出</text>
        </button>
        <button
          data-testid="nav-data"
          class="alpha-nav__link"
          role="button"
          aria-label="我的数据"
          @click="goTo('/pages/data/data')"
        >
          <text>我的数据</text>
        </button>
        <button
          data-testid="nav-help"
          class="alpha-nav__link"
          role="button"
          aria-label="帮助与安全支持"
          @click="goTo('/pages/help/help')"
        >
          <text>帮助与安全支持</text>
        </button>
        <button
          data-testid="nav-ai-notice"
          class="alpha-nav__link"
          role="button"
          aria-label="模型与 AI 标识"
          @click="goTo('/pages/ai-notice/ai-notice')"
        >
          <text>模型与 AI 标识</text>
        </button>
        <button
          data-testid="nav-health"
          class="alpha-nav__link"
          role="button"
          aria-label="使用时长"
          @click="goTo('/pages/health/health')"
        >
          <text>使用时长</text>
        </button>
        <button
          data-testid="nav-incognito"
          class="alpha-nav__link"
          role="button"
          aria-label="无痕模式"
          @click="goTo('/pages/incognito/incognito')"
        >
          <text>无痕模式</text>
        </button>
        <button
          data-testid="nav-login"
          class="alpha-nav__link"
          role="button"
          aria-label="登录"
          @click="goTo('/pages/login/login')"
        >
          <text>登录</text>
        </button>
        <!-- ADMIN-UI: internal account provisioning, ADMIN only -->
        <button
          v-if="auth.role === 'ADMIN'"
          data-testid="nav-ops"
          class="alpha-nav__link"
          role="button"
          aria-label="运行与合规"
          @click="goTo('/pages/ops/ops')"
        >
          <text>运行与合规</text>
        </button>
        <button
          v-if="auth.role === 'ADMIN'"
          data-testid="nav-admin"
          class="alpha-nav__link"
          role="button"
          aria-label="账户管理"
          @click="goTo('/pages/admin/admin')"
        >
          <text>账户管理</text>
        </button>
      </view>

      <view
        v-if="relStore.status === 'ready'"
        class="current-relationship"
        data-testid="current-relationship"
        role="status"
      >
        <text>{{
          relStore.current
            ? `当前关系：${personaDisplayName(relStore.current.personaRef)}`
            : "还没有当前关系。"
        }}</text>
      </view>
      <view
        v-else-if="relStore.status === 'error'"
        class="current-relationship"
        data-testid="relationship-load-error"
        role="status"
      >
        <text>关系列表加载失败。</text>
      </view>

      <view
        class="connection"
        :class="`connection--${state}`"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <view class="connection__signal" aria-hidden="true">
          <view class="signal-dot"></view>
          <view class="signal-line"></view>
        </view>

        <view class="connection__copy">
          <text class="section-label">RUNTIME CONNECTION</text>
          <text class="connection__title">{{ connectionTitle }}</text>
          <text class="connection__description">
            {{ connectionDescription }}
          </text>
        </view>

        <view v-if="state === 'ready' && baseline" class="baseline-stamp">
          <view class="stamp-item">
            <text class="stamp-item__label">PHASE</text>
            <text class="stamp-item__value">{{ baseline.phase }}</text>
          </view>
          <view class="stamp-item">
            <text class="stamp-item__label">TRANSPORT</text>
            <text class="stamp-item__value">{{ baseline.transport }}</text>
          </view>
          <view v-if="versionInfo" class="stamp-item">
            <text class="stamp-item__label">VERSION</text>
            <text class="stamp-item__value">{{ versionInfo.version }}</text>
          </view>
          <view v-if="versionInfo?.commit" class="stamp-item">
            <text class="stamp-item__label">COMMIT</text>
            <text class="stamp-item__value">{{ versionInfo.commit }}</text>
          </view>
        </view>

        <view v-else class="connection__flag">
          <text class="connection__flag-label">{{ connectionFlag }}</text>
          <text class="connection__flag-note">当前读数不作保留</text>
        </view>
      </view>

      <view v-if="state === 'error'" class="failure" role="alert">
        <view class="failure__heading">
          <text class="failure__kind">{{ errorKindLabel }}</text>
          <text class="failure__policy">
            能力状态未验证，继续按关闭处理
          </text>
        </view>
        <text class="failure__message">{{ errorMessage }}</text>
      </view>

      <view class="boundary">
        <view class="boundary__header">
          <view>
            <text class="section-label section-label--dark">CLOSED BOUNDARY</text>
            <text class="boundary__title" role="heading" aria-level="2">
              七项关闭门禁
            </text>
          </view>
          <text class="boundary__count">
            {{ gateSummary }}
          </text>
        </view>

        <view
          class="boundary-rail"
          :class="`boundary-rail--${state}`"
          role="list"
          aria-label="Technical Alpha 关闭门禁"
        >
          <view class="boundary-track" aria-hidden="true"></view>

          <view
            v-for="gate in capabilityGates"
            :key="gate.key"
            class="gate-card"
            :class="`gate-card--${gate.state}`"
            role="listitem"
          >
            <view class="gate-node" aria-hidden="true">
              <text>{{ gate.state === "closed" ? "关" : "?" }}</text>
            </view>
            <text class="gate-card__label">{{ gate.label }}</text>
            <text class="gate-card__status">{{ gate.statusLabel }}</text>
            <text class="gate-card__boundary">{{ gate.boundary }}</text>
          </view>
        </view>

        <view v-if="state !== 'ready'" class="fail-closed-note">
          <text class="fail-closed-note__mark" aria-hidden="true">!</text>
          <text>
            {{
              state === "loading"
                ? "校验完成前，七项能力全部保持关闭。"
                : "没有可信读数时，不沿用上一次结果，七项能力全部按关闭处理。"
            }}
          </text>
        </view>
      </view>

      <view class="technical">
        <button
          id="technical-detail-toggle"
          class="technical__toggle"
          :disabled="state !== 'ready'"
          role="button"
          :tabindex="state === 'ready' ? 0 : -1"
          :aria-disabled="state === 'ready' ? 'false' : 'true'"
          :aria-expanded="detailsOpen ? 'true' : 'false'"
          aria-controls="technical-detail-panel"
          @click="toggleTechnicalDetails"
          @keydown.enter.prevent="toggleTechnicalDetails"
          @keydown.space.prevent="toggleTechnicalDetails"
        >
          <view class="technical__toggle-copy">
            <text class="section-label section-label--dark">RAW DETAIL</text>
            <text class="technical__toggle-title">
              {{ detailsOpen ? "收起技术详情" : "展开技术详情" }}
            </text>
          </view>
          <text class="technical__chevron" aria-hidden="true">
            {{ detailsOpen ? "−" : "+" }}
          </text>
        </button>

        <view
          v-if="detailsOpen && state === 'ready'"
          id="technical-detail-panel"
          class="technical__panel"
          aria-labelledby="technical-detail-toggle"
        >
          <text class="technical__notice">
            Catalog 枚举值不是运行状态；本页不据此推断模型或身份能力。
          </text>
          <text class="payload" selectable>{{ baselineText }}</text>
        </view>
      </view>

      <!-- ACCT-DELETE (FR-AUTH-004): self-service account deletion danger zone.
           Two-step confirm states the retention honestly before acting. -->
      <view class="danger-zone">
        <button
          data-testid="delete-account-open"
          class="alpha-nav__link danger-btn"
          role="button"
          aria-label="注销账号"
          @click="deleteOpen = true"
        >
          <text>注销账号</text>
        </button>
        <view v-if="deleteOpen" class="danger-confirm" data-testid="delete-account-confirm">
          <text class="danger-copy">
            注销后：业务数据（聊天、记忆、提醒、同意记录、导出）将立即删除；
            合规审计日志无法立即清除，将按既定保留期留存；注销后无法恢复登录。
          </text>
          <view class="danger-actions">
            <button
              data-testid="delete-account-cancel"
              class="alpha-nav__link"
              role="button"
              :disabled="deleteBusy"
              @click="deleteOpen = false"
            >
              <text>取消</text>
            </button>
            <button
              data-testid="delete-account-confirm-btn"
              class="alpha-nav__link danger-btn"
              role="button"
              :disabled="deleteBusy"
              @click="onConfirmDelete"
            >
              <text>{{ deleteBusy ? "注销中…" : "确认注销" }}</text>
            </button>
          </view>
          <text v-if="deleteError" class="danger-error" data-testid="delete-account-error">
            {{ deleteError }}
          </text>
        </view>
      </view>

      <view class="footer-note">
        <text>INTERNAL PREFLIGHT · LOCAL READ ONLY</text>
        <text>失败关闭 / 不缓存读数</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";

import { createAuthenticatedTransport } from "@/api/transport";
import { deleteAccount } from "@/api/auth";
import { fetchVersion, type VersionInfo } from "@/api/version";
import { personaDisplayName } from "@/domain/persona";
import { useAuthStore } from "@/stores/auth";
import { useBaselineStore } from "@/stores/baseline";
import { useRelationshipStore } from "@/stores/relationship";

const store = useBaselineStore();
const auth = useAuthStore();
const relStore = useRelationshipStore();
// SESS-REVIVE: a 401 first tries one silent refresh and replays the request.
const transport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  renewAccessToken: () => auth.renewAccessToken(transport),
  onUnauthorized: () => auth.onUnauthorized(),
});
const {
  state,
  baseline,
  baselineText,
  capabilityGates,
  verifiedGateCount,
  errorKind,
  errorMessage,
} = storeToRefs(store);
const { load } = store;
const detailsOpen = ref(false);
// VERSION-UI: build identity for the boundary console stamp (public contract
// endpoint; a failure degrades to null and the stamp simply stays empty).
const versionInfo = ref<VersionInfo | null>(null);
// ACCT-DELETE (FR-AUTH-004): two-step self-service deletion danger zone.
const deleteOpen = ref(false);
const deleteBusy = ref(false);
const deleteError = ref("");

const connectionTitle = computed(() => {
  switch (state.value) {
    case "loading":
      return "正在校验 Runtime 响应";
    case "ready":
      return "Runtime 连接与边界响应已验证";
    case "error":
      return "Runtime 未通过连接预检";
    default:
      return "等待 Runtime 读数";
  }
});

const connectionDescription = computed(() => {
  switch (state.value) {
    case "loading":
      return "旧读数已清空，正在读取并校验阶段、传输方式和七项门禁。";
    case "ready":
      return "连接通过只表示本次内部基线响应可信，不会打开任何受限能力。";
    case "error":
      return "本次读数不可用于确认能力边界，请按下方提示修复后重新校验。";
    default:
      return "页面将读取本地只读端点，并在显示前完成严格校验。";
  }
});

const connectionFlag = computed(() => {
  switch (state.value) {
    case "loading":
      return "读取中";
    case "error":
      return "未验证";
    default:
      return "待校验";
  }
});

const errorKindLabel = computed(() => {
  switch (errorKind.value) {
    case "timeout":
      return "读取超时";
    case "unreachable":
      return "无法连接";
    case "http":
      return "HTTP 错误";
    case "invalid-response":
      return "响应不可信";
    default:
      return "预检失败";
  }
});

const gateSummary = computed(() =>
  state.value === "ready"
    ? `${verifiedGateCount.value} / 7 已验证关闭`
    : "0 / 7 已验证 · 全部保持关闭",
);

function retryLoad(): void {
  if (state.value !== "loading") {
    void load();
  }
}

function memoryHref(): string {
  const id = relStore.currentRelationshipId;
  if (!id) return "/pages/memory/memory";
  return `/pages/memory/memory?relationshipId=${encodeURIComponent(id)}`;
}

function chatHref(): string {
  const id = relStore.currentRelationshipId;
  if (!id) return "/pages/chat/chat";
  return `/pages/chat/chat?relationshipId=${encodeURIComponent(id)}`;
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
    // Presentation-only navigation; never break the preflight console.
  }
}

function toggleTechnicalDetails(): void {
  if (state.value === "ready") {
    detailsOpen.value = !detailsOpen.value;
  }
}

/**
 * ACCT-DELETE (FR-AUTH-004): confirm the self-service deletion. On a
 * confirmed server result the local session is cleared and the page returns
 * to the login route; the server-side tombstone already blocks login/refresh.
 */
async function onConfirmDelete(): Promise<void> {
  if (deleteBusy.value) return;
  deleteBusy.value = true;
  deleteError.value = "";
  try {
    const ok = await deleteAccount(transport);
    if (!ok) {
      deleteError.value = "注销请求未获确认，请重试。";
      return;
    }
    auth.clear();
    deleteOpen.value = false;
    goTo("/pages/login/login");
  } catch {
    deleteError.value = "注销失败，请重试。";
  } finally {
    deleteBusy.value = false;
  }
}

watch(state, (nextState) => {
  if (nextState !== "ready") {
    detailsOpen.value = false;
  }
});

onMounted(async () => {
  // SESS-REVIVE: restore the session from the HttpOnly refresh cookie first.
  if (!auth.isAuthenticated) {
    await auth.tryRefresh(transport);
  }
  void load();
  void relStore.load(transport);
  // VERSION-UI: independent of the baseline preflight (public endpoint); a
  // non-OK response yields null and the stamp simply omits the fields.
  versionInfo.value = await fetchVersion(transport);
});
</script>

<style scoped>
.page {
  --deep-sea: #14213d;
  --signal: #168c84;
  --coral: #d95d55;
  --amber: #b77a16;
  --mist: #eef3f9;
  --paper: #fbfcfe;
  min-height: 100vh;
  box-sizing: border-box;
  overflow-x: hidden;
  padding: clamp(24px, 4vw, 58px) clamp(16px, 4vw, 52px);
  color: var(--paper);
  background-color: var(--deep-sea);
  background-image:
    linear-gradient(rgba(238, 243, 249, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(238, 243, 249, 0.035) 1px, transparent 1px);
  background-size: 32px 32px;
  font-family: Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.console {
  width: min(100%, 1240px);
  margin: 0 auto;
}

.masthead {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 28px;
}

.masthead__copy {
  max-width: 760px;
}

.eyebrow,
.section-label,
.boundary__count,
.stamp-item__label,
.stamp-item__value,
.footer-note {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

.eyebrow,
.section-label {
  display: block;
  color: rgba(238, 243, 249, 0.64);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  line-height: 1.4;
}

.title {
  display: block;
  margin-top: 9px;
  font-family: "Avenir Next Condensed", "Avenir Next", "Segoe UI",
    "PingFang SC", sans-serif;
  font-size: clamp(36px, 5vw, 68px);
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 1.04;
}

.description {
  display: block;
  max-width: 680px;
  margin-top: 16px;
  color: rgba(238, 243, 249, 0.76);
  font-size: clamp(14px, 1.6vw, 17px);
  line-height: 1.75;
}

.retry,
.technical__toggle {
  box-sizing: border-box;
  margin: 0;
  border: 0;
}

.retry::after,
.technical__toggle::after {
  border: 0;
}

.retry {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 46px;
  padding: 0 20px;
  border: 1px solid rgba(238, 243, 249, 0.35);
  border-radius: 8px;
  color: var(--deep-sea);
  background: var(--paper);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    background-color 160ms ease;
}

.retry:not([disabled]):hover {
  transform: translateY(-1px);
  border-color: var(--signal);
  background: var(--mist);
}

.retry[disabled] {
  color: rgba(20, 33, 61, 0.54);
  opacity: 1;
}

.retry__mark {
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 17px;
}

.retry:focus-visible {
  outline: 3px solid #ffffff;
  outline-offset: 4px;
}

.alpha-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0 0 20px;
}

.alpha-nav__link {
  box-sizing: border-box;
  margin: 0;
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid rgba(238, 243, 249, 0.28);
  border-radius: 8px;
  color: var(--paper);
  background: rgba(251, 252, 254, 0.08);
  font-size: 13px;
  font-weight: 700;
}

.alpha-nav__link::after {
  border: 0;
}

.alpha-nav__link:focus-visible {
  outline: 3px solid #ffffff;
  outline-offset: 3px;
}

.current-relationship {
  margin: -8px 0 20px;
  color: rgba(238, 243, 249, 0.78);
  font-size: 13px;
}

.technical__toggle:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 3px var(--deep-sea);
}

.connection {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: clamp(18px, 3vw, 34px);
  min-width: 0;
  padding: clamp(22px, 3vw, 34px);
  overflow: hidden;
  border: 1px solid rgba(238, 243, 249, 0.18);
  border-radius: 14px;
  background: rgba(251, 252, 254, 0.075);
}

.connection::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: rgba(238, 243, 249, 0.34);
  content: "";
}

.connection--ready::before {
  background: var(--signal);
}

.connection--loading::before {
  background: var(--amber);
}

.connection--error::before {
  background: var(--coral);
}

.connection__signal {
  display: flex;
  align-items: center;
  width: 72px;
}

.signal-dot {
  z-index: 1;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  flex: 0 0 auto;
  border: 4px solid var(--deep-sea);
  border-radius: 50%;
  outline: 2px solid rgba(238, 243, 249, 0.54);
  background: rgba(238, 243, 249, 0.54);
}

.signal-line {
  width: 100%;
  height: 1px;
  background: rgba(238, 243, 249, 0.26);
}

.connection--ready .signal-dot {
  outline-color: var(--signal);
  background: var(--signal);
}

.connection--loading .signal-dot {
  outline-color: var(--amber);
  background: var(--amber);
  animation: signal-pulse 1.4s ease-in-out infinite;
}

.connection--error .signal-dot {
  outline-color: var(--coral);
  background: var(--coral);
}

.connection__copy {
  min-width: 0;
}

.connection__title {
  display: block;
  margin-top: 6px;
  font-family: "Avenir Next", "Segoe UI", "PingFang SC", sans-serif;
  font-size: clamp(20px, 2.5vw, 30px);
  font-weight: 650;
  letter-spacing: -0.025em;
  line-height: 1.24;
}

.connection__description {
  display: block;
  max-width: 650px;
  margin-top: 8px;
  color: rgba(238, 243, 249, 0.7);
  font-size: 13px;
  line-height: 1.65;
}

.baseline-stamp {
  display: flex;
  align-items: stretch;
  overflow: hidden;
  border: 1px solid rgba(238, 243, 249, 0.2);
  border-radius: 8px;
}

.stamp-item {
  min-width: 132px;
  padding: 13px 15px;
}

.stamp-item + .stamp-item {
  border-left: 1px solid rgba(238, 243, 249, 0.2);
}

.stamp-item__label {
  display: block;
  color: rgba(238, 243, 249, 0.65);
  font-size: 9px;
  letter-spacing: 0.13em;
}

.stamp-item__value {
  display: block;
  margin-top: 7px;
  color: #89d3cc;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.connection__flag {
  min-width: 134px;
  padding-left: 22px;
  border-left: 1px solid rgba(238, 243, 249, 0.18);
}

.connection__flag-label,
.connection__flag-note {
  display: block;
}

.connection__flag-label {
  color: #e4b96d;
  font-size: 14px;
  font-weight: 700;
}

.connection--error .connection__flag-label {
  color: #f19a94;
}

.connection__flag-note {
  margin-top: 6px;
  color: rgba(238, 243, 249, 0.65);
  font-size: 11px;
}

.failure {
  display: grid;
  grid-template-columns: minmax(220px, 0.7fr) minmax(0, 1.3fr);
  gap: 20px;
  margin-top: 14px;
  padding: 18px 22px;
  border: 1px solid rgba(217, 93, 85, 0.55);
  border-radius: 10px;
  color: var(--paper);
  background: rgba(217, 93, 85, 0.1);
}

.failure__kind,
.failure__policy,
.failure__message {
  display: block;
}

.failure__kind {
  color: #f4aba6;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.failure__policy {
  margin-top: 5px;
  font-size: 13px;
  font-weight: 700;
}

.failure__message {
  align-self: center;
  color: rgba(251, 252, 254, 0.78);
  font-size: 13px;
  line-height: 1.65;
}

.boundary {
  margin-top: 24px;
  padding: clamp(24px, 3.5vw, 42px);
  border-radius: 18px;
  color: var(--deep-sea);
  background: var(--mist);
}

.boundary__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.section-label--dark {
  color: rgba(20, 33, 61, 0.72);
}

.boundary__title {
  display: block;
  margin-top: 7px;
  font-family: "Avenir Next", "Segoe UI", "PingFang SC", sans-serif;
  font-size: clamp(24px, 3vw, 36px);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.2;
}

.boundary__count {
  color: rgba(20, 33, 61, 0.66);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: right;
}

.boundary-rail {
  position: relative;
  margin-top: 28px;
}

.boundary-track {
  position: absolute;
  z-index: 0;
  top: 17px;
  right: calc(100% / 14);
  left: calc(100% / 14);
  height: 2px;
  overflow: visible;
  background: rgba(20, 33, 61, 0.24);
}

.boundary-rail--ready .boundary-track {
  background: var(--signal);
}

.boundary-rail--error .boundary-track {
  background: repeating-linear-gradient(
    90deg,
    var(--coral) 0 16px,
    transparent 16px 25px
  );
}

.boundary-rail--loading .boundary-track,
.boundary-rail--idle .boundary-track {
  background: repeating-linear-gradient(
    90deg,
    rgba(183, 122, 22, 0.58) 0 10px,
    transparent 10px 17px
  );
}

.boundary-rail--loading .boundary-track::after {
  position: absolute;
  top: 50%;
  left: 0;
  width: 10px;
  height: 10px;
  border: 2px solid var(--mist);
  border-radius: 50%;
  background: var(--amber);
  box-shadow: 0 0 0 1px var(--amber);
  content: "";
  animation: rail-scan-x 2.2s ease-in-out infinite;
}

.gate-card {
  position: relative;
  z-index: 1;
  min-width: 0;
  box-sizing: border-box;
  padding: 48px 12px 16px;
  text-align: center;
}

.gate-node {
  position: absolute;
  top: 0;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  box-sizing: border-box;
  transform: translateX(-50%);
  border: 2px solid var(--amber);
  border-radius: 50%;
  color: #7b510d;
  background: var(--mist);
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 10px;
  font-weight: 800;
}

.gate-card--closed .gate-node {
  border-color: var(--signal);
  color: #0e625c;
}

.gate-card__label,
.gate-card__status,
.gate-card__boundary {
  display: block;
}

.gate-card__label {
  min-height: 44px;
  font-size: 14px;
  font-weight: 750;
  line-height: 1.45;
}

.gate-card__status {
  margin-top: 7px;
  color: #8a5b0f;
  font-size: 10px;
  font-weight: 800;
  line-height: 1.45;
}

.gate-card--closed .gate-card__status {
  color: #0f6f68;
}

.gate-card__boundary {
  margin-top: 8px;
  color: rgba(20, 33, 61, 0.75);
  font-size: 11px;
  line-height: 1.55;
}

.gate-card + .gate-card {
  border-left: 1px solid rgba(20, 33, 61, 0.09);
}

.boundary-rail {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.boundary-track {
  grid-column: 1 / -1;
}

.fail-closed-note {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid rgba(20, 33, 61, 0.12);
  color: rgba(20, 33, 61, 0.72);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.55;
}

.fail-closed-note__mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border: 1px solid var(--amber);
  border-radius: 50%;
  color: #7b510d;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 10px;
  font-weight: 800;
}

.technical {
  margin-top: 14px;
  overflow: hidden;
  border: 1px solid rgba(238, 243, 249, 0.18);
  border-radius: 12px;
  background: var(--paper);
}

.technical__toggle {
  width: 100%;
  min-height: 74px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 22px;
  border-radius: 0;
  color: var(--deep-sea);
  background: var(--paper);
  text-align: left;
}

.technical__toggle:not([disabled]):hover {
  background: var(--mist);
}

.technical__toggle[disabled] {
  color: rgba(20, 33, 61, 0.44);
  opacity: 1;
}

.technical__toggle-copy {
  min-width: 0;
}

.technical__toggle-title {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  font-weight: 750;
}

.technical__chevron {
  color: var(--signal);
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 24px;
  font-weight: 500;
}

.technical__toggle[disabled] .technical__chevron {
  color: rgba(20, 33, 61, 0.35);
}

.technical__panel {
  padding: 0 22px 22px;
}

.technical__notice {
  display: block;
  padding: 14px 16px;
  border-left: 3px solid var(--signal);
  color: rgba(20, 33, 61, 0.72);
  background: var(--mist);
  font-size: 12px;
  line-height: 1.6;
}

.payload {
  display: block;
  max-width: 100%;
  box-sizing: border-box;
  overflow-x: auto;
  margin-top: 12px;
  padding: 18px;
  border-radius: 8px;
  color: #dce7f3;
  background: #0e192f;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.footer-note {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin-top: 16px;
  color: rgba(238, 243, 249, 0.72);
  font-size: 9px;
  letter-spacing: 0.1em;
  line-height: 1.5;
}

.danger-zone {
  margin-top: 14px;
  padding: 16px 18px;
  border: 1px solid rgba(217, 93, 85, 0.45);
  border-radius: 12px;
  background: rgba(217, 93, 85, 0.08);
}

.danger-btn {
  border-color: rgba(217, 93, 85, 0.65);
  color: #f4aba6;
}

.danger-confirm {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.danger-copy {
  color: rgba(238, 243, 249, 0.82);
  font-size: 12px;
  line-height: 1.6;
}

.danger-actions {
  display: flex;
  gap: 10px;
}

.danger-error {
  color: #f4aba6;
  font-size: 12px;
}

@keyframes signal-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(183, 122, 22, 0.1);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(183, 122, 22, 0.2);
  }
}

@keyframes rail-scan-x {
  0%,
  100% {
    left: 0;
    transform: translate(-50%, -50%);
  }
  50% {
    left: 100%;
    transform: translate(-50%, -50%);
  }
}

@keyframes rail-scan-y {
  0%,
  100% {
    top: 0;
    transform: translate(-50%, -50%);
  }
  50% {
    top: 100%;
    transform: translate(-50%, -50%);
  }
}

@media (max-width: 899px) {
  .masthead {
    align-items: flex-start;
  }

  .connection {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .connection__signal {
    width: 48px;
  }

  .baseline-stamp,
  .connection__flag {
    grid-column: 2;
    justify-self: start;
  }

  .connection__flag {
    padding: 12px 0 0;
    border-top: 1px solid rgba(238, 243, 249, 0.18);
    border-left: 0;
  }

  .boundary-rail {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .boundary-track {
    top: 22px;
    right: auto;
    bottom: 22px;
    left: 17px;
    width: 2px;
    height: auto;
  }

  .boundary-rail--error .boundary-track {
    background: repeating-linear-gradient(
      180deg,
      var(--coral) 0 16px,
      transparent 16px 25px
    );
  }

  .boundary-rail--loading .boundary-track,
  .boundary-rail--idle .boundary-track {
    background: repeating-linear-gradient(
      180deg,
      rgba(183, 122, 22, 0.58) 0 10px,
      transparent 10px 17px
    );
  }

  .boundary-rail--loading .boundary-track::after {
    top: 0;
    left: 50%;
    animation-name: rail-scan-y;
  }

  .gate-card {
    min-height: 92px;
    padding: 16px 16px 16px 56px;
    border: 1px solid rgba(20, 33, 61, 0.1);
    border-radius: 9px;
    background: rgba(251, 252, 254, 0.66);
    text-align: left;
  }

  .gate-card + .gate-card {
    border-left: 1px solid rgba(20, 33, 61, 0.1);
  }

  .gate-node {
    top: 50%;
    left: 0;
    transform: translateY(-50%);
  }

  .gate-card__label {
    min-height: 0;
  }

  .gate-card__status,
  .gate-card__boundary {
    margin-top: 4px;
  }
}

@media (max-width: 599px) {
  .page {
    padding: 22px 14px 30px;
    background-size: 24px 24px;
  }

  .masthead {
    display: block;
    margin-bottom: 22px;
  }

  .title {
    font-size: 40px;
  }

  .retry {
    width: 100%;
    margin-top: 22px;
  }

  .connection {
    grid-template-columns: 1fr;
    padding: 22px 20px;
  }

  .connection__signal {
    width: 100%;
  }

  .connection__copy,
  .baseline-stamp,
  .connection__flag {
    grid-column: 1;
  }

  .baseline-stamp {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr;
  }

  .stamp-item {
    min-width: 0;
  }

  .stamp-item + .stamp-item {
    border-top: 1px solid rgba(238, 243, 249, 0.2);
    border-left: 0;
  }

  .failure {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .boundary {
    padding: 22px 18px;
  }

  .boundary__header {
    display: block;
  }

  .boundary__count {
    display: block;
    margin-top: 12px;
    text-align: left;
  }

  .technical__toggle {
    padding-right: 18px;
    padding-left: 18px;
  }

  .technical__panel {
    padding-right: 14px;
    padding-bottom: 14px;
    padding-left: 14px;
  }

  .footer-note {
    display: grid;
    gap: 5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .retry {
    transition: none;
  }

  .retry:not([disabled]):hover {
    transform: none;
  }

  .connection--loading .signal-dot,
  .boundary-rail--loading .boundary-track::after {
    animation: none;
  }

  .boundary-rail--loading .boundary-track::after {
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
}
</style>
