<template>
  <view class="vc-auth-field">
    <label class="vc-auth-field__label" :for="fieldId">{{ label }}</label>
    <view class="vc-auth-field__control">
      <input
        :id="fieldId"
        class="vc-auth-field__input"
        :data-testid="testId"
        :value="modelValue"
        :type="nativeType"
        :password="kind === 'password' && !revealed"
        :inputmode="kind === 'email' ? 'email' : 'text'"
        :autocomplete="autocomplete"
        :maxlength="maxlength"
        :disabled="disabled"
        :placeholder="placeholder"
        :aria-label="label"
        :aria-invalid="error ? 'true' : 'false'"
        :aria-describedby="error ? `${fieldId}-error` : undefined"
        @input="onInput"
        @confirm="$emit('submit')"
        @keydown.enter="$emit('submit')"
      />
      <button
        v-if="kind === 'password'"
        class="vc-auth-field__toggle"
        type="button"
        :aria-label="revealed ? '隐藏密码' : '显示密码'"
        @click="revealed = !revealed"
      >
        {{ revealed ? "隐藏" : "显示" }}
      </button>
    </view>
    <text
      v-if="error"
      :id="`${fieldId}-error`"
      class="vc-auth-field__error"
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
  fieldId: string;
  label: string;
  kind?: "email" | "password" | "text";
  autocomplete?: string;
  placeholder?: string;
  maxlength?: number;
  disabled?: boolean;
  error?: string;
  testId?: string;
}>(), {
  kind: "text",
  autocomplete: "off",
  placeholder: "",
  maxlength: 320,
  disabled: false,
  error: "",
  testId: "",
});

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
  (event: "submit"): void;
}>();

const revealed = ref(false);
const nativeType = computed(() => (
  props.kind === "password" && !revealed.value ? "password" : "text"
));

function onInput(event: Event | { detail?: { value?: string } }): void {
  const detailValue = "detail" in event ? event.detail?.value : undefined;
  const targetValue = "target" in event
    ? (event.target as HTMLInputElement | null)?.value
    : undefined;
  emit("update:modelValue", detailValue ?? targetValue ?? "");
}
</script>

<style scoped>
.vc-auth-field {
  display: grid;
  gap: var(--vc-space-2);
  min-width: 0;
}

.vc-auth-field__label {
  color: var(--vc-color-ink);
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}

.vc-auth-field__control {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  min-width: 0;
  min-height: 48px;
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface);
  transition: border-color 140ms ease-out, box-shadow 140ms ease-out;
}

.vc-auth-field__control:focus-within {
  border-color: var(--vc-color-primary);
  box-shadow: 0 0 0 2px var(--vc-color-focus-ring);
}

.vc-auth-field__input {
  flex: 1 1 auto;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 0 var(--vc-space-3);
  border: 0;
  outline: 0;
  color: var(--vc-color-ink);
  background: transparent;
  font-family: var(--vc-font);
  font-size: 16px;
  line-height: 24px;
  caret-color: var(--vc-color-primary);
}

.vc-auth-field__input::placeholder {
  color: var(--vc-color-ink-muted);
  opacity: 1;
}

.vc-auth-field__toggle {
  flex: 0 0 auto;
  min-width: 52px;
  min-height: 44px;
  margin: 0 var(--vc-space-1) 0 0;
  padding: 0 var(--vc-space-2);
  border: 0;
  border-radius: var(--vc-radius-control);
  color: var(--vc-color-primary);
  background: transparent;
  font-size: 14px;
  line-height: 22px;
}

.vc-auth-field__toggle::after {
  border: 0;
}

.vc-auth-field__toggle:active {
  background: var(--vc-color-surface-soft);
}

.vc-auth-field__error {
  color: var(--vc-color-error);
  font-size: 14px;
  line-height: 22px;
}
</style>
