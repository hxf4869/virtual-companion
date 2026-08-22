// DATA-VIEW (FR-DATA-001): read-only overview of the caller's stored data.
// Composes existing list APIs; does not invent account/report endpoints.

import { defineStore } from "pinia";
import { ref } from "vue";

import { listConversations, getServiceMode, type ConversationListItem, type ServiceModeStatus } from "@/api/chat";
import { listConsents, type ConsentRecord } from "@/api/consent";
import { listMemories, type Memory } from "@/api/memory";
import { listRelationships, type Relationship } from "@/api/relationship";
import { listReminders, type Reminder } from "@/api/reminder";

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
  const reminders = ref<Reminder[]>([]);
  const consents = ref<ConsentRecord[]>([]);
  const serviceMode = ref<ServiceModeStatus | null>(null);
  const loadFailed = ref(false);
  const busy = ref(false);

  async function load(transport: DataTransport): Promise<void> {
    loadFailed.value = false;
    busy.value = true;
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
      const memoryPages = await Promise.all(
        rels.map((rel) => listMemories(transport, rel.relationshipId).catch(() => [])),
      );
      memories.value = memoryPages.flatMap((page, index) => {
        const relationshipId = rels[index]?.relationshipId ?? "";
        return page.map((row) => ({ ...row, relationshipId }));
      });
      const reminderPages = await Promise.all(
        rels.map((rel) => listReminders(transport, rel.relationshipId).catch(() => [])),
      );
      reminders.value = reminderPages.flat();
    } catch {
      loadFailed.value = true;
    } finally {
      busy.value = false;
    }
  }

  function reset(): void {
    relationships.value = [];
    conversations.value = [];
    memories.value = [];
    reminders.value = [];
    consents.value = [];
    serviceMode.value = null;
    loadFailed.value = false;
    busy.value = false;
  }

  return {
    relationships,
    conversations,
    memories,
    reminders,
    consents,
    serviceMode,
    loadFailed,
    busy,
    load,
    reset,
  };
});
