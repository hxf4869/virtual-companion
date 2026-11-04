import { useState } from 'react';
import type { CharacterCardItem } from '../../data/queries/characters';

export interface CharacterGridProps {
    cards: CharacterCardItem[];
    selectedRef?: string;
    selectedAvatar?: string;
    onSelectCard: (card: CharacterCardItem) => void;
}

function initialOf(name: string): string {
    const clean = String(name || '').replace(/[^\p{L}\p{N}]/gu, '');
    return [...clean][0] || '角';
}

function CardAvatar({ src, name }: { src: string; name: string }) {
    const [failedSrc, setFailedSrc] = useState('');
    const showImg = Boolean(src && failedSrc !== src);
    return (
        <span className="vc-character-card-avatar">
            {showImg ? (
                <img
                    src={src}
                    alt=""
                    loading="lazy"
                    onError={() => setFailedSrc(src)}
                />
            ) : (
                <span aria-hidden="true">{initialOf(name)}</span>
            )}
        </span>
    );
}

export function CharacterGrid({
    cards,
    selectedRef = '',
    selectedAvatar = '',
    onSelectCard,
}: CharacterGridProps) {
    return (
        <div className="vc-character-grid" role="list">
            {cards.map((card) => {
                const isSelected = Boolean(
                    (selectedRef && card.characterRef === selectedRef) ||
                        (selectedAvatar && card.avatar === selectedAvatar),
                );
                const latestInstance = card.instances[0];
                const key = card.characterRef || card.avatar || card.name;
                return (
                    <button
                        key={key}
                        type="button"
                        role="listitem"
                        className={`vc-character-card${isSelected ? ' is-selected' : ''}`}
                        data-ref={card.characterRef}
                        data-avatar={card.avatar}
                        aria-pressed={isSelected}
                        onClick={() => onSelectCard(card)}
                    >
                        <CardAvatar src={card.avatarUrl} name={card.name} />
                        <div className="vc-character-card-body">
                            <span className="vc-character-card-title">{card.name}</span>
                            {card.description ? (
                                <p className="vc-character-card-desc">{card.description}</p>
                            ) : null}
                        </div>
                        <div className="vc-character-card-meta">
                            <span>
                                {latestInstance
                                    ? latestInstance.label
                                    : card.worldName || '尚未开启实例'}
                            </span>
                            {latestInstance?.when ? (
                                <time>{latestInstance.when}</time>
                            ) : card.instances.length > 1 ? (
                                <span>{card.instances.length} 个实例</span>
                            ) : null}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
