<template>
  <view
    class="vc-message"
    :class="`vc-message--${message.role === 'user' ? 'user' : 'assistant'}`"
    :data-mid="message.messageId"
    data-testid="chat-message"
  >
    <view v-if="message.role !== 'user'" class="vc-message__avatar" aria-hidden="true">
      {{ initial }}
    </view>

    <view class="vc-message__body">
      <view
        v-if="message.role !== 'user'"
        class="vc-message__assistant-copy"
        :data-testid="streaming ? 'draft' : 'assistant-md'"
      >
        <view v-for="(block, blockIndex) in blocks" :key="blockIndex">
          <view v-if="block.kind === 'p'" class="vc-md-paragraph">
            <text
              v-for="(part, partIndex) in block.parts"
              :key="partIndex"
              :class="part.style ? `vc-md-${part.style}` : undefined"
            >{{ part.text }}</text>
            <text v-if="block.truncated" class="vc-md-truncated">回复过长，已截断</text>
          </view>
          <view v-else-if="block.kind === 'code'" class="vc-md-code">
            <text>{{ block.text }}</text>
            <text v-if="block.truncated" class="vc-md-truncated">代码过长，已截断</text>
          </view>
          <view v-else class="vc-md-list">
            <view v-for="(item, itemIndex) in block.items" :key="itemIndex" class="vc-md-list__item">
              <text class="vc-md-list__bullet">•</text>
              <text>
                <text
                  v-for="(part, partIndex) in item"
                  :key="partIndex"
                  :class="part.style ? `vc-md-${part.style}` : undefined"
                >{{ part.text }}</text>
              </text>
            </view>
          </view>
        </view>
      </view>
      <text v-else class="vc-message__user-copy" data-testid="user-message">
        {{ message.content }}
      </text>
      <text v-if="time" class="vc-message__time">{{ time }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from "vue";

import type { Message } from "@/api/chat";
import { parseSafeMarkdown } from "@/domain/safe-markdown";
import { formatConversationActivity } from "@/domain/timestamp";

const props = defineProps<{
  message: Message;
  companionName: string;
  streaming?: boolean;
}>();

const initial = computed(() => props.companionName.trim().slice(0, 1) || "伴");
const blocks = computed(() => parseSafeMarkdown(props.message.content ?? ""));
const time = computed(() => (
  props.streaming ? "" : formatConversationActivity(props.message.createdAt)
));
</script>

<style scoped>
.vc-message {
  display: grid;
  min-width: 0;
}

.vc-message--assistant {
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: start;
  gap: var(--vc-space-3);
}

.vc-message--user {
  justify-items: end;
}

.vc-message__avatar {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-full);
  color: var(--vc-color-primary);
  background: var(--vc-color-surface);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

.vc-message__body {
  display: grid;
  gap: var(--vc-space-1);
  min-width: 0;
  max-width: 100%;
}

.vc-message--user .vc-message__body {
  justify-items: end;
  max-width: 84%;
}

.vc-message__assistant-copy,
.vc-message__user-copy {
  min-width: 0;
  color: var(--vc-color-ink);
  font-size: 16px;
  line-height: 26px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.vc-message__user-copy {
  display: block;
  box-sizing: border-box;
  padding: var(--vc-space-3) var(--vc-space-4);
  border-radius: var(--vc-radius-card) var(--vc-radius-card) 3px var(--vc-radius-card);
  background: var(--vc-color-surface-soft);
  white-space: pre-wrap;
}

.vc-message__time {
  color: var(--vc-color-ink-muted);
  font-size: 11px;
  line-height: 16px;
}

.vc-md-paragraph {
  margin-bottom: var(--vc-space-2);
  white-space: pre-wrap;
}

.vc-md-paragraph:last-child {
  margin-bottom: 0;
}

.vc-md-strong {
  font-weight: 600;
}

.vc-md-em {
  font-style: italic;
}

.vc-md-code {
  display: block;
  box-sizing: border-box;
  max-width: 100%;
  margin: var(--vc-space-2) 0;
  padding: var(--vc-space-3);
  overflow-x: auto;
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 21px;
  white-space: pre-wrap;
}

.vc-md-list {
  display: grid;
  gap: var(--vc-space-1);
  margin: var(--vc-space-2) 0;
}

.vc-md-list__item {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  min-width: 0;
}

.vc-md-list__bullet,
.vc-md-truncated {
  color: var(--vc-color-ink-muted);
}

.vc-md-truncated {
  display: block;
  margin-top: var(--vc-space-2);
  font-size: 12px;
  line-height: 18px;
}
</style>
