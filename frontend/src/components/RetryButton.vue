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
