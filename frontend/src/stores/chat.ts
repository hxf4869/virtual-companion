// TASK-0026/TASK-0104: Pinia chat store binding the realtime client to the H5
// UI.
//
// The store owns the stream state, the overall outcome, and a cancel handle the
// page can flip. Transport deps are injected at call time so the store spec can
// mock resume/snapshot exactly like api/realtime.spec.ts. The store never
// fabricates deltas: it only reflects the reducer state produced by
// streamGeneration.
//
// TASK-0104 (P2-14/P2-17): each run gets a fresh handle bound to an
// AbortController -- cancel()/reset()/a new run abort the underlying transport
// fetch. A run sequence guards single-writer semantics: a stale run that
// finishes late is dropped and can never overwrite the state of a newer
// generation or a reset.
//
// TASK-0186: adds the send flow (idempotent generation creation → stream →
// history reload) on top of the existing consumption-only run(). The low-level
// run() is unchanged so existing stream tests still pass. send() mints a UUID
// idempotency key, calls sendGeneration, starts the stream, and reloads message
// history on completion. Go v1 SSE 使用浏览器的同源 opaque session cookie。

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  cancelGeneration,
  ChatHttpError,
  createConversation,
  listConversations,
  listMessages,
  listRecentMessages,
  sendGeneration,
  type ChatTransport,
  type ConversationListItem,
  type CreateConversationResponse,
  type Generation,
  type Message,
} from "@/api/chat";
import {
  createStreamHandle,
  streamGeneration,
  type RealtimeDeps,
  type StreamHandle,
  type StreamOutcome,
} from "@/api/realtime";
import { classifyDisconnect, type DisconnectKind } from "@/domain/stream-recovery";
import {
  applyTerminalSnapshot,
  initialState,
  TERMINAL_EVENT_TYPES,
  type StreamState,
  type StreamEvent,
} from "@/domain/stream-reducer";
import {
  canRestore,
  clearRestorableGeneration,
  loadRestorableGeneration,
  safeSessionStorage,
  saveRestorableGeneration,
} from "@/domain/generation-restore";

export type ChatPhase =
  | "idle"
  | "streaming"
  | "completed"
  | "cancelled"
  | "blocked"
  | "failed";

/**
 * WP-D：最近窗口/向上分页页大小。首次打开会话只拉"最后 50 条"，更早内容
 * 由列表顶部的手动加载入口按页向前取；不再自动串行翻页。
 */
const HISTORY_PAGE_SIZE = 50;
/** 取消请求与快照核对的有界等待（ms）。超时＝结果未知，不是确定终态。 */
const CANCEL_VERIFY_TIMEOUT_MS = 5_000;
/** 取消响应里视为服务端终态的 generation 状态。 */
const TERMINAL_GENERATION_STATUSES = new Set(["CANCELLED", "COMPLETED", "FAILED", "BLOCKED"]);

/** 取消响应里的 generation 状态 → 服务端终态事件类型（兜底按取消处理）。 */
function terminalEventOf(status: string): string {
  if (status === "COMPLETED") return "chat.completed";
  if (status === "FAILED") return "chat.failed";
  if (status === "BLOCKED") return "chat.blocked";
  return "chat.cancelled";
}

/** 服务端终态事件类型 → turn 终局（兜底 failed）。 */
function terminalPhaseOf(
  eventType: string,
): "completed" | "cancelled" | "blocked" | "failed" {
  if (eventType === "chat.completed") return "completed";
  if (eventType === "chat.cancelled") return "cancelled";
  if (eventType === "chat.blocked") return "blocked";
  return "failed";
}

/** N-06：已确认服务端终态的 phase 集合——本地 cancelled 提交不得覆盖。 */
const CONFIRMED_TERMINAL_PHASES: readonly ChatPhase[] = [
  "completed",
  "cancelled",
  "blocked",
  "failed",
];

/** S0-20：快照终态事件类型 → outcome；null/集合外的未知类型按 exhausted 兜底。 */
function snapshotTerminalOutcomeOf(eventType: string | null): StreamOutcome {
  if (eventType && TERMINAL_EVENT_TYPES.has(eventType)) return terminalPhaseOf(eventType);
  return "exhausted";
}

/** N-06：快照事件里最后一条 chat.snapshot 携带的权威正文（可为空串）。 */
function lastSnapshotTextOf(events: readonly StreamEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].eventType === "chat.snapshot") {
      return String(events[i].payload ?? "");
    }
  }
  return "";
}

export const useChatStore = defineStore("h5-chat", () => {
  const phase = ref<ChatPhase>("idle");
  const generationId = ref<string>("");
  const stream = ref<StreamState>(initialState(0));
  const outcome = ref<StreamOutcome | null>(null);
  const lastDisconnect = ref<DisconnectKind | null>(null);
  const conversationId = ref<string>("");
  const messages = ref<Message[]>([]);
  // CONV-HIST: conversation list (first page) and the history load-more cursor.
  const conversations = ref<ConversationListItem[]>([]);
  const historyHasMore = ref(false);
  // WP-D（缺口4）：历史加载失败如实呈现——保留已加载内容并置错误态，页面
  // 用既有文案位展示 + 提供重试入口，不再静默吞掉。
  const historyLoadFailed = ref(false);
  // N-06（缺口5）：初始/最近窗口刷新失败与"加载更早消息"失败分开——重试
  // 最近窗口必须重发最近窗口请求，不得错误调用 before 游标只取更旧消息。
  const recentLoadFailed = ref(false);
  // WP-D（缺口3）：用户已停止本地显示、但服务端终态未经确认时为 true——
  // 保留恢复标识，页面显示"生成状态待确认"并提供手动核对入口。
  const cancelUnconfirmed = ref(false);
  // round7（P1）：消息窗口所有权令牌。每次窗口重建（init/open/reset/删除或
  // 结束当前会话）递增；在途分页链路提交前必须持有与当前一致的令牌，晚到的
  // 旧会话响应一律丢弃，禁止把 B 会话的页面串写进已切换到 A 的窗口。
  let historyWindowToken = 0;
  // Only covers the generation-creation POST. The stream keeps using phase;
  // this small guard prevents a double tap from creating a second durable turn
  // before run() can transition the phase to streaming.
  const generationStarting = ref(false);
  let handle: StreamHandle | null = null;
  let runSequence = 0;
  // M2：单调 turn 序号。send() 同步段与 reset() 递增；取消核对/手动核对在
  // 发起时捕获当前值，回调写入前必须未变——仅靠 generationId 归属校验不够，
  // "取消→同会话立即重发"时新轮 run 启动前 generationId 仍是旧值，旧取消
  // 响应会击落新轮的 pendingUserContent/phase/恢复标识。
  let turnSeq = 0;
  // CANCEL-A: the transport of the most recent send, so cancel() can signal the
  // backend while tearing down the local stream immediately.
  let lastTransport: ChatTransport | null = null;
  // WP-D（缺口3）：最近一次 send 的 RealtimeDeps，取消核对走 fetchSnapshot。
  let lastDeps: RealtimeDeps | null = null;
  // WP-D（缺口1）：结果未知（网络失败/超时/2xx 解析失败）时保留的幂等键，
  // 重试同键发送；确定失败或成功后清除，允许新键。
  // 缺陷6：键绑定提交会话——换会话后同文本不复用旧键；其他会话在途提交
  // 写入的键也不会被本会话的确定失败误清。
  let lastSendKey: { conversationId: string; content: string; key: string } | null = null;
  // WP-D（缺口3）：取消核对单飞——连续点击停止不产生并发取消请求风暴。
  let cancelVerifyInFlight = false;
  // STREAM-ECHO: the content of the in-flight (or last failed) user turn, so the
  // page can echo it as a pending bubble while streaming and offer a one-click
  // retry after a terminal failure.
  const pendingUserContent = ref("");
  // N-06：服务端已确认的最终正文（正常完成/快照恢复/停止核对共用）。与真实
  // generation 绑定，messageId 可空（SSE 完成事件不带消息 ID）；持久消息到达
  // （历史同步）后按 ID（或内容）去重清除。被阻断/取消的草稿绝不进入这里。
  const finalAssistant = ref<{
    generationId: string;
    messageId: string | null;
    content: string;
  } | null>(null);
  // N-06（缺口4）：回复已完成但历史同步失败——如实提示"记录同步暂未成功"，
  // 保留已确认内容与重试入口，不得改成发送失败。
  const finalSyncFailed = ref(false);
  // N-05（5.3）：本轮已持久化的用户消息 ID。唯一权威来源是服务端快照的
  // sourceUserMessageId（recoverInFlight/取消核对/显式再尝试前的有界核对）；
  // 不再用"窗口最后一条 user 行"猜测——多端插话会指错，补页失败清空又会
  // 让重试退回复制发送。拿不到就不传。
  const lastTurnSource = ref<string>("");
  // N-05：本轮是否已确认服务端接受了 generation。POST 失败轮为 false——
  // 页面的重连分流据此区分"当前轮已确认 generation 的输出未确认"与
  // "上一轮残留"，旧轮的 exhausted 不得劫持新 POST 失败的重试。
  const turnHasGeneration = ref(false);
  // S0-20 review-fix: owner/relationship binding for the refresh-recovery
  // entry. Ids only — the page binds them after auth; an empty accountId
  // disables saving entirely (no owner, no restore).
  const boundAccountId = ref("");
  const boundRelationshipId = ref("");

  /** S0-20: bind the recovery entry to the live account + relationship. */
  function bindGenerationContext(accountId: string, relationshipId: string): void {
    boundAccountId.value = accountId ?? "";
    boundRelationshipId.value = relationshipId ?? "";
  }

  function saveRestorable(overrides?: { generationId?: string }): void {
    const genId = overrides?.generationId ?? generationId.value;
    if (!genId || !conversationId.value) return;
    saveRestorableGeneration(safeSessionStorage(), {
      accountId: boundAccountId.value,
      relationshipId: boundRelationshipId.value,
      conversationId: conversationId.value,
      generationId: genId,
      savedAtEpochMs: Date.now(),
    });
  }

  /**
   * Go v1 重连先发送 chat.snapshot（当前完整草稿），之后才继续 delta。
   * 每个 snapshot 都替换此前的局部串，避免断线重连后重复拼接。
   */
  function draftTextOf(state: StreamState): string {
    let text = "";
    for (const event of state.events) {
      if (event.eventType === "chat.snapshot") {
        text = String(event.payload ?? "");
      } else if (event.eventType === "chat.delta") {
        text += String(event.payload ?? "");
      }
    }
    return text;
  }

  const draft = computed(() => draftTextOf(stream.value));

  const isStreaming = computed(() => phase.value === "streaming");
  const isTerminal = computed(() => stream.value.terminal);

  /**
   * FAIL-REASON: the internal fault string of the terminal event (if any).
   * Server-side diagnostic; the page maps it to stable friendly copy and never
   * renders it raw.
   */
  const terminalFault = computed<string | null>(() => {
    const terminalEvent = stream.value.events.find((e) =>
      ["chat.failed", "chat.blocked"].includes(e.eventType),
    );
    const payload = terminalEvent?.payload;
    if (payload && typeof payload === "object" && "fault" in payload) {
      const fault = (payload as { fault?: unknown }).fault;
      if (typeof fault === "string" && fault.trim()) {
        return fault;
      }
    }
    return null;
  });

  /**
   * Messages to display: committed history plus the live streaming draft as a
   * pending assistant message (so the user sees incremental output in context).
   * STREAM-ECHO: while a turn is in flight the user's own message is echoed as
   * a pending bubble (the server persists it, but history only reloads after
   * the stream reaches a terminal state).
   */
  const displayMessages = computed<Message[]>(() => {
    const msgs = [...messages.value];
    if (pendingUserContent.value && isStreaming.value) {
      msgs.push({
        messageId: "__pending_user__",
        conversationId: conversationId.value,
        role: "user",
        content: pendingUserContent.value,
      });
    }
    if (isStreaming.value && draft.value) {
      msgs.push({
        messageId: "__streaming__",
        conversationId: conversationId.value,
        role: "assistant",
        content: draft.value,
      });
    }
    // N-06：已确认的最终正文作为当前轮过渡显示；获得真实 messageId 后由
    // pruneFinalAssistant 全窗按 ID 去重清除。ID 未知（SSE 完成事件不带消息
    // ID、快照也未确认身份）时不做任何正文比对，过渡行始终显示——此时若
    // 历史同步成功可能出现重复显示，属可接受边界。
    const finalRow = finalAssistant.value;
    if (finalRow && !isStreaming.value && !finalRowKnownIn(msgs, finalRow)) {
      msgs.push({
        messageId: finalRow.messageId ?? `__final_${finalRow.generationId}__`,
        conversationId: conversationId.value,
        role: "assistant",
        content: finalRow.content,
      });
    }
    return msgs;
  });

  /**
   * N-06：过渡最终正文是否已被窗口中的权威行覆盖。只按真实 messageId 全窗
   * 比对；messageId=null 一律视为未覆盖——正文（含窗口尾部正文）比对会在
   * 补页失败时让旧轮次的同正文行吞掉本轮回复，绝不采用。
   */
  function finalRowKnownIn(rows: Message[], finalRow: NonNullable<typeof finalAssistant.value>): boolean {
    if (finalRow.messageId === null) return false;
    return rows.some((m) => m.messageId === finalRow.messageId);
  }

  /** N-06：持久消息到达后清除已被权威历史覆盖的过渡最终正文。 */
  function pruneFinalAssistant(): void {
    const finalRow = finalAssistant.value;
    if (!finalRow) return;
    if (finalRowKnownIn(messages.value, finalRow)) finalAssistant.value = null;
  }

  async function run(
    deps: RealtimeDeps,
    id: string,
    initialEpoch: number,
    opts?: { resumeFrom?: StreamState },
  ): Promise<void> {
    const sequence = ++runSequence;
    // A new run cancels any in-flight predecessor (P2-14).
    if (handle) {
      handle.cancelled = true;
      handle.abort();
    }
    lastDeps = deps; // WP-D（缺口3）：取消核对需要 deps.fetchSnapshot
    generationId.value = id;
    // N-05：run 只被"POST 已确认 generation 的 send"或快照恢复调用——从这里
    // 起本轮持有已确认的 generation。
    turnHasGeneration.value = true;
    phase.value = "streaming";
    outcome.value = null;
    lastDisconnect.value = null;
    // S0-20: persist non-sensitive ids so a full page reload can find the
    // pending turn again (server snapshot remains the authority).
    saveRestorable();
    if (!opts?.resumeFrom) {
      stream.value = initialState(initialEpoch);
    } else {
      stream.value = opts.resumeFrom;
    }
    const current = createStreamHandle();
    handle = current;

    const result = await streamGeneration(deps, id, stream.value.epoch, current, {
      initialState: opts?.resumeFrom,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      // P1（round5）：每个 RESUMED 批次应用后增量发布中间状态，页面据此
      // 逐批渲染流式草稿（旧实现整条连接结束才一次性提交，用户在流式
      // 期间看不到任何增量内容）。发布是浅拷贝，终态写入仍是同一份。
      onProgress: (progress) => {
        if (sequence !== runSequence || current.cancelled) return;
        stream.value = { ...progress, events: [...progress.events] };
      },
    });

    // P2-17: only the current run commits; a stale run's late write is dropped.
    if (sequence !== runSequence) {
      return;
    }
    handle = null;
    // N-06（T-40）：本地中断产生的 cancelled 只是传输事实。取消核对已确认
    // 任一服务端终态（completed/cancelled/failed/blocked）且非待确认时，
    // 不得用本地 cancelled 伪造覆盖已确认状态。phase 在上方 await 期间可能
    // 已被取消核对改写，显式按 ChatPhase 读取，避开 TS 对同步赋值的字面量
    // 收窄。
    const phaseAtCommit = phase.value as ChatPhase;
    const confirmGuard =
      result.outcome === "cancelled" &&
      CONFIRMED_TERMINAL_PHASES.includes(phaseAtCommit) &&
      !cancelUnconfirmed.value;
    if (confirmGuard) {
      return;
    }
    stream.value = result.state;
    outcome.value = result.outcome;

    if (result.outcome === "completed") {
      phase.value = "completed";
      pendingUserContent.value = "";
      // N-06：流式完成事件不带消息 ID——正文以过渡形式绑定真实 generation，
      // 历史同步（补页/刷新）把权威行带来后去重清除。空串也是合法正文。
      finalAssistant.value = { generationId: id, messageId: null, content: draftTextOf(result.state) };
      finalSyncFailed.value = false;
    } else if (result.outcome === "cancelled") {
      phase.value = "cancelled";
      pendingUserContent.value = "";
    } else if (result.outcome === "blocked") {
      // TERM-SEM: server OUTPUT_BLOCKED is its own phase, never "failed".
      // The content was refused by review, so retry would just be refused
      // again -- clear it and let the user write something new.
      phase.value = "blocked";
      pendingUserContent.value = "";
    } else {
      // TERM-SEM: failed / exhausted / not_found keep the content so the
      // page can offer a one-click retry of the same turn.
      phase.value = "failed";
      lastDisconnect.value = classifyDisconnect({
        navigatorOnline: typeof navigator === "undefined" ? undefined : navigator.onLine,
        outcome: result.outcome,
      });
    }
    // Only a durable terminal may clear refresh recovery. Transport exhaustion
    // and existence-hidden resume failures are non-terminal: keep the owner-bound
    // identifiers so online/visibility or a reload can re-check the snapshot.
    // WP-D（缺口3）：取消核对未确认前同样保留——服务端终态未知时恢复标识
    // 是唯一能对回真相的入口。
    if (
      result.outcome !== "exhausted" &&
      result.outcome !== "not_found_or_forbidden" &&
      !cancelUnconfirmed.value
    ) {
      clearRestorableGeneration(safeSessionStorage());
    }
  }

  /**
   * S0-20: after background/offline, take the generation snapshot as authority.
   * Never creates a second generation; pending user input stays until a true
   * terminal snapshot or a resumed stream completes.
   */
  async function recoverInFlight(deps: RealtimeDeps): Promise<void> {
    const id = generationId.value;
    if (!id) return;
    // M2：核对发起时捕获 turn 归属；await 快照期间新一轮提交开始（send 递增
    // turnSeq）时，旧核对不得写任何状态——包括 404 分支删除恢复标识。
    const seqAtRecover = turnSeq;
    const recoverStillCurrent = (): boolean =>
      turnSeq === seqAtRecover && generationId.value === id && !generationStarting.value;
    // WP-D（缺口3）：手动核对被允许穿透 cancelled 终态守卫（取消待确认时
    // 用户主动核对）；一旦继续，"已停止待确认"状态结束。
    if (
      !cancelUnconfirmed.value &&
      (phase.value === "completed" || phase.value === "cancelled" || phase.value === "blocked")
    ) {
      return;
    }
    if (handle && !handle.cancelled) return;

    let snapshot;
    try {
      snapshot = await deps.fetchSnapshot(id);
    } catch {
      if (recoverStillCurrent()) lastDisconnect.value = "network";
      return;
    }
    if (!recoverStillCurrent()) return;
    if (!snapshot.ok) {
      // S0-20: a gone generation (404) means the stored id is stale — drop
      // it instead of re-finding a dead turn on every reload.
      if (snapshot.status === 404) {
        clearRestorableGeneration(safeSessionStorage());
      }
      lastDisconnect.value = classifyDisconnect({
        resumeStatus: snapshot.status,
        outcome: outcome.value,
      });
      return;
    }
    cancelUnconfirmed.value = false;
    // N-06：快照是本轮 source 用户消息的权威来源（多端插话下窗口启发式会
    // 指错）。
    if (snapshot.sourceUserMessageId) {
      lastTurnSource.value = snapshot.sourceUserMessageId;
    }
    // A freshly-created generation can legitimately have an empty snapshot.
    // A reloaded store starts at the idle sentinel epoch 0, which is not a
    // valid realtime cursor and would make ticket minting fail with 400. Use
    // the protocol's initial positive epoch; if the server has already reset
    // to a later epoch, the resume response will authoritatively redirect us.
    const current = stream.value.epoch > 0 ? stream.value : initialState(1);
    const snapshotEpoch = snapshot.events[0]?.streamEpoch ?? current.epoch;
    const base =
      current.epoch === snapshotEpoch || snapshot.events.length === 0
        ? current
        : initialState(snapshotEpoch);
    const next = applyTerminalSnapshot(base, snapshot.events);
    stream.value = next;
    if (next.terminal) {
      const mapped = snapshotTerminalOutcomeOf(next.terminalEventType);
      outcome.value = mapped;
      if (mapped === "completed") {
        phase.value = "completed";
        pendingUserContent.value = "";
        // N-06：完成快照带权威正文与 assistantMessageId——按真实 ID 合并；
        // 空串是合法正文，协议缺失 ID 时以 null 过渡并等待历史同步。
        finalAssistant.value = {
          generationId: id,
          messageId: snapshot.assistantMessageId ?? null,
          content: lastSnapshotTextOf(snapshot.events),
        };
        finalSyncFailed.value = false;
      } else if (mapped === "cancelled") {
        phase.value = "cancelled";
        pendingUserContent.value = "";
        finalAssistant.value = null;
      } else if (mapped === "blocked") {
        phase.value = "blocked";
        pendingUserContent.value = "";
        finalAssistant.value = null;
      } else {
        phase.value = "failed";
      }
      lastDisconnect.value = "terminal";
      clearRestorableGeneration(safeSessionStorage());
      return;
    }
    await run(deps, id, next.epoch, { resumeFrom: next });
  }

  /**
   * S0-20 review-fix: after a FULL PAGE RELOAD the in-memory generation id is
   * gone. If sessionStorage still holds a fresh, owner-bound entry matching
   * the account + relationship + open conversation, re-anchor on it and let
   * {@link recoverInFlight} take the server snapshot as authority (resume or
   * terminal mapping — never a second generation, never a faked completed).
   * Any mismatch or expiry silently drops the entry.
   */
  async function tryRestoreAfterReload(
    deps: RealtimeDeps,
    ctx: { accountId: string; relationshipId: string },
  ): Promise<boolean> {
    if (!conversationId.value) return false; // no open conversation to attach to
    if (phase.value === "streaming") return false; // live stream owns the turn
    const storage = safeSessionStorage();
    const stored = loadRestorableGeneration(storage);
    if (!stored) return false;
    const context = {
      accountId: ctx.accountId,
      relationshipId: ctx.relationshipId,
      conversationId: conversationId.value,
    };
    if (!context.accountId || !context.relationshipId) return false;
    if (!canRestore(stored, context)) {
      // Account switch / relationship switch / different conversation:
      // never surface another binding's pending turn.
      clearRestorableGeneration(storage);
      return false;
    }
    generationId.value = stored.generationId;
    await recoverInFlight(deps);
    return true;
  }

  /**
   * WP-D（缺口3）：把取消响应/快照里的服务端终态落成对应 phase，并清恢复
   * 标识。仅在有界等待内拿到确定终态时调用；未知结果绝不伪造成终态。
   * N-06：完成终态可携带权威正文与消息 ID（快照核对路径），立即合并显示；
   * 仅状态确认（取消响应）时正文为 null，由历史同步补齐。
   */
  function applyConfirmedTerminal(
    eventType: string,
    final?: { messageId: string | null; content: string | null },
  ): void {
    const mapped = terminalPhaseOf(eventType);
    outcome.value = mapped;
    phase.value = mapped;
    if (mapped === "completed" && final && final.content !== null) {
      finalAssistant.value = {
        generationId: generationId.value,
        messageId: final.messageId,
        content: final.content,
      };
      finalSyncFailed.value = false;
    }
    if (mapped !== "failed") pendingUserContent.value = "";
    cancelUnconfirmed.value = false;
    clearRestorableGeneration(safeSessionStorage());
  }

  /** 有界等待一个 Promise；超时/失败返回 null（＝结果未知）。 */
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, ms);
      promise.then(
        (value) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(value);
          }
        },
        () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(null);
          }
        },
      );
    });
  }

  /** 用快照做一次有界终态核对；确认终态返回 true，未知返回 false。 */
  async function confirmTerminalFromSnapshot(
    deps: RealtimeDeps,
    id: string,
    stillCurrent: () => boolean,
  ): Promise<boolean> {
    const snapshot = await withTimeout(deps.fetchSnapshot(id), CANCEL_VERIFY_TIMEOUT_MS);
    // M2：核对归属校验——turn 序号已变（新一轮提交开始/窗口重建）时结果作废。
    if (!stillCurrent()) return true;
    if (!snapshot || !snapshot.ok) return false;
    // N-06：取消核对拿到的快照同样是本轮 source 的权威来源。
    if (snapshot.sourceUserMessageId) {
      lastTurnSource.value = snapshot.sourceUserMessageId;
    }
    const ordered = [...snapshot.events].sort((a, b) => a.eventSeq - b.eventSeq);
    const terminalEvent = [...ordered]
      .reverse()
      .find((event) => TERMINAL_EVENT_TYPES.has(event.eventType));
    if (!terminalEvent) return false; // 服务端仍在生成：保持待确认
    applyConfirmedTerminal(terminalEvent.eventType, {
      messageId: snapshot.assistantMessageId ?? null,
      content:
        terminalEvent.eventType === "chat.completed" ? lastSnapshotTextOf(ordered) : null,
    });
    return true;
  }

  /**
   * CANCEL-A: signal the backend once, but never wait for that HTTP request
   * before tearing down the local SSE. The request is best-effort because an
   * offline or permanently pending connection must not trap the UI in a live
   * stream after the user has cancelled it.
   *
   * WP-D（缺口3）：本地立即停止不变；随后做一次有界服务端终态核对——取消
   * 响应（5s 量级超时）拿到终态即确认；请求丢失/超时/不可解析时改用快照
   * 核对一次。确认终态才清恢复标识；未知则保留标识并置 cancelUnconfirmed，
   * 页面显示"已停止显示，生成状态待确认"+ 手动核对入口。连续停止单飞。
   */
  async function cancel(): Promise<void> {
    const current = handle;
    if (!current) return;
    current.cancelled = true;
    const transport = lastTransport;
    const deps = lastDeps;
    const id = generationId.value;
    if (!transport || !deps || !id) {
      // 无核对通道：保持既有语义——本地已停止，丢弃恢复标识。
      current.abort();
      cancelUnconfirmed.value = false;
      clearRestorableGeneration(safeSessionStorage());
      return;
    }
    if (cancelVerifyInFlight) {
      // 单飞：不产生并发取消风暴；本地立即停止不受影响。
      current.abort();
      return;
    }
    cancelVerifyInFlight = true;
    cancelUnconfirmed.value = true; // 终态未知前保留恢复标识
    // M2：捕获发起时的 turn 归属。旧核对回调写入前必须重新校验——"取消→
    // 立即重发"时新轮 run 启动前 generationId 仍是旧值，仅凭 id 校验会让旧
    // 取消响应击落新轮（清新轮 echo、打回 cancelled、删恢复标识）。
    const seqAtCancel = turnSeq;
    const cancelVerifyStillCurrent = (): boolean =>
      turnSeq === seqAtCancel && generationId.value === id && !generationStarting.value;
    // 先发起有界取消请求（不等待其响应），再做本地中断。
    void (async () => {
      try {
        const generation = await withTimeout(
          cancelGeneration(transport, id),
          CANCEL_VERIFY_TIMEOUT_MS,
        );
        if (!cancelVerifyStillCurrent()) return;
        if (generation && TERMINAL_GENERATION_STATUSES.has(generation.status)) {
          applyConfirmedTerminal(terminalEventOf(generation.status));
          // N-06（T-40）：取消响应只确认状态、不带正文——服务端实际完成时，
          // 用一次有界补页把权威行带回；失败置 finalSyncFailed 如实提示。
          if (generation.status === "COMPLETED") {
            void syncFinalFromHistory(transport, seqAtCancel, id);
          }
          return;
        }
        // 取消请求丢失/超时/不可解析/状态非终态：用快照核对一次。
        await confirmTerminalFromSnapshot(deps, id, cancelVerifyStillCurrent);
      } finally {
        cancelVerifyInFlight = false;
      }
    })();
    current.abort();
  }

  /**
   * N-06：仅状态确认（取消响应 COMPLETED）后的历史补读——把已完成的权威
   * 消息行带入窗口；失败不改成发送失败，置 finalSyncFailed 保留重试入口。
   * 晚到失败不得影响新会话：置位前校验发起时的会话/turn 归属。
   */
  async function syncFinalFromHistory(
    transport: ChatTransport,
    seqAtCancel: number,
    id: string,
  ): Promise<void> {
    const conversationAtStart = conversationId.value;
    try {
      await appendNewMessages(transport, historyWindowToken);
    } catch {
      if (
        turnSeq === seqAtCancel &&
        generationId.value === id &&
        conversationId.value === conversationAtStart
      ) {
        finalSyncFailed.value = true;
      }
    }
  }

  /** N-06：手动重试"回复已完成、记录同步暂未成功"的补页。 */
  async function retryFinalSync(transport: ChatTransport): Promise<void> {
    if (!finalSyncFailed.value) return;
    finalSyncFailed.value = false;
    // 晚到失败不得影响新会话：置位前校验发起时的会话/turn 归属。
    const seqAtRetry = turnSeq;
    const conversationAtStart = conversationId.value;
    try {
      await appendNewMessages(transport, historyWindowToken);
    } catch {
      if (
        turnSeq === seqAtRetry &&
        conversationId.value === conversationAtStart
      ) {
        finalSyncFailed.value = true;
      }
    }
  }

  /**
   * N-06：终态失败后的显式再尝试前的有界快照核对——从服务端快照拿本轮
   * source 用户消息 ID。拿到才允许重发（复用已持久化的原消息）；拿不到
   * 返回空串，页面据此保留核对入口而不是退回普通发送复制用户消息。
   */
  async function resolveTurnSource(deps: RealtimeDeps): Promise<string> {
    if (lastTurnSource.value) return lastTurnSource.value;
    // 本轮未确认持有 generation（POST 失败/未知轮）时，generationId 只是
    // 上一轮残留旧值，不得作为本轮 source 的依据——直接返回空串，由页面
    // 保留核对入口，而不是按旧 generation 的快照重新生成旧消息。
    if (!turnHasGeneration.value) return "";
    const id = generationId.value;
    if (!id) return "";
    // M2：核对发起时捕获 turn 归属——新一轮提交（send 同步段）或离页都会
    // 递增 turnSeq；await 快照期间归属已变时，旧 generation 的快照 source
    // 不得写入新轮的 lastTurnSource（否则新轮失败重试会短路复用跨轮错误
    // 归属）。仅凭 generationId 校验不够：新轮 POST 在途时它仍是旧值。
    const seqAtResolve = turnSeq;
    let snapshot;
    try {
      snapshot = await withTimeout(deps.fetchSnapshot(id), CANCEL_VERIFY_TIMEOUT_MS);
    } catch {
      return "";
    }
    // await 期间归属已变（新一轮提交/窗口重建）时结果作废。
    if (!snapshot || !snapshot.ok || generationId.value !== id || turnSeq !== seqAtResolve) {
      return "";
    }
    const source = snapshot.sourceUserMessageId ?? "";
    if (source) lastTurnSource.value = source;
    return source;
  }

  /**
   * N-06：SSE 直完成的 turn 用一次有界快照确认本轮持久行身份——与终局补页
   * 并行发起，拿到 assistantMessageId 才附加到过渡行并允许按真实 ID 去重；
   * 快照失败/超时/拿不到 ID 时保留 null-ID 过渡显示，绝不退回正文比对。
   * await 期间归属失守（新一轮提交/切窗）时结果整体作废，静默跳过。
   */
  async function confirmFinalIdentity(
    deps: RealtimeDeps,
    id: string,
    seqAtSubmit: number,
  ): Promise<void> {
    const conversationAtStart = conversationId.value;
    let snapshot;
    try {
      snapshot = await withTimeout(deps.fetchSnapshot(id), CANCEL_VERIFY_TIMEOUT_MS);
    } catch {
      return;
    }
    if (
      turnSeq !== seqAtSubmit ||
      generationId.value !== id ||
      conversationId.value !== conversationAtStart
    ) {
      return;
    }
    if (!snapshot || !snapshot.ok) return;
    // 快照同样是本轮 source 用户消息的权威来源。
    if (snapshot.sourceUserMessageId) {
      lastTurnSource.value = snapshot.sourceUserMessageId;
    }
    const row = finalAssistant.value;
    if (!row || row.generationId !== id || row.messageId !== null) return;
    if (!snapshot.assistantMessageId) return;
    finalAssistant.value = { ...row, messageId: snapshot.assistantMessageId };
    pruneFinalAssistant();
  }

  /**
   * S0-20: detach the page from a live stream without cancelling the durable
   * generation. A route change or full reload destroys the current fetch, but
   * the privacy-safe recovery entry must survive so the next page instance can
   * re-anchor from the server snapshot.
   *
   * N-05（T-43）：同时作废在途提交与取消/核对回调的 turn 归属——离页后晚到
   * 的 POST 成功响应不得重新建立订阅（见 send 的丢弃分支：接受结果仅保留
   * 恢复标识，不重启流）。
   */
  function detachInFlight(): void {
    if (handle) {
      handle.cancelled = true;
      handle.abort();
    }
    runSequence += 1; // the aborted run must not commit "cancelled" and clear recovery
    turnSeq += 1; // N-05：在途提交/核对回调一律作废，晚到响应只保留恢复标识
    handle = null;
    lastTransport = null;
    if (phase.value === "streaming") {
      phase.value = "failed";
      lastDisconnect.value = "network";
    }
  }

  function reset(): void {
    if (handle) {
      handle.cancelled = true;
      handle.abort();
    }
    runSequence += 1; // any in-flight run becomes stale
    turnSeq += 1; // M2：窗口销毁作废一切在途取消/手动核对回调
    phase.value = "idle";
    generationId.value = "";
    stream.value = initialState(0);
    outcome.value = null;
    lastDisconnect.value = null;
    conversationId.value = "";
    messages.value = [];
    historyHasMore.value = false;
    historyLoadFailed.value = false;
    recentLoadFailed.value = false;
    cancelUnconfirmed.value = false;
    finalAssistant.value = null;
    finalSyncFailed.value = false;
    lastTurnSource.value = "";
    turnHasGeneration.value = false;
    lastSendKey = null;
    historyWindowToken += 1; // round7（P1）：窗口销毁作废一切在途分页链路
    pendingUserContent.value = "";
    handle = null;
    lastTransport = null;
    // S0-20: logout / conversation teardown drops the recovery entry and its
    // owner binding (换号/登出后不得恢复上一账号的在途状态).
    boundAccountId.value = "";
    boundRelationshipId.value = "";
    clearRestorableGeneration(safeSessionStorage());
  }

  /**
   * Create a conversation under a relationship and load its message history.
   * The page calls this on mount to establish the chat context.
   */
  async function initConversation(
    transport: ChatTransport,
    relationshipId: string,
  ): Promise<CreateConversationResponse | null> {
    // 缺陷6：createConversation await 期间用户可能离开聊天/切换窗口；窗口
    // 令牌已变时丢弃创建结果——不写 conversationId、不加载历史。
    const windowTokenAtStart = historyWindowToken;
    const result = await createConversation(transport, relationshipId);
    if (result) {
      if (historyWindowToken !== windowTokenAtStart) return null;
      conversationId.value = result.conversationId;
      await loadHistory(transport);
    }
    return result;
  }

  /**
   * Reload message history for the current conversation. WP-D（缺口6）：改为
   * 一次"最近窗口"请求（最后 50 条），不再从头发多页。WP-D（缺口4）：失败
   * 时保留已加载内容并置 historyLoadFailed，不再静默吞掉。
   */
  async function loadHistory(transport: ChatTransport): Promise<void> {
    if (!conversationId.value) return;
    // 窗口重建即认领新令牌：任何更早的在途分页链路就此作废。
    const token = ++historyWindowToken;
    historyLoadFailed.value = false;
    recentLoadFailed.value = false;
    try {
      await loadRecentWindow(transport, token);
    } catch {
      if (token !== historyWindowToken) return;
      // N-06：这是"最近窗口"失败——重试必须重发最近窗口请求，不进入
      // load-more 的 before 游标链路。
      recentLoadFailed.value = true;
      // 已有内容时保留一个可重试的手动加载入口；空窗口由下一次发送自愈。
      historyHasMore.value = messages.value.length > 0;
    }
  }

  // ---- CONV-HIST: conversation list + history pagination ----

  /** Load the first page of the caller's conversations (optionally scoped). */
  async function loadConversations(
    transport: ChatTransport,
    relationshipId?: string,
  ): Promise<boolean> {
    try {
      conversations.value = await listConversations(transport, relationshipId);
      return true;
    } catch {
      // Non-fatal: keep the current list; the page can retry on next visit.
      return false;
    }
  }

  /**
   * WP-D（缺口6）：拉取最近窗口并整体替换当前窗口。响应内升序；提交前校验
   * 窗口令牌与目标会话，晚到的旧会话窗口不写回。
   */
  async function loadRecentWindow(transport: ChatTransport, token: number): Promise<void> {
    const target = conversationId.value;
    const page = await listRecentMessages(transport, target, undefined, HISTORY_PAGE_SIZE);
    if (token !== historyWindowToken || conversationId.value !== target) return;
    messages.value = page;
    historyHasMore.value = page.length >= HISTORY_PAGE_SIZE;
    pruneFinalAssistant();
  }

  /**
   * Switch to an existing conversation: one recent-window request lands the
   * user on the latest messages. Switching mid-stream is refused — the current
   * run must reach its terminal first.
   */
  async function openConversation(transport: ChatTransport, id: string): Promise<boolean> {
    if (isStreaming.value) return false;
    if (id === conversationId.value) return true;
    const previous = {
      conversationId: conversationId.value,
      messages: messages.value,
      historyHasMore: historyHasMore.value,
      historyLoadFailed: historyLoadFailed.value,
    };
    conversationId.value = id;
    messages.value = [];
    historyHasMore.value = true;
    historyLoadFailed.value = false;
    recentLoadFailed.value = false;
    // round7（P1）：切窗即作废旧令牌；本链路此后持有自己的快照继续分页。
    const token = ++historyWindowToken;
    // 缺陷（Codex 二轮问题5）：窗口请求在途期间用户可能已切到其他会话并发起
    // 新的流式回复。返回时必须重校验"本链路仍持有窗口"（令牌未被更新的切换
    // 递增、会话仍是本次目标）；失守时跳过一切写入与 turn 状态清理——那会
    // 摧毁新会话进行中的回复。状态归接管窗口的链路所有。
    const stillOwnsWindow = (): boolean =>
      token === historyWindowToken && conversationId.value === id;
    try {
      await loadRecentWindow(transport, token);
    } catch {
      // A failed switch must not masquerade as a valid empty conversation.
      // Roll back only when this request still owns the active window; a later
      // user switch has a newer token and remains authoritative.
      if (stillOwnsWindow()) {
        historyWindowToken += 1;
        conversationId.value = previous.conversationId;
        messages.value = previous.messages;
        historyHasMore.value = previous.historyHasMore;
        historyLoadFailed.value = previous.historyLoadFailed;
      }
      return false;
    }
    if (!stillOwnsWindow()) {
      // 晚到落地的旧窗口：仅作废自身，不触发清理、不改返回前的任何状态。
      return false;
    }
    // 缺陷6：窗口真正落地时，上一会话遗留的 turn 状态（重试文案、待确认
    // 标志、失败态、旧流草稿）随窗口销毁；此后在途提交的晚到响应由 send 的
    // 归属校验丢弃。owner 绑定的恢复标识按设计保留（切回原会话仍可恢复）。
    pendingUserContent.value = "";
    cancelUnconfirmed.value = false;
    finalAssistant.value = null;
    finalSyncFailed.value = false;
    lastTurnSource.value = "";
    turnHasGeneration.value = false;
    outcome.value = null;
    lastDisconnect.value = null;
    generationId.value = "";
    stream.value = initialState(0);
    phase.value = "idle";
    return true;
  }

  /**
   * WP-D（缺口6）：手动"加载更早消息"——以当前窗口最旧一条为 before 向前取
   * 一页并 prepend，messageId 去重；取满一页才允许继续向上取。
   */
  async function loadMoreHistory(transport: ChatTransport, token: number = historyWindowToken): Promise<void> {
    if (!conversationId.value || !historyHasMore.value || token !== historyWindowToken) return;
    const target = conversationId.value;
    const oldest = messages.value[0]?.messageId;
    const bufferedPage = await listRecentMessages(transport, target, oldest, HISTORY_PAGE_SIZE);
    if (token !== historyWindowToken || conversationId.value !== target) return;
    const known = new Set(messages.value.map((message) => message.messageId));
    const older = bufferedPage.filter((message) => !known.has(message.messageId));
    messages.value = [...older, ...messages.value];
    historyHasMore.value = bufferedPage.length >= HISTORY_PAGE_SIZE;
  }

  /**
   * WP-D：turn 终局后的补页——从窗口末尾用 after 游标向前追加新消息
   * （有界、去重），保留用户已向上翻出的更早窗口；不改写 historyHasMore
   * （它只描述"上方是否还有更早消息"）。
   */
  async function appendNewMessages(transport: ChatTransport, token: number): Promise<void> {
    let pages = 0;
    while (pages < 10 && token === historyWindowToken && conversationId.value) {
      const target = conversationId.value;
      const last = messages.value[messages.value.length - 1];
      const buffered = await listMessages(transport, target, last?.messageId, HISTORY_PAGE_SIZE);
      if (token !== historyWindowToken || conversationId.value !== target) return;
      const known = new Set(messages.value.map((message) => message.messageId));
      const fresh = buffered.filter((message) => !known.has(message.messageId));
      messages.value = [...messages.value, ...fresh];
      pages += 1;
      if (buffered.length < HISTORY_PAGE_SIZE) {
        pruneFinalAssistant();
        return;
      }
    }
    pruneFinalAssistant();
  }

  /**
   * Send a chat turn: mint (or reuse) an idempotency key, create the
   * generation, stream it to a terminal state, then append the newly committed
   * messages. If sendGeneration returns null (existence-hidden failure), the
   * phase transitions to "failed" without faking success.
   *
   * WP-D（缺口1）：幂等键生命周期——结果未知（网络失败/超时/2xx 解析失败/
   * 5xx 响应确认：服务端可能在持久化 generation 之后才失败）保留 (content,key)，
   * 重试同键由后端幂等去重；确定失败（4xx 响应确认）或成功后清除，
   * 下一次允许新键。页面层持有覆盖"建会话+发送"的提交互斥；本函数的
   * generationStarting 是 store 层的同一互斥的复用入口。
   */
  async function send(
    transport: ChatTransport,
    deps: RealtimeDeps,
    content: string,
    opts?: { sourceUserMessageId?: string },
  ): Promise<void> {
    if (generationStarting.value || isStreaming.value) return;
    if (!conversationId.value) {
      phase.value = "failed";
      return;
    }
    // M2：新一轮提交同步接管 turn 归属——作废旧 turn 的在途取消/手动核对
    // 回调，并结束旧 turn 的"取消待确认"状态（其终态由旧回调在作废前确认，
    // 或用户切回该会话时经快照恢复）。
    turnSeq += 1;
    const submitSeq = turnSeq;
    cancelUnconfirmed.value = false;
    // N-06（缺口4）：上一轮遗留的"记录同步暂未成功"随新一轮提交结束。
    finalSyncFailed.value = false;
    // N-05：本轮 source 由快照核对重新捕获；新提交开始即作废旧值。
    lastTurnSource.value = "";
    // N-05：POST 尚未确认——本轮暂不持有 generation（旧轮残留不劫持重试）。
    turnHasGeneration.value = false;
    generationStarting.value = true;
    lastTransport = transport; // CANCEL-A: cancel() confirms through this transport
    lastDeps = deps; // WP-D（缺口3）: cancel() verifies through fetchSnapshot
    pendingUserContent.value = content; // STREAM-ECHO: echo + retry source
    // round7（P1）：turn 开始时持有窗口令牌；流期间窗口被销毁/切换的话，
    // 终局后的补页不再写回（appendNewMessages 内部再校验一次）。
    const ownedToken = historyWindowToken;
    // 缺陷6：发起时同步捕获完整归属身份。POST /generations 返回（成功与
    // 失败两条路径）后、启动 SSE 或写任何 turn 状态之前校验身份未变；
    // 用户在 await 期间切换/重建窗口时，晚到的旧会话响应一律静默丢弃。
    // N-05：恢复标识的账号/关系/会话配对同样取发起时快照，晚到保存不得
    // 用当前 ref 拼出错误配对。
    const submission = {
      accountId: boundAccountId.value,
      relationshipId: boundRelationshipId.value,
      conversationId: conversationId.value,
      windowToken: ownedToken,
    };
    const submissionStillCurrent = (): boolean =>
      conversationId.value === submission.conversationId &&
      historyWindowToken === submission.windowToken;
    // N-05：提交身份包含 turn 序号——离页（detachInFlight）或新一轮提交都会
    // 递增 turnSeq，晚到的 POST 成功响应不得重启流（T-43）。
    const submissionUnsuperseded = (): boolean =>
      submissionStillCurrent() && turnSeq === submitSeq;
    // N-05（T-34）：本次提交是否复用了既有未知请求的键。复用键的重试得到
    // 4xx 只证明本次重试被拒，不得清除仍待核对的上一请求。
    const reusedPendingKey = Boolean(
      lastSendKey &&
        lastSendKey.conversationId === submission.conversationId &&
        lastSendKey.content === content,
    );
    const idempotencyKey = reusedPendingKey ? lastSendKey!.key : crypto.randomUUID();
    let generation: Generation | null;
    try {
      generation = await sendGeneration(
        transport,
        submission.conversationId,
        idempotencyKey,
        content,
        opts?.sourceUserMessageId,
      );
    } catch (error) {
      // 结果未知（网络/超时/协议失败，以及服务端持久化后才失败的 5xx）：保留
      // 同键供重试（绑定提交会话，换会话不复用），由后端幂等去重；确定失败
      // （4xx 响应确认）只清本次"新铸造"的键——复用键的重试被 4xx 拒绝时，
      // 被代表的此前未知请求仍待核对，键必须保留。
      const unknownOutcome = !(error instanceof ChatHttpError && error.status < 500);
      if (unknownOutcome) {
        lastSendKey = { conversationId: submission.conversationId, content, key: idempotencyKey };
      } else if (!reusedPendingKey && lastSendKey?.key === idempotencyKey) {
        lastSendKey = null;
      }
      throw error;
    } finally {
      generationStarting.value = false;
    }
    // 缺陷6 + N-05：成功响应晚到且归属已变时静默丢弃——不启动流、不写
    // phase/stream/lastSendKey。恢复标识仅在发起时捕获的账号/关系绑定仍未
    // 变（注销/换号后的旧响应不得恢复旧身份）且无既有条目时，按发起时的
    // 会话配对保存；已有更新条目（更新轮次）不覆盖。
    if (!submissionUnsuperseded()) {
      console.debug(
        "[chat] dropped a late generation response: submission no longer owns the turn",
      );
      if (
        generation?.generationId &&
        submission.accountId &&
        submission.accountId === boundAccountId.value &&
        submission.relationshipId === boundRelationshipId.value &&
        !loadRestorableGeneration(safeSessionStorage())
      ) {
        saveRestorableGeneration(safeSessionStorage(), {
          accountId: submission.accountId,
          relationshipId: submission.relationshipId,
          conversationId: submission.conversationId,
          generationId: generation.generationId,
          savedAtEpochMs: Date.now(),
        });
      }
      return;
    }
    // 键的确定清除只在服务端已确认时发生：成功（拿到 generation）无条件清；
    // 存在性隐藏（403/404→null）只证明本次请求被拒，不证明此前未知请求的
    // 结局——复用键的重试不得清除原键，仅本次新铸且确属本次的键才清，与
    // catch 分支的确定失败清键守卫完全镜像。
    if (generation) {
      lastSendKey = null;
    } else if (!reusedPendingKey && lastSendKey?.key === idempotencyKey) {
      lastSendKey = null;
    }
    if (!generation) {
      phase.value = "failed";
      outcome.value = null;
      return;
    }
    await run(deps, generation.generationId, 1);
    // WP-D：只向前追加本 turn 之后的新行，长对话中用户已翻出的更早窗口
    // 保持完整；补页失败不再误报"更早的消息"错误态——改置 finalSyncFailed
    // （回复已完成、记录同步暂未成功），保留同步重试入口。N-05：本轮
    // source 不再用窗口最后一条 user 行猜测，由快照路径权威捕获。
    if (ownedToken !== historyWindowToken || !conversationId.value) return;
    // N-06：SSE 完成事件不带消息 ID——补页的同时并行发起一次有界快照核对
    // 确认本轮持久行身份（不增加串行等待）。仅本轮确已完成且过渡行仍无
    // 真实 ID 时进行；取消核对/快照恢复路径自带的 ID 不在此重复核对。
    const finalVerify =
      phase.value === "completed" && finalAssistant.value?.messageId === null
        ? confirmFinalIdentity(deps, generation.generationId, submitSeq)
        : Promise.resolve();
    try {
      await appendNewMessages(transport, ownedToken);
    } catch {
      if (ownedToken === historyWindowToken) {
        finalSyncFailed.value = true;
      }
    }
    await finalVerify;
  }

  return {
    phase,
    generationId,
    stream,
    outcome,
    lastDisconnect,
    conversationId,
    messages,
    conversations,
    historyHasMore,
    historyLoadFailed,
    recentLoadFailed,
    cancelUnconfirmed,
    finalAssistant,
    finalSyncFailed,
    lastTurnSource,
    turnHasGeneration,
    pendingUserContent,
    generationStarting,
    draft,
    isStreaming,
    isTerminal,
    terminalFault,
    displayMessages,
    run,
    recoverInFlight,
    tryRestoreAfterReload,
    bindGenerationContext,
    cancel,
    detachInFlight,
    retryFinalSync,
    resolveTurnSource,
    reset,
    initConversation,
    send,
    loadHistory,
    loadConversations,
    openConversation,
    loadMoreHistory,
  };
});
