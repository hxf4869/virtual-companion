import type { TavernField } from '../../data/queries/tavern';
import { TavernFieldRow } from './CodeField';

export interface RegexScriptsProps {
  fields: TavernField[];
  busy: boolean;
  onField: (id: string, value: unknown) => void;
}

export function RegexScripts({ fields, busy, onField }: RegexScriptsProps) {
  return (
    <>
      {fields.map((f) => (
        <TavernFieldRow key={f.key} field={f} busy={busy} onField={onField} />
      ))}
    </>
  );
}
