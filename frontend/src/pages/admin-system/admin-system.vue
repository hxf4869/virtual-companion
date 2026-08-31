<template>
  <AdminConsoleShell
    active="system"
    title="系统状态"
    subtitle="读取 Go Runtime 与同源服务的当前事实"
    :access-state="accessState"
    @retry-access="retryAccess"
  >
    <template #actions>
      <text v-if="versionLabel" class="system-version ac-mono">Go Runtime · {{ versionLabel }}</text>
      <button class="ac-button" aria-label="重新检查系统状态" :disabled="loading" data-testid="system-refresh" @click="runChecks">
        <AppIcon name="refresh" :size="18" :spin="loading" />
        <text class="ac-button__label">重新检查</text>
      </button>
    </template>

    <view v-if="loading && !snapshot" class="system-loading" role="status">
      正在检查运行状态…
    </view>
    <view v-else-if="snapshot" class="system-grid" data-testid="admin-system">
      <view>
        <section class="system-ledger" aria-labelledby="runtime-check-title">
          <view class="system-card-head">
            <text id="runtime-check-title">运行检查</text>
            <text class="system-card-meta">最后刷新：{{ checkedAtLabel }}</text>
          </view>
          <view class="system-row">
            <view class="system-row__label">
              <text>存活检查</text>
              <text class="system-row__sub">进程响应</text>
            </view>
            <text class="system-badge" :class="probeClass(snapshot.liveness.state)">
              {{ probeLabel(snapshot.liveness.state) }}
            </text>
            <text class="system-row__copy">{{ probeDescription(snapshot.liveness) }}</text>
          </view>
          <view class="system-row">
            <view class="system-row__label">
              <text>就绪检查</text>
              <text class="system-row__sub">依赖就绪</text>
            </view>
            <text class="system-badge" :class="probeClass(snapshot.readiness.state)">
              {{ probeLabel(snapshot.readiness.state) }}
            </text>
            <text class="system-row__copy">{{ probeDescription(snapshot.readiness) }}</text>
          </view>
          <view class="system-row">
            <view class="system-row__label">
              <text>服务模式</text>
              <text class="system-row__sub">当前能力范围</text>
            </view>
            <text class="system-badge system-badge--neutral ac-mono">
              {{ snapshot.serviceMode?.mode ?? "无法读取" }}
            </text>
            <text class="system-row__copy">
              {{ snapshot.serviceMode?.summary ?? "服务模式读取失败，当前不推断运行能力。" }}
            </text>
          </view>
          <view class="system-row">
            <view class="system-row__label">
              <text>构建版本</text>
              <text class="system-row__sub">运行构建</text>
            </view>
            <text class="system-badge system-badge--neutral ac-mono">
              {{ versionLabel || "无法读取" }}
            </text>
            <text class="system-row__copy">
              版本信息直接来自 <text class="ac-mono">/api/v1/version</text>。
            </text>
          </view>
        </section>

        <section class="system-boundary" aria-labelledby="boundary-title">
          <text id="boundary-title" class="system-section-title">当前运行边界</text>
          <view class="system-boundary__body">
            <view class="system-boundary__line">
              <AppIcon name="check" :size="18" />
              <text>后台只读取并修改 Go Runtime 已公开的模型提供方和路由配置。</text>
            </view>
            <view class="system-boundary__line">
              <AppIcon name="check" :size="18" />
              <text>已退役的账户、审计、队列、邀请和试用管理入口不再提供。</text>
            </view>
            <view class="system-boundary__line">
              <AppIcon name="check" :size="18" />
              <text>真实凭据由受控配置或后台写接口保存，页面不会回显明文。</text>
            </view>
          </view>
        </section>
      </view>

      <aside class="system-run" aria-labelledby="current-run-title">
        <view class="system-card-head">
          <text id="current-run-title">本次检查</text>
        </view>
        <view class="system-timeline">
          <view class="system-step" :class="stepClass(snapshot.liveness.state)">
            <view class="system-step__icon"><AppIcon :name="stepIcon(snapshot.liveness.state)" :size="17" /></view>
            <view>
              <text class="system-step__title">存活探针</text>
              <text class="system-step__meta ac-mono">{{ probeMeta(snapshot.liveness) }}</text>
            </view>
          </view>
          <view class="system-step" :class="stepClass(snapshot.readiness.state)">
            <view class="system-step__icon"><AppIcon :name="stepIcon(snapshot.readiness.state)" :size="17" /></view>
            <view>
              <text class="system-step__title">就绪探针</text>
              <text class="system-step__meta ac-mono">{{ probeMeta(snapshot.readiness) }}</text>
            </view>
          </view>
          <view class="system-step" :class="snapshot.serviceMode ? 'system-step--up' : 'system-step--down'">
            <view class="system-step__icon"><AppIcon :name="snapshot.serviceMode ? 'check' : 'danger'" :size="17" /></view>
            <view>
              <text class="system-step__title">服务模式确认</text>
              <text class="system-step__meta ac-mono">
                {{ snapshot.serviceMode ? `配置：${snapshot.serviceMode.mode}` : "读取失败" }}
              </text>
            </view>
          </view>
          <view class="system-step" :class="snapshot.version ? 'system-step--up' : 'system-step--down'">
            <view class="system-step__icon"><AppIcon :name="snapshot.version ? 'check' : 'danger'" :size="17" /></view>
            <view>
              <text class="system-step__title">构建版本比对</text>
              <text class="system-step__meta ac-mono">
                {{ snapshot.version?.commit ? `提交：${snapshot.version.commit.slice(0, 12)}` : "无可用提交信息" }}
              </text>
            </view>
          </view>
        </view>
        <view class="ac-message ac-message--warning system-history">
          <AppIcon name="info" :size="18" />
          <text>后台不保存检查历史；离开或刷新页面后，本次耗时信息会丢失。</text>
        </view>
      </aside>
    </view>
  </AdminConsoleShell>
</template>

<script lang="ts">
import { computed, onMounted, ref } from "vue";

import {
  loadAdminRuntimeSnapshot,
  type AdminRuntimeSnapshot,
  type ProbeState,
  type RuntimeProbe,
} from "@/api/admin-runtime";
import AppIcon, { type AppIconName } from "@/design-system/AppIcon.vue";
import { formatLocalDateTime } from "@/domain/timestamp";
import AdminConsoleShell from "@/pages/admin-console/AdminConsoleShell.vue";
import { useAdminConsoleAccess } from "@/pages/admin-console/useAdminConsole";

export default {
  name: "AdminSystemPage",
  components: { AdminConsoleShell, AppIcon },
  setup() {
    const { accessState, transport, ensureAccess } = useAdminConsoleAccess();
    const loading = ref(false);
    const snapshot = ref<AdminRuntimeSnapshot | null>(null);
    const checkedAtLabel = computed(() => snapshot.value ? formatLocalDateTime(snapshot.value.checkedAt) : "—");
    const versionLabel = computed(() => {
      const info = snapshot.value?.version;
      if (!info) return "";
      return info.commit ? `${info.version} · ${info.commit.slice(0, 8)}` : info.version;
    });

    onMounted(async () => {
      if (await ensureAccess()) await runChecks();
    });

    async function retryAccess(): Promise<void> {
      if (await ensureAccess()) await runChecks();
    }

    async function runChecks(): Promise<void> {
      if (loading.value || accessState.value !== "ready") return;
      loading.value = true;
      try {
        snapshot.value = await loadAdminRuntimeSnapshot(transport);
      } finally {
        loading.value = false;
      }
    }

    function probeLabel(state: ProbeState): string {
      if (state === "up") return "正常";
      if (state === "down") return "异常";
      return "无法读取";
    }

    function probeClass(state: ProbeState): string {
      return state === "up" ? "system-badge--up" : "system-badge--down";
    }

    function stepClass(state: ProbeState): string {
      return state === "up" ? "system-step--up" : "system-step--down";
    }

    function stepIcon(state: ProbeState): AppIconName {
      return state === "up" ? "check" : "danger";
    }

    function probeMeta(probe: RuntimeProbe): string {
      const status = probe.httpStatus === null ? "无响应" : `HTTP ${probe.httpStatus}`;
      const duration = probe.durationMs === null ? "" : ` · ${probe.durationMs}ms`;
      return `${status}${duration}`;
    }

    function probeDescription(probe: RuntimeProbe): string {
      if (probe.state === "up") {
        return probe.kind === "liveness"
          ? "进程已响应基础 HTTP 探针。"
          : "运行依赖与服务入口已就绪。";
      }
      if (probe.state === "down") {
        return probe.kind === "liveness"
          ? "进程明确返回不可用状态。"
          : "下游依赖或运行配置尚未就绪。";
      }
      return "请求未获得可解析的运行状态；请检查服务与网络。";
    }

    return {
      accessState,
      loading,
      snapshot,
      checkedAtLabel,
      versionLabel,
      runChecks,
      retryAccess,
      probeLabel,
      probeClass,
      stepClass,
      stepIcon,
      probeMeta,
      probeDescription,
    };
  },
};
</script>

<style scoped>
.system-version { margin-right: var(--vc-space-3); color: var(--vc-muted); font-size: var(--vc-text-xs); }
.system-loading { padding: var(--vc-space-8) 0; color: var(--vc-muted); }
.system-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: clamp(28px, 3vw, 48px); align-items: start; }
.system-ledger, .system-run { border: 1px solid var(--vc-border); background: var(--vc-card); }
.system-card-head { display: flex; align-items: center; justify-content: space-between; min-height: 64px; padding: 0 var(--vc-space-5); border-bottom: 1px solid var(--vc-border); font-size: var(--vc-text-lg); font-weight: 720; }
.system-card-meta { color: var(--vc-muted); font-size: var(--vc-text-xs); font-weight: 500; }
.system-row { display: grid; grid-template-columns: minmax(138px, 22%) minmax(116px, 18%) minmax(0, 1fr); gap: var(--vc-space-4); align-items: center; min-height: 112px; padding: var(--vc-space-4) var(--vc-space-5); border-bottom: 1px solid var(--vc-border); }
.system-row:last-child { border-bottom: 0; }
.system-row__label, .system-row__sub, .system-step__title, .system-step__meta { display: block; }
.system-row__label { font-weight: 650; }
.system-row__sub, .system-step__meta { color: var(--vc-muted); font-size: var(--vc-text-xs); font-weight: 500; }
.system-badge { width: fit-content; padding: 5px 10px; border: 1px solid; font-family: var(--vc-font-mono); font-size: var(--vc-text-xs); font-weight: 720; }
.system-badge--up { border-color: var(--vc-success-border); background: var(--vc-success-bg); color: var(--vc-success); }
.system-badge--down { border-color: var(--vc-danger-border); background: var(--vc-danger-bg); color: var(--vc-danger); }
.system-badge--neutral { border-color: var(--vc-border); background: var(--vc-env); color: var(--vc-ink); }
.system-row__copy { color: var(--vc-muted); font-size: var(--vc-text-sm); }
.system-boundary { margin-top: var(--vc-space-7); }
.system-section-title { display: block; margin-bottom: var(--vc-space-4); font-size: var(--vc-text-lg); font-weight: 720; }
.system-boundary__body { display: grid; gap: var(--vc-space-3); padding: var(--vc-space-5); border: 1px solid var(--vc-border); background: rgba(255, 255, 255, .36); }
.system-boundary__line { display: flex; align-items: flex-start; gap: var(--vc-space-3); color: var(--vc-ink); font-size: var(--vc-text-sm); }
.system-boundary__line .vc-icon { color: var(--vc-primary); }
.system-timeline { padding: var(--vc-space-5); }
.system-step { position: relative; display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: var(--vc-space-3); min-height: 82px; }
.system-step:not(:last-child)::before { position: absolute; top: 25px; bottom: 5px; left: 12px; width: 1px; background: var(--vc-border); content: ""; }
.system-step__icon { display: grid; width: 26px; height: 26px; place-items: center; border: 1px solid currentColor; border-radius: 50%; background: var(--vc-card); }
.system-step--up { color: var(--vc-success); }
.system-step--down { color: var(--vc-danger); }
.system-step__title { color: currentColor; font-weight: 650; }
.system-step__meta { margin-top: var(--vc-space-1); }
.system-history { margin: 0 var(--vc-space-5) var(--vc-space-5); }
@media (max-width: 1080px) {
  .system-grid { grid-template-columns: minmax(0, 1fr) 300px; }
  .system-row { grid-template-columns: 120px 110px minmax(0, 1fr); }
}
@media (max-width: 820px) {
  .system-version { display: none; }
  .system-grid { display: block; }
  .system-row { grid-template-columns: minmax(0, 1fr) auto; gap: var(--vc-space-2) var(--vc-space-4); min-height: 0; padding: var(--vc-space-4); }
  .system-row__copy { grid-column: 1 / -1; }
  .system-run { margin-top: var(--vc-space-7); }
  .system-card-head { padding: 0 var(--vc-space-4); }
}
</style>
