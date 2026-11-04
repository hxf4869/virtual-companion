import type { TavernSectionProps } from '../../data/queries/tavern';
import {
  TavernActionButton,
  TavernFormContainer,
  TavernGalleryGrid,
  TavernGroupSection,
  TavernResourceRow,
} from './CodeField';

export function Backgrounds({ controller }: TavernSectionProps) {
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

      {state.gallery && state.gallery.length > 0 ? (
        <TavernGalleryGrid
          title="图像列表"
          items={state.gallery}
          busy={busy}
          onSelect={(id) => onAction('select-image', id)}
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
