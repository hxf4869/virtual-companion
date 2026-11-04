import type { TavernSectionProps } from '../../data/queries/tavern';
import {
  TavernActionButton,
  TavernFormContainer,
  TavernGroupSection,
  TavernItemList,
  TavernResourceRow,
} from './CodeField';
import { PromptOrder } from './PromptOrder';

export function Formatting({ controller }: TavernSectionProps) {
  const { state, busy, onField, onAction, reorderPrompts } = controller;
  return (
    <TavernFormContainer controller={controller}>
      {state.resources.length > 0 || state.actions.length > 0 ? (
        <section className="vc-desk-group" data-tavern-group="resources">
          <h2>预设与资源</h2>
          {state.resources.map((r) => (
            <TavernResourceRow key={r.key} resource={r} busy={busy} onAction={onAction} />
          ))}
          {state.actions.length > 0 ? (
            <div className="vc-desk-actions">
              {state.actions.map((a) => (
                <TavernActionButton key={a.id} action={a} busy={busy} onAction={onAction} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {state.items && state.items.length > 0 ? (
        <TavernItemList
          title="提示词列表"
          items={state.items}
          busy={busy}
          onSelect={(id) => onAction('select-item', id)}
        />
      ) : null}

      {state.order && state.order.length > 0 ? (
        <PromptOrder
          items={state.order}
          busy={busy}
          onSelect={(id) => onAction('select-item', id)}
          onToggle={(id, enabled) => onField(`order:${id}`, enabled)}
          onMoveUp={(id) => onAction('prompt-up', id)}
          onMoveDown={(id) => onAction('prompt-down', id)}
          onReorder={reorderPrompts}
        />
      ) : null}

      {state.groups.map((g) => (
        <TavernGroupSection
          key={g.id}
          group={g}
          busy={busy}
          onField={onField}
          onAction={onAction}
        />
      ))}
    </TavernFormContainer>
  );
}
