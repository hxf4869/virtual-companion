import type { ReactNode } from 'react';
import { isEpilogueDirty } from './useStory';

export { isEpilogueDirty };

export interface EpilogueMemoriesProps {
  ended: boolean;
  summaryDraft: string;
  epilogueMessage?: string;
  busy?: boolean;
  onSummaryChange: (value: string) => void;
  onSaveEpilogue: (summary: string) => void;
  onDiscardEpilogue: () => void;
  renderLeaveGuard?: (dirty: boolean) => ReactNode;
}

export function EpilogueMemories({
  ended,
  summaryDraft,
  epilogueMessage = '',
  busy = false,
  onSummaryChange,
  onSaveEpilogue,
  onDiscardEpilogue,
  renderLeaveGuard,
}: EpilogueMemoriesProps) {
  const isDirty = isEpilogueDirty(ended, summaryDraft, epilogueMessage);

  if (!ended) return null;

  return (
    <section className="vc-group vc-story-ending" aria-label="结局">
      {renderLeaveGuard ? renderLeaveGuard(isDirty) : null}
      <h2>结局</h2>
      {epilogueMessage ? <p className="vc-story-epilogue-note">{epilogueMessage}</p> : null}
      <textarea
        data-field="summary"
        maxLength={2000}
        aria-label="共同游玩摘要"
        disabled={busy}
        value={summaryDraft}
        onChange={(e) => onSummaryChange(e.target.value)}
      />
      <div className="vc-ending-actions">
        <button
          type="button"
          className="vc-btn vc-btn--filled vc-btn-fill"
          data-action="save-epilogue"
          disabled={busy}
          onClick={() => onSaveEpilogue(summaryDraft)}
        >
          保存共同游玩摘要
        </button>
        <button
          type="button"
          className="vc-btn vc-btn--text vc-btn-text is-danger"
          data-action="discard-epilogue"
          disabled={busy}
          onClick={onDiscardEpilogue}
        >
          放弃共同游玩摘要
        </button>
      </div>
    </section>
  );
}
