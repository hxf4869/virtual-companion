import type { TavernSectionProps } from '../../data/queries/tavern';
import {
  TavernActionButton,
  TavernFormContainer,
  TavernGroupSection,
  TavernResourceRow,
} from './CodeField';
import { HelperScripts } from './HelperScripts';

const HELPER_BUNDLE_IDS = new Set(['helper-global', 'helper-preset', 'helper-character']);

export function Extensions({ controller }: TavernSectionProps) {
  const { state, busy, onField, onAction } = controller;
  const ejsGroup = state.groups.find((g) => g.id === 'ejs');
  const renderGroup = state.groups.find((g) => g.id === 'helper-render');
  const scopeGroup = state.groups.find((g) => g.id === 'helper-script');
  const bundleGroups = state.groups.filter((g) => HELPER_BUNDLE_IDS.has(g.id));
  const otherGroups = state.groups.filter(
    (g) =>
      g.id !== 'ejs' &&
      g.id !== 'helper-render' &&
      g.id !== 'helper-script' &&
      !HELPER_BUNDLE_IDS.has(g.id),
  );

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

      {ejsGroup ? (
        <TavernGroupSection
          group={ejsGroup}
          busy={busy}
          onField={onField}
          onAction={onAction}
        />
      ) : null}

      {renderGroup ? (
        <TavernGroupSection
          group={renderGroup}
          busy={busy}
          onField={onField}
          onAction={onAction}
        />
      ) : null}

      <HelperScripts
        scopeGroup={scopeGroup}
        bundleGroups={bundleGroups}
        busy={busy}
        onField={onField}
        onAction={onAction}
      />

      {otherGroups.map((g) => (
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
