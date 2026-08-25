<!-- ADMIN-OPS-RO: read-only service status, runtime preflight, compliance,
and announcement. Reuses GET /service-mode、GET /version 与内部基线端点。
Never invents provider health or role-plays an outage. ADMIN only.
Phase 6：Runtime 预检从首页边界台迁入（内部信息只对内部壳呈现）。 -->
<template>
  <InternalShell route="/pages/ops/ops">
    <view v-if="!isAdminRole" class="notice" data-testid="ops-not-allowed" role="status">
      <text>当前账号不是管理员，无法查看运行与合规页。</text>
    </view>

    <template v-else>
      <view class="ops-card" data-testid="ops-mode" role="status">
        <text class="ops-label">服务状态</text>
        <text v-if="modeLine">{{ modeLine }}</text>
        <text v-else-if="modeFailed" class="ops-error">服务状态读取失败，不编造可用状态。</text>
        <text v-else>正在读取服务状态…</text>
      </view>

      <view class="ops-card" data-testid="ops-version" role="status">
        <text class="ops-label">构建版本</text>
        <text v-if="version">{{ version.version }}{{ version.commit ? ` · ${version.commit}` : "" }}</text>
        <text v-else>版本信息不可用。</text>
      </view>

      <!-- Runtime 预检（原首页边界台）：只读内部基线，fail-closed，不缓存。 -->
      <view class="ops-card" data-testid="ops-runtime" role="status">
        <view class="ops-runtime-head">
          <view>
            <text class="ops-label">Runtime 预检</text>
            <text class="ops-title">
              {{ runtimeTitle }}
            </text>
          </view>
          <button
            data-testid="ops-runtime-retry"
            class="ops-btn"
            :disabled="state === 'loading'"
            @click="retryRuntime"
          >
            {{ state === "loading" ? "校验中…" : "重新校验" }}
          </button>
        </view>
        <text v-if="state === 'ready'" class="ops-meta">
          {{ verifiedGateCount }} / 7 项门禁已验证关闭；Phase {{ baselineInfo?.phase }} ·
          Transport {{ baselineInfo?.transport }}
        </text>
        <text v-else-if="state === 'error'" class="ops-error">
          预检失败（{{ errorKind }}）：没有可信读数时全部能力按关闭处理。
        </text>
        <text v-else class="ops-meta">正在读取内部基线…</text>
        <view v-if="state === 'ready'" class="ops-gates">
          <text
            v-for="gate in capabilityGates"
            :key="gate.key"
            class="ops-gate"
            :class="`ops-gate--${gate.state}`"
          >
            {{ gate.label }} · {{ gate.statusLabel }}
          </text>
        </view>
      </view>

      <view class="ops-card" data-testid="ops-compliance">
        <text class="ops-label">合规边界</text>
        <text>
          Technical Alpha 只允许本地与 CI 合成数据，不对真实用户开放，不开放公开注册，
          不启用真实支付。真实 provider 凭据只允许部署配置注入。成年核验、PIA 与值班等
          Beta 前置条件未满足前不得对真实用户上线。
        </text>
      </view>

      <view class="ops-card" data-testid="ops-announce" role="status">
        <text class="ops-label">系统公告</text>
        <text v-if="announce">{{ announce }}</text>
        <text v-else>当前没有额外公告。服务是否可用只看上面的服务状态，不会角色化。</text>
      </view>
    </template>
  </InternalShell>
</template>

<script lang="ts">
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";

import { getServiceMode } from "@/api/chat";
import { createAuthenticatedTransport } from "@/api/transport";
import { fetchVersion, type VersionInfo } from "@/api/version";
import InternalShell from "@/app/InternalShell.vue";
import { useAuthStore } from "@/stores/auth";
import { useBaselineStore } from "@/stores/baseline";

export default {
  name: "OpsPage",
  components: { InternalShell },
  setup() {
    const auth = useAuthStore();
    const version = ref<VersionInfo | null>(null);
    const modeLine = ref("");
    const announce = ref("");
    const modeFailed = ref(false);

    // Runtime 预检：首页不再承载；内部壳独占。
    const baselineStore = useBaselineStore();
    const {
      state,
      verifiedGateCount,
      baseline: baselineInfo,
      errorKind,
      capabilityGates,
    } = storeToRefs(baselineStore);
    const isAdminRole = computed(() => auth.role === "ADMIN");
    const runtimeTitle = computed(() => {
      switch (state.value) {
        case "ready":
          return "Runtime 连接与边界响应已验证";
        case "error":
          return "Runtime 未通过连接预检";
        case "loading":
          return "正在校验 Runtime 响应";
        default:
          return "等待 Runtime 读数";
      }
    });

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    function retryRuntime(): void {
      if (state.value !== "loading") {
        void baselineStore.load();
      }
    }

    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      if (!isAdminRole.value) return;
      void baselineStore.load();
      try {
        const mode = await getServiceMode(transport);
        if (mode) {
          modeLine.value = `${mode.mode} · ${mode.summary}`;
          announce.value = mode.summary;
        }
      } catch {
        modeFailed.value = true;
      }
      try {
        version.value = await fetchVersion(transport);
      } catch {
        version.value = null;
      }
    });

    return {
      auth,
      isAdminRole,
      version,
      modeLine,
      announce,
      modeFailed,
      state,
      verifiedGateCount,
      baselineInfo,
      errorKind,
      capabilityGates,
      runtimeTitle,
      retryRuntime,
    };
  },
};
</script>

<style scoped>
/* 内部壳：同一 token 的中性高密度变体（暮色深底 + 抬升面板）。 */
.notice {
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border-env);
  border-radius: var(--vc-radius-m);
  background: var(--vc-env-raised);
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-sm);
}

.ops-card {
  display: flex;
  flex-direction: column;
  gap: var(--vc-space-1);
  margin-top: var(--vc-space-3);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border-env);
  border-radius: var(--vc-radius-m);
  background: var(--vc-env-raised);
  color: var(--vc-on-env);
  font-size: var(--vc-text-sm);
  line-height: 1.65;
}

.ops-label {
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-xs);
  letter-spacing: 0.04em;
}

.ops-title {
  display: block;
  font-size: var(--vc-text-md);
  font-weight: 650;
  color: var(--vc-on-env);
}

.ops-meta {
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-xs);
}

.ops-error {
  color: var(--vc-danger-on-env);
}

.ops-runtime-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--vc-space-3);
  width: 100%;
}

.ops-btn {
  min-height: 40px;
  flex: 0 0 auto;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-env);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-on-env);
  font: inherit;
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.ops-btn::after {
  border: 0;
}

.ops-gates {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-1);
  margin-top: var(--vc-space-2);
}

.ops-gate {
  padding: 2px 8px;
  border: 1px solid var(--vc-border-env);
  border-radius: 999px;
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-xs);
}

.ops-gate--closed {
  border-color: var(--vc-glow);
  color: var(--vc-glow);
}
</style>
