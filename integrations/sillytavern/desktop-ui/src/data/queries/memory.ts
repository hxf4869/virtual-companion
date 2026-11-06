import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAppClient } from '../../app/providers';
import { queryKeys } from '../queryKeys';
import { dayKeyOf, idOf, memoryMoment } from '../../../../extension/vc-model-settings/memory-logic.js';

export interface RelationshipSummary {
  relationshipId: string | number;
  personaRef?: string;
  characterRef?: string | null;
  companionName?: string | null;
  characterName?: string;
  active?: boolean;
  createdAt?: string;
  mode?: string;
}

export interface MemorySourceRef {
  evidenceId?: string;
  sourceRef?: string;
  chatDisplayName?: string;
  messageId?: string;
  revision?: number;
  status?: string;
  sourceTimestamp?: string;
  sourceTimezone?: string;
  excerpt?: string;
  createdAt?: string;
}

export interface MemoryItem {
  memoryId?: string;
  id?: string;
  relationshipId?: string;
  type?: string;
  mode?: string;
  scope?: string;
  status?: string;
  source?: string;
  sourceStatus?: string;
  lifecycle?: string;
  summary: string;
  version?: number;
  autoSaved?: boolean;
  pinned?: boolean;
  pinnedAt?: string | null;
  recallEligible?: boolean;
  supersedesMemoryId?: string | null;
  supersededByMemoryId?: string | null;
  updatedAt?: string;
  createdAt?: string;
  time?: {
    recordedAt?: string;
    eventDate?: string;
    eventTime?: string | null;
    eventTimezone?: string | null;
  };
  cleanup?: {
    state?: string;
    detail?: string;
  };
  history?: MemoryItem[];
}

export interface MemoryFilters {
  type?: string;
  source?: string;
  date?: string;
  eventDateFrom?: string;
  eventDateTo?: string;
  status?: string;
  q?: string;
  section?: string;
  limit?: number;
  [key: string]: unknown;
}

export interface MemoryPage {
  items: MemoryItem[];
  nextCursor: string | null;
  pages?: MemoryPage[];
  pageParams?: unknown[];
}

export interface CorrectInput {
  id: string;
  summary: string;
  expectedVersion: number;
}

export interface DiaryEntry {
  id?: string;
  diaryId?: string;
  day?: string;
  entryDate?: string;
  title?: string;
  body?: string;
  content?: string;
  mood?: string;
  moments?: string[];
  highlights?: string[];
  createdAt?: string;
}

export interface FavoriteItem {
  favoriteId?: string;
  id?: string;
  relationshipId?: string;
  chatFile?: string;
  role?: string;
  speakerName?: string;
  messageAt?: string;
  createdAt?: string;
  body?: string;
  content?: string;
}

export interface ReminderItem {
  reminderId?: string;
  id?: string;
  relationshipId?: string;
  text?: string;
  title?: string;
  remindAt?: string;
  dueAt?: string;
  recurrence?: string;
  status?: string;
}

function normalizeFilterObj(filters: MemoryFilters = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ['type', 'source', 'date', 'eventDateFrom', 'eventDateTo', 'status', 'q']) {
    const val = filters[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      out[key] = String(val).trim();
    }
  }
  return out;
}

export function matchesMemoryFilters(item: MemoryItem, filters: MemoryFilters): boolean {
  if (filters.type) {
    const itemType = String(item.type ?? '').toLowerCase();
    const targetType = String(filters.type).toLowerCase();
    if (itemType && itemType !== targetType) return false;
  }
  if (filters.source) {
    const targetSource = String(filters.source).toLowerCase();
    const itemSource = String(item.source ?? '').toLowerCase();
    const itemSourceStatus = String(item.sourceStatus ?? '').toLowerCase();
    if (itemSource) {
      if (itemSource !== targetSource) return false;
    } else if (
      targetSource === 'valid' ||
      targetSource === 'pending_verification' ||
      targetSource === 'invalid'
    ) {
      if (itemSourceStatus && itemSourceStatus !== targetSource) return false;
    } else if (targetSource === 'user_edit') {
      if (item.autoSaved === true && item.lifecycle !== 'SUPERSEDED') return false;
    }
  }
  if (filters.date) {
    const itemDay = dayKeyOf(memoryMoment(item));
    if (itemDay && itemDay !== filters.date && !String(memoryMoment(item)).startsWith(filters.date)) {
      return false;
    }
  }
  if (filters.eventDateFrom) {
    const itemDay = dayKeyOf(memoryMoment(item));
    if (itemDay && itemDay < String(filters.eventDateFrom)) return false;
  }
  if (filters.eventDateTo) {
    const itemDay = dayKeyOf(memoryMoment(item));
    if (itemDay && itemDay > String(filters.eventDateTo)) return false;
  }
  if (filters.status) {
    const targetStatus = String(filters.status).toLowerCase();
    const life = String(item.lifecycle ?? '').toLowerCase();
    const srcStatus = String(item.sourceStatus ?? item.source ?? '').toLowerCase();
    if (life && life !== targetStatus && srcStatus !== targetStatus) {
      return false;
    }
  }
  if (filters.q) {
    const q = String(filters.q).trim().toLowerCase();
    if (q && !String(item.summary ?? '').toLowerCase().includes(q)) {
      return false;
    }
  }
  return true;
}

export function useRelationships(): UseQueryResult<RelationshipSummary[], Error> {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.relationships,
    queryFn: async () => {
      const rows = await client.go.fetchRelationships();
      return Array.isArray(rows) ? (rows as RelationshipSummary[]) : [];
    },
    select: (rows) =>
      (Array.isArray(rows) ? rows : []).filter(
        (row) =>
          row?.relationshipId !== undefined &&
          row?.relationshipId !== null &&
          String(row.relationshipId) !== '' &&
          (!row.personaRef || row.personaRef === 'st-character'),
      ),
  });
}

export function useMemoryItems(
  relId: string | null,
  filters: MemoryFilters = {},
): UseInfiniteQueryResult<MemoryPage, Error> {
  const client = useAppClient();
  const normalizedFilters = normalizeFilterObj(filters);
  const queryParams: Record<string, unknown> = {
    ...normalizedFilters,
  };
  if (normalizedFilters.date && !queryParams.eventDateFrom && !queryParams.eventDateTo) {
    queryParams.eventDateFrom = normalizedFilters.date;
    queryParams.eventDateTo = normalizedFilters.date;
  }

  return useInfiniteQuery<
    MemoryPage,
    Error,
    MemoryPage,
    ReturnType<typeof queryKeys.memory>,
    string
  >({
    queryKey: queryKeys.memory(relId ?? '', normalizedFilters),
    enabled: Boolean(relId),
    initialPageParam: '',
    queryFn: async ({ pageParam }) => {
      if (!relId) return { items: [], nextCursor: null };
      const res = (await client.go.fetchMemories(relId, {
        ...queryParams,
        ...(pageParam ? { cursor: pageParam } : {}),
      })) as { items?: MemoryItem[]; nextCursor?: string | null } | MemoryItem[];
      if (Array.isArray(res)) {
        return { items: res, nextCursor: null };
      }
      return {
        items: Array.isArray(res?.items) ? res.items : [],
        nextCursor: res?.nextCursor ? String(res.nextCursor) : null,
      };
    },
    getNextPageParam: (lastPage) => (lastPage?.nextCursor ? lastPage.nextCursor : undefined),
    select: (data: InfiniteData<MemoryPage>): MemoryPage => {
      const allItems = data.pages.flatMap((page) => (Array.isArray(page?.items) ? page.items : []));
      const seenIds = new Set<string>();
      const uniqueItems: MemoryItem[] = [];
      for (const item of allItems) {
        const key = idOf(item);
        if (key) {
          if (seenIds.has(key)) continue;
          seenIds.add(key);
        }
        uniqueItems.push(item);
      }
      const filteredItems = uniqueItems.filter((item) => matchesMemoryFilters(item, normalizedFilters));
      const lastPage = data.pages[data.pages.length - 1];
      return {
        items: filteredItems,
        nextCursor: lastPage?.nextCursor ?? null,
        pages: data.pages,
        pageParams: data.pageParams,
      };
    },
  });
}

export function useMemoryDetail(memoryId: string | null): UseQueryResult<MemoryItem | null, Error> {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.memoryItem(memoryId ?? ''),
    enabled: Boolean(memoryId),
    queryFn: async () => {
      if (!memoryId) return null;
      const item = await client.go.fetchMemory(memoryId);
      return (item as MemoryItem) ?? null;
    },
  });
}

export function useMemoryEvidence(memoryId: string | null): UseQueryResult<MemorySourceRef[], Error> {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.memoryEvidence(memoryId ?? ''),
    enabled: Boolean(memoryId),
    queryFn: async () => {
      if (!memoryId) return [];
      const rows = await client.go.fetchMemoryEvidence(memoryId);
      return Array.isArray(rows) ? (rows as MemorySourceRef[]) : [];
    },
  });
}

export function useCorrectMemory(): UseMutationResult<MemoryItem, Error, CorrectInput> {
  const client = useAppClient();
  const queryClient = useQueryClient();

  return useMutation<MemoryItem, Error, CorrectInput>({
    mutationFn: async ({ id, summary, expectedVersion }) => {
      const res = await client.go.correctMemory(id, { summary, expectedVersion });
      return res as MemoryItem;
    },
    onSuccess: (updated, variables) => {
      const updatedId = idOf(updated) || variables.id;
      queryClient.setQueryData(queryKeys.memoryItem(variables.id), updated);
      if (updatedId !== variables.id) {
        queryClient.setQueryData(queryKeys.memoryItem(updatedId), updated);
      }
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
  });
}

export function useForgetMemory(): UseMutationResult<void, Error, { id: string }> {
  const client = useAppClient();
  const queryClient = useQueryClient();

  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      await client.go.forgetMemory(id);
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.memoryItem(variables.id) });
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
  });
}

export function usePinMemory(): UseMutationResult<MemoryItem, Error, { id: string; pinned: boolean }> {
  const client = useAppClient();
  const queryClient = useQueryClient();

  return useMutation<MemoryItem, Error, { id: string; pinned: boolean }>({
    mutationFn: async ({ id, pinned }) => {
      const res = pinned ? await client.go.pinMemory(id) : await client.go.unpinMemory(id);
      return res as MemoryItem;
    },
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(queryKeys.memoryItem(variables.id), updated);
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
  });
}

export function useDiaries(relId: string | null, month: string): UseQueryResult<DiaryEntry[], Error> {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.diaries(relId ?? '', month),
    enabled: Boolean(relId && month),
    queryFn: async () => {
      if (!relId || !month) return [];
      const res = (await client.go.fetchDiaryMonth(relId, month)) as
        | DiaryEntry[]
        | { items?: DiaryEntry[] };
      if (Array.isArray(res)) return res;
      return Array.isArray(res?.items) ? res.items : [];
    },
  });
}

export function useDiaryEntry(entryId: string | null): UseQueryResult<DiaryEntry | null, Error> {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.diaryEntry(entryId ?? ''),
    enabled: Boolean(entryId),
    queryFn: async () => {
      if (!entryId) return null;
      const res = await client.go.fetchDiaryEntry(entryId);
      return (res as DiaryEntry) ?? null;
    },
  });
}

export interface FavoritePage {
  items: FavoriteItem[];
  nextCursor: string | null;
}

export function useFavorites(
  relId: string | null,
): UseInfiniteQueryResult<FavoriteItem[], Error> {
  const client = useAppClient();
  return useInfiniteQuery<
    FavoritePage,
    Error,
    FavoriteItem[],
    ReturnType<typeof queryKeys.favorites>,
    string
  >({
    queryKey: queryKeys.favorites(relId ?? ''),
    enabled: Boolean(relId),
    initialPageParam: '',
    queryFn: async ({ pageParam }) => {
      if (!relId) return { items: [], nextCursor: null };
      const res = (await client.go.listFavorites(relId, {
        limit: 50,
        ...(pageParam ? { after: pageParam } : {}),
      })) as FavoriteItem[] | { items?: FavoriteItem[]; nextCursor?: string | null };
      if (Array.isArray(res)) {
        return { items: res, nextCursor: null };
      }
      return {
        items: Array.isArray(res?.items) ? res.items : [],
        nextCursor: res?.nextCursor ? String(res.nextCursor) : null,
      };
    },
    getNextPageParam: (lastPage) => (lastPage?.nextCursor ? lastPage.nextCursor : undefined),
    select: (data: InfiniteData<FavoritePage>): FavoriteItem[] => {
      const allItems = data.pages.flatMap((page) => (Array.isArray(page?.items) ? page.items : []));
      const seenIds = new Set<string>();
      const uniqueItems: FavoriteItem[] = [];
      for (const item of allItems) {
        const key = String(item?.favoriteId ?? item?.id ?? '');
        if (key) {
          if (seenIds.has(key)) continue;
          seenIds.add(key);
        }
        uniqueItems.push(item);
      }
      return uniqueItems;
    },
  });
}

export function useDeleteFavorite(relId: string | null): UseMutationResult<void, Error, string> {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (favoriteId) => {
      await client.go.deleteFavorite(favoriteId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.favorites(relId ?? '') });
    },
  });
}

export function useReminders(relId: string | null): UseQueryResult<ReminderItem[], Error> {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.reminders(relId ?? ''),
    enabled: Boolean(relId),
    queryFn: async () => {
      if (!relId) return [];
      const res = (await client.go.listReminders(relId)) as
        | ReminderItem[]
        | { items?: ReminderItem[] };
      if (Array.isArray(res)) return res;
      return Array.isArray(res?.items) ? res.items : [];
    },
  });
}

export function useDeleteReminder(relId: string | null): UseMutationResult<void, Error, string> {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (reminderId) => {
      await client.go.deleteReminder(reminderId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminders(relId ?? '') });
    },
  });
}

export function useIncognitoPref(): UseQueryResult<{ incognito: boolean; defaultIncognito: boolean }, Error> {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.incognitoPref,
    queryFn: async () => {
      const res = (await client.go.getIncognitoPref()) as {
        incognito?: boolean;
        defaultIncognito?: boolean;
      };
      const enabled = Boolean(res?.defaultIncognito ?? res?.incognito);
      return { incognito: enabled, defaultIncognito: enabled };
    },
  });
}

export function useSetIncognitoPref(): UseMutationResult<
  { incognito: boolean; defaultIncognito: boolean },
  Error,
  boolean
> {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (next: boolean) => {
      const res = (await client.go.setIncognitoPref(next)) as {
        incognito?: boolean;
        defaultIncognito?: boolean;
      };
      const enabled = Boolean(res?.defaultIncognito ?? res?.incognito ?? next);
      return { incognito: enabled, defaultIncognito: enabled };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.incognitoPref, data);
    },
  });
}
