// DATA-VIEW (FR-DATA-001): read-only overview of the caller's stored data.
// Composes existing list APIs; does not invent account/report endpoints.

import { defineStore } from "pinia";
import { ref } from "vue";

import { listConversations, getServiceMode, type ConversationListItem, type ServiceModeStatus } from "@/api/chat";
import { listConsents, type ConsentRecord } from "@/api/consent";
import { listMemories, type Memory } from "@/api/memory";
import { listRelationships, type Relationship } from "@/api/relationship";
import {
  IDLE_ASYNC,
  beginAsync,
  markFailure,
  markPartial,
  markSuccess,
  type AsyncState,
} from "@/domain/async-state";

export interface DataTransport {
  request(method: string, path: string, body?: unknown): Promise<{
    ok: boolean;
    status: number;
    json: unknown;
  }>;
}

export type DataMemory = Memory & { relationshipId: string };

export const useDataStore = defineStore("h5-data", () => {
  const relationships = ref<Relationship[]>([]);
  const conversations = ref<ConversationListItem[]>([]);
  const memories = ref<DataMemory[]>([]);
  const consents = ref<ConsentRecord[]>([]);
  const serviceMode = ref<ServiceModeStatus | null>(null);
  const loadFailed = ref(false);
  const busy = ref(false);
  const asyncState = ref<AsyncState>({ ...IDLE_ASYNC });

  async function load(transport: DataTransport): Promise<void> {
    loadFailed.value = false;
    busy.value = true;
    asyncState.value = beginAsync(asyncState.value);
    const previousMemories = memories.value;
    try {
      // Ownership data fails the page as a whole; the service mode is
      // advisory (non-fatal by contract) and per-relationship detail pages
      // degrade to empty instead of failing the whole overview.
      const [rels, convs, consentRows] = await Promise.all([
        listRelationships(transport),
        listConversations(transport),
        listConsents(transport),
      ]);
      relationships.value = rels;
      conversations.value = convs;
      consents.value = consentRows;
      serviceMode.value = await getServiceMode(transport).catch(() => null);
      const failedDomains: string[] = [];
      const memoryPages = await Promise.all(
        rels.map(async (rel) => {
          try {
            const page = await listMemories(transport, rel.relationshipId);
            return page.map((row) => ({ ...row, relationshipId: rel.relationshipId }));
          } catch {
            failedDomains.push("memory");
            return previousMemories.filter((row) => row.relationshipId === rel.relationshipId);
          }
        }),
      );
      memories.value = memoryPages.flat();
      const uniqueFailed = [...new Set(failedDomains)];
      if (uniqueFailed.length > 0) {
        asyncState.value = {
          ...markPartial(uniqueFailed),
          stale: previousMemories.length > 0,
        };
      } else {
        asyncState.value = markSuccess();
      }
    } catch {
      loadFailed.value = true;
      asyncState.value = markFailure(
        asyncState.value,
        "overview",
        relationships.value.length > 0,
      );
    } finally {
      busy.value = false;
    }
  }

  function reset(): void {
    relationships.value = [];
    conversations.value = [];
    memories.value = [];
    consents.value = [];
    serviceMode.value = null;
    loadFailed.value = false;
    busy.value = false;
    asyncState.value = { ...IDLE_ASYNC };
  }

  return {
    relationships,
    conversations,
    memories,
    consents,
    serviceMode,
    loadFailed,
    asyncState,
    busy,
    load,
    reset,
  };
});
