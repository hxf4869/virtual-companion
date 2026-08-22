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
