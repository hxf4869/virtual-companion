<template>
  <view class="page">
    <view class="panel">
      <text class="title">开发基线</text>
      <text class="description">
        此页面只读取本地 Runtime 的技术基线，不包含业务或陪伴功能。
      </text>

      <view class="status" :class="`status--${state}`">
        <text>{{ statusText }}</text>
      </view>

      <text
        v-if="state === 'ready'"
        class="payload"
        selectable
      >{{ baselineText }}</text>

      <text v-else-if="state === 'error'" class="error">
        {{ errorMessage }}
      </text>

      <button
        class="reload"
        :disabled="state === 'loading'"
        @click="load"
      >
        {{ state === "loading" ? "读取中…" : "重新读取" }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { storeToRefs } from "pinia";

import { useBaselineStore } from "@/stores/baseline";

const store = useBaselineStore();
const { state, baselineText, errorMessage } = storeToRefs(store);
const { load } = store;

const statusText = computed(() => {
  switch (state.value) {
    case "loading":
      return "正在读取本地开发基线";
    case "ready":
      return "本地开发基线已连接";
    case "error":
      return "本地开发基线不可用";
    default:
      return "等待读取本地开发基线";
  }
});

onMounted(() => {
  void load();
});
</script>

<style scoped>
.page {
  min-height: 100vh;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  background: #f4f6f8;
}

.panel {
  width: min(100%, 1080rpx);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 28rpx;
  padding: 48rpx;
  border: 1px solid #dfe3e8;
  border-radius: 24rpx;
  background: #ffffff;
  box-shadow: 0 20rpx 60rpx rgba(26, 39, 52, 0.08);
}

.title {
  color: #17212b;
  font-size: 48rpx;
  font-weight: 700;
  line-height: 1.2;
}

.description {
  color: #59636e;
  font-size: 28rpx;
  line-height: 1.6;
}

.status {
  align-self: flex-start;
  padding: 12rpx 20rpx;
  border-radius: 999rpx;
  color: #46515c;
  background: #edf0f2;
  font-size: 24rpx;
}

.status--loading {
  color: #775900;
  background: #fff4c2;
}

.status--ready {
  color: #145c37;
  background: #dff5e8;
}

.status--error {
  color: #8b2635;
  background: #fde7ea;
}

.payload {
  overflow-x: auto;
  padding: 28rpx;
  border-radius: 16rpx;
  color: #d8dee9;
  background: #1f2933;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 24rpx;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.error {
  padding: 24rpx;
  border-left: 6rpx solid #b42338;
  color: #7a1f2d;
  background: #fff1f3;
  font-size: 26rpx;
  line-height: 1.6;
}

.reload {
  width: 100%;
  margin: 0;
  border-radius: 14rpx;
  color: #ffffff;
  background: #263746;
  font-size: 28rpx;
}

.reload[disabled] {
  opacity: 0.55;
}
</style>
