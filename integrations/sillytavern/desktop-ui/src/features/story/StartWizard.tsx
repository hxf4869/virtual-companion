import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CASE_TITLE,
  CASTABLE,
  CONFIG_MISSING,
  SESSION_CHANGED,
  START_FAILED,
  STORY_CONFLICT,
  decimalOf,
  initial,
  storyTurn,
} from '../../../../extension/vc-model-settings/story-logic.js';
import { useAppClient } from '../../app/providers';
import { queryKeys } from '../../data/queryKeys';
import {
  buildStoryRunRecord,
  ensureStoryConversation,
  mapStoryParticipantWithClient,
  normalizeStoryView,
  upsertStoryRunCache,
  useStoryCompanions,
  type StoryActorView,
  type StoryRunRecord,
} from '../../data/queries/story';
import { Button } from '../../design/components/Button';
import { useSessionBridge } from '../../runtime/session-bridge';

export interface StartWizardSuccess {
  runId: string;
  branchId: string;
  worldVersion: number;
  conversationId: string;
  chatIdentity: string;
  run: StoryRunRecord;
  view: StoryActorView;
}

export interface StartWizardProps {
  onStarted?: (result: StartWizardSuccess) => void;
  onConfigure?: () => void;
  onError?: (error: { message: string; needsModelConfig?: boolean }) => void;
}

const WIZARD_STEPS = [
  { step: 1, label: '选择剧目' },
  { step: 2, label: '同行陪伴' },
  { step: 3, label: '公开设定' },
  { step: 4, label: '调查方式' },
  { step: 5, label: '确认开局' },
] as const;

const CAST_ACTOR_LABELS: Record<string, string> = {
  lin: '林岚',
  zhou: '周澈',
  su: '苏禾',
};

export function StartWizard({ onStarted, onConfigure, onError }: StartWizardProps) {
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

  const companions = companionsQuery.data ?? [];
  const selectedCompanion = companions.find(
    (c) => String(c.relationshipId) === String(selectedCompanionId),
  );

  const handleStart = async () => {
    if (busy) return;
    setBusy(true);
    setErrorText('');
    setNeedsConfig(false);

    try {
      await client.go.captureSessionContext();

      try {
        const rawPurposes: any = await client.go.fetchModelPurposes();
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
            setNeedsConfig(true);
          }
        }
      } catch {
        // 用途检查异常不阻断开局尝试
      }

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

      const mapped: Record<string, string> = {};
      if (selectedCompanionId && CASTABLE.includes(selectedCastActor)) {
        await mapStoryParticipantWithClient(client, {
          runId,
          actorId: selectedCastActor,
          relationshipId: selectedCompanionId,
        });
        mapped[selectedCastActor] = selectedCompanionId;
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
      const msg =
        err?.status === 409 && err?.code === 'ACCOUNT_CONTEXT_CHANGED'
          ? SESSION_CHANGED
          : err?.status === 409
            ? STORY_CONFLICT
            : START_FAILED;
      setErrorText(msg);
      onError?.({ message: msg });
    } finally {
      setBusy(false);
    }
  };

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
          <Button
            variant="gray"
            data-action="configure"
            onClick={() => {
              if (onConfigure) onConfigure();
              else document.getElementById('vc_models_menu_button')?.click();
            }}
          >
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
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            上一步
          </Button>
        ) : null}

        {step < 5 ? (
          <Button
            variant="filled"
            data-action="wizard-next"
            disabled={busy}
            onClick={() => setStep((s) => Math.min(5, s + 1))}
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
