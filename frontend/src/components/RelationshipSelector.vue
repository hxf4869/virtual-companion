<template>
  <view class="rel-selector" data-testid="relationship-selector">
    <view v-if="status === 'error'" class="rel-error" role="alert">
      <text>关系加载失败，请重试</text>
    </view>

    <view class="rel-row">
      <select
        data-testid="relationship-select"
        class="rel-select"
        :value="currentId ?? ''"
        :disabled="busy || relationships.length === 0"
        :aria-busy="status === 'loading'"
        aria-label="选择关系"
        @change="onSelect"
      >
        <option value="" disabled>选择关系…</option>
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
      <text>{{ emptyRelationshipsText }}</text>
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
import { PERSONA_OPTIONS, personaDisplayName } from "@/domain/persona";
import type { RelationshipStatus } from "@/stores/relationship";

export default defineComponent({
  name: "RelationshipSelector",
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
  },
  emits: {
    activate: (id: string) => typeof id === "string",
    create: (personaRef: string) => typeof personaRef === "string",
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
        ? "还没有关系。请先新建一条陪伴关系。"
        : "还没有关系。请到离线聊天新建。",
    );

    function onSelect(event: Event): void {
      const value = (event.target as HTMLSelectElement).value;
      if (value) {
        emit("activate", value);
      }
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
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border);
  border-radius: var(--vc-radius-m);
  margin-bottom: var(--vc-space-4);
  background: var(--vc-card);
  color: var(--vc-ink);
}
.rel-error {
  padding: var(--vc-space-3);
  background: var(--vc-danger-bg);
  color: var(--vc-danger);
  border-radius: var(--vc-radius-s);
  margin-bottom: var(--vc-space-3);
}
.rel-row {
  margin-bottom: var(--vc-space-3);
}
.rel-select {
  width: 100%;
  min-height: 44px;
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  border: 1px solid var(--vc-border-strong);
  background-color: var(--vc-sunken);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-md);
}
.rel-create {
  display: flex;
  align-items: center;
  gap: var(--vc-space-3);
}
.rel-input {
  flex: 1;
  min-height: 44px;
  padding: var(--vc-space-2) var(--vc-space-3);
  border-radius: var(--vc-radius-s);
  border: 1px solid var(--vc-border-strong);
  background-color: var(--vc-sunken);
  color: var(--vc-ink);
  font: inherit;
  font-size: var(--vc-text-md);
}
.rel-create-btn {
  min-height: 44px;
  padding: 0 var(--vc-space-4);
  border-radius: var(--vc-radius-s);
  background-color: var(--vc-primary);
  color: var(--vc-on-primary);
  font-weight: 600;
}
.rel-create-btn::after {
  border: 0;
}
.rel-create-btn:not([disabled]):active {
  background-color: var(--vc-primary-hover);
}
.rel-status {
  font-size: var(--vc-text-sm);
  color: var(--vc-muted);
  margin-top: var(--vc-space-3);
}
.rel-empty {
  font-size: var(--vc-text-sm);
  color: var(--vc-muted);
  margin-top: var(--vc-space-3);
}
</style>
