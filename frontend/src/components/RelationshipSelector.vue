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
          {{ rel.personaRef }}{{ rel.active ? "（活跃）" : "" }}
        </option>
      </select>
    </view>

    <view v-if="showCreate" class="rel-create">
      <input
        v-model="personaRef"
        class="rel-input"
        data-testid="persona-ref"
        placeholder="persona ref（如 gentle-listener）"
        aria-label="persona ref"
        :disabled="busy"
        @keydown.enter="onCreate"
      />
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
    const personaRef = ref("");

    const canCreate = computed(() => personaRef.value.trim().length > 0);
    const showEmptyRelationships = computed(
      () =>
        props.status !== "loading" &&
        props.status !== "error" &&
        props.relationships.length === 0,
    );
    const emptyRelationshipsText = computed(() =>
      props.showCreate
        ? "还没有关系。请先新建一条陪伴关系。"
        : "还没有关系。",
    );

    function onSelect(event: Event): void {
      const value = (event.target as HTMLSelectElement).value;
      if (value) {
        emit("activate", value);
      }
    }

    function onCreate(): void {
      const trimmed = personaRef.value.trim();
      if (!trimmed) return;
      emit("create", trimmed);
      personaRef.value = "";
    }

    return {
      personaRef,
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
  padding: 24rpx;
  background-color: #1c2b4a;
  border-radius: 12rpx;
  margin-bottom: 24rpx;
}
.rel-error {
  padding: 16rpx;
  background-color: #5a1a1a;
  border-radius: 12rpx;
  margin-bottom: 16rpx;
}
.rel-row {
  margin-bottom: 16rpx;
}
.rel-select {
  width: 100%;
  padding: 16rpx;
  border-radius: 12rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #14213d;
  color: #f5f5f5;
  font-size: 28rpx;
}
.rel-create {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.rel-input {
  flex: 1;
  padding: 16rpx;
  border-radius: 12rpx;
  border: 2rpx solid #2a3a5a;
  background-color: #14213d;
  color: #f5f5f5;
  font-size: 28rpx;
}
.rel-create-btn {
  background-color: #2a6a9a;
  color: #ffffff;
}
.rel-status {
  font-size: 26rpx;
  opacity: 0.85;
  margin-top: 16rpx;
}
.rel-empty {
  font-size: 26rpx;
  opacity: 0.85;
  margin-top: 16rpx;
}
</style>
