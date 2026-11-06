import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAppClient } from '../../app/providers';
import { ConflictError } from '../../data/client';
import { normalizeConversationKey } from '../../data/queries/chat';
import {
  normalizeProactivePolicy,
  useCancelFollowUp,
  useChannels,
  useFollowUps,
  useInbox,
  useMarkInboxRead,
  useProactivePolicy,
  useReauth,
  useSaveChannel,
  useSavePolicy,
  type Channel,
  type FollowUpItem,
  type InboxEvent,
  type InboxFilter,
  type ProactivePolicy,
} from '../../data/queries/inbox';
import { useRelationships } from '../../data/queries/memory';
import { useChatSnapshot } from '../../runtime/session-bridge';
import { resolveDesktopConversation } from '../../../../extension/vc-model-settings/desktop/standalone/business.js';
import {
  FILTERS,
  PROACTIVE_LABELS,
  draftsFromChannels,
  readProactivePolicy,
  validatePolicy,
} from '../../../../extension/vc-model-settings/inbox-logic.js';
import { relationshipLabel } from '../../../../extension/vc-model-settings/memory-logic.js';

export interface InboxRelationshipOption {
  value: string;
  label: string;
}

export interface UseInboxRelationshipOptions {
  initialRelationshipId?: string | null;
}

export function useInboxRelationship(
  optionsOrInitialRelId: UseInboxRelationshipOptions | string | null = null,
) {
  const initialRelationshipId =
    typeof optionsOrInitialRelId === 'string' || optionsOrInitialRelId === null
      ? optionsOrInitialRelId
      : (optionsOrInitialRelId?.initialRelationshipId ?? null);

  const activeChatRelId = useChatSnapshot((s) => s.relationshipId);
  const relationshipsQuery = useRelationships();
  const relationships = relationshipsQuery.data ?? [];

  const [selectedRelId, setSelectedRelId] = useState<string | null>(
    initialRelationshipId ?? (activeChatRelId ? String(activeChatRelId) : null),
  );
  const [policyDirty, setPolicyDirty] = useState(false);
  const [pendingRelId, setPendingRelId] = useState<string | null>(null);

  useEffect(() => {
    if (relationships.length === 0) return;
    if (
      !selectedRelId ||
      !relationships.some((rel) => String(rel.relationshipId) === selectedRelId)
    ) {
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

  const relOptions = useMemo<InboxRelationshipOption[]>(
    () =>
      relationships.map((rel) => {
        const id = String(rel.relationshipId);
        return {
          value: id,
          label: relationshipLabel(rel, relationships),
        };
      }),
    [relationships],
  );

  const selectRelationship = useCallback(
    (val: string) => {
      if (val === selectedRelId) return;
      if (policyDirty) {
        setPendingRelId(val);
        return;
      }
      setSelectedRelId(val);
    },
    [selectedRelId, policyDirty],
  );

  const confirmSwitchRelationship = useCallback(() => {
    if (pendingRelId !== null) {
      setPolicyDirty(false);
      setSelectedRelId(pendingRelId);
      setPendingRelId(null);
    }
  }, [pendingRelId]);

  const cancelSwitchRelationship = useCallback(() => {
    setPendingRelId(null);
  }, []);

  return {
    relationshipsQuery,
    relationships,
    relOptions,
    selectedRelId,
    setSelectedRelId,
    policyDirty,
    setPolicyDirty,
    pendingRelId,
    setPendingRelId,
    confirmDiscardOpen: pendingRelId !== null,
    selectRelationship,
    confirmSwitchRelationship,
    cancelSwitchRelationship,
  };
}

export const policyFormSchema = z
  .object({
    relationshipId: z.string(),
    enabled: z.boolean(),
    supportsMode: z.boolean(),
    supportsCheckIn: z.boolean(),
    mode: z.string(),
    checkInAfterMinutes: z.number().nullable(),
    quietHoursStart: z.string(),
    quietHoursEnd: z.string(),
    quietHoursTimezone: z.string(),
    dailyLimit: z.number(),
    recentInteractionMinutes: z.number(),
    allowedModes: z.array(z.string()),
    offlineCapable: z.boolean(),
  })
  .superRefine((val, ctx) => {
    const message = validatePolicy(val);
    if (message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message,
      });
    }
  });

export type PolicyFormValues = z.infer<typeof policyFormSchema>;

export function toPolicyFormValues(policy: ProactivePolicy): PolicyFormValues {
  return {
    relationshipId: policy.relationshipId,
    enabled: policy.enabled,
    supportsMode: policy.supportsMode,
    supportsCheckIn: policy.supportsCheckIn,
    mode: policy.mode,
    checkInAfterMinutes: policy.checkInAfterMinutes,
    quietHoursStart: policy.quietHoursStart,
    quietHoursEnd: policy.quietHoursEnd,
    quietHoursTimezone: policy.quietHoursTimezone,
    dailyLimit: policy.dailyLimit,
    recentInteractionMinutes: policy.recentInteractionMinutes,
    allowedModes: policy.allowedModes.length > 0 ? [...policy.allowedModes] : ['COMPANION'],
    offlineCapable: policy.offlineCapable,
  };
}

export const POLICY_MODE_OPTIONS = [
  { value: 'OFF', label: PROACTIVE_LABELS.OFF || '关闭' },
  { value: 'FOLLOW_UP', label: PROACTIVE_LABELS.FOLLOW_UP || '跟进' },
  { value: 'DAILY', label: PROACTIVE_LABELS.DAILY || '日常' },
  { value: 'CLOSE_FRIEND', label: PROACTIVE_LABELS.CLOSE_FRIEND || '亲近' },
] as const;

export interface UsePolicyFormOptions {
  relId: string | null;
  onSaved?: (policy: ProactivePolicy) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

export function usePolicyForm({ relId, onSaved, onDirtyChange }: UsePolicyFormOptions) {
  const policyQuery = useProactivePolicy(relId);
  const saveMutation = useSavePolicy(relId);
  const activeRelRef = useRef<string | null>(relId);
  activeRelRef.current = relId;
  const prevRelIdRef = useRef<string | null>(relId);

  const [conflictLatest, setConflictLatest] = useState<ProactivePolicy | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);

  const form = useForm<PolicyFormValues>({
    defaultValues: toPolicyFormValues(
      readProactivePolicy({}, relId ?? '') as ProactivePolicy,
    ),
  });

  const {
    watch,
    setValue,
    reset,
    getValues,
    formState: { isDirty },
  } = form;

  const values = watch();
  const isPolicyReady =
    Boolean(relId) &&
    Boolean(policyQuery.data) &&
    (!policyQuery.data?.relationshipId || policyQuery.data.relationshipId === relId) &&
    !policyQuery.isLoading &&
    !policyQuery.isPending &&
    !policyQuery.isError &&
    !policyQuery.error;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (prevRelIdRef.current === relId) return;
    prevRelIdRef.current = relId;
    setConflictLatest(null);
    setFormError(null);
    setReauthOpen(false);
    if (isPolicyReady && policyQuery.data) {
      reset(toPolicyFormValues(policyQuery.data));
    } else {
      reset(toPolicyFormValues(readProactivePolicy({}, relId ?? '') as ProactivePolicy));
    }
  }, [relId, isPolicyReady, policyQuery.data, reset]);

  useEffect(() => {
    if (!isPolicyReady || !policyQuery.data) return;
    if (isDirty || conflictLatest) return;
    reset(toPolicyFormValues(policyQuery.data));
  }, [isPolicyReady, policyQuery.data, isDirty, conflictLatest, reset]);

  const executeSave = async () => {
    if (!relId || !isPolicyReady || prevRelIdRef.current !== relId) return;
    const capturedRelId = relId;
    const rawValues = getValues();
    if (rawValues.relationshipId && rawValues.relationshipId !== capturedRelId) return;
    const parsed = policyFormSchema.safeParse({
      ...rawValues,
      relationshipId: capturedRelId,
      dailyLimit: Number(rawValues.dailyLimit),
      recentInteractionMinutes: Number(rawValues.recentInteractionMinutes),
      checkInAfterMinutes:
        rawValues.supportsCheckIn && rawValues.checkInAfterMinutes !== null
          ? Number(rawValues.checkInAfterMinutes)
          : null,
    });

    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '请检查表单输入';
      setFormError(msg);
      return;
    }

    setFormError(null);
    try {
      const saved = await saveMutation.mutateAsync(parsed.data);
      if (activeRelRef.current !== capturedRelId) return;
      reset(toPolicyFormValues(saved));
      setConflictLatest(null);
      onSaved?.(saved);
    } catch (err) {
      if (activeRelRef.current !== capturedRelId) return;
      const status = (err as { status?: number })?.status;
      const kind = (err as { kind?: string })?.kind;
      if (err instanceof ConflictError || status === 409 || kind === 'conflict-revision') {
        const detailsCurrent = (err as { details?: { current?: Record<string, unknown> } })
          ?.details?.current;
        if (detailsCurrent) {
          setConflictLatest(normalizeProactivePolicy(detailsCurrent, capturedRelId));
        } else {
          const refetched = await policyQuery.refetch();
          if (activeRelRef.current === capturedRelId && refetched.data) {
            setConflictLatest(refetched.data);
          }
        }
        setFormError('版本冲突 (409)：该策略已在别处更新，你的草稿已保留。');
        return;
      }
      if (status === 401 || status === 403 || kind === 'forbidden') {
        setReauthOpen(true);
        return;
      }
      setFormError(err instanceof Error ? err.message : '没有保存，请重试。');
    }
  };

  const handleLoadLatest = () => {
    if (!conflictLatest) return;
    reset(toPolicyFormValues(conflictLatest));
    setConflictLatest(null);
    setFormError(null);
  };

  const handleKeepDraft = () => {
    setConflictLatest(null);
    setFormError(null);
  };

  const setEnabled = (checked: boolean) => {
    setValue('enabled', checked, { shouldDirty: true });
    if (values.supportsMode) {
      if (!checked && values.mode !== 'OFF') {
        setValue('mode', 'OFF', { shouldDirty: true });
      } else if (checked && values.mode === 'OFF') {
        setValue('mode', 'DAILY', { shouldDirty: true });
      }
    }
  };

  const setMode = (nextMode: string) => {
    setValue('mode', nextMode, { shouldDirty: true });
    setValue('enabled', nextMode !== 'OFF', { shouldDirty: true });
  };

  const setCheckInAfterMinutes = (val: string) => {
    const num = val.trim() === '' ? null : Number(val);
    setValue('checkInAfterMinutes', num !== null && !Number.isNaN(num) ? num : null, {
      shouldDirty: true,
    });
  };

  const setDailyLimit = (val: string) => {
    const num = val.trim() === '' ? 0 : Number(val);
    setValue('dailyLimit', Number.isNaN(num) ? 0 : num, { shouldDirty: true });
  };

  const setRecentInteractionMinutes = (val: string) => {
    const num = val.trim() === '' ? 0 : Number(val);
    setValue('recentInteractionMinutes', Number.isNaN(num) ? 0 : num, { shouldDirty: true });
  };

  const toggleAllowedMode = (modeKey: 'COMPANION' | 'STORY') => {
    const set = new Set(values.allowedModes);
    if (set.has(modeKey)) {
      if (set.size <= 1) return;
      set.delete(modeKey);
    } else {
      set.add(modeKey);
    }
    setValue('allowedModes', [...set], { shouldDirty: true });
  };

  const setQuietHoursStart = (val: string) =>
    setValue('quietHoursStart', val, { shouldDirty: true });
  const setQuietHoursEnd = (val: string) =>
    setValue('quietHoursEnd', val, { shouldDirty: true });
  const setQuietHoursTimezone = (val: string) =>
    setValue('quietHoursTimezone', val, { shouldDirty: true });
  const setOfflineCapable = (checked: boolean) =>
    setValue('offlineCapable', checked, { shouldDirty: true });

  return {
    form,
    values,
    isDirty,
    isPolicyReady,
    isSaving: saveMutation.isPending,
    policyQuery,
    saveMutation,
    conflictLatest,
    formError,
    reauthOpen,
    setReauthOpen,
    executeSave,
    handleLoadLatest,
    handleKeepDraft,
    setEnabled,
    setMode,
    setCheckInAfterMinutes,
    setDailyLimit,
    setRecentInteractionMinutes,
    toggleAllowedMode,
    setQuietHoursStart,
    setQuietHoursEnd,
    setQuietHoursTimezone,
    setOfflineCapable,
  };
}

export function useFollowUpsState(relId: string | null) {
  const followUpsQuery = useFollowUps(relId);
  const cancelMutation = useCancelFollowUp(relId);
  const [confirmTargetId, setConfirmTargetId] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const items: FollowUpItem[] = followUpsQuery.data ?? [];

  const runCancel = async (followUpId: string) => {
    setErrorMessage(null);
    try {
      await cancelMutation.mutateAsync(followUpId);
      setPendingCancelId(null);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const kind = (err as { kind?: string })?.kind;
      if (status === 401 || status === 403 || kind === 'forbidden') {
        setPendingCancelId(followUpId);
        setReauthOpen(true);
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : '没有取消，请重试。');
    }
  };

  return {
    followUpsQuery,
    cancelMutation,
    items,
    confirmTargetId,
    setConfirmTargetId,
    reauthOpen,
    setReauthOpen,
    pendingCancelId,
    errorMessage,
    runCancel,
  };
}

export const INBOX_FILTER_OPTIONS = FILTERS.map(([value, label]) => ({
  value: String(value),
  label: String(label),
}));

export type OpenInboxConversationHandler = (
  conversationKey: string,
  event: InboxEvent,
) => void | Promise<void>;

export interface UseInboxListOptions {
  initialFilter?: InboxFilter;
  onOpenConversation: OpenInboxConversationHandler;
  onOpenEvent?: (event: InboxEvent) => void | Promise<void>;
}

export function useInboxList({
  initialFilter = 'all',
  onOpenConversation,
  onOpenEvent,
}: UseInboxListOptions) {
  const client = useAppClient();
  const [filter, setFilter] = useState<InboxFilter>(initialFilter);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inboxQuery = useInbox(filter);
  const markReadMutation = useMarkInboxRead();

  const mountedRef = useRef(true);
  const openTicketRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      openTicketRef.current += 1;
    };
  }, []);

  const events = inboxQuery.data ?? [];

  const handleOpen = async (event: InboxEvent) => {
    if (event.linkStatus !== 'present') return;
    const ticket = ++openTicketRef.current;
    setErrorMessage(null);

    if (!event.read) {
      try {
        await markReadMutation.mutateAsync(event.eventId);
      } catch {
        if (mountedRef.current && openTicketRef.current === ticket) {
          setErrorMessage('没有记下已读，请重试。');
        }
        return;
      }
      if (!mountedRef.current || openTicketRef.current !== ticket) {
        return;
      }
    }

    let conversationKey = event.conversationKey ? String(event.conversationKey) : '';
    if (!conversationKey) {
      if (!event.relationshipId && !event.conversationId) {
        if (mountedRef.current && openTicketRef.current === ticket) {
          setErrorMessage('聊天没有加载出来，请重试。');
        }
        return;
      }
      try {
        const rows = await client.recent();
        if (!mountedRef.current || openTicketRef.current !== ticket) {
          return;
        }
        const resolved = resolveDesktopConversation(Array.isArray(rows) ? rows : [], {
          relationshipId: event.relationshipId,
          conversationId: event.conversationId,
        });
        if (resolved?.avatar && resolved?.file) {
          conversationKey = normalizeConversationKey(resolved.avatar, resolved.file);
        }
      } catch {
        if (mountedRef.current && openTicketRef.current === ticket) {
          setErrorMessage('聊天没有加载出来，请重试。');
        }
        return;
      }
    }

    if (!mountedRef.current || openTicketRef.current !== ticket) {
      return;
    }

    if (!conversationKey) {
      setErrorMessage('聊天没有加载出来，请重试。');
      return;
    }

    await onOpenConversation(conversationKey, event);

    if (!mountedRef.current || openTicketRef.current !== ticket) {
      return;
    }

    await onOpenEvent?.(event);
  };

  return {
    filter,
    setFilter,
    filterOptions: INBOX_FILTER_OPTIONS,
    errorMessage,
    events,
    inboxQuery,
    markReadMutation,
    handleOpen,
  };
}

export interface ChannelDraft {
  key: string;
  channelId: string;
  channel: 'EMAIL' | 'FEISHU' | string;
  exists: boolean;
  enabled: boolean;
  configuredTarget: string;
  previewBody: boolean;
  relationshipIds: string[];
  credential: string;
  credentialMode: 'keep' | 'set' | 'clear';
  credentialState: 'configured' | 'withheld' | 'missing';
}

export const CHANNEL_TITLES: Record<string, string> = {
  EMAIL: '邮箱通知',
  FEISHU: '飞书通知',
};

export interface UseChannelSheetOptions {
  relId: string | null;
  onSaved?: (channel: Channel) => void;
}

export function useChannelSheet({ relId, onSaved }: UseChannelSheetOptions) {
  const channelsQuery = useChannels();
  const relationshipsQuery = useRelationships();
  const relationships = relationshipsQuery.data ?? [];
  const saveChannelMutation = useSaveChannel();

  const [activeDraft, setActiveDraft] = useState<ChannelDraft | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);

  const rows = (channelsQuery.data ?? []) as Channel[];
  const drafts = draftsFromChannels(rows, relId || '') as ChannelDraft[];
  const relationshipOptions = new Map(
    relationships.map((rel) => [
      String(rel.relationshipId),
      relationshipLabel(rel, relationships),
    ]),
  );
  const savedChannel = drafts.find((draft) => draft.channel === activeDraft?.channel);
  for (const id of savedChannel?.relationshipIds ?? []) {
    if (!relationshipOptions.has(id)) relationshipOptions.set(id, id);
  }

  const openDraft = (draft: ChannelDraft) => {
    setErrorMessage(null);
    setActiveDraft(draft);
  };

  const updateActiveDraft = (patch: Partial<ChannelDraft>) => {
    setActiveDraft((draft) => {
      if (!draft) return null;
      const next = { ...draft, ...patch };
      if (patch.credential !== undefined && patch.credentialMode === undefined) {
        next.credentialMode = patch.credential
          ? 'set'
          : draft.credentialMode === 'clear'
            ? 'clear'
            : 'keep';
      }
      return next;
    });
  };

  const setClearCredential = (checked: boolean) => {
    updateActiveDraft({
      credential: '',
      credentialMode: checked ? 'clear' : 'keep',
    });
  };

  const toggleRelationship = (id: string, checked: boolean) => {
    if (!activeDraft) return;
    const currentIds = activeDraft.relationshipIds;
    const nextIds = checked
      ? currentIds.includes(id)
        ? currentIds
        : [...currentIds, id]
      : currentIds.filter((item) => item !== id);
    updateActiveDraft({ relationshipIds: nextIds });
  };

  const handleCloseSheet = (open: boolean) => {
    if (!open) {
      setActiveDraft(null);
      setErrorMessage(null);
    }
  };

  const executeSaveChannel = async () => {
    if (!activeDraft) return;
    const target = activeDraft.configuredTarget.trim();
    if (target.toLowerCase().includes('://')) {
      setErrorMessage('地址不能是链接。');
      return;
    }
    if (!target || target.length > 320) {
      setErrorMessage('请填写收件地址或群名称。');
      return;
    }

    setErrorMessage(null);
    try {
      const saved = await saveChannelMutation.mutateAsync({
        channel: activeDraft.channel,
        enabled: activeDraft.enabled,
        configuredTarget: target,
        previewBody: activeDraft.previewBody,
        relationshipIds: activeDraft.relationshipIds,
        ...(activeDraft.credentialMode === 'set' ? { credential: activeDraft.credential } : {}),
        ...(activeDraft.credentialMode === 'clear' ? { credential: null } : {}),
      });
      onSaved?.(saved);
      handleCloseSheet(false);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const kind = (err as { kind?: string })?.kind;
      if (status === 401 || status === 403 || kind === 'forbidden') {
        setReauthOpen(true);
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : '没有保存，请重试。');
    }
  };

  return {
    channelsQuery,
    relationshipsQuery,
    saveChannelMutation,
    drafts,
    relationshipOptions,
    activeDraft,
    setActiveDraft,
    errorMessage,
    setErrorMessage,
    reauthOpen,
    setReauthOpen,
    openDraft,
    updateActiveDraft,
    setClearCredential,
    toggleRelationship,
    handleCloseSheet,
    executeSaveChannel,
  };
}

export const reauthSchema = z.object({
  password: z.string().min(1, '请输入当前密码'),
});

export interface UseReauthDialogOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void | Promise<void>;
}

export function useReauthDialog({ open, onOpenChange, onSuccess }: UseReauthDialogOptions) {
  const [password, setPasswordState] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const reauthMutation = useReauth();

  useEffect(() => {
    if (!open) {
      setPasswordState('');
      setErrorMessage(null);
    }
  }, [open]);

  const setPassword = (val: string) => {
    setPasswordState(val);
    if (errorMessage) setErrorMessage(null);
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPasswordState('');
      setErrorMessage(null);
    }
    onOpenChange(nextOpen);
  };

  const submit = async () => {
    const parsed = reauthSchema.safeParse({ password });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? '请输入当前密码');
      return;
    }
    setErrorMessage(null);
    try {
      await reauthMutation.mutateAsync(parsed.data.password);
      setPasswordState('');
      onOpenChange(false);
      await onSuccess?.();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : '身份验证未完成，请检查密码后重试。';
      setErrorMessage(msg || '身份验证未完成，请检查密码后重试。');
    }
  };

  return {
    password,
    setPassword,
    errorMessage,
    reauthMutation,
    isPending: reauthMutation.isPending,
    handleClose,
    submit,
  };
}
