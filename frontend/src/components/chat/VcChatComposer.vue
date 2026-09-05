<template>
  <view class="vc-chat-composer" role="form" aria-label="发送消息">
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
        点此重试
      </button>
    </view>

    <view class="vc-chat-composer__field">
      <textarea
        :value="modelValue"
        class="vc-chat-composer__input"
        data-testid="message-input"
        placeholder="想说些什么…"
        aria-label="消息输入"
        auto-height
        :maxlength="4000"
        :disabled="busy || streaming || disabled"
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
        @click="$emit('send')"
      >
        <AppIcon name="send" :size="18" />
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import AppIcon from "@/design-system/AppIcon.vue";

defineProps<{
  modelValue: string;
  busy: boolean;
  streaming: boolean;
  disabled?: boolean;
  errorText?: string;
  canRetry?: boolean;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
  (event: "send"): void;
  (event: "cancel"): void;
  (event: "retry"): void;
}>();

function onInput(event: Event | { detail?: { value?: string } }): void {
  const detailValue = "detail" in event ? event.detail?.value : undefined;
  const targetValue = "target" in event
    ? (event.target as HTMLTextAreaElement | null)?.value
    : undefined;
  emit("update:modelValue", detailValue ?? targetValue ?? "");
}

function onEnter(event: KeyboardEvent): void {
  if (event.shiftKey) return;
  event.preventDefault();
  emit("send");
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
  grid-template-columns: minmax(0, 1fr) 40px;
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
  width: 40px;
  height: 40px;
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
