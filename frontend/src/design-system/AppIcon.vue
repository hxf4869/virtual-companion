<template>
  <svg
    class="vc-icon"
    :class="{ 'vc-icon--spin': spin }"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    :style="{ fontSize: `${size}px` }"
    v-html="markup"
  />
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from "vue";

export type AppIconName =
  | "home"
  | "chats"
  | "memory"
  | "me"
  | "back"
  | "chevron-right"
  | "close"
  | "send"
  | "refresh"
  | "more"
  | "warning"
  | "danger"
  | "check"
  | "info"
  | "copy"
  | "trash"
  | "pencil"
  | "clock"
  | "eye-off"
  | "document"
  | "help"
  | "flag"
  | "shield"
  | "gauge"
  | "sparkle"
  | "lock"
  | "plus"
  | "dashboard"
  | "server"
  | "route"
  | "activity"
  | "menu"
  | "logout"
  | "arrow-up"
  | "arrow-down";

const ICON_PATHS: Record<AppIconName, string> = {
  // 首页：房屋
  home: `<path d="M3.5 10.5 12 3.5l8.5 7" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M9.5 20v-6h5v6" />`,
  // 对话：两个交叠的气泡
  chats: `<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v3A2.5 2.5 0 0 1 13.5 12H9l-3.5 3v-3.2A2.5 2.5 0 0 1 4 9.5z" />
    <path d="M16 8.5h1.5A2.5 2.5 0 0 1 20 11v3a2.5 2.5 0 0 1-2 2.45V20l-3.4-2.9H12" />`,
  // 记忆：合上的手账本 + 书签
  memory: `<path d="M6 4h10.5A1.5 1.5 0 0 1 18 5.5v13A1.5 1.5 0 0 1 16.5 20H6z" />
    <path d="M6 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2" />
    <path d="M14 4v5l-2-1.4L10 9V4" />`,
  // 我的：人物
  me: `<circle cx="12" cy="8.2" r="3.4" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />`,
  back: `<path d="M14.5 5.5 8 12l6.5 6.5" />`,
  "chevron-right": `<path d="M9.5 5.5 16 12l-6.5 6.5" />`,
  close: `<path d="M6 6l12 12M18 6 6 18" />`,
  send: `<path d="M4.5 12 20 5l-4.2 15-4-6.2z" />
    <path d="M11.8 13.8 20 5" />`,
  refresh: `<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.8 3.8v3.4h-3.4" />`,
  more: `<circle cx="12" cy="5.5" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12" cy="18.5" r="0.9" fill="currentColor" stroke="none" />`,
  warning: `<path d="M12 4.5 21 19.5H3z" />
    <path d="M12 10v4" />
    <circle cx="12" cy="16.9" r="0.5" fill="currentColor" stroke="none" />`,
  danger: `<circle cx="12" cy="12" r="8" />
    <path d="M12 8v5" />
    <circle cx="12" cy="16.2" r="0.5" fill="currentColor" stroke="none" />`,
  check: `<path d="M5 12.5 10 17.5 19 7" />`,
  info: `<circle cx="12" cy="12" r="8" />
    <path d="M12 11v5" />
    <circle cx="12" cy="8" r="0.5" fill="currentColor" stroke="none" />`,
  copy: `<rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 5.5A2 2 0 0 0 13.5 4h-7a2.5 2.5 0 0 0-2.5 2.5v7A2 2 0 0 0 5.5 15.5" />`,
  trash: `<path d="M5 7h14" />
    <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" />
    <path d="M7 7l1 12a1.5 1.5 0 0 0 1.5 1.4h5A1.5 1.5 0 0 0 16 19l1-12" />
    <path d="M10.5 11v6M13.5 11v6" />`,
  pencil: `<path d="M15.6 5.2l3.2 3.2L9 18.2l-4 1 1-4z" />
    <path d="M14 7l3 3" />`,
  clock: `<circle cx="12" cy="12" r="8" />
    <path d="M12 7.5V12l3 2" />`,
  "eye-off": `<path d="M4 4l16 16" />
    <path d="M10.6 6.3A8.8 8.8 0 0 1 12 6.2c4.6 0 8 4.3 8.7 5.8a15 15 0 0 1-2.6 3.2" />
    <path d="M6.7 8.1A15.4 15.4 0 0 0 3.3 12c.7 1.5 4.1 5.8 8.7 5.8a8.6 8.6 0 0 0 3.4-.7" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />`,
  document: `<path d="M7 3.5h7L18.5 8v11a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" />
    <path d="M13.5 3.5V8H18" />
    <path d="M8.5 12h7M8.5 15.5h7" />`,
  help: `<circle cx="12" cy="12" r="8" />
    <path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.6" />
    <circle cx="12" cy="16.3" r="0.5" fill="currentColor" stroke="none" />`,
  flag: `<path d="M6.5 3.5v17" />
    <path d="M6.5 4.5c4-2 7 2 11 0v8c-4 2-7-2-11 0" />`,
  shield: `<path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.3-7 9-4.1-1.7-7-4.7-7-9V6z" />
    <path d="M9 12l2.2 2.2L15.5 10" />`,
  gauge: `<path d="M4.5 15.5a8 8 0 1 1 15 0" />
    <path d="M12 15.5 16 9.5" />
    <circle cx="12" cy="15.5" r="1.2" />`,
  sparkle: `<path d="M12 4l1.7 4.8L18.5 10.5l-4.8 1.7L12 17l-1.7-4.8L5.5 10.5l4.8-1.7z" />
    <path d="M18 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />`,
  lock: `<rect x="5.5" y="10.5" width="13" height="9" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    <circle cx="12" cy="15" r="0.6" fill="currentColor" stroke="none" />`,
  plus: `<path d="M12 5.5v13M5.5 12h13" />`,
  dashboard: `<rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />`,
  server: `<rect x="4" y="4.5" width="16" height="6" rx="1.5" />
    <rect x="4" y="13.5" width="16" height="6" rx="1.5" />
    <circle cx="7.5" cy="7.5" r=".7" fill="currentColor" stroke="none" />
    <circle cx="7.5" cy="16.5" r=".7" fill="currentColor" stroke="none" />
    <path d="M11 7.5h5.5M11 16.5h5.5" />`,
  route: `<circle cx="6" cy="6" r="2" />
    <circle cx="18" cy="18" r="2" />
    <path d="M8 6h3a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3h-1" />
    <path d="m11.5 12.5 2.5 2.5 2.5-2.5" />`,
  activity: `<path d="M3.5 12h4l2-5 4.5 10 2.3-5h4.2" />`,
  menu: `<path d="M4.5 7h15M4.5 12h15M4.5 17h15" />`,
  logout: `<path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
    <path d="M13 8l4 4-4 4M17 12H9" />`,
  "arrow-up": `<path d="m7 11 5-5 5 5M12 6v12" />`,
  "arrow-down": `<path d="m7 13 5 5 5-5M12 18V6" />`,
};

export default defineComponent({
  name: "AppIcon",
  props: {
    name: {
      type: String as PropType<AppIconName>,
      required: true,
      validator: (value: string) => value in ICON_PATHS,
    },
    size: {
      type: Number as PropType<number>,
      default: 24,
    },
    spin: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const markup = computed(() => ICON_PATHS[props.name] ?? "");
    return { markup };
  },
});
</script>

<style scoped>
.vc-icon {
  display: block;
  width: 1em;
  height: 1em;
  font-size: 24px;
  flex: 0 0 auto;
}

.vc-icon--spin {
  animation: vc-icon-spin 1s linear infinite;
}

@keyframes vc-icon-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
