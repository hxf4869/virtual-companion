// §18.7: logout / unauthorized must drop in-memory business caches so the
// next account never sees the previous one's chat, memory, or relationships.

import { useChatStore } from "@/stores/chat";
import { useMemoryStore } from "@/stores/memory";
import { useRelationshipStore } from "@/stores/relationship";
import { useUsageHealthStore } from "@/stores/usage-health";

export function clearLocalSessionCaches(): void {
  const chat = useChatStore();
  chat.reset();
  chat.conversations = [];
  useMemoryStore().reset();
  useRelationshipStore().reset();
  useUsageHealthStore().reset();
}
