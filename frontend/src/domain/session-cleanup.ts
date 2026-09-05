// Logout / unauthorized must drop the live account-scoped caches so the next
// account never sees the previous one's chat or relationship.

import { useChatStore } from "@/stores/chat";
import { useRelationshipStore } from "@/stores/relationship";
import { clearRequestId } from "@/domain/request-id";

export function clearLocalSessionCaches(): void {
  clearRequestId();
  const chat = useChatStore();
  chat.reset();
  chat.conversations = [];
  useRelationshipStore().reset();
}
