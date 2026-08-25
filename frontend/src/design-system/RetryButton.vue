<template>
  <button
    class="retry-button"
    data-testid="async-retry"
    type="button"
    :disabled="disabled"
    @click="$emit('retry')"
  >
    {{ label }}
  </button>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "RetryButton",
  props: {
    label: { type: String, default: "重试" },
    disabled: { type: Boolean, default: false },
  },
  emits: ["retry"],
});
</script>

<style scoped>
.retry-button {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-5);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.retry-button::after {
  border: 0;
}

.retry-button:not([disabled]):active {
  background: var(--vc-sunken);
}
</style>
