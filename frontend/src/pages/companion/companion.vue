<!-- COMP-CFG (FR-COMP-003): structured Companion preferences. Catalog codes
only; names are labels, never a free-form prompt. Alpha stores the reminder
flag but does not push. -->
<template>
  <view class="companion-page">
    <view class="bar">
      <text class="title">角色设置</text>
      <button
        data-testid="nav-chat"
        class="nav-index"
        aria-label="离线聊天"
        @click="goTo('/pages/chat/chat')"
      >
        离线聊天
      </button>
      <button
        data-testid="nav-index"
        class="nav-index"
        aria-label="返回边界台"
        @click="goTo('/pages/index/index')"
      >
        返回边界台
      </button>
    </view>

    <view class="intro">
      <text>
        这些是结构化配置，会翻译成经过批准的回复偏好，不会把自由文本拼进 Prompt。
        「允许提醒」仅表示你愿意创建结构化提醒；Technical Alpha 不会主动推送。
      </text>
    </view>

    <RelationshipSelector
      :relationships="relStore.relationships"
      :current-id="relStore.currentRelationshipId"
      :status="relStore.status"
      :busy="relStore.status === 'loading'"
      :show-create="false"
      @activate="onPickRelationship"
    />

    <view v-if="actionError" class="error" data-testid="companion-action-failed" role="alert">
      <text>{{ actionError }}</text>
    </view>

    <template v-if="relStore.current">
      <view class="form">
        <text class="label">角色昵称</text>
        <input
          v-model="companionName"
          class="input"
          data-testid="companion-name"
          maxlength="32"
          placeholder="可选，最多 32 字"
          aria-label="角色昵称"
          :disabled="busy"
        />
        <text class="label">希望被如何称呼</text>
        <input
          v-model="userAddressAs"
          class="input"
          data-testid="companion-address"
          maxlength="32"
          placeholder="可选，最多 32 字"
          aria-label="希望被如何称呼"
          :disabled="busy"
        />
        <text class="label">回复长度</text>
        <select v-model="replyLength" class="select" data-testid="companion-reply-length" :disabled="busy">
          <option value="SHORT">简短</option>
          <option value="MEDIUM">适中</option>
          <option value="LONG">较长</option>
        </select>
        <text class="label">主动程度</text>
        <select v-model="initiative" class="select" data-testid="companion-initiative" :disabled="busy">
          <option value="LOW">先听你说</option>
          <option value="MEDIUM">偶尔提议</option>
          <option value="HIGH">可以主动开启话题</option>
        </select>
        <text class="label">幽默程度</text>
        <select v-model="humor" class="select" data-testid="companion-humor" :disabled="busy">
          <option value="NONE">不开玩笑</option>
          <option value="LIGHT">轻度温暖</option>
          <option value="WARM">温和幽默</option>
        </select>
        <text class="label">建议偏好</text>
        <select v-model="advicePref" class="select" data-testid="companion-advice" :disabled="busy">
          <option value="ASK_FIRST">建议前先询问</option>
          <option value="DIRECT">可以给直接建议</option>
          <option value="RARE">尽量少给建议</option>
        </select>
        <text class="label">记忆共享范围</text>
        <select
          v-model="memoryShareScope"
          class="select"
          data-testid="companion-memory-scope"
          :disabled="busy"
        >
          <option value="RELATIONSHIP">本关系的长期记忆</option>
          <option value="SESSION">仅当前会话记忆</option>
        </select>
        <label class="check">
          <checkbox
            data-testid="companion-reminders"
            :checked="remindersAllowed"
            :disabled="busy"
            @change="onRemindersChange"
          />
          <text>允许创建结构化提醒（Alpha 不推送）</text>
        </label>
        <text class="label">不希望主动涉及的话题</text>
        <view class="topics">
          <label v-for="topic in AVOID_OPTIONS" :key="topic.code" class="check">
            <checkbox
              :data-testid="`companion-topic-${topic.code}`"
              :checked="avoidTopics.includes(topic.code)"
              :disabled="busy"
              @change="onTopicChange(topic.code, $event)"
            />
            <text>{{ topic.label }}</text>
          </label>
        </view>
        <button
          data-testid="companion-save"
          class="nav-index save-btn"
          :disabled="busy"
          @click="onSave"
        >
          保存设置
        </button>
        <text v-if="saved" class="saved" data-testid="companion-saved">已保存</text>
      </view>
    </template>
    <view v-else class="empty" data-testid="companion-no-rel">
      <text>请先选择一个关系。</text>
    </view>
  </view>
</template>

<script lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import {
  DEFAULT_COMPANION_PREFS,
  type CompanionAdvicePref,
  type CompanionAvoidTopic,
  type CompanionHumor,
  type CompanionInitiative,
  type CompanionMemoryShare,
  type CompanionReplyLength,
  type Relationship,
} from "@/api/relationship";
import { createAuthenticatedTransport } from "@/api/transport";
import RelationshipSelector from "@/components/RelationshipSelector.vue";
import { useAuthStore } from "@/stores/auth";
import { useRelationshipStore } from "@/stores/relationship";

const AVOID_OPTIONS: { code: CompanionAvoidTopic; label: string }[] = [
  { code: "WORK", label: "工作压力" },
  { code: "FAMILY", label: "家庭矛盾" },
  { code: "HEALTH", label: "健康" },
  { code: "ROMANCE", label: "感情" },
  { code: "MONEY", label: "金钱" },
  { code: "POLITICS", label: "政治" },
  { code: "SUBSTANCE", label: "物质使用" },
  { code: "RELIGION", label: "宗教" },
];

export default {
  name: "CompanionPage",
  components: { RelationshipSelector },
  setup() {
    const auth = useAuthStore();
    const relStore = useRelationshipStore();
    const actionError = ref<string | null>(null);
    const saved = ref(false);
    const companionName = ref("");
    const userAddressAs = ref("");
    const replyLength = ref<CompanionReplyLength>(DEFAULT_COMPANION_PREFS.replyLength);
    const initiative = ref<CompanionInitiative>(DEFAULT_COMPANION_PREFS.initiative);
    const humor = ref<CompanionHumor>(DEFAULT_COMPANION_PREFS.humor);
    const advicePref = ref<CompanionAdvicePref>(DEFAULT_COMPANION_PREFS.advicePref);
    const remindersAllowed = ref(false);
    const memoryShareScope = ref<CompanionMemoryShare>(DEFAULT_COMPANION_PREFS.memoryShareScope);
    const avoidTopics = ref<CompanionAvoidTopic[]>([]);

    function applyRelationship(rel: Relationship | null): void {
      companionName.value = rel?.companionName ?? "";
      userAddressAs.value = rel?.userAddressAs ?? "";
      replyLength.value = rel?.replyLength ?? DEFAULT_COMPANION_PREFS.replyLength;
      initiative.value = rel?.initiative ?? DEFAULT_COMPANION_PREFS.initiative;
      humor.value = rel?.humor ?? DEFAULT_COMPANION_PREFS.humor;
      advicePref.value = rel?.advicePref ?? DEFAULT_COMPANION_PREFS.advicePref;
      remindersAllowed.value = rel?.remindersAllowed === true;
      memoryShareScope.value = rel?.memoryShareScope ?? DEFAULT_COMPANION_PREFS.memoryShareScope;
      avoidTopics.value = [...(rel?.avoidTopics ?? [])];
    }

    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    const busy = computed(() => relStore.status === "loading");

    watch(
      () => relStore.current,
      (current) => {
        applyRelationship(current);
        saved.value = false;
      },
      { immediate: true },
    );

    async function onPickRelationship(relationshipId: string): Promise<void> {
      actionError.value = null;
      await relStore.activate(transport, relationshipId);
    }

    function onRemindersChange(event: { detail?: { value?: boolean } }): void {
      remindersAllowed.value = event.detail?.value === true;
    }

    function onTopicChange(
      code: CompanionAvoidTopic,
      event: { detail?: { value?: boolean } },
    ): void {
      const checked = event.detail?.value === true;
      if (checked && !avoidTopics.value.includes(code)) {
        avoidTopics.value = [...avoidTopics.value, code];
      } else if (!checked) {
        avoidTopics.value = avoidTopics.value.filter((item) => item !== code);
      }
    }

    async function onSave(): Promise<void> {
      const id = relStore.currentRelationshipId;
      if (!id) return;
      actionError.value = null;
      saved.value = false;
      const result = await relStore.updatePrefs(transport, id, {
        companionName: companionName.value.trim() || null,
        userAddressAs: userAddressAs.value.trim() || null,
        replyLength: replyLength.value,
        initiative: initiative.value,
        humor: humor.value,
        advicePref: advicePref.value,
        remindersAllowed: remindersAllowed.value,
        memoryShareScope: memoryShareScope.value,
        avoidTopics: [...avoidTopics.value],
      });
      if (result) {
        saved.value = true;
      } else {
        actionError.value = "保存失败，请重试。";
      }
    }

    function goTo(url: string): void {
      try {
        const uniApi = (globalThis as Record<string, unknown>).uni as
          | { navigateTo?: (options: { url: string }) => void }
          | undefined;
        if (uniApi?.navigateTo) {
          uniApi.navigateTo({ url });
        } else if (typeof location !== "undefined") {
          location.href = url;
        }
      } catch {
        // Presentation-only navigation.
      }
    }

    onMounted(() => {
      void relStore.load(transport);
    });

    return {
      relStore,
      companionName,
      userAddressAs,
      replyLength,
      initiative,
      humor,
      advicePref,
      remindersAllowed,
      memoryShareScope,
      avoidTopics,
      AVOID_OPTIONS,
      actionError,
      saved,
      busy,
      onPickRelationship,
      onRemindersChange,
      onTopicChange,
      onSave,
      goTo,
    };
  },
};
</script>

<style scoped>
.companion-page {
  padding: 24rpx;
  background-color: #14213d;
  color: #f5f5f5;
  min-height: 100vh;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 16rpx;
}
.title {
  font-size: 32rpx;
  font-weight: 600;
  margin-right: auto;
}
.nav-index {
  flex: 0 0 auto;
  background-color: #2a3a5a;
  color: #ffffff;
  font-size: 24rpx;
}
.intro,
.empty {
  margin: 16rpx 0;
  font-size: 24rpx;
  color: #8fa0bd;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-top: 16rpx;
}
.label {
  font-size: 24rpx;
  color: #8fa0bd;
}
.input,
.select {
  padding: 12rpx 16rpx;
  border-radius: 12rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #1c2b4a;
  color: #f5f5f5;
  font-size: 26rpx;
}
.topics {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}
.check {
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 24rpx;
}
.save-btn {
  margin-top: 12rpx;
}
.saved {
  font-size: 24rpx;
  color: #8fd18f;
}
.error {
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background-color: #5a1a1a;
  font-size: 24rpx;
}
</style>
