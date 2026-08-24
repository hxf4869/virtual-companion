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
// history on completion. sessionId is supplied by the page (client-generated
// UUID per chat session).

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
  listGenerationVersions,
  selectGenerationVersion,
  asChatMode,
  type ChatMode,
  type ChatTransport,
  type ConversationListItem,
  type CreateConversationResponse,
  type GenerationVersion,
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
  // MEM-PROMPT: pending candidate count surfaced after a completed turn.
  const pendingMemoryCount = ref(0);
  let handle: StreamHandle | null = null;
  let runSequence = 0;
  // CANCEL-A: the transport of the most recent send, so cancel() can confirm the
  // backend cancellation before tearing down the local stream.
  let lastTransport: ChatTransport | null = null;
  // STREAM-ECHO: the content of the in-flight (or last failed) user turn, so the
  // page can echo it as a pending bubble while streaming and offer a one-click
  // retry after a terminal failure.
  const pendingUserContent = ref("");
  // GEN-VER: versions keyed by source user message id.
  const versionsByUserMessage = ref<Record<string, GenerationVersion[]>>({});
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

  /** The rendered draft: joined delta payloads of the contiguous events only. */
  const draft = computed(() =>
    stream.value.events
      .filter((e) => e.eventType === "chat.delta")
      .map((e) => String((e as StreamEvent).payload ?? ""))
      .join(""),
  );

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
   * CANCEL-A: confirm the backend cancellation first, then tear down the local
   * SSE. The database terminal state stays the source of truth; the API call
   * only signals the in-flight provider session server-side. A backend failure
   * (offline, already terminal, existence hidden) never blocks the local abort.
   */
  async function cancel(): Promise<void> {
    const current = handle;
    if (!current) return;
    current.cancelled = true;
    const transport = lastTransport;
    const id = generationId.value;
    if (transport && id) {
      try {
        await cancelGeneration(transport, id);
      } catch {
        // Local teardown proceeds regardless; the reducer outcome stays
        // "cancelled" and the backend terminal state rules.
      }
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
    pendingMemoryCount.value = 0;
    pendingUserContent.value = "";
    versionsByUserMessage.value = {};
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
    messages.value = [];
    historyHasMore.value = true;
    try {
      await advanceHistory(transport);
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
  async function openConversation(transport: ChatTransport, id: string): Promise<void> {
    if (isStreaming.value || id === conversationId.value) return;
    conversationId.value = id;
    messages.value = [];
    historyHasMore.value = true;
    feedbackKinds.value = []; // FEEDBACK: feedback tracks the active generation
    // INC-MODE: mirror the opened conversation's frozen flag.
    activeIncognito.value =
      conversations.value.find((c) => c.conversationId === id)?.incognito === true;
    try {
      await advanceHistory(transport);
    } catch {
      // Non-fatal; the user keeps the loaded window.
    }
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

  /** Append the next page of history after the last loaded message. */
  async function loadMoreHistory(transport: ChatTransport): Promise<void> {
    if (!conversationId.value || !historyHasMore.value) return;
    const last = messages.value[messages.value.length - 1];
    const page = await listMessages(
      transport,
      conversationId.value,
      last?.messageId,
      HISTORY_PAGE_SIZE,
    );    messages.value = [...messages.value, ...page];
    historyHasMore.value = page.length >= HISTORY_PAGE_SIZE;
  }

  /**
   * Page forward until the end of the history or the auto-advance cap
   * ({@link MAX_AUTO_PAGES}); beyond the cap the page offers manual load-more.
   */
  async function advanceHistory(transport: ChatTransport): Promise<void> {
    let pages = 0;
    while (historyHasMore.value && pages < MAX_AUTO_PAGES) {
      await loadMoreHistory(transport);
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
    lastTransport = transport; // CANCEL-A: cancel() confirms through this transport
    pendingUserContent.value = content; // STREAM-ECHO: echo + retry source
    if (!conversationId.value) {
      phase.value = "failed";
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    const generation = await sendGeneration(
      transport,
      conversationId.value,
      idempotencyKey,
      content,
      selectedMode.value,
    );
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
    historyHasMore.value = true;
    await advanceHistory(transport);
  }

  /** GEN-VER: regenerate against an existing user message (no second user row). */
  async function regenerate(
    transport: ChatTransport,
    deps: RealtimeDeps,
    sourceUserMessageId: string,
    content: string,
  ): Promise<void> {
    lastTransport = transport;
    pendingUserContent.value = content;
    if (!conversationId.value) {
      phase.value = "failed";
      return;
    }
    const generation = await sendGeneration(
      transport,
      conversationId.value,
      crypto.randomUUID(),
      content,
      selectedMode.value,
      sourceUserMessageId,
    );
    if (!generation) {
      phase.value = "failed";
      outcome.value = null;
      return;
    }
    await run(deps, generation.generationId, 1);
    await loadHistory(transport);
    await loadVersions(transport, sourceUserMessageId);
  }

  async function loadVersions(transport: ChatTransport, userMessageId: string): Promise<void> {
    try {
      const rows = await listGenerationVersions(transport, userMessageId);
      versionsByUserMessage.value = {
        ...versionsByUserMessage.value,
        [userMessageId]: rows,
      };
    } catch {
      // Non-fatal: the selected version is already in history.
    }
  }

  async function selectVersion(
    transport: ChatTransport,
    generationId: string,
    userMessageId: string,
  ): Promise<boolean> {
    const row = await selectGenerationVersion(transport, generationId);
    if (!row) return false;
    await loadHistory(transport);
    await loadVersions(transport, userMessageId);
    return true;
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
    versionsByUserMessage,
    loadVersions,
    regenerate,
    selectVersion,
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
