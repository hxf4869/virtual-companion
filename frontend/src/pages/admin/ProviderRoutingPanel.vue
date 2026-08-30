<template>
  <section class="provider-panel" aria-labelledby="provider-panel-title" data-testid="provider-routing-panel">
    <view class="provider-head">
      <view class="provider-head__copy">
        <text id="provider-panel-title" class="provider-title">模型服务</text>
        <text class="provider-summary">
          对话按下列顺序使用模型。只有请求确定未送达时，才会切换一次备用模型。
        </text>
      </view>
      <view class="provider-head__actions">
        <button
          type="button"
          class="provider-button provider-button--quiet"
          :disabled="busy || orderDirty"
          :title="orderDirty ? '请先保存或放弃路由顺序调整' : '刷新模型服务'"
          aria-label="刷新模型服务"
          @click="refresh"
        >
          <AppIcon name="refresh" :size="17" :spin="loading" />
          刷新
        </button>
        <button
          type="button"
          class="provider-button provider-button--primary"
          :disabled="busy || orderDirty"
          :title="orderDirty ? '请先保存或放弃路由顺序调整' : '添加提供方'"
          @click="openCreate"
          data-testid="provider-add"
        >
          <AppIcon name="plus" :size="17" />
          添加提供方
        </button>
      </view>
    </view>

    <view v-if="errorMessage" class="provider-message provider-message--error" role="alert">
      {{ errorMessage }}
    </view>
    <view v-else-if="successMessage" class="provider-message" role="status">
      {{ successMessage }}
    </view>

    <view class="reauth-row">
      <view class="reauth-copy">
        <text class="provider-label">敏感操作确认</text>
        <text class="provider-help">添加、编辑或调整顺序前需要确认当前管理员密码；编辑窗口内也可以确认。</text>
      </view>
      <input
        v-model="reauthPassword"
        class="provider-input reauth-input"
        type="password"
        autocomplete="current-password"
        placeholder="当前管理员密码"
        aria-label="当前管理员密码"
        :disabled="busy"
        @keyup.enter="confirmReauth"
        data-testid="provider-reauth-password"
      />
      <button
        type="button"
        class="provider-button provider-button--quiet"
        :disabled="busy || !reauthPassword"
        @click="confirmReauth"
        data-testid="provider-reauth"
      >
        {{ reauthConfirmed ? "已确认" : "确认身份" }}
      </button>
    </view>

    <view class="route-section">
      <view class="provider-subhead">
        <view>
          <text class="provider-subtitle">当前路由顺序</text>
          <text class="provider-help">第一项是主模型，第二项是本轮唯一可能使用的备用模型。</text>
        </view>
        <view v-if="orderDirty" class="provider-subhead__actions">
          <button
            type="button"
            class="provider-button provider-button--quiet"
            :disabled="busy"
            @click="discardOrder"
            data-testid="provider-discard-order"
          >
            放弃调整
          </button>
          <button
            type="button"
            class="provider-button provider-button--primary"
            :disabled="busy || !reauthConfirmed"
            @click="saveOrder"
            data-testid="provider-save-order"
          >
            保存顺序
          </button>
        </view>
      </view>
      <view v-if="!loading && orderedRoutes.length === 0" class="provider-empty">
        还没有启用的模型。先添加提供方和模型，保存后再启用。
      </view>
      <view
        v-for="(route, index) in orderedRoutes"
        :key="`${route.providerId}:${route.modelId}`"
        class="route-row"
        data-testid="provider-route-row"
      >
        <text class="route-rank" :aria-label="`优先级 ${index + 1}`">{{ index + 1 }}</text>
        <view class="route-copy">
          <text class="route-name">{{ route.modelName }}</text>
          <text class="route-meta">{{ route.providerName }} · {{ protocolLabel(route.protocol) }}</text>
        </view>
        <view class="route-actions" aria-label="调整优先级">
          <button
            type="button"
            class="route-move"
            :disabled="busy || index === 0"
            :aria-label="`上移 ${route.modelName}`"
            @click="moveRoute(index, -1)"
          >上移</button>
          <button
            type="button"
            class="route-move"
            :disabled="busy || index === orderedRoutes.length - 1"
            :aria-label="`下移 ${route.modelName}`"
            @click="moveRoute(index, 1)"
          >下移</button>
        </view>
      </view>
    </view>

    <view class="provider-list" aria-label="提供方列表">
      <view v-if="loading" class="provider-empty" role="status">正在加载模型服务…</view>
      <view v-else-if="providers.length === 0" class="provider-empty">
        暂无提供方。添加后，密钥会加密保存且不会再次显示。
      </view>
      <view v-for="item in providers" :key="item.providerId" class="provider-row">
        <view class="provider-row__main">
          <view class="provider-row__title-line">
            <text class="provider-row__name">{{ item.displayName }}</text>
            <text
              class="provider-state"
              :class="{ 'provider-state--enabled': item.state === 'ENABLED' }"
            >{{ item.state === "ENABLED" ? "已启用" : "已停用" }}</text>
          </view>
          <text class="provider-row__meta">
            {{ item.providerId }} · {{ protocolLabel(item.protocol) }} ·
            {{ item.credentialConfigured ? "密钥已配置" : "未配置密钥" }}
          </text>
          <text class="provider-row__url">{{ item.baseUrl }}</text>
          <text class="provider-row__models">
            {{ item.models.filter((model) => model.state === "ENABLED").length }} 个启用模型，
            共 {{ item.models.length }} 个
          </text>
        </view>
        <button
          type="button"
          class="provider-button provider-button--quiet"
          :disabled="busy || orderDirty"
          :title="orderDirty ? '请先保存或放弃路由顺序调整' : `编辑 ${item.displayName}`"
          @click="openEdit(item)"
          data-testid="provider-edit"
        >
          <AppIcon name="pencil" :size="16" />
          编辑
        </button>
      </view>
    </view>

    <AppSheet :open="sheetOpen" :title="editingId ? '编辑提供方' : '添加提供方'" @close="closeSheet">
      <form class="provider-form" @submit.prevent="saveProvider">
        <view v-if="!reauthConfirmed" class="sheet-reauth" data-testid="provider-sheet-reauth">
          <view class="sheet-reauth__copy">
            <text class="provider-label">保存前确认身份</text>
            <text class="provider-help">在这里确认不会关闭窗口，也不会清除已经填写的内容。</text>
          </view>
          <input
            v-model="reauthPassword"
            class="provider-input"
            type="password"
            autocomplete="current-password"
            placeholder="当前管理员密码"
            aria-label="当前管理员密码"
            :disabled="busy"
            @keyup.enter.prevent="confirmReauth"
            data-testid="provider-sheet-reauth-password"
          />
          <button
            type="button"
            class="provider-button provider-button--quiet"
            :disabled="busy || !reauthPassword"
            @click="confirmReauth"
            data-testid="provider-sheet-reauth-submit"
          >
            确认身份
          </button>
          <text
            v-if="reauthError"
            class="sheet-reauth__error"
            role="alert"
            data-testid="provider-sheet-reauth-error"
          >
            {{ reauthError }}
          </text>
        </view>

        <label class="field-group">
          <text class="provider-label">Provider ID</text>
          <input
            v-model="draft.providerId"
            class="provider-input"
            placeholder="例如 acme-gateway"
            autocomplete="off"
            :disabled="busy || Boolean(editingId)"
          />
          <text class="provider-help">小写字母开头，只能使用小写字母、数字和连字符。</text>
        </label>

        <label class="field-group">
          <text class="provider-label">显示名称</text>
          <input v-model="draft.displayName" class="provider-input" placeholder="例如 Acme Gateway" :disabled="busy" />
        </label>

        <view class="field-grid">
          <label class="field-group">
            <text class="provider-label">API 协议</text>
            <select v-model="draft.protocol" class="provider-select" :disabled="busy">
              <option value="OPENAI_CHAT_COMPLETIONS">OpenAI Chat Completions</option>
              <option value="OPENAI_RESPONSES">OpenAI Responses</option>
              <option value="ANTHROPIC_MESSAGES">Anthropic Messages</option>
            </select>
          </label>
          <label class="field-group">
            <text class="provider-label">状态</text>
            <select v-model="draft.state" class="provider-select" :disabled="busy">
              <option value="DISABLED">先保存，不参与对话</option>
              <option value="ENABLED">启用</option>
            </select>
          </label>
        </view>

        <label class="field-group">
          <text class="provider-label">API 地址</text>
          <input
            v-model="draft.baseUrl"
            class="provider-input"
            inputmode="url"
            placeholder="https://gateway.example/v1"
            autocomplete="url"
            :disabled="busy"
          />
          <text class="provider-help">填写服务根地址或以 /v1 结尾的地址，不要填写具体的 messages / responses 路径。</text>
        </label>

        <label class="field-group">
          <text class="provider-label">API 密钥</text>
          <input
            v-model="draft.credential"
            class="provider-input"
            type="password"
            autocomplete="new-password"
            :placeholder="editingId ? '留空以保留现有密钥' : '输入 API 密钥'"
            :disabled="busy"
            data-testid="provider-credential"
          />
          <text class="provider-help">保存后只显示“已配置”，不会回显密钥或任何片段。</text>
        </label>

        <view class="model-head">
          <view>
            <text class="provider-subtitle">模型</text>
            <text class="provider-help">一个提供方可以配置多个模型；全局优先级在保存后统一调整。</text>
          </view>
          <view class="model-head__actions">
            <button
              type="button"
              class="provider-button provider-button--quiet"
              :disabled="busy || !canDiscover"
              :title="reauthConfirmed ? '从提供方读取 /v1/models，不会自动保存' : '请先确认管理员身份'"
              @click="discoverModels"
              data-testid="provider-discover-models"
            >
              <AppIcon name="refresh" :size="16" :spin="busy" />
              获取可用模型
            </button>
            <button type="button" class="provider-button provider-button--quiet" :disabled="busy || draft.models.length >= 32" @click="addModel">
              <AppIcon name="plus" :size="16" />
              添加模型
            </button>
          </view>
        </view>

        <view v-if="catalogMessage" class="provider-message" role="status">
          {{ catalogMessage }}
        </view>

        <view v-for="(model, index) in draft.models" :key="model.key" class="model-editor">
          <view class="model-editor__head">
            <text class="provider-label">模型 {{ index + 1 }}</text>
            <button
              v-if="draft.models.length > 1"
              type="button"
              class="model-remove"
              :aria-label="`移除模型 ${index + 1}`"
              :disabled="busy"
              @click="removeModel(index)"
            >
              <AppIcon name="trash" :size="17" />
            </button>
          </view>
          <view class="field-grid">
            <label class="field-group">
              <text class="provider-help">模型 ID</text>
              <input v-model="model.modelId" class="provider-input" placeholder="模型 ID" :disabled="busy" />
            </label>
            <label class="field-group">
              <text class="provider-help">显示名称</text>
              <input v-model="model.displayName" class="provider-input" placeholder="显示名称" :disabled="busy" />
            </label>
            <label class="field-group">
              <text class="provider-help">上下文窗口（可选）</text>
              <input v-model="model.contextWindowTokens" class="provider-input" type="number" min="1" max="2000000" placeholder="例如 256000" :disabled="busy" />
            </label>
            <label class="field-group">
              <text class="provider-help">最大输出 token</text>
              <input v-model="model.maxOutputTokens" class="provider-input" type="number" min="1" max="262144" placeholder="例如 32000" :disabled="busy" />
            </label>
            <label class="field-group">
              <text class="provider-help">状态</text>
              <select v-model="model.state" class="provider-select" :disabled="busy">
                <option value="ENABLED">启用</option>
                <option value="DISABLED">停用</option>
              </select>
            </label>
          </view>
        </view>

        <view v-if="formError" class="provider-message provider-message--error" role="alert">
          {{ formError }}
        </view>
        <view class="form-actions">
          <button type="button" class="provider-button provider-button--quiet" :disabled="busy" @click="closeSheet">取消</button>
          <button type="submit" class="provider-button provider-button--primary" :disabled="busy || !formValid || !reauthConfirmed">
            {{ busy ? "保存中…" : "保存提供方" }}
          </button>
        </view>
      </form>
    </AppSheet>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref } from "vue";

import { reauthAuth } from "@/api/auth";
import {
  discoverProviderModels,
  listModelProviders,
  ProviderHttpError,
  saveModelProvider,
  saveModelRoutingOrder,
  type ModelProvider,
  type ProviderProtocol,
  type ProviderState,
  type RouteRef,
} from "@/api/providers";
import { createAuthenticatedTransport } from "@/api/transport";
import AppIcon from "@/design-system/AppIcon.vue";
import AppSheet from "@/design-system/AppSheet.vue";
import { useAuthStore } from "@/stores/auth";

interface ModelDraft {
  key: number;
  modelId: string;
  displayName: string;
  contextWindowTokens: string;
  maxOutputTokens: string;
  state: ProviderState;
}

interface ProviderDraft {
  providerId: string;
  displayName: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  credential: string;
  state: ProviderState;
  models: ModelDraft[];
}

interface RouteView extends RouteRef {
  providerName: string;
  modelName: string;
  protocol: ProviderProtocol;
}

let nextModelKey = 1;

function blankModel(): ModelDraft {
  return {
    key: nextModelKey++,
    modelId: "",
    displayName: "",
    contextWindowTokens: "",
    maxOutputTokens: "2048",
    state: "ENABLED",
  };
}

function blankProvider(): ProviderDraft {
  return {
    providerId: "",
    displayName: "",
    protocol: "OPENAI_RESPONSES",
    baseUrl: "",
    credential: "",
    state: "DISABLED",
    models: [blankModel()],
  };
}

export default defineComponent({
  name: "ProviderRoutingPanel",
  components: { AppIcon, AppSheet },
  setup() {
    const auth = useAuthStore();
    const transport = createAuthenticatedTransport({
      onUnauthorized: () => auth.onUnauthorized(),
    });
    const providers = ref<ModelProvider[]>([]);
    const orderedRoutes = ref<RouteView[]>([]);
    const loading = ref(true);
    const busy = ref(false);
    const sheetOpen = ref(false);
    const editingId = ref<string | null>(null);
    const draft = ref<ProviderDraft>(blankProvider());
    const orderDirty = ref(false);
    const errorMessage = ref("");
    const successMessage = ref("");
    const formError = ref("");
    const catalogMessage = ref("");
    const reauthPassword = ref("");
    const reauthConfirmed = ref(false);
    const reauthError = ref("");

    const formValid = computed(() => {
      const value = draft.value;
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(value.providerId.trim()) ||
          !value.displayName.trim() || !value.baseUrl.trim() ||
          (!editingId.value && !value.credential) || value.models.length === 0 ||
          value.models.length > 32) {
        return false;
      }
      let enabled = 0;
      const ids = new Set<string>();
      for (const model of value.models) {
        const id = model.modelId.trim();
        const output = Number(model.maxOutputTokens);
        const context = model.contextWindowTokens ? Number(model.contextWindowTokens) : undefined;
        if (!id || ids.has(id) || !model.displayName.trim() || !Number.isInteger(output) ||
            output < 1 || output > 262144 ||
            (context !== undefined && (!Number.isInteger(context) || context < 1 || context > 2000000))) {
          return false;
        }
        ids.add(id);
        if (model.state === "ENABLED") enabled++;
      }
      return value.state !== "ENABLED" || enabled > 0;
    });

    const canDiscover = computed(() => {
      const value = draft.value;
      return reauthConfirmed.value && /^[a-z][a-z0-9-]{0,63}$/.test(value.providerId.trim()) &&
        Boolean(value.baseUrl.trim()) && (Boolean(editingId.value) || Boolean(value.credential));
    });

    onMounted(() => void refresh());

    async function refresh(): Promise<void> {
      loading.value = true;
      errorMessage.value = "";
      try {
        providers.value = await listModelProviders(transport);
        orderedRoutes.value = providerRoutes(providers.value);
        orderDirty.value = false;
      } catch {
        errorMessage.value = "模型服务加载失败，请检查服务状态后重试。";
      } finally {
        loading.value = false;
      }
    }

    async function confirmReauth(): Promise<void> {
      if (!reauthPassword.value || busy.value) return;
      busy.value = true;
      errorMessage.value = "";
      reauthError.value = "";
      try {
        reauthConfirmed.value = await reauthAuth(transport, reauthPassword.value);
        if (!reauthConfirmed.value) {
          const message = "身份确认失败，请检查密码后重试。";
          if (sheetOpen.value) reauthError.value = message;
          else errorMessage.value = message;
        } else {
          successMessage.value = "管理员身份已确认，15 分钟内可以保存敏感配置。";
        }
      } catch {
        reauthConfirmed.value = false;
        const message = "身份确认失败，请稍后重试。";
        if (sheetOpen.value) reauthError.value = message;
        else errorMessage.value = message;
      } finally {
        reauthPassword.value = "";
        busy.value = false;
      }
    }

    function openCreate(): void {
      editingId.value = null;
      draft.value = blankProvider();
      formError.value = "";
      catalogMessage.value = "";
      reauthError.value = "";
      sheetOpen.value = true;
    }

    function openEdit(item: ModelProvider): void {
      editingId.value = item.providerId;
      draft.value = {
        providerId: item.providerId,
        displayName: item.displayName,
        protocol: item.protocol,
        baseUrl: item.baseUrl,
        credential: "",
        state: item.state,
        models: item.models.map((model) => ({
          key: nextModelKey++,
          modelId: model.modelId,
          displayName: model.displayName,
          contextWindowTokens: model.contextWindowTokens?.toString() ?? "",
          maxOutputTokens: model.maxOutputTokens.toString(),
          state: model.state,
        })),
      };
      if (draft.value.models.length === 0) draft.value.models.push(blankModel());
      formError.value = "";
      catalogMessage.value = "";
      reauthError.value = "";
      sheetOpen.value = true;
    }

    function closeSheet(): void {
      if (busy.value) return;
      sheetOpen.value = false;
      formError.value = "";
      catalogMessage.value = "";
      reauthError.value = "";
    }

    function addModel(): void {
      if (draft.value.models.length < 32) draft.value.models.push(blankModel());
    }

    function removeModel(index: number): void {
      if (draft.value.models.length > 1) draft.value.models.splice(index, 1);
    }

    async function discoverModels(): Promise<void> {
      if (!canDiscover.value || busy.value) return;
      busy.value = true;
      formError.value = "";
      catalogMessage.value = "";
      try {
        const value = draft.value;
        const discovered = await discoverProviderModels(transport, value.providerId.trim(), {
          protocol: value.protocol,
          baseUrl: value.baseUrl.trim(),
          credential: value.credential || undefined,
        });
        const existing = new Set(value.models.map((model) => model.modelId.trim()).filter(Boolean));
        if (value.models.length === 1 && !value.models[0].modelId.trim() && discovered.length > 0) {
          value.models.splice(0, 1);
        }
        let added = 0;
        for (const model of discovered) {
          if (existing.has(model.modelId) || value.models.length >= 32) continue;
          existing.add(model.modelId);
          value.models.push({
            key: nextModelKey++,
            modelId: model.modelId,
            displayName: model.displayName,
            contextWindowTokens: "",
            maxOutputTokens: "2048",
            state: "ENABLED",
          });
          added++;
        }
        catalogMessage.value = discovered.length === 0
          ? "提供方没有返回可用模型，请手动填写模型 ID。"
          : `已读取 ${discovered.length} 个模型，新增 ${added} 个；请确认参数后再保存。`;
      } catch (error) {
        if (error instanceof ProviderHttpError && error.status === 403) {
          reauthConfirmed.value = false;
          reauthError.value = "身份确认已失效，请重新确认后再获取模型。";
        } else {
          formError.value = "模型目录读取失败，请检查 API 地址、协议和密钥。";
        }
      } finally {
        busy.value = false;
      }
    }

    async function saveProvider(): Promise<void> {
      if (!formValid.value || busy.value) return;
      if (!reauthConfirmed.value) {
        reauthError.value = "请先在当前窗口确认管理员密码。";
        return;
      }
      busy.value = true;
      formError.value = "";
      try {
        const value = draft.value;
        await saveModelProvider(transport, value.providerId.trim(), {
          displayName: value.displayName.trim(),
          protocol: value.protocol,
          baseUrl: value.baseUrl.trim(),
          credential: value.credential || undefined,
          state: value.state,
          models: value.models.map((model) => ({
            modelId: model.modelId.trim(),
            displayName: model.displayName.trim(),
            contextWindowTokens: model.contextWindowTokens
              ? Number(model.contextWindowTokens)
              : undefined,
            maxOutputTokens: Number(model.maxOutputTokens),
            state: model.state,
          })),
        });
        sheetOpen.value = false;
        successMessage.value = "提供方配置已保存；新的路由从下一轮对话开始生效。";
        await refresh();
      } catch (error) {
        if (error instanceof ProviderHttpError && error.status === 403) {
          reauthConfirmed.value = false;
          reauthError.value = "身份确认已失效，请重新确认管理员密码后再保存。";
        } else {
          formError.value = "保存失败。请检查地址、模型参数和启用状态后重试。";
        }
      } finally {
        busy.value = false;
      }
    }

    function moveRoute(index: number, delta: -1 | 1): void {
      const target = index + delta;
      if (target < 0 || target >= orderedRoutes.value.length) return;
      const next = [...orderedRoutes.value];
      [next[index], next[target]] = [next[target], next[index]];
      orderedRoutes.value = next;
      orderDirty.value = true;
    }

    function discardOrder(): void {
      orderedRoutes.value = providerRoutes(providers.value);
      orderDirty.value = false;
      successMessage.value = "已放弃尚未保存的顺序调整。";
    }

    async function saveOrder(): Promise<void> {
      if (!orderDirty.value || busy.value || !reauthConfirmed.value) return;
      busy.value = true;
      errorMessage.value = "";
      try {
        await saveModelRoutingOrder(transport, orderedRoutes.value.map(({ providerId, modelId }) => ({ providerId, modelId })));
        successMessage.value = "模型优先级已更新，将从下一轮对话开始生效。";
        await refresh();
      } catch (error) {
        if (error instanceof ProviderHttpError && error.status === 403) {
          reauthConfirmed.value = false;
          errorMessage.value = "身份确认已失效，请重新确认后保存顺序。";
        } else {
          errorMessage.value = "优先级保存失败，请刷新后重试。";
        }
      } finally {
        busy.value = false;
      }
    }

    function protocolLabel(protocol: ProviderProtocol): string {
      switch (protocol) {
        case "OPENAI_CHAT_COMPLETIONS": return "Chat Completions";
        case "OPENAI_RESPONSES": return "Responses";
        case "ANTHROPIC_MESSAGES": return "Anthropic Messages";
      }
    }

    return {
      providers,
      orderedRoutes,
      loading,
      busy,
      sheetOpen,
      editingId,
      draft,
      orderDirty,
      errorMessage,
      successMessage,
      formError,
      catalogMessage,
      reauthPassword,
      reauthConfirmed,
      reauthError,
      formValid,
      canDiscover,
      refresh,
      confirmReauth,
      openCreate,
      openEdit,
      closeSheet,
      addModel,
      removeModel,
      discoverModels,
      saveProvider,
      moveRoute,
      discardOrder,
      saveOrder,
      protocolLabel,
    };
  },
});

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
        priority: model.priority,
      })))
    .sort((a, b) => a.priority - b.priority)
    .map(({ priority: _priority, ...route }) => route);
}
</script>

<style scoped>
.provider-panel {
  margin-top: var(--vc-space-4);
  padding: var(--vc-space-4);
  scroll-margin-top: calc(44px + var(--vc-space-4));
  border: 1px solid var(--vc-border-env);
  border-radius: var(--vc-radius-m);
  background: var(--vc-env-raised);
  color: var(--vc-on-env);
}

.provider-head,
.provider-subhead,
.model-head,
.model-editor__head,
.provider-row__title-line,
.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-3);
}

.provider-head {
  align-items: flex-start;
}

.provider-head__copy,
.reauth-copy,
.route-copy,
.provider-row__main {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.provider-title {
  color: var(--vc-on-env);
  font-size: var(--vc-text-lg);
  font-weight: 650;
  letter-spacing: -0.02em;
}

.provider-summary {
  max-width: 68ch;
  margin-top: var(--vc-space-1);
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-sm);
  line-height: 1.6;
}

.provider-head__actions,
.provider-subhead__actions,
.model-head__actions,
.route-actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--vc-space-2);
}

.provider-button,
.route-move,
.model-remove {
  display: inline-flex;
  min-height: 44px;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  gap: var(--vc-space-1);
  margin: 0;
  border-radius: var(--vc-radius-s);
  font: inherit;
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.provider-button::after,
.route-move::after,
.model-remove::after {
  border: 0;
}

.provider-button--primary {
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-primary);
  background: var(--vc-primary);
  color: var(--vc-on-primary);
}

.provider-button--quiet,
.route-move {
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-env-strong);
  background: transparent;
  color: var(--vc-on-env);
}

.provider-button:focus-visible,
.route-move:focus-visible,
.model-remove:focus-visible,
.provider-input:focus-visible,
.provider-select:focus-visible {
  outline: 2px solid var(--vc-primary);
  outline-offset: 2px;
}

.provider-button:disabled,
.route-move:disabled,
.model-remove:disabled {
  opacity: 0.48;
}

.provider-message {
  margin-top: var(--vc-space-3);
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-env);
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-xs);
}

.provider-message--error {
  border: 1px solid var(--vc-danger-on-env);
  color: var(--vc-danger-on-env);
}

.reauth-row {
  display: grid;
  grid-template-columns: minmax(16em, 1fr) minmax(12em, 18em) auto;
  align-items: end;
  gap: var(--vc-space-3);
  margin-top: var(--vc-space-4);
  padding: var(--vc-space-3) 0;
  border-block: 1px solid var(--vc-border-env);
}

.provider-label,
.provider-subtitle,
.route-name,
.provider-row__name {
  color: var(--vc-on-env);
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.provider-help,
.route-meta,
.provider-row__meta,
.provider-row__url,
.provider-row__models {
  display: block;
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-xs);
  line-height: 1.55;
}

.route-section {
  margin-top: var(--vc-space-4);
}

.route-row,
.provider-row {
  display: flex;
  align-items: center;
  gap: var(--vc-space-3);
  padding: var(--vc-space-3) 0;
  border-bottom: 1px solid var(--vc-border-env);
}

.route-rank {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--vc-border-env-strong);
  border-radius: var(--vc-radius-pill);
  color: var(--vc-on-env);
  font-variant-numeric: tabular-nums;
  font-size: var(--vc-text-xs);
  font-weight: 650;
}

.route-copy,
.provider-row__main {
  flex: 1 1 auto;
}

.route-move {
  min-width: 52px;
}

.provider-list {
  margin-top: var(--vc-space-4);
  border-top: 1px solid var(--vc-border-env);
}

.provider-row {
  align-items: flex-start;
}

.provider-row__title-line {
  justify-content: flex-start;
}

.provider-state {
  padding: 2px var(--vc-space-2);
  border-radius: var(--vc-radius-pill);
  background: var(--vc-env);
  color: var(--vc-on-env-muted);
  font-size: 11px;
  font-weight: 600;
}

.provider-state--enabled {
  color: var(--vc-primary);
}

.provider-row__url {
  overflow-wrap: anywhere;
}

.provider-empty {
  padding: var(--vc-space-4) 0;
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-sm);
}

.provider-form,
.field-group {
  display: flex;
  flex-direction: column;
}

.provider-form {
  gap: var(--vc-space-4);
  padding-bottom: var(--vc-space-2);
}

.sheet-reauth {
  position: sticky;
  z-index: 2;
  top: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--vc-space-2);
  padding: var(--vc-space-3);
  border: 1px solid var(--vc-border-env);
  border-radius: var(--vc-radius-m);
  background: var(--vc-env);
}

.sheet-reauth__copy {
  display: flex;
  grid-column: 1 / -1;
  flex-direction: column;
}

.sheet-reauth__error {
  grid-column: 1 / -1;
  color: var(--vc-danger-on-env);
  font-size: var(--vc-text-xs);
  line-height: 1.5;
}

.field-group {
  min-width: 0;
  gap: var(--vc-space-1);
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--vc-space-3);
}

.provider-input,
.provider-select {
  width: 100%;
  min-height: 44px;
  box-sizing: border-box;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-env-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-env);
  color: var(--vc-on-env);
  caret-color: var(--vc-primary);
  font: inherit;
  font-size: 16px;
}

.provider-input::placeholder {
  color: var(--vc-on-env-muted);
  opacity: 0.8;
}

.model-editor {
  padding: var(--vc-space-3);
  border: 1px solid var(--vc-border-env);
  border-radius: var(--vc-radius-m);
}

.model-editor__head {
  margin-bottom: var(--vc-space-2);
}

.model-remove {
  width: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--vc-danger-on-env);
}

.form-actions {
  position: sticky;
  z-index: 1;
  bottom: 0;
  justify-content: flex-end;
  padding-top: var(--vc-space-3);
  border-top: 1px solid var(--vc-border-env);
  background: var(--vc-card);
}

@media (max-width: 720px) {
  .provider-head,
  .provider-subhead,
  .model-head {
    align-items: stretch;
    flex-direction: column;
  }

  .provider-head__actions .provider-button {
    flex: 1 1 0;
  }

  .model-head__actions {
    width: 100%;
  }

  .model-head__actions .provider-button {
    flex: 1 1 0;
  }

  .reauth-row,
  .sheet-reauth,
  .field-grid {
    grid-template-columns: 1fr;
  }

  .route-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .route-copy {
    min-width: calc(100% - 48px);
  }

  .route-actions {
    width: 100%;
    padding-left: 44px;
  }

  .route-actions .route-move {
    flex: 1 1 0;
  }

  .provider-row {
    flex-direction: column;
  }

  .provider-row > .provider-button {
    width: 100%;
  }
}
</style>
