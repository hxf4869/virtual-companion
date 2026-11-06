export type ChatRevision = string;
export type ChatAuthorityEpoch = string;
export type ChatKeysetCursor = string;
export type ChatView = 'display' | 'full';
export type StoredChatKind = 'SINGLE' | 'GROUP';

export type ChatProtocolErrorCode =
  | 'CHAT_CURSOR_TTL_EXPIRED'
  | 'CHAT_CURSOR_EXPIRED'
  | 'CHAT_CHANGES_EXPIRED'
  | 'CHAT_AUTHORITY_CHANGED'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND_OR_FORBIDDEN'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED';

export const CHAT_CURSOR_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_CHAT_PAGE_LIMIT = 50;
export const MAX_CHAT_PAGE_LIMIT = 200;
export const DEFAULT_AUTHORITY_EPOCH: ChatAuthorityEpoch = '1';

export class ChatProtocolError extends Error {
  readonly status: number;
  readonly code: ChatProtocolErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: ChatProtocolErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ChatProtocolError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface StoredChatSummary {
  chatId: string;
  kind?: StoredChatKind;
  conversationId?: string | null;
  characterRef?: string | null;
  relationshipId?: string | null;
  groupRef?: string | null;
  branchRoot?: string;
  authorityEpoch?: ChatAuthorityEpoch;
  title: string;
  characterName?: string;
  avatar?: string;
  preview?: string;
  lastMessageAt?: string | null;
  messageCount: number;
  chatRevision: ChatRevision;
  metadataRevision: ChatRevision;
  orderRevision: ChatRevision;
  createdAt?: string;
  updatedAt: string;
}

export interface StoredChat extends StoredChatSummary {
  header?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface StoredChatPage {
  items: StoredChatSummary[];
  nextCursor: ChatKeysetCursor | null;
  authorityEpoch: ChatAuthorityEpoch;
}

export interface StoredMessageCandidate {
  candidateId?: string;
  sourceRevision?: ChatRevision;
  sourceGeneration?: ChatRevision;
  data?: Record<string, unknown>;
  index: number;
  content: string;
  sendDate?: string;
  extra?: Record<string, unknown>;
}

export interface StoredMessage {
  messageId: string;
  chatId: string;
  messageRevision?: ChatRevision;
  position?: string;
  view?: ChatView;
  role: 'system' | 'user' | 'assistant' | 'tool';
  senderName: string;
  isUser: boolean;
  isSystem: boolean;
  sendDate?: string;
  content: string;
  selectedCandidateId?: string;
  selectedCandidateIndex: number;
  candidateCount: number;
  candidates?: StoredMessageCandidate[];
  data?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  stFields?: Record<string, unknown>;
  revision: ChatRevision;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessagePage {
  chatId: string;
  chatRevision: ChatRevision;
  metadataRevision: ChatRevision;
  orderRevision: ChatRevision;
  authorityEpoch: ChatAuthorityEpoch;
  items: StoredMessage[];
  beforeCursor: ChatKeysetCursor | null;
  afterCursor: ChatKeysetCursor | null;
  hasOlder: boolean;
  hasNewer: boolean;
  chat?: StoredChat;
}

export interface ChatChange {
  operationId: string;
  chatRevision: ChatRevision;
  metadataRevision: ChatRevision;
  orderRevision: ChatRevision;
  authorityEpoch: ChatAuthorityEpoch;
  changedIds: string[];
  deletedIds: string[];
  metadataChanged: boolean;
  orderChanged: boolean;
  deleted: boolean;
}

export interface ChatChangesPage {
  chatId: string;
  authorityEpoch: ChatAuthorityEpoch;
  items: ChatChange[];
  throughRevision: ChatRevision;
  currentRevision: ChatRevision;
  hasMore: boolean;
}

export interface ChatDeleteRequest {
  requestId?: string;
  authorityEpoch?: ChatAuthorityEpoch;
  chatRevision?: ChatRevision;
  expectedChatRevision?: ChatRevision;
  expectedAuthorityEpoch?: ChatAuthorityEpoch;
  clientMutationId?: string;
}

export interface ChatCommit {
  requestId: string;
  operationId: string;
  chatId: string;
  rebased: boolean;
  chatRevision: ChatRevision;
  metadataRevision: ChatRevision;
  orderRevision: ChatRevision;
  authorityEpoch: ChatAuthorityEpoch;
  changed: StoredMessage[];
  deletedIds: string[];
  deleted: boolean;
  chat?: StoredChat;
}

export interface ListStoredChatsParams {
  cursor?: ChatKeysetCursor | null;
  limit?: number;
  kind?: StoredChatKind;
  characterRef?: string;
  groupRef?: string;
  relationshipId?: string;
  q?: string;
  signal?: AbortSignal;
}

export interface ListStoredMessagesParams {
  before?: ChatKeysetCursor | null;
  after?: ChatKeysetCursor | null;
  anchorMessageId?: string | null;
  limit?: number;
  view?: ChatView;
  include?: 'chat';
  signal?: AbortSignal;
}

export interface ListStoredChatChangesParams {
  afterRevision: ChatRevision;
  limit?: number;
  signal?: AbortSignal;
}

export interface ChatStoragePort {
  listStoredChats(params?: ListStoredChatsParams): Promise<StoredChatPage>;
  listStoredMessages(chatId: string, params?: ListStoredMessagesParams): Promise<StoredMessagePage>;
  getStoredMessage?(
    chatId: string,
    messageId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<StoredMessage>;
  listStoredChatChanges?(
    chatId: string,
    params: ListStoredChatChangesParams,
  ): Promise<ChatChangesPage>;
  deleteStoredChat?(
    chatId: string,
    req: ChatDeleteRequest,
    opts?: { signal?: AbortSignal },
  ): Promise<ChatCommit>;
}

export type HttpChatRequestFn = <T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  options?: {
    query?: Record<string, string | number | undefined | null>;
    body?: unknown;
    signal?: AbortSignal;
  },
) => Promise<T>;

export interface CreateHttpChatStoragePortOptions {
  request: HttpChatRequestFn;
}

/**
 * Typed SX-2 HTTP adapter matching specs/openapi/virtual-companion.yaml.
 * Inert until explicitly called; not wired to network during 6a while SX-4/5/6 are pending.
 */
export function createHttpChatStoragePort(
  options: CreateHttpChatStoragePortOptions,
): ChatStoragePort {
  const { request } = options;
  return {
    listStoredChats(params = {}) {
      return request<StoredChatPage>('GET', '/api/v1/chats', {
        query: {
          cursor: params.cursor ?? undefined,
          limit: params.limit,
          kind: params.kind,
          characterRef: params.characterRef,
          groupRef: params.groupRef,
          relationshipId: params.relationshipId,
          q: params.q,
        },
        signal: params.signal,
      });
    },
    listStoredMessages(chatId, params = {}) {
      const encodedId = encodeURIComponent(chatId);
      return request<StoredMessagePage>('GET', `/api/v1/chats/${encodedId}/messages`, {
        query: {
          before: params.before ?? undefined,
          after: params.after ?? undefined,
          anchorMessageId: params.anchorMessageId ?? undefined,
          limit: params.limit,
          view: params.view,
          include: params.include,
        },
        signal: params.signal,
      });
    },
    getStoredMessage(chatId, messageId, opts) {
      const encodedChat = encodeURIComponent(chatId);
      const encodedMsg = encodeURIComponent(messageId);
      return request<StoredMessage>(
        'GET',
        `/api/v1/chats/${encodedChat}/messages/${encodedMsg}`,
        { signal: opts?.signal },
      );
    },
    listStoredChatChanges(chatId, params) {
      const encodedChat = encodeURIComponent(chatId);
      return request<ChatChangesPage>('GET', `/api/v1/chats/${encodedChat}/changes`, {
        query: {
          afterRevision: params.afterRevision,
          limit: params.limit,
        },
        signal: params.signal,
      });
    },
    deleteStoredChat(chatId, req, opts) {
      const encodedChat = encodeURIComponent(chatId);
      const body = {
        requestId: req.requestId ?? req.clientMutationId ?? '',
        authorityEpoch: req.authorityEpoch ?? req.expectedAuthorityEpoch ?? '',
        chatRevision: req.chatRevision ?? req.expectedChatRevision ?? '',
      };
      return request<ChatCommit>('DELETE', `/api/v1/chats/${encodedChat}`, {
        body,
        signal: opts?.signal,
      });
    },
  };
}

export function isValidDecimalRevision(rev: ChatRevision | undefined | null): boolean {
  const raw = String(rev ?? '').trim();
  return /^(0|[1-9][0-9]*)$/.test(raw);
}

export function parseRevisionBigInt(rev: ChatRevision | undefined | null): bigint {
  const raw = String(rev ?? '0').trim();
  return isValidDecimalRevision(raw) ? BigInt(raw) : 0n;
}

export function compareChatsDesc(a: StoredChatSummary, b: StoredChatSummary): number {
  const aMs = Date.parse(a.updatedAt);
  const bMs = Date.parse(b.updatedAt);
  const safeAMs = Number.isFinite(aMs) ? aMs : 0;
  const safeBMs = Number.isFinite(bMs) ? bMs : 0;
  if (safeBMs !== safeAMs) return safeBMs - safeAMs;
  if (b.chatId === a.chatId) return 0;
  return b.chatId > a.chatId ? 1 : -1;
}

/**
 * Ensures display view data never overwrites full view fields (candidates, variables, stFields, data).
 */
export function mergeStoredMessageRecord(
  existing: StoredMessage | undefined,
  incoming: StoredMessage,
): StoredMessage {
  if (!existing || existing.view !== 'full' || incoming.view === 'full') {
    const msgRev = incoming.messageRevision || incoming.revision || '1';
    return {
      ...incoming,
      messageRevision: msgRev,
      revision: msgRev,
      view: incoming.view ?? existing?.view ?? 'display',
    };
  }

  const msgRev =
    incoming.messageRevision ||
    incoming.revision ||
    existing.messageRevision ||
    existing.revision;
  const selectedIdx =
    incoming.selectedCandidateIndex ?? existing.selectedCandidateIndex ?? 0;
  const preservedCandidates = existing.candidates
    ? existing.candidates.map((c, idx) => {
        const cIdx = c.index ?? idx;
        if (cIdx === selectedIdx) {
          return {
            ...c,
            content: incoming.content ?? c.content,
            data: {
              ...(c.data ?? {}),
              content: incoming.content ?? c.content,
            },
          };
        }
        return { ...c, data: c.data ? { ...c.data } : undefined };
      })
    : undefined;
  const mergedFullData: Record<string, unknown> = {
    ...(existing.data ?? {}),
    ...(incoming.data ?? {}),
    content: incoming.content ?? existing.content,
    ...(existing.variables ? { variables: { ...existing.variables } } : {}),
    ...(existing.stFields ? { stFields: { ...existing.stFields } } : {}),
  };
  return {
    ...existing,
    ...incoming,
    messageRevision: msgRev,
    revision: msgRev,
    position: incoming.position || existing.position || `pos:${incoming.messageId}`,
    view: 'full',
    selectedCandidateId:
      incoming.selectedCandidateId ||
      existing.selectedCandidateId ||
      `${incoming.messageId}:cand:${selectedIdx}`,
    candidates: preservedCandidates,
    data: mergedFullData,
    variables: existing.variables ? { ...existing.variables } : undefined,
    stFields: existing.stFields ? { ...existing.stFields } : undefined,
  };
}

export interface MergeStoredChatPagesResult {
  items: StoredChatSummary[];
  authorityEpoch: ChatAuthorityEpoch;
  nextCursor: ChatKeysetCursor | null;
  epochChanged: boolean;
}

/**
 * Merges paginated StoredChatPage results, deduplicating by chatId when concurrent updates
 * move a chat across page boundaries, and resetting when authorityEpoch changes.
 */
export function mergeStoredChatPages(
  existingItems: readonly StoredChatSummary[],
  incomingPage: StoredChatPage,
  previousAuthorityEpoch?: ChatAuthorityEpoch | null,
): MergeStoredChatPagesResult {
  const epochChanged = Boolean(
    previousAuthorityEpoch && previousAuthorityEpoch !== incomingPage.authorityEpoch,
  );
  const baseList = epochChanged ? [] : existingItems;
  const byId = new Map<string, StoredChatSummary>();

  for (const item of baseList) {
    if (!item?.chatId) continue;
    byId.set(item.chatId, { ...item });
  }

  for (const incoming of incomingPage.items) {
    if (!incoming?.chatId) continue;
    const prev = byId.get(incoming.chatId);
    if (!prev || parseRevisionBigInt(incoming.chatRevision) >= parseRevisionBigInt(prev.chatRevision)) {
      byId.set(incoming.chatId, prev ? { ...prev, ...incoming } : { ...incoming });
    }
  }

  const merged = Array.from(byId.values()).sort(compareChatsDesc);
  return {
    items: merged,
    authorityEpoch: incomingPage.authorityEpoch,
    nextCursor: incomingPage.nextCursor,
    epochChanged,
  };
}
