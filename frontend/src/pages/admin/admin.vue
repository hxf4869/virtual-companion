<template>
  <AdminConsoleShell
    active="overview"
    title="运行总览"
    subtitle="从当前生效配置判断生成式聊天是否可用"
    :access-state="accessState"
    @retry-access="retryAccess"
  >
    <template #actions>
      <view v-if="versionLabel" class="overview-runtime ac-mono">
        <text class="ac-status ac-status--up">Go Runtime</text>
        {{ versionLabel }}
      </view>
      <button class="ac-button" aria-label="刷新运行状态" :disabled="loading" data-testid="overview-refresh" @click="load">
        <AppIcon name="refresh" :size="18" :spin="loading" />
        <text class="ac-button__label">刷新状态</text>
      </button>
    </template>

    <view v-if="loading && !snapshot" class="overview-loading" role="status">
      正在读取 Go Runtime 与模型配置…
    </view>

    <view v-else-if="snapshot" class="overview-grid" data-testid="admin-overview">
      <view class="overview-primary">
        <section class="overview-ledger" aria-labelledby="effective-title">
          <view class="overview-section-title">
            <AppIcon name="route" :size="22" />
            <text id="effective-title">当前生效状态</text>
            <text v-if="checkedAtLabel" class="overview-updated">更新于 {{ checkedAtLabel }}</text>
          </view>

          <view class="overview-fact overview-fact--root">
            <text class="overview-fact__label">Go Runtime</text>
            <view class="overview-fact__value">
              <text
                class="ac-status"
                :class="snapshot.readiness.state === 'up' ? 'ac-status--up' : 'ac-status--down'"
              >
                {{ runtimeStateLabel }}
              </text>
              <text v-if="versionLabel" class="overview-code ac-mono">{{ versionLabel }}</text>
            </view>
          </view>

          <view class="overview-fact overview-fact--branch">
            <text class="overview-fact__label">服务模式</text>
            <view class="overview-fact__value">
              <text v-if="snapshot.serviceMode" class="overview-mode ac-mono">
                {{ snapshot.serviceMode.mode }}
              </text>
              <text v-else class="overview-unavailable">无法读取</text>
              <text v-if="snapshot.serviceMode" class="overview-fact__hint">
                {{ snapshot.serviceMode.summary }}
              </text>
            </view>
          </view>

          <view class="overview-fact overview-fact--branch">
            <text class="overview-fact__label">提供方</text>
            <view class="overview-fact__value">
              <text v-if="snapshot.providers" class="overview-fact__strong">
                {{ enabledProviders.length }} 个启用 / 共 {{ snapshot.providers.length }} 个
              </text>
              <text v-else class="overview-unavailable">配置读取失败</text>
              <text v-if="primaryProvider" class="overview-fact__hint ac-mono">
                {{ primaryProvider.providerId }}
              </text>
            </view>
          </view>

          <view class="overview-fact overview-fact--deep">
            <text class="overview-fact__label">启用模型</text>
            <view class="overview-fact__value">
              <text v-if="snapshot.providers" class="overview-fact__strong">
                {{ enabledModels.length }} 个
              </text>
              <text v-else class="overview-unavailable">未知</text>
              <text v-if="primaryModel" class="overview-fact__hint ac-mono">
                {{ primaryModel.modelId }}
              </text>
            </view>
          </view>

          <view class="overview-fact overview-fact--route">
            <text class="overview-fact__label">主路由</text>
            <view class="overview-fact__value">
              <text v-if="primaryRoute" class="overview-route ac-mono">
                {{ primaryRoute.providerId }} → {{ primaryRoute.modelId }}
              </text>
              <text v-else class="overview-unavailable">当前没有启用路由</text>
            </view>
          </view>
        </section>

        <section class="overview-quick" aria-labelledby="quick-title">
          <view class="overview-section-title overview-section-title--plain">
            <AppIcon name="sparkle" :size="22" />
            <text id="quick-title">快速进入</text>
          </view>
          <button class="ac-link-row" @click="goTo('/pages/admin-models/admin-models')">
            <view>
              <text class="ac-link-row__title">检查模型服务配置</text>
              <text class="ac-link-row__copy">查看提供方、连接信息、凭据状态与模型目录</text>
            </view>
            <AppIcon name="chevron-right" :size="20" />
          </button>
          <button class="ac-link-row" @click="goTo('/pages/admin-routing/admin-routing')">
            <view>
              <text class="ac-link-row__title">调整全局路由顺序</text>
              <text class="ac-link-row__copy">按当前启用模型配置确定性调用优先级</text>
            </view>
            <AppIcon name="chevron-right" :size="20" />
          </button>
        </section>
      </view>

      <aside class="overview-aside" aria-label="运行关注事项">
        <view class="overview-aside__heading">
          <AppIcon name="warning" :size="20" />
          <text>需要关注</text>
        </view>
        <view v-if="attentionItems.length === 0" class="overview-clear" data-testid="overview-clear">
          <view class="overview-clear__icon"><AppIcon name="check" :size="28" /></view>
          <text class="overview-clear__title">当前没有需要处理的配置问题</text>
          <text class="overview-clear__copy">运行探针、服务模式与启用路由均可读取。</text>
        </view>
        <view v-else class="overview-attention">
          <view v-for="item in attentionItems" :key="item" class="overview-attention__item">
            <AppIcon name="danger" :size="18" />
            <text>{{ item }}</text>
          </view>
        </view>

        <view class="overview-security">
          <view class="overview-aside__heading">
            <AppIcon name="shield" :size="20" />
            <text>管理安全</text>
          </view>
          <view class="overview-security__line">
            <AppIcon name="info" :size="17" />
            <text>写操作需要 15 分钟内重新认证。</text>
          </view>
          <view class="overview-security__line">
            <AppIcon name="eye-off" :size="17" />
            <text>凭据只显示是否已配置，不展示明文或片段。</text>
          </view>
        </view>
      </aside>
    </view>
  </AdminConsoleShell>
</template>

<script lang="ts">
import { computed, onMounted, ref } from "vue";

import { loadAdminRuntimeSnapshot, type AdminRuntimeSnapshot } from "@/api/admin-runtime";
import type { ModelProvider, ModelRoute } from "@/api/providers";
import AppIcon from "@/design-system/AppIcon.vue";
import { formatLocalDateTime } from "@/domain/timestamp";
import AdminConsoleShell from "@/pages/admin-console/AdminConsoleShell.vue";
import { useAdminConsoleAccess } from "@/pages/admin-console/useAdminConsole";

interface ActiveRoute extends ModelRoute {
  providerId: string;
  provider: ModelProvider;
}

export default {
  name: "AdminOverviewPage",
  components: { AdminConsoleShell, AppIcon },
  setup() {
    const { accessState, transport, ensureAccess, goTo } = useAdminConsoleAccess();
    const loading = ref(false);
    const snapshot = ref<AdminRuntimeSnapshot | null>(null);

    const enabledProviders = computed(() =>
      snapshot.value?.providers?.filter((provider) => provider.state === "ENABLED") ?? [],
    );
    const enabledModels = computed<ActiveRoute[]>(() =>
      enabledProviders.value
        .flatMap((provider) => provider.models
          .filter((model) => model.state === "ENABLED")
          .map((model) => ({ ...model, providerId: provider.providerId, provider })))
        .sort((a, b) => a.priority - b.priority),
    );
    const primaryRoute = computed(() => enabledModels.value[0] ?? null);
    const primaryProvider = computed(() => primaryRoute.value?.provider ?? enabledProviders.value[0] ?? null);
    const primaryModel = computed(() => primaryRoute.value ?? null);
    const versionLabel = computed(() => {
      const info = snapshot.value?.version;
      if (!info) return "";
      return info.commit ? `${info.version} · ${info.commit.slice(0, 8)}` : info.version;
    });
    const checkedAtLabel = computed(() =>
      snapshot.value ? formatLocalDateTime(snapshot.value.checkedAt) : "",
    );
    const runtimeStateLabel = computed(() => {
      if (!snapshot.value) return "等待检查";
      if (snapshot.value.liveness.state === "up" && snapshot.value.readiness.state === "up") {
        return "运行中 / 已就绪";
      }
      if (snapshot.value.liveness.state === "up") return "进程存活 / 尚未就绪";
      return "状态不可用";
    });
    const attentionItems = computed(() => {
      const value = snapshot.value;
      if (!value) return [];
      const items: string[] = [];
      if (value.liveness.state !== "up") items.push("存活探针未通过，Go Runtime 可能无法响应请求。");
      if (value.readiness.state !== "up") items.push("就绪探针未通过，下游依赖或运行配置尚未就绪。");
      if (!value.serviceMode) items.push("服务模式读取失败，无法确认生成式聊天状态。");
      if (!value.providers) items.push("提供方配置读取失败，当前不展示缓存结果。");
      else {
        if (enabledProviders.value.length === 0) items.push("没有启用的模型提供方。");
        if (enabledModels.value.length === 0) items.push("没有启用的模型路由。");
        if (enabledProviders.value.some((provider) => !provider.credentialConfigured)) {
          items.push("至少一个启用提供方尚未配置凭据。");
        }
      }
      return items;
    });

    onMounted(async () => {
      if (await ensureAccess()) await load();
    });

    async function retryAccess(): Promise<void> {
      if (await ensureAccess()) await load();
    }

    async function load(): Promise<void> {
      if (loading.value || accessState.value !== "ready") return;
      loading.value = true;
      try {
        snapshot.value = await loadAdminRuntimeSnapshot(transport);
      } finally {
        loading.value = false;
      }
    }

    return {
      accessState,
      loading,
      snapshot,
      enabledProviders,
      enabledModels,
      primaryRoute,
      primaryProvider,
      primaryModel,
      versionLabel,
      checkedAtLabel,
      runtimeStateLabel,
      attentionItems,
      load,
      retryAccess,
      goTo,
    };
  },
};
</script>

<style scoped>
.overview-runtime { display: flex; align-items: center; gap: var(--vc-space-2); margin-right: var(--vc-space-3); color: var(--vc-muted); font-size: var(--vc-text-xs); }
.overview-loading { padding: var(--vc-space-8) 0; color: var(--vc-muted); }
.overview-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; min-height: calc(100dvh - 184px); gap: clamp(28px, 3vw, 52px); }
.overview-primary { min-width: 0; }
.overview-ledger { background: var(--vc-card); }
.overview-section-title, .overview-aside__heading { display: flex; align-items: center; gap: var(--vc-space-3); min-height: 64px; color: var(--vc-ink); font-size: var(--vc-text-lg); font-weight: 730; }
.overview-section-title { padding: 0 var(--vc-space-5); border-bottom: 1px solid var(--vc-border); color: var(--vc-primary); }
.overview-section-title > text:nth-child(2) { color: var(--vc-ink); }
.overview-updated { margin-left: auto; color: var(--vc-muted); font-size: var(--vc-text-xs); font-weight: 500; }
.overview-fact { position: relative; display: grid; grid-template-columns: minmax(130px, 25%) minmax(0, 1fr); align-items: center; min-height: 88px; padding: var(--vc-space-4) var(--vc-space-5); border-bottom: 1px solid var(--vc-border); }
.overview-fact--branch { padding-left: 48px; }
.overview-fact--deep { padding-left: 78px; }
.overview-fact--route { padding-left: 108px; }
.overview-fact--branch::before, .overview-fact--deep::before, .overview-fact--route::before { position: absolute; inset: 0 auto 0 24px; width: 1px; background: var(--vc-border); content: ""; }
.overview-fact--deep::before { left: 52px; }
.overview-fact--route::before { left: 82px; }
.overview-fact__label { color: var(--vc-muted); font-size: var(--vc-text-sm); }
.overview-fact__value { display: flex; align-items: center; flex-wrap: wrap; gap: var(--vc-space-2) var(--vc-space-3); min-width: 0; }
.overview-fact__strong { font-weight: 680; }
.overview-fact__hint { color: var(--vc-muted); font-size: var(--vc-text-xs); }
.overview-code, .overview-mode, .overview-route { padding: 4px 9px; border: 1px solid var(--vc-border); background: var(--vc-env); font-size: var(--vc-text-xs); }
.overview-mode { border-color: var(--vc-primary-border); background: var(--vc-primary-bg); color: var(--vc-primary); font-weight: 750; }
.overview-unavailable { color: var(--vc-danger); }
.overview-quick { margin-top: var(--vc-space-8); }
.overview-section-title--plain { padding: 0 0 var(--vc-space-3); border: 0; }
.ac-link-row { justify-content: space-between; width: 100%; min-height: 84px; padding: var(--vc-space-3) 0; border-top: 1px solid var(--vc-border); background: transparent; color: var(--vc-ink); }
.ac-link-row:last-child { border-bottom: 1px solid var(--vc-border); }
.ac-link-row:hover { color: var(--vc-primary); }
.ac-link-row__title, .ac-link-row__copy { display: block; }
.ac-link-row__title { font-size: var(--vc-text-md); font-weight: 650; }
.ac-link-row__copy { margin-top: var(--vc-space-1); color: var(--vc-muted); font-size: var(--vc-text-sm); }
.overview-aside { padding-left: clamp(20px, 2vw, 32px); border-left: 1px solid var(--vc-border); }
.overview-clear { display: flex; flex-direction: column; align-items: center; padding: var(--vc-space-7) var(--vc-space-5); border: 1px solid var(--vc-border); background: var(--vc-card); text-align: center; }
.overview-clear__icon { display: grid; width: 48px; height: 48px; place-items: center; border: 1px solid var(--vc-success); border-radius: 50%; color: var(--vc-success); }
.overview-clear__title { margin-top: var(--vc-space-4); font-weight: 680; }
.overview-clear__copy { margin-top: var(--vc-space-2); color: var(--vc-muted); font-size: var(--vc-text-xs); }
.overview-attention { border-top: 1px solid var(--vc-border); }
.overview-attention__item { display: flex; gap: var(--vc-space-2); padding: var(--vc-space-4) 0; border-bottom: 1px solid var(--vc-border); color: var(--vc-danger); font-size: var(--vc-text-sm); }
.overview-security { margin-top: var(--vc-space-7); }
.overview-security__line { display: flex; align-items: flex-start; gap: var(--vc-space-2); margin-top: var(--vc-space-3); color: var(--vc-muted); font-size: var(--vc-text-xs); }
@media (max-width: 1100px) { .overview-grid { grid-template-columns: minmax(0, 1fr) 290px; } }
@media (max-width: 820px) {
  .overview-runtime { display: none; }
  .overview-grid { display: block; }
  .overview-fact, .overview-fact--branch, .overview-fact--deep, .overview-fact--route { grid-template-columns: 1fr; gap: var(--vc-space-2); padding: var(--vc-space-4); }
  .overview-fact::before { display: none; }
  .overview-fact__value { align-items: flex-start; flex-direction: column; }
  .overview-aside { margin-top: var(--vc-space-7); padding: 0; border: 0; }
}
</style>
