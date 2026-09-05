<template>
  <checkbox-group class="vc-trust-device" @change="onChange">
    <label class="vc-trust-device__label">
      <checkbox
        class="vc-trust-device__checkbox"
        value="trusted"
        :checked="modelValue"
        :disabled="disabled"
        color="var(--vc-color-primary)"
      />
      <text>信任此设备 90 天</text>
    </label>
  </checkbox-group>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: boolean;
  disabled?: boolean;
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
}>();

function onChange(event: { detail?: { value?: string[] } }): void {
  emit("update:modelValue", event.detail?.value?.includes("trusted") === true);
}
</script>

<style scoped>
.vc-trust-device {
  display: block;
  min-width: 0;
}

.vc-trust-device__label {
  display: inline-flex;
  align-items: center;
  gap: var(--vc-space-2);
  min-height: 44px;
  color: var(--vc-color-ink);
  font-size: 14px;
  line-height: 22px;
}

.vc-trust-device__checkbox {
  transform: scale(0.84);
  transform-origin: center;
}
</style>
