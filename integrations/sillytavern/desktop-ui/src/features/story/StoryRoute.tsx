import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { STAGE_MOTION } from '../../../../extension/vc-model-settings/story-logic.js';
import {
  PortalHostProvider,
  useToastPortalContainer,
} from '../../design/portal-host';
import { Stage } from './Stage';
import { StoryList } from './StoryList';
import { useStoryRoute } from './useStory';
import './story.css';

export interface StoryRouteProps {
  runId?: string;
  reducedMotion: boolean;
  onOpenRun: (runId: string) => void;
  onConfigure: () => void;
  renderLeaveGuard?: (dirty: boolean) => ReactNode;
}

export function StoryRoute({
  runId: routeRunId,
  reducedMotion,
  onOpenRun,
  onConfigure,
  renderLeaveGuard,
}: StoryRouteProps) {
  const toastContainer = useToastPortalContainer();
  const storyTabRef = useRef<HTMLDivElement | null>(null);

  const {
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
  } = useStoryRoute({
    runId: routeRunId,
    onOpenRun,
  });

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
              reducedMotion={reducedMotion}
              onClose={handleCloseStage}
              onConfigure={onConfigure}
              onRunUpdated={handleRunUpdated}
              renderLeaveGuard={renderLeaveGuard}
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
              onConfigure={onConfigure}
            />
          )}
        </div>
      </PortalHostProvider>
    </div>
  );
}
