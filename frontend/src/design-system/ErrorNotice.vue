<template>
  <view class="error-notice" role="alert" data-testid="async-error">
    <text class="error-notice__message">{{ message }}</text>
    <text
      v-if="requestIdCopy"
      class="error-notice__request-id"
      data-testid="async-request-id"
    >
      {{ requestIdCopy }}
    </text>
    <text v-if="stale" class="error-notice__stale" data-testid="async-stale">
      以上内容可能不是最新结果。
    </text>
  </view>
</template>

<script lang="ts">
import { computed, defineComponent } from "vue";

import { requestIdLabel } from "@/domain/request-id";

export default defineComponent({
  name: "ErrorNotice",
  props: {
    message: { type: String, required: true },
    requestId: { type: String, default: undefined },
    stale: { type: Boolean, default: false },
  },
  setup(props) {
    const requestIdCopy = computed(() => requestIdLabel(props.requestId));
    return { requestIdCopy };
  },
});
</script>

<style scoped>
.error-notice {
  display: grid;
  gap: var(--vc-space-1);
  padding: var(--vc-space-3) var(--vc-space-4);
  border-radius: var(--vc-radius-m);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
}

.error-notice__message {
  font-weight: 600;
}

.error-notice__request-id,
.error-notice__stale {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  overflow-wrap: anywhere;
}
</style>
