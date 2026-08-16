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
  listConversations,
  listMessages,
  renameConversation as apiRenameConversation,
  sendGeneration,
  type ChatTransport,
  type ConversationListItem,
  type CreateConversationResponse,
  type Message,
} from "@/api/chat";
import { listMemories } from "@/api/memory";
import {
  createStreamHandle,
  streamGeneration,
  type RealtimeDeps,
  type StreamHandle,
  type StreamOutcome,
} from "@/api/realtime";
import {
  initialState,
  type StreamState,
  type StreamEvent,
} from "@/domain/stream-reducer";

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
  // USAGE-VIZ: settled provider token usage of the last completed generation.
  const usage = ref<{ inputTokens: number; outputTokens: number } | null>(null);

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
    stream.value = initialState(initialEpoch);
    const current = createStreamHandle();
    handle = current;

    const result = await streamGeneration(deps, id, initialEpoch, current);

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
    }
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
    conversationId.value = "";
    messages.value = [];
    historyHasMore.value = false;
    pendingMemoryCount.value = 0;
    pendingUserContent.value = "";
    usage.value = null;
    handle = null;
    lastTransport = null;
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
  ): Promise<CreateConversationResponse | null> {
    const result = await createConversation(transport, relationshipId);
    if (result) {
      conversationId.value = result.conversationId;
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
    try {
      await advanceHistory(transport);
    } catch {
      // Non-fatal; the user keeps the loaded window.
    }
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
    );
    messages.value = [...messages.value, ...page];
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
    );
    if (!generation) {
      phase.value = "failed";
      outcome.value = null;
      return;
    }
    await run(deps, generation.generationId, 1);
    // CONV-HIST: append the pages after the loaded window instead of reloading
    // from scratch, so a long conversation keeps its earlier window intact.
    await advanceHistory(transport);
  }

  return {
    phase,
    generationId,
    stream,
    outcome,
    conversationId,
    messages,
    conversations,
    historyHasMore,
    pendingMemoryCount,
    pendingUserContent,
    usage,
    draft,
    isStreaming,
    isTerminal,
    terminalFault,
    displayMessages,
    run,
    cancel,
    reset,
    initConversation,
    send,
    loadHistory,
    loadConversations,
    openConversation,
    loadMoreHistory,
    refreshPendingMemoryCount,
    removeConversation,
    renameConversation,
  };
});
