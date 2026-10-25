<template>
  <view
    ref="composerRoot"
    class="vc-chat-composer"
    role="form"
    aria-label="发送消息"
  >
    <view
      v-if="errorText"
      class="vc-chat-composer__error"
      data-testid="chat-send-error"
      role="alert"
    >
      <text>{{ errorText }}</text>
      <button
        v-if="canRetry"
        type="button"
        data-testid="retry"
        :disabled="busy"
        @click="$emit('retry')"
      >
        {{ retryLabel ?? "点此重试" }}
      </button>
    </view>

    <view class="vc-chat-composer__field">
      <!-- WP-D（缺口2）：生成中不禁用 textarea，用户可以继续写下一条草稿；
           发送按钮保持 busy 禁用 / 流式期间切换为停止语义。 -->
      <textarea
        :key="inputFieldKey"
        :value="modelValue"
        class="vc-chat-composer__input"
        data-testid="message-input"
        placeholder="想说些什么…"
        aria-label="消息输入"
        auto-height
        :maxlength="4000"
        :disabled="disabled"
        @input="onInput"
        @keydown.enter="onEnter"
      />

      <button
        v-if="streaming"
        type="button"
        class="vc-chat-composer__send vc-chat-composer__send--stop"
        data-testid="cancel"
        aria-label="停止回复"
        @click="$emit('cancel')"
      >
        <span aria-hidden="true" />
      </button>
      <button
        v-else
        type="button"
        class="vc-chat-composer__send"
        data-testid="send"
        aria-label="发送消息"
        :disabled="busy || disabled || modelValue.trim().length === 0"
        @click="submitFromField"
      >
        <AppIcon name="send" :size="18" />
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { nextTick, ref, watch, type ComponentPublicInstance } from "vue";

import AppIcon from "@/design-system/AppIcon.vue";

const props = defineProps<{
  modelValue: string;
  busy: boolean;
  streaming: boolean;
  disabled?: boolean;
  errorText?: string;
  canRetry?: boolean;
  /** VC-R115：未确认发送分支传"重试原消息"，与发送当前草稿区分；缺省保持通用文案。 */
  retryLabel?: string;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
  (event: "send"): void;
  (event: "cancel"): void;
  (event: "retry"): void;
}>();

// VC-R183：uni-h5 对 input 发射做 100ms 节流（useValueSync），父级发送后
// 同步清空 modelValue 时，旧 textarea 实例尚未落地的尾部发射会携带已发送
// 草稿迟到回写（真实 H5 事件观察：清空生效后 modelValue 0→又回到草稿）。
// 以输入控件实例归属作废旧发射：父级程序性清空（非空→空，且本字段最后一次
// 上报值仍非空——当前实例仍持旧草稿、尾部发射可能未落地）时递增 key 重建
// 组件内 uni textarea 实例；旧实例 unmount 后 uni-h5-vue runtime 的 emit
// 因 isUnmounted 直接返回，旧发射失去归属。用户自己删空时最后一次上报已是
// 空串，不重建；不以时间窗或正文相等猜测草稿身份。
const composerRoot = ref<ComponentPublicInstance | HTMLElement | null>(null);
const inputFieldKey = ref(0);
let lastReportedValue = "";

function nativeTextarea(): HTMLTextAreaElement | null {
  const host = composerRoot.value;
  if (!host) return null;
  // 真实 H5：<view> 是 uni 内建组件（未 expose），ref 为实例、经 $el 取根；
  // 组件测试：未注册的 view 落为原生元素，ref 即元素本身。仅查本组件子树。
  const element = host instanceof HTMLElement ? host : host.$el;
  return element?.querySelector("textarea") ?? null;
}

watch(
  () => props.modelValue,
  (next, previous) => {
    if (next !== "" || previous === "" || lastReportedValue === "") return;
    // 程序性清空（如 Enter 发送时字段仍有焦点）：nextTick 新节点落地后保留
    // 本字段焦点；原本未聚焦或焦点已在他处时不抢焦点。
    const hadFocus = document.activeElement === nativeTextarea();
    lastReportedValue = "";
    inputFieldKey.value += 1;
    if (hadFocus) {
      void nextTick(() => {
        // 仅当焦点未被其他已连接控件接管时恢复，不无条件抢回（旧节点被
        // 摘下后焦点落到 body 或仍悬在被摘节点上都视为无主；activeElement
        // 本就是 Element，SVG 等已连接焦点控件同样构成接管）。
        const active = document.activeElement;
        const takenOver = active !== null
          && active !== document.body
          && active !== nativeTextarea()
          && active.isConnected;
        if (!takenOver) nativeTextarea()?.focus();
      });
    }
  },
);

function onInput(event: Event | { detail?: { value?: string } }): void {
  const detailValue = "detail" in event ? event.detail?.value : undefined;
  const targetValue = "target" in event
    ? (event.target as HTMLTextAreaElement | null)?.value
    : undefined;
  const value = detailValue ?? targetValue ?? "";
  lastReportedValue = value;
  emit("update:modelValue", value);
}

/**
 * 统一提交入口（发送按钮与普通 Enter）：uni 对 input 发射做 100ms 节流，
 * 连续输入的最新尾字符可能尚未进入父级 modelValue——提交意图必须等于
 * 用户当前看到的完整原生输入，故 emit send 之前先沿既有 update:modelValue
 * 协议同步上报本组件当前完整原生值（父级 onDraftInput 同步更新），再
 * emit send。field 存在时每次都读取一次当前 value 并刷新已上报标志（上次
 * 发射缓存不等于父级模型已同步——存在失败回填等程序性赋值，这里不做
 * 缓存推断），与程序性清空的重建判定保持一致；IME/Shift+Enter 守卫在
 * onEnter 中先于此入口；retry 原消息不经此入口，不会被当前草稿改写。
 */
function submitFromField(): void {
  const field = nativeTextarea();
  if (field) {
    lastReportedValue = field.value;
    emit("update:modelValue", field.value);
  }
  emit("send");
}

function onEnter(event: KeyboardEvent): void {
  if (event.shiftKey) return;
  // 中文等输入法组合期间的 Enter 是选词确认，不得发送（keyCode 229 兼容
  // isComposing 缺失的遗留浏览器与部分 uni-app H5 环境）。
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  submitFromField();
}
</script>

<style scoped>
.vc-chat-composer {
  display: grid;
  gap: var(--vc-space-2);
  box-sizing: border-box;
  width: 100%;
  padding:
    var(--vc-space-2)
    calc(var(--vc-space-3) + env(safe-area-inset-right, 0px))
    var(--vc-space-2)
    calc(var(--vc-space-3) + env(safe-area-inset-left, 0px));
  border-top: 1px solid var(--vc-color-hairline);
  background: var(--vc-color-canvas);
}

.vc-chat-composer__error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-3);
  min-width: 0;
  color: var(--vc-color-error);
  font-size: 13px;
  line-height: 20px;
}

.vc-chat-composer__error text {
  min-width: 0;
}

.vc-chat-composer__error button {
  flex: 0 0 auto;
  min-height: 40px;
  margin: -8px 0;
  padding: 0 var(--vc-space-2);
  border: 0;
  border-radius: var(--vc-radius-control);
  color: var(--vc-color-primary);
  background: transparent;
  font: inherit;
  font-weight: 500;
}

.vc-chat-composer__error button::after {
  border: 0;
}

.vc-chat-composer__field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  align-items: end;
  gap: var(--vc-space-2);
  box-sizing: border-box;
  min-width: 0;
  min-height: 52px;
  padding: 5px 5px 5px var(--vc-space-4);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface);
}

.vc-chat-composer__field:focus-within {
  border-color: var(--vc-color-primary);
  box-shadow: 0 0 0 3px var(--vc-color-focus-ring);
}

.vc-chat-composer__input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 40px;
  max-height: 120px;
  margin: 0;
  padding: 8px 0 6px;
  overflow-y: auto;
  border: 0;
  color: var(--vc-color-ink);
  background: transparent;
  font: inherit;
  font-size: 16px;
  line-height: 24px;
}

.vc-chat-composer__input :deep(.uni-textarea-placeholder),
.vc-chat-composer__input :deep(.uni-textarea-textarea),
.vc-chat-composer__input :deep(.uni-textarea-compute) {
  font: inherit;
  line-height: 24px;
}

.vc-chat-composer__input :deep(.uni-textarea-placeholder) {
  color: var(--vc-color-ink-muted);
}

.vc-chat-composer__send {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--vc-radius-full);
  color: var(--vc-color-surface);
  background: var(--vc-color-primary);
}

.vc-chat-composer__send::after {
  border: 0;
}

.vc-chat-composer__send[disabled] {
  opacity: 0.42;
}

.vc-chat-composer__send:not([disabled]):active {
  background: var(--vc-color-primary-pressed);
}

.vc-chat-composer__send:focus-visible,
.vc-chat-composer__error button:focus-visible {
  outline: 2px solid var(--vc-color-primary);
  outline-offset: 2px;
}

.vc-chat-composer__send--stop span {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: currentColor;
}
</style>
