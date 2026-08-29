<!-- COMP-CFG (FR-COMP-003) + COMP-PRES (FR-COMP-002): structured Companion
preferences and presentation. Catalog codes only; names are labels, never a
free-form prompt. Gender presentation never changes behavior rules; every
companion stays an adult role; avatars reference only the platform-curated
asset catalog (no photo upload in v1). Alpha stores the reminder flag but
does not push. -->
<template>
  <ConsumerShell route="/pages/companion/companion">



    <view class="intro">
      <text>
        这些是结构化配置，会翻译成经过批准的回复偏好，不会把自由文本拼进 Prompt。
        角色一律为成年人设定；性别只是呈现方式，不改变行为规则；形象仅来自平台
        审核素材，第一版不支持上传照片。「允许提醒」仅表示你愿意创建结构化提醒；
        当前版本不会主动推送。
      </text>
    </view>

    <!-- 统一创建流程：创建只在这里提供；聊天空态与准入下一步都跳转到
         本页，不复制第二套表单。 -->
    <RelationshipSelector
      :relationships="relStore.relationships"
      :current-id="relStore.currentRelationshipId"
      :status="relStore.status"
      :busy="relStore.status === 'loading'"
      @activate="onPickRelationship"
      @create="onRelCreate"
    />

    <view
      v-if="relStore.status === 'ready'"
      class="notice"
      data-testid="current-relationship"
      role="status"
    >
      <text>{{
        relStore.current
          ? `当前关系：${personaDisplayName(relStore.current.personaRef)}`
          : "还没有当前关系。"
      }}</text>
    </view>

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
        <text class="label">性别呈现</text>
        <view class="gender-row">
          <label
            v-for="option in GENDER_OPTIONS"
            :key="option.code"
            class="gender-chip"
            :class="{ selected: gender === option.code }"
          >
            <radio
              :data-testid="`companion-gender-${option.code}`"
              :checked="gender === option.code"
              :disabled="busy"
              @click="onGenderChange(option.code)"
            />
            <text>{{ option.label }}</text>
          </label>
        </view>
        <text class="label">形象（平台审核素材）</text>
        <view class="avatars">
          <label
            v-for="option in AVATAR_OPTIONS"
            :key="option.code"
            class="avatar-tile"
            :class="{ selected: avatarRef === option.code }"
          >
            <radio
              :data-testid="`companion-avatar-${option.code}`"
              :checked="avatarRef === option.code"
              :disabled="busy"
              @click="onAvatarChange(option.code)"
            />
            <view class="avatar-visual" :class="avatarClass(option.code)" aria-hidden="true">
              <text class="avatar-glyph">{{ option.glyph }}</text>
            </view>
            <text class="avatar-name">{{ option.name }}</text>
          </label>
        </view>
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

      <view class="danger-zone" data-testid="companion-danger">
        <text class="danger-title">清除或删除这个角色</text>
        <text class="danger-lead">
          重置只清除这个关系下的会话、记忆和提醒，并保留角色及其设置。
          删除会移除这个角色及上述关系数据。账号级偏好不会被改动。
          退出当前使用不会删除数据。
        </text>
        <view class="danger-actions">
          <button
            data-testid="companion-reset-open"
            class="danger-btn"
            :disabled="busy || dangerBusy"
            @click="onOpenDanger('reset')"
          >
            重置关系数据
          </button>
          <button
            data-testid="companion-delete-open"
            class="danger-btn"
            :disabled="busy || dangerBusy"
            @click="onOpenDanger('delete')"
          >
            删除这个角色
          </button>
        </view>
        <view v-if="dangerKind" class="danger-confirm" data-testid="companion-danger-confirm">
          <text v-if="preview" class="danger-copy" data-testid="companion-clearance-preview">
            将清除 {{ preview.conversationCount }} 个会话、{{ preview.memoryCount }} 条记忆、{{ preview.reminderCount }} 条提醒。
            <template v-if="dangerKind === 'reset'">重置后会保留这个角色及其设置。</template>
            <template v-else>删除后会移除这个角色。</template>
            同模板新建的角色不会带上这些记忆。账号级偏好不会被改动。
          </text>
          <label class="retain-row">
            <input
              type="checkbox"
              data-testid="retain-importable"
              :checked="retainImportable"
              :disabled="dangerBusy"
              @change="onRetainChange"
            />
            <text>保留一份已确认记忆，之后由我决定是否导入（默认不保留）</text>
          </label>
          <view class="danger-actions">
            <button
              data-testid="companion-danger-cancel"
              class="nav-index"
              :disabled="dangerBusy"
              @click="onCancelDanger"
            >
              取消
            </button>
            <button
              v-if="dangerKind === 'reset'"
              data-testid="companion-reset-confirm"
              class="danger-btn"
              :disabled="dangerBusy || !preview"
              @click="onConfirmReset"
            >
              确认重置
            </button>
            <button
              v-if="dangerKind === 'delete'"
              data-testid="companion-delete-confirm"
              class="danger-btn"
              :disabled="dangerBusy || !preview"
              @click="onConfirmDelete"
            >
              确认删除
            </button>
          </view>
        </view>
      </view>
      <view
        v-if="importPreview && importPreview.acceptedCount > 0"
        class="import-prompt"
        data-testid="memory-import-prompt"
        role="status"
      >
        <text>有 {{ importPreview.acceptedCount }} 条已确认记忆可导入到当前角色。默认不会自动带上。</text>
        <view class="danger-actions">
          <button data-testid="memory-import-confirm" class="nav-index" :disabled="dangerBusy" @click="onImportMemories">
            导入这些记忆
          </button>
          <button data-testid="memory-import-discard" class="nav-index" :disabled="dangerBusy" @click="onDiscardImport">
            不要导入
          </button>
        </view>
      </view>
    </template>
    <view v-else class="empty" data-testid="companion-no-rel">
      <text>请先选择一个关系。</text>
    </view>
  </ConsumerShell>
</template>

<script lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import {
  DEFAULT_COMPANION_PREFS,
  type CompanionAdvicePref,
  type CompanionAvatar,
  type CompanionAvoidTopic,
  type CompanionGender,
  type CompanionHumor,
  type CompanionInitiative,
  type CompanionMemoryShare,
  type CompanionReplyLength,
  type MemoryImportPreview,
  type Relationship,
  type RelationshipClearancePreview,
} from "@/api/relationship";
import { COMPANION_AVATAR_OPTIONS } from "@/domain/companion-presentation";
import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { personaDisplayName } from "@/domain/persona";
import { readContextFromLocation, sanitizeRelationshipId } from "@/domain/context-href";
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

const GENDER_OPTIONS: { code: CompanionGender; label: string }[] = [
  { code: "FEMALE", label: "女性" },
  { code: "MALE", label: "男性" },
  { code: "NEUTRAL", label: "中性" },
];

// Platform-curated avatar catalog (FR-COMP-002). Photo upload is never offered.
const AVATAR_OPTIONS = COMPANION_AVATAR_OPTIONS;

export default {
  name: "CompanionPage",
  components: { ConsumerShell, RelationshipSelector },
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
    const gender = ref<CompanionGender>(DEFAULT_COMPANION_PREFS.gender);
    const avatarRef = ref<CompanionAvatar>(DEFAULT_COMPANION_PREFS.avatarRef);
    const dangerKind = ref<"reset" | "delete" | null>(null);
    const preview = ref<RelationshipClearancePreview | null>(null);
    const dangerBusy = ref(false);
    const retainImportable = ref(false);
    const importPreview = ref<MemoryImportPreview | null>(null);

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
      gender.value = rel?.gender ?? DEFAULT_COMPANION_PREFS.gender;
      avatarRef.value = rel?.avatarRef ?? DEFAULT_COMPANION_PREFS.avatarRef;
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
      try {
        await relStore.activate(transport, relationshipId);
      } catch {
        actionError.value = "切换伙伴失败，请重试。";
      }
    }

    async function onRelCreate(personaRef: string): Promise<void> {
      actionError.value = null;
      try {
        const created = await relStore.create(transport, personaRef);
        if (!created) {
          actionError.value = "创建失败，请重试。";
        }
      } catch {
        actionError.value = "创建失败，请重试。";
      }
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

    function onGenderChange(code: CompanionGender): void {
      gender.value = code;
      // Curated avatar catalog ships one default asset per gender; keep the
      // selection in sync unless the user overrides it afterwards.
      if (code === "FEMALE") {
        avatarRef.value = "AVATAR_FEMALE_01";
      } else if (code === "MALE") {
        avatarRef.value = "AVATAR_MALE_01";
      } else {
        avatarRef.value = "AVATAR_NEUTRAL_01";
      }
    }

    function onAvatarChange(code: CompanionAvatar): void {
      avatarRef.value = code;
    }

    function avatarClass(code: CompanionAvatar): string {
      const option = AVATAR_OPTIONS.find((item) => item.code === code);
      return option ? `avatar-${option.theme}` : "avatar-gold";
    }

    async function onOpenDanger(kind: "reset" | "delete"): Promise<void> {
      const id = relStore.currentRelationshipId;
      if (!id) return;
      actionError.value = null;
      dangerKind.value = kind;
      preview.value = null;
      dangerBusy.value = true;
      try {
        preview.value = await relStore.previewClearance(transport, id);
        if (!preview.value) {
          actionError.value = "无法读取将清除的范围。";
          dangerKind.value = null;
        }
      } catch {
        actionError.value = "无法读取将清除的范围。";
        dangerKind.value = null;
      } finally {
        dangerBusy.value = false;
      }
    }

    function onCancelDanger(): void {
      dangerKind.value = null;
      preview.value = null;
      retainImportable.value = false;
    }

    function onRetainChange(event: Event): void {
      const target = event.target as HTMLInputElement | null;
      retainImportable.value = target?.checked === true;
    }

    async function refreshImportPreview(): Promise<void> {
      const persona = relStore.current?.personaRef;
      if (!persona) {
        importPreview.value = null;
        return;
      }
      try {
        importPreview.value = await relStore.listMemoryImports(transport, persona);
      } catch {
        importPreview.value = null;
      }
    }

    async function onConfirmReset(): Promise<void> {
      const id = relStore.currentRelationshipId;
      if (!id || !preview.value) return;
      actionError.value = null;
      dangerBusy.value = true;
      try {
        const result = await relStore.resetCompanion(transport, id, {
          retainImportable: retainImportable.value,
        });
        if (result) {
          dangerKind.value = null;
          preview.value = null;
          saved.value = false;
          await refreshImportPreview();
          retainImportable.value = false;
        } else {
          actionError.value = "重置失败，请重试。";
        }
      } catch {
        actionError.value = "重置失败，请重试。";
      } finally {
        dangerBusy.value = false;
      }
    }

    async function onConfirmDelete(): Promise<void> {
      const id = relStore.currentRelationshipId;
      if (!id || !preview.value) return;
      actionError.value = null;
      dangerBusy.value = true;
      try {
        const deleted = await relStore.removeCompanion(transport, id, {
          retainImportable: retainImportable.value,
        });
        if (deleted) {
          dangerKind.value = null;
          preview.value = null;
          saved.value = false;
          importPreview.value = null;
          retainImportable.value = false;
        } else {
          actionError.value = "删除失败，请重试。";
        }
      } catch {
        actionError.value = "删除失败，请重试。";
      } finally {
        dangerBusy.value = false;
      }
    }

    async function onImportMemories(): Promise<void> {
      const id = relStore.currentRelationshipId;
      if (!id) return;
      dangerBusy.value = true;
      actionError.value = null;
      try {
        await relStore.importMemories(transport, id);
        importPreview.value = null;
      } catch {
        actionError.value = "导入失败，请重试。";
      } finally {
        dangerBusy.value = false;
      }
    }

    async function onDiscardImport(): Promise<void> {
      const persona = relStore.current?.personaRef;
      if (!persona) return;
      dangerBusy.value = true;
      try {
        await relStore.discardMemoryImport(transport, persona);
        importPreview.value = null;
      } catch {
        actionError.value = "未能取消导入。";
      } finally {
        dangerBusy.value = false;
      }
    }

    async function onSave(): Promise<void> {
      const id = relStore.currentRelationshipId;
      if (!id) return;
      actionError.value = null;
      saved.value = false;
      let result: Awaited<ReturnType<typeof relStore.updatePrefs>>;
      try {
        result = await relStore.updatePrefs(transport, id, {
          companionName: companionName.value.trim() || null,
          userAddressAs: userAddressAs.value.trim() || null,
          replyLength: replyLength.value,
          initiative: initiative.value,
          humor: humor.value,
          advicePref: advicePref.value,
          remindersAllowed: remindersAllowed.value,
          memoryShareScope: memoryShareScope.value,
          avoidTopics: [...avoidTopics.value],
          gender: gender.value,
          avatarRef: avatarRef.value,
        });
      } catch {
        actionError.value = "保存失败，请重试。";
        return;
      }
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

    watch(
      () => relStore.currentRelationshipId,
      () => {
        void refreshImportPreview();
      },
    );

    onMounted(async () => {
      await relStore.load(transport);
      const known = relStore.relationships.map((row) => row.relationshipId);
      const fromQuery =
        typeof location !== "undefined"
          ? sanitizeRelationshipId(readContextFromLocation(location).relationshipId, known)
          : null;
      if (fromQuery) {
        relStore.currentRelationshipId = fromQuery;
      }
      await refreshImportPreview();
    });

    return {
      relStore,
      personaDisplayName,
      companionName,
      userAddressAs,
      replyLength,
      initiative,
      humor,
      advicePref,
      remindersAllowed,
      memoryShareScope,
      avoidTopics,
      gender,
      avatarRef,
      GENDER_OPTIONS,
      AVATAR_OPTIONS,
      AVOID_OPTIONS,
      actionError,
      saved,
      busy,
      dangerKind,
      preview,
      dangerBusy,
      retainImportable,
      importPreview,
      onRetainChange,
      onImportMemories,
      onDiscardImport,
      onOpenDanger,
      onCancelDanger,
      onConfirmReset,
      onConfirmDelete,
      onPickRelationship,
      onRelCreate,
      onRemindersChange,
      onTopicChange,
      onGenderChange,
      onAvatarChange,
      avatarClass,
      onSave,
      goTo,
    };
  },
};
</script>

<style scoped>
/* The Lit Window 语义 token（Phase 5 迁移）。 */
.intro {
  margin: 0 0 var(--vc-space-4);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  line-height: 1.75;
}

.section {
  margin-bottom: var(--vc-space-5);
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
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
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
.primary-btn,
.save-btn,
.submit-btn {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-5);
  border: 0;
  border-radius: var(--vc-radius-s);
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.primary-btn::after,
.save-btn::after,
.submit-btn::after {
  border: 0;
}

.primary-btn[disabled],
.save-btn[disabled],
.submit-btn[disabled] {
  color: var(--vc-muted);
}
.danger-zone {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-6);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-danger);
  border-radius: var(--vc-radius-m);
  background: var(--vc-danger-bg);
}

.danger-title {
  color: var(--vc-danger);
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.danger-lead,
.danger-copy {
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
  line-height: 1.7;
}

.danger-btn {
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-danger);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-danger);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 600;
}

.danger-btn::after {
  border: 0;
}

.danger-confirm {
  display: flex;
  flex-direction: column;
  gap: var(--vc-space-2);
  width: 100%;
}
.form {
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
}

.gender-row,
.topics {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
}

.gender-chip {
  min-height: 40px;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-pill);
  background: transparent;
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-sm);
}

.gender-chip::after {
  border: 0;
}

.gender-chip.selected {
  border: 0;
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font-weight: 600;
}

.avatar-visual {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
}

.avatar-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-m);
  background: var(--vc-sunken);
  color: var(--vc-ink);
  font-size: var(--vc-text-lg);
}

.avatar-tile.selected {
  border: 2px solid var(--vc-primary);
  background: var(--vc-card);
}

.avatar-glyph {
  font-weight: 700;
}

.avatar-name {
  display: block;
  font-size: var(--vc-text-xs);
}

.select {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-border-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-ink);
  font: inherit;
  font-size: 16px;
}

.check {
  display: flex;
  align-items: center;
  gap: var(--vc-space-2);
  margin: var(--vc-space-2) 0;
  font-size: var(--vc-text-sm);
}

.saved {
  display: block;
  margin-top: var(--vc-space-2);
  color: var(--vc-success);
  font-size: var(--vc-text-sm);
}

.import-prompt {
  margin: var(--vc-space-3) 0;
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  background: var(--vc-card);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.retain-row {
  display: flex;
  align-items: center;
  gap: var(--vc-space-2);
  font-size: var(--vc-text-sm);
}

.notice {
  display: block;
  margin: var(--vc-space-2) 0;
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  background: var(--vc-sunken);
  color: var(--vc-muted);
  font-size: var(--vc-text-xs);
}
</style>
