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

import { defineStore } from "pinia";
import { computed, ref } from "vue";

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
  let handle: StreamHandle | null = null;
  let runSequence = 0;

  /** The rendered draft: joined delta payloads of the contiguous events only. */
  const draft = computed(() =>
    stream.value.events
      .filter((e) => e.eventType === "chat.delta")
      .map((e) => String((e as StreamEvent).payload ?? ""))
      .join(""),
  );

  const isStreaming = computed(() => phase.value === "streaming");
  const isTerminal = computed(() => stream.value.terminal);

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

  function cancel(): void {
    if (handle) {
      handle.cancelled = true;
      handle.abort();
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
    handle = null;
  }

  return {
    phase,
    generationId,
    stream,
    outcome,
    draft,
    isStreaming,
    isTerminal,
    run,
    cancel,
    reset,
  };
});
