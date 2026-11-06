import { useLayoutEffect, useRef, useState } from 'react';
import {
  STAGE_MOTION,
  evidenceIcon,
  evidenceItems,
} from '../../../../extension/vc-model-settings/story-logic.js';
import { Icon } from '../../design/components/Icon';
import { normalizeStoryView, type StoryActorView } from '../../data/queries/story';

export interface ClueCardItem {
  name: string;
  detail: string;
  glyph: string;
  fresh: boolean;
  flipped: boolean;
}

export interface ClueWallProps {
  view?: StoryActorView | Record<string, any> | null;
  cards?: ClueCardItem[];
  freshClueName?: string;
  flippedNames?: ReadonlySet<string>;
  reducedMotion: boolean;
  onReveal?: (name: string) => void;
}

function buildCardsFromView(
  view: StoryActorView | Record<string, any> | null | undefined,
  freshClueName = '',
  flippedNames?: ReadonlySet<string>,
): ClueCardItem[] {
  if (!view) return [];
  const normalized = normalizeStoryView(view);
  return evidenceItems({ view: normalized }).map((item) => {
    const isFresh = Boolean(freshClueName && item.name === freshClueName);
    return {
      ...item,
      glyph: evidenceIcon(item.name),
      fresh: isFresh,
      flipped: flippedNames ? flippedNames.has(item.name) || !isFresh : true,
    };
  });
}

function EvidenceFlipCard({
  card,
  reducedMotion,
  onReveal,
}: {
  card: ClueCardItem;
  reducedMotion: boolean;
  onReveal?: (name: string) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [flipped, setFlipped] = useState<boolean>(() =>
    reducedMotion ? true : Boolean(card.flipped),
  );
  const isAnimatingFlip = Boolean(card.fresh && !reducedMotion);

  useLayoutEffect(() => {
    if (reducedMotion) {
      setFlipped(true);
      if (card.fresh) {
        onReveal?.(card.name);
      }
      return undefined;
    }
    if (!card.fresh || !ref.current) {
      setFlipped(true);
      return undefined;
    }
    const el = ref.current;
    const done = () => {
      setFlipped(true);
      onReveal?.(card.name);
    };
    if (typeof el.animate === 'function') {
      try {
        const anim = el.animate(
          [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }],
          {
            duration: STAGE_MOTION.flipMs,
            easing: 'cubic-bezier(.32,.72,0,1)',
          },
        );
        anim.finished?.then(done, () => {});
        return () => anim.cancel?.();
      } catch {
        done();
      }
    } else {
      done();
    }
    return undefined;
  }, [card.fresh, card.name, reducedMotion, onReveal]);

  const className = [
    'vc-evi',
    isAnimatingFlip ? 'is-flipping' : '',
    card.fresh && !flipped && !reducedMotion ? 'is-back' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      ref={ref}
      className={className}
      data-clue-name={card.name}
      data-flipped={flipped ? 'true' : 'false'}
      data-motion={reducedMotion ? 'reduced' : 'normal'}
      data-evidence={card.fresh ? 'show' : undefined}
    >
      <div className="vc-evi-face">
        <Icon name={card.glyph} size={18} />
        <b>{card.name}</b>
        {card.detail ? <span>{card.detail}</span> : null}
      </div>
      <div className="vc-evi-back" aria-hidden="true">
        <Icon name="sparkles" size={22} />
      </div>
      {card.fresh && flipped ? <span className="vc-evi-new">+1</span> : null}
    </article>
  );
}

export function ClueWall({
  view,
  cards,
  freshClueName = '',
  flippedNames,
  reducedMotion,
  onReveal,
}: ClueWallProps) {
  const resolvedCards = cards ?? buildCardsFromView(view, freshClueName, flippedNames);

  return (
    <section className="vc-story-clue-wall" aria-label="线索">
      {resolvedCards.length > 0 ? (
        <>
          <div className="vc-meta vc-evi-label">证物</div>
          <div className="vc-evis">
            {resolvedCards.map((card) => (
              <EvidenceFlipCard
                key={card.name}
                card={card}
                reducedMotion={reducedMotion}
                onReveal={onReveal}
              />
            ))}
          </div>
          <ul className="vc-story-clues vc-sr">
            {resolvedCards.map((card) => (
              <li key={card.name}>{card.name}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
