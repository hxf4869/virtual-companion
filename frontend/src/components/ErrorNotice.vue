<template>
  <view class="error-notice" role="alert" data-testid="async-error">
    <text>{{ message }}</text>
    <text v-if="requestIdCopy" data-testid="async-request-id">{{ requestIdCopy }}</text>
    <text v-if="stale" data-testid="async-stale">以上内容可能不是最新结果。</text>
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
