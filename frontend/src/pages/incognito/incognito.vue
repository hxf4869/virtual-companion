<!-- INC-PREF (FR-CHAT-005): dedicated incognito settings. Creation-time flag
stays frozen on the conversation. This page only sets the default for the
next new conversation and states that 无痕 ≠ 无必要安全记录. -->
<template>
  <ConsumerShell route="/pages/incognito/incognito">



    <view class="intro" data-testid="incognito-intro">
      <text>
        无痕必须在进入新会话前明确开启。无痕会话不产生长期记忆候选，结束后会清掉
        已落库的消息正文；必要的安全与法定记录仍会保留。无痕不等于完全不产生必要
        安全记录。已有会话的无痕标志创建后不能事后翻转。
      </text>
    </view>

    <view v-if="store.loadFailed" class="error" data-testid="incognito-load-failed" role="alert">
      <text>无痕默认设置加载失败，请重试。</text>
      <button data-testid="incognito-retry" class="nav-index" :disabled="store.busy" @click="onRetry">
        重试
      </button>
    </view>

    <template v-if="!store.loadFailed">
      <view class="state-card" data-testid="incognito-status">
        <text class="label">下次新会话</text>
        <text class="state" data-testid="incognito-label">{{ store.label }}</text>
      </view>
      <button
        data-testid="incognito-default-toggle"
        class="nav-index"
        :class="{ on: store.defaultIncognito }"
        :aria-pressed="store.defaultIncognito"
        :disabled="store.busy"
        @click="onToggle"
      >
        {{ store.defaultIncognito ? "关闭默认无痕" : "开启默认无痕" }}
      </button>
      <view v-if="saveFailed" class="error" data-testid="incognito-save-failed" role="alert">
        <text>保存失败，无痕默认设置未改变，请重试。</text>
      </view>
    </template>
  </ConsumerShell>
</template>

<script lang="ts">
import { onMounted, ref } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { goTo } from "@/app/navigate";
import { useAuthStore } from "@/stores/auth";
import { useIncognitoStore } from "@/stores/incognito";

export default {
  name: "IncognitoPage",
  components: { ConsumerShell },
  setup() {
    const auth = useAuthStore();
    const store = useIncognitoStore();
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      await store.load(transport);
    });

    async function onRetry(): Promise<void> {
      await store.load(transport);
    }

    const saveFailed = ref(false);

    async function onToggle(): Promise<void> {
      saveFailed.value = false;
      const saved = await store.save(transport, !store.defaultIncognito);
      saveFailed.value = !saved;
    }


    return { store, saveFailed, onRetry, onToggle, goTo };
  },
};
</script>

<style scoped>
.intro {
  margin: 0 0 var(--vc-space-4);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  line-height: 1.75;
}

.section {
  margin-bottom: var(--vc-space-7);
}

.section-title {
  display: block;
  margin-bottom: var(--vc-space-2);
  font-size: var(--vc-text-md);
  font-weight: 600;
}

.section-subtitle {
  display: block;
  margin: var(--vc-space-2) 0 var(--vc-space-1);
  font-size: var(--vc-text-sm);
  font-weight: 600;
  color: var(--vc-muted);
}

.label {
  display: block;
  margin: var(--vc-space-3) 0 var(--vc-space-1);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.meta {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}

.row {
  display: block;
  margin-bottom: var(--vc-space-2);
  font-size: var(--vc-text-sm);
  line-height: 1.7;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-3);
}

.nav-index {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-card);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.nav-index::after {
  border: 0;
}

.page-act {
  min-height: 40px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-env);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-on-env);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.page-act::after {
  border: 0;
}

.error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-2);
  margin: var(--vc-space-3) 0;
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 1px solid var(--vc-danger);
  border-radius: var(--vc-radius-m);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
}

.empty {
  display: block;
  margin: var(--vc-space-3) 0;
  padding: var(--vc-space-4);
  border: 1px dashed var(--vc-border-strong);
  border-radius: var(--vc-radius-m);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-1);
  margin-bottom: var(--vc-space-4);
  padding: var(--vc-space-4);
  border-top: 1px solid var(--vc-border);
  border-bottom: 1px solid var(--vc-border);
  border-radius: 0;
  background: var(--vc-card);
  font-size: var(--vc-text-sm);
}

.input,
.reminder-input,
.export-input,
.account-input,
.note-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-ink);
  font-size: 16px;
}
.state {
  color: var(--vc-success);
  font-size: var(--vc-text-xl);
  font-weight: 700;
}
</style>
