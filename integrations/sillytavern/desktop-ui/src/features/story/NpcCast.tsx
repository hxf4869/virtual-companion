import { CASTABLE, initial } from '../../../../extension/vc-model-settings/story-logic.js';
import type { StoryCompanionRow } from '../../data/queries/story';

export interface StageNpcItem {
  id: string;
  name: string;
  initial?: string;
  persona?: string;
  selected?: boolean;
}

export interface NpcCastProps {
  people: StageNpcItem[];
  selectedActorId?: string;
  companions?: StoryCompanionRow[] | null;
  mapped?: Record<string, string>;
  disabled?: boolean;
  onSelectActor: (actorId: string) => void;
  onShowCompanions: () => void;
  onMapCompanion: (actorId: string, relationshipId: string) => void;
}

const DEFAULT_NPCS: StageNpcItem[] = [
  { id: 'lin', name: '林岚', initial: '林', persona: '' },
  { id: 'zhou', name: '周澈', initial: '周', persona: '' },
  { id: 'su', name: '苏禾', initial: '苏', persona: '' },
];

export function NpcCast({
  people,
  selectedActorId = '',
  companions = null,
  mapped = {},
  disabled = false,
  onSelectActor,
  onShowCompanions,
  onMapCompanion,
}: NpcCastProps) {
  const stageNpcs = (people.length ? people : DEFAULT_NPCS).filter(
    (person) => person.id !== 'player',
  );
  const hasSelection = stageNpcs.some(
    (person) => person.selected || person.id === selectedActorId,
  );

  const companionOptions = companions
    ? companions.flatMap((row) =>
        CASTABLE.map((actor) => {
          const npcName =
            stageNpcs.find((person) => person.id === actor)?.name ||
            (actor === 'lin' ? '林岚' : actor === 'zhou' ? '周澈' : '苏禾');
          return {
            actor,
            relationship: String(row.relationshipId),
            label: `${row.name} 入局为${npcName}`,
          };
        }),
      )
    : null;

  const mappedBadges = Object.entries(mapped)
    .filter(([, relId]) => Boolean(relId))
    .map(([actor]) => {
      const npcName =
        stageNpcs.find((person) => person.id === actor)?.name ||
        (actor === 'lin' ? '林岚' : actor === 'zhou' ? '周澈' : '苏禾');
      return { actor, text: `已以${npcName}入局` };
    });

  return (
    <>
      <div className={`vc-npcs${hasSelection ? ' is-focus' : ''}`}>
        {stageNpcs.map((person) => {
          const isSelected = Boolean(person.selected || person.id === selectedActorId);
          const mark = person.initial || initial(person.name);
          return (
            <button
              key={person.id}
              type="button"
              className={`vc-npc vc-story-person${isSelected ? ' is-on' : ''}`}
              data-action="select-actor"
              data-actor={person.id}
              aria-pressed={isSelected}
              aria-label={[person.name, person.persona].filter(Boolean).join('，')}
              disabled={disabled}
              onClick={() => onSelectActor(person.id)}
            >
              <span className="vc-npc-avatar" aria-hidden="true">
                {mark}
              </span>
              <span className="vc-npc-name">{person.name}</span>
            </button>
          );
        })}
      </div>

      <section className="vc-group vc-story-companions" aria-label="陪伴">
        {mappedBadges.length > 0 ? (
          <div className="vc-story-cast-badges">
            {mappedBadges.map((badge) => (
              <span key={badge.actor} className="vc-meta vc-story-cast-badge">
                {badge.text}
              </span>
            ))}
          </div>
        ) : null}

        {companionOptions ? (
          companionOptions.length > 0 ? (
            companionOptions.map((row) => (
              <button
                key={`${row.relationship}:${row.actor}`}
                type="button"
                className="vc-cell"
                data-action="map-companion"
                data-actor={row.actor}
                data-relationship={row.relationship}
                disabled={disabled}
                onClick={() => onMapCompanion(row.actor, row.relationship)}
              >
                {row.label}
              </button>
            ))
          ) : (
            <p className="vc-dim">还没有可邀请入局的陪伴角色。</p>
          )
        ) : (
          <button
            type="button"
            className="vc-cell"
            data-action="show-companions"
            disabled={disabled}
            onClick={onShowCompanions}
          >
            选择陪伴入局
          </button>
        )}
      </section>
    </>
  );
}
