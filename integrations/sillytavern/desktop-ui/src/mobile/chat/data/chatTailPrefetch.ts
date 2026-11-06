import { useEffect, useState } from 'react';
import {
  ChatProtocolError,
  DEFAULT_CHAT_PAGE_LIMIT,
  mergeStoredMessageRecord,
  type ChatAuthorityEpoch,
  type ChatChange,
  type ChatStoragePort,
  type StoredChatSummary,
  type StoredMessage,
  type StoredMessagePage,
} from './chatStoragePort';
import type { ChatTailCache } from './chatTailCache';

export type IdleScheduleFn = (callback: () => void) => unknown;
export type IdleCancelFn = (handle: any) => void;

export interface ScheduleIdleChatPrefetchOptions {
  chats: readonly StoredChatSummary[];
  authorityEpoch?: ChatAuthorityEpoch;
  port: ChatStoragePort;
  cache: ChatTailCache;
  maxPrefetchCount?: number;
  limit?: number;
  requestIdle?: IdleScheduleFn | null;
  cancelIdle?: IdleCancelFn | null;
  signal?: AbortSignal;
}

export interface IdleChatPrefetchHandle {
  cancel(): void;
}

export function scheduleIdleChatPrefetch(
  options: ScheduleIdleChatPrefetchOptions,
): IdleChatPrefetchHandle {
  const {
    chats,
    authorityEpoch,
    port,
    cache,
    maxPrefetchCount = 5,
    limit = DEFAULT_CHAT_PAGE_LIMIT,
    signal,
  } = options;

  let cancelled = false;
  let activeHandle: unknown = null;
  let usingTimeoutFallback = false;
  const abortController = new AbortController();

  const onAbort = () => {
    cancelled = true;
    abortController.abort();
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const g = globalThis as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => unknown;
    cancelIdleCallback?: (id: any) => void;
  };

  const scheduleFn: IdleScheduleFn =
    options.requestIdle !== undefined && options.requestIdle !== null
      ? options.requestIdle
      : options.requestIdle !== null && typeof g.requestIdleCallback === 'function'
        ? (cb) => g.requestIdleCallback!(cb, { timeout: 1000 })
        : (cb) => {
            usingTimeoutFallback = true;
            return globalThis.setTimeout(cb, 1);
          };

  const cancelFn: IdleCancelFn =
    options.cancelIdle !== undefined && options.cancelIdle !== null
      ? options.cancelIdle
      : (id) => {
          if (!usingTimeoutFallback && typeof g.cancelIdleCallback === 'function') {
            g.cancelIdleCallback(id);
          } else {
            globalThis.clearTimeout(id);
          }
        };

  const targets = chats.slice(0, Math.max(0, maxPrefetchCount));

  if (!cancelled && targets.length > 0) {
    activeHandle = scheduleFn(() => {
      if (cancelled) return;
      void (async () => {
        try {
          if (authorityEpoch) {
            await cache.syncAuthorityEpoch(authorityEpoch);
          }
          for (const summary of targets) {
            if (cancelled || abortController.signal.aborted) break;
            const existing = await cache.get(summary.chatId);
            if (
              existing &&
              existing.chatRevision === summary.chatRevision &&
              (!authorityEpoch || existing.authorityEpoch === authorityEpoch)
            ) {
              continue;
            }
            const page = await port.listStoredMessages(summary.chatId, {
              limit,
              view: 'display',
              include: 'chat',
              signal: abortController.signal,
            });
            if (cancelled || abortController.signal.aborted) break;
            await cache.set(summary.chatId, page);
          }
        } catch {
          /* Idle prefetch errors are non-fatal */
        }
      })();
    });
  }

  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      abortController.abort();
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      if (activeHandle !== null) {
        try {
          cancelFn(activeHandle);
        } catch {
          /* ignore */
        }
        activeHandle = null;
      }
    },
  };
}

export type ChatTailReconcilePhase =
  | 'loading'
  | 'cached'
  | 'reconciled'
  | 'deleted'
  | 'error';

export interface ChatTailReconcileSnapshot {
  phase: ChatTailReconcilePhase;
  page: StoredMessagePage | null;
  fromCache: boolean;
  epochInvalidated: boolean;
  relocatedByAnchor: boolean;
  fellBackToTail: boolean;
  error: unknown;
}

export interface OpenChatTailWithReconcileOptions {
  chatId: string;
  port: ChatStoragePort;
  cache: ChatTailCache;
  limit?: number;
  anchorMessageId?: string | null;
  signal?: AbortSignal;
  onUpdate?: (snapshot: ChatTailReconcileSnapshot) => void;
}

function mergePageItemsPreservingFull(
  cachedItems: readonly StoredMessage[],
  freshItems: readonly StoredMessage[],
  deletedIds: ReadonlySet<string> = new Set(),
): StoredMessage[] {
  const cachedById = new Map<string, StoredMessage>();
  for (const item of cachedItems) {
    if (!deletedIds.has(item.messageId)) {
      cachedById.set(item.messageId, item);
    }
  }
  return freshItems
    .filter((item) => !deletedIds.has(item.messageId))
    .map((fresh) => mergeStoredMessageRecord(cachedById.get(fresh.messageId), fresh));
}

export async function openChatTailWithReconcile(
  options: OpenChatTailWithReconcileOptions,
): Promise<ChatTailReconcileSnapshot> {
  const {
    chatId,
    port,
    cache,
    limit = DEFAULT_CHAT_PAGE_LIMIT,
    anchorMessageId,
    signal,
    onUpdate,
  } = options;

  let epochInvalidated = false;
  let relocatedByAnchor = false;
  let fellBackToTail = false;

  const emit = (snap: ChatTailReconcileSnapshot): ChatTailReconcileSnapshot => {
    onUpdate?.(snap);
    return snap;
  };

  const emitReconciled = (page: StoredMessagePage): ChatTailReconcileSnapshot =>
    emit({
      phase: 'reconciled',
      page,
      fromCache: false,
      epochInvalidated,
      relocatedByAnchor,
      fellBackToTail,
      error: null,
    });

  // Step 1: Read cached last page from memory / IndexedDB for immediate (<300 ms) render
  const cachedPage = await cache.get(chatId);
  if (cachedPage) {
    emit({
      phase: 'cached',
      page: cachedPage,
      fromCache: true,
      epochInvalidated: false,
      relocatedByAnchor: false,
      fellBackToTail: false,
      error: null,
    });
  }

  const effectiveAnchorId =
    anchorMessageId !== undefined
      ? anchorMessageId
      : (cachedPage?.items.at(-1)?.messageId ?? null);

  async function fetchFreshTailOrAnchor(
    useAnchor: boolean,
    priorItems: readonly StoredMessage[],
    deletedIds: ReadonlySet<string> = new Set(),
  ): Promise<StoredMessagePage> {
    if (useAnchor && effectiveAnchorId) {
      try {
        const anchored = await port.listStoredMessages(chatId, {
          anchorMessageId: effectiveAnchorId,
          limit,
          view: 'display',
          include: 'chat',
          signal,
        });
        relocatedByAnchor = true;
        return {
          ...anchored,
          items: mergePageItemsPreservingFull(priorItems, anchored.items, deletedIds),
        };
      } catch (err) {
        if (err instanceof ChatProtocolError && err.status === 404) {
          fellBackToTail = true;
        } else {
          throw err;
        }
      }
    }

    const freshTail = await port.listStoredMessages(chatId, {
      limit,
      view: 'display',
      include: 'chat',
      signal,
    });
    return {
      ...freshTail,
      items: mergePageItemsPreservingFull(priorItems, freshTail.items, deletedIds),
    };
  }

  // Step 2: Reconcile with server
  try {
    if (cachedPage && typeof port.listStoredChatChanges === 'function') {
      try {
        const collectedChanges: ChatChange[] = [];
        let cursorRevision = cachedPage.chatRevision;
        let latestEpoch = cachedPage.authorityEpoch;
        let latestCurrentRevision = cachedPage.chatRevision;

        for (let pageCount = 0; pageCount < 50; pageCount += 1) {
          const changesPage = await port.listStoredChatChanges(chatId, {
            afterRevision: cursorRevision,
            signal,
          });
          latestEpoch = changesPage.authorityEpoch;
          latestCurrentRevision = changesPage.currentRevision;
          if (changesPage.authorityEpoch !== cachedPage.authorityEpoch) {
            break;
          }
          collectedChanges.push(...changesPage.items);
          if (
            !changesPage.hasMore ||
            !changesPage.throughRevision ||
            changesPage.throughRevision === cursorRevision
          ) {
            break;
          }
          cursorRevision = changesPage.throughRevision;
        }

        if (latestEpoch !== cachedPage.authorityEpoch) {
          epochInvalidated = await cache.syncAuthorityEpoch(latestEpoch);
          const freshPage = await fetchFreshTailOrAnchor(false, []);
          await cache.set(chatId, freshPage);
          return emitReconciled(freshPage);
        }

        if (collectedChanges.some((c) => c.deleted)) {
          await cache.evict(chatId);
          return emit({
            phase: 'deleted',
            page: null,
            fromCache: false,
            epochInvalidated,
            relocatedByAnchor: false,
            fellBackToTail: false,
            error: null,
          });
        }

        const orderChanged = collectedChanges.some((c) => c.orderChanged);
        const deletedSet = new Set<string>();
        for (const change of collectedChanges) {
          for (const delId of change.deletedIds) {
            deletedSet.add(delId);
          }
        }

        if (
          collectedChanges.length === 0 &&
          latestCurrentRevision === cachedPage.chatRevision
        ) {
          return emitReconciled(cachedPage);
        }

        const reconciledPage = await fetchFreshTailOrAnchor(
          orderChanged && Boolean(effectiveAnchorId),
          cachedPage.items,
          deletedSet,
        );
        await cache.set(chatId, reconciledPage);
        return emitReconciled(reconciledPage);
      } catch (changeErr) {
        if (
          changeErr instanceof ChatProtocolError &&
          (changeErr.code === 'CHAT_CHANGES_EXPIRED' ||
            changeErr.code === 'CHAT_CURSOR_EXPIRED')
        ) {
          const recoveredPage = await fetchFreshTailOrAnchor(
            Boolean(effectiveAnchorId),
            cachedPage.items,
          );
          await cache.set(chatId, recoveredPage);
          return emitReconciled(recoveredPage);
        }
        throw changeErr;
      }
    }

    const freshPage = await fetchFreshTailOrAnchor(
      false,
      cachedPage ? cachedPage.items : [],
    );
    if (cachedPage && freshPage.authorityEpoch !== cachedPage.authorityEpoch) {
      epochInvalidated = await cache.syncAuthorityEpoch(freshPage.authorityEpoch);
    }
    await cache.set(chatId, freshPage);
    return emitReconciled(freshPage);
  } catch (err) {
    if (err instanceof ChatProtocolError && err.status === 404) {
      await cache.evict(chatId);
      return emit({
        phase: 'deleted',
        page: null,
        fromCache: false,
        epochInvalidated,
        relocatedByAnchor: false,
        fellBackToTail: false,
        error: err,
      });
    }
    return emit({
      phase: 'error',
      page: cachedPage ?? null,
      fromCache: Boolean(cachedPage),
      epochInvalidated,
      relocatedByAnchor,
      fellBackToTail,
      error: err,
    });
  }
}

export interface UseCachedChatTailReconcileOptions {
  chatId: string | null | undefined;
  port: ChatStoragePort | null | undefined;
  cache: ChatTailCache | null | undefined;
  limit?: number;
  anchorMessageId?: string | null;
}

function createInitialSnapshotForChat(
  chatId: string | null | undefined,
  cache: ChatTailCache | null | undefined,
): ChatTailReconcileSnapshot {
  const initialCached = chatId && cache ? cache.peekMemory(chatId) : null;
  return {
    phase: initialCached ? 'cached' : 'loading',
    page: initialCached,
    fromCache: Boolean(initialCached),
    epochInvalidated: false,
    relocatedByAnchor: false,
    fellBackToTail: false,
    error: null,
  };
}

export function useCachedChatTailReconcile(
  options: UseCachedChatTailReconcileOptions,
): ChatTailReconcileSnapshot {
  const { chatId, port, cache, limit, anchorMessageId } = options;

  const [state, setState] = useState<{
    forChatId: string | null | undefined;
    snapshot: ChatTailReconcileSnapshot;
  }>(() => ({
    forChatId: chatId,
    snapshot: createInitialSnapshotForChat(chatId, cache),
  }));

  const currentSnapshot =
    state.forChatId === chatId
      ? state.snapshot
      : createInitialSnapshotForChat(chatId, cache);

  useEffect(() => {
    setState((prev) =>
      prev.forChatId === chatId
        ? prev
        : {
            forChatId: chatId,
            snapshot: createInitialSnapshotForChat(chatId, cache),
          },
    );
    if (!chatId || !port || !cache) return;
    const abortController = new AbortController();
    let active = true;

    void openChatTailWithReconcile({
      chatId,
      port,
      cache,
      limit,
      anchorMessageId,
      signal: abortController.signal,
      onUpdate: (next) => {
        if (!active || abortController.signal.aborted) return;
        setState({ forChatId: chatId, snapshot: next });
      },
    });

    return () => {
      active = false;
      abortController.abort();
    };
  }, [chatId, port, cache, limit, anchorMessageId]);

  return currentSnapshot;
}
