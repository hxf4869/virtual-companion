import { STEPS, actionGroup } from '../../../../extension/vc-model-settings/story-logic.js';
import { Icon } from '../../design/components/Icon';

export interface ActionStepItem {
  id: string;
  label: string;
  action: string;
  target: string;
  clueId?: string;
  visible?: boolean;
  className?: string;
}

export interface ActionBarProps {
  selectedActorId?: string;
  selectedActorName?: string;
  draftSay: string;
  busy?: boolean;
  generating?: boolean;
  ended?: boolean;
  onDraftSayChange: (value: string) => void;
  onCommitStep: (stepId: string) => void;
  onCommitSay: (text: string) => void;
}

export function ActionBar({
  selectedActorId = '',
  selectedActorName = '',
  draftSay,
  busy = false,
  generating = false,
  ended = false,
  onDraftSayChange,
  onCommitStep,
  onCommitSay,
}: ActionBarProps) {
  if (ended) return null;

  const steps: ActionStepItem[] = STEPS.map((step) => ({
    ...step,
    visible:
      actionGroup(step) === 'place' ||
      (Boolean(selectedActorId) && step.target === selectedActorId),
    className:
      step.action === 'accuse'
        ? 'vc-btn vc-btn--danger vc-btn-danger'
        : 'vc-btn vc-btn--gray vc-btn-gray',
  }));

  const handleSubmitSay = () => {
    if (busy || generating || !draftSay.trim()) return;
    onCommitSay(draftSay);
  };

  return (
    <div className="vc-dock vc-glass">
      <div className="vc-acts">
        {steps.map((step) => (
          <button
            key={step.id}
            type="button"
            className={step.className}
            data-action="act"
            data-step={step.id}
            hidden={!step.visible}
            disabled={busy}
            onClick={() => onCommitStep(step.id)}
          >
            {step.label}
          </button>
        ))}
      </div>
      <div className="vc-story-say">
        <label className="vc-story-say-row vc-field vc-composer-field vc-glass">
          <textarea
            data-field="say"
            maxLength={4000}
            rows={1}
            aria-label="对所选角色说"
            placeholder={selectedActorName ? `对${selectedActorName}说` : '先选择一位角色'}
            disabled={busy}
            value={draftSay}
            onChange={(e) => onDraftSayChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSubmitSay();
              }
            }}
          />
          <button
            type="button"
            className="vc-send"
            data-action="say"
            aria-label={generating ? '停止' : '发送'}
            disabled={busy || generating || !draftSay.trim()}
            onClick={handleSubmitSay}
          >
            <Icon name={generating ? 'square' : 'arrow-up'} size={18} />
          </button>
        </label>
      </div>
    </div>
  );
}
