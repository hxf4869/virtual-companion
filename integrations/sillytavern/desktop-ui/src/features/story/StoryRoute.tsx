import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import {
  CASE_TITLE,
  CONFIG_MISSING,
  SESSION_CHANGED,
  STAGE_MOTION,
  START_FAILED,
  STORY_CONFLICT,
  decimalOf,
  storyTurn,
} from '../../../../extension/vc-model-settings/story-logic.js';
import { useAppClient } from '../../app/providers';
import { queryKeys } from '../../data/queryKeys';
import {
  buildStoryRunRecord,
  ensureStoryConversation,
  normalizeStoryView,
  upsertStoryRunCache,
  useStoryModelPurposes,
  useStoryRun,
  useStoryRuns,
  useStoryView,
  type StoryActorView,
  type StoryRunRecord,
} from '../../data/queries/story';
import {
  PortalHostProvider,
  useToastPortalContainer,
} from '../../design/portal-host';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';
import { Stage } from './Stage';
import { type StartWizardSuccess } from './StartWizard';
import { StoryList } from './StoryList';
import './story.css';

export interface StoryRouteProps {
  runId?: string;
  onConfigure?: () => void;
}

export function StoryRoute({ runId: routeRunId, onConfigure }: StoryRouteProps) {
  const client = useAppClient();
  const bridge = useSessionBridge();
  const chatSnapshot = useChatSnapshot();
  const queryClient = useQueryClient();
  const toastContainer = useToastPortalContainer();
  const storyTabRef = useRef<HTMLDivElement | null>(null);

  let router: any = null;
  try {
    router = useRouter({ warn: false } as any);
  } catch {
    router = null;
  }

  const runsQuery = useStoryRuns();
  const routeRunQuery = useStoryRun(routeRunId);
  const purposesQuery = useStoryModelPurposes(true);

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

  useEffect(() => {
    const tabEl = storyTabRef.current;
    const shell = tabEl?.closest?.('#vc-shell') as HTMLElement | null;
    if (!shell) return undefined;
    if (viewMode === 'stage') {
      shell.dataset.cover = 'story';
    } else if (shell.dataset.cover === 'story') {
      delete shell.dataset.cover;
    }
    return () => {
      if (shell.dataset.cover === 'story') {
        delete shell.dataset.cover;
      }
    };
  }, [viewMode]);

  const navigateToRun = useCallback(
    (targetRunId: string) => {
      if (router && typeof router.navigate === 'function') {
        try {
          void router.navigate({ to: `/story/${targetRunId}` });
        } catch {
          // ignore if route not registered in custom test router
        }
      }
    },
    [router],
  );

  const handleStartOrEnter = useCallback(async () => {
    if (busy) return;
    if (
      activeRun &&
      activeView &&
      (!currentStoryConvId || activeRun.conversationId === currentStoryConvId)
    ) {
      setViewMode('stage');
      navigateToRun(activeRun.runId);
      return;
    }

    setBusy(true);
    setErrorText('');
    try {
      await client.go.captureSessionContext();
      void purposesQuery.refetch();

      const conv = await ensureStoryConversation({
        client,
        bridge,
        queryClient,
      });

      const rawRun: any = await client.go.startStoryRun(conv.conversationId);
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
      navigateToRun(runId);
    } catch (err: any) {
      const msg =
        err?.status === 409 && err?.code === 'ACCOUNT_CONTEXT_CHANGED'
          ? SESSION_CHANGED
          : err?.status === 409
            ? STORY_CONFLICT
            : START_FAILED;
      setErrorText(msg);
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    activeRun,
    activeView,
    currentStoryConvId,
    navigateToRun,
    client,
    purposesQuery,
    bridge,
    queryClient,
  ]);

  const handleWizardStarted = useCallback(
    (result: StartWizardSuccess) => {
      setLocalView(result.view);
      setViewMode('stage');
      navigateToRun(result.runId);
    },
    [navigateToRun],
  );

  const handleCloseStage = useCallback(() => {
    setViewMode('gate');
  }, []);

  const handleConfigure = useCallback(() => {
    if (onConfigure) {
      onConfigure();
    } else {
      document.getElementById('vc_models_menu_button')?.click();
    }
  }, [onConfigure]);

  const handleRunUpdated = useCallback(
    (updatedRun: StoryRunRecord, updatedView: StoryActorView) => {
      setLocalView(updatedView);
      navigateToRun(updatedRun.runId);
    },
    [navigateToRun],
  );

  const isStage = Boolean(viewMode === 'stage' && activeRun);

  return (
    <div
      ref={storyTabRef}
      className={['vc-story-tab', !isStage ? 'vc-desktop-story' : ''].filter(Boolean).join(' ')}
      data-view={isStage ? 'stage' : 'gate'}
      aria-label="剧情"
      style={{ '--vc-letterbox': STAGE_MOTION.letterbox } as CSSProperties}
    >
      <PortalHostProvider container={storyTabRef} toastContainer={toastContainer}>
        <div className="vc-story-body">
          {isStage && activeRun ? (
            <Stage
              runId={activeRun.runId}
              branchId={activeRun.branchId}
              worldVersion={activeRun.worldVersion}
              stage={activeRun.stage}
              initialView={activeView}
              conversationId={activeRun.conversationId}
              configNote={configNote}
              onClose={handleCloseStage}
              onConfigure={handleConfigure}
              onRunUpdated={handleRunUpdated}
            />
          ) : (
            <StoryList
              activeRun={activeRun}
              activeView={activeView}
              busy={busy}
              configNote={configNote}
              errorText={errorText}
              onStartOrEnter={() => void handleStartOrEnter()}
              onWizardStarted={handleWizardStarted}
              onConfigure={handleConfigure}
            />
          )}
        </div>
      </PortalHostProvider>
    </div>
  );
}
