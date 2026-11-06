import {
  CHAT_CURSOR_TTL_MS,
  ChatProtocolError,
  compareChatsDesc,
  DEFAULT_AUTHORITY_EPOCH,
  DEFAULT_CHAT_PAGE_LIMIT,
  isValidDecimalRevision,
  MAX_CHAT_PAGE_LIMIT,
  parseRevisionBigInt,
  type ChatAuthorityEpoch,
  type ChatChange,
  type ChatChangesPage,
  type ChatCommit,
  type ChatDeleteRequest,
  type ChatKeysetCursor,
  type ChatRevision,
  type ChatStoragePort,
  type ChatView,
  type ListStoredChatChangesParams,
  type ListStoredChatsParams,
  type ListStoredMessagesParams,
  type StoredChat,
  type StoredChatKind,
  type StoredChatPage,
  type StoredChatSummary,
  type StoredMessage,
  type StoredMessageCandidate,
  type StoredMessagePage,
} from './chatStoragePort';

interface InternalMessageEntry {
  seq: number;
  message: StoredMessage;
}

export interface SyntheticChatStorageOptions {
  authorityEpoch?: ChatAuthorityEpoch;
  now?: () => number;
  chats?: StoredChat[];
  messagesByChatId?: Record<string, StoredMessage[]>;
}

export interface SyntheticChatStorageAdapter extends ChatStoragePort {
  getAuthorityEpoch(): ChatAuthorityEpoch;
  setAuthorityEpoch(nextEpoch: ChatAuthorityEpoch): void;
  upsertChat(chat: StoredChat): void;
  appendMessages(chatId: string, messages: StoredMessage[]): void;
  editMessage(chatId: string, messageId: string, patch: Partial<StoredMessage>): void;
  deleteMessage(chatId: string, messageId: string): void;
  reorderMessages(chatId: string, orderedMessageIds: readonly string[]): void;
  expireChangesBefore(chatId: string, minRetainedRevision: ChatRevision): void;
}

function nextRevisionString(rev: ChatRevision | undefined | null): ChatRevision {
  return (parseRevisionBigInt(rev) + 1n).toString(10);
}

function formatSeqPosition(seq: number): string {
  return `pos:${String(seq).padStart(6, '0')}`;
}

function encodeCursorPayload(payload: Record<string, unknown>): ChatKeysetCursor {
  return encodeURIComponent(JSON.stringify(payload));
}

function decodeCursorPayload<T extends Record<string, unknown>>(cursor: string): T | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(cursor));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {
    /* invalid cursor */
  }
  return null;
}

function normalizeChatRecord(chat: StoredChat, epoch: ChatAuthorityEpoch): StoredChat {
  const kind: StoredChatKind = chat.kind ?? 'SINGLE';
  const metadata = chat.metadata ?? {};
  return {
    ...chat,
    kind,
    conversationId: chat.conversationId ?? null,
    relationshipId: chat.relationshipId ?? null,
    characterRef: chat.characterRef ?? null,
    groupRef: chat.groupRef ?? null,
    branchRoot: chat.branchRoot || chat.chatId,
    authorityEpoch: epoch,
    header: chat.header ?? {},
    metadata: { ...metadata },
  };
}

function normalizeCandidateForView(
  c: StoredMessageCandidate,
  idx: number,
  messageId: string,
  messageRevision: ChatRevision,
  view: ChatView,
): StoredMessageCandidate {
  const index = typeof c.index === 'number' ? c.index : idx;
  const candidateId = c.candidateId || `${messageId}:cand:${index}`;
  const sourceRevision = c.sourceRevision || messageRevision;
  const sourceGeneration = c.sourceGeneration || '1';
  const baseData: Record<string, unknown> = {
    content: c.content,
    ...(c.sendDate !== undefined ? { sendDate: c.sendDate } : {}),
    ...(c.extra ? { extra: { ...c.extra } } : {}),
  };
  if (view === 'full') {
    return {
      ...c,
      candidateId,
      sourceRevision,
      sourceGeneration,
      index,
      content: c.content,
      data: {
        ...baseData,
        ...(c.data ? { ...c.data } : {}),
      },
      ...(c.extra ? { extra: { ...c.extra } } : {}),
    };
  }
  return {
    candidateId,
    sourceRevision,
    sourceGeneration,
    index,
    content: c.content,
    ...(c.sendDate !== undefined ? { sendDate: c.sendDate } : {}),
    ...(c.extra ? { extra: { ...c.extra } } : {}),
    data: baseData,
  };
}

function projectMessageForView(message: StoredMessage, view: ChatView): StoredMessage {
  const msgRev = message.messageRevision || message.revision || '1';
  const position = message.position || `pos:${message.messageId}`;
  const selectedIndex =
    typeof message.selectedCandidateIndex === 'number' && message.selectedCandidateIndex >= 0
      ? message.selectedCandidateIndex
      : 0;

  const rawCandidates: StoredMessageCandidate[] =
    message.candidates && message.candidates.length > 0
      ? message.candidates
      : [
          {
            candidateId:
              message.selectedCandidateId || `${message.messageId}:cand:${selectedIndex}`,
            sourceRevision: msgRev,
            sourceGeneration: '1',
            index: selectedIndex,
            content: message.content,
            ...(message.sendDate !== undefined ? { sendDate: message.sendDate } : {}),
            ...(message.extra ? { extra: { ...message.extra } } : {}),
          },
        ];

  const activeRaw =
    rawCandidates.find((c, i) => (c.index ?? i) === selectedIndex) ?? rawCandidates[0];
  const selectedCandidateId =
    message.selectedCandidateId ||
    activeRaw?.candidateId ||
    `${message.messageId}:cand:${selectedIndex}`;
  const totalCandidateCount = Math.max(
    message.candidateCount ?? rawCandidates.length,
    rawCandidates.length,
    1,
  );

  const baseData: Record<string, unknown> = {
    content: message.content,
    role: message.role,
    senderName: message.senderName,
    isUser: message.isUser,
    isSystem: message.isSystem,
    ...(message.sendDate !== undefined ? { sendDate: message.sendDate } : {}),
    ...(message.extra ? { extra: { ...message.extra } } : {}),
  };

  if (view === 'full') {
    const fullCandidates = rawCandidates.map((c, idx) =>
      normalizeCandidateForView(c, idx, message.messageId, msgRev, 'full'),
    );
    return {
      ...message,
      messageRevision: msgRev,
      revision: msgRev,
      position,
      view: 'full',
      selectedCandidateId,
      selectedCandidateIndex: selectedIndex,
      candidateCount: totalCandidateCount,
      candidates: fullCandidates,
      data: {
        ...baseData,
        ...(message.variables ? { variables: { ...message.variables } } : {}),
        ...(message.stFields ? { stFields: { ...message.stFields } } : {}),
        ...(message.data ? { ...message.data } : {}),
      },
      extra: message.extra ? { ...message.extra } : undefined,
      variables: message.variables ? { ...message.variables } : undefined,
      stFields: message.stFields ? { ...message.stFields } : undefined,
    };
  }

  const activeCandidateDisplay = normalizeCandidateForView(
    {
      ...activeRaw,
      candidateId: selectedCandidateId,
      index: selectedIndex,
      content: message.content ?? activeRaw.content,
    },
    selectedIndex,
    message.messageId,
    msgRev,
    'display',
  );

  const projected: StoredMessage = {
    messageId: message.messageId,
    chatId: message.chatId,
    messageRevision: msgRev,
    revision: msgRev,
    position,
    view: 'display',
    role: message.role,
    senderName: message.senderName,
    isUser: message.isUser,
    isSystem: message.isSystem,
    content: message.content,
    selectedCandidateId,
    selectedCandidateIndex: selectedIndex,
    candidateCount: totalCandidateCount,
    candidates: [activeCandidateDisplay],
    data: baseData,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
  if (message.sendDate !== undefined) projected.sendDate = message.sendDate;
  if (message.extra !== undefined) projected.extra = { ...message.extra };
  return projected;
}

export function createSyntheticChatStorageAdapter(
  options: SyntheticChatStorageOptions = {},
): SyntheticChatStorageAdapter {
  let authorityEpoch: ChatAuthorityEpoch = options.authorityEpoch || DEFAULT_AUTHORITY_EPOCH;
  const nowFn = options.now ?? (() => Date.now());
  let seqCounter = 1;
  let opCounter = 1;

  const chatsMap = new Map<string, StoredChat>();
  const messagesMap = new Map<string, InternalMessageEntry[]>();
  const changesMap = new Map<string, ChatChange[]>();
  const minRetainedRevMap = new Map<string, ChatRevision>();
  const deleteIdempotencyMap = new Map<string, { payloadKey: string; commit: ChatCommit }>();

  function toInternalEntry(chatId: string, msg: StoredMessage, seq = seqCounter++, rev?: ChatRevision): InternalMessageEntry {
    const resolvedRev = rev || msg.messageRevision || msg.revision || '1';
    return {
      seq,
      message: projectMessageForView(
        {
          ...msg,
          chatId,
          messageRevision: resolvedRev,
          revision: resolvedRev,
          position: msg.position || formatSeqPosition(seq),
          view: msg.view ?? 'full',
        },
        'full',
      ),
    };
  }

  for (const chat of options.chats ?? []) {
    chatsMap.set(chat.chatId, normalizeChatRecord(chat, authorityEpoch));
    if (!changesMap.has(chat.chatId)) {
      changesMap.set(chat.chatId, []);
    }
  }

  for (const [chatId, list] of Object.entries(options.messagesByChatId ?? {})) {
    messagesMap.set(
      chatId,
      list.map((msg) => toInternalEntry(chatId, msg)),
    );
    if (!changesMap.has(chatId)) {
      changesMap.set(chatId, []);
    }
  }

  function validateLimit(rawLimit: number | undefined, defaultLimit = DEFAULT_CHAT_PAGE_LIMIT): number {
    if (rawLimit === undefined || rawLimit === null) return defaultLimit;
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_CHAT_PAGE_LIMIT) {
      throw new ChatProtocolError(
        400,
        'INVALID_REQUEST',
        `limit 必须在 1..${MAX_CHAT_PAGE_LIMIT} 之间`,
      );
    }
    return rawLimit;
  }

  function requireChatAndMessages(chatId: string): { chat: StoredChat; list: InternalMessageEntry[] } {
    const chat = chatsMap.get(chatId);
    const list = messagesMap.get(chatId) ?? (chat ? [] : undefined);
    if (!chat || !list) {
      throw new ChatProtocolError(404, 'NOT_FOUND_OR_FORBIDDEN', '会话不存在');
    }
    return { chat, list };
  }

  function recordChange(
    chat: StoredChat,
    entry: {
      changedIds?: string[];
      deletedIds?: string[];
      metadataChanged?: boolean;
      orderChanged?: boolean;
      deleted?: boolean;
      operationId?: string;
    },
  ): ChatRevision {
    const nextRev = nextRevisionString(chat.chatRevision);
    chat.chatRevision = nextRev;
    chat.updatedAt = new Date(nowFn()).toISOString();
    chat.authorityEpoch = authorityEpoch;
    if (entry.metadataChanged) {
      chat.metadataRevision = nextRevisionString(chat.metadataRevision);
    }
    if (entry.orderChanged) {
      chat.orderRevision = nextRevisionString(chat.orderRevision);
    }
    const list = changesMap.get(chat.chatId) ?? [];
    list.push({
      operationId: entry.operationId || `op-${opCounter++}`,
      chatRevision: nextRev,
      metadataRevision: chat.metadataRevision,
      orderRevision: chat.orderRevision,
      authorityEpoch,
      changedIds: entry.changedIds ?? [],
      deletedIds: entry.deletedIds ?? [],
      metadataChanged: Boolean(entry.metadataChanged),
      orderChanged: Boolean(entry.orderChanged),
      deleted: Boolean(entry.deleted),
    });
    changesMap.set(chat.chatId, list);
    return nextRev;
  }

  return {
    getAuthorityEpoch() {
      return authorityEpoch;
    },

    setAuthorityEpoch(nextEpoch: ChatAuthorityEpoch) {
      authorityEpoch = String(nextEpoch || '').trim() || DEFAULT_AUTHORITY_EPOCH;
      for (const [id, chat] of chatsMap.entries()) {
        chatsMap.set(id, { ...chat, authorityEpoch });
      }
    },

    upsertChat(chat: StoredChat) {
      chatsMap.set(chat.chatId, normalizeChatRecord(chat, authorityEpoch));
      if (!messagesMap.has(chat.chatId)) {
        messagesMap.set(chat.chatId, []);
      }
      if (!changesMap.has(chat.chatId)) {
        changesMap.set(chat.chatId, []);
      }
    },

    expireChangesBefore(chatId: string, minRetainedRevision: ChatRevision) {
      minRetainedRevMap.set(chatId, minRetainedRevision);
    },

    appendMessages(chatId: string, messages: StoredMessage[]) {
      const { chat, list } = requireChatAndMessages(chatId);
      const changedIds: string[] = [];
      for (const msg of messages) {
        const nextMsgRev = msg.messageRevision || msg.revision || nextRevisionString(chat.chatRevision);
        list.push(toInternalEntry(chatId, msg, seqCounter++, nextMsgRev));
        changedIds.push(msg.messageId);
      }
      messagesMap.set(chatId, list);
      chat.messageCount = list.length;
      const last = list.at(-1)?.message;
      if (last) {
        chat.preview = last.content;
        chat.lastMessageAt = last.updatedAt;
      }
      recordChange(chat, { changedIds });
    },

    editMessage(chatId: string, messageId: string, patch: Partial<StoredMessage>) {
      const { chat, list } = requireChatAndMessages(chatId);
      const idx = list.findIndex((item) => item.message.messageId === messageId);
      if (idx < 0) {
        throw new ChatProtocolError(404, 'NOT_FOUND_OR_FORBIDDEN', '消息不存在');
      }
      const nextRev = nextRevisionString(chat.chatRevision);
      const prevMsg = list[idx].message;
      const updatedCandidates =
        patch.candidates ??
        (prevMsg.candidates
          ? prevMsg.candidates.map((c, cIdx) => {
              const selIdx = patch.selectedCandidateIndex ?? prevMsg.selectedCandidateIndex ?? 0;
              if ((c.index ?? cIdx) === selIdx && patch.content !== undefined) {
                return { ...c, content: patch.content };
              }
              return c;
            })
          : undefined);
      list[idx] = toInternalEntry(
        chatId,
        {
          ...prevMsg,
          ...patch,
          candidates: updatedCandidates,
          messageId,
          updatedAt: new Date(nowFn()).toISOString(),
        },
        list[idx].seq,
        nextRev,
      );
      recordChange(chat, { changedIds: [messageId] });
    },

    deleteMessage(chatId: string, messageId: string) {
      const { chat, list } = requireChatAndMessages(chatId);
      const idx = list.findIndex((item) => item.message.messageId === messageId);
      if (idx < 0) {
        throw new ChatProtocolError(404, 'NOT_FOUND_OR_FORBIDDEN', '消息不存在');
      }
      list.splice(idx, 1);
      chat.messageCount = list.length;
      recordChange(chat, { deletedIds: [messageId] });
    },

    reorderMessages(chatId: string, orderedMessageIds: readonly string[]) {
      const { chat, list } = requireChatAndMessages(chatId);
      const byId = new Map(list.map((entry) => [entry.message.messageId, entry]));
      const reordered: InternalMessageEntry[] = [];
      const pushWithNewSeq = (entry: InternalMessageEntry) => {
        const seq = seqCounter++;
        reordered.push({
          seq,
          message: {
            ...entry.message,
            position: formatSeqPosition(seq),
          },
        });
      };
      for (const id of orderedMessageIds) {
        const found = byId.get(id);
        if (found) {
          pushWithNewSeq(found);
          byId.delete(id);
        }
      }
      for (const remaining of byId.values()) {
        pushWithNewSeq(remaining);
      }
      messagesMap.set(chatId, reordered);
      recordChange(chat, {
        changedIds: reordered.map((r) => r.message.messageId),
        orderChanged: true,
      });
    },

    async listStoredChats(params: ListStoredChatsParams = {}): Promise<StoredChatPage> {
      const limit = validateLimit(params.limit, DEFAULT_CHAT_PAGE_LIMIT);
      const filterKey = JSON.stringify([
        params.kind ?? '',
        params.characterRef ?? '',
        params.groupRef ?? '',
        params.relationshipId ?? '',
        (params.q ?? '').trim().toLowerCase(),
      ]);

      let allChats = Array.from(chatsMap.values()).filter((chat) => {
        if (params.kind && (chat.kind ?? 'SINGLE') !== params.kind) return false;
        if (params.characterRef && chat.characterRef !== params.characterRef) return false;
        if (params.groupRef && chat.groupRef !== params.groupRef) return false;
        if (params.relationshipId && chat.relationshipId !== params.relationshipId) return false;
        if (params.q && params.q.trim()) {
          const needle = params.q.trim().toLowerCase();
          // SX-2 contract: match title or character name only; never scan message bodies
          const hay = [chat.title, chat.characterName]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      });

      allChats.sort(compareChatsDesc);

      if (params.cursor) {
        const decoded = decodeCursorPayload<{
          kind?: string;
          authorityEpoch?: string;
          issuedAtMs?: number;
          filterKey?: string;
          updatedAt?: string;
          chatId?: string;
        }>(params.cursor);

        if (
          !decoded ||
          decoded.kind !== 'chats' ||
          typeof decoded.issuedAtMs !== 'number' ||
          typeof decoded.updatedAt !== 'string' ||
          typeof decoded.chatId !== 'string' ||
          decoded.filterKey !== filterKey
        ) {
          throw new ChatProtocolError(
            400,
            'INVALID_REQUEST',
            '聊天列表分页游标格式非法或筛选条件不匹配',
          );
        }

        const nowMs = nowFn();
        if (
          decoded.authorityEpoch !== authorityEpoch ||
          nowMs - decoded.issuedAtMs > CHAT_CURSOR_TTL_MS
        ) {
          throw new ChatProtocolError(
            410,
            'CHAT_CURSOR_EXPIRED',
            '聊天列表分页游标已过期或已失效',
          );
        }

        const cursorBoundary: StoredChatSummary = {
          chatId: decoded.chatId,
          title: '',
          messageCount: 0,
          chatRevision: '0',
          metadataRevision: '0',
          orderRevision: '0',
          createdAt: decoded.updatedAt,
          updatedAt: decoded.updatedAt,
        };
        allChats = allChats.filter((chat) => compareChatsDesc(cursorBoundary, chat) < 0);
      }

      const slice = allChats.slice(0, limit).map((chat) => normalizeChatRecord(chat, authorityEpoch));
      const hasMore = allChats.length > limit;
      const lastItem = slice.at(-1);
      const nextCursor =
        hasMore && lastItem
          ? encodeCursorPayload({
              kind: 'chats',
              authorityEpoch,
              issuedAtMs: nowFn(),
              filterKey,
              updatedAt: lastItem.updatedAt,
              chatId: lastItem.chatId,
            })
          : null;

      return {
        items: slice,
        nextCursor,
        authorityEpoch,
      };
    },

    async listStoredMessages(
      chatId: string,
      params: ListStoredMessagesParams = {},
    ): Promise<StoredMessagePage> {
      const limit = validateLimit(params.limit, DEFAULT_CHAT_PAGE_LIMIT);
      const view: ChatView = params.view ?? 'display';

      const selectorCount =
        (params.before ? 1 : 0) +
        (params.after ? 1 : 0) +
        (params.anchorMessageId ? 1 : 0);
      if (selectorCount > 1) {
        throw new ChatProtocolError(
          400,
          'INVALID_REQUEST',
          'before、after 与 anchorMessageId 不能同时传入',
        );
      }

      const { chat, list: entries } = requireChatAndMessages(chatId);
      const total = entries.length;

      if (total === 0) {
        if (params.anchorMessageId) {
          throw new ChatProtocolError(404, 'NOT_FOUND_OR_FORBIDDEN', '锚点消息不存在');
        }
        return {
          chatId,
          chatRevision: chat.chatRevision,
          metadataRevision: chat.metadataRevision,
          orderRevision: chat.orderRevision,
          authorityEpoch,
          items: [],
          beforeCursor: null,
          afterCursor: null,
          hasOlder: false,
          hasNewer: false,
          ...(params.include === 'chat' ? { chat: normalizeChatRecord(chat, authorityEpoch) } : {}),
        };
      }

      const parseMessageCursor = (rawCursor: string) => {
        const decoded = decodeCursorPayload<{
          kind?: string;
          chatId?: string;
          view?: ChatView;
          authorityEpoch?: string;
          orderRevision?: string;
          issuedAtMs?: number;
          boundaryMessageId?: string;
          boundarySeq?: number;
        }>(rawCursor);

        if (
          !decoded ||
          decoded.kind !== 'messages' ||
          decoded.chatId !== chatId ||
          (decoded.view !== undefined && decoded.view !== view) ||
          typeof decoded.issuedAtMs !== 'number' ||
          typeof decoded.boundarySeq !== 'number'
        ) {
          throw new ChatProtocolError(
            400,
            'INVALID_REQUEST',
            '消息分页游标格式非法或绑定的会话/视图不匹配',
          );
        }

        const nowMs = nowFn();
        if (
          decoded.authorityEpoch !== authorityEpoch ||
          decoded.orderRevision !== chat.orderRevision ||
          nowMs - decoded.issuedAtMs > CHAT_CURSOR_TTL_MS
        ) {
          throw new ChatProtocolError(
            410,
            'CHAT_CURSOR_EXPIRED',
            '消息分页游标已过期或顺序版本已变更',
          );
        }
        return decoded as {
          boundaryMessageId: string;
          boundarySeq: number;
        };
      };

      let startIdx = 0;
      let endIdx = total;

      if (params.anchorMessageId) {
        const anchorIdx = entries.findIndex(
          (e) => e.message.messageId === params.anchorMessageId,
        );
        if (anchorIdx < 0) {
          throw new ChatProtocolError(
            404,
            'NOT_FOUND_OR_FORBIDDEN',
            '锚点消息不存在或已删除',
          );
        }
        endIdx = anchorIdx + 1;
        startIdx = Math.max(0, endIdx - limit);
      } else if (params.before) {
        const cursor = parseMessageCursor(params.before);
        let olderEnd = entries.findIndex((e) => e.seq >= cursor.boundarySeq);
        if (olderEnd < 0) olderEnd = total;
        endIdx = olderEnd;
        startIdx = Math.max(0, endIdx - limit);
      } else if (params.after) {
        const cursor = parseMessageCursor(params.after);
        const newerStart = entries.findIndex((e) => e.seq > cursor.boundarySeq);
        if (newerStart < 0) {
          startIdx = total;
          endIdx = total;
        } else {
          startIdx = newerStart;
          endIdx = Math.min(total, startIdx + limit);
        }
      } else {
        endIdx = total;
        startIdx = Math.max(0, endIdx - limit);
      }

      const sliceEntries = entries.slice(startIdx, endIdx);
      const items = sliceEntries.map((e) => projectMessageForView(e.message, view));
      const hasOlder = startIdx > 0;
      const hasNewer = endIdx < total;

      const firstEntry = sliceEntries[0];
      const lastEntry = sliceEntries.at(-1);
      const issuedAtMs = nowFn();

      const beforeCursor = firstEntry
        ? encodeCursorPayload({
            kind: 'messages',
            chatId,
            view,
            authorityEpoch,
            orderRevision: chat.orderRevision,
            issuedAtMs,
            boundaryMessageId: firstEntry.message.messageId,
            boundarySeq: firstEntry.seq,
          })
        : null;

      const afterCursor = lastEntry
        ? encodeCursorPayload({
            kind: 'messages',
            chatId,
            view,
            authorityEpoch,
            orderRevision: chat.orderRevision,
            issuedAtMs,
            boundaryMessageId: lastEntry.message.messageId,
            boundarySeq: lastEntry.seq,
          })
        : null;

      return {
        chatId,
        chatRevision: chat.chatRevision,
        metadataRevision: chat.metadataRevision,
        orderRevision: chat.orderRevision,
        authorityEpoch,
        items,
        beforeCursor,
        afterCursor,
        hasOlder,
        hasNewer,
        ...(params.include === 'chat' ? { chat: normalizeChatRecord(chat, authorityEpoch) } : {}),
      };
    },

    async getStoredMessage(chatId: string, messageId: string): Promise<StoredMessage> {
      const { list } = requireChatAndMessages(chatId);
      const found = list.find((e) => e.message.messageId === messageId);
      if (!found) {
        throw new ChatProtocolError(404, 'NOT_FOUND_OR_FORBIDDEN', '消息不存在');
      }
      return projectMessageForView(found.message, 'full');
    },

    async listStoredChatChanges(
      chatId: string,
      params: ListStoredChatChangesParams,
    ): Promise<ChatChangesPage> {
      const chat = chatsMap.get(chatId);
      const allChanges = changesMap.get(chatId);
      if (!chat && !allChanges) {
        throw new ChatProtocolError(404, 'NOT_FOUND_OR_FORBIDDEN', '会话不存在');
      }
      const limit = validateLimit(params.limit, DEFAULT_CHAT_PAGE_LIMIT);
      if (!isValidDecimalRevision(params.afterRevision)) {
        throw new ChatProtocolError(400, 'INVALID_REQUEST', 'afterRevision 必须为十进制非负整数字符串');
      }
      const afterBig = parseRevisionBigInt(params.afterRevision);
      const currentRevision =
        chat?.chatRevision ?? allChanges?.at(-1)?.chatRevision ?? '0';
      const currentBig = parseRevisionBigInt(currentRevision);
      if (afterBig > currentBig) {
        throw new ChatProtocolError(
          400,
          'INVALID_REQUEST',
          'afterRevision 超出当前服务端最大版本',
        );
      }
      const minRetained = minRetainedRevMap.get(chatId);
      if (minRetained !== undefined && afterBig < parseRevisionBigInt(minRetained)) {
        throw new ChatProtocolError(
          410,
          'CHAT_CHANGES_EXPIRED',
          'afterRevision 已超出 7 天变更保留窗口',
        );
      }

      const filtered = (allChanges ?? []).filter(
        (c) => parseRevisionBigInt(c.chatRevision) > afterBig,
      );
      const slice = filtered.slice(0, limit);
      const throughRevision = slice.at(-1)?.chatRevision ?? params.afterRevision;
      return {
        chatId,
        authorityEpoch,
        items: slice,
        throughRevision,
        currentRevision,
        hasMore: filtered.length > limit,
      };
    },

    async deleteStoredChat(chatId: string, req: ChatDeleteRequest): Promise<ChatCommit> {
      const requestId = String(req.requestId ?? req.clientMutationId ?? '').trim();
      const reqEpoch = String(req.authorityEpoch ?? req.expectedAuthorityEpoch ?? '').trim();
      const reqRevision = String(req.chatRevision ?? req.expectedChatRevision ?? '').trim();
      if (!requestId) {
        throw new ChatProtocolError(400, 'INVALID_REQUEST', 'requestId 不能为空');
      }

      const idempotencyKey = `${chatId}::${requestId}`;
      const payloadKey = JSON.stringify({ authorityEpoch: reqEpoch, chatRevision: reqRevision });
      const priorCommit = deleteIdempotencyMap.get(idempotencyKey);
      if (priorCommit) {
        if (priorCommit.payloadKey !== payloadKey) {
          throw new ChatProtocolError(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            '相同 requestId 不能用于不同请求载荷',
          );
        }
        return priorCommit.commit;
      }

      const chat = chatsMap.get(chatId);
      if (!chat) {
        throw new ChatProtocolError(404, 'NOT_FOUND_OR_FORBIDDEN', '会话不存在');
      }
      if (reqEpoch !== authorityEpoch) {
        throw new ChatProtocolError(409, 'CHAT_AUTHORITY_CHANGED', '权威纪元已变化');
      }
      if (reqRevision !== chat.chatRevision) {
        throw new ChatProtocolError(409, 'REVISION_CONFLICT', '会话版本冲突');
      }
      const deletedIds = (messagesMap.get(chatId) ?? []).map(
        (e) => e.message.messageId,
      );
      const operationId = `op-${opCounter++}`;
      const nextRev = recordChange(chat, {
        operationId,
        deletedIds,
        metadataChanged: true,
        deleted: true,
      });
      chatsMap.delete(chatId);
      messagesMap.delete(chatId);
      const commit: ChatCommit = {
        requestId,
        operationId,
        chatId,
        rebased: false,
        chatRevision: nextRev,
        metadataRevision: chat.metadataRevision,
        orderRevision: chat.orderRevision,
        authorityEpoch,
        changed: [],
        deletedIds,
        deleted: true,
      };
      deleteIdempotencyMap.set(idempotencyKey, { payloadKey, commit });
      return commit;
    },
  };
}
