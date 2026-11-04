import { useRouter } from '@tanstack/react-router';
import { useLeaveGuard } from '../../shell/useLeaveGuard';

export interface EpilogueMemoriesProps {
  ended: boolean;
  summaryDraft: string;
  epilogueMessage?: string;
  busy?: boolean;
  onSummaryChange: (value: string) => void;
  onSaveEpilogue: (summary: string) => void;
  onDiscardEpilogue: () => void;
}

function RouterBoundLeaveGuard({ dirty }: { dirty: boolean }) {
  const guardNode = useLeaveGuard(dirty);
  return <>{guardNode}</>;
}

export function EpilogueMemories({
  ended,
  summaryDraft,
  epilogueMessage = '',
  busy = false,
  onSummaryChange,
  onSaveEpilogue,
  onDiscardEpilogue,
}: EpilogueMemoriesProps) {
  let hasRouter = false;
  try {
    hasRouter = Boolean(useRouter({ warn: false } as any));
  } catch {
    hasRouter = false;
  }
  const isDirty = Boolean(ended && summaryDraft.trim() && !epilogueMessage);

  if (!ended) return null;

  return (
    <section className="vc-group vc-story-ending" aria-label="结局">
      {hasRouter ? <RouterBoundLeaveGuard dirty={isDirty} /> : null}
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
          className="vc-btn vc-btn-fill"
          data-action="save-epilogue"
          disabled={busy}
          onClick={() => onSaveEpilogue(summaryDraft)}
        >
          保存共同游玩摘要
        </button>
        <button
          type="button"
          className="vc-btn vc-btn-text is-danger"
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
