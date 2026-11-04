import type { TavernGroup } from '../../data/queries/tavern';
import { TavernFieldRow, TavernGroupSection } from './CodeField';
import { RegexScripts } from './RegexScripts';

export interface HelperScriptsProps {
  scopeGroup?: TavernGroup;
  bundleGroups: TavernGroup[];
  busy: boolean;
  onField: (id: string, value: unknown) => void;
  onAction: (id: string, value?: unknown) => void;
}

export function HelperScripts({
  scopeGroup,
  bundleGroups,
  busy,
  onField,
  onAction,
}: HelperScriptsProps) {
  return (
    <>
      {scopeGroup ? (
        <TavernGroupSection
          group={scopeGroup}
          busy={busy}
          onField={onField}
          onAction={onAction}
        />
      ) : null}
      {bundleGroups.map((group) => {
        const helperFields = group.fields.filter(
          (f) => f.name !== 'regex' && f.name !== 'regex_scripts',
        );
        const regexFields = group.fields.filter(
          (f) => f.name === 'regex' || f.name === 'regex_scripts',
        );
        return (
          <section key={group.id} className="vc-desk-group" data-tavern-group={group.id}>
            <h2>{group.title}</h2>
            {helperFields.map((f) => (
              <TavernFieldRow key={f.key} field={f} busy={busy} onField={onField} />
            ))}
            <RegexScripts fields={regexFields} busy={busy} onField={onField} />
          </section>
        );
      })}
    </>
  );
}
