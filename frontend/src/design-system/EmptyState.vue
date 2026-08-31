<template>
  <view class="empty-state" role="status" data-testid="async-empty">
    <text>{{ message }}</text>
  </view>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "EmptyState",
  props: {
    message: { type: String, required: true },
  },
});
</script>

<style scoped>
.empty-state {
  padding: var(--vc-space-6) var(--vc-space-2);
  border-top: 1px solid var(--vc-border);
  border-bottom: 1px solid var(--vc-border);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  text-align: center;
}
</style>
