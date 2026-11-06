import { useEffect, useRef, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { useAppClient } from '../../app/providers';
import { ConflictError } from '../../data/client';
import {
  normalizeConversationKey,
  parseConversationKey,
} from '../../data/queries/chat';
import {
  useCorrectMemory,
  useDeleteFavorite,
  useDeleteReminder,
  useDiaries,
  useDiaryEntry,
  useFavorites,
  useForgetMemory,
  useIncognitoPref,
  useMemoryDetail,
  useMemoryEvidence,
  useMemoryItems,
  usePinMemory,
  useRelationships,
  useReminders,
  useSetIncognitoPref,
  type DiaryEntry,
  type FavoriteItem,
  type MemoryFilters as MemoryFilterValues,
  type MemoryItem,
  type MemorySourceRef,
  type RelationshipSummary,
  type ReminderItem,
} from '../../data/queries/memory';
import {
  useChatSnapshot,
  useSessionBridge,
  type SessionBridge,
} from '../../runtime/session-bridge';
import { useChatUi } from '../chat/useChatUi';
import {
  canEdit,
  chatSnapshotsFromRecent,
  FAVORITES_SEGMENTS,
  FORGET_NOTICE,
  idOf,
  lifecycleLabels,
  localDay,
  monthDays,
  monthOfDay,
  openMessageSource,
  parseSourceRef,
  relationshipLabel,
  shiftMonth,
  sourceLabels,
  typeLabels,
} from '../../../../extension/vc-model-settings/memory-logic.js';

export const FILTER_STORAGE_KEY = 'vc_desktop_memory_filters';

export const EMPTY_MEMORY_FILTERS: MemoryFilterValues = {
  type: '',
  source: '',
  date: '',
  status: '',
  q: '',
};

export type MemoryRouteTab = 'timeline' | 'diary' | 'favorites';

export interface StoredMemoryRouteState {
  relId: string | null;
  tab: MemoryRouteTab;
  filters: MemoryFilterValues;
}

export const MEMORY_ROUTE_TABS = [
  { value: 'timeline', label: '时间线' },
  { value: 'diary', label: '日记' },
  { value: 'favorites', label: '收藏' },
] as const;

export const MEMORY_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'fact', label: '事实' },
  { value: 'preference', label: '偏好' },
  { value: 'event', label: '事件' },
  { value: 'boundary', label: '边界' },
  { value: 'promise', label: '约定' },
  { value: 'SharedEpisode', label: '共同经历' },
  { value: 'Commitment', label: '承诺' },
  { value: 'ConflictRepair', label: '和解' },
  { value: 'InsideJoke', label: '暗号' },
] as const;

export const MEMORY_SOURCE_OPTIONS = [
  { value: '', label: '全部来源' },
  { value: 'chat_turn', label: '对话提取' },
  { value: 'consolidation', label: '睡眠巩固' },
  { value: 'user_explicit', label: '主动记住' },
  { value: 'user_edit', label: '手动纠正' },
  { value: 'PENDING_VERIFICATION', label: '待核验' },
  { value: 'INVALID', label: '已失效' },
] as const;

export const MEMORY_STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '生效中' },
  { value: 'corrected', label: '已纠正' },
  { value: 'forgotten', label: '已遗忘' },
  { value: 'candidate', label: '待确认' },
] as const;

export const EXTRA_TYPE_LABELS: Record<string, string> = {
  ...(typeLabels as Record<string, string>),
  fact: '事实',
  preference: '偏好',
  event: '事件',
  boundary: '边界',
  promise: '约定',
  SharedEpisode: '共同经历',
  Commitment: '承诺',
  ConflictRepair: '和解',
  InsideJoke: '暗号与梗',
};

export const EXTRA_SOURCE_LABELS: Record<string, string> = {
  ...(sourceLabels as Record<string, string>),
  chat_turn: '对话提取',
  consolidation: '睡眠巩固',
  user_explicit: '主动记住',
  user_edit: '手动纠正',
};

export const EXTRA_LIFECYCLE_LABELS: Record<string, string> = {
  ...(lifecycleLabels as Record<string, string>),
  active: '生效中',
  corrected: '已纠正',
  forgotten: '已遗忘',
  forgetting: '清理中',
  superseded: '已被替代',
  candidate: '待确认',
};

export function parseStoredMemoryRouteState(
  raw: string | null | undefined,
): StoredMemoryRouteState {
  const fallback: StoredMemoryRouteState = {
    relId: null,
    tab: 'timeline',
    filters: { ...EMPTY_MEMORY_FILTERS },
  };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredMemoryRouteState>;
    const relId =
      typeof parsed.relId === 'string' &&
      parsed.relId.trim() !== '' &&
      parsed.relId !== 'undefined'
        ? parsed.relId.trim()
        : null;
    return {
      relId,
      tab:
        parsed.tab === 'diary' || parsed.tab === 'favorites'
          ? parsed.tab
          : 'timeline',
      filters: {
        type: String(parsed.filters?.type ?? ''),
        source: String(parsed.filters?.source ?? ''),
        date: String(parsed.filters?.date ?? ''),
        status: String(parsed.filters?.status ?? ''),
        q: String(parsed.filters?.q ?? ''),
      },
    };
  } catch {
    return fallback;
  }
}

export interface LocateMessagePayload {
  relationshipId: string;
  chatIdentity?: string;
  chatFile?: string;
  avatar?: string;
  conversationKey?: string;
  messageKey?: string;
  floor: number | null;
  messageId?: string;
  sourceRef?: string;
  excerpt?: string;
}

export function isCurrentConversation(
  bridge: SessionBridge,
  expectedKey: string,
): boolean {
  if (!expectedKey) return false;
  const snapKey = bridge.getSnapshot().key;
  if (snapKey && snapKey !== expectedKey) return false;
  const ctx = bridge.getContext();
  const file = String(ctx?.getCurrentChatId?.() || ctx?.chatId || '').replace(
    /\.jsonl$/i,
    '',
  );
  const avatar =
    ctx?.characters?.[ctx?.characterId]?.avatar ||
    parseConversationKey(snapKey)?.avatar ||
    '';
  const ctxKey = avatar && file ? normalizeConversationKey(avatar, file) : '';
  if (ctxKey && ctxKey !== expectedKey) return false;
  return Boolean(snapKey || ctxKey);
}

export function resolveLocatedMessageMetadata(
  bridge: SessionBridge,
  floor: number | null,
  options: {
    openedFile?: string;
    openedAvatar?: string;
    fallbackFile?: string;
    fallbackMessageId?: string;
  } = {},
): {
  resolvedFile: string;
  resolvedAvatar: string;
  conversationKey: string;
  messageKey: string | undefined;
  resolvedMessageId: string | undefined;
} {
  const snap = bridge.getSnapshot();
  const ctx = bridge.getContext();
  const currentChatFile = String(
    ctx?.getCurrentChatId?.() || ctx?.chatId || '',
  ).replace(/\.jsonl$/i, '');
  const currentAvatar =
    ctx?.characters?.[ctx?.characterId]?.avatar || snap.avatar || '';
  const resolvedFile =
    options.openedFile ||
    String(options.fallbackFile ?? '').replace(/\.jsonl$/i, '') ||
    currentChatFile;
  const resolvedAvatar = options.openedAvatar || currentAvatar;
  const conversationKey =
    resolvedAvatar && resolvedFile
      ? normalizeConversationKey(resolvedAvatar, resolvedFile)
      : snap.key;

  const snapMessage =
    floor !== null && floor >= 0
      ? snap.messages?.find((m) => m.index === floor) ?? snap.messages?.[floor]
      : undefined;
  const rawMessage =
    floor !== null && floor >= 0 ? ctx?.chat?.[floor] : undefined;
  const resolvedMessageId =
    options.fallbackMessageId ||
    (rawMessage?.vc_message_id ? String(rawMessage.vc_message_id) : undefined);
  const messageKey =
    snapMessage?.key ||
    resolvedMessageId ||
    (floor !== null && floor >= 0 && conversationKey
      ? `${conversationKey}:${String(rawMessage?.send_date ?? '')}:${floor}`
      : undefined);

  return {
    resolvedFile,
    resolvedAvatar,
    conversationKey,
    messageKey,
    resolvedMessageId,
  };
}

export interface UseMemoryRouteStateOptions {
  initialRelationshipId?: string | null;
  initialStoredState?: Partial<StoredMemoryRouteState> | null;
  onPersistState?: (state: StoredMemoryRouteState) => void;
}

export function useMemoryRouteState({
  initialRelationshipId = null,
  initialStoredState = null,
  onPersistState,
}: UseMemoryRouteStateOptions = {}) {
  const activeChatRelId = useChatSnapshot((s) => s.relationshipId);
  const initialRelId =
    initialRelationshipId ??
    (activeChatRelId ? String(activeChatRelId) : null) ??
    (typeof initialStoredState?.relId === 'string' &&
    initialStoredState.relId.trim() !== '' &&
    initialStoredState.relId !== 'undefined'
      ? initialStoredState.relId.trim()
      : null);
  const initialTab: MemoryRouteTab =
    initialStoredState?.tab === 'diary' || initialStoredState?.tab === 'favorites'
      ? initialStoredState.tab
      : 'timeline';
  const initialFilters: MemoryFilterValues = {
    type: String(initialStoredState?.filters?.type ?? ''),
    source: String(initialStoredState?.filters?.source ?? ''),
    date: String(initialStoredState?.filters?.date ?? ''),
    status: String(initialStoredState?.filters?.status ?? ''),
    q: String(initialStoredState?.filters?.q ?? ''),
  };

  const [selectedRelId, setSelectedRelId] = useState<string | null>(initialRelId);
  const [activeTab, setActiveTab] = useState<MemoryRouteTab>(initialTab);
  const [filters, setFilters] = useState<MemoryFilterValues>(initialFilters);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingIncognito, setPendingIncognito] = useState<boolean | null>(null);

  const onPersistStateRef = useRef(onPersistState);
  onPersistStateRef.current = onPersistState;

  const relationshipsQuery = useRelationships();
  const relationships: RelationshipSummary[] = relationshipsQuery.data ?? [];

  useEffect(() => {
    if (relationships.length === 0) return;
    const valid =
      selectedRelId &&
      relationships.some((rel) => String(rel.relationshipId) === selectedRelId);
    if (!valid) {
      const fromChat =
        activeChatRelId &&
        relationships.some(
          (rel) => String(rel.relationshipId) === String(activeChatRelId),
        )
          ? String(activeChatRelId)
          : String(relationships[0].relationshipId);
      setSelectedRelId(fromChat);
    }
  }, [relationships, selectedRelId, activeChatRelId]);

  useEffect(() => {
    onPersistStateRef.current?.({
      relId: selectedRelId,
      tab: activeTab,
      filters,
    });
  }, [selectedRelId, activeTab, filters]);

  const memoryQuery = useMemoryItems(selectedRelId, filters);
  const items: MemoryItem[] = memoryQuery.data?.items ?? [];

  useEffect(() => {
    if (items.length === 0) {
      setSelectedItemId(null);
      return;
    }
    if (!selectedItemId || !items.some((it) => idOf(it) === selectedItemId)) {
      setSelectedItemId(idOf(items[0]));
    }
  }, [items, selectedItemId]);

  const selectedItem = items.find((it) => idOf(it) === selectedItemId) ?? null;

  const incognitoQuery = useIncognitoPref();
  const setIncognitoMutation = useSetIncognitoPref();
  const incognitoEnabled = Boolean(incognitoQuery.data?.incognito);

  const handleToggleIncognito = async (next: boolean) => {
    try {
      await setIncognitoMutation.mutateAsync(next);
      setPendingIncognito(null);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        setPendingIncognito(next);
        setReauthOpen(true);
      }
    }
  };

  const handleReauthSuccess = () => {
    if (pendingIncognito !== null) {
      return handleToggleIncognito(pendingIncognito);
    }
  };

  const selectRelationship = (relId: string | null) => {
    setSelectedRelId(relId);
    setSelectedItemId(null);
  };

  const resetFilters = () => {
    setFilters({ ...EMPTY_MEMORY_FILTERS });
  };

  const relOptions = relationships.map((rel) => {
    const id = String(rel.relationshipId);
    return {
      value: id,
      label: relationshipLabel(rel, relationships),
    };
  });

  return {
    relationships,
    relationshipsQuery,
    relOptions,
    selectedRelId,
    setSelectedRelId,
    selectRelationship,
    activeTab,
    setActiveTab,
    filters,
    setFilters,
    resetFilters,
    memoryQuery,
    items,
    selectedItemId,
    setSelectedItemId,
    selectedItem,
    incognitoQuery,
    incognitoEnabled,
    reauthOpen,
    setReauthOpen,
    pendingIncognito,
    handleToggleIncognito,
    handleReauthSuccess,
  };
}

export interface UseMemoryItemDetailStateOptions {
  item: MemoryItem | null;
  onItemUpdated?: (item: MemoryItem) => void;
  onItemForgotten?: (id: string) => void;
  onNavigateToMessage: (payload: LocateMessagePayload) => void | Promise<void>;
}

export function useMemoryItemDetailState({
  item,
  onItemUpdated,
  onItemForgotten,
  onNavigateToMessage,
}: UseMemoryItemDetailStateOptions) {
  const client = useAppClient();
  const itemId = item ? idOf(item) : null;
  const detailQuery = useMemoryDetail(itemId);
  const evidenceQuery = useMemoryEvidence(itemId);
  const pinMutation = usePinMemory();
  const forgetMutation = useForgetMemory();
  const bridge = useSessionBridge();
  const chatUi = useChatUi();

  const mountedRef = useRef(true);
  const jumpTicketRef = useRef(0);
  const navigatingSelfRef = useRef(false);
  const scopeRef = useRef<{ itemId: string | null }>({ itemId });
  if (scopeRef.current.itemId !== itemId) {
    scopeRef.current = { itemId };
  }

  const [editing, setEditing] = useState(false);
  const [confirmForgetOpen, setConfirmForgetOpen] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    kind: 'pin' | 'forget';
    scope: { itemId: string | null };
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jumpingSourceIdx, setJumpingSourceIdx] = useState<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!navigatingSelfRef.current) {
        jumpTicketRef.current += 1;
      }
    };
  }, []);

  useEffect(() => {
    jumpTicketRef.current += 1;
    setEditing(false);
    setConfirmForgetOpen(false);
    setReauthOpen(false);
    setPendingAction(null);
    setNotice(null);
    setErrorMessage(null);
    setJumpingSourceIdx(null);
  }, [itemId, item?.relationshipId]);

  const currentItem: MemoryItem | null = item ? (detailQuery.data ?? item) : null;
  const evidenceList: MemorySourceRef[] = evidenceQuery.data ?? [];
  const editable = currentItem ? canEdit(currentItem) : false;
  const isPinned = Boolean(currentItem?.pinned || currentItem?.pinnedAt);

  const handlePinToggle = async () => {
    if (!itemId) return;
    const requestScope = scopeRef.current;
    const targetItemId = itemId;
    setErrorMessage(null);
    try {
      const updated = await pinMutation.mutateAsync({
        id: targetItemId,
        pinned: !isPinned,
      });
      if (!mountedRef.current || scopeRef.current !== requestScope) return;
      onItemUpdated?.(updated);
    } catch (err) {
      if (!mountedRef.current || scopeRef.current !== requestScope) return;
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        setPendingAction({ kind: 'pin', scope: requestScope });
        setReauthOpen(true);
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : '操作未完成，请重试。');
    }
  };

  const handleForget = async () => {
    if (!itemId) return;
    const requestScope = scopeRef.current;
    const targetItemId = itemId;
    setErrorMessage(null);
    try {
      await forgetMutation.mutateAsync({ id: targetItemId });
      if (mountedRef.current && scopeRef.current === requestScope) {
        setNotice(FORGET_NOTICE);
      }
      if (scopeRef.current === requestScope) {
        onItemForgotten?.(targetItemId);
      }
    } catch (err) {
      if (!mountedRef.current || scopeRef.current !== requestScope) return;
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        setPendingAction({ kind: 'forget', scope: requestScope });
        setReauthOpen(true);
        return;
      }
      setErrorMessage(
        err instanceof Error ? err.message : '遗忘操作未完成，请重试。',
      );
    }
  };

  const handleJumpToSource = async (ref: MemorySourceRef, idx: number) => {
    if (!currentItem) return;
    const ticket = ++jumpTicketRef.current;
    setJumpingSourceIdx(idx);
    setErrorMessage(null);
    try {
      const parsed = parseSourceRef(ref.sourceRef);
      const messageId = String(ref.messageId || parsed?.messageId || '');
      const mesId =
        parsed?.mesId ?? (/^\d+$/.test(messageId) ? Number(messageId) : null);
      const detail = {
        relationshipId: String(currentItem.relationshipId ?? ''),
        chatIdentity: parsed?.chatIdentity || '',
        messageId,
        mesId,
      };
      let openedTarget = null as {
        relationshipId?: string;
        chatIdentity?: string;
        file?: string;
        avatar?: string;
      } | null;

      const floor = await openMessageSource(detail, {
        getContext: () => bridge.getContext(),
        loadChats: async () => chatSnapshotsFromRecent(await client.recent()),
        openConversation: async (target: {
          relationshipId?: string;
          chatIdentity?: string;
          file?: string;
          avatar?: string;
        }) => {
          if (!mountedRef.current || jumpTicketRef.current !== ticket) {
            return false;
          }
          const avatar = target.avatar || bridge.getSnapshot().avatar;
          openedTarget = { ...target, avatar };
          const status = await bridge.open(openedTarget);
          return (
            status === 'opened' &&
            mountedRef.current &&
            jumpTicketRef.current === ticket
          );
        },
        ensureVisible: () => {},
        document: null,
      });

      if (!mountedRef.current || jumpTicketRef.current !== ticket) {
        return;
      }

      const {
        resolvedFile,
        resolvedAvatar,
        conversationKey,
        messageKey,
        resolvedMessageId,
      } = resolveLocatedMessageMetadata(bridge, floor, {
        openedFile: openedTarget?.file,
        openedAvatar: openedTarget?.avatar,
        fallbackMessageId: messageId || undefined,
      });

      if (!conversationKey || !isCurrentConversation(bridge, conversationKey)) {
        return;
      }

      navigatingSelfRef.current = true;
      try {
        await onNavigateToMessage({
          relationshipId: detail.relationshipId,
          chatIdentity: detail.chatIdentity,
          chatFile: resolvedFile,
          avatar: resolvedAvatar,
          conversationKey,
          messageKey,
          floor,
          messageId: resolvedMessageId ?? messageId,
          sourceRef: ref.sourceRef,
          excerpt: ref.excerpt,
        });
      } finally {
        navigatingSelfRef.current = false;
      }

      if (
        jumpTicketRef.current !== ticket ||
        !isCurrentConversation(bridge, conversationKey)
      ) {
        return;
      }

      chatUi?.requestMessageJump(conversationKey, floor);
    } catch {
      if (mountedRef.current && jumpTicketRef.current === ticket) {
        setErrorMessage('原消息无法定位或所在会话不可用。');
      }
    } finally {
      if (mountedRef.current && jumpTicketRef.current === ticket) {
        setJumpingSourceIdx(null);
      }
    }
  };

  const handleSavedCorrection = (updated: MemoryItem) => {
    setEditing(false);
    setNotice('纠正已保存');
    onItemUpdated?.(updated);
  };

  const handleReauthOpenChange = (open: boolean) => {
    setReauthOpen(open);
    if (!open) {
      setPendingAction(null);
    }
  };

  const handleReauthSuccess = () => {
    if (
      !mountedRef.current ||
      !pendingAction ||
      pendingAction.scope !== scopeRef.current ||
      pendingAction.scope.itemId !== itemId
    ) {
      return;
    }
    setPendingAction(null);
    if (pendingAction.kind === 'pin') return handlePinToggle();
    if (pendingAction.kind === 'forget') return handleForget();
  };

  return {
    itemId,
    currentItem,
    evidenceList,
    editable,
    isPinned,
    editing,
    setEditing,
    confirmForgetOpen,
    setConfirmForgetOpen,
    reauthOpen,
    handleReauthOpenChange,
    handleReauthSuccess,
    notice,
    setNotice,
    errorMessage,
    setErrorMessage,
    jumpingSourceIdx,
    pinPending: pinMutation.isPending,
    forgetPending: forgetMutation.isPending,
    handlePinToggle,
    handleForget,
    handleJumpToSource,
    handleSavedCorrection,
  };
}

export const correctMemorySchema = z.object({
  summary: z.string().trim().min(1, '纠正内容不能为空'),
});

export type CorrectMemoryFormValues = z.infer<typeof correctMemorySchema>;

export interface UseCorrectMemoryStateOptions {
  item: MemoryItem;
  onSaved: (updated: MemoryItem) => void;
}

export interface CorrectMemoryController {
  form: UseFormReturn<CorrectMemoryFormValues>;
  summaryValue: string;
  isDirty: boolean;
  expectedVersion: number;
  conflictItem: MemoryItem | null;
  errorMessage: string | null;
  reauthOpen: boolean;
  setReauthOpen: (open: boolean) => void;
  isPending: boolean;
  handleSummaryChange: (val: string) => void;
  handleAcceptConflictVersion: () => void;
  executeSave: () => Promise<void>;
}

export function useCorrectMemoryState({
  item,
  onSaved,
}: UseCorrectMemoryStateOptions): CorrectMemoryController {
  const client = useAppClient();
  const correctMutation = useCorrectMemory();
  const itemId = idOf(item);

  const mountedRef = useRef(true);
  const scopeRef = useRef<{ itemId: string }>({ itemId });
  if (scopeRef.current.itemId !== itemId) {
    scopeRef.current = { itemId };
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [expectedVersion, setExpectedVersion] = useState<number>(
    Number(item.version ?? 1),
  );
  const [conflictItem, setConflictItem] = useState<MemoryItem | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);

  const form = useForm<CorrectMemoryFormValues>({
    defaultValues: {
      summary: item.summary ?? '',
    },
  });

  const {
    watch,
    setValue,
    reset,
    getValues,
    formState: { isDirty },
  } = form;

  const summaryValue = watch('summary');

  useEffect(() => {
    reset({ summary: item.summary ?? '' });
    setExpectedVersion(Number(item.version ?? 1));
    setConflictItem(null);
    setErrorMessage(null);
  }, [itemId, reset]);

  const handleSummaryChange = (val: string) => {
    setValue('summary', val, { shouldDirty: true });
    if (errorMessage && !conflictItem) {
      setErrorMessage(null);
    }
  };

  const handleAcceptConflictVersion = () => {
    if (!conflictItem) return;
    reset({ summary: conflictItem.summary });
    setExpectedVersion(Number(conflictItem.version ?? expectedVersion));
    setConflictItem(null);
    setErrorMessage(null);
  };

  const executeSave = async () => {
    const raw = getValues();
    const parsed = correctMemorySchema.safeParse(raw);
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? '纠正内容不能为空');
      return;
    }

    const requestScope = scopeRef.current;
    setErrorMessage(null);
    try {
      const updated = await correctMutation.mutateAsync({
        id: itemId,
        summary: parsed.data.summary,
        expectedVersion,
      });
      if (mountedRef.current && scopeRef.current === requestScope) {
        setConflictItem(null);
        reset({ summary: updated.summary });
      }
      if (scopeRef.current === requestScope) {
        onSaved(updated);
      }
    } catch (err) {
      if (!mountedRef.current || scopeRef.current !== requestScope) return;
      const status = (err as { status?: number })?.status;
      const code = (err as { code?: string })?.code;
      const kind = (err as { kind?: string })?.kind;

      if (err instanceof ConflictError || status === 409) {
        const currentFromDetails = (
          err as { details?: { current?: MemoryItem } }
        )?.details?.current;
        if (currentFromDetails) {
          setConflictItem(currentFromDetails);
          if (currentFromDetails.version) {
            setExpectedVersion(Number(currentFromDetails.version));
          }
        } else {
          try {
            const fresh = (await client.go.fetchMemory(itemId)) as MemoryItem | null;
            if (!mountedRef.current || scopeRef.current !== requestScope) return;
            if (fresh) {
              setConflictItem(fresh);
              if (fresh.version) {
                setExpectedVersion(Number(fresh.version));
              }
            }
          } catch {
            // Keep conflict message even if refresh fails
          }
        }
        setErrorMessage('版本冲突 (409)：该记忆已在别处更新，你的草稿已保留。');
        return;
      }

      if (
        status === 401 ||
        status === 403 ||
        code === 'step_up_required' ||
        kind === 'forbidden'
      ) {
        setReauthOpen(true);
        return;
      }

      setErrorMessage(
        err instanceof Error ? err.message : '保存纠正失败，请重试。',
      );
    }
  };

  return {
    form,
    summaryValue,
    isDirty,
    expectedVersion,
    conflictItem,
    errorMessage,
    reauthOpen,
    setReauthOpen,
    isPending: correctMutation.isPending,
    handleSummaryChange,
    handleAcceptConflictVersion,
    executeSave,
  };
}

export type DiaryFontMode = 'body' | 'hand';

export interface UseDiaryStateOptions {
  relId: string | null;
  initialDay?: string;
  initialFontMode?: DiaryFontMode;
  onFontModeChange?: (next: DiaryFontMode) => DiaryFontMode | void;
}

export function useDiaryState({
  relId,
  initialDay,
  initialFontMode = 'body',
  onFontModeChange,
}: UseDiaryStateOptions) {
  const today = initialDay ?? localDay();
  const [month, setMonth] = useState<string>(() => monthOfDay(today));
  const [selectedDay, setSelectedDay] = useState<string>(today);
  const [fontMode, setFontMode] = useState<DiaryFontMode>(initialFontMode);

  const diariesQuery = useDiaries(relId, month);
  const entries = diariesQuery.data ?? [];

  const entriesByDay = new Map<string, DiaryEntry>();
  for (const entry of entries) {
    const dayKey = String(entry.day ?? entry.entryDate ?? '');
    if (dayKey) {
      entriesByDay.set(dayKey, entry);
    }
  }

  useEffect(() => {
    const sortedDays = Array.from(entriesByDay.keys()).sort();
    if (!selectedDay.startsWith(month)) {
      const fallback = sortedDays.at(-1) || `${month}-01`;
      setSelectedDay(fallback);
    } else if (!entriesByDay.has(selectedDay) && sortedDays.length > 0) {
      setSelectedDay(sortedDays[sortedDays.length - 1]);
    }
  }, [month, entries.length]);

  const summaryEntry = entriesByDay.get(selectedDay) ?? null;
  const summaryEntryId = summaryEntry
    ? String(summaryEntry.diaryId ?? summaryEntry.id ?? '')
    : null;
  const needFullFetch = Boolean(
    summaryEntryId && !summaryEntry?.body && !summaryEntry?.content,
  );
  const fullEntryQuery = useDiaryEntry(needFullFetch ? summaryEntryId : null);

  const activeEntry = fullEntryQuery.data ?? summaryEntry;
  const days = monthDays(month);
  const moments = activeEntry?.moments ?? activeEntry?.highlights ?? [];

  const handlePrevMonth = () => setMonth((m) => shiftMonth(m, -1));
  const handleNextMonth = () => setMonth((m) => shiftMonth(m, 1));

  const handleToggleFont = () => {
    const target: DiaryFontMode = fontMode === 'hand' ? 'body' : 'hand';
    const resolved = onFontModeChange ? onFontModeChange(target) : target;
    setFontMode(resolved === 'hand' || resolved === 'body' ? resolved : target);
  };

  return {
    month,
    setMonth,
    selectedDay,
    setSelectedDay,
    fontMode,
    setFontMode,
    diariesQuery,
    entries,
    entriesByDay,
    fullEntryQuery,
    activeEntry,
    days,
    moments,
    handlePrevMonth,
    handleNextMonth,
    handleToggleFont,
  };
}

export const FAVORITE_SEGMENT_OPTIONS = FAVORITES_SEGMENTS.map(
  ([value, label]) => ({
    value: String(value),
    label: String(label),
  }),
);

export interface UseFavoritesStateOptions {
  relId: string | null;
  onNavigateToMessage: (payload: LocateMessagePayload) => void | Promise<void>;
}

export function useFavoritesState({
  relId,
  onNavigateToMessage,
}: UseFavoritesStateOptions) {
  const client = useAppClient();
  const [segment, setSegment] = useState<'favorites' | 'reminders'>('favorites');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const favoritesQuery = useFavorites(relId);
  const remindersQuery = useReminders(relId);
  const deleteFavMutation = useDeleteFavorite(relId);
  const deleteRemMutation = useDeleteReminder(relId);
  const bridge = useSessionBridge();
  const chatUi = useChatUi();

  const mountedRef = useRef(true);
  const jumpTicketRef = useRef(0);
  const navigatingSelfRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!navigatingSelfRef.current) {
        jumpTicketRef.current += 1;
      }
    };
  }, []);

  useEffect(() => {
    jumpTicketRef.current += 1;
    setErrorMessage(null);
  }, [relId, segment]);

  const favorites: FavoriteItem[] = favoritesQuery.data ?? [];
  const reminders: ReminderItem[] = remindersQuery.data ?? [];

  const handleJumpFavorite = async (fav: FavoriteItem) => {
    const ticket = ++jumpTicketRef.current;
    setErrorMessage(null);
    const relationshipId = String(fav.relationshipId ?? relId ?? '');
    const detail = {
      relationshipId,
      chatFile: fav.chatFile,
      body: fav.body ?? fav.content ?? '',
      role: fav.role ?? 'character',
      messageAt: fav.messageAt ?? fav.createdAt,
    };
    let openedTarget = null as {
      relationshipId?: string;
      file?: string;
      avatar?: string;
    } | null;

    try {
      const floor = await openMessageSource(detail, {
        getContext: () => bridge.getContext(),
        loadChats: async () => chatSnapshotsFromRecent(await client.recent()),
        openConversation: async (target: {
          relationshipId?: string;
          file?: string;
          avatar?: string;
        }) => {
          if (!mountedRef.current || jumpTicketRef.current !== ticket) {
            return false;
          }
          const avatar = target.avatar || bridge.getSnapshot().avatar;
          openedTarget = { ...target, avatar };
          const status = await bridge.open(openedTarget);
          return (
            status === 'opened' &&
            mountedRef.current &&
            jumpTicketRef.current === ticket
          );
        },
        ensureVisible: () => {},
        document: null,
      });

      if (!mountedRef.current || jumpTicketRef.current !== ticket) {
        return;
      }

      const {
        resolvedFile,
        resolvedAvatar,
        conversationKey,
        messageKey,
        resolvedMessageId,
      } = resolveLocatedMessageMetadata(bridge, floor, {
        openedFile: openedTarget?.file,
        openedAvatar: openedTarget?.avatar,
        fallbackFile: fav.chatFile,
      });

      if (!conversationKey || !isCurrentConversation(bridge, conversationKey)) {
        return;
      }

      navigatingSelfRef.current = true;
      try {
        await onNavigateToMessage({
          relationshipId,
          chatFile: resolvedFile,
          avatar: resolvedAvatar,
          conversationKey,
          messageKey,
          floor,
          ...(resolvedMessageId ? { messageId: resolvedMessageId } : {}),
          excerpt: detail.body,
        });
      } finally {
        navigatingSelfRef.current = false;
      }

      if (
        jumpTicketRef.current !== ticket ||
        !isCurrentConversation(bridge, conversationKey)
      ) {
        return;
      }

      chatUi?.requestMessageJump(conversationKey, floor);
    } catch {
      if (mountedRef.current && jumpTicketRef.current === ticket) {
        setErrorMessage('原消息无法定位或所在会话不可用。');
      }
    }
  };

  const handleRemoveFavorite = async (favId: string) => {
    await deleteFavMutation.mutateAsync(favId);
  };

  const handleRemoveReminder = async (remId: string) => {
    await deleteRemMutation.mutateAsync(remId);
  };

  return {
    segment,
    setSegment,
    errorMessage,
    setErrorMessage,
    favorites,
    reminders,
    favoritesQuery,
    remindersQuery,
    deleteFavPending: deleteFavMutation.isPending,
    deleteRemPending: deleteRemMutation.isPending,
    handleJumpFavorite,
    handleRemoveFavorite,
    handleRemoveReminder,
  };
}
