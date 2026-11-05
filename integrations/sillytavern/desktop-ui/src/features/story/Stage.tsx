import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ACTION_CONFLICT,
  ACTION_FAILED,
  CASE_TITLE,
  CASTABLE,
  DECIMAL_ID,
  DISCARD_HINT,
  NEED_CAST,
  REASONS,
  SAVE_HINT,
  SESSION_CHANGED,
  STEPS,
  STORY_SYNC_PENDING,
  allowRun,
  decimalOf,
  freshClueName,
  initial,
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
  mapStoryParticipantWithClient,
  normalizeStoryView,
  upsertStoryRunCache,
  useStoryRun,
  useStoryView,
  type StoryActorView,
  type StoryCompanionRow,
  type StoryRunRecord,
} from '../../data/queries/story';
import { Button } from '../../design/components/Button';
import { Dialog } from '../../design/components/Dialog';
import { Icon } from '../../design/components/Icon';
import {
  PortalHostProvider,
  usePortalContainer,
  useToastPortalContainer,
} from '../../design/portal-host';
import { useSessionBridge } from '../../runtime/session-bridge';
import { ActionBar } from './ActionBar';
import { ClueWall } from './ClueWall';
import { EpilogueMemories } from './EpilogueMemories';
import { NpcCast } from './NpcCast';
import { RewindDialog, type RewindResult } from './RewindDialog';

export interface StageProps {
  runId: string;
  branchId: string;
  worldVersion: number;
  stage?: 'investigation' | 'resolved' | '';
  initialView?: StoryActorView | Record<string, any> | null;
  conversationId?: string;
  chatIdentity?: string;
  configNote?: string;
  onClose?: () => void;
  onConfigure?: () => void;
  onRunUpdated?: (run: StoryRunRecord, view: StoryActorView) => void;
}

export function Stage({
  runId,
  branchId: propBranchId,
  worldVersion: propWorldVersion,
  stage: propStage = 'investigation',
  initialView = null,
  conversationId: propConversationId,
  chatIdentity: propChatIdentity,
  configNote = '',
  onClose,
  onConfigure,
  onRunUpdated,
}: StageProps) {
  const client = useAppClient();
  const bridge = useSessionBridge();
  const queryClient = useQueryClient();
  const portalContainer = usePortalContainer();
  const toastContainer = useToastPortalContainer();
  const [stageHostEl, setStageHostEl] = useState<HTMLDivElement | null>(null);

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
            { runId: String(runId), branchId: String(branchId), conversationId: resolvedConversationId },
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
      setCompanions([]);
    }
  }, [client.go]);

  const handleMapCompanion = useCallback(
    async (actorId: string, relationshipId: string) => {
      const relId = decimalOf(relationshipId);
      if (!CASTABLE.includes(actorId) || !relId) return;
      await mapStoryParticipantWithClient(client, {
        runId: String(runId),
        actorId,
        relationshipId: relId,
      });
      setMapped((prev) => ({ ...prev, [actorId]: relId }));
    },
    [client, runId],
  );

  const handleSaveEpilogue = useCallback(
    async (summaryText: string) => {
      if (!ended) return;
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
      await decideStoryEpilogueWithClient(client, {
        runId: String(runId),
        decision: 'save',
        relationshipId,
        summary: trimmed,
      });
      setEpilogueNote(SAVE_HINT);
    },
    [ended, mapped, view.participants, client, runId],
  );

  const handleDiscardEpilogue = useCallback(async () => {
    if (!ended) return;
    await decideStoryEpilogueWithClient(client, {
      runId: String(runId),
      decision: 'discard',
    });
    setEpilogueNote(DISCARD_HINT);
  }, [ended, client, runId]);

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
    people.find(
      (p) => p.id === STEPS.find((s) => s.id === confirmAccuseStepId)?.target,
    )?.name || '周澈';

  return (
    <div ref={setStageHostEl} className="vc-story-stage-host">
      <PortalHostProvider
        container={stageHostEl ?? portalContainer}
        toastContainer={toastContainer}
      >
        <header className="vc-navbar" style={{ '--vc-nav-p': 1 } as CSSProperties}>
          <button
            type="button"
            className="vc-circle vc-glass"
            data-action="close"
            aria-label="离开剧情"
            onClick={onClose}
          >
            <Icon name="x" size={22} />
          </button>
          <h1 className="vc-nav-title" tabIndex={-1}>
            雨夜旅馆
            {stageLabel ? <span className="vc-meta">{stageLabel}</span> : null}
          </h1>
          <div className="vc-nav-spacer" />
          <button
            type="button"
            className="vc-circle vc-glass"
            data-action={versions.length ? 'ask-rewind' : undefined}
            data-version={versions[0]}
            aria-label="回档"
            disabled={!versions.length}
            onClick={() => {
              if (versions.length > 0) {
                setAskRewindVersion(versions[0]);
              }
            }}
          >
            <Icon name="history" size={22} />
          </button>
        </header>

        <div className="vc-scroll">
          <div
            className="vc-story"
            data-state={mode}
            data-world-version={worldVersion}
          >
            <p className="vc-sr">{CASE_TITLE}</p>

            {configNote ? (
              <div className="vc-story-config vc-note vc-glass" data-config="missing" role="status">
                <p>{configNote}</p>
                <Button
                  variant="gray"
                  data-action="configure"
                  onClick={onConfigure}
                >
                  打开模型设置
                </Button>
              </div>
            ) : null}

            <div className="vc-story-notes">
              {mode === 'generating' ? (
                <p className="vc-note vc-glass vc-story-generating" role="status">
                  <span className="vc-thinking" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  正在生成这一步
                </p>
              ) : null}
              {syncPending ? (
                <p className="vc-note vc-glass vc-story-sync" role="status">
                  {STORY_SYNC_PENDING}
                </p>
              ) : null}
              {reason ? (
                <p className="vc-note vc-glass" role="alert">
                  {reason}
                </p>
              ) : null}
            </div>

            <NpcCast
              people={people}
              selectedActorId={selectedActorId}
              companions={companions}
              mapped={mapped}
              disabled={busy}
              onSelectActor={handleSelectActor}
              onShowCompanions={() => void handleShowCompanions()}
              onMapCompanion={(actor, rel) => void handleMapCompanion(actor, rel)}
            />

            <div className="vc-narr">
              <section aria-label="公开设定">
                {view.setting ? <p className="vc-dim vc-story-setting">{view.setting}</p> : null}
                {view.knownEvent ? <p className="vc-story-known">{view.knownEvent}</p> : null}
              </section>
              <section aria-label="地点">
                <ul className="vc-story-places">
                  {view.locations.map((loc, idx) => (
                    <li key={idx}>{loc}</li>
                  ))}
                </ul>
              </section>
              <section aria-label="公开时间线">
                <ul className="vc-story-events">
                  {view.events.map((ev, index) => {
                    const isSay = /[“"「]/.test(ev.line);
                    const isFresh = index === freshLineIndex;
                    return (
                      <li
                        key={ev.worldEventId || String(index)}
                        className={`${isSay ? 'vc-say' : ''}${isFresh ? ' vc-stream' : ''}`}
                      >
                        {ev.line}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>

            <ClueWall
              view={view}
              freshClueName={freshClue}
              flippedNames={flippedNames}
              onReveal={handleRevealClue}
            />

            <EpilogueMemories
              ended={ended}
              summaryDraft={draftSummary}
              epilogueMessage={epilogueNote}
              busy={busy}
              onSummaryChange={setDraftSummary}
              onSaveEpilogue={(summary) => void handleSaveEpilogue(summary)}
              onDiscardEpilogue={() => void handleDiscardEpilogue()}
            />

            {versions.length > 0 ? (
              <section className="vc-group" aria-label="回档">
                {versions.map((ver) => (
                  <button
                    key={ver}
                    type="button"
                    className="vc-cell"
                    data-action="ask-rewind"
                    data-version={ver}
                    onClick={() => setAskRewindVersion(ver)}
                  >
                    回到版本 {ver}
                  </button>
                ))}
              </section>
            ) : null}
          </div>
        </div>

        <ActionBar
          selectedActorId={selectedActorId}
          selectedActorName={selectedPerson?.name || ''}
          draftSay={draftSay}
          busy={busy}
          generating={mode === 'generating'}
          ended={ended}
          onDraftSayChange={setDraftSay}
          onCommitStep={handleCommitStep}
          onCommitSay={handleCommitSay}
        />

        <RewindDialog
          open={askRewindVersion !== null}
          runId={String(runId)}
          targetVersion={askRewindVersion}
          stageLabel={stageLabel || '调查中'}
          chatIdentity={resolvedChatIdentity}
          conversationId={resolvedConversationId}
          onOpenChange={(open) => {
            if (!open) setAskRewindVersion(null);
          }}
          onBeforeConfirm={cancelInFlightOperations}
          onRewound={handleRewound}
          onError={(msg) => setReason(msg)}
        />

        {confirmAccuseStepId ? (
          <Dialog
            open={true}
            onOpenChange={(open) => {
              if (!open) setConfirmAccuseStepId(null);
            }}
            title={`指认${accuseTargetName}？`}
            description="指认之后不能撤回。"
            width={420}
            showCloseButton={false}
            className="vc-alert"
            actions={
              <div className="vc-story-rewind-actions">
                <Button
                  variant="gray"
                  data-vc-cancel=""
                  onClick={() => setConfirmAccuseStepId(null)}
                >
                  取消
                </Button>
                <button
                  type="button"
                  className="vc-btn vc-btn--danger vc-btn-danger vc-alert__btn--danger"
                  data-vc-ok=""
                  data-action="confirm-accuse"
                  onClick={handleConfirmAccuse}
                >
                  指认
                </button>
              </div>
            }
          >
            <p>指认之后不能撤回。</p>
          </Dialog>
        ) : null}
      </PortalHostProvider>
    </div>
  );
}
