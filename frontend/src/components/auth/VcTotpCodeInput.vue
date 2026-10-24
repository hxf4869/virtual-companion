<template>
  <view class="vc-totp">
    <view class="vc-totp__control" :class="{ 'is-error': Boolean(error) }">
      <input
        ref="inputRef"
        class="vc-totp__input"
        :data-testid="testId"
        :value="modelValue"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        :disabled="disabled"
        aria-label="6 位身份验证器验证码"
        :aria-invalid="error ? 'true' : 'false'"
        :aria-describedby="error ? `${inputId}-error` : undefined"
        @input="onInput"
        @blur="onInput"
        @confirm="onConfirm"
      />
      <view class="vc-totp__cells" aria-hidden="true">
        <view
          v-for="index in 6"
          :key="index"
          class="vc-totp__cell"
          :class="{
            'is-filled': Boolean(digits[index - 1]),
            'is-current': modelValue.length === index - 1,
          }"
        >
          <text>{{ digits[index - 1] ?? "" }}</text>
        </view>
      </view>
    </view>
    <text
      v-if="error"
      :id="`${inputId}-error`"
      class="vc-totp__error"
      role="alert"
    >
      {{ error }}
    </text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

const props = withDefaults(defineProps<{
  modelValue: string;
  error?: string;
  disabled?: boolean;
  inputId?: string;
  testId?: string;
}>(), {
  error: "",
  disabled: false,
  inputId: "authenticator-code",
  testId: "totp-code",
});

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
  (event: "submit"): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const digits = computed(() => props.modelValue.slice(0, 6).split(""));

function onInput(event: Event | { detail?: { value?: string } }): void {
  const detailValue = "detail" in event ? event.detail?.value : undefined;
  const targetValue = "target" in event
    ? (event.target as HTMLInputElement | null)?.value
    : undefined;
  emit("update:modelValue", (detailValue ?? targetValue ?? "").replace(/\D/g, "").slice(0, 6));
}

// VC-R167: uni-h5 useValueSync 对外 update:modelValue 有 100ms 节流，快速
// 纠正验证码后存在「DOM 已是新码、父组件仍旧码」的窗口。blur 与 uni 原生
// confirm（H5 由输入包装层 onKeyUpEnter 触发，其它端原生）都先经 onInput
// 按既有规则（纯数字+6 位截断）补同步，confirm 同步后才提交；删除早于
// confirm 的 keydown.enter 双入口（它会在值同步前抢跑提交旧码）。与
// VC-R166 的 VcAuthField 修复同模式。
function onConfirm(event: Event | { detail?: { value?: string } }): void {
  onInput(event);
  emit("submit");
}

defineExpose({
  focus: () => inputRef.value?.focus(),
});
</script>

<style scoped>
.vc-totp {
  display: grid;
  gap: var(--vc-space-2);
  min-width: 0;
}

.vc-totp__control {
  position: relative;
  min-width: 0;
  border-radius: var(--vc-radius-control);
}

.vc-totp__input {
  position: absolute;
  z-index: 2;
  inset: 0;
  box-sizing: border-box;
  width: 100%;
  height: 48px;
  margin: 0;
  padding: 0;
  border: 0;
  outline: 0;
  color: transparent;
  background: transparent;
  font-size: 16px;
  caret-color: transparent;
  -webkit-text-fill-color: transparent;
}

.vc-totp__cells {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--vc-space-2);
  pointer-events: none;
}

.vc-totp__cell {
  display: grid;
  place-items: center;
  min-width: 0;
  height: 48px;
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  color: var(--vc-color-ink);
  background: var(--vc-color-surface);
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  line-height: 24px;
  transition: border-color 140ms ease-out, box-shadow 140ms ease-out;
}

.vc-totp__control:focus-within .vc-totp__cell.is-current,
.vc-totp__cell.is-filled {
  border-color: var(--vc-color-primary);
}

.vc-totp__control:focus-within .vc-totp__cell.is-current {
  box-shadow: 0 0 0 2px var(--vc-color-focus-ring);
}

.vc-totp__control.is-error .vc-totp__cell {
  border-color: var(--vc-color-error);
}

.vc-totp__error {
  color: var(--vc-color-error);
  font-size: 14px;
  line-height: 22px;
}

@media (max-width: 359px) {
  .vc-totp__cells {
    gap: var(--vc-space-1);
  }
}
</style>
