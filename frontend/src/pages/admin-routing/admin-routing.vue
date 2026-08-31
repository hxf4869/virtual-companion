<template>
  <AdminConsoleShell
    active="routing"
    title="路由策略"
    subtitle="按优先级、提供方 ID、模型 ID 确定性选择；修改只影响下一轮请求"
    :access-state="accessState"
    :has-pending-changes="dirty"
    @retry-access="retryAccess"
  >
    <template #actions>
      <button class="ac-button" aria-label="刷新路由顺序" :disabled="busy" @click="refresh">
        <AppIcon name="refresh" :size="18" :spin="loading" />
        <text class="ac-button__label">刷新</text>
      </button>
      <button class="ac-button ac-button--primary" aria-label="检查并应用路由顺序" :disabled="busy" data-testid="routing-apply-top" @click="reviewApply">
        <AppIcon name="check" :size="18" />
        <text class="ac-button__label">检查并应用</text>
      </button>
    </template>

    <view v-if="loading && routes.length === 0" class="routing-loading" role="status">
      正在读取当前路由顺序…
    </view>
    <view v-else class="routing-layout" data-testid="admin-routing">
      <section class="routing-board" aria-labelledby="routing-order-title">
        <view class="routing-board__head">
          <text id="routing-order-title">当前路由顺序</text>
          <text>{{ routes.length }} 条启用规则</text>
        </view>

        <view v-if="routes.length === 0" class="routing-empty">
          <AppIcon name="route" :size="28" />
          <text class="routing-empty__title">当前没有启用路由</text>
          <text class="routing-empty__copy">先在模型服务页启用提供方与模型，再回到这里设置顺序。</text>
          <button class="ac-button" @click="goTo('/pages/admin-models/admin-models')">前往模型服务</button>
        </view>

        <view v-else class="routing-table" role="table" aria-label="模型路由优先级">
          <view class="routing-table__header" role="row">
            <text role="columnheader">#</text>
            <text role="columnheader">提供方 / 模型</text>
            <text role="columnheader">协议</text>
            <text role="columnheader">状态</text>
            <text role="columnheader">最大输出 token</text>
            <text role="columnheader">调整</text>
          </view>
          <view
            v-for="(route, index) in routes"
            :key="`${route.providerId}:${route.modelId}`"
            class="routing-row"
            role="row"
            data-testid="routing-row"
          >
            <text class="routing-rank ac-mono" role="cell">{{ index + 1 }}</text>
            <view class="routing-target" role="cell">
              <text class="routing-target__provider ac-mono">{{ route.providerId }}</text>
              <text class="routing-target__model ac-mono">/ {{ route.modelId }}</text>
              <text class="routing-target__name">{{ route.providerName }} · {{ route.modelName }}</text>
            </view>
            <text class="routing-protocol" role="cell">{{ protocolLabel(route.protocol) }}</text>
            <text class="ac-status ac-status--up" role="cell">已启用</text>
            <text class="routing-tokens ac-mono" role="cell">{{ formatNumber(route.maxOutputTokens) }}</text>
            <view class="routing-actions" role="cell" aria-label="调整路由优先级">
              <button
                class="routing-move"
                :disabled="busy || index === 0"
                :aria-label="`上移 ${route.modelName}`"
                @click="moveRoute(index, -1)"
              >
                <AppIcon name="arrow-up" :size="18" />
                <text>上移</text>
              </button>
              <button
                class="routing-move"
                :disabled="busy || index === routes.length - 1"
                :aria-label="`下移 ${route.modelName}`"
                @click="moveRoute(index, 1)"
              >
                <AppIcon name="arrow-down" :size="18" />
                <text>下移</text>
              </button>
            </view>
          </view>
        </view>

        <view class="routing-policy">
          <AppIcon name="info" :size="18" />
          <text>运行时只会按这里保存的完整顺序选择启用模型；普通错误不会在页面中伪装成自动恢复。</text>
        </view>
      </section>

      <aside class="routing-change" aria-labelledby="routing-change-title">
        <view class="routing-change__head">
          <AppIcon name="document" :size="20" />
          <text id="routing-change-title">本次变更</text>
          <text>{{ changeItems.length }} 项</text>
        </view>

        <view v-if="changeItems.length === 0" class="routing-change__empty">
          <AppIcon name="check" :size="23" />
          <text>当前顺序与生效配置一致。</text>
        </view>
        <view v-else class="routing-change__list">
          <view v-for="item in changeItems" :key="item.key" class="routing-change__item">
            <text class="routing-change__model ac-mono">{{ item.model }}</text>
            <text class="routing-change__move">{{ item.from }} → {{ item.to }}</text>
          </view>
        </view>

        <view class="routing-impact">
          <text class="routing-impact__title">优先级影响</text>
          <text>保存的是全部启用路由的顺序，不会只提交当前移动的一行。</text>
          <button v-if="changeItems.length > 0" class="routing-undo" :disabled="busy" data-testid="routing-discard" @click="discard">
            <AppIcon name="back" :size="17" />
            撤销全部调整
          </button>
        </view>

        <view v-if="reauthRequested || reauthConfirmed" class="routing-reauth" data-testid="routing-reauth-panel">
          <view v-if="reauthConfirmed" class="routing-reauth__confirmed">
            <AppIcon name="lock" :size="18" />
            <text>身份已确认，本次会话可以保存路由顺序。</text>
          </view>
          <template v-else>
            <text class="routing-reauth__title">重新认证</text>
            <text class="routing-reauth__copy">写操作前输入当前管理员密码。</text>
            <input
              v-model="reauthPassword"
              class="routing-input"
              type="password"
              autocomplete="current-password"
              placeholder="当前管理员密码"
              aria-label="当前管理员密码"
              :disabled="busy"
              data-testid="routing-reauth-password"
              @keyup.enter="confirmReauth"
            />
            <button class="ac-button" :disabled="busy || !reauthPassword" data-testid="routing-reauth" @click="confirmReauth">
              <AppIcon name="lock" :size="17" />
              确认并继续
            </button>
          </template>
        </view>

        <view v-if="message" class="ac-message" :class="{ 'ac-message--error': messageKind === 'error', 'ac-message--warning': messageKind === 'warning' }" :role="messageKind === 'error' ? 'alert' : 'status'">
          <AppIcon :name="messageKind === 'error' ? 'danger' : messageKind === 'warning' ? 'warning' : 'check'" :size="18" />
          <text>{{ message }}</text>
        </view>

        <button class="ac-button ac-button--primary routing-save" :disabled="busy" data-testid="routing-save" @click="reviewApply">
          <AppIcon name="check" :size="18" />
          {{ saving ? "应用中…" : "检查并应用" }}
        </button>
        <text class="routing-change__note">修改只影响下一轮请求，不中断进行中的对话。</text>
      </aside>

      <view v-if="changeItems.length > 0 || reauthRequested || saving" class="routing-mobile-bar">
        <text>顺序变更 · {{ changeItems.length }} 项</text>
        <button class="ac-button ac-button--primary" :disabled="busy" @click="reviewApply">
          {{ saving ? "应用中…" : "检查并应用" }}
        </button>
      </view>
    </view>
  </AdminConsoleShell>
</template>

<script lang="ts">
import { computed, onMounted, ref } from "vue";

import { reauthAuth } from "@/api/auth";
import {
  listModelProviders,
  ProviderHttpError,
  saveModelRoutingOrder,
  type ModelProvider,
  type ProviderProtocol,
  type RouteRef,
} from "@/api/providers";
import AppIcon from "@/design-system/AppIcon.vue";
import AdminConsoleShell from "@/pages/admin-console/AdminConsoleShell.vue";
import { useAdminConsoleAccess } from "@/pages/admin-console/useAdminConsole";

interface RouteView extends RouteRef {
  providerName: string;
  modelName: string;
  protocol: ProviderProtocol;
  maxOutputTokens: number;
}

type MessageKind = "success" | "warning" | "error";

export default {
  name: "AdminRoutingPage",
  components: { AdminConsoleShell, AppIcon },
  setup() {
    const { accessState, transport, ensureAccess, goTo } = useAdminConsoleAccess();
    const providers = ref<ModelProvider[]>([]);
    const routes = ref<RouteView[]>([]);
    const baseline = ref<RouteView[]>([]);
    const loading = ref(false);
    const saving = ref(false);
    const reauthRequested = ref(false);
    const reauthConfirmed = ref(false);
    const reauthPassword = ref("");
    const message = ref("");
    const messageKind = ref<MessageKind>("success");
    const busy = computed(() => loading.value || saving.value);
    const dirty = computed(() => routeKey(routes.value) !== routeKey(baseline.value));
    const changeItems = computed(() => {
      if (!dirty.value) return [];
      const previous = new Map(baseline.value.map((route, index) => [`${route.providerId}:${route.modelId}`, index + 1]));
      return routes.value
        .map((route, index) => ({
          key: `${route.providerId}:${route.modelId}`,
          model: route.modelName,
          from: previous.get(`${route.providerId}:${route.modelId}`) ?? "新增",
          to: index + 1,
        }))
        .filter((item) => item.from !== item.to);
    });

    onMounted(async () => {
      if (await ensureAccess()) await load();
    });

    async function retryAccess(): Promise<void> {
      if (await ensureAccess()) await load();
    }

    async function load(): Promise<boolean> {
      loading.value = true;
      try {
        providers.value = await listModelProviders(transport);
        const next = providerRoutes(providers.value);
        routes.value = next;
        baseline.value = next.map((route) => ({ ...route }));
        return true;
      } catch {
        setMessage("路由顺序读取失败，请检查系统状态后重试。", "error");
        return false;
      } finally {
        loading.value = false;
      }
    }

    async function refresh(): Promise<void> {
      if (busy.value) return;
      if (dirty.value) {
        setMessage("当前有未保存顺序；请先应用或撤销，再刷新远端配置。", "warning");
        return;
      }
      await load();
    }

    function moveRoute(index: number, delta: -1 | 1): void {
      if (busy.value) return;
      const target = index + delta;
      if (target < 0 || target >= routes.value.length) return;
      const next = [...routes.value];
      [next[index], next[target]] = [next[target], next[index]];
      routes.value = next;
      message.value = "";
    }

    function discard(): void {
      if (busy.value) return;
      routes.value = baseline.value.map((route) => ({ ...route }));
      setMessage("尚未保存的路由调整已撤销。", "success");
    }

    async function reviewApply(): Promise<void> {
      if (busy.value) return;
      if (!dirty.value) {
        setMessage("当前没有需要应用的顺序变更。", "warning");
        return;
      }
      if (!reauthConfirmed.value) {
        reauthRequested.value = true;
        setMessage("应用路由顺序前需要重新确认管理员身份。", "warning");
        return;
      }
      await saveNow();
    }

    async function confirmReauth(): Promise<void> {
      if (busy.value || !reauthPassword.value) return;
      saving.value = true;
      const password = reauthPassword.value;
      reauthPassword.value = "";
      try {
        reauthConfirmed.value = await reauthAuth(transport, password);
        if (!reauthConfirmed.value) {
          setMessage("身份确认失败，请检查密码后重试。", "error");
          return;
        }
        reauthRequested.value = false;
        setMessage("身份已确认，正在应用完整路由顺序。", "success");
        saving.value = false;
        await saveNow();
      } catch {
        reauthConfirmed.value = false;
        setMessage("身份确认请求失败，请稍后重试。", "error");
      } finally {
        saving.value = false;
      }
    }

    async function saveNow(): Promise<void> {
      if (saving.value) return;
      saving.value = true;
      try {
        await saveModelRoutingOrder(
          transport,
          routes.value.map(({ providerId, modelId }) => ({ providerId, modelId })),
        );
        const reloaded = await load();
        if (reloaded) {
          setMessage("全局路由顺序已更新，将从下一轮对话开始生效。", "success");
        } else {
          setMessage("保存请求成功，但无法读取最新配置，请刷新确认。", "warning");
        }
      } catch (error) {
        if (error instanceof ProviderHttpError && error.status === 403) {
          reauthConfirmed.value = false;
          reauthRequested.value = true;
          setMessage("身份确认已失效，请重新认证后再应用。", "error");
        } else {
          setMessage("路由顺序保存失败；本页仍保留未保存调整。", "error");
        }
      } finally {
        saving.value = false;
      }
    }

    function setMessage(value: string, kind: MessageKind): void {
      message.value = value;
      messageKind.value = kind;
    }

    return {
      accessState,
      routes,
      loading,
      saving,
      busy,
      dirty,
      changeItems,
      reauthRequested,
      reauthConfirmed,
      reauthPassword,
      message,
      messageKind,
      retryAccess,
      refresh,
      moveRoute,
      discard,
      reviewApply,
      confirmReauth,
      goTo,
      protocolLabel,
      formatNumber,
    };
  },
};

function providerRoutes(items: ModelProvider[]): RouteView[] {
  return items
    .filter((provider) => provider.state === "ENABLED")
    .flatMap((provider) => provider.models
      .filter((model) => model.state === "ENABLED")
      .map((model) => ({
        providerId: provider.providerId,
        modelId: model.modelId,
        providerName: provider.displayName,
        modelName: model.displayName,
        protocol: provider.protocol,
        maxOutputTokens: model.maxOutputTokens,
        priority: model.priority,
      })))
    .sort((a, b) => a.priority - b.priority)
    .map(({ priority: _priority, ...route }) => route);
}

function routeKey(items: RouteView[]): string {
  return items.map((route) => `${route.providerId}:${route.modelId}`).join("|");
}

function protocolLabel(protocol: ProviderProtocol): string {
  if (protocol === "OPENAI_CHAT_COMPLETIONS") return "OpenAI Chat";
  if (protocol === "OPENAI_RESPONSES") return "OpenAI Responses";
  return "Anthropic Messages";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}
</script>

<style scoped>
.routing-loading { padding: var(--vc-space-8) 0; color: var(--vc-muted); }
.routing-layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: clamp(28px, 3vw, 48px); align-items: start; }
.routing-board { border: 1px solid var(--vc-border); background: var(--vc-card); }
.routing-board__head, .routing-change__head { display: flex; align-items: center; justify-content: space-between; min-height: 64px; padding: 0 var(--vc-space-5); border-bottom: 1px solid var(--vc-border); font-size: var(--vc-text-lg); font-weight: 720; }
.routing-board__head text:last-child, .routing-change__head text:last-child { color: var(--vc-muted); font-size: var(--vc-text-xs); font-weight: 520; }
.routing-empty { display: flex; flex-direction: column; align-items: center; gap: var(--vc-space-2); padding: var(--vc-space-8) var(--vc-space-5); color: var(--vc-muted); text-align: center; }
.routing-empty__title { color: var(--vc-ink); font-size: var(--vc-text-lg); font-weight: 700; }
.routing-empty__copy { margin-bottom: var(--vc-space-3); font-size: var(--vc-text-sm); }
.routing-table__header, .routing-row { display: grid; grid-template-columns: 42px minmax(210px, 1.5fr) minmax(120px, .85fr) 92px 110px 132px; align-items: center; gap: var(--vc-space-3); }
.routing-table__header { min-height: 52px; padding: 0 var(--vc-space-5); border-bottom: 1px solid var(--vc-border); background: #f7f8f7; color: var(--vc-muted); font-size: var(--vc-text-xs); font-weight: 650; }
.routing-row { min-height: 112px; padding: var(--vc-space-3) var(--vc-space-5); border-bottom: 1px solid var(--vc-border); }
.routing-rank { color: var(--vc-muted); }
.routing-target__provider, .routing-target__model, .routing-target__name { display: block; }
.routing-target__provider { font-weight: 680; }
.routing-target__model { margin-top: 2px; color: var(--vc-muted); font-size: var(--vc-text-sm); }
.routing-target__name { margin-top: var(--vc-space-1); color: var(--vc-muted); font-size: var(--vc-text-xs); }
.routing-protocol { color: var(--vc-muted); font-size: var(--vc-text-sm); }
.routing-tokens { font-size: var(--vc-text-sm); }
.routing-actions { display: flex; justify-content: flex-end; gap: var(--vc-space-1); }
.routing-move { display: flex; align-items: center; justify-content: center; gap: 3px; min-width: 44px; min-height: 44px; margin: 0; padding: 0 5px; border: 0; background: transparent; color: var(--vc-muted); font-size: var(--vc-text-xs); }
.routing-move::after { border: 0; }
.routing-move:hover:not([disabled]) { color: var(--vc-primary); }
.routing-move[disabled] { opacity: .38; }
.routing-policy { display: flex; align-items: flex-start; gap: var(--vc-space-2); padding: var(--vc-space-4) var(--vc-space-5); background: #f7f8f7; color: var(--vc-muted); font-size: var(--vc-text-xs); }
.routing-change { position: sticky; top: 112px; border-left: 1px solid var(--vc-border); }
.routing-change__head { justify-content: flex-start; padding: 0 0 var(--vc-space-3); border-bottom: 1px solid var(--vc-border); }
.routing-change__head text:last-child { margin-left: auto; }
.routing-change__empty { display: flex; align-items: center; gap: var(--vc-space-2); padding: var(--vc-space-5) 0; color: var(--vc-success); font-size: var(--vc-text-sm); }
.routing-change__list { border-bottom: 1px solid var(--vc-border); }
.routing-change__item { display: flex; align-items: center; justify-content: space-between; gap: var(--vc-space-3); padding: var(--vc-space-3) 0; border-top: 1px solid var(--vc-border); font-size: var(--vc-text-sm); }
.routing-change__move { color: var(--vc-primary); font-family: var(--vc-font-mono); font-weight: 700; }
.routing-impact { display: grid; gap: var(--vc-space-2); padding: var(--vc-space-5) 0; border-bottom: 1px solid var(--vc-border); color: var(--vc-muted); font-size: var(--vc-text-xs); }
.routing-impact__title { color: var(--vc-ink); font-size: var(--vc-text-sm); font-weight: 700; }
.routing-undo { display: flex; align-items: center; gap: var(--vc-space-2); width: fit-content; min-height: 44px; margin: var(--vc-space-1) 0 0; padding: 0; border: 0; background: transparent; color: var(--vc-muted); font-size: var(--vc-text-sm); }
.routing-undo::after { border: 0; }
.routing-reauth { display: grid; gap: var(--vc-space-2); margin-top: var(--vc-space-5); padding: var(--vc-space-4); border: 1px solid var(--vc-border); background: var(--vc-card); }
.routing-reauth__title { font-weight: 720; }
.routing-reauth__copy { color: var(--vc-muted); font-size: var(--vc-text-xs); }
.routing-reauth__confirmed { display: flex; align-items: flex-start; gap: var(--vc-space-2); color: var(--vc-success); font-size: var(--vc-text-xs); }
.routing-input { box-sizing: border-box; width: 100%; min-height: 46px; padding: 0 13px; border: 1px solid var(--vc-border-strong); border-radius: var(--vc-radius-s); background: var(--vc-card); color: var(--vc-ink); font: inherit; }
.routing-change .ac-message { margin-top: var(--vc-space-4); }
.routing-save { width: 100%; margin-top: var(--vc-space-5); }
.routing-change__note { display: block; margin-top: var(--vc-space-3); color: var(--vc-muted); font-size: var(--vc-text-xs); text-align: center; }
.routing-mobile-bar { display: none; }
@media (max-width: 1180px) {
  .routing-layout { grid-template-columns: minmax(0, 1fr) 300px; gap: var(--vc-space-5); }
  .routing-table__header, .routing-row { grid-template-columns: 34px minmax(180px, 1.4fr) 105px 82px 94px 96px; gap: var(--vc-space-2); }
  .routing-move text { display: none; }
}
@media (max-width: 820px) {
  .routing-layout { display: block; }
  .routing-board { margin: 0 calc(-1 * var(--vc-space-4)); border-right: 0; border-left: 0; }
  .routing-table__header { display: none; }
  .routing-row { grid-template-columns: 36px minmax(0, 1fr) auto; gap: var(--vc-space-2); min-height: 132px; padding: var(--vc-space-4); }
  .routing-target { align-self: start; }
  .routing-protocol, .routing-tokens, .routing-row > .ac-status { grid-column: 2; }
  .routing-protocol::before { content: "协议 · "; color: var(--vc-muted); }
  .routing-tokens::before { content: "最大输出 · "; color: var(--vc-muted); font-family: var(--vc-font); }
  .routing-actions { grid-column: 3; grid-row: 1 / span 4; flex-direction: column; }
  .routing-change { position: static; margin-top: var(--vc-space-7); padding-bottom: 92px; border-left: 0; }
  .routing-save { display: none; }
  .routing-mobile-bar { position: fixed; inset: auto 0 0; z-index: var(--vc-z-nav); display: flex; align-items: center; justify-content: space-between; gap: var(--vc-space-3); padding: var(--vc-space-3) var(--vc-space-4) calc(var(--vc-space-3) + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--vc-border); background: rgba(255,255,255,.97); color: var(--vc-primary); font-size: var(--vc-text-sm); }
}
</style>
