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

export const useDataStore = defineStore("h5-data", () => {
  const relationships = ref<Relationship[]>([]);
  const conversations = ref<ConversationListItem[]>([]);
  const memories = ref<Memory[]>([]);
  const reminders = ref<Reminder[]>([]);
  const consents = ref<ConsentRecord[]>([]);
  const serviceMode = ref<ServiceModeStatus | null>(null);
  const loadFailed = ref(false);
  const busy = ref(false);

  async function load(transport: DataTransport): Promise<void> {
    loadFailed.value = false;
    busy.value = true;
    try {
      const [rels, convs, consentRows, mode] = await Promise.all([
        listRelationships(transport),
        listConversations(transport),
        listConsents(transport),
        getServiceMode(transport),
      ]);
      relationships.value = rels;
      conversations.value = convs;
      consents.value = consentRows;
      serviceMode.value = mode;
      const memoryPages = await Promise.all(rels.map((rel) => listMemories(transport, rel.relationshipId)));
      memories.value = memoryPages.flat();
      const reminderPages = await Promise.all(
        rels.map((rel) => listReminders(transport, rel.relationshipId)),
      );
      reminders.value = reminderPages.flat();
    } catch {
      loadFailed.value = true;
    } finally {
      busy.value = false;
    }
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
  };
});
