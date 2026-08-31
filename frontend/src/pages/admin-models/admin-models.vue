<template>
  <AdminConsoleShell
    active="models"
    title="模型服务"
    subtitle="当前生效配置与本次变更并排核对"
    :access-state="accessState"
    :has-pending-changes="hasChanges"
    @retry-access="retryAccess"
  >
    <template #actions>
      <button class="ac-button" aria-label="刷新模型服务配置" :disabled="busy" @click="refreshProviders">
        <AppIcon name="refresh" :size="18" :spin="loading" />
        <text class="ac-button__label">刷新</text>
      </button>
      <button class="ac-button ac-button--primary" aria-label="添加模型提供方" :disabled="busy" data-testid="provider-add" @click="openCreate">
        <AppIcon name="plus" :size="18" />
        <text class="ac-button__label">添加提供方</text>
      </button>
    </template>

    <view v-if="loading && providers.length === 0" class="models-loading" role="status">
      正在读取模型服务配置…
    </view>

    <view v-else class="models-layout" data-testid="admin-models">
      <aside class="provider-index" aria-label="模型提供方">
        <view class="provider-index__head">
          <text>提供方</text>
          <text>{{ providers.length }}</text>
        </view>
        <view v-if="providers.length === 0 && !isCreating" class="provider-index__empty">
          还没有提供方。先添加一个连接，再登记可用模型。
        </view>
        <button
          v-for="provider in providers"
          :key="provider.providerId"
          class="provider-index__item"
          :class="{ 'provider-index__item--active': provider.providerId === selectedId && !isCreating }"
          :aria-current="provider.providerId === selectedId && !isCreating ? 'true' : undefined"
          data-testid="provider-list-item"
          @click="selectProvider(provider.providerId)"
        >
          <view class="provider-index__title">
            <text>{{ provider.displayName }}</text>
            <text class="ac-status" :class="provider.state === 'ENABLED' ? 'ac-status--up' : ''">
              {{ provider.state === "ENABLED" ? "启用" : "停用" }}
            </text>
          </view>
          <text class="provider-index__id ac-mono">{{ provider.providerId }}</text>
          <text class="provider-index__meta">{{ protocolLabel(provider.protocol) }}</text>
        </button>
        <button
          v-if="isCreating"
          class="provider-index__item provider-index__item--active"
          aria-current="true"
          @click="selectProvider('')"
        >
          <view class="provider-index__title"><text>新提供方</text></view>
          <text class="provider-index__id ac-mono">尚未保存</text>
        </button>
      </aside>

      <section v-if="draft" class="provider-workspace" aria-labelledby="provider-workspace-title">
        <view class="provider-workspace__head">
          <view>
            <text class="provider-workspace__eyebrow">{{ isCreating ? "新增配置" : "当前生效配置" }}</text>
            <text id="provider-workspace-title" class="provider-workspace__title">
              {{ draft.displayName || "未命名提供方" }}
            </text>
          </view>
          <text class="provider-state-label" :class="draft.state === 'ENABLED' ? 'provider-state-label--on' : ''">
            {{ draft.state === "ENABLED" ? "已启用" : "已停用" }}
          </text>
        </view>

        <form class="provider-form" @submit.prevent="reviewSave">
          <fieldset class="provider-ledger">
            <legend>基础连接</legend>
            <view class="provider-field-grid">
              <label class="provider-field">
                <text class="provider-field__label">提供方 ID</text>
                <input
                  v-model="draft.providerId"
                  class="provider-input ac-mono"
                  placeholder="例如 acme-gateway"
                  autocomplete="off"
                  :disabled="busy || !isCreating"
                  data-testid="provider-id"
                />
                <text class="provider-field__help">保存后不可修改；使用小写字母、数字和连字符。</text>
              </label>
              <label class="provider-field">
                <text class="provider-field__label">显示名称</text>
                <input
                  v-model="draft.displayName"
                  class="provider-input"
                  placeholder="例如 Acme Gateway"
                  :disabled="busy"
                  data-testid="provider-display-name"
                />
              </label>
              <label class="provider-field">
                <text class="provider-field__label">API 协议</text>
                <select v-model="draft.protocol" class="provider-select" :disabled="busy" data-testid="provider-protocol">
                  <option value="OPENAI_CHAT_COMPLETIONS">OpenAI Chat Completions</option>
                  <option value="OPENAI_RESPONSES">OpenAI Responses</option>
                  <option value="ANTHROPIC_MESSAGES">Anthropic Messages</option>
                </select>
              </label>
              <label class="provider-field">
                <text class="provider-field__label">运行状态</text>
                <select v-model="draft.state" class="provider-select" :disabled="busy" data-testid="provider-state">
                  <option value="DISABLED">停用，不参与对话</option>
                  <option value="ENABLED">启用</option>
                </select>
              </label>
            </view>

            <label class="provider-field provider-field--wide">
              <text class="provider-field__label">API 地址</text>
              <input
                v-model="draft.baseUrl"
                class="provider-input ac-mono"
                inputmode="url"
                placeholder="https://gateway.example/v1"
                autocomplete="url"
                :disabled="busy"
                data-testid="provider-base-url"
              />
              <text class="provider-field__help">填写服务根地址或以 /v1 结尾的地址，不要填写 messages / responses 路径。</text>
            </label>

            <label class="provider-field provider-field--wide">
              <view class="provider-field__label-line">
                <text class="provider-field__label">API 密钥</text>
                <text v-if="selectedProvider?.credentialConfigured" class="credential-state">
                  <AppIcon name="check" :size="16" /> 已配置
                </text>
              </view>
              <input
                v-model="draft.credential"
                class="provider-input"
                type="password"
                autocomplete="new-password"
                :placeholder="isCreating ? '输入 API 密钥' : '留空以保留现有密钥'"
                :disabled="busy"
                data-testid="provider-credential"
              />
              <text class="provider-field__help">保存后只显示“已配置”，不会回显密钥或任何片段。</text>
            </label>
          </fieldset>

          <fieldset class="provider-ledger provider-ledger--models">
            <legend>模型目录</legend>
            <view class="model-toolbar">
              <view>
                <text class="model-toolbar__title">提供模型</text>
                <text class="model-toolbar__copy">一个提供方最多登记 32 个模型；路由优先级在路由策略页统一调整。</text>
              </view>
              <view class="ac-actions">
                <button type="button" class="ac-button" :disabled="busy" data-testid="provider-discover-models" @click="requestDiscovery">
                  <AppIcon name="refresh" :size="17" :spin="discovering" />
                  获取可用模型
                </button>
                <button type="button" class="ac-button" :disabled="busy || draft.models.length >= 32" @click="addModel">
                  <AppIcon name="plus" :size="17" />
                  添加模型
                </button>
              </view>
            </view>

            <view v-if="catalogMessage" class="ac-message" role="status">
              <AppIcon name="info" :size="18" />
              <text>{{ catalogMessage }}</text>
            </view>

            <view v-for="(model, index) in draft.models" :key="model.key" class="model-row" data-testid="provider-model-row">
              <view class="model-row__head">
                <text>模型 {{ index + 1 }}</text>
                <button
                  v-if="draft.models.length > 1"
                  type="button"
                  class="model-remove"
                  :disabled="busy"
                  :aria-label="`移除模型 ${index + 1}`"
                  @click="removeModel(index)"
                >
                  <AppIcon name="trash" :size="18" />
                </button>
              </view>
              <view class="provider-field-grid provider-field-grid--model">
                <label class="provider-field">
                  <text class="provider-field__label">模型 ID</text>
                  <input v-model="model.modelId" class="provider-input ac-mono" placeholder="模型 ID" :disabled="busy" />
                </label>
                <label class="provider-field">
                  <text class="provider-field__label">显示名称</text>
                  <input v-model="model.displayName" class="provider-input" placeholder="显示名称" :disabled="busy" />
                </label>
                <label class="provider-field">
                  <text class="provider-field__label">上下文窗口（可选）</text>
                  <input v-model="model.contextWindowTokens" class="provider-input ac-mono" type="number" min="1" max="2000000" placeholder="例如 200000" :disabled="busy" />
                </label>
                <label class="provider-field">
                  <text class="provider-field__label">最大输出 token</text>
                  <input v-model="model.maxOutputTokens" class="provider-input ac-mono" type="number" min="1" max="262144" placeholder="例如 48000" :disabled="busy" />
                </label>
                <label class="provider-field">
                  <text class="provider-field__label">状态</text>
                  <select v-model="model.state" class="provider-select" :disabled="busy">
                    <option value="ENABLED">启用</option>
                    <option value="DISABLED">停用</option>
                  </select>
                </label>
              </view>
            </view>
          </fieldset>
        </form>
      </section>

      <section v-else class="provider-workspace provider-workspace--empty">
        <AppIcon name="server" :size="28" />
        <text>选择或添加一个提供方开始配置。</text>
      </section>

      <aside class="model-change" aria-labelledby="change-track-title">
        <view class="model-change__head">
          <AppIcon name="document" :size="20" />
          <text id="change-track-title">本次变更</text>
          <text class="model-change__count">{{ changeItems.length }} 项</text>
        </view>

        <view v-if="changeItems.length === 0" class="model-change__empty">
          <AppIcon name="check" :size="24" />
          <text>当前表单与生效配置一致。</text>
        </view>
        <view v-else class="model-change__list">
          <view v-for="item in changeItems" :key="item" class="model-change__item">
            <view class="model-change__dot" />
            <text>{{ item }}</text>
          </view>
        </view>

        <view v-if="validationErrors.length > 0" class="model-validation" role="alert" data-testid="provider-validation">
          <text class="model-validation__title">保存前需要处理</text>
          <text v-for="error in validationErrors" :key="error" class="model-validation__item">{{ error }}</text>
        </view>

        <view v-if="reauthRequested || reauthConfirmed" class="model-reauth" data-testid="provider-reauth-panel">
          <view v-if="reauthConfirmed" class="model-reauth__confirmed">
            <AppIcon name="lock" :size="18" />
            <text>身份已确认，本次会话可执行敏感写操作。</text>
          </view>
          <template v-else>
            <text class="model-reauth__title">重新认证</text>
            <text class="model-reauth__copy">输入当前管理员密码。密码只用于本次认证请求。</text>
            <input
              v-model="reauthPassword"
              class="provider-input"
              type="password"
              autocomplete="current-password"
              placeholder="当前管理员密码"
              aria-label="当前管理员密码"
              :disabled="busy"
              data-testid="provider-reauth-password"
              @keyup.enter="confirmReauth"
            />
            <button class="ac-button" :disabled="busy || !reauthPassword" data-testid="provider-reauth" @click="confirmReauth">
              <AppIcon name="lock" :size="17" />
              确认并继续
            </button>
          </template>
        </view>

        <view v-if="message" class="ac-message" :class="{ 'ac-message--error': messageKind === 'error', 'ac-message--warning': messageKind === 'warning' }" :role="messageKind === 'error' ? 'alert' : 'status'">
          <AppIcon :name="messageKind === 'error' ? 'danger' : messageKind === 'warning' ? 'warning' : 'check'" :size="18" />
          <text>{{ message }}</text>
        </view>

        <view class="model-change__actions">
          <button class="ac-button ac-button--quiet" :disabled="busy" data-testid="provider-discard" @click="discardChanges">
            放弃变更
          </button>
          <button class="ac-button ac-button--primary" :disabled="busy" data-testid="provider-save" @click="reviewSave">
            <AppIcon name="check" :size="18" />
            {{ saving ? "保存中…" : "检查并保存" }}
          </button>
        </view>
        <text class="model-change__note">保存后，新配置从下一轮对话开始生效。</text>
      </aside>

      <view v-if="changeItems.length > 0 || reauthRequested || saving" class="model-mobile-bar">
        <button class="model-mobile-summary" @click="scrollToChangeTrack">
          本次变更 · {{ changeItems.length }} 项
        </button>
        <button class="ac-button ac-button--primary" :disabled="busy" @click="reviewSave">
          {{ saving ? "保存中…" : "检查并保存" }}
        </button>
      </view>
    </view>
  </AdminConsoleShell>
</template>

<script lang="ts">
import { computed, onMounted, ref } from "vue";

import { reauthAuth } from "@/api/auth";
import {
  discoverProviderModels,
  listModelProviders,
  ProviderHttpError,
  saveModelProvider,
  type ModelProvider,
  type ProviderProtocol,
  type ProviderState,
} from "@/api/providers";
import AppIcon from "@/design-system/AppIcon.vue";
import AdminConsoleShell from "@/pages/admin-console/AdminConsoleShell.vue";
import { useAdminConsoleAccess } from "@/pages/admin-console/useAdminConsole";

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

type MessageKind = "success" | "warning" | "error";
type PendingAction = "save" | "discover" | null;

let nextModelKey = 1;

export default {
  name: "AdminModelsPage",
  components: { AdminConsoleShell, AppIcon },
  setup() {
    const { accessState, transport, ensureAccess } = useAdminConsoleAccess();
    const providers = ref<ModelProvider[]>([]);
    const selectedId = ref("");
    const draft = ref<ProviderDraft | null>(null);
    const baseline = ref<ProviderDraft | null>(null);
    const isCreating = ref(false);
    const loading = ref(false);
    const saving = ref(false);
    const discovering = ref(false);
    const message = ref("");
    const messageKind = ref<MessageKind>("success");
    const catalogMessage = ref("");
    const showValidation = ref(false);
    const reauthRequested = ref(false);
    const reauthConfirmed = ref(false);
    const reauthPassword = ref("");
    const pendingAction = ref<PendingAction>(null);

    const busy = computed(() => loading.value || saving.value || discovering.value);
    const selectedProvider = computed(() => providers.value.find((item) => item.providerId === selectedId.value) ?? null);
    const validationErrors = computed(() => showValidation.value && draft.value
      ? validateDraft(
        draft.value,
        isCreating.value,
        selectedProvider.value?.credentialConfigured === true,
      )
      : []);
    const changeItems = computed(() => describeChanges(baseline.value, draft.value, isCreating.value));
    const hasChanges = computed(() => changeItems.value.length > 0);

    onMounted(async () => {
      if (await ensureAccess()) await loadProviders();
    });

    async function retryAccess(): Promise<void> {
      if (await ensureAccess()) await loadProviders();
    }

    async function loadProviders(preferredId = selectedId.value): Promise<void> {
      loading.value = true;
      try {
        providers.value = await listModelProviders(transport);
        const next = providers.value.find((item) => item.providerId === preferredId) ?? providers.value[0] ?? null;
        if (next) setDraftFromProvider(next);
        else {
          selectedId.value = "";
          draft.value = null;
          baseline.value = null;
          isCreating.value = false;
        }
      } catch {
        setMessage("模型服务配置读取失败，请检查系统状态后重试。", "error");
      } finally {
        loading.value = false;
      }
    }

    async function refreshProviders(): Promise<void> {
      if (busy.value) return;
      if (hasChanges.value) {
        setMessage("当前有未保存变更；请先保存或放弃，再刷新远端配置。", "warning");
        return;
      }
      await loadProviders();
    }

    function selectProvider(providerId: string): void {
      if (providerId === selectedId.value && !isCreating.value) return;
      if (hasChanges.value) {
        setMessage("当前有未保存变更；请先保存或放弃，再切换提供方。", "warning");
        return;
      }
      const provider = providers.value.find((item) => item.providerId === providerId);
      if (provider) setDraftFromProvider(provider);
    }

    function openCreate(): void {
      if (busy.value) return;
      if (hasChanges.value) {
        setMessage("当前有未保存变更；请先保存或放弃，再添加提供方。", "warning");
        return;
      }
      selectedId.value = "";
      isCreating.value = true;
      const value = blankProvider();
      draft.value = value;
      baseline.value = null;
      resetFeedback();
    }

    function setDraftFromProvider(provider: ModelProvider): void {
      selectedId.value = provider.providerId;
      isCreating.value = false;
      const value = providerDraft(provider);
      draft.value = value;
      baseline.value = copyDraft(value);
      resetFeedback();
    }

    function addModel(): void {
      if (!draft.value || draft.value.models.length >= 32) return;
      draft.value.models.push(blankModel());
      showValidation.value = false;
    }

    function removeModel(index: number): void {
      if (!draft.value || draft.value.models.length <= 1) return;
      draft.value.models.splice(index, 1);
      showValidation.value = false;
    }

    function discardChanges(): void {
      if (busy.value) return;
      if (!hasChanges.value) {
        setMessage("当前没有需要放弃的变更。", "warning");
        return;
      }
      if (isCreating.value) {
        const next = providers.value[0];
        if (next) setDraftFromProvider(next);
        else {
          draft.value = null;
          baseline.value = null;
          isCreating.value = false;
        }
      } else if (baseline.value) {
        draft.value = copyDraft(baseline.value);
        resetFeedback();
      }
      setMessage("未保存变更已放弃。", "success");
    }

    async function reviewSave(): Promise<void> {
      if (busy.value || !draft.value) return;
      showValidation.value = true;
      message.value = "";
      if (!hasChanges.value) {
        setMessage("当前没有需要保存的变更。", "warning");
        return;
      }
      if (validationErrors.value.length > 0) {
        setMessage("请先处理右侧列出的配置问题。", "error");
        return;
      }
      if (!reauthConfirmed.value) {
        pendingAction.value = "save";
        reauthRequested.value = true;
        setMessage("保存前需要重新确认管理员身份。", "warning");
        return;
      }
      await saveNow();
    }

    async function confirmReauth(): Promise<void> {
      if (busy.value || !reauthPassword.value) return;
      const password = reauthPassword.value;
      reauthPassword.value = "";
      saving.value = pendingAction.value === "save";
      discovering.value = pendingAction.value === "discover";
      try {
        reauthConfirmed.value = await reauthAuth(transport, password);
        if (!reauthConfirmed.value) {
          setMessage("身份确认失败，请检查密码后重试。", "error");
          return;
        }
        reauthRequested.value = false;
        const action = pendingAction.value;
        pendingAction.value = null;
        setMessage("身份已确认；15 分钟内可以执行敏感写操作。", "success");
        saving.value = false;
        discovering.value = false;
        if (action === "save") await saveNow();
        if (action === "discover") await discoverNow();
      } catch {
        reauthConfirmed.value = false;
        setMessage("身份确认请求失败，请稍后重试。", "error");
      } finally {
        saving.value = false;
        discovering.value = false;
      }
    }

    async function requestDiscovery(): Promise<void> {
      if (busy.value || !draft.value) return;
      const connectionErrors = validateConnection(draft.value, isCreating.value, selectedProvider.value?.credentialConfigured === true);
      if (connectionErrors.length > 0) {
        showValidation.value = true;
        setMessage(connectionErrors[0], "error");
        return;
      }
      if (!reauthConfirmed.value) {
        pendingAction.value = "discover";
        reauthRequested.value = true;
        setMessage("读取提供方模型目录前需要重新确认管理员身份。", "warning");
        return;
      }
      await discoverNow();
    }

    async function discoverNow(): Promise<void> {
      if (!draft.value || discovering.value) return;
      discovering.value = true;
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
          ? "提供方没有返回可用模型；仍可手动填写模型 ID。"
          : `读取到 ${discovered.length} 个模型，新增 ${added} 个；请确认限制后再保存。`;
      } catch (error) {
        if (error instanceof ProviderHttpError && error.status === 403) {
          reauthConfirmed.value = false;
          reauthRequested.value = true;
          setMessage("身份确认已失效，请重新认证后再读取模型目录。", "error");
        } else {
          setMessage("模型目录读取失败。请检查 API 地址、协议和密钥；仍可手动填写模型。", "error");
        }
      } finally {
        discovering.value = false;
      }
    }

    async function saveNow(): Promise<void> {
      if (!draft.value || saving.value) return;
      saving.value = true;
      const value = draft.value;
      const providerId = value.providerId.trim();
      try {
        await saveModelProvider(transport, providerId, {
          displayName: value.displayName.trim(),
          protocol: value.protocol,
          baseUrl: value.baseUrl.trim(),
          credential: value.credential || undefined,
          state: value.state,
          models: value.models.map((model) => ({
            modelId: model.modelId.trim(),
            displayName: model.displayName.trim(),
            contextWindowTokens: model.contextWindowTokens ? Number(model.contextWindowTokens) : undefined,
            maxOutputTokens: Number(model.maxOutputTokens),
            state: model.state,
          })),
        });
        pendingAction.value = null;
        showValidation.value = false;
        await loadProviders(providerId);
        setMessage("提供方配置已保存；新配置从下一轮对话开始生效。", "success");
      } catch (error) {
        if (error instanceof ProviderHttpError && error.status === 403) {
          reauthConfirmed.value = false;
          reauthRequested.value = true;
          pendingAction.value = "save";
          setMessage("身份确认已失效，请重新认证后再保存。", "error");
        } else {
          setMessage("保存失败。请检查地址、模型参数和启用状态后重试。", "error");
        }
      } finally {
        saving.value = false;
      }
    }

    function scrollToChangeTrack(): void {
      try {
        document.getElementById("change-track-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        // Best-effort mobile shortcut.
      }
    }

    function resetFeedback(): void {
      message.value = "";
      catalogMessage.value = "";
      showValidation.value = false;
      pendingAction.value = null;
    }

    function setMessage(value: string, kind: MessageKind): void {
      message.value = value;
      messageKind.value = kind;
    }

    return {
      accessState,
      providers,
      selectedId,
      selectedProvider,
      draft,
      isCreating,
      loading,
      saving,
      discovering,
      busy,
      message,
      messageKind,
      catalogMessage,
      reauthRequested,
      reauthConfirmed,
      reauthPassword,
      validationErrors,
      changeItems,
      hasChanges,
      retryAccess,
      refreshProviders,
      selectProvider,
      openCreate,
      addModel,
      removeModel,
      discardChanges,
      reviewSave,
      confirmReauth,
      requestDiscovery,
      scrollToChangeTrack,
      protocolLabel,
    };
  },
};

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

function providerDraft(provider: ModelProvider): ProviderDraft {
  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    credential: "",
    state: provider.state,
    models: provider.models.map((model) => ({
      key: nextModelKey++,
      modelId: model.modelId,
      displayName: model.displayName,
      contextWindowTokens: model.contextWindowTokens?.toString() ?? "",
      maxOutputTokens: model.maxOutputTokens.toString(),
      state: model.state,
    })),
  };
}

function copyDraft(value: ProviderDraft): ProviderDraft {
  return { ...value, models: value.models.map((model) => ({ ...model })) };
}

function protocolLabel(protocol: ProviderProtocol): string {
  if (protocol === "OPENAI_CHAT_COMPLETIONS") return "OpenAI Chat Completions";
  if (protocol === "OPENAI_RESPONSES") return "OpenAI Responses";
  return "Anthropic Messages";
}

function validateConnection(value: ProviderDraft, creating: boolean, credentialConfigured: boolean): string[] {
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(value.providerId.trim())) {
    errors.push("提供方 ID 必须以小写字母开头，只能包含小写字母、数字和连字符。");
  }
  if (!value.displayName.trim()) errors.push("请填写显示名称。");
  if (!validHttpUrl(value.baseUrl.trim())) errors.push("请填写有效的 http 或 https API 地址。");
  if ((creating || !credentialConfigured) && !value.credential) errors.push("新提供方需要填写 API 密钥。");
  return errors;
}

function validateDraft(
  value: ProviderDraft,
  creating: boolean,
  credentialConfigured: boolean,
): string[] {
  const errors = validateConnection(value, creating, credentialConfigured);
  if (value.models.length === 0) errors.push("至少需要登记一个模型。");
  if (value.models.length > 32) errors.push("一个提供方最多登记 32 个模型。");
  const ids = new Set<string>();
  let enabled = 0;
  value.models.forEach((model, index) => {
    const number = index + 1;
    const id = model.modelId.trim();
    const output = Number(model.maxOutputTokens);
    const context = model.contextWindowTokens ? Number(model.contextWindowTokens) : undefined;
    if (!id) errors.push(`模型 ${number} 缺少模型 ID。`);
    else if (ids.has(id)) errors.push(`模型 ID ${id} 重复。`);
    ids.add(id);
    if (!model.displayName.trim()) errors.push(`模型 ${number} 缺少显示名称。`);
    if (!Number.isInteger(output) || output < 1 || output > 262144) {
      errors.push(`模型 ${number} 的最大输出 token 应为 1–262144 的整数。`);
    }
    if (context !== undefined && (!Number.isInteger(context) || context < 1 || context > 2000000)) {
      errors.push(`模型 ${number} 的上下文窗口应为 1–2000000 的整数。`);
    }
    if (model.state === "ENABLED") enabled++;
  });
  if (value.state === "ENABLED" && enabled === 0) errors.push("启用提供方时，至少启用一个模型。");
  return errors;
}

function validHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function describeChanges(baseline: ProviderDraft | null, current: ProviderDraft | null, creating: boolean): string[] {
  if (!current) return [];
  if (creating || !baseline) {
    const items = ["新增模型提供方"];
    if (current.displayName.trim()) items.push(`名称设为「${current.displayName.trim()}」`);
    if (current.baseUrl.trim()) items.push("设置 API 地址");
    if (current.credential) items.push("配置 API 凭据");
    if (current.models.some((model) => model.modelId.trim())) items.push(`登记 ${current.models.filter((model) => model.modelId.trim()).length} 个模型`);
    if (current.state === "ENABLED") items.push("保存后启用提供方");
    return items;
  }
  const items: string[] = [];
  if (baseline.displayName !== current.displayName) items.push("修改显示名称");
  if (baseline.protocol !== current.protocol) items.push(`协议改为 ${protocolLabel(current.protocol)}`);
  if (baseline.baseUrl !== current.baseUrl) items.push("修改 API 地址");
  if (current.credential) items.push("更新 API 凭据");
  if (baseline.state !== current.state) items.push(current.state === "ENABLED" ? "启用提供方" : "停用提供方");
  const before = comparableModels(baseline.models);
  const after = comparableModels(current.models);
  if (before !== after) {
    const beforeIds = new Set(baseline.models.map((model) => model.modelId));
    const afterIds = new Set(current.models.map((model) => model.modelId));
    const added = [...afterIds].filter((id) => id && !beforeIds.has(id)).length;
    const removed = [...beforeIds].filter((id) => id && !afterIds.has(id)).length;
    if (added) items.push(`新增 ${added} 个模型`);
    if (removed) items.push(`移除 ${removed} 个模型`);
    if (!added && !removed) items.push("修改模型参数或状态");
  }
  return items;
}

function comparableModels(models: ModelDraft[]): string {
  return JSON.stringify(models.map(({ key: _key, ...model }) => model));
}
</script>

<style scoped>
.models-loading { padding: var(--vc-space-8) 0; color: var(--vc-muted); }
.models-layout { display: grid; grid-template-columns: 220px minmax(480px, 1fr) 320px; gap: 1px; align-items: start; background: var(--vc-border); }
.provider-index, .provider-workspace, .model-change { min-height: calc(100dvh - 184px); background: var(--vc-card); }
.provider-index__head { display: flex; align-items: center; justify-content: space-between; min-height: 58px; padding: 0 var(--vc-space-4); border-bottom: 1px solid var(--vc-border); font-size: var(--vc-text-sm); font-weight: 720; }
.provider-index__head text:last-child, .model-change__count { color: var(--vc-muted); font-size: var(--vc-text-xs); font-weight: 550; }
.provider-index__empty { padding: var(--vc-space-5) var(--vc-space-4); color: var(--vc-muted); font-size: var(--vc-text-sm); }
.provider-index__item { display: block; width: 100%; min-height: 94px; padding: var(--vc-space-4); border: 0; border-bottom: 1px solid var(--vc-border); border-radius: 0; background: transparent; color: var(--vc-ink); text-align: left; }
.provider-index__item::after, .model-remove::after, .model-mobile-summary::after { border: 0; }
.provider-index__item:hover { background: var(--vc-env); }
.provider-index__item--active { box-shadow: inset 0 -3px var(--vc-primary); background: var(--vc-primary-bg); }
.provider-index__title { display: flex; align-items: center; justify-content: space-between; gap: var(--vc-space-2); font-weight: 680; }
.provider-index__title .ac-status { font-size: 10px; font-weight: 550; }
.provider-index__id, .provider-index__meta { display: block; margin-top: var(--vc-space-1); overflow: hidden; color: var(--vc-muted); font-size: var(--vc-text-xs); text-overflow: ellipsis; white-space: nowrap; }
.provider-workspace { min-width: 0; padding: var(--vc-space-5) clamp(20px, 2.4vw, 36px) var(--vc-space-8); }
.provider-workspace--empty { display: flex; align-items: center; justify-content: center; gap: var(--vc-space-3); color: var(--vc-muted); }
.provider-workspace__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--vc-space-4); padding-bottom: var(--vc-space-5); border-bottom: 1px solid var(--vc-border); }
.provider-workspace__eyebrow, .provider-workspace__title { display: block; }
.provider-workspace__eyebrow { color: var(--vc-primary); font-size: var(--vc-text-xs); font-weight: 720; }
.provider-workspace__title { margin-top: var(--vc-space-1); font-size: var(--vc-text-xl); font-weight: 760; }
.provider-state-label { padding: 5px 10px; border: 1px solid var(--vc-border); color: var(--vc-muted); font-size: var(--vc-text-xs); }
.provider-state-label--on { border-color: var(--vc-success-border); background: var(--vc-success-bg); color: var(--vc-success); }
.provider-form { display: grid; gap: var(--vc-space-7); margin-top: var(--vc-space-6); }
.provider-ledger { min-width: 0; margin: 0; padding: 0; border: 0; }
.provider-ledger legend { margin-bottom: var(--vc-space-4); padding: 0; font-size: var(--vc-text-lg); font-weight: 720; }
.provider-field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--vc-space-4); }
.provider-field-grid--model { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.provider-field { display: flex; min-width: 0; flex-direction: column; gap: 7px; }
.provider-field--wide { margin-top: var(--vc-space-4); }
.provider-field__label, .provider-field__help { display: block; }
.provider-field__label { color: var(--vc-ink); font-size: var(--vc-text-sm); font-weight: 650; }
.provider-field__help { color: var(--vc-muted); font-size: var(--vc-text-xs); }
.provider-field__label-line { display: flex; align-items: center; justify-content: space-between; gap: var(--vc-space-3); }
.credential-state { display: flex; align-items: center; gap: 5px; color: var(--vc-success); font-size: var(--vc-text-xs); }
.provider-input, .provider-select { box-sizing: border-box; width: 100%; min-height: 46px; padding: 0 13px; border: 1px solid var(--vc-border-strong); border-radius: var(--vc-radius-s); background: var(--vc-card); color: var(--vc-ink); font: inherit; }
.provider-input:focus, .provider-select:focus { border-color: var(--vc-primary); }
.provider-input[disabled] { border-color: var(--vc-border); background: var(--vc-env); color: var(--vc-muted); }
.model-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--vc-space-4); margin-bottom: var(--vc-space-4); }
.model-toolbar__title, .model-toolbar__copy { display: block; }
.model-toolbar__title { font-weight: 680; }
.model-toolbar__copy { margin-top: var(--vc-space-1); color: var(--vc-muted); font-size: var(--vc-text-xs); }
.model-row { margin-top: var(--vc-space-4); padding: var(--vc-space-4); border: 1px solid var(--vc-border); background: #fbfcfb; }
.model-row__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--vc-space-3); font-size: var(--vc-text-sm); font-weight: 700; }
.model-remove { display: grid; width: 44px; height: 44px; margin: -10px -10px -10px 0; padding: 0; place-items: center; border: 0; background: transparent; color: var(--vc-danger); }
.model-change { position: sticky; top: 89px; padding: var(--vc-space-5); }
.model-change__head { display: flex; align-items: center; gap: var(--vc-space-2); min-height: 42px; font-size: var(--vc-text-lg); font-weight: 720; }
.model-change__count { margin-left: auto; }
.model-change__empty { display: flex; flex-direction: column; align-items: center; gap: var(--vc-space-2); padding: var(--vc-space-7) var(--vc-space-3); border-top: 1px solid var(--vc-border); border-bottom: 1px solid var(--vc-border); color: var(--vc-success); text-align: center; font-size: var(--vc-text-sm); }
.model-change__list { border-top: 1px solid var(--vc-border); }
.model-change__item { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: var(--vc-space-2); padding: var(--vc-space-3) 0; border-bottom: 1px solid var(--vc-border); color: var(--vc-ink); font-size: var(--vc-text-sm); }
.model-change__dot { width: 7px; height: 7px; margin-top: 8px; border-radius: 50%; background: var(--vc-primary); }
.model-validation { display: grid; gap: var(--vc-space-2); margin-top: var(--vc-space-4); padding: var(--vc-space-4); border: 1px solid var(--vc-danger-border); background: var(--vc-danger-bg); color: var(--vc-danger); }
.model-validation__title { font-weight: 720; }
.model-validation__item { font-size: var(--vc-text-xs); }
.model-reauth { display: grid; gap: var(--vc-space-2); margin-top: var(--vc-space-4); padding: var(--vc-space-4); border: 1px solid var(--vc-border); background: var(--vc-env); }
.model-reauth__title { font-weight: 720; }
.model-reauth__copy { color: var(--vc-muted); font-size: var(--vc-text-xs); }
.model-reauth__confirmed { display: flex; align-items: flex-start; gap: var(--vc-space-2); color: var(--vc-success); font-size: var(--vc-text-xs); }
.model-change .ac-message { margin-top: var(--vc-space-4); }
.model-change__actions { display: grid; grid-template-columns: 1fr 1.35fr; gap: var(--vc-space-2); margin-top: var(--vc-space-5); }
.model-change__note { display: block; margin-top: var(--vc-space-3); color: var(--vc-muted); font-size: var(--vc-text-xs); text-align: center; }
.model-mobile-bar { display: none; }
@media (max-width: 1180px) {
  .models-layout { grid-template-columns: 200px minmax(0, 1fr); }
  .model-change { position: static; grid-column: 1 / -1; min-height: 0; }
  .model-change__actions { max-width: 480px; }
}
@media (max-width: 820px) {
  .models-layout { display: block; background: transparent; }
  .provider-index, .provider-workspace, .model-change { min-height: 0; }
  .provider-index { display: flex; gap: var(--vc-space-2); margin: 0 calc(-1 * var(--vc-space-4)); padding: 0 var(--vc-space-4) var(--vc-space-4); overflow-x: auto; background: transparent; }
  .provider-index__head { display: none; }
  .provider-index__empty { min-width: calc(100vw - 32px); }
  .provider-index__item { min-width: 220px; border: 1px solid var(--vc-border); background: var(--vc-card); }
  .provider-index__item--active { box-shadow: inset 0 -4px var(--vc-primary); }
  .provider-workspace { margin: 0 calc(-1 * var(--vc-space-4)); padding: var(--vc-space-5) var(--vc-space-4); }
  .provider-field-grid, .provider-field-grid--model { grid-template-columns: 1fr; }
  .model-toolbar { display: grid; }
  .model-toolbar .ac-actions { justify-content: flex-start; flex-wrap: wrap; }
  .model-change { margin: var(--vc-space-5) calc(-1 * var(--vc-space-4)) 0; padding: var(--vc-space-5) var(--vc-space-4) 110px; }
  .model-change__actions { display: none; }
  .model-mobile-bar { position: fixed; inset: auto 0 0 0; z-index: var(--vc-z-nav); display: flex; align-items: center; justify-content: space-between; gap: var(--vc-space-3); padding: var(--vc-space-3) var(--vc-space-4) calc(var(--vc-space-3) + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--vc-border); background: rgba(255,255,255,.97); }
  .model-mobile-summary { min-height: 44px; margin: 0; padding: 0; border: 0; background: transparent; color: var(--vc-primary); font-size: var(--vc-text-sm); }
}
</style>
