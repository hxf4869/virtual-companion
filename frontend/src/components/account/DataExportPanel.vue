<template>
  <view class="data-copy">
    <button
      type="button"
      class="settings-row"
      data-testid="data-copy-toggle"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="settings-row__copy">
        <text class="settings-row__label">聊天与记忆副本</text>
        <text class="settings-row__note">取走当前保留的聊天记录与记忆（JSON）</text>
      </span>
      <AppIcon :name="open ? 'arrow-up' : 'chevron-right'" :size="18" />
    </button>

    <!-- v-show：折叠只是隐藏，副本仍可下载等状态不因折叠而丢失。 -->
    <view v-show="open" class="inline-form" data-testid="data-copy-panel">
      <template v-if="phase === 'form'">
        <text class="form-hint data-copy-intro">
          副本包含当前保留的聊天记录与记忆，JSON 格式，保存到此设备。
        </text>
        <text class="form-label">当前密码</text>
        <input
          v-model="password"
          class="form-input"
          data-testid="data-copy-password"
          type="password"
          autocomplete="current-password"
          aria-label="当前密码"
        />
        <text
          v-if="errorMessage"
          class="form-message"
          data-testid="data-copy-error"
          role="alert"
        >
          {{ errorMessage }}
        </text>
        <button
          type="button"
          class="primary-action primary-action--compact"
          data-testid="data-copy-create"
          :disabled="busy !== null || password.length === 0"
          @click="onCreate"
        >
          {{ busy === "create" ? "申请中…" : "申请副本" }}
        </button>
      </template>

      <template v-else-if="phase === 'pending'">
        <text class="data-copy-state">正在整理你的副本。</text>
        <text
          v-if="errorMessage"
          class="form-message"
          data-testid="data-copy-error"
          role="alert"
        >
          {{ errorMessage }}
        </text>
        <button
          type="button"
          class="secondary-action"
          data-testid="data-copy-progress"
          :disabled="busy !== null"
          @click="onCheckProgress"
        >
          {{ busy === "progress" ? "查看中…" : "查看进度" }}
        </button>
      </template>

      <template v-else-if="phase === 'ready'">
        <!-- handoffDone：一次性链接已交接浏览器，提示转为已发起而非可下载。 -->
        <text class="data-copy-state">
          {{ handoffDone ? "本次下载已发起。" : "副本已整理好，可以下载保存到此设备。" }}
        </text>
        <text
          v-if="infoMessage"
          class="data-copy-note"
          data-testid="data-copy-note"
          role="status"
        >
          {{ infoMessage }}
        </text>
        <text
          v-if="errorMessage"
          class="form-message"
          data-testid="data-copy-error"
          role="alert"
        >
          {{ errorMessage }}
        </text>
        <button
          v-if="linkGone || handoffDone"
          type="button"
          class="secondary-action"
          data-testid="data-copy-reapply"
          @click="onReapply"
        >
          重新申请
        </button>
        <button
          v-else
          type="button"
          class="primary-action primary-action--compact"
          data-testid="data-copy-download"
          :disabled="busy !== null"
          @click="onDownload"
        >
          {{ busy === "download" ? "下载中…" : "下载副本" }}
        </button>
      </template>

      <template v-else>
        <text class="data-copy-state">
          {{ phase === "failed" ? "这次没有整理成功，可以重新申请。" : "下载链接已过期，可以重新申请。" }}
        </text>
        <button
          type="button"
          class="secondary-action"
          data-testid="data-copy-reapply"
          @click="onReapply"
        >
          重新申请
        </button>
      </template>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from "vue";

import {
  DataExportHttpError,
  classifyDataExportCreateError,
  createDataExport,
  downloadDataExport,
  getDataExportStatus,
  type DataExportDownloadFetch,
  type DataExportRequestView,
  type DataExportTransport,
} from "@/api/data-export";
import AppIcon from "@/design-system/AppIcon.vue";

type PanelPhase = "form" | "pending" | "ready" | "failed" | "expired";
type BusyAction = "create" | "progress" | "download";

const props = defineProps<{
  transport: DataExportTransport;
  downloadFetch: DataExportDownloadFetch;
}>();

const open = ref(false);
const phase = ref<PanelPhase>("form");
const password = ref("");
const errorMessage = ref("");
const infoMessage = ref("");
const busy = ref<BusyAction | null>(null);
const request = ref<DataExportRequestView | null>(null);
const linkGone = ref(false);
// 一次性链接已交接给浏览器：此后主动作收敛为“重新申请”，不再复用已消费 URL。
const handoffDone = ref(false);
// 一次性 downloadUrl 与对象 URL 只存组件内存，绝不渲染、不写存储、不进日志。
let downloadUrl = "";
let objectUrl: string | null = null;
// 单一存活守卫：卸载后到达的异步结果一律丢弃，避免回填到下一次挂载。
let alive = true;

onUnmounted(() => {
  alive = false;
  if (objectUrl !== null) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  downloadUrl = "";
  request.value = null;
});

function applyStatus(status: DataExportRequestView["status"]): void {
  linkGone.value = false;
  handoffDone.value = false;
  if (status === "READY") phase.value = "ready";
  else if (status === "FAILED") phase.value = "failed";
  else if (status === "EXPIRED") phase.value = "expired";
  else phase.value = "pending";
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof DataExportHttpError && error.kind === "unauthorized";
}

/** classify 归为 rejected 时才可能走到这里；401 已在调用方排除。 */
function describeCreateError(error: unknown): string {
  if (classifyDataExportCreateError(error) === "rejected") {
    if (error instanceof DataExportHttpError && error.status === 404) {
      return "当前密码不正确，没有创建副本。";
    }
    // 400 可能是请求不合法或已有 PENDING，不得断言精确原因。
    return "这次申请没有被接受：可能已有一份副本在整理中，或这次请求没能提交；可以稍后再查看或重新申请。";
  }
  return "申请没有完成，结果不确定；请稍后再查看或重新申请。";
}

async function onCreate(): Promise<void> {
  if (busy.value !== null || password.value.length === 0) return;
  busy.value = "create";
  errorMessage.value = "";
  infoMessage.value = "";
  const currentPassword = password.value;
  try {
    const created = await createDataExport(props.transport, currentPassword);
    if (!alive) return;
    request.value = created;
    downloadUrl = created.downloadUrl;
    applyStatus(created.status);
  } catch (error) {
    if (!alive || isUnauthorized(error)) return;
    errorMessage.value = describeCreateError(error);
  } finally {
    if (alive) {
      password.value = "";
      busy.value = null;
    }
  }
}

async function onCheckProgress(): Promise<void> {
  if (busy.value !== null || request.value === null) return;
  busy.value = "progress";
  errorMessage.value = "";
  try {
    const view = await getDataExportStatus(props.transport, request.value.exportId);
    if (!alive) return;
    request.value = view;
    applyStatus(view.status);
  } catch (error) {
    if (!alive || isUnauthorized(error)) return;
    errorMessage.value = "进度暂时没有查到，请再试一次。";
  } finally {
    if (alive) busy.value = null;
  }
}

async function onDownload(): Promise<void> {
  if (busy.value !== null || phase.value !== "ready" || downloadUrl === "") return;
  busy.value = "download";
  errorMessage.value = "";
  infoMessage.value = "";
  try {
    const blob = await downloadDataExport(props.downloadFetch, downloadUrl);
    if (!alive) return;
    handOffToBrowser(blob);
    // 一次性链接已消费：立即收口，杜绝对已消费 URL 的第二次 GET。
    downloadUrl = "";
    handoffDone.value = true;
    infoMessage.value = "已交给浏览器下载，请在本设备的下载内容中查看。";
  } catch (error) {
    if (!alive || isUnauthorized(error)) return;
    if (error instanceof DataExportHttpError && error.status === 404) {
      linkGone.value = true;
      errorMessage.value = "下载链接已失效，可以重新申请。";
    } else {
      errorMessage.value = "下载没有完成，结果不确定；链接可能已失效。";
    }
  } finally {
    if (alive) busy.value = null;
  }
}

/** 服务器原始字节经 Blob→对象 URL→a[download] 交给浏览器，不解析重构 JSON。 */
function handOffToBrowser(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  objectUrl = url;
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildDownloadFileName(request.value?.requestedAt);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    if (objectUrl === url) {
      URL.revokeObjectURL(url);
      objectUrl = null;
    }
  }
}

/** 文件名取 requestedAt 本地时间，不含内部 ID。 */
function buildDownloadFileName(requestedAt: string | undefined): string {
  const ms = requestedAt === undefined ? Number.NaN : Date.parse(requestedAt);
  const date = Number.isFinite(ms) ? new Date(ms) : new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `聊天与记忆副本-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

function onReapply(): void {
  phase.value = "form";
  request.value = null;
  downloadUrl = "";
  linkGone.value = false;
  handoffDone.value = false;
  errorMessage.value = "";
  infoMessage.value = "";
  password.value = "";
}
</script>

<style scoped>
/* 复用 account.vue 的 settings-row / inline-form / form-* / primary-action /
   secondary-action 类名与设计令牌；scoped 边界内自带同构样式，不另造主题。 */
.data-copy {
  display: block;
  border-top: 1px solid var(--vc-color-hairline);
}

.settings-row {
  display: flex;
  align-items: center;
  gap: var(--vc-space-3);
  width: 100%;
  min-height: 64px;
  margin: 0;
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--vc-color-ink);
  font: inherit;
}

.settings-row::after,
.primary-action::after,
.secondary-action::after {
  border: 0;
}

.settings-row:active {
  background: var(--vc-color-surface-soft);
}

.settings-row__copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  text-align: left;
}

.settings-row__label {
  color: var(--vc-color-ink);
  font-size: 15px;
  font-weight: 550;
  line-height: 22px;
}

.settings-row__note,
.form-hint,
.data-copy-note {
  color: var(--vc-color-ink-muted);
  font-size: 12px;
  line-height: 18px;
}

.inline-form {
  padding: var(--vc-space-4);
  background: var(--vc-color-surface-soft);
}

.data-copy-intro {
  display: block;
  margin-bottom: var(--vc-space-2);
}

.form-label {
  display: block;
  margin: var(--vc-space-3) 0 var(--vc-space-1);
  color: var(--vc-color-ink);
  font-size: 13px;
  font-weight: 550;
  line-height: 20px;
}

.form-label:first-child {
  margin-top: 0;
}

.form-input {
  width: 100%;
  min-height: 46px;
  padding: 10px var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface);
  color: var(--vc-color-ink);
  font-size: 16px;
}

.form-message {
  display: block;
  margin-top: var(--vc-space-2);
  color: var(--vc-color-error);
  font-size: 13px;
  line-height: 20px;
}

.data-copy-state {
  display: block;
  color: var(--vc-color-ink);
  font-size: 14px;
  line-height: 22px;
}

.data-copy-note {
  display: block;
  margin-top: var(--vc-space-2);
}

.primary-action,
.secondary-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 48px;
  margin: var(--vc-space-4) 0 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid transparent;
  border-radius: var(--vc-radius-control);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
}

.primary-action {
  background: var(--vc-color-primary);
  color: var(--vc-color-surface);
}

.secondary-action {
  background: var(--vc-color-surface);
  border-color: var(--vc-color-hairline);
  color: var(--vc-color-ink);
}

@media (max-width: 340px) {
  .settings-row,
  .inline-form {
    padding-right: var(--vc-space-3);
    padding-left: var(--vc-space-3);
  }
}
</style>
