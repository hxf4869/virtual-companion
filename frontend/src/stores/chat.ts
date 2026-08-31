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
  createConversation,
  deleteConversation as apiDeleteConversation,
  endConversation as apiEndConversation,
  deleteMessage as apiDeleteMessage,
  getServiceMode,
  listConversations,
  listMessages,
  recordFeedback,
  renameConversation as apiRenameConversation,
  sendGeneration,
  setMessageNoMemory as apiSetMessageNoMemory,
  asChatMode,
  type ChatMode,
  type ChatTransport,
  type ConversationListItem,
  type CreateConversationResponse,
  type Generation,
  type Message,
  type MessageFeedbackKind,
  type ServiceModeStatus,
} from "@/api/chat";
import { listMemories } from "@/api/memory";
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

/** CONV-HIST: history page size and the auto-advance page cap on open. */
const HISTORY_PAGE_SIZE = 50;
const MAX_AUTO_PAGES = 10;

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
  // round7（P1）：消息窗口所有权令牌。每次窗口重建（init/open/reset/删除或
  // 结束当前会话）递增；在途分页链路提交前必须持有与当前一致的令牌，晚到的
  // 旧会话响应一律丢弃，禁止把 B 会话的页面串写进已切换到 A 的窗口。
  let historyWindowToken = 0;
  // MEM-PROMPT: pending candidate count surfaced after a completed turn.
  const pendingMemoryCount = ref(0);
  // Only covers the generation-creation POST. The stream keeps using phase;
  // this small guard prevents a double tap from creating a second durable turn
  // before run() can transition the phase to streaming.
  const generationStarting = ref(false);
  let handle: StreamHandle | null = null;
  let runSequence = 0;
  // CANCEL-A: the transport of the most recent send, so cancel() can signal the
  // backend while tearing down the local stream immediately.
  let lastTransport: ChatTransport | null = null;
  // STREAM-ECHO: the content of the in-flight (or last failed) user turn, so the
  // page can echo it as a pending bubble while streaming and offer a one-click
  // retry after a terminal failure.
  const pendingUserContent = ref("");
  // USAGE-VIZ: settled provider token usage of the last completed generation.
  const usage = ref<{ inputTokens: number; outputTokens: number } | null>(null);
  // CHAT-MODE: the turn-level interaction mode for the next send. AUTO keeps
  // the persona default; LISTEN/DISCUSS override it for the turn. Sticky for
  // the page session (the page's mode chips write it via setMode).
  const selectedMode = ref<ChatMode>("AUTO");
  // FEEDBACK (FR-CHAT-003): kinds already submitted for the current generation
  // (per-kind idempotent in the UI; the server no-ops repeats anyway).
  const feedbackKinds = ref<MessageFeedbackKind[]>([]);
  // SVC-MODE (FR-RES-005): the current generation-service mode (null until
  // loaded; a failed read keeps null so the UI never invents a mode).
  const serviceMode = ref<ServiceModeStatus | null>(null);
  // INC-MODE (FR-CHAT-005): whether the OPEN conversation is incognito.
  const activeIncognito = ref(false);
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

  function saveRestorable(): void {
    if (!generationId.value || !conversationId.value) return;
    saveRestorableGeneration(safeSessionStorage(), {
      accountId: boundAccountId.value,
      relationshipId: boundRelationshipId.value,
      conversationId: conversationId.value,
      generationId: generationId.value,
      savedAtEpochMs: Date.now(),
    });
  }

  /** SVC-MODE: load the current service mode (non-fatal). */
  async function loadServiceMode(transport: ChatTransport): Promise<void> {
    try {
      serviceMode.value = await getServiceMode(transport);
    } catch {
      // Keep the previous value (usually null); the UI shows no mode.
    }
  }

  /** CHAT-MODE: narrow arbitrary chip input to an approved mode (no-op otherwise). */
  function setMode(mode: unknown): void {
    const narrowed = asChatMode(mode);
    if (narrowed) {
      selectedMode.value = narrowed;
    }
  }

  /**
   * FEEDBACK: submit one feedback kind for the current generation. Repeated
   * submissions of the same kind are no-ops; an existence-hidden failure (the
   * generation is gone) is ignored so the UI never fakes success or discloses
   * anything. Returns true only when this call recorded the kind; a repeat
   * of an already-recorded kind is a no-op and returns false.
   */
  async function sendFeedback(
    transport: ChatTransport,
    kind: MessageFeedbackKind,
  ): Promise<boolean> {
    const id = generationId.value;
    if (!id || feedbackKinds.value.includes(kind)) return false;
    try {
      const recorded = await recordFeedback(transport, id, kind);
      if (recorded) {
        feedbackKinds.value = [...feedbackKinds.value, kind];
        return true;
      }
    } catch {
      // Non-fatal: keep the previous state; the user can tap again.
    }
    return false;
  }

  /**
   * Go v1 重连先发送 chat.snapshot（当前完整草稿），之后才继续 delta。
   * 每个 snapshot 都替换此前的局部串，避免断线重连后重复拼接。
   */
  const draft = computed(() => {
    let text = "";
    for (const event of stream.value.events) {
      if (event.eventType === "chat.snapshot") {
        text = String((event as StreamEvent).payload ?? "");
      } else if (event.eventType === "chat.delta") {
        text += String((event as StreamEvent).payload ?? "");
      }
    }
    return text;
  });

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
    return msgs;
  });

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
    generationId.value = id;
    phase.value = "streaming";
    outcome.value = null;
    lastDisconnect.value = null;
    // S0-20: persist non-sensitive ids so a full page reload can find the
    // pending turn again (server snapshot remains the authority).
    saveRestorable();
    if (!opts?.resumeFrom) {
      stream.value = initialState(initialEpoch);
      feedbackKinds.value = []; // FEEDBACK: fresh generation, fresh feedback state
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
    stream.value = result.state;
    outcome.value = result.outcome;

    if (result.outcome === "completed") {
      phase.value = "completed";
      pendingUserContent.value = "";
      // USAGE-VIZ: the usage row settles in the same transaction as the
      // terminal event, so it is already visible in the snapshot endpoint.
      await refreshUsage(deps);
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
    if (result.outcome !== "exhausted" && result.outcome !== "not_found_or_forbidden") {
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
    if (phase.value === "completed" || phase.value === "cancelled" || phase.value === "blocked") {
      return;
    }
    if (handle && !handle.cancelled) return;

    let snapshot;
    try {
      snapshot = await deps.fetchSnapshot(id);
    } catch {
      lastDisconnect.value = "network";
      return;
    }
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
      const mapped =
        next.terminalEventType === "chat.completed"
          ? "completed"
          : next.terminalEventType === "chat.cancelled"
            ? "cancelled"
            : next.terminalEventType === "chat.blocked"
              ? "blocked"
              : next.terminalEventType === "chat.failed"
                ? "failed"
                : "exhausted";
      outcome.value = mapped;
      if (mapped === "completed") {
        phase.value = "completed";
        pendingUserContent.value = "";
        await refreshUsage(deps);
      } else if (mapped === "cancelled") {
        phase.value = "cancelled";
        pendingUserContent.value = "";
      } else if (mapped === "blocked") {
        phase.value = "blocked";
        pendingUserContent.value = "";
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
   * CANCEL-A: signal the backend once, but never wait for that HTTP request
   * before tearing down the local SSE. The request is best-effort because an
   * offline or permanently pending connection must not trap the UI in a live
   * stream after the user has cancelled it.
   */
  async function cancel(): Promise<void> {
    const current = handle;
    if (!current) return;
    current.cancelled = true;
    const transport = lastTransport;
    const id = generationId.value;
    if (transport && id) {
      void cancelGeneration(transport, id).catch(() => null);
    }
    current.abort();
    // S0-20: the user chose to leave this turn — drop the recovery entry.
    clearRestorableGeneration(safeSessionStorage());
  }

  /**
   * S0-20: detach the page from a live stream without cancelling the durable
   * generation. A route change or full reload destroys the current fetch, but
   * the privacy-safe recovery entry must survive so the next page instance can
   * re-anchor from the server snapshot.
   */
  function detachInFlight(): void {
    if (handle) {
      handle.cancelled = true;
      handle.abort();
    }
    runSequence += 1; // the aborted run must not commit "cancelled" and clear recovery
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
    phase.value = "idle";
    generationId.value = "";
    stream.value = initialState(0);
    outcome.value = null;
    lastDisconnect.value = null;
    conversationId.value = "";
    messages.value = [];
    historyHasMore.value = false;
    historyWindowToken += 1; // round7（P1）：窗口销毁作废一切在途分页链路
    pendingMemoryCount.value = 0;
    pendingUserContent.value = "";
    usage.value = null;
    selectedMode.value = "AUTO";
    feedbackKinds.value = [];
    activeIncognito.value = false;
    // SVC-MODE: the service mode is a session-level ops fact — reset() is also
    // called by startConversation() and must NOT clear it.
    handle = null;
    lastTransport = null;
    // S0-20: logout / conversation teardown drops the recovery entry and its
    // owner binding (换号/登出后不得恢复上一账号的在途状态).
    boundAccountId.value = "";
    boundRelationshipId.value = "";
    clearRestorableGeneration(safeSessionStorage());
  }

  /**
   * USAGE-VIZ: pull the settled usage of the completed generation from the
   * snapshot endpoint (the same one snapshot recovery uses). Non-fatal — a
   * failed read keeps the previous usage.
   */
  async function refreshUsage(deps: RealtimeDeps): Promise<void> {
    if (!generationId.value) return;
    try {
      const snapshot = await deps.fetchSnapshot(generationId.value);
      if (snapshot.ok && snapshot.usage) {
        usage.value = snapshot.usage;
      }
    } catch {
      // Keep the previous usage.
    }
  }

  /**
   * Create a conversation under a relationship and load its message history.
   * The page calls this on mount to establish the chat context.
   */
  async function initConversation(
    transport: ChatTransport,
    relationshipId: string,
    incognito?: boolean,
  ): Promise<CreateConversationResponse | null> {
    const result = await createConversation(transport, relationshipId, incognito);
    if (result) {
      conversationId.value = result.conversationId;
      // INC-MODE: the frozen creation-time flag becomes the active state.
      activeIncognito.value = incognito === true;
      await loadHistory(transport);
    }
    return result;
  }

  /** Reload message history for the current conversation from scratch. */
  async function loadHistory(transport: ChatTransport): Promise<void> {
    if (!conversationId.value) return;
    // 窗口重建即认领新令牌：任何更早的在途分页链路就此作废。
    const token = ++historyWindowToken;
    messages.value = [];
    historyHasMore.value = true;
    try {
      await advanceHistory(transport, token);
    } catch {
      // History load failure is non-fatal — the stream result is already
      // committed and the user can retry. Do not surface as a phase change.
    }
  }

  // ---- CONV-HIST: conversation list + history pagination ----

  /** Load the first page of the caller's conversations (optionally scoped). */
  async function loadConversations(
    transport: ChatTransport,
    relationshipId?: string,
  ): Promise<void> {
    try {
      conversations.value = await listConversations(transport, relationshipId);
    } catch {
      // Non-fatal: keep the current list; the page can retry on next visit.
    }
  }

  /**
   * CONV-MGMT: delete one conversation. On a confirmed delete the list entry
   * is dropped; when the deleted conversation was the open one, the message
   * window is cleared so the page can open (or create) a fresh conversation.
   */
  /**
   * END-TODAY: end the open conversation. Cancels the local stream, then
   * calls the shipped end API. The conversation row stays in the list;
   * only the local input/stream state is torn down when it was the open one.
   */
  async function endToday(transport: ChatTransport, id: string): Promise<boolean> {
    if (handle) {
      handle.cancelled = true;
      handle.abort();
    }
    const result = await apiEndConversation(transport, id);
    if (!result) return false;
    if (conversationId.value === id) {
      phase.value = "idle";
      generationId.value = "";
      stream.value = initialState(0);
      outcome.value = null;
      conversationId.value = "";
      messages.value = [];
      historyHasMore.value = false;
      historyWindowToken += 1; // round7（P1）：窗口销毁作废在途分页
      pendingUserContent.value = "";
      usage.value = null;
      feedbackKinds.value = [];
      activeIncognito.value = false;
    }
    conversations.value = conversations.value.map((c) =>
      c.conversationId === id && result.incognitoCleared
        ? { ...c, lastMessagePreview: "" }
        : c,
    );
    return true;
  }

  async function removeConversation(transport: ChatTransport, id: string): Promise<boolean> {
    const ok = await apiDeleteConversation(transport, id);
    if (!ok) return false;
    conversations.value = conversations.value.filter((c) => c.conversationId !== id);
    if (conversationId.value === id) {
      conversationId.value = "";
      messages.value = [];
      historyHasMore.value = false;
      historyWindowToken += 1; // round7（P1）：窗口销毁作废在途分页
    }
    return true;
  }

  /**
   * CONV-MGMT: rename one conversation. Only a confirmed API result updates
   * the list entry (a blank title clears the rename server-side).
   */
  async function renameConversation(
    transport: ChatTransport,
    id: string,
    title: string,
  ): Promise<boolean> {
    const applied = await apiRenameConversation(transport, id, title);
    if (applied === null) return false;
    conversations.value = conversations.value.map((c) =>
      c.conversationId === id ? { ...c, title: applied } : c,
    );
    return true;
  }

  /**
   * MEM-PROMPT: count the relationship's PENDING_CONFIRMATION candidates so
   * the chat page can prompt the user to confirm. Non-fatal — a failure keeps
   * the previous count (the memory page remains the authoritative surface).
   */
  async function refreshPendingMemoryCount(
    transport: ChatTransport,
    relationshipId: string,
  ): Promise<void> {
    try {
      const memories = await listMemories(transport, relationshipId);
      pendingMemoryCount.value = memories.filter(
        (m) => m.status === "PENDING_CONFIRMATION",
      ).length;
    } catch {
      // Keep the previous count.
    }
  }

  /**
   * Switch to an existing conversation: reset the message window and page
   * forward from the beginning until the end (capped) so the user lands on
   * the latest messages. Switching mid-stream is refused — the current run
   * must reach its terminal first.
   */
  async function openConversation(transport: ChatTransport, id: string): Promise<boolean> {
    if (isStreaming.value) return false;
    if (id === conversationId.value) return true;
    const previous = {
      conversationId: conversationId.value,
      messages: messages.value,
      historyHasMore: historyHasMore.value,
      feedbackKinds: feedbackKinds.value,
      activeIncognito: activeIncognito.value,
    };
    conversationId.value = id;
    messages.value = [];
    historyHasMore.value = true;
    // round7（P1）：切窗即作废旧令牌；本链路此后持有自己的快照继续分页。
    const token = ++historyWindowToken;
    feedbackKinds.value = []; // FEEDBACK: feedback tracks the active generation
    // INC-MODE: mirror the opened conversation's frozen flag.
    activeIncognito.value =
      conversations.value.find((c) => c.conversationId === id)?.incognito === true;
    try {
      await advanceHistory(transport, token);
    } catch {
      // A failed switch must not masquerade as a valid empty conversation.
      // Roll back only when this request still owns the active window; a later
      // user switch has a newer token and remains authoritative.
      if (token === historyWindowToken) {
        historyWindowToken += 1;
        conversationId.value = previous.conversationId;
        messages.value = previous.messages;
        historyHasMore.value = previous.historyHasMore;
        feedbackKinds.value = previous.feedbackKinds;
        activeIncognito.value = previous.activeIncognito;
      }
      return false;
    }
    return true;
  }

  /**
   * MSG-DELETE (FR-CHAT-004): delete one message of the open conversation.
   * Only a confirmed server delete drops the local row; an existence-hidden
   * false keeps it (the server may already have removed it elsewhere).
   */
  async function removeMessage(
    transport: ChatTransport,
    messageId: string,
  ): Promise<boolean> {
    if (!conversationId.value) return false;
    const deleted = await apiDeleteMessage(transport, conversationId.value, messageId);
    if (deleted) {
      messages.value = messages.value.filter((m) => m.messageId !== messageId);
    }
    return deleted;
  }

  /**
   * MEM-NEG (V44): flip the 不记住 marker of one message of the open
   * conversation. Only a confirmed server response updates the local row;
   * an existence-hidden null keeps it unchanged.
   */
  async function setMessageNoMemory(
    transport: ChatTransport,
    messageId: string,
    noMemory: boolean,
  ): Promise<boolean> {
    if (!conversationId.value) return false;
    const updated = await apiSetMessageNoMemory(
      transport,
      conversationId.value,
      messageId,
      noMemory,
    );
    if (updated) {
      messages.value = messages.value.map((m) =>
        m.messageId === messageId ? { ...m, noMemory: updated.noMemory } : m,
      );
    }
    return !!updated;
  }

  /**
   * Append the next page of history after the last loaded message.
   * round7（P1）：响应落到本请求的局部缓冲里，提交前再校验窗口令牌与目标
   * 会话——晚到的旧会话页面既不进全局 messages，也不改写 historyHasMore。
   */
  async function loadMoreHistory(transport: ChatTransport, token: number = historyWindowToken): Promise<void> {
    if (!conversationId.value || !historyHasMore.value || token !== historyWindowToken) return;
    const target = conversationId.value;
    const last = messages.value[messages.value.length - 1];
    const bufferedPage = await listMessages(
      transport,
      target,
      last?.messageId,
      HISTORY_PAGE_SIZE,
    );
    if (token !== historyWindowToken || conversationId.value !== target) return;
    messages.value = [...messages.value, ...bufferedPage];
    historyHasMore.value = bufferedPage.length >= HISTORY_PAGE_SIZE;
  }

  /**
   * Page forward until the end of the history or the auto-advance cap
   * ({@link MAX_AUTO_PAGES}); beyond the cap the page offers manual load-more.
   * round7（P1）：持有窗口令牌的分页循环——令牌过期即刻停止发起下一页。
   */
  async function advanceHistory(transport: ChatTransport, token: number = historyWindowToken): Promise<void> {
    let pages = 0;
    while (
      historyHasMore.value &&
      pages < MAX_AUTO_PAGES &&
      token === historyWindowToken &&
      conversationId.value
    ) {
      await loadMoreHistory(transport, token);
      pages += 1;
    }
  }

  /**
   * Send a chat turn: mint an idempotency key, create the generation, stream it
   * to a terminal state, then reload history to pick up the final assistant
   * message. If sendGeneration returns null (existence-hidden failure), the
   * phase transitions to "failed" without faking success.
   */
  async function send(
    transport: ChatTransport,
    deps: RealtimeDeps,
    content: string,
  ): Promise<void> {
    if (generationStarting.value) return;
    if (!conversationId.value) {
      phase.value = "failed";
      return;
    }
    generationStarting.value = true;
    lastTransport = transport; // CANCEL-A: cancel() confirms through this transport
    pendingUserContent.value = content; // STREAM-ECHO: echo + retry source
    // round7（P1）：turn 开始时持有窗口令牌；流期间窗口被销毁/切换的话，
    // 终局后的补页不再写回（advanceHistory/loadHistory 内部再校验一次）。
    const ownedToken = historyWindowToken;
    let generation: Generation | null;
    try {
      const idempotencyKey = crypto.randomUUID();
      generation = await sendGeneration(
        transport,
        conversationId.value,
        idempotencyKey,
        content,
        selectedMode.value,
      );
    } finally {
      generationStarting.value = false;
    }
    if (!generation) {
      phase.value = "failed";
      outcome.value = null;
      return;
    }
    await run(deps, generation.generationId, 1);
    // CONV-HIST: append the pages after the loaded window instead of reloading
    // from scratch, so a long conversation keeps its earlier window intact.
    // A previously exhausted window has historyHasMore=false, but this turn
    // has just committed new rows after that cursor and must reopen one page.
    if (ownedToken !== historyWindowToken || !conversationId.value) return;
    historyHasMore.value = true;
    await advanceHistory(transport, ownedToken);
  }

  /** Regenerate the latest reply against its existing user message. Go v1
   * makes the new result current; retired version-selection UI is not loaded. */
  async function regenerate(
    transport: ChatTransport,
    deps: RealtimeDeps,
    sourceUserMessageId: string,
    content: string,
  ): Promise<void> {
    if (generationStarting.value) return;
    if (!conversationId.value) {
      phase.value = "failed";
      return;
    }
    generationStarting.value = true;
    lastTransport = transport;
    pendingUserContent.value = content;
    let generation: Generation | null;
    try {
      generation = await sendGeneration(
        transport,
        conversationId.value,
        crypto.randomUUID(),
        content,
        selectedMode.value,
        sourceUserMessageId,
      );
    } finally {
      generationStarting.value = false;
    }
    if (!generation) {
      phase.value = "failed";
      outcome.value = null;
      return;
    }
    await run(deps, generation.generationId, 1);
    await loadHistory(transport);
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
    pendingMemoryCount,
    pendingUserContent,
    generationStarting,
    regenerate,
    usage,
    selectedMode,
    setMode,
    feedbackKinds,
    sendFeedback,
    serviceMode,
    loadServiceMode,
    activeIncognito,
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
    reset,
    initConversation,
    send,
    loadHistory,
    loadConversations,
    openConversation,
    loadMoreHistory,
    removeMessage,
    setMessageNoMemory,
    refreshPendingMemoryCount,
    endToday,
    removeConversation,
    renameConversation,
  };
});
