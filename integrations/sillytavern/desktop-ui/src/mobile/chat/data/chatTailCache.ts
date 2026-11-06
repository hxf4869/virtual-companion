import {
  DEFAULT_AUTHORITY_EPOCH,
  type ChatAuthorityEpoch,
  type StoredMessagePage,
} from './chatStoragePort';

const DEFAULT_MAX_CACHED_CHATS = 10;
const DEFAULT_MAX_CACHE_BYTES = 20 * 1024 * 1024;
const IDB_DB_NAME = 'vc-mobile-chat-tail-cache-v1';
const IDB_STORE_NAME = 'chat_tails';

export interface ChatTailCacheOptions {
  accountId?: string;
  sessionId?: string;
  authorityEpoch?: ChatAuthorityEpoch;
  maxChats?: number;
  maxBytes?: number;
  indexedDB?: IDBFactory | null;
}

export interface ChatTailCache {
  getAuthorityEpoch(): ChatAuthorityEpoch;
  syncAuthorityEpoch(nextEpoch: ChatAuthorityEpoch): Promise<boolean>;
  get(chatId: string): Promise<StoredMessagePage | null>;
  peekMemory(chatId: string): StoredMessagePage | null;
  set(chatId: string, page: StoredMessagePage): Promise<void>;
  evict(chatId: string): Promise<void>;
  clear(): Promise<void>;
}

function estimatePageBytes(page: StoredMessagePage): number {
  try {
    return JSON.stringify(page).length * 2;
  } catch {
    return 1024;
  }
}

function resolveDefaultIndexedDB(): IDBFactory | null {
  try {
    if (typeof globalThis !== 'undefined' && 'indexedDB' in globalThis) {
      return (globalThis as { indexedDB?: IDBFactory }).indexedDB ?? null;
    }
  } catch {
    /* SecurityError in restricted WebView / private mode */
  }
  return null;
}

export function createChatTailCache(options: ChatTailCacheOptions = {}): ChatTailCache {
  const accountId = String(options.accountId || 'default-account');
  const sessionId = String(options.sessionId || 'default-session');
  let currentEpoch: ChatAuthorityEpoch = String(
    options.authorityEpoch || DEFAULT_AUTHORITY_EPOCH,
  );
  const maxChats = options.maxChats ?? DEFAULT_MAX_CACHED_CHATS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_CACHE_BYTES;

  const memoryMap = new Map<string, { page: StoredMessagePage; bytes: number }>();
  let totalBytes = 0;

  const idbFactory: IDBFactory | null =
    options.indexedDB !== undefined ? options.indexedDB : resolveDefaultIndexedDB();

  let dbPromise: Promise<IDBDatabase | null> | null = null;

  function partitionKey(chatId: string, epoch = currentEpoch): string {
    return `${accountId}::${sessionId}::${epoch}::${chatId}`;
  }

  function openDatabase(): Promise<IDBDatabase | null> {
    if (!idbFactory) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = idbFactory.open(IDB_DB_NAME, 1);
        req.onupgradeneeded = () => {
          try {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
              db.createObjectStore(IDB_STORE_NAME);
            }
          } catch {
            /* ignore upgrade error */
          }
        };
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  }

  async function runIdbOp<T>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | null> {
    try {
      const db = await openDatabase();
      if (!db) return null;
      return await new Promise<T | null>((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE_NAME, mode);
          const req = op(tx.objectStore(IDB_STORE_NAME));
          req.onsuccess = () => resolve((req.result as T) ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    } catch {
      return null;
    }
  }

  async function idbGet(key: string): Promise<StoredMessagePage | null> {
    const val = await runIdbOp('readonly', (store) => store.get(key));
    return val && typeof val === 'object' ? (val as StoredMessagePage) : null;
  }

  async function idbPut(key: string, value: StoredMessagePage): Promise<void> {
    await runIdbOp('readwrite', (store) => store.put(value, key));
  }

  async function idbDelete(key: string): Promise<void> {
    await runIdbOp('readwrite', (store) => store.delete(key));
  }

  async function idbClear(): Promise<void> {
    await runIdbOp('readwrite', (store) => store.clear());
  }

  function putMemory(chatId: string, page: StoredMessagePage) {
    const existing = memoryMap.get(chatId);
    if (existing) {
      totalBytes -= existing.bytes;
      memoryMap.delete(chatId);
    }
    const bytes = estimatePageBytes(page);
    memoryMap.set(chatId, { page, bytes });
    totalBytes += bytes;

    while (
      memoryMap.size > maxChats ||
      (totalBytes > maxBytes && memoryMap.size > 1)
    ) {
      const oldestKey = memoryMap.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = memoryMap.get(oldestKey);
      if (oldest) totalBytes -= oldest.bytes;
      memoryMap.delete(oldestKey);
      void idbDelete(partitionKey(oldestKey));
    }
  }

  return {
    getAuthorityEpoch() {
      return currentEpoch;
    },

    async syncAuthorityEpoch(nextEpoch: ChatAuthorityEpoch): Promise<boolean> {
      const normalized = String(nextEpoch || '').trim();
      if (!normalized || normalized === currentEpoch) {
        return false;
      }
      currentEpoch = normalized;
      memoryMap.clear();
      totalBytes = 0;
      await idbClear();
      return true;
    },

    peekMemory(chatId: string): StoredMessagePage | null {
      const entry = memoryMap.get(chatId);
      if (!entry) return null;
      if (entry.page.authorityEpoch !== currentEpoch) {
        totalBytes -= entry.bytes;
        memoryMap.delete(chatId);
        return null;
      }
      memoryMap.delete(chatId);
      memoryMap.set(chatId, entry);
      return entry.page;
    },

    async get(chatId: string): Promise<StoredMessagePage | null> {
      const mem = this.peekMemory(chatId);
      if (mem) return mem;

      const fromIdb = await idbGet(partitionKey(chatId));
      if (!fromIdb || fromIdb.authorityEpoch !== currentEpoch) {
        return null;
      }
      putMemory(chatId, fromIdb);
      return fromIdb;
    },

    async set(chatId: string, page: StoredMessagePage): Promise<void> {
      if (page.authorityEpoch && page.authorityEpoch !== currentEpoch) {
        await this.syncAuthorityEpoch(page.authorityEpoch);
      }
      putMemory(chatId, page);
      await idbPut(partitionKey(chatId), page);
    },

    async evict(chatId: string): Promise<void> {
      const existing = memoryMap.get(chatId);
      if (existing) {
        totalBytes -= existing.bytes;
        memoryMap.delete(chatId);
      }
      await idbDelete(partitionKey(chatId));
    },

    async clear(): Promise<void> {
      memoryMap.clear();
      totalBytes = 0;
      await idbClear();
    },
  };
}
