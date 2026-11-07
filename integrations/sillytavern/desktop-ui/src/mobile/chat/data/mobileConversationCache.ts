import { parseConversationKey } from '../../../data/queries/chat';
import type { ChatMessage, ChatSnapshot } from '../../../runtime/session-bridge';
import { createChatTailCache, type ChatTailCache } from './chatTailCache';
import {
  DEFAULT_AUTHORITY_EPOCH,
  type StoredMessage,
  type StoredMessagePage,
} from './chatStoragePort';

export const DEFAULT_MOBILE_TAIL_LIMIT = 30;

export type ConversationStorageIdResolver = string | ((key: string) => string);

export interface CachedConversationMeta {
  characterName: string;
  avatar: string;
  avatarUrl: string;
  relationshipId: string | null;
  conversationId: string | null;
}

export interface CachedConversationTail extends CachedConversationMeta {
  conversationKey: string;
  messages: ChatMessage[];
  updatedAt: number;
}

let sharedTailCache: ChatTailCache | null = null;

export function getSharedMobileTailCache(): ChatTailCache {
  if (!sharedTailCache) {
    sharedTailCache = createChatTailCache();
  }
  return sharedTailCache;
}

export function resetSharedMobileTailCacheForTest(nextCache?: ChatTailCache | null): void {
  sharedTailCache = nextCache ?? null;
}

function readAccountIdFromMeta(): string {
  if (typeof document === 'undefined') return '';
  return String(
    document.querySelector('meta[name="vc-account-id"]')?.getAttribute('content') || '',
  ).trim();
}

export function resolveConversationCacheKey(
  conversationKey: string,
  storageId?: ConversationStorageIdResolver,
): string {
  const trimmedKey = String(conversationKey || '').trim();
  if (!trimmedKey) return '';
  if (typeof storageId === 'function') {
    const resolved = String(storageId(trimmedKey) || '').trim();
    if (resolved) return resolved;
  } else if (typeof storageId === 'string' && storageId.trim()) {
    return storageId.trim();
  }
  const accountId = readAccountIdFromMeta();
  if (!accountId) return trimmedKey;
  const parsed = parseConversationKey(trimmedKey);
  if (parsed) {
    return JSON.stringify([accountId, parsed.avatar, parsed.file]);
  }
  return JSON.stringify([accountId, trimmedKey]);
}

const DISPLAY_EXTRA_KEYS = [
  'image',
  'audio',
  'vc_voice',
  'vc_voice_input',
  'reasoning',
  'finish_reason',
  'model',
] as const;

export function stripMessageToDisplayFields(msg: ChatMessage, fallbackIndex: number): ChatMessage {
  const index = typeof msg.index === 'number' && Number.isFinite(msg.index) ? msg.index : fallbackIndex;
  const key = typeof msg.key === 'string' && msg.key.trim() ? msg.key : `msg-${index}`;
  const stripped: ChatMessage = {
    key,
    index,
    name: typeof msg.name === 'string' ? msg.name : '',
    mes: typeof msg.mes === 'string' ? msg.mes : '',
    is_user: Boolean(msg.is_user),
    is_system: Boolean(msg.is_system),
  };

  if (msg.send_date !== undefined && msg.send_date !== null) {
    stripped.send_date = msg.send_date;
  }
  if (typeof msg.swipe_id === 'number' && Number.isFinite(msg.swipe_id)) {
    stripped.swipe_id = msg.swipe_id;
  }

  if (msg.extra && typeof msg.extra === 'object') {
    const displayExtra: Record<string, unknown> = {};
    let hasExtra = false;
    for (const k of DISPLAY_EXTRA_KEYS) {
      if (msg.extra[k] !== undefined) {
        displayExtra[k] = msg.extra[k];
        hasExtra = true;
      }
    }
    if (hasExtra) {
      stripped.extra = displayExtra;
    }
  }

  return stripped;
}

export function snapshotToStoredTailPage(
  snapshot: ChatSnapshot,
  maxMessages: number = DEFAULT_MOBILE_TAIL_LIMIT,
  authorityEpoch: string = DEFAULT_AUTHORITY_EPOCH,
  storageId?: ConversationStorageIdResolver,
): StoredMessagePage | null {
  const conversationKey = typeof snapshot.key === 'string' ? snapshot.key.trim() : '';
  if (!conversationKey || snapshot.status !== 'ready') return null;

  const cacheKey = resolveConversationCacheKey(conversationKey, storageId);
  if (!cacheKey) return null;

  const limit = Math.max(1, Math.floor(maxMessages));
  const rawMessages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  const startOffset = Math.max(0, rawMessages.length - limit);
  const sliced = rawMessages.slice(startOffset);

  const meta: CachedConversationMeta = {
    characterName: snapshot.characterName || '',
    avatar: snapshot.avatar || '',
    avatarUrl: snapshot.avatarUrl || '',
    relationshipId: snapshot.relationshipId || null,
    conversationId: snapshot.conversationId || null,
  };

  const nowIso = new Date().toISOString();
  const rev = String(rawMessages.length || 1);

  const items: StoredMessage[] = sliced.map((raw, idx) => {
    const clean = stripMessageToDisplayFields(raw, startOffset + idx);
    const extra: Record<string, unknown> | undefined =
      clean.extra && Object.keys(clean.extra).length > 0 ? { ...clean.extra } : undefined;
    const role = clean.is_system ? 'system' : clean.is_user ? 'user' : 'assistant';
    return {
      messageId: clean.key || `msg-${clean.index ?? idx}`,
      chatId: cacheKey,
      position: String(clean.index ?? startOffset + idx),
      view: 'display',
      role,
      senderName: clean.name || '',
      isUser: Boolean(clean.is_user),
      isSystem: Boolean(clean.is_system),
      sendDate: clean.send_date ? String(clean.send_date) : undefined,
      content: clean.mes || '',
      selectedCandidateIndex: typeof clean.swipe_id === 'number' ? clean.swipe_id : 0,
      candidateCount: 1,
      extra,
      revision: rev,
      createdAt: clean.send_date ? String(clean.send_date) : nowIso,
      updatedAt: nowIso,
    };
  });

  return {
    chatId: cacheKey,
    chatRevision: rev,
    metadataRevision: rev,
    orderRevision: rev,
    authorityEpoch: authorityEpoch || DEFAULT_AUTHORITY_EPOCH,
    items,
    beforeCursor: null,
    afterCursor: null,
    hasOlder: startOffset > 0,
    hasNewer: false,
    chat: {
      chatId: cacheKey,
      title: meta.characterName || '对话',
      characterName: meta.characterName,
      avatar: meta.avatar,
      relationshipId: meta.relationshipId,
      conversationId: meta.conversationId,
      messageCount: rawMessages.length,
      chatRevision: rev,
      metadataRevision: rev,
      orderRevision: rev,
      updatedAt: nowIso,
      metadata: {
        avatarUrl: meta.avatarUrl,
        conversationKey,
      },
    },
  };
}

export function storedTailPageToCachedConversation(
  page: StoredMessagePage | null | undefined,
  fallbackConversationKey?: string,
): CachedConversationTail | null {
  if (!page || typeof page.chatId !== 'string' || !page.chatId.trim()) {
    return null;
  }
  const chatMeta = page.chat;
  const metaConversationKey =
    chatMeta?.metadata && typeof chatMeta.metadata.conversationKey === 'string'
      ? chatMeta.metadata.conversationKey.trim()
      : '';
  const conversationKey =
    metaConversationKey ||
    (typeof fallbackConversationKey === 'string' && fallbackConversationKey.trim()
      ? fallbackConversationKey.trim()
      : page.chatId.trim());
  const chatAvatarUrl =
    chatMeta?.metadata && typeof chatMeta.metadata.avatarUrl === 'string'
      ? chatMeta.metadata.avatarUrl
      : '';

  const meta: CachedConversationMeta = {
    characterName: chatMeta?.characterName || chatMeta?.title || '',
    avatar: chatMeta?.avatar || '',
    avatarUrl: chatAvatarUrl,
    relationshipId: chatMeta?.relationshipId ?? null,
    conversationId: chatMeta?.conversationId ?? null,
  };

  const rawItems = Array.isArray(page.items) ? page.items : [];
  const messages: ChatMessage[] = rawItems.map((item, idx) => {
    const cleanExtra =
      item.extra && typeof item.extra === 'object' && Object.keys(item.extra).length > 0
        ? { ...item.extra }
        : undefined;

    const parsedPos = Number.parseInt(String(item.position ?? ''), 10);
    const index = Number.isFinite(parsedPos) ? parsedPos : idx;
    const msg: ChatMessage = {
      key: item.messageId || `msg-${index}`,
      index,
      name: item.senderName || '',
      mes: item.content || '',
      is_user: Boolean(item.isUser),
      is_system: Boolean(item.isSystem),
    };
    if (item.sendDate !== undefined && item.sendDate !== null) {
      msg.send_date = String(item.sendDate);
    }
    if (typeof item.selectedCandidateIndex === 'number' && item.selectedCandidateIndex > 0) {
      msg.swipe_id = item.selectedCandidateIndex;
    }
    if (cleanExtra) {
      msg.extra = cleanExtra;
    }
    return msg;
  });

  const updatedMs = page.chat?.updatedAt ? Date.parse(page.chat.updatedAt) : Date.now();

  return {
    conversationKey,
    ...meta,
    messages,
    updatedAt: Number.isFinite(updatedMs) ? updatedMs : Date.now(),
  };
}

export function readCachedConversationTailSync(
  cache: ChatTailCache | null | undefined,
  conversationKey: string,
  storageId?: ConversationStorageIdResolver,
): CachedConversationTail | null {
  const activeCache = cache ?? getSharedMobileTailCache();
  const cacheKey = resolveConversationCacheKey(conversationKey, storageId);
  if (!activeCache || !cacheKey) return null;
  try {
    const inMemory = activeCache.peekMemory(cacheKey);
    return storedTailPageToCachedConversation(inMemory, conversationKey);
  } catch {
    return null;
  }
}

export async function readCachedConversationTail(
  cache: ChatTailCache | null | undefined,
  conversationKey: string,
  storageId?: ConversationStorageIdResolver,
): Promise<CachedConversationTail | null> {
  const activeCache = cache ?? getSharedMobileTailCache();
  const cacheKey = resolveConversationCacheKey(conversationKey, storageId);
  if (!activeCache || !cacheKey) return null;
  try {
    const page = await activeCache.get(cacheKey);
    return storedTailPageToCachedConversation(page, conversationKey);
  } catch {
    try {
      return storedTailPageToCachedConversation(
        activeCache.peekMemory(cacheKey),
        conversationKey,
      );
    } catch {
      return null;
    }
  }
}

export async function writeCachedConversationTail(
  cache: ChatTailCache | null | undefined,
  snapshot: ChatSnapshot,
  maxMessagesOrStorageId: number | ConversationStorageIdResolver = DEFAULT_MOBILE_TAIL_LIMIT,
  storageId?: ConversationStorageIdResolver,
): Promise<void> {
  const activeCache = cache ?? getSharedMobileTailCache();
  if (!activeCache) return;
  const maxMessages =
    typeof maxMessagesOrStorageId === 'number'
      ? maxMessagesOrStorageId
      : DEFAULT_MOBILE_TAIL_LIMIT;
  const resolvedStorageId =
    typeof maxMessagesOrStorageId === 'number' ? storageId : maxMessagesOrStorageId;
  let epoch = DEFAULT_AUTHORITY_EPOCH;
  try {
    epoch = activeCache.getAuthorityEpoch();
  } catch {
    epoch = DEFAULT_AUTHORITY_EPOCH;
  }
  const page = snapshotToStoredTailPage(snapshot, maxMessages, epoch, resolvedStorageId);
  if (!page) return;
  try {
    await activeCache.set(page.chatId, page);
  } catch {
    // IndexedDB unavailable or failed; memory cache was already updated before IDB write
  }
}
