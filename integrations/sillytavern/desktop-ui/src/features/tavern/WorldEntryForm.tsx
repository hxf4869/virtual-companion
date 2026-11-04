import type { TavernGroup } from '../../data/queries/tavern';
import { TavernGroupSection } from './CodeField';

export interface WorldEntryFormProps {
  group: TavernGroup;
  busy: boolean;
  onField: (id: string, value: unknown) => void;
  onAction: (id: string, value?: unknown) => void;
}

export function WorldEntryForm({ group, busy, onField, onAction }: WorldEntryFormProps) {
  return (
    <TavernGroupSection
      group={group}
      busy={busy}
      onField={onField}
      onAction={onAction}
    />
  );
}
