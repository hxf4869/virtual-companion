<template>
  <!-- 陪伴设置：当前 active 关系的行为偏好（全量替换式 PATCH）。
       服务端在首次聊天时自动创建唯一默认陪伴，本页不提供创建表单。 -->
  <ConsumerShell route="/pages/companion/companion">
    <view class="companion-page">
      <view
        v-if="loadState === 'loading'"
        class="companion-state"
        data-testid="companion-loading"
        role="status"
      >
        <view class="companion-skeleton companion-skeleton--short" aria-hidden="true" />
        <view class="companion-skeleton" aria-hidden="true" />
        <view class="companion-skeleton" aria-hidden="true" />
        <text class="vc-sr-only">正在加载陪伴设置</text>
      </view>

      <view
        v-else-if="loadState === 'error'"
        class="companion-state companion-state--center"
        data-testid="companion-load-failed"
        role="alert"
      >
        <text class="companion-state__title">陪伴设置没有加载出来</text>
        <text class="companion-state__copy">检查网络后再试一次。</text>
        <button
          type="button"
          class="secondary-action"
          data-testid="companion-retry"
          @click="reload"
        >
          重新加载
        </button>
      </view>

      <view
        v-else-if="!relationship"
        class="companion-state companion-state--center"
        data-testid="companion-empty"
        role="status"
      >
        <view class="companion-state__mark" aria-hidden="true">
          <AppIcon name="me" :size="24" />
        </view>
        <text class="companion-state__title">你的陪伴还没准备好</text>
        <text class="companion-state__copy">
          首次开始聊天时，陪伴会自动创建。先去聊聊，再回来调整这里的设置。
        </text>
        <button
          type="button"
          class="primary-action primary-action--slim"
          data-testid="companion-go-chat"
          @click="goTo('/pages/chat/chat')"
        >
          去聊天
        </button>
      </view>

      <view v-else-if="formModel" class="companion-form" data-testid="companion-form">
        <section class="pref-section" aria-labelledby="pref-name-title">
          <text id="pref-name-title" class="pref-section__title">称呼</text>
          <view class="pref-card">
            <view class="pref-field">
              <label class="pref-field__label" for="pref-companion-name">陪伴的名字</label>
              <input
                id="pref-companion-name"
                v-model="companionNameInput"
                class="pref-input"
                data-testid="pref-companion-name"
                type="text"
                maxlength="32"
                placeholder="留空则使用默认称呼"
              />
              <text class="pref-field__hint">最多 32 个字</text>
            </view>
            <view class="pref-field">
              <label class="pref-field__label" for="pref-user-address-as">对我的称呼</label>
              <input
                id="pref-user-address-as"
                v-model="userAddressAsInput"
                class="pref-input"
                data-testid="pref-user-address-as"
                type="text"
                maxlength="32"
                placeholder="留空则使用默认称呼"
              />
            </view>
          </view>
        </section>

        <section class="pref-section" aria-labelledby="pref-chat-title" @keydown="onRadioKeydown">
          <text id="pref-chat-title" class="pref-section__title">聊天偏好</text>
          <view class="pref-card">
            <view class="pref-field">
              <text class="pref-field__label" aria-hidden="true">回复长度</text>
              <view class="pref-options" role="radiogroup" aria-label="回复长度">
                <button
                  v-for="option in REPLY_LENGTH_OPTIONS"
                  :key="option.value"
                  type="button"
                  class="pref-option"
                  :class="{ 'pref-option--on': formModel.replyLength === option.value }"
                  role="radio"
                  :aria-checked="formModel.replyLength === option.value"
                  :tabindex="formModel.replyLength === option.value ? 0 : -1"
                  :data-testid="`pref-reply-length-${option.value}`"
                  @click="edit((d) => { d.replyLength = option.value; })"
                >
                  {{ option.label }}
                </button>
              </view>
            </view>

            <view class="pref-field">
              <text class="pref-field__label" aria-hidden="true">主动程度</text>
              <view class="pref-options" role="radiogroup" aria-label="主动程度">
                <button
                  v-for="option in INITIATIVE_OPTIONS"
                  :key="option.value"
                  type="button"
                  class="pref-option"
                  :class="{ 'pref-option--on': formModel.initiative === option.value }"
                  role="radio"
                  :aria-checked="formModel.initiative === option.value"
                  :tabindex="formModel.initiative === option.value ? 0 : -1"
                  :data-testid="`pref-initiative-${option.value}`"
                  @click="edit((d) => { d.initiative = option.value; })"
                >
                  {{ option.label }}
                </button>
              </view>
            </view>

            <view class="pref-field">
              <text class="pref-field__label" aria-hidden="true">建议方式</text>
              <view class="pref-options" role="radiogroup" aria-label="建议方式">
                <button
                  v-for="option in ADVICE_PREF_OPTIONS"
                  :key="option.value"
                  type="button"
                  class="pref-option"
                  :class="{ 'pref-option--on': formModel.advicePref === option.value }"
                  role="radio"
                  :aria-checked="formModel.advicePref === option.value"
                  :tabindex="formModel.advicePref === option.value ? 0 : -1"
                  :data-testid="`pref-advice-${option.value}`"
                  @click="edit((d) => { d.advicePref = option.value; })"
                >
                  {{ option.label }}
                </button>
              </view>
            </view>

            <view class="pref-field">
              <text class="pref-field__label" aria-hidden="true">幽默程度</text>
              <view class="pref-options" role="radiogroup" aria-label="幽默程度">
                <button
                  v-for="option in HUMOR_OPTIONS"
                  :key="option.value"
                  type="button"
                  class="pref-option"
                  :class="{ 'pref-option--on': formModel.humor === option.value }"
                  role="radio"
                  :aria-checked="formModel.humor === option.value"
                  :tabindex="formModel.humor === option.value ? 0 : -1"
                  :data-testid="`pref-humor-${option.value}`"
                  @click="edit((d) => { d.humor = option.value; })"
                >
                  {{ option.label }}
                </button>
              </view>
            </view>
          </view>
        </section>

        <section class="pref-section" aria-labelledby="pref-topics-title">
          <text id="pref-topics-title" class="pref-section__title">避免话题</text>
          <view class="pref-card">
            <view class="pref-field">
              <text class="pref-field__label" aria-hidden="true">聊天时尽量避开这些话题</text>
              <view class="pref-options" role="group" aria-label="避免话题">
                <button
                  v-for="option in AVOID_TOPIC_OPTIONS"
                  :key="option.value"
                  type="button"
                  class="pref-option"
                  :class="{ 'pref-option--on': formModel.avoidTopics.includes(option.value) }"
                  role="checkbox"
                  :aria-checked="formModel.avoidTopics.includes(option.value)"
                  :data-testid="`pref-topic-${option.value}`"
                  @click="toggleTopic(option.value)"
                >
                  {{ option.label }}
                </button>
              </view>
            </view>
          </view>
        </section>

        <view class="save-bar">
          <text v-if="dirty" class="save-bar__dirty" data-testid="companion-dirty">
            有未保存的更改
          </text>
          <text
            v-else-if="saveState === 'saved'"
            class="save-bar__ok"
            data-testid="companion-saved"
            role="status"
          >
            已保存
          </text>

          <button
            type="button"
            class="primary-action"
            data-testid="companion-save"
            :disabled="saveState === 'saving' || !dirty"
            @click="onSave"
          >
            {{ saveState === "saving" ? "保存中…" : "保存更改" }}
          </button>

          <view
            v-if="saveState === 'error'"
            class="save-bar__error"
            data-testid="companion-save-error"
            role="alert"
          >
            <text>没有保存成功，你的修改还留在页面上，可以直接重试。</text>
          </view>

          <view
            v-if="saveState === 'unknown'"
            class="save-bar__unknown"
            data-testid="companion-unknown"
            role="alert"
          >
            <text>已提交，未能确认是否生效。</text>
            <button
              type="button"
              class="secondary-action"
              data-testid="companion-reload"
              @click="reload"
            >
              重新读取
            </button>
          </view>
        </view>
      </view>
    </view>
  </ConsumerShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, ref, watch } from "vue";

import type { AvoidTopic } from "@/api/relationship";
import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { goTo } from "@/app/navigate";
import AppIcon from "@/design-system/AppIcon.vue";
import { useAuthStore } from "@/stores/auth";

import {
  ADVICE_PREF_OPTIONS,
  AVOID_TOPIC_OPTIONS,
  HUMOR_OPTIONS,
  INITIATIVE_OPTIONS,
  REPLY_LENGTH_OPTIONS,
} from "./prefs-options";
import { useCompanionPrefs } from "./useCompanionPrefs";

const auth = useAuthStore();
const {
  loadState,
  saveState,
  relationship,
  draft,
  dirty,
  load,
  edit,
  save,
  reset,
} = useCompanionPrefs();

// VC-R13：本页内容归属的账号（加载发起时同步确立，惯例同 R11 的三个
// KeepAlive 缓存页）。KeepAlive 返回缓存页时按它判断是否需要为新账号
// 重载；换号清理会把它置空。
let loadedForAccountId: string | null = null;
// VC-R13：页面私有加载代次（在途 reload 的收尾归属凭据，护住 busy）。
// 只在「发起新 reload」与「换号清理」时递增；同账号的重认证不推进——
// 账号归属由 watch 与 loadedForAccountId 承担，不用 auth 会话代次
// （它每次认证都变，会把同账号恢复误判过期并永久挂住 busy）。
let loadSeq = 0;
const busy = ref(false);

const transport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  getAccountId: () => auth.accountId,
      getSessionId: () => auth.getSessionId(),
  getSessionRevision: () => auth.getSessionRevision(),
  onUnauthorized: () => auth.onUnauthorized(),
  // VC-R52 期望账号失配恢复：先作废旧本地归属再读当前 Cookie 身份，
  // 不自动重放动作（共享入口见 stores/auth.ts reconcileAccountContext）。
  onAccountContextChanged: () => {
    void auth.reconcileAccountContext(transport);
  },
});

// 表单分支的守卫模型：只在 active 关系与草稿齐备时渲染表单，
// 模板里因此拿到非空的偏好对象。
const formModel = computed(() => {
  if (!relationship.value || !draft.value) return null;
  return draft.value;
});

// 文本输入保留原始草稿（不在输入中途折叠空格）；服务端保存时会自行
// 归一化，保存成功后以服务端回读结果作为新基线。
const companionNameInput = computed({
  get: () => draft.value?.companionName ?? "",
  set: (value: string) => edit((d) => { d.companionName = value; }),
});

const userAddressAsInput = computed({
  get: () => draft.value?.userAddressAs ?? "",
  set: (value: string) => edit((d) => { d.userAddressAs = value; }),
});

function toggleTopic(topic: AvoidTopic): void {
  edit((d) => {
    d.avoidTopics = d.avoidTopics.includes(topic)
      ? d.avoidTopics.filter((item) => item !== topic)
      : [...d.avoidTopics, topic];
  });
}

// VC-R175：单选组方向键（W3C APG radio）。右/下选中并聚焦同组 DOM 顺序的下一项，
// 左/上选中上一项，首尾循环；选中经目标项既有 @click 走同一条 edit 草稿路径。
// 监听挂在包着四个 radiogroup 的原生 <section> 上：uni-app H5 对内建组件（uni-button）
// 的模板事件做跨端归一化，currentTarget 只剩 {id,dataset,…} 数据对象，原生元素上的
// 事件才拿到原始 KeyboardEvent。Tab 序由模板的 roving tabindex（选中项 0、其余 -1）
// 决定；Enter/Space 激活属于 platform/h5-a11y 的全局 shim，页面不接管、不 preventDefault，
// 其它键与非 radio 来源一律放行。
function onRadioKeydown(event: KeyboardEvent): void {
  let step: number;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      step = 1;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      step = -1;
      break;
    default:
      return;
  }
  const current = (event.target as Element).closest<HTMLElement>('[role="radio"]');
  if (!current) return;
  event.preventDefault();
  const radios = Array.from(
    current.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [],
  );
  const target = radios[(radios.indexOf(current) + step + radios.length) % radios.length];
  target.click();
  void nextTick(() => target.focus());
}

// VC-R13：换号身份交接。KeepAlive 缓存的隐藏页不得保留旧账号的偏好与
// 草稿，也不得被旧账号的在途读取/保存回填或占住保存位。仅在「已知账号 →
// 不同账号/退出」时清理；null → X（初次恢复、匿名后登录）不清理、不当作
// 过期。清理只重置本地并作废在途请求，不发起新读取——隐藏缓存页不抢跑，
// 重载交给 onActivated。
watch(() => auth.accountId, (next, prev) => {
  if (prev === null || next === prev) return;
  reset();
  loadedForAccountId = null;
  loadSeq++;
  busy.value = false;
});

async function reload(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  // VC-R13：本次加载的代次。每次 await 之后与 finally 的收尾都以
  // mySeq === loadSeq 为门控：换号清理或更新的加载已接管时静默丢弃，
  // 不写状态、不动新请求的 busy。
  const mySeq = ++loadSeq;
  const isStale = () => mySeq !== loadSeq;
  try {
    if (!auth.isAuthenticated) {
      await auth.tryRefresh(transport);
      if (isStale()) return;
    }
    if (!auth.isAuthenticated) {
      loadState.value = "error";
      return;
    }
    loadedForAccountId = auth.accountId;
    await load(transport);
  } finally {
    if (!isStale()) busy.value = false;
  }
}

async function onSave(): Promise<void> {
  if (!dirty.value || saveState.value === "saving") return;
  await save(transport);
}

onMounted(() => {
  void reload();
});

// VC-R13：KeepAlive 缓存页重新激活时，仅当已认证且当前内容不属于本账号
// 才重新加载；同账号返回（归属一致）不重载、不重复请求，未保存草稿保留。
// 与 onMounted 首次同时触发由 reload 同步置位的 busy 去重。
onActivated(() => {
  if (!auth.isAuthenticated || busy.value) return;
  if (loadedForAccountId === auth.accountId) return;
  void reload();
});
</script>

<style scoped>
.companion-page {
  display: grid;
  gap: var(--vc-space-5);
  width: 100%;
  max-width: 680px;
  min-width: 0;
  padding-bottom: var(--vc-space-4);
}

.companion-state {
  display: grid;
  gap: var(--vc-space-2);
  min-width: 0;
}

.companion-state--center {
  justify-items: center;
  align-content: center;
  gap: var(--vc-space-3);
  min-height: 320px;
  padding: var(--vc-space-7) var(--vc-space-4);
  text-align: center;
}

.companion-state__title {
  color: var(--vc-color-ink);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
}

.companion-state__copy {
  max-width: 26em;
  color: var(--vc-color-ink-muted);
  font-size: 14px;
  line-height: 22px;
}

.companion-state__mark {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 52px;
  height: 52px;
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-primary);
}

.companion-skeleton {
  width: 100%;
  height: 64px;
  margin: var(--vc-space-2) 0;
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface-soft);
}

.companion-skeleton--short {
  width: 42%;
  height: 18px;
}

.pref-section {
  display: block;
}

.pref-section__title {
  display: block;
  margin: 0 0 var(--vc-space-2) var(--vc-space-1);
  color: var(--vc-color-ink-muted);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.pref-card {
  overflow: hidden;
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface);
}

.pref-field {
  padding: var(--vc-space-3) var(--vc-space-4);
}

.pref-field + .pref-field {
  border-top: 1px solid var(--vc-color-hairline);
}

.pref-field__label {
  display: block;
  margin-bottom: var(--vc-space-2);
  color: var(--vc-color-ink);
  font-size: 14px;
  font-weight: 550;
  line-height: 20px;
}

.pref-field__hint {
  display: block;
  margin-top: var(--vc-space-1);
  color: var(--vc-color-ink-muted);
  font-size: 12px;
  line-height: 18px;
}

.pref-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 46px;
  padding: 10px var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface);
  color: var(--vc-color-ink);
  font-size: 16px;
}

.pref-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
}

.pref-option {
  min-height: 40px;
  margin: 0;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface);
  color: var(--vc-color-ink);
  font: inherit;
  font-size: 14px;
}

.pref-option--on {
  border-color: var(--vc-color-primary);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-primary);
  font-weight: 600;
}

.save-bar {
  display: grid;
  gap: var(--vc-space-2);
}

.save-bar__dirty {
  color: var(--vc-color-warning);
  font-size: 13px;
  line-height: 20px;
}

.save-bar__ok {
  color: var(--vc-color-success);
  font-size: 13px;
  line-height: 20px;
}

.save-bar__error,
.save-bar__unknown {
  display: grid;
  gap: var(--vc-space-2);
  padding: var(--vc-space-3);
  border-radius: var(--vc-radius-control);
  color: var(--vc-color-error);
  background: var(--vc-color-surface-soft);
  font-size: 13px;
  line-height: 20px;
}

.primary-action,
.secondary-action {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid transparent;
  border-radius: var(--vc-radius-control);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
}

.primary-action {
  background: var(--vc-color-primary);
  color: var(--vc-color-surface);
}

.primary-action--slim {
  justify-self: center;
  min-width: 200px;
}

.primary-action[disabled] {
  opacity: 0.55;
}

.secondary-action {
  background: var(--vc-color-surface);
  border-color: var(--vc-color-hairline);
  color: var(--vc-color-ink);
}

.primary-action::after,
.secondary-action::after,
.pref-option::after {
  border: 0;
}

button:focus-visible {
  outline: 2px solid var(--vc-color-primary);
  outline-offset: 3px;
}

@media (max-width: 340px) {
  .pref-field {
    padding-right: var(--vc-space-3);
    padding-left: var(--vc-space-3);
  }
}
</style>
