<template>
  <view class="rel-selector" data-testid="relationship-selector">
    <view v-if="status === 'error'" class="rel-error" role="alert">
      <text>关系加载失败，请重试</text>
    </view>

    <view v-if="relationships.length > 0" class="rel-row">
      <text class="rel-label">{{ label }}</text>
      <select
        data-testid="relationship-select"
        class="rel-select"
        :value="currentId ?? ''"
        :disabled="busy"
        :aria-busy="status === 'loading'"
        :aria-label="label"
        @change="onSelect"
      >
        <option value="" :disabled="!allOptionLabel">
          {{ allOptionLabel || "选择关系…" }}
        </option>
        <option
          v-for="rel in relationships"
          :key="rel.relationshipId"
          :value="rel.relationshipId"
        >
          {{ personaDisplayName(rel.personaRef) }}{{ rel.active ? "（活跃）" : "" }}
        </option>
      </select>
    </view>

    <view v-if="showCreate" class="rel-create">
      <!-- PERSONA-WIRE: the personaRef is chosen from the catalog, not typed
           free-form, so the backend always receives a known template id. -->
      <select
        v-model="templateId"
        data-testid="persona-select"
        class="rel-input"
        aria-label="选择人设"
        :disabled="busy"
      >
        <option value="" disabled>选择人设…</option>
        <option
          v-for="option in personaOptions"
          :key="option.templateId"
          :value="option.templateId"
        >
          {{ option.displayName }}（{{ option.description }}）
        </option>
      </select>
      <button
        data-testid="create-relationship"
        class="rel-create-btn"
        :disabled="busy || !canCreate"
        @click="onCreate"
      >
        新建关系
      </button>
    </view>

    <view
      v-if="status === 'loading'"
      class="rel-status"
      data-testid="rel-status"
      role="status"
      aria-live="polite"
    >
      <text>正在加载关系…</text>
    </view>

    <view
      v-if="showEmptyRelationships"
      class="rel-empty"
      data-testid="empty-relationships"
      role="status"
    >
      <view class="rel-empty__mark" aria-hidden="true">
        <AppIcon name="sparkle" :size="24" />
      </view>
      <view class="rel-empty__copy">
        <text class="rel-empty__title">还没有陪伴关系</text>
        <text class="rel-empty__body">{{ emptyRelationshipsText }}</text>
      </view>
      <button
        v-if="!showCreate && emptyActionLabel"
        class="rel-empty__action"
        data-testid="empty-relationship-action"
        @click="$emit('request-create')"
      >
        {{ emptyActionLabel }}
        <AppIcon name="chevron-right" :size="18" />
      </button>
    </view>
  </view>
</template>

<script lang="ts">
// TASK-0187: Relationship selector — a pure presentation component that lists
// the owner's relationships, lets the user activate one, or create a new one.
// All data arrives via props; all actions are emitted. The parent (chat.vue)
// owns the relationship store and wires emits to store actions. Native
// <select>/<input>/<button> keep happy-dom rendering reliable for the glue
// spec; no uni-app <picker> dependency.
import { computed, defineComponent, ref, type PropType } from "vue";

import type { Relationship } from "@/api/relationship";
import AppIcon from "@/design-system/AppIcon.vue";
import { PERSONA_OPTIONS, personaDisplayName } from "@/domain/persona";
import type { RelationshipStatus } from "@/stores/relationship";

export default defineComponent({
  name: "RelationshipSelector",
  components: { AppIcon },
  props: {
    relationships: {
      type: Array as PropType<Relationship[]>,
      required: true,
    },
    currentId: {
      type: String as PropType<string | null>,
      default: null,
    },
    status: {
      type: String as PropType<RelationshipStatus>,
      default: "idle",
    },
    busy: {
      type: Boolean,
      default: false,
    },
    showCreate: {
      type: Boolean,
      default: true,
    },
    label: {
      type: String,
      default: "选择关系",
    },
    allOptionLabel: {
      type: String,
      default: "",
    },
    emptyActionLabel: {
      type: String,
      default: "",
    },
  },
  emits: {
    activate: (id: string) => typeof id === "string",
    create: (personaRef: string) => typeof personaRef === "string",
    "request-create": () => true,
  },
  setup(props, { emit }) {
    // PERSONA-WIRE: the selected template id from the catalog directory.
    const templateId = ref("");
    const personaOptions = PERSONA_OPTIONS;

    const canCreate = computed(() => templateId.value.trim().length > 0);
    const showEmptyRelationships = computed(
      () =>
        props.status !== "loading" &&
        props.status !== "error" &&
        props.relationships.length === 0,
    );
    const emptyRelationshipsText = computed(() =>
      props.showCreate
        ? "选择一个人设，创建属于你的陪伴。"
        : "先创建一位陪伴角色，再开始聊天。",
    );

    function onSelect(event: Event): void {
      const value = (event.target as HTMLSelectElement).value;
      emit("activate", value);
    }

    function onCreate(): void {
      const trimmed = templateId.value.trim();
      if (!trimmed) return;
      emit("create", trimmed);
      templateId.value = "";
    }

    return {
      templateId,
      personaOptions,
      personaDisplayName,
      canCreate,
      showEmptyRelationships,
      emptyRelationshipsText,
      onSelect,
      onCreate,
    };
  },
});
</script>

<style scoped>
.rel-selector {
  margin-bottom: var(--vc-space-5);
  color: var(--vc-ink);
}

.rel-error {
  padding: var(--vc-space-3);
  margin-bottom: var(--vc-space-3);
  border: 1px solid var(--vc-danger-border);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
  border-radius: var(--vc-radius-s);
}

.rel-row {
  display: grid;
  gap: var(--vc-space-2);
  padding-bottom: var(--vc-space-4);
  border-bottom: 1px solid var(--vc-border);
}

.rel-label {
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  font-weight: 650;
}

.rel-select {
  width: 100%;
  min-width: 0;
  min-height: 48px;
  padding: 0 var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  border: 1px solid var(--vc-border-strong);
  background-color: var(--vc-card);
  color: var(--vc-ink);
  font: inherit;
  font-size: 16px;
}

.rel-select:disabled {
  opacity: 0.58;
}

.rel-create {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vc-space-3);
  margin-top: var(--vc-space-3);
}

.rel-input {
  /* min-width:0 让 select 能在窄屏收缩；放不下时按钮换到下一行独占。 */
  flex: 1 1 16em;
  min-width: 0;
  min-height: 44px;
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  border: 1px solid var(--vc-border-strong);
  background-color: var(--vc-sunken);
  color: var(--vc-ink);
  font: inherit;
  font-size: 16px;
}
.rel-create-btn {
  flex: none;
  min-height: 44px;
  padding: 0 var(--vc-space-4);
  border-radius: var(--vc-radius-s);
  background-color: var(--vc-primary);
  color: var(--vc-on-primary);
  font-weight: 600;
  white-space: nowrap;
}
.rel-create-btn::after {
  border: 0;
}
.rel-create-btn:not([disabled]):active {
  background-color: var(--vc-primary-hover);
}
.rel-status {
  min-height: 48px;
  display: flex;
  align-items: center;
  padding: 0 var(--vc-space-3);
  border-top: 1px solid var(--vc-border);
  border-bottom: 1px solid var(--vc-border);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
}

.rel-empty {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  gap: var(--vc-space-3);
  padding: var(--vc-space-5);
  border: 1px solid var(--vc-primary-border);
  border-radius: var(--vc-radius-l);
  background: var(--vc-primary-bg);
}

.rel-empty__mark {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 1px solid var(--vc-primary-border);
  border-radius: 50%;
  background: var(--vc-card);
  color: var(--vc-primary);
}

.rel-empty__copy,
.rel-empty__title,
.rel-empty__body {
  display: block;
}

.rel-empty__title {
  color: var(--vc-ink);
  font-size: var(--vc-text-lg);
  font-weight: 720;
}

.rel-empty__body {
  margin-top: var(--vc-space-1);
  color: var(--vc-muted);
  font-size: var(--vc-text-sm);
  line-height: 1.55;
}

.rel-empty__action {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--vc-space-2);
  min-height: 48px;
  margin: var(--vc-space-1) 0 0;
  padding: 0 var(--vc-space-4);
  border: 0;
  border-radius: var(--vc-radius-s);
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font: inherit;
  font-weight: 700;
}

.rel-empty__action::after {
  border: 0;
}

.rel-empty__action:active {
  background: var(--vc-primary-hover);
}

@media (max-width: 360px) {
  .rel-empty {
    grid-template-columns: 40px minmax(0, 1fr);
    gap: var(--vc-space-2);
    padding: var(--vc-space-4);
  }

  .rel-empty__mark {
    width: 40px;
    height: 40px;
  }
}
</style>
