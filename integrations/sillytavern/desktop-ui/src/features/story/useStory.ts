import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ACTION_CONFLICT,
  ACTION_FAILED,
  CASE_TITLE,
  CASTABLE,
  CHAT_IDENTITY,
  CONFIG_MISSING,
  DECIMAL_ID,
  DISCARD_HINT,
  NEED_CAST,
  REASONS,
  REWIND_BLOCKED,
  REWIND_FAILED,
  SAVE_HINT,
  SESSION_CHANGED,
  START_FAILED,
  STEPS,
  STORY_CONFLICT,
  allowRun,
  decimalOf,
  freshClueName,
  initial,
  rewindCopy,
  rewindTargets,
  shown,
  stageWord,
  storyTurn,
} from '../../../../extension/vc-model-settings/story-logic.js';
import { useAppClient } from '../../app/providers';
import { queryKeys } from '../../data/queryKeys';
import {
  buildStoryRunRecord,
  commitStoryActionWithClient,
  decideStoryEpilogueWithClient,
  ensureStoryConversation,
  mapStoryParticipantWithClient,
  normalizeStoryView,
  rewindStoryWithClient,
  upsertStoryRunCache,
  useStoryCompanions,
  useStoryModelPurposes,
  useStoryRun,
  useStoryRuns,
  useStoryView,
  type StoryActorView,
  type StoryCompanionRow,
  type StoryRunRecord,
} from '../../data/queries/story';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';

export const WIZARD_STEPS = [
  { step: 1, label: '选择剧目' },
  { step: 2, label: '同行陪伴' },
  { step: 3, label: '公开设定' },
  { step: 4, label: '调查方式' },
  { step: 5, label: '确认开局' },
] as const;

export const CAST_ACTOR_LABELS: Record<string, string> = {
  lin: '林岚',
  zhou: '周澈',
  su: '苏禾',
};

export function isEpilogueDirty(
  ended: boolean,
  summaryDraft: string,
  epilogueMessage = '',
): boolean {
  return Boolean(ended && summaryDraft.trim() && !epilogueMessage);
}

export interface StartWizardSuccess {
  runId: string;
  branchId: string;
  worldVersion: number;
  conversationId: string;
  chatIdentity: string;
  run: StoryRunRecord;
  view: StoryActorView;
}

export interface UseStartWizardOptions {
  onStarted?: (result: StartWizardSuccess) => void;
  onError?: (error: { message: string; needsModelConfig?: boolean }) => void;
}

export function useStartWizard({ onStarted, onError }: UseStartWizardOptions = {}) {
  const client = useAppClient();
  const bridge = useSessionBridge();
  const queryClient = useQueryClient();
  const companionsQuery = useStoryCompanions(true);

  const [step, setStep] = useState<number>(1);
  const [selectedCompanionId, setSelectedCompanionId] = useState<string>('');
  const [selectedCastActor, setSelectedCastActor] = useState<string>('lin');
  const [busy, setBusy] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>('');
  const [needsConfig, setNeedsConfig] = useState<boolean>(false);

  const aliveRef = useRef<boolean>(true);
  const epochRef = useRef<number>(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      epochRef.current += 1;
    };
  }, []);

  const companions = companionsQuery.data ?? [];
  const selectedCompanion = companions.find(
    (c) => String(c.relationshipId) === String(selectedCompanionId),
  );

  const prevStep = useCallback(() => {
    setStep((s) => Math.max(1, s - 1));
  }, []);

  const nextStep = useCallback(() => {
    setStep((s) => Math.min(5, s + 1));
  }, []);

  const handleStart = useCallback(async () => {
    if (busy) return;
    const ticket = ++epochRef.current;
    setBusy(true);
    setErrorText('');
    setNeedsConfig(false);

    let missingConfig = false;

    try {
      await client.go.captureSessionContext();
      if (!aliveRef.current || epochRef.current !== ticket) return;

      try {
        const rawPurposes: any = await client.go.fetchModelPurposes();
        if (!aliveRef.current || epochRef.current !== ticket) return;
        const rows = Array.isArray(rawPurposes)
          ? rawPurposes
          : Array.isArray(rawPurposes?.items)
            ? rawPurposes.items
            : [];
        if (rows.length > 0) {
          const missing = ['STORY_DIRECTOR', 'NPC_DIALOGUE'].some((id) => {
            const row = rows.find((item: any) => item?.purpose === id);
            return !row || row.status !== 'READY';
          });
          if (missing) {
            missingConfig = true;
            setNeedsConfig(true);
          }
        }
      } catch {
        // 用途检查异常不阻断开局尝试
      }

      if (!aliveRef.current || epochRef.current !== ticket) return;

      const conv = await ensureStoryConversation({
        client,
        bridge,
        queryClient,
      });
      if (!aliveRef.current || epochRef.current !== ticket) return;

      const rawRun: any = await client.go.startStoryRun(conv.conversationId);
      if (!aliveRef.current || epochRef.current !== ticket) return;

      const runId = decimalOf(rawRun?.runId);
      const branchId = decimalOf(rawRun?.branchId);
      const worldVersion =
        typeof rawRun?.worldVersion === 'number' && Number.isSafeInteger(rawRun.worldVersion)
          ? rawRun.worldVersion
          : 0;

      if (!runId || !branchId) {
        throw new Error('invalid story run');
      }

      const mapped: Record<string, string> = {};
      if (selectedCompanionId && CASTABLE.includes(selectedCastActor)) {
        await mapStoryParticipantWithClient(client, {
          runId,
          actorId: selectedCastActor,
          relationshipId: selectedCompanionId,
        });
        if (!aliveRef.current || epochRef.current !== ticket) return;
        mapped[selectedCastActor] = selectedCompanionId;
      }

      const rawView = await client.go.fetchStoryActorView({
        runId,
        branchId,
        worldVersion,
      });
      if (!aliveRef.current || epochRef.current !== ticket) return;

      const view = normalizeStoryView(rawView);

      const runRecord = buildStoryRunRecord(rawRun, conv.conversationId, {
        runId,
        branchId,
        worldVersion,
        mapped,
      });

      upsertStoryRunCache(queryClient, runRecord);
      queryClient.setQueryData(queryKeys.storyView(runId, 'player', branchId, worldVersion), view);

      const turn = storyTurn(
        { runId, branchId, conversationId: conv.conversationId },
        { runId, branchId, worldVersion },
        conv.conversationId,
      );
      bridge.story.setRun(
        turn ?? {
          runId,
          branchId,
          worldVersion,
          conversationId: conv.conversationId,
        },
      );

      onStarted?.({
        runId,
        branchId,
        worldVersion,
        conversationId: conv.conversationId,
        chatIdentity: conv.chatIdentity,
        run: runRecord,
        view,
      });
    } catch (err: any) {
      if (!aliveRef.current || epochRef.current !== ticket) return;
      const msg =
        err?.status === 409 && err?.code === 'ACCOUNT_CONTEXT_CHANGED'
          ? SESSION_CHANGED
          : err?.status === 409
            ? STORY_CONFLICT
            : START_FAILED;
      setErrorText(msg);
      onError?.({
        message: msg,
        ...(missingConfig ? { needsModelConfig: true } : {}),
      });
    } finally {
      if (aliveRef.current && epochRef.current === ticket) {
        setBusy(false);
      }
    }
  }, [
    busy,
    client,
    bridge,
    queryClient,
    selectedCompanionId,
    selectedCastActor,
    onStarted,
    onError,
  ]);

  return {
    step,
    setStep,
    prevStep,
    nextStep,
    selectedCompanionId,
    setSelectedCompanionId,
    selectedCastActor,
    setSelectedCastActor,
    companions,
    selectedCompanion,
    busy,
    errorText,
    needsConfig,
    handleStart,
  };
}

export interface RewindResult {
  runId: string;
  branchId: string;
  worldVersion: number;
  stage?: 'investigation' | 'resolved' | '';
  view: StoryActorView;
}

export interface UseStoryRewindOptions {
  runId: string;
  targetVersion: number | null;
  stageLabel?: string;
  chatIdentity?: string;
  conversationId?: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onBeforeConfirm?: () => void;
  onRewound?: (result: RewindResult) => void;
  onError?: (message: string) => void;
}

export function useStoryRewind({
  runId,
  targetVersion,
  stageLabel = '调查中',
  chatIdentity,
  conversationId,
  busy = false,
  onOpenChange,
  onBeforeConfirm,
  onRewound,
  onError,
}: UseStoryRewindOptions) {
  const client = useAppClient();
  const bridge = useSessionBridge();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const aliveRef = useRef<boolean>(true);
  const inFlightRef = useRef<boolean>(false);
  const epochRef = useRef<number>(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      inFlightRef.current = false;
      epochRef.current += 1;
    };
  }, []);

  const title =
    targetVersion === null
      ? ''
      : targetVersion === 0
        ? '回到调查开始？'
        : `回到版本 ${targetVersion}？`;
  const lead =
    targetVersion === null ? '' : rewindCopy({ version: targetVersion, stage: stageLabel });
  const isPending = busy || submitting;

  const handleConfirm = useCallback(async () => {
    if (isPending || inFlightRef.current || targetVersion === null) return;
    const resolvedIdentity =
      chatIdentity || String(bridge.getContext()?.chatMetadata?.vc_f2?.id || '');
    if (!CHAT_IDENTITY.test(resolvedIdentity)) {
      onError?.(REWIND_BLOCKED);
      onOpenChange(false);
      return;
    }

    const ticket = ++epochRef.current;
    inFlightRef.current = true;
    onBeforeConfirm?.();
    setSubmitting(true);
    try {
      const res: any = await rewindStoryWithClient(client, {
        runId: String(runId),
        toWorldVersion: targetVersion,
        chatIdentity: resolvedIdentity,
      });
      if (!aliveRef.current || epochRef.current !== ticket) return;

      const branchId =
        decimalOf(res?.branchId || res?.newBranchId) ||
        decimalOf(queryClient.getQueryData<StoryRunRecord>(queryKeys.storyRun(runId))?.branchId) ||
        '1';
      const worldVersion =
        typeof res?.worldVersion === 'number' && Number.isSafeInteger(res.worldVersion)
          ? res.worldVersion
          : targetVersion;

      const rawView = await client.go.fetchStoryActorView({
        runId: String(runId),
        branchId,
        worldVersion,
      });
      if (!aliveRef.current || epochRef.current !== ticket) return;

      const view = normalizeStoryView(rawView);

      const prevRun = queryClient.getQueryData<StoryRunRecord>(queryKeys.storyRun(runId));
      const resolvedConvId =
        conversationId ||
        prevRun?.conversationId ||
        String(bridge.getContext()?.chatMetadata?.vc_binding?.conversationId || '1');

      const updatedRun = buildStoryRunRecord(
        {
          runId,
          branchId,
          worldVersion,
          stage: res?.stage || 'investigation',
        },
        resolvedConvId,
        prevRun,
      );

      upsertStoryRunCache(queryClient, updatedRun);
      queryClient.setQueryData(
        queryKeys.storyView(String(runId), 'player', branchId, worldVersion),
        view,
      );

      const turn = storyTurn(
        { runId: String(runId), branchId, conversationId: resolvedConvId },
        { runId: String(runId), branchId, worldVersion },
        resolvedConvId,
      );
      bridge.story.advance(
        turn ?? {
          runId: String(runId),
          branchId,
          worldVersion,
          conversationId: resolvedConvId,
        },
      );

      onRewound?.({
        runId: String(runId),
        branchId,
        worldVersion,
        stage: updatedRun.stage,
        view,
      });
      onOpenChange(false);
    } catch (err: any) {
      if (!aliveRef.current || epochRef.current !== ticket) return;
      const msg =
        err?.status === 409 && err?.code === 'ACCOUNT_CONTEXT_CHANGED'
          ? SESSION_CHANGED
          : REWIND_FAILED;
      onError?.(msg);
      onOpenChange(false);
    } finally {
      inFlightRef.current = false;
      if (aliveRef.current && epochRef.current === ticket) {
        setSubmitting(false);
      }
    }
  }, [
    isPending,
    targetVersion,
    chatIdentity,
    bridge,
    onError,
    onOpenChange,
    onBeforeConfirm,
    client,
    runId,
    queryClient,
    conversationId,
    onRewound,
  ]);

  return {
    title,
    lead,
    submitting,
    isPending,
    handleConfirm,
  };
}

export interface UseStoryStageOptions {
  runId: string;
  branchId: string;
  worldVersion: number;
  stage?: 'investigation' | 'resolved' | '';
  initialView?: StoryActorView | Record<string, any> | null;
  conversationId?: string;
  chatIdentity?: string;
  onRunUpdated?: (run: StoryRunRecord, view: StoryActorView) => void;
}

export function useStoryStage({
  runId,
  branchId: propBranchId,
  worldVersion: propWorldVersion,
  stage: propStage = 'investigation',
  initialView = null,
  conversationId: propConversationId,
  chatIdentity: propChatIdentity,
  onRunUpdated,
}: UseStoryStageOptions) {
  const client = useAppClient();
  const bridge = useSessionBridge();
  const queryClient = useQueryClient();

  const cachedRun = useStoryRun(runId).data;
  const [branchId, setBranchId] = useState<string>(() => propBranchId || cachedRun?.branchId || '1');
  const [worldVersion, setWorldVersion] = useState<number>(
    () => propWorldVersion ?? cachedRun?.worldVersion ?? 0,
  );
  const [stageStatus, setStageStatus] = useState<'investigation' | 'resolved' | ''>(() =>
    propStage || cachedRun?.stage || 'investigation',
  );
  const [localView, setLocalView] = useState<StoryActorView | null>(() =>
    initialView ? normalizeStoryView(initialView) : null,
  );

  const viewQuery = useStoryView(runId, 'player', branchId, worldVersion);
  const view = localView ?? viewQuery.data ?? normalizeStoryView({});

  const [selectedActorId, setSelectedActorId] = useState<string>(() => cachedRun?.actorId || '');
  const [draftSay, setDraftSay] = useState<string>('');
  const [draftSummary, setDraftSummary] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [syncPending, setSyncPending] = useState<boolean>(false);
  const [reason, setReason] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [epilogueNote, setEpilogueNote] = useState<string>(() => cachedRun?.epilogue || '');
  const [companions, setCompanions] = useState<StoryCompanionRow[] | null>(null);
  const [mapped, setMapped] = useState<Record<string, string>>(() => ({
    ...(cachedRun?.mapped ?? {}),
  }));
  const [askRewindVersion, setAskRewindVersion] = useState<number | null>(null);
  const [confirmAccuseStepId, setConfirmAccuseStepId] = useState<string | null>(null);
  const [flippedNames, setFlippedNames] = useState<Set<string>>(() => new Set());
  const [freshLineIndex, setFreshLineIndex] = useState<number>(-1);

  const epochRef = useRef<number>(0);
  const statementSeqRef = useRef<number>(0);
  const pendingEventsRef = useRef<Set<string>>(new Set());
  const jobsRef = useRef<
    Set<{
      runId: string;
      conversationId: string;
      worldEventId: string;
      text: string;
      cancelled: boolean;
    }>
  >(new Set());
  const aliveRef = useRef<boolean>(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      epochRef.current += 1;
      for (const job of jobsRef.current) {
        job.cancelled = true;
      }
      jobsRef.current.clear();
      pendingEventsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (propBranchId && propBranchId !== branchId) {
      setBranchId(propBranchId);
    }
  }, [propBranchId]);

  useEffect(() => {
    if (typeof propWorldVersion === 'number' && propWorldVersion !== worldVersion) {
      setWorldVersion(propWorldVersion);
    }
  }, [propWorldVersion]);

  useEffect(() => {
    if (viewQuery.data && !localView) {
      setLocalView(viewQuery.data);
    }
  }, [viewQuery.data, localView]);

  const cancelInFlightOperations = useCallback(() => {
    epochRef.current += 1;
    for (const job of jobsRef.current) {
      job.cancelled = true;
    }
    jobsRef.current.clear();
    pendingEventsRef.current.clear();
    setBusy(false);
    setSyncPending(false);
  }, []);

  const resolvedConversationId =
    propConversationId ||
    cachedRun?.conversationId ||
    String(bridge.getContext()?.chatMetadata?.vc_binding?.conversationId || '1');

  const resolvedChatIdentity =
    propChatIdentity || String(bridge.getContext()?.chatMetadata?.vc_f2?.id || '');

  const ended = stageStatus === 'resolved';
  const epilogueDirty = isEpilogueDirty(ended, draftSummary, epilogueNote);

  const mode = useMemo(() => {
    if (busy && !ended) return 'generating';
    if (ended) return 'ended';
    if (reason === ACTION_CONFLICT) return 'conflict';
    if (reason) return 'rejected';
    if (notice) return 'evidence';
    return 'playing';
  }, [busy, ended, reason, notice]);

  const people = useMemo(() => {
    const rawList = view.participants.length
      ? view.participants
      : [
          { actorId: 'lin', name: '林岚', persona: '' },
          { actorId: 'zhou', name: '周澈', persona: '' },
          { actorId: 'su', name: '苏禾', persona: '' },
        ];
    return rawList.map((person) => ({
      id: person.actorId,
      name: person.name,
      initial: initial(person.name),
      persona: person.persona || '',
      selected: person.actorId === selectedActorId,
    }));
  }, [view.participants, selectedActorId]);

  const selectedPerson = people.find((p) => p.selected);

  const versions = useMemo(
    () => rewindTargets({ turn: { worldVersion }, view }),
    [worldVersion, view],
  );

  const freshClue = useMemo(() => freshClueName({ notice }), [notice]);

  const handleRevealClue = useCallback((name: string) => {
    setFlippedNames((prev) => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  }, []);

  const handleSelectActor = useCallback(
    (actorId: string) => {
      if (!CASTABLE.includes(actorId)) return;
      setSelectedActorId(actorId);
      bridge.story.selectActor(actorId);
    },
    [bridge],
  );

  const projectEvent = useCallback(
    async (
      worldEventId: string,
      text: string,
      ticket: number,
    ): Promise<{ confirmed: boolean; appended: boolean; skipped?: string }> => {
      const eid = decimalOf(worldEventId);
      if (!eid) return { confirmed: false, appended: false };
      pendingEventsRef.current.add(eid);
      setSyncPending(true);
      const job = {
        runId: String(runId),
        conversationId: resolvedConversationId,
        worldEventId: eid,
        text,
        cancelled: false,
      };
      jobsRef.current.add(job);
      try {
        const done: any = await bridge.projectStory(job);
        if (aliveRef.current && epochRef.current === ticket && !job.cancelled) {
          if (done?.confirmed || done?.skipped === 'deleted') {
            pendingEventsRef.current.delete(eid);
          }
          setSyncPending(pendingEventsRef.current.size > 0);
        }
        return done || { confirmed: false, appended: false };
      } catch {
        // 世界已经生效。补写失败时留下待同步，不把错误冒泡。
        if (aliveRef.current && epochRef.current === ticket && !job.cancelled) {
          setSyncPending(pendingEventsRef.current.size > 0);
        }
        return { confirmed: false, appended: false };
      } finally {
        jobsRef.current.delete(job);
      }
    },
    [runId, resolvedConversationId, bridge],
  );

  const syncPendingProjections = useCallback(
    async (ticket: number) => {
      const cleanRunId = decimalOf(runId);
      if (!cleanRunId) return;
      let body: any;
      try {
        body = await client.go.storyRequest(
          'GET',
          `/api/v1/story/runs/${cleanRunId}/projections?state=PENDING`,
        );
      } catch {
        return;
      }
      if (!aliveRef.current || epochRef.current !== ticket) return;
      const rows = Array.isArray(body?.projections) ? body.projections : [];
      const validItems: Array<{ worldEventId: string; text: string }> = [];
      for (const item of rows) {
        const worldEventId = decimalOf(item?.worldEventId);
        const text = shown(item?.text);
        if (!worldEventId || !text) continue;
        validItems.push({ worldEventId, text });
        pendingEventsRef.current.add(worldEventId);
      }
      if (validItems.length > 0) {
        setSyncPending(true);
      }
      for (const item of validItems) {
        if (!aliveRef.current || epochRef.current !== ticket) return;
        await projectEvent(item.worldEventId, item.text, ticket);
      }
      if (aliveRef.current && epochRef.current === ticket) {
        setSyncPending(pendingEventsRef.current.size > 0);
      }
    },
    [runId, client.go, projectEvent],
  );

  useEffect(() => {
    pendingEventsRef.current.clear();
    const ticket = epochRef.current;
    void syncPendingProjections(ticket);
  }, [runId, resolvedConversationId, syncPendingProjections]);

  const reloadHead = useCallback(
    async (ticket: number) => {
      const run: any = await client.go.startStoryRun(resolvedConversationId);
      if (!aliveRef.current || epochRef.current !== ticket) return;
      const allowed = allowRun(run);
      const nextRunId = decimalOf(run?.runId) || String(runId);
      const nextBranchId = decimalOf(run?.branchId) || branchId;
      const nextVersion =
        typeof run?.worldVersion === 'number' && Number.isSafeInteger(run.worldVersion)
          ? run.worldVersion
          : worldVersion;
      const nextStage: 'investigation' | 'resolved' | '' = allowed.stage || stageStatus;

      const rawView = await client.go.fetchStoryActorView({
        runId: nextRunId,
        branchId: nextBranchId,
        worldVersion: nextVersion,
      });
      if (!aliveRef.current || epochRef.current !== ticket) return;

      const nextView = normalizeStoryView(rawView);
      const turn = storyTurn(
        { runId: nextRunId, branchId: nextBranchId, conversationId: resolvedConversationId },
        rawView,
        resolvedConversationId,
      );
      if (turn) {
        bridge.story.advance(turn);
      }

      setBranchId(nextBranchId);
      setWorldVersion(nextVersion);
      if (nextStage) setStageStatus(nextStage);
      setLocalView(nextView);
      setNotice('');

      const updatedRun = buildStoryRunRecord(run, resolvedConversationId, {
        ...cachedRun,
        runId: nextRunId,
        branchId: nextBranchId,
        worldVersion: nextVersion,
        stage: nextStage || 'investigation',
        actorId: selectedActorId,
        mapped,
        epilogue: epilogueNote,
      });
      upsertStoryRunCache(queryClient, updatedRun);
      queryClient.setQueryData(
        queryKeys.storyView(nextRunId, 'player', nextBranchId, nextVersion),
        nextView,
      );
      onRunUpdated?.(updatedRun, nextView);
      await syncPendingProjections(ticket);
    },
    [
      client.go,
      resolvedConversationId,
      runId,
      branchId,
      worldVersion,
      stageStatus,
      bridge.story,
      cachedRun,
      selectedActorId,
      mapped,
      epilogueNote,
      queryClient,
      onRunUpdated,
      syncPendingProjections,
    ],
  );

  const executeCommand = useCallback(
    async (command: {
      actionId: string;
      actorId: string;
      action?: string;
      target: string;
      clueId?: string;
      text?: string;
    }) => {
      if (busy || ended) return;
      const ticket = ++epochRef.current;

      setBusy(true);
      setReason('');
      setNotice('');

      try {
        const result: any = await commitStoryActionWithClient(client, {
          runId: String(runId),
          branchId: String(branchId),
          expectedWorldVersion: worldVersion,
          ...command,
        });

        if (!aliveRef.current || epochRef.current !== ticket) {
          return;
        }

        if (!result?.accepted) {
          setReason(
            (REASONS as Record<string, string>)[result?.reason] ||
              '这步行动没有生效，世界没有变化。',
          );
          setSyncPending(pendingEventsRef.current.size > 0);
          const refreshedRaw = await client.go.fetchStoryActorView({
            runId: String(runId),
            branchId: String(branchId),
            worldVersion,
          });
          if (!aliveRef.current || epochRef.current !== ticket) return;
          setLocalView(normalizeStoryView(refreshedRaw));
          const turn = storyTurn(
            {
              runId: String(runId),
              branchId: String(branchId),
              conversationId: resolvedConversationId,
            },
            refreshedRaw,
            resolvedConversationId,
          );
          if (turn) bridge.story.advance(turn);
          return;
        }

        if (result.replayed) {
          await reloadHead(ticket);
          return;
        }

        const nextBranchId = decimalOf(result.branchId) || branchId;
        const nextVersion = result.worldVersion;
        const nextStage: 'investigation' | 'resolved' =
          result.ended || result.stage === 'resolved' ? 'resolved' : 'investigation';

        bridge.story.advance({
          runId: String(runId),
          branchId: nextBranchId,
          worldVersion: nextVersion,
          conversationId: resolvedConversationId,
        });

        const rawView = await client.go.fetchStoryActorView({
          runId: String(runId),
          branchId: nextBranchId,
          worldVersion: nextVersion,
        });

        if (!aliveRef.current || epochRef.current !== ticket) {
          return;
        }

        const nextView = normalizeStoryView(rawView);
        const turn = storyTurn(
          { runId: String(runId), branchId: nextBranchId, conversationId: resolvedConversationId },
          rawView,
          resolvedConversationId,
        );
        if (turn) {
          bridge.story.advance(turn);
        }

        const event = nextView.events.find(
          (item) => item.worldEventId && item.worldEventId === String(result.worldEventId),
        );
        const nextNotice = event?.clueName ? `发现证据：${event.clueName}` : '';
        const newEventId = decimalOf(result.worldEventId);
        if (newEventId) {
          pendingEventsRef.current.add(newEventId);
        }

        setBranchId(nextBranchId);
        setWorldVersion(nextVersion);
        setStageStatus(nextStage);
        setLocalView(nextView);
        setNotice(nextNotice);
        setFreshLineIndex(nextView.events.length - 1);
        setSyncPending(pendingEventsRef.current.size > 0);

        const updatedRun = buildStoryRunRecord(
          {
            runId,
            branchId: nextBranchId,
            worldVersion: nextVersion,
            stage: nextStage,
          },
          resolvedConversationId,
          {
            ...cachedRun,
            actorId: selectedActorId,
            mapped,
            epilogue: epilogueNote,
          },
        );
        upsertStoryRunCache(queryClient, updatedRun);
        queryClient.setQueryData(
          queryKeys.storyView(String(runId), 'player', nextBranchId, nextVersion),
          nextView,
        );
        onRunUpdated?.(updatedRun, nextView);

        await projectEvent(
          String(result.worldEventId || ''),
          event?.line || nextNotice || '这一步行动已记录',
          ticket,
        );
      } catch (err: any) {
        if (!aliveRef.current || epochRef.current !== ticket) {
          return;
        }
        if (err?.status === 409 && err?.code !== 'ACCOUNT_CONTEXT_CHANGED') {
          setReason(ACTION_CONFLICT);
          try {
            await reloadHead(ticket);
          } catch {
            /* 保持当前头 */
          }
        } else if (err?.status === 409) {
          setReason(SESSION_CHANGED);
        } else {
          setReason(ACTION_FAILED);
        }
      } finally {
        if (aliveRef.current && epochRef.current === ticket) {
          setBusy(false);
        }
      }
    },
    [
      busy,
      ended,
      client,
      runId,
      branchId,
      worldVersion,
      resolvedConversationId,
      bridge.story,
      reloadHead,
      cachedRun,
      selectedActorId,
      mapped,
      epilogueNote,
      queryClient,
      onRunUpdated,
      projectEvent,
    ],
  );

  const handleCommitStep = useCallback(
    (stepId: string) => {
      if (busy || ended) return;
      const step = STEPS.find((item) => item.id === stepId);
      if (!step) return;
      if (step.action === 'accuse') {
        setConfirmAccuseStepId(step.id);
        return;
      }
      void executeCommand({
        actionId: step.id,
        actorId: 'player',
        action: step.action,
        target: step.target,
        clueId: step.clueId,
      });
    },
    [busy, ended, executeCommand],
  );

  const handleConfirmAccuse = useCallback(() => {
    const stepId = confirmAccuseStepId;
    setConfirmAccuseStepId(null);
    if (!stepId) return;
    const step = STEPS.find((item) => item.id === stepId);
    if (!step) return;
    void executeCommand({
      actionId: step.id,
      actorId: 'player',
      action: step.action,
      target: step.target,
      clueId: step.clueId,
    });
  }, [confirmAccuseStepId, executeCommand]);

  const handleCommitSay = useCallback(
    (rawText: string) => {
      const spoken = rawText.trim();
      if (busy || ended || !spoken) return;
      if (!CASTABLE.includes(selectedActorId)) {
        setReason('先选择要对谁说。');
        return;
      }
      setDraftSay('');
      statementSeqRef.current += 1;
      void executeCommand({
        actionId: `s${statementSeqRef.current}`,
        actorId: 'player',
        target: selectedActorId,
        text: spoken,
      });
    },
    [busy, ended, selectedActorId, executeCommand],
  );

  const handleShowCompanions = useCallback(async () => {
    try {
      const list: any = await client.go.fetchRelationships();
      if (!aliveRef.current) return;
      const raw = Array.isArray(list) ? list : Array.isArray(list?.items) ? list.items : [];
      const rows: StoryCompanionRow[] = [];
      for (const item of raw) {
        if (item?.mode === 'STORY' || item?.displayName === '雨夜旅馆') continue;
        const relationshipId = decimalOf(item?.relationshipId);
        const name =
          shown(item?.companionName) ||
          shown(item?.displayName) ||
          shown(item?.name) ||
          shown(item?.personaRef);
        if (!relationshipId || !name) continue;
        rows.push({ relationshipId, name });
      }
      setCompanions(rows);
    } catch {
      if (!aliveRef.current) return;
      setCompanions([]);
    }
  }, [client.go]);

  const handleMapCompanion = useCallback(
    async (actorId: string, relationshipId: string) => {
      if (busy) return;
      const relId = decimalOf(relationshipId);
      if (!CASTABLE.includes(actorId) || !relId) return;
      const ticket = epochRef.current;
      setBusy(true);
      setReason('');
      try {
        await mapStoryParticipantWithClient(client, {
          runId: String(runId),
          actorId,
          relationshipId: relId,
        });
        if (!aliveRef.current || epochRef.current !== ticket) return;
        setMapped((prev) => ({ ...prev, [actorId]: relId }));
      } catch (err: any) {
        if (!aliveRef.current || epochRef.current !== ticket) return;
        if (err?.status === 409 && err?.code === 'ACCOUNT_CONTEXT_CHANGED') {
          setReason(SESSION_CHANGED);
        } else if (err?.status === 409) {
          setReason(ACTION_CONFLICT);
        } else {
          setReason(ACTION_FAILED);
        }
      } finally {
        if (aliveRef.current && epochRef.current === ticket) {
          setBusy(false);
        }
      }
    },
    [busy, client, runId],
  );

  const handleSaveEpilogue = useCallback(
    async (summaryText: string) => {
      if (busy || !ended) return;
      const mappedActor =
        CASTABLE.find((id) => mapped[id]) ||
        view.participants.find((p) => p.relationshipId && CASTABLE.includes(p.actorId))?.actorId;
      const relationshipId =
        (mappedActor && mapped[mappedActor]) ||
        view.participants.find((p) => p.relationshipId)?.relationshipId ||
        '';
      const trimmed = summaryText.trim();
      if (!DECIMAL_ID.test(relationshipId) || !trimmed) {
        setEpilogueNote(NEED_CAST);
        return;
      }
      const ticket = epochRef.current;
      await decideStoryEpilogueWithClient(client, {
        runId: String(runId),
        decision: 'save',
        relationshipId,
        summary: trimmed,
      });
      if (!aliveRef.current || epochRef.current !== ticket) return;
      setEpilogueNote(SAVE_HINT);
    },
    [busy, ended, mapped, view.participants, client, runId],
  );

  const handleDiscardEpilogue = useCallback(async () => {
    if (busy || !ended) return;
    const ticket = epochRef.current;
    await decideStoryEpilogueWithClient(client, {
      runId: String(runId),
      decision: 'discard',
    });
    if (!aliveRef.current || epochRef.current !== ticket) return;
    setEpilogueNote(DISCARD_HINT);
  }, [busy, ended, client, runId]);

  const handleRewound = useCallback(
    (res: RewindResult) => {
      pendingEventsRef.current.clear();
      setBranchId(res.branchId);
      setWorldVersion(res.worldVersion);
      setStageStatus((res.stage as any) || 'investigation');
      setLocalView(res.view);
      setReason('');
      setNotice('');
      setSyncPending(false);
      setEpilogueNote('');
      const updatedRun = buildStoryRunRecord(
        {
          runId: res.runId,
          branchId: res.branchId,
          worldVersion: res.worldVersion,
          stage: res.stage || 'investigation',
        },
        resolvedConversationId,
        cachedRun,
      );
      onRunUpdated?.(updatedRun, res.view);
    },
    [resolvedConversationId, cachedRun, onRunUpdated],
  );

  const stageLabel = stageWord(ended ? 'resolved' : stageStatus);
  const accuseTargetName =
    people.find((p) => p.id === STEPS.find((s) => s.id === confirmAccuseStepId)?.target)?.name ||
    '周澈';

  return {
    branchId,
    worldVersion,
    stageStatus,
    view,
    selectedActorId,
    draftSay,
    setDraftSay,
    draftSummary,
    setDraftSummary,
    busy,
    syncPending,
    reason,
    setReason,
    notice,
    epilogueNote,
    epilogueDirty,
    companions,
    mapped,
    askRewindVersion,
    setAskRewindVersion,
    confirmAccuseStepId,
    setConfirmAccuseStepId,
    flippedNames,
    freshLineIndex,
    resolvedConversationId,
    resolvedChatIdentity,
    ended,
    mode,
    people,
    selectedPerson,
    versions,
    freshClue,
    stageLabel,
    accuseTargetName,
    cancelInFlightOperations,
    handleRevealClue,
    handleSelectActor,
    handleCommitStep,
    handleConfirmAccuse,
    handleCommitSay,
    handleShowCompanions,
    handleMapCompanion,
    handleSaveEpilogue,
    handleDiscardEpilogue,
    handleRewound,
  };
}

export interface UseStoryRouteOptions {
  runId?: string;
  onOpenRun: (runId: string) => void;
}

export function useStoryRoute({ runId: routeRunId, onOpenRun }: UseStoryRouteOptions) {
  const client = useAppClient();
  const bridge = useSessionBridge();
  const chatSnapshot = useChatSnapshot();
  const queryClient = useQueryClient();

  const runsQuery = useStoryRuns();
  const routeRunQuery = useStoryRun(routeRunId);
  const purposesQuery = useStoryModelPurposes(true);

  const aliveRef = useRef<boolean>(true);
  const epochRef = useRef<number>(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      epochRef.current += 1;
    };
  }, []);

  const currentStoryConvId = useMemo(() => {
    const ctxBinding = bridge.getContext()?.chatMetadata?.vc_binding;
    if (ctxBinding?.mode === 'STORY' && decimalOf(ctxBinding.conversationId)) {
      return String(ctxBinding.conversationId);
    }
    if (chatSnapshot.mode === 'STORY' && decimalOf(chatSnapshot.conversationId)) {
      return String(chatSnapshot.conversationId);
    }
    return '';
  }, [bridge, chatSnapshot.mode, chatSnapshot.conversationId]);

  const activeRun = useMemo<StoryRunRecord | null>(() => {
    if (routeRunId && routeRunQuery.data) {
      return routeRunQuery.data;
    }
    const runs = runsQuery.data ?? [];
    if (routeRunId) {
      const match = runs.find((r) => String(r.runId) === String(routeRunId));
      if (match) return match;
    }
    if (currentStoryConvId) {
      const match = runs.find((r) => String(r.conversationId) === currentStoryConvId);
      if (match) return match;
    }
    return runs[0] ?? null;
  }, [routeRunId, routeRunQuery.data, runsQuery.data, currentStoryConvId]);

  const activeViewQuery = useStoryView(
    activeRun?.runId,
    'player',
    activeRun?.branchId,
    activeRun?.worldVersion,
  );

  const [viewMode, setViewMode] = useState<'gate' | 'stage'>(() =>
    routeRunId && activeRun ? 'stage' : 'gate',
  );
  const [busy, setBusy] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>('');
  const [localView, setLocalView] = useState<StoryActorView | null>(null);

  const activeView = localView ?? activeViewQuery.data ?? null;

  const configNote = useMemo(() => {
    if (purposesQuery.data && !purposesQuery.data.ready) {
      return CONFIG_MISSING;
    }
    return '';
  }, [purposesQuery.data]);

  useEffect(() => {
    if (routeRunId && activeRun) {
      setViewMode('stage');
    }
  }, [routeRunId, activeRun]);

  const handleStartOrEnter = useCallback(async () => {
    if (busy) return;
    if (
      activeRun &&
      activeView &&
      (!currentStoryConvId || activeRun.conversationId === currentStoryConvId)
    ) {
      epochRef.current += 1;
      setViewMode('stage');
      onOpenRun(activeRun.runId);
      return;
    }

    const ticket = ++epochRef.current;
    setBusy(true);
    setErrorText('');
    try {
      await client.go.captureSessionContext();
      if (!aliveRef.current || epochRef.current !== ticket) return;
      void purposesQuery.refetch();

      const conv = await ensureStoryConversation({
        client,
        bridge,
        queryClient,
      });
      if (!aliveRef.current || epochRef.current !== ticket) return;

      const rawRun: any = await client.go.startStoryRun(conv.conversationId);
      if (!aliveRef.current || epochRef.current !== ticket) return;

      const runId = decimalOf(rawRun?.runId);
      const branchId = decimalOf(rawRun?.branchId);
      const worldVersion =
        typeof rawRun?.worldVersion === 'number' && Number.isSafeInteger(rawRun.worldVersion)
          ? rawRun.worldVersion
          : 0;

      if (!runId || !branchId) {
        throw new Error('invalid story run');
      }

      const rawView = await client.go.fetchStoryActorView({
        runId,
        branchId,
        worldVersion,
      });
      if (!aliveRef.current || epochRef.current !== ticket) return;

      const view = normalizeStoryView(rawView);

      const runRecord = buildStoryRunRecord(rawRun, conv.conversationId, {
        runId,
        branchId,
        worldVersion,
        title: CASE_TITLE,
      });

      upsertStoryRunCache(queryClient, runRecord);
      queryClient.setQueryData(queryKeys.storyView(runId, 'player', branchId, worldVersion), view);

      const turn = storyTurn(
        { runId, branchId, conversationId: conv.conversationId },
        { runId, branchId, worldVersion },
        conv.conversationId,
      );
      bridge.story.setRun(
        turn ?? {
          runId,
          branchId,
          worldVersion,
          conversationId: conv.conversationId,
        },
      );

      setLocalView(view);
      setViewMode('stage');
      onOpenRun(runId);
    } catch (err: any) {
      if (!aliveRef.current || epochRef.current !== ticket) return;
      const msg =
        err?.status === 409 && err?.code === 'ACCOUNT_CONTEXT_CHANGED'
          ? SESSION_CHANGED
          : err?.status === 409
            ? STORY_CONFLICT
            : START_FAILED;
      setErrorText(msg);
    } finally {
      if (aliveRef.current && epochRef.current === ticket) {
        setBusy(false);
      }
    }
  }, [
    busy,
    activeRun,
    activeView,
    currentStoryConvId,
    onOpenRun,
    client,
    purposesQuery,
    bridge,
    queryClient,
  ]);

  const handleWizardStarted = useCallback(
    (result: StartWizardSuccess) => {
      epochRef.current += 1;
      setBusy(false);
      setErrorText('');
      setLocalView(result.view);
      setViewMode('stage');
      onOpenRun(result.runId);
    },
    [onOpenRun],
  );

  const handleCloseStage = useCallback(() => {
    epochRef.current += 1;
    setBusy(false);
    setViewMode('gate');
  }, []);

  const handleRunUpdated = useCallback(
    (updatedRun: StoryRunRecord, updatedView: StoryActorView) => {
      setLocalView(updatedView);
      onOpenRun(updatedRun.runId);
    },
    [onOpenRun],
  );

  const isStage = Boolean(viewMode === 'stage' && activeRun);

  return {
    activeRun,
    activeView,
    viewMode,
    isStage,
    busy,
    errorText,
    configNote,
    handleStartOrEnter,
    handleWizardStarted,
    handleCloseStage,
    handleRunUpdated,
  };
}
