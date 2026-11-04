import type { TavernSectionProps } from '../../data/queries/tavern';
import {
  TavernActionButton,
  TavernFormContainer,
  TavernGroupSection,
  TavernItemList,
  TavernResourceRow,
} from './CodeField';
import { WorldEntryForm } from './WorldEntryForm';

export function WorldInfo({ controller }: TavernSectionProps) {
  const { state, busy, onField, onAction } = controller;
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
          title="世界书条目"
          items={state.items}
          busy={busy}
          onSelect={(id) => onAction('select-item', id)}
        />
      ) : null}

      {state.groups.map((g) =>
        g.id === 'entry' ? (
          <WorldEntryForm
            key={g.id}
            group={g}
            busy={busy}
            onField={onField}
            onAction={onAction}
          />
        ) : (
          <TavernGroupSection
            key={g.id}
            group={g}
            busy={busy}
            onField={onField}
            onAction={onAction}
          />
        ),
      )}
    </TavernFormContainer>
  );
}
