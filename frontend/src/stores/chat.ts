// TASK-0026: Pinia chat store binding the realtime client to the H5 UI.
//
// The store owns the stream state, the overall outcome, and a cancel handle the
// page can flip. Transport deps are injected at call time so the store spec can
// mock resume/snapshot exactly like api/realtime.spec.ts. The store never
// fabricates deltas: it only reflects the reducer state produced by
// streamGeneration.

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
    generationId.value = id;
    phase.value = "streaming";
    outcome.value = null;
    stream.value = initialState(initialEpoch);
    handle = createStreamHandle();

    const result = await streamGeneration(deps, id, initialEpoch, handle);

    stream.value = result.state;
    outcome.value = result.outcome;

    if (result.outcome === "completed") {
      phase.value = "completed";
    } else if (result.outcome === "cancelled") {
      phase.value = "cancelled";
    } else {
      phase.value = "failed";
    }
    handle = null;
  }

  function cancel(): void {
    if (handle) {
      handle.cancelled = true;
    }
  }

  function reset(): void {
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
