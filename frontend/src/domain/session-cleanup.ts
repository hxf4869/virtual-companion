// §18.7: logout / unauthorized must drop in-memory business caches so the
// next account never sees the previous one's chat, memory, or relationships.

import { useAgeStore } from "@/stores/age";
import { useChatStore } from "@/stores/chat";
import { useConsentStore } from "@/stores/consent";
import { useDataStore } from "@/stores/data";
import { useExportStore } from "@/stores/export";
import { useIncognitoStore } from "@/stores/incognito";
import { useMemoryStore } from "@/stores/memory";
import { useRelationshipStore } from "@/stores/relationship";
import { useReminderStore } from "@/stores/reminder";
import { useReportStore } from "@/stores/report";
import { useUsageHealthStore } from "@/stores/usage-health";

export function clearLocalSessionCaches(): void {
  const chat = useChatStore();
  chat.reset();
  chat.conversations = [];
  useMemoryStore().reset();
  useRelationshipStore().reset();
  useUsageHealthStore().reset();
  useConsentStore().reset();
  useDataStore().reset();
  useExportStore().reset();
  useReminderStore().reset();
  useAgeStore().reset();
  useIncognitoStore().reset();
  useReportStore().reset();
}
