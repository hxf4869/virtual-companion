<!-- P1（round4）：聊天页的条件系统行集合（服务状态 / 连续使用提醒 /
     无痕说明 / 记忆导入提示 / 当前关系）。它们是低频信息与操作，统一作为
     滚动内容的头部上下文区渲染：可达、按钮 ≥44px，但绝不占用 history 之外
     的固定高度——这是 812×375 横屏在叠加多个条件行时不裁切的结构前提。
     平实呈现是产品硬规则（SVC-MODE / USAGE-HEALTH / INC-MODE / §20.14）：
     这些行永远是系统层事实，不会被写进角色口吻。 -->
<template>
  <view class="context-head">
    <view v-if="serviceModeSummary" class="context-card" data-testid="service-mode" role="status">
      <text>服务状态：{{ serviceModeSummary }}</text>
    </view>

    <view
      v-if="reminderDue"
      class="context-card context-card--warning"
      data-testid="usage-health-banner"
      role="status"
    >
      <text data-testid="usage-health-copy">
        你已连续使用 {{ continuousMinutes }} 分钟。这是系统提醒，不是角色在说话。
        可以结束今天的对话，或继续使用。
      </text>
      <view class="context-actions">
        <button
          data-testid="usage-health-continue"
          class="context-btn"
          :disabled="reminderBusy"
          @click="$emit('usage-continue')"
        >
          继续使用
        </button>
        <button
          data-testid="usage-health-end"
          class="context-btn context-btn--danger"
          :disabled="reminderBusy || !endTodayAvailable"
          @click="$emit('usage-end')"
        >
          结束今天的对话
        </button>
      </view>
    </view>

    <view
      v-if="activeIncognito"
      class="context-card"
      data-testid="incognito-notice"
      role="status"
    >
      <text>当前为无痕会话：不会产生长期记忆候选；必要的安全与法定记录仍会保留。</text>
    </view>

    <view
      v-if="importCount > 0"
      class="context-card"
      data-testid="memory-import-prompt"
      role="status"
    >
      <text>有 {{ importCount }} 条已确认记忆可导入到当前角色。默认不会自动带上。</text>
      <view class="context-actions">
        <button
          data-testid="memory-import-confirm"
          class="context-btn"
          @click="$emit('import-confirm')"
        >
          导入这些记忆
        </button>
        <button
          data-testid="memory-import-discard"
          class="context-btn"
          @click="$emit('import-discard')"
        >
          不要导入
        </button>
      </view>
    </view>

    <template v-if="relationshipText">
      <view
        v-if="relationshipError"
        class="context-card"
        data-testid="relationship-load-error"
        role="status"
      >
        <text>{{ relationshipText }}</text>
      </view>
      <view v-else class="context-card" data-testid="current-relationship" role="status">
        <text>{{ relationshipText }}</text>
        <button
          v-if="deactivateVisible"
          data-testid="deactivate-relationship"
          class="context-btn context-btn--danger"
          :aria-busy="confirmDeactivate"
          @click="$emit('deactivate')"
        >
          {{ confirmDeactivate ? "确认解除？" : "解除关系" }}
        </button>
      </view>
    </template>
  </view>
</template>

<script lang="ts">
export default {
  name: "ChatContextHead",
  props: {
    serviceModeSummary: { type: String, default: "" },
    reminderDue: { type: Boolean, default: false },
    continuousMinutes: { type: Number, default: 0 },
    reminderBusy: { type: Boolean, default: false },
    endTodayAvailable: { type: Boolean, default: false },
    activeIncognito: { type: Boolean, default: false },
    importCount: { type: Number, default: 0 },
    relationshipText: { type: String, default: "" },
    relationshipError: { type: Boolean, default: false },
    deactivateVisible: { type: Boolean, default: false },
    confirmDeactivate: { type: Boolean, default: false },
  },
  emits: [
    "usage-continue",
    "usage-end",
    "import-confirm",
    "import-discard",
    "deactivate",
  ],
};
</script>

<style scoped>
.context-head {
  display: flex;
  flex-direction: column;
  width: 100%;
}

/* 与尾部状态行同一张卡：宽度即滚动内容宽，随消息滚动，永不停在固定栏后。 */
.context-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  box-sizing: border-box;
  width: 100%;
  margin: var(--vc-space-2) 0 0;
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
  border: 1px solid var(--vc-border);
  color: var(--vc-ink);
  font-size: var(--vc-text-sm);
}

.context-card--warning {
  border-color: var(--vc-warning);
  background: var(--vc-warning-bg);
}

.context-actions {
  display: flex;
  gap: var(--vc-space-2);
  margin-left: auto;
}

.context-btn {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.context-btn::after {
  border: 0;
}

.context-btn--danger {
  border-color: var(--vc-danger);
  color: var(--vc-danger);
}

/* 短视口（≤480px 高）：与页内其它状态行同步压缩留白，但按钮仍 ≥44px。 */
@media (max-height: 480px) {
  .context-card {
    margin-top: var(--vc-space-1);
    padding: var(--vc-space-1) var(--vc-space-2);
    font-size: var(--vc-text-xs);
  }
}
</style>
