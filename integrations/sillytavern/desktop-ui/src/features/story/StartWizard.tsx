import {
  CASE_TITLE,
  CASTABLE,
  CONFIG_MISSING,
  initial,
} from '../../../../extension/vc-model-settings/story-logic.js';
import { Button } from '../../design/components/Button';
import {
  CAST_ACTOR_LABELS,
  WIZARD_STEPS,
  useStartWizard,
  type StartWizardSuccess,
} from './useStory';

export type { StartWizardSuccess };

export interface StartWizardProps {
  onStarted?: (result: StartWizardSuccess) => void;
  onConfigure: () => void;
  onError?: (error: { message: string; needsModelConfig?: boolean }) => void;
}

export function StartWizard({ onStarted, onConfigure, onError }: StartWizardProps) {
  const {
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
  } = useStartWizard({ onStarted, onError });

  return (
    <section
      className="vc-story-wizard vc-group"
      aria-label="开局向导"
      data-wizard-step={String(step)}
    >
      <ol className="vc-story-wizard__steps">
        {WIZARD_STEPS.map((item) => (
          <li
            key={item.step}
            className={[
              'vc-story-wizard__step-pill',
              step === item.step ? 'is-active' : '',
              step > item.step ? 'is-done' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button
              type="button"
              className="vc-story-wizard__step-btn"
              data-wizard-step-tab={String(item.step)}
              disabled={busy}
              onClick={() => setStep(item.step)}
            >
              <span>{item.step}</span>
              <span>{item.label}</span>
            </button>
          </li>
        ))}
      </ol>

      {needsConfig ? (
        <div className="vc-story-config vc-note vc-glass" data-config="missing" role="status">
          <p>{CONFIG_MISSING}</p>
          <Button variant="gray" data-action="configure" onClick={onConfigure}>
            打开模型设置
          </Button>
        </div>
      ) : null}

      {errorText && !needsConfig ? (
        <p className="vc-note vc-glass" role="alert">
          {errorText}
        </p>
      ) : null}

      <div className="vc-story-wizard__body">
        {step === 1 ? (
          <div className="vc-story-wizard__pane" data-wizard-pane="1">
            <h3>{CASE_TITLE}</h3>
            <p className="vc-dim">
              雨夜，小旅馆的一枚展柜怀表失踪。你将进入现场，通过询问在场人物与查验物证还原真相。
            </p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="vc-story-wizard__pane" data-wizard-pane="2">
            <h3>选择同行陪伴</h3>
            <div className="vc-story-wizard__companions">
              <button
                type="button"
                className={`vc-cell${selectedCompanionId === '' ? ' is-selected' : ''}`}
                data-companion-id=""
                aria-pressed={selectedCompanionId === ''}
                disabled={busy}
                onClick={() => setSelectedCompanionId('')}
              >
                独自入局
              </button>
              {companions.map((comp) => {
                const isSelected = String(comp.relationshipId) === String(selectedCompanionId);
                return (
                  <button
                    key={comp.relationshipId}
                    type="button"
                    className={`vc-cell${isSelected ? ' is-selected' : ''}`}
                    data-companion-id={comp.relationshipId}
                    aria-pressed={isSelected}
                    disabled={busy}
                    onClick={() => setSelectedCompanionId(String(comp.relationshipId))}
                  >
                    <span className="vc-npc-avatar" aria-hidden="true">
                      {initial(comp.name)}
                    </span>
                    <span>{comp.name}</span>
                  </button>
                );
              })}
            </div>

            {selectedCompanionId ? (
              <div className="vc-story-wizard__cast-roles">
                {CASTABLE.map((actorId) => {
                  const active = selectedCastActor === actorId;
                  return (
                    <button
                      key={actorId}
                      type="button"
                      className={`vc-btn vc-btn--gray vc-btn-gray${active ? ' is-selected' : ''}`}
                      data-cast-actor={actorId}
                      aria-pressed={active}
                      disabled={busy}
                      onClick={() => setSelectedCastActor(actorId)}
                    >
                      以{CAST_ACTOR_LABELS[actorId] || actorId}入局
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="vc-story-wizard__pane" data-wizard-pane="3">
            <h3>公开设定与现场</h3>
            <ul className="vc-story-places">
              <li>大堂：煤油灯还亮着，展柜锁扣完好。</li>
              <li>厨房：通往后院的门闩扣着。</li>
              <li>维修间：工具柜留有近期翻动痕迹。</li>
            </ul>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="vc-story-wizard__pane" data-wizard-pane="4">
            <h3>调查与回档</h3>
            <p className="vc-dim">
              每次行动或问话都会推进世界版本并同步到当前会话；随时可以回到任意早期版本开启新分支。
            </p>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="vc-story-wizard__pane" data-wizard-pane="5">
            <h3>确认开局</h3>
            <p className="vc-story-wizard__summary">
              <span>剧目：{CASE_TITLE}</span>
              <span>
                同行：
                {selectedCompanion
                  ? `${selectedCompanion.name}（以${CAST_ACTOR_LABELS[selectedCastActor] || selectedCastActor}入局）`
                  : '独自入局'}
              </span>
            </p>
          </div>
        ) : null}
      </div>

      <div className="vc-story-wizard__footer">
        {step > 1 ? (
          <Button
            variant="gray"
            data-action="wizard-prev"
            disabled={busy}
            onClick={prevStep}
          >
            上一步
          </Button>
        ) : null}

        {step < 5 ? (
          <Button
            variant="filled"
            data-action="wizard-next"
            disabled={busy}
            onClick={nextStep}
          >
            下一步
          </Button>
        ) : (
          <Button
            variant="filled"
            data-action="wizard-start"
            pending={busy}
            disabled={busy}
            onClick={() => void handleStart()}
          >
            开始这一局
          </Button>
        )}
      </div>
    </section>
  );
}
