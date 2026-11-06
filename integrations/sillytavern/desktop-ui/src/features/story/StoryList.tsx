import {
  CASE_TITLE,
  coverPeople,
  initial,
  progressPercent,
  stageWord,
} from '../../../../extension/vc-model-settings/story-logic.js';
import type { StoryActorView, StoryRunRecord } from '../../data/queries/story';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import { StartWizard, type StartWizardSuccess } from './StartWizard';

export interface StoryListProps {
  activeRun?: StoryRunRecord | null;
  activeView?: StoryActorView | null;
  loading?: boolean;
  busy?: boolean;
  configNote?: string;
  errorText?: string;
  onStartOrEnter: () => void;
  onWizardStarted?: (result: StartWizardSuccess) => void;
  onConfigure: () => void;
}

export function StoryList({
  activeRun = null,
  activeView = null,
  loading = false,
  busy = false,
  configNote = '',
  errorText = '',
  onStartOrEnter,
  onWizardStarted,
  onConfigure,
}: StoryListProps) {
  const playing = Boolean(activeRun && activeView);
  const stageLabel = stageWord(activeRun?.stage);
  const version = activeRun?.worldVersion ?? 0;
  const percent = progressPercent({
    run: activeRun,
    turn: { worldVersion: version },
  });
  const coverList = coverPeople({ view: activeView });

  const startButton = (
    <Button
      type="button"
      variant="filled"
      className="vc-btn-fill"
      data-action={playing ? 'enter' : 'start'}
      disabled={busy}
      onClick={onStartOrEnter}
    >
      <Icon name="play" size={18} />
      {playing ? '继续' : '开局'}
    </Button>
  );

  return (
    <>
      <header className="vc-navbar">
        <div className="vc-nav-title" role="heading" aria-level={1} tabIndex={-1}>
          剧情
        </div>
        <div className="vc-nav-spacer" />
        {!playing && !loading ? startButton : null}
      </header>

      <div className="vc-scroll">
        <div
          className="vc-story"
          data-state={
            loading ? 'unstarted' : playing ? (activeRun?.stage === 'resolved' ? 'ended' : 'playing') : 'unstarted'
          }
          data-world-version={playing && !loading ? version : undefined}
        >
          {configNote ? (
            <div className="vc-story-config vc-note vc-glass" data-config="missing" role="status">
              <p>{configNote}</p>
              <Button variant="gray" data-action="configure" onClick={onConfigure}>
                打开模型设置
              </Button>
            </div>
          ) : null}

          {errorText ? (
            <p className="vc-note vc-glass" role="alert">
              {errorText}
            </p>
          ) : null}

          {loading ? (
            <div className="vc-skeleton-row" aria-busy="true">
              <span className="vc-skeleton vc-skeleton-avatar" />
              <span className="vc-grow">
                <span className="vc-skeleton vc-skeleton-line" />
                <span className="vc-skeleton vc-skeleton-line is-short" />
              </span>
            </div>
          ) : null}

          <article className="vc-case">
            <div className="vc-case-cover">
              <div className="vc-case-fog" />
              {coverList.map((person: { actorId: string; name: string }) => (
                <span
                  key={person.actorId}
                  className="vc-case-face"
                  aria-label={person.name}
                >
                  {initial(person.name)}
                </span>
              ))}
            </div>
            <div className="vc-case-info">
              <h3>{CASE_TITLE}</h3>
              {stageLabel ? <span className="vc-meta">{stageLabel}</span> : null}
              <div className="vc-case-bar" aria-hidden="true">
                <i style={{ width: `${percent}%` }} />
              </div>
              {!loading && playing ? startButton : null}
            </div>
          </article>

          {!playing && !loading ? (
            <StartWizard onStarted={onWizardStarted} onConfigure={onConfigure} />
          ) : null}
        </div>
      </div>
    </>
  );
}
