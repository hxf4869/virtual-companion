<template>
  <!-- 全部会话是聊天域内的二级页，只用于找到并继续过去的对话。 -->
  <ConsumerShell route="/pages/conversations/conversations" ref="shellRef">
    <view class="conversations-page">
      <text class="conversations-page__intro">
        最近聊过的内容都在这里。
      </text>

      <view
        v-if="pageState === 'loading'"
        class="conversations-state conversations-state--loading"
        data-testid="conversations-loading"
        role="status"
      >
        <text class="vc-sr-only">正在加载全部会话</text>
        <view v-for="index in 3" :key="index" class="conversations-skeleton" aria-hidden="true">
          <view class="conversations-skeleton__title" />
          <view class="conversations-skeleton__copy" />
        </view>
      </view>

      <view
        v-else-if="pageState === 'error' || pageState === 'missing'"
        class="conversations-state conversations-state--message"
        data-testid="conversations-load-failed"
        role="alert"
      >
        <text class="conversations-state__title">
          {{ pageState === "missing" ? "你的陪伴还没准备好" : "会话没有加载出来" }}
        </text>
        <text class="conversations-state__copy">
          {{ pageState === "missing" ? "重新加载后，我们会继续为你准备。" : "检查网络后再试一次。" }}
        </text>
        <button
          class="conversations-secondary-action"
          data-testid="conversations-retry"
          :disabled="busy"
          @click="loadInitial"
        >
          重新加载
        </button>
      </view>

      <view
        v-else-if="items.length === 0"
        class="conversations-state conversations-state--empty"
        data-testid="conversations-empty"
        role="status"
      >
        <view class="conversations-empty-mark" aria-hidden="true">
          <AppIcon name="chats" :size="24" />
        </view>
        <text class="conversations-state__title">还没有对话</text>
        <text class="conversations-state__copy">
          想说什么都可以，从第一句话开始。
        </text>
        <button
          class="conversations-primary-action"
          data-testid="conversations-start-chat"
          @click="startChat"
        >
          开始第一次对话
        </button>
      </view>

      <template v-else>
        <view
          class="conversations-list"
          data-testid="conversations-list"
          role="region"
          aria-label="全部会话"
        >
          <VcSessionPreview
            v-for="item in items"
            :key="item.conversationId"
            :data-conversation-id="item.conversationId"
            :title="conversationTitle(item)"
            :preview="conversationPreview(item)"
            :time="conversationTime(item)"
            @open="openConversation(item)"
          />
        </view>

        <view v-if="loadMoreFailed" class="conversations-more-error" role="alert">
          <text>后面的会话暂时没有加载出来。</text>
        </view>
        <button
          v-if="hasMore"
          class="conversations-load-more"
          data-testid="conversations-load-more"
          :disabled="busy"
          @click="loadMore"
        >
          {{ loadMoreFailed ? "重新加载更多" : "加载更多" }}
        </button>
      </template>

      <!-- VC-R199：返回刷新失败时既有列表仍在渲染，反馈固定在视口内，
           不依赖当前滚动位置；首次无缓存失败仍走上方整页错误卡。
           VC-R206：等待/失败/成功共用同一反馈条与同一按钮节点，键盘焦点
           才能留在原位。等待期间不用原生 disabled（会把焦点掉到 body），
           用 aria-disabled 表意，重复请求由 refreshOnReturn 的 busy 门挡住。 -->
      <view
        v-if="refreshNotice"
        class="conversations-refresh-alert"
        role="status"
        data-testid="conversations-refresh-notice"
        :data-state="refreshNotice"
      >
        <text class="conversations-refresh-alert__copy">
          {{ refreshNoticeCopy }}
        </text>
        <button
          class="conversations-refresh-alert__action"
          type="button"
          data-testid="conversations-retry-refresh"
          :aria-disabled="refreshNotice === 'pending'"
          :aria-busy="refreshNotice === 'pending'"
          @click="refreshOnReturn(true)"
        >
          {{ refreshNotice === "success" ? "再次刷新" : "重试" }}
        </button>
      </view>
    </view>
  </ConsumerShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, ref, watch, type ComponentPublicInstance } from "vue";

import { listConversations, type ConversationListItem } from "@/api/chat";
import { createAuthenticatedTransport } from "@/api/transport";
import ConsumerShell from "@/app/ConsumerShell.vue";
import { goTo } from "@/app/navigate";
import VcSessionPreview from "@/components/home/VcSessionPreview.vue";
import AppIcon from "@/design-system/AppIcon.vue";
import { buildContextHref, readContextFromLocation } from "@/domain/context-href";
import {
  readableConversationPreview,
  readableConversationTitle,
} from "@/domain/conversation-display";
import { formatConversationActivity } from "@/domain/timestamp";
import { useAuthStore } from "@/stores/auth";
import { useRelationshipStore } from "@/stores/relationship";

type PageState = "loading" | "ready" | "error" | "missing";

// VC-R206：返回刷新反馈条的阶段文案；null 为无反馈。自动返回刷新沿用
// R199：等待与成功不挂反馈，失败才挂；只有用户在反馈条主动点击重试/
// 再次刷新才经历 pending → failed | success，成功反馈保留到下一次页面
// 激活的自动刷新把它收回。
const REFRESH_NOTICE_COPY = {
  pending: "正在刷新会话，暂时显示之前的内容。",
  failed: "会话没有刷新出来，正在显示之前的内容。",
  success: "会话已更新。",
} as const;
type RefreshNotice = keyof typeof REFRESH_NOTICE_COPY;

const PAGE_SIZE = 20;
const auth = useAuthStore();
const relStore = useRelationshipStore();
const pageState = ref<PageState>("loading");
const relationshipId = ref("");
const items = ref<ConversationListItem[]>([]);
const hasMore = ref(false);
const loadMoreFailed = ref(false);
// VC-R199/R206：返回刷新反馈阶段。只在已有可用列表的原地刷新路径上
// 变化，驱动视口内固定反馈条；不清 items、不切 pageState。
const refreshNotice = ref<RefreshNotice | null>(null);
const refreshNoticeCopy = computed(() => (
  refreshNotice.value ? REFRESH_NOTICE_COPY[refreshNotice.value] : ""
));
const busy = ref(false);
// VC-R199：最后打开旧会话点击行时的视口几何（仅页面内存，随换号清理）。
// 返回刷新合并重排后按偏移差补偿滚动，把该条送回浏览位置；几何在点击
// 时捕获——onDeactivated 时页面 DOM 可能已移出文档，不可靠。
// VC-R200：只在用户返回后没有再移动时生效（见 settleScrollAfterMerge）。
let leaveAnchor: { id: string; docTop: number; scrollTop: number } | null = null;
// VC-R201：返回后键盘继续操作的焦点意图（仅页面内存，随换号清理）。与
// leaveAnchor 分离——滚动锚点仍归 R199/R200 的合并落位按视口规则消费，
// 焦点意图在每次 onActivated 时一次性消费，不随滚动路径失效。
let focusIntent: string | null = null;
// VC-R201：H5 下 <view> 编译为 uni 组件，模板 ref 是组件实例而非元素（其上
// 没有 querySelector），本页自身又因根级注释在 dev 编译下 $el 落在锚点文本
// 节点。ConsumerShell 是本仓库组件、模板单根 view，取其组件实例的 $el 即
// 本页真正的根 DOM；焦点查询限定在其内，不命中其他页面或同名元素。
const shellRef = ref<ComponentPublicInstance | null>(null);
// VC-R11：页面私有请求代次（在途请求的收尾归属凭据）。加载流程进入时
// 递增；身份清理 watch 同步递增以作废在途请求。同账号的真实重认证
// （login/tryRefresh 推进 store 代次但 accountId 不变）不推进本代次——
// 它只区分「本页发起的哪个请求」，账号数据归属由 watch 与
// 请求代次承担，因此同账号在途请求照常落地收尾。
let loadSeq = 0;
// VC-R217：本页实例当前是否处于 KeepAlive 激活（可见）状态。换号清理后的
// 身份恢复（null → 确定账号）只对可见页自动重载；隐藏缓存页继续不抢跑，
// 重载仍交给重新激活时的 onActivated。
let pageActive = false;

const transport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  getAccountId: () => auth.accountId,
      getSessionId: () => auth.getSessionId(),
  getSessionRevision: () => auth.getSessionRevision(),
  onUnauthorized: () => auth.onUnauthorized(),
  // VC-R52 期望账号失配恢复：先作废旧本地归属再读当前 Cookie 身份，
  // 不自动重放动作（共享入口见 stores/auth.ts reconcileAccountContext）。
  onAccountContextChanged: () => {
    void auth.reconcileAccountContext(transport);
  },
});

// VC-R11：身份交接清理。只有「已知账号 A → 不同账号（B 或 null）」才是
// 换号/退出：清空旧账号私有内容并回到加载态，并作废在途请求。null → X
// （初次恢复、匿名后登录）不清理、不当作过期。清理绝不发请求——KeepAlive
// 隐藏缓存页不得抢跑，重载交给 onActivated。
// VC-R217：可见页没有 onActivated 兜底——本页自身的动作（重新加载/加载
// 更多/反馈条重试）撞共享 Cookie 换号的精确 409 时，auth.reconcile 同步
// clear 再发现当前 Cookie 身份，账号走「已知 A → null（下面的清理分支）→
// 确定账号」两步，而页面全程保持激活、不会再触发 onActivated，无人重载
// 就永久停在清理后的骨架（loading 分支没有任何操作入口）。因此 null →
// 确定账号时可见页在这里恰好自动重载一次；busy 挡住在途流程（首载/激活/
// 同账号重认证不经过 null，不进本分支，不重复发读）。清理已重置反馈条与
// 焦点、锚点意图，自动重载不继承旧手动重试语义。
watch(() => auth.accountId, (next, prev) => {
  if (next === prev) return;
  if (prev === null) {
    if (pageActive && !busy.value) void loadInitial();
    return;
  }
  loadSeq++;
  items.value = [];
  relationshipId.value = "";
  hasMore.value = false;
  loadMoreFailed.value = false;
  refreshNotice.value = null;
  leaveAnchor = null;
  focusIntent = null;
  pageState.value = "loading";
  busy.value = false;
});

function knownRelationshipIds(): string[] {
  return relStore.relationships.map((relationship) => relationship.relationshipId);
}

function queryRelationshipId(): string {
  try {
    if (typeof location === "undefined") return "";
    return readContextFromLocation(location).relationshipId ?? "";
  } catch {
    return "";
  }
}

function chooseRelationshipId(): string {
  const requested = queryRelationshipId();
  if (requested && knownRelationshipIds().includes(requested)) return requested;
  return relStore.currentRelationshipId ?? "";
}

function chatHref(conversationId?: string): string {
  return buildContextHref("chat", {
    relationshipId: relationshipId.value,
    conversationId,
    knownRelationshipIds: knownRelationshipIds(),
  });
}

function conversationTitle(item: ConversationListItem): string {
  const title = readableConversationTitle(item);
  return title.startsWith("未命名会话") ? "一段对话" : title;
}

function conversationPreview(item: ConversationListItem): string | null {
  const preview = readableConversationPreview(item);
  return preview === conversationTitle(item) ? null : preview;
}

function conversationTime(item: ConversationListItem): string {
  return formatConversationActivity(item.lastActivityAt ?? item.createdAt);
}

function openConversation(item: ConversationListItem): void {
  leaveAnchor = captureAnchor(item.conversationId);
  focusIntent = item.conversationId;
  goTo(chatHref(item.conversationId));
}

// VC-R201：返回缓存页时把焦点送回最后打开项，键盘从原地继续（下一 Tab
// 即下一项/加载更多）。此刻列表就是缓存 DOM：目标项缺失（被删/换号/已不
// 属于本页）即静默放弃，不为焦点等待刷新、发新请求或补加载更多；
// preventScroll 保证聚焦不主动滚动页面，滚动落位仍由 R199/R200 负责。
function restoreFocusAfterReturn(): void {
  const intent = focusIntent;
  focusIntent = null;
  if (!intent) return;
  const root = shellRef.value?.$el;
  if (!(root instanceof HTMLElement)) return;
  const el = root.querySelector<HTMLElement>(`[data-conversation-id="${intent}"]`);
  if (el) el.focus({ preventScroll: true });
}

function startChat(): void {
  goTo(chatHref());
}

async function loadInitial(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  pageState.value = "loading";
  loadMoreFailed.value = false;
  refreshNotice.value = null;
  // VC-R11：函数进入即捕获本页私有代次；此后每次 await 之后与 finally 的
  // busy 复位一律以 mySeq === loadSeq 门控——只有更新的加载流程或身份清理
  // watch 接管时才静默丢弃，旧账号的迟到结果不得回填本页状态。
  const mySeq = ++loadSeq;
  try {
    if (!auth.isAuthenticated) await auth.tryRefresh(transport);
    if (mySeq !== loadSeq) return;
    if (!auth.isAuthenticated) {
      pageState.value = "error";
      return;
    }

    await relStore.load(transport);
    if (mySeq !== loadSeq) return;
    if (relStore.status === "error") {
      pageState.value = "error";
      return;
    }

    relationshipId.value = chooseRelationshipId();
    if (!relationshipId.value) {
      items.value = [];
      hasMore.value = false;
      pageState.value = "missing";
      return;
    }

    const page = await listConversations(
      transport,
      relationshipId.value,
      undefined,
      PAGE_SIZE,
    );
    if (mySeq !== loadSeq) return;
    items.value = page;
    hasMore.value = page.length === PAGE_SIZE;
    pageState.value = "ready";
  } catch {
    if (mySeq !== loadSeq) return;
    pageState.value = "error";
  } finally {
    if (mySeq === loadSeq) busy.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (busy.value || !hasMore.value || items.value.length === 0) return;
  const after = items.value[items.value.length - 1]?.conversationId;
  if (!after) return;

  busy.value = true;
  loadMoreFailed.value = false;
  // VC-R11：分页 append 同样以本页私有代次门控，身份清理或新流程接管后
  // 静默丢弃；同账号重认证不受影响。
  const mySeq = ++loadSeq;
  try {
    const page = await listConversations(
      transport,
      relationshipId.value,
      after,
      PAGE_SIZE,
    );
    if (mySeq !== loadSeq) return;
    items.value = [...items.value, ...page];
    hasMore.value = page.length === PAGE_SIZE;
  } catch {
    if (mySeq === loadSeq) loadMoreFailed.value = true;
  } finally {
    if (mySeq === loadSeq) busy.value = false;
  }
}

// VC-R199：服务端 keyset 顺序键 (COALESCE(lastActivityAt, createdAt), 数字 id)
// 的客户端镜像，只用于刷新时的覆盖边界与旧尾部取舍，不假设已知条目
// 一定还处在旧时间区域（被打开的旧会话发新消息会升到列表顶部）。
// 活动时间契约是后端 RFC3339Nano（UTC、Z 结尾、小数秒最多 9 位）；
// Date.parse 只保留毫秒，会截断亚毫秒差使边界比较落到 id 兜底而与
// 服务端顺序不一致，因此按契约字符串解析成纳秒再比较。
const RFC3339_NANO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

function activityNanos(raw: string): bigint | null {
  const matched = RFC3339_NANO_UTC.exec(raw);
  if (!matched) return null;
  const millis = Date.UTC(
    Number(matched[1]),
    Number(matched[2]) - 1,
    Number(matched[3]),
    Number(matched[4]),
    Number(matched[5]),
    Number(matched[6]),
  );
  if (Number.isNaN(millis)) return null;
  const fraction = (matched[7] ?? "").padEnd(9, "0");
  return BigInt(millis) * 1_000_000n + BigInt(fraction);
}

function orderKeyOf(item: ConversationListItem): { activity: bigint; id: bigint } | null {
  const activity = activityNanos(item.lastActivityAt ?? item.createdAt ?? "");
  if (activity === null || !/^\d+$/.test(item.conversationId)) return null;
  return { activity, id: BigInt(item.conversationId) };
}

function isStrictlyBelow(item: ConversationListItem, other: ConversationListItem): boolean {
  const a = orderKeyOf(item);
  const b = orderKeyOf(other);
  if (!a || !b) return false;
  return a.activity !== b.activity ? a.activity < b.activity : a.id < b.id;
}

function findItemElement(conversationId: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector(`[data-conversation-id="${conversationId}"]`);
}

function readScrollY(): number {
  if (typeof window === "undefined") return 0;
  return window.scrollY || window.pageYOffset || 0;
}

function captureAnchor(conversationId: string): { id: string; docTop: number; scrollTop: number } | null {
  const el = findItemElement(conversationId);
  if (!el) return null;
  const scrollTop = readScrollY();
  return { id: conversationId, docTop: el.getBoundingClientRect().top + scrollTop, scrollTop };
}

// VC-R200：返回时 uni-h5 经 vue-router scrollBehavior 按 savedPosition 把
// scrollY 恢复成离开值，且先于刷新响应到达；合并时 scrollY 仍等于点击锚点
// 的 scrollTop 即用户未动，差异只可能来自用户滚动（合并前本页没有程序
// 性滚动）。容差吸收亚像素取整。
const SCROLL_TOLERANCE = 1;

interface MergeViewport {
  scrollY: number;
  /** 合并前的可见首条及其视口偏移；位于顶部或没有可锚定条目时为 null。 */
  anchor: { id: string; viewportTop: number } | null;
}

function captureMergeViewport(): MergeViewport {
  const scrollY = readScrollY();
  if (scrollY <= SCROLL_TOLERANCE || typeof document === "undefined") {
    return { scrollY, anchor: null };
  }
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-conversation-id]"))) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= 0) continue;
    const id = el.getAttribute("data-conversation-id");
    return { scrollY, anchor: id ? { id, viewportTop: rect.top } : null };
  }
  return { scrollY, anchor: null };
}

// VC-R199/R200：合并重排渲染后的滚动落位。用户返回后未再移动时，把最后
// 打开的旧会话按点击时偏移差送回原视口位置；已浏览到别处时以合并前的真实
// 视口为准——顶部保持顶部看最新会话，其余把可见首条补偿回同一视口偏移，
// 保住正在看的内容与相对位置。锚定条目已不存在时不干预滚动。
async function settleScrollAfterMerge(mySeq: number, viewport: MergeViewport): Promise<void> {
  const anchor = leaveAnchor;
  leaveAnchor = null;
  await nextTick();
  if (mySeq !== loadSeq || typeof window === "undefined") return;
  if (anchor && Math.abs(viewport.scrollY - anchor.scrollTop) <= SCROLL_TOLERANCE) {
    const el = findItemElement(anchor.id);
    if (!el) return;
    const delta = el.getBoundingClientRect().top + readScrollY() - anchor.docTop;
    window.scrollTo(0, anchor.scrollTop + delta);
    return;
  }
  if (!viewport.anchor) return;
  const el = findItemElement(viewport.anchor.id);
  if (!el) return;
  window.scrollTo(0, el.getBoundingClientRect().top + readScrollY() - viewport.anchor.viewportTop);
}

// VC-R199：返回缓存页的原地刷新。不清 items、不切 pageState——等待与
// 失败期间既有列表（含已加载范围）始终可用；所有页成功后一次性合并，
// 任一页失败保留旧列表整体并给出视口内反馈（部分成功就合并会制造缺口）。
// VC-R206：manual 表示用户在反馈条主动点击重试/再次刷新——等待期间反馈
// 切到“正在刷新”而不卸载，成功后显示“已更新”；自动激活只挂失败反馈，
// 并收回上一次手动成功提示。手动路径的重复触发由 busy 门挡住（aria-
// disabled 不拦键盘事件）；自动激活保持接管语义，作废在途流程后收尾。
async function refreshOnReturn(manual = false): Promise<void> {
  if (manual && busy.value) return;
  const mySeq = ++loadSeq;
  busy.value = true;
  refreshNotice.value = manual ? "pending" : null;
  const previousItems = items.value;
  const oldHead = previousItems[0];
  let fetched: ConversationListItem[] = [];
  let lastPageLength = 0;
  try {
    for (;;) {
      const after = fetched.length > 0
        ? fetched[fetched.length - 1].conversationId
        : undefined;
      const page = await listConversations(transport, relationshipId.value, after, PAGE_SIZE);
      if (mySeq !== loadSeq) return;
      fetched = fetched.concat(page);
      lastPageLength = page.length;
      if (page.length < PAGE_SIZE) break;
      // 覆盖边界是离开前旧头部的键值快照，不是「出现已知条目」：刚打开
      // 的旧会话可能已升至首页。页尾仍严格高于旧头部键值就必须继续追赶
      // （成本正比真实新增量）；旧头部被删时同一边界也让下扫在旧键值区
      // 域之上停止，不会因找不到具体条目而无界扫描全账户。
      if (!isStrictlyBelow(oldHead, page[page.length - 1])) break;
    }
    // 等待期间用户可能继续浏览，落位依据必须是合并前这一刻的真实视口。
    const viewport = captureMergeViewport();
    if (fetched.length === 0) {
      // 服务端明确为空：与首屏一致信任服务端真值。
      items.value = [];
      hasMore.value = false;
    } else {
      const fetchedIds = new Set(fetched.map((item) => item.conversationId));
      const fetchedLast = fetched[fetched.length - 1];
      // 旧条目只保留位于已取末尾之后的尾部；位于其上却未被取到的旧条目
      // 已在离开期间被删除，不以陈旧副本垫底（活动只增不减，仍在的旧
      // 条目若升到边界之上必然已被重新取到）。
      const tail = previousItems.filter(
        (item) => !fetchedIds.has(item.conversationId) && !isStrictlyBelow(fetchedLast, item),
      );
      items.value = [...fetched, ...tail];
      if (tail.length === 0) hasMore.value = lastPageLength === PAGE_SIZE;
    }
    await settleScrollAfterMerge(mySeq, viewport);
    if (mySeq === loadSeq) refreshNotice.value = manual ? "success" : null;
  } catch {
    if (mySeq === loadSeq) refreshNotice.value = "failed";
  } finally {
    if (mySeq === loadSeq) busy.value = false;
  }
}

// 返回缓存列表时重读最近窗口，体现聊天期间的新会话与活动顺序；已有
// 可用列表走原地刷新以保留已浏览范围与浏览位置，否则回到首屏流程。
// VC-R201：焦点意图按一次返回在此消费；之后无论等待、失败还是响应合并
// 都不再动焦点，用户在途期间移走的焦点不被抢回。
onActivated(() => {
  pageActive = true;
  restoreFocusAfterReturn();
  if (!auth.isAuthenticated) return;
  if (pageState.value === "ready" && items.value.length > 0 && relationshipId.value) {
    void refreshOnReturn();
    return;
  }
  void loadInitial();
});

onMounted(() => {
  pageActive = true;
  void loadInitial();
});

// VC-R217：KeepAlive 停用（压栈隐藏）后不再视为可见；隐藏期间的身份恢复
// 不抢跑，重载交给重新激活。
onDeactivated(() => {
  pageActive = false;
});
</script>

<style scoped>
.conversations-page {
  display: grid;
  gap: var(--vc-space-4);
  min-width: 0;
}

.conversations-page__intro {
  color: var(--vc-color-ink-muted);
  font-size: 14px;
  line-height: 22px;
}

.conversations-list {
  display: grid;
  min-width: 0;
}

.conversations-state {
  display: grid;
  min-width: 0;
}

.conversations-state--loading {
  gap: var(--vc-space-1);
}

.conversations-skeleton {
  display: grid;
  gap: var(--vc-space-2);
  min-height: 72px;
  align-content: center;
  border-bottom: 1px solid var(--vc-color-hairline);
}

.conversations-skeleton__title,
.conversations-skeleton__copy {
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface-soft);
}

.conversations-skeleton__title {
  width: min(58%, 200px);
  height: 14px;
}

.conversations-skeleton__copy {
  width: min(82%, 286px);
  height: 10px;
}

.conversations-state--message,
.conversations-state--empty {
  justify-items: center;
  align-content: center;
  gap: var(--vc-space-3);
  min-height: 320px;
  padding: var(--vc-space-7) var(--vc-space-4);
  text-align: center;
}

.conversations-state__title {
  color: var(--vc-color-ink);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
}

.conversations-state__copy {
  max-width: 26em;
  color: var(--vc-color-ink-muted);
  font-size: 14px;
  line-height: 22px;
}

.conversations-empty-mark {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 52px;
  height: 52px;
  margin-bottom: var(--vc-space-1);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-full);
  color: var(--vc-color-primary);
  background: var(--vc-color-surface-soft);
}

.conversations-primary-action,
.conversations-secondary-action,
.conversations-load-more {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  min-height: 48px;
  margin: var(--vc-space-2) 0 0;
  padding: 0 var(--vc-space-5);
  border-radius: var(--vc-radius-control);
  font: inherit;
  font-size: 16px;
  font-weight: 500;
}

.conversations-primary-action {
  width: min(100%, 280px);
  border: 0;
  color: var(--vc-color-surface);
  background: var(--vc-color-primary);
}

.conversations-secondary-action,
.conversations-load-more {
  justify-self: center;
  border: 1px solid var(--vc-color-primary);
  color: var(--vc-color-primary);
  background: transparent;
}

.conversations-primary-action::after,
.conversations-secondary-action::after,
.conversations-load-more::after {
  border: 0;
}

.conversations-primary-action:active {
  background: var(--vc-color-primary-pressed);
}

.conversations-secondary-action:active,
.conversations-load-more:active {
  background: var(--vc-color-surface-soft);
}

.conversations-more-error {
  color: var(--vc-color-error);
  font-size: 14px;
  line-height: 22px;
  text-align: center;
}

/* VC-R199：刷新反馈。sticky 底部：占据真实文档流空间，滚到底部时
   落位在「加载更多」之后不遮挡入口；未滚到其文档位置时吸附视口底部
   保持可见（外壳祖先为 overflow-x: clip，不产生滚动容器，不破坏吸附）。
   VC-R206：等待与成功是中性反馈，失败才用错误色。 */
.conversations-refresh-alert {
  position: sticky;
  bottom: calc(var(--vc-space-4) + env(safe-area-inset-bottom, 0px));
  justify-self: center;
  display: flex;
  align-items: center;
  gap: var(--vc-space-3);
  max-width: 100%;
  padding: var(--vc-space-2) var(--vc-space-4);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface);
  box-shadow: 0 4px 12px rgb(0 0 0 / 10%);
}

.conversations-refresh-alert[data-state="failed"] {
  border-color: var(--vc-color-error);
}

.conversations-refresh-alert__copy {
  color: var(--vc-color-ink);
  font-size: 14px;
  line-height: 20px;
}

.conversations-refresh-alert[data-state="failed"] .conversations-refresh-alert__copy {
  color: var(--vc-color-error);
}

.conversations-refresh-alert__action {
  flex: none;
  min-height: 36px;
  padding: 0 var(--vc-space-3);
  border: 1px solid var(--vc-color-primary);
  border-radius: var(--vc-radius-control);
  color: var(--vc-color-primary);
  background: transparent;
  font: inherit;
  font-size: 14px;
}

.conversations-refresh-alert__action::after {
  border: 0;
}

.conversations-refresh-alert__action[aria-disabled="true"] {
  opacity: 0.6;
}

button:focus-visible {
  outline: 2px solid var(--vc-color-primary);
  outline-offset: 3px;
}
</style>
