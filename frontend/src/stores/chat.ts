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
  listMessages,
  sendGeneration,
  type ChatTransport,
  type CreateConversationResponse,
  type Message,
} from "@/api/chat";
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

export type ChatPhase = "idle" | "streaming" | "completed" | "cancelled" | "failed";

export const useChatStore = defineStore("h5-chat", () => {
  const phase = ref<ChatPhase>("idle");
  const generationId = ref<string>("");
  const stream = ref<StreamState>(initialState(0));
  const outcome = ref<StreamOutcome | null>(null);
  const conversationId = ref<string>("");
  const messages = ref<Message[]>([]);
  let handle: StreamHandle | null = null;
  let runSequence = 0;
  // CANCEL-A: the transport of the most recent send, so cancel() can confirm the
  // backend cancellation before tearing down the local stream.
  let lastTransport: ChatTransport | null = null;

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
   * Messages to display: committed history plus the live streaming draft as a
   * pending assistant message (so the user sees incremental output in context).
   */
  const displayMessages = computed<Message[]>(() => {
    const msgs = [...messages.value];
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
    } else if (result.outcome === "cancelled") {
      phase.value = "cancelled";
    } else {
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
    handle = null;
    lastTransport = null;
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

  /** Reload message history for the current conversation. */
  async function loadHistory(transport: ChatTransport): Promise<void> {
    if (!conversationId.value) return;
    try {
      messages.value = await listMessages(transport, conversationId.value);
    } catch {
      // History load failure is non-fatal — the stream result is already
      // committed and the user can retry. Do not surface as a phase change.
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
    await loadHistory(transport);
  }

  return {
    phase,
    generationId,
    stream,
    outcome,
    conversationId,
    messages,
    draft,
    isStreaming,
    isTerminal,
    displayMessages,
    run,
    cancel,
    reset,
    initConversation,
    send,
    loadHistory,
  };
});
