import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  CASE_TITLE,
  STORY_SYNC_PENDING,
} from '../../../../extension/vc-model-settings/story-logic.js';
import type { StoryActorView, StoryRunRecord } from '../../data/queries/story';
import { Button } from '../../design/components/Button';
import { Dialog } from '../../design/components/Dialog';
import { Icon } from '../../design/components/Icon';
import {
  PortalHostProvider,
  usePortalContainer,
  useToastPortalContainer,
} from '../../design/portal-host';
import { ActionBar } from './ActionBar';
import { ClueWall } from './ClueWall';
import { EpilogueMemories } from './EpilogueMemories';
import { NpcCast } from './NpcCast';
import { RewindDialog } from './RewindDialog';
import { useStoryStage } from './useStory';

export interface StageProps {
  runId: string;
  branchId: string;
  worldVersion: number;
  stage?: 'investigation' | 'resolved' | '';
  initialView?: StoryActorView | Record<string, any> | null;
  conversationId?: string;
  chatIdentity?: string;
  configNote?: string;
  reducedMotion: boolean;
  onClose?: () => void;
  onConfigure?: () => void;
  onRunUpdated?: (run: StoryRunRecord, view: StoryActorView) => void;
  renderLeaveGuard?: (dirty: boolean) => ReactNode;
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
  reducedMotion,
  onClose,
  onConfigure,
  onRunUpdated,
  renderLeaveGuard,
}: StageProps) {
  const portalContainer = usePortalContainer();
  const toastContainer = useToastPortalContainer();
  const [stageHostEl, setStageHostEl] = useState<HTMLDivElement | null>(null);

  const {
    worldVersion,
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
    epilogueNote,
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
  } = useStoryStage({
    runId,
    branchId: propBranchId,
    worldVersion: propWorldVersion,
    stage: propStage,
    initialView,
    conversationId: propConversationId,
    chatIdentity: propChatIdentity,
    onRunUpdated,
  });

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
              reducedMotion={reducedMotion}
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
              renderLeaveGuard={renderLeaveGuard}
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
